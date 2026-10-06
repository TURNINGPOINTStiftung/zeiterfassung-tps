import { diffMin, daysInMonth, dateStr, getHolidays } from './utils.js';
import { getData, getEntry, entryKey } from './data.js';
import { isFreelancer } from './roles.js';

const _ABS_CATS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
// _absCredit = per Abwesenheits-Antrag gutgeschriebene Arbeitszeit (z.B. Bildungsurlaub über
// „Sonstiges"): zählt wie eine Abwesenheit VOLL (keine Pflichtpause, KEINE 15-Min-Rundung) –
// sonst würde die Person durch Pausenabzug/Rundung ins Minus rutschen.
export function isAbsDay(dd){ return _isAbsDay(dd); }
function _isAbsDay(dd){ return !!(dd&&(_ABS_CATS.has(dd.b1zuord)||_ABS_CATS.has(dd.b1bem)||(dd._absCredit&&dd.b1zuord==='Sonstiges'))); }

// Tatsächlich abzuziehende Auto-Pause (§ ArbZG):
// bis = Abfahrtszeit (= Nettoarbeitsende + Pause). Die Pflichtpause richtet
// sich nach der NETTO-Arbeitszeit (6h→30, 9h→45). Da die gespeicherte Brutto
// bereits die Pause enthält, werden die Schwellen um die Pause verschoben:
//   Netto≥6h  ⇔ Brutto≥6h30 (390)  → 30 Min
//   Netto≥9h  ⇔ Brutto≥9h45 (585)  → 45 Min
// Davon wird eine bereits genommene Lücke zwischen Block 1 und 2 abgezogen.
export function autoPauseMin(dd,user){
  if(!dd||_isAbsDay(dd)) return 0;
  if(user&&isFreelancer(user)) return 0; // Freiberufler: keine Pausen-Logik (auch keine Nachtschicht-Pause)
  if(String(dd.b1zuord||'').startsWith('Veranstaltung')) return 0; // Veranstaltung (Krank/AU): keine Pflichtpause
  if(dd._nightShift) return Number(dd._npMin||0); // Nachtschicht: Pause vom Tageswechsel-Paar
  // Reine Kleinteiligkeit (nur ktmin, kein abgeschlossener Block) → keine Pflichtpause.
  if(!dd.b1bis&&!dd.b2bis) return 0;
  // Wurde die Pause bereits beim Eintragen/Stempeln aufgeschlagen, gilt EXAKT dieser
  // Wert – sonst weicht der Abzug vom Aufschlag ab und die Summe stimmt nicht.
  if(dd._pInit) return Number(dd._paused||0);
  // Legacy/auto erzeugte Tage (ohne Live-Tracking): die gespeicherte Abfahrt enthält die
  // Pflichtpause bereits (BRUTTO). Deshalb müssen die Schwellen um die Pause verschoben
  // zurückgerechnet werden (siehe Kommentar oben): Netto≥6h ⇔ Brutto≥6h30 (390) → 30,
  // Netto≥9h ⇔ Brutto≥9h45 (585) → 45. Das ist die EXAKTE Umkehrung des Einbackens in
  // data.js/firebase.js. (Früher fälschlich 540/360 → 8h45-Tage wurden 15 Min zu niedrig
  // gezählt.) ktmin wird – wie beim Einbacken – mitgerechnet. Neue/bearbeitete Tage haben
  // _pInit und laufen oben über den exakt getrackten Wert (dort: Kleinteilig ohne Pause).
  const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
  const required=gross>=585?45:gross>=390?30:0;
  const gap=(dd.b1bis&&dd.b2von)?diffMin(dd.b1bis,dd.b2von):0;
  return Math.max(0,required-gap);
}

export function dayMinutes(dd,user){
  if(!dd) return 0;
  const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
  const isAbs=_isAbsDay(dd);
  const net=isAbs?gross:Math.max(0,gross-autoPauseMin(dd,user));
  if(net<=0) return 0;
  // Identisch zur Zeiterfassungs-Ansicht: Arbeitstage auf 15-Min-Raster.
  // Kein 10h-Cap mehr – die echte Arbeitszeit zählt voll (Tage >10h werden in der
  // Ansicht rot markiert, aber nicht mehr gekappt/übertragen).
  return isAbs?net:Math.round(net/15)*15;
}
export function monthIST(entry,user){
  if(!entry||!entry.days) return 0;
  return Object.values(entry.days).reduce((s,dd)=>s+dayMinutes(dd,user),0);
}
export function dailyMinutes(user){ return Math.round((user.wh||0)/((user.dpw||5))*60); }
export function isVollzeit(user){ return !isFreelancer(user)&&(user.wh||0)>=39; }
// Stunden pro Urlaubstag (in Minuten):
//  - expliziter Admin-Wert (vacHoursPerDay) hat Vorrang;
//  - Vollzeit ODER Leitung: wie gewohnt (Tagessoll aus wh/dpw);
//  - alle anderen (Teilzeit): pauschal 8h – Arbeitstage/Woche (dpw) spielen für Urlaub keine Rolle.
export function vacDailyMin(user){
  if(!user) return 480;
  if(user.vacHoursPerDay) return Math.round(user.vacHoursPerDay*60);
  if(isVollzeit(user)||user.role==='leitung') return dailyMinutes(user)||480;
  return 480;
}
export function _isAZADay(dd){ return !!(dd&&(dd.b1zuord==='Arbeitszeitausgleich'||dd.b1bem==='Arbeitszeitausgleich')); }

// Historische Parameter: liefert den User mit den Werten, die im Monat (y,m) GALTEN.
// user.paramHistory=[{fromDate:'YYYY-MM-DD', wh,dpw,al,vacHoursPerDay,role,sollWorkdays,holidaysLikeSunday,bundesland,maxHours}]
// Ohne Historie (oder Monat vor dem ersten Eintrag → frühester Eintrag) wird der aktuelle User
// zurückgegeben. So rechnen vergangene Monate mit den DAMALIGEN Werten statt rückwirkend mit den heutigen.
export const _PARAM_KEYS=['wh','dpw','al','vacHoursPerDay','role','sollWorkdays','holidaysLikeSunday','bundesland','maxHours'];
export function effUserAt(user,y,m){
  const hist=user&&Array.isArray(user.paramHistory)?user.paramHistory:null;
  if(!hist||!hist.length||!y||!m) return user;
  const key=`${y}-${String(m).padStart(2,'0')}-01`;
  let best=null;
  for(const h of hist){ if(h&&h.fromDate&&h.fromDate<=key&&(!best||h.fromDate>best.fromDate)) best=h; }
  if(!best){ for(const h of hist){ if(h&&h.fromDate&&(!best||h.fromDate<best.fromDate)) best=h; } } // vor 1. Eintrag → frühester
  if(!best) return user;
  const clone=Object.assign({},user);
  _PARAM_KEYS.forEach(k=>{ if(best[k]!==undefined) clone[k]=best[k]; });
  return clone;
}

// ── Beschäftigungszeitraum (Eintritt / Austritt) ─────────────────────────────────
// user.entryDate / user.exitDate = 'YYYY-MM-DD' (optional). Liefert die Tage (1..dim) des
// Monats, an denen die Person beschäftigt ist, oder null, wenn gar nicht.
export function employedRange(user,y,m){
  const dim=daysInMonth(y,m);
  const first=dateStr(y,m,1), last=dateStr(y,m,dim);
  const ent=user&&user.entryDate||'', ex=user&&user.exitDate||'';
  if(ent && ent>last) return null;
  if(ex && ex<first) return null;
  const from=(ent && ent>first)?Number(ent.slice(8,10)):1;
  const to=(ex && ex<last)?Number(ex.slice(8,10)):dim;
  return from<=to?{from,to,dim,full:from===1&&to===dim}:null;
}
// Monat (y,m) in den Beschäftigungszeitraum ziehen: vor dem Eintritt → Eintrittsmonat,
// nach dem Austritt → Austrittsmonat. Ohne Eintritt/Austritt unverändert.
export function clampToEmployment(user,y,m){
  const key=y*100+m;
  const ent=user&&user.entryDate, ex=user&&user.exitDate;
  if(ent){ const k=Number(ent.slice(0,4))*100+Number(ent.slice(5,7)); if(key<k) return {y:Math.floor(k/100),m:k%100,clamped:'entry'}; }
  if(ex){ const k=Number(ex.slice(0,4))*100+Number(ex.slice(5,7)); if(key>k) return {y:Math.floor(k/100),m:k%100,clamped:'exit'}; }
  return {y,m,clamped:null};
}
function _countWorkdays(user,y,m,from,to){
  const holFree=user.holidaysLikeSunday!==false; // Standard: Feiertage = kein SOLL
  const hols=getHolidays(y,user.bundesland||'');
  let n=0;
  for(let d=from;d<=to;d++){
    const ds=dateStr(y,m,d);
    const dw=new Date(y,m-1,d).getDay();
    if(dw!==0&&dw!==6&&(!holFree||!hols.has(ds))) n++;
  }
  return n;
}

// Jahres-Urlaubsanspruch (Tage) – ANTEILIG über die Monate: Summe(effUserAt(m).al / 12).
//  • unterjähriger Wechsel des Anspruchs (paramHistory): jeder Monat mit dem damals gültigen al.
//    Beispiel Claudia: Jan–Jun al=6 (→3) + Jul–Dez al=12 (→6) = 9.
//  • Eintritt/Austritt im Jahr: nur VOLLE Beschäftigungsmonate zählen (§ 5 BUrlG, 1/12 je vollem
//    Monat). Eintritt 01.10. → Okt–Dez = 3/12 des Jahresurlaubs.
// Ohne Historie und ohne Eintritt/Austritt = aktueller al (unverändertes Verhalten).
export function annualVacDays(user,y){
  if(!user) return 0;
  const hist=Array.isArray(user.paramHistory)?user.paramHistory:null;
  const hasEmp=!!(user.entryDate||user.exitDate);
  if((!hist||!hist.length)&&!hasEmp || !y) return Number(user.al||0);
  let total=0;
  for(let m=1;m<=12;m++){
    if(hasEmp){ const r=employedRange(user,y,m); if(!r||!r.full) continue; }
    total += Number(effUserAt(user,y,m).al||0)/12;
  }
  return Math.round(total*2)/2; // auf halbe Tage runden
}

export function monthSOLL(user,y,m){
  user=effUserAt(user,y,m);
  if(isFreelancer(user)) return 0;
  const wh=user.wh||0;
  // Vollzeit ODER per Schalter "arbeitstaggenau": echte Arbeitstage × Tagessoll.
  // Sonst (Teilzeit-Standard): pauschal 4 × Wochenarbeitszeit.
  const workdayBased=isVollzeit(user)||!!user.sollWorkdays;
  if(!y||!m) return wh*4*60;
  // Eintritt/Austritt: vor Eintritt bzw. nach Austritt kein Soll, im Wechselmonat anteilig.
  const r=employedRange(user,y,m);
  if(!r) return 0;
  if(!workdayBased){
    if(r.full) return wh*4*60;
    const wdAll=_countWorkdays(user,y,m,1,r.dim), wdEmp=_countWorkdays(user,y,m,r.from,r.to);
    return wdAll>0?Math.round(wh*4*60*wdEmp/wdAll):0;
  }
  return _countWorkdays(user,y,m,r.from,r.to)*dailyMinutes(user);
}

export function monthSOLLdays(user,y,m){
  user=effUserAt(user,y,m);
  if((!isVollzeit(user)&&!user.sollWorkdays)||!y||!m) return 0;
  const r=employedRange(user,y,m);
  return r?_countWorkdays(user,y,m,r.from,r.to):0;
}

// Wie monthSOLL, aber im LAUFENDEN Monat nur bis EINSCHLIESSLICH heute. Damit ziehen
// noch nicht gearbeitete Tage (Rest des Monats, geplante AZA/Freizeit) die laufende
// Über-/Unterstunden-Anzeige nicht vorab ins Minus. Abgeschlossene Monate: volles Soll.
// Zukünftige Monate: 0. Ändert NICHT den Übertrag – computeAutoCarry nutzt weiterhin das
// VOLLE Monats-Soll (monthSOLL) abgeschlossener Monate; dies ist reine Anzeige-Logik.
export function monthSOLLToDate(user,y,m){
  user=effUserAt(user,y,m);
  if(isFreelancer(user)||!y||!m) return monthSOLL(user,y,m);
  const now=new Date(); const cy=now.getFullYear(), cm=now.getMonth()+1, cd=now.getDate();
  if(y<cy||(y===cy&&m<cm)) return monthSOLL(user,y,m); // Vergangenheit → volles Soll
  if(y>cy||(y===cy&&m>cm)) return 0;                   // Zukunft → noch kein Soll fällig
  const r=employedRange(user,y,m); if(!r) return 0;   // vor Eintritt / nach Austritt
  const upto=Math.min(cd,r.to);
  if(upto<r.from) return 0;
  const countWd=(from,to)=>_countWorkdays(user,y,m,from,to);
  if(isVollzeit(user)||user.sollWorkdays){
    return countWd(r.from,upto)*dailyMinutes(user); // arbeitstaggenau bis heute
  }
  // Teilzeit-Pauschal (4×Wochenarbeitszeit): anteilig nach vergangenen Wochentagen
  // (monthSOLL ist bei Ein-/Austritt schon auf den Beschäftigungszeitraum gekürzt).
  const wdF=countWd(r.from,r.to); const wdT=countWd(r.from,upto);
  return wdF>0?Math.round(monthSOLL(user,y,m)*wdT/wdF):0;
}

export function computeAutoCarry(uid,user,y,m,_d){
  _d=_d||0; if(_d>24) return 0;
  let py=y,pm=m-1; if(pm<1){pm=12;py--;}
  const pe=getEntry(uid,py,pm);
  const pu=effUserAt(user,py,pm); // Parameter, die im VORMONAT galten (Rolle/maxHours/SOLL)
  const pIST=monthIST(pe,pu);
  // Leerer Monat (noch nicht erfasst, kein manueller Übertrag): aufgelaufenen Saldo
  // UNVERÄNDERT durchreichen statt auf 0 zu setzen – sonst geht der Übertrag bei einer
  // Lücke zwischen erfassten Monaten verloren. (Leere Monate sind in monthIST sehr günstig.)
  if(pIST===0&&!pe.carryoverManual) return computeAutoCarry(uid,user,py,pm,_d+1);
  const pCarryH=pe.carryoverManual?(pe.carryover||0):computeAutoCarry(uid,user,py,pm,_d+1);
  const pCarryMin=Math.round(pCarryH*60); // Vormonats-Übertrag minutengenau (kein Float-Drift)
  if(isFreelancer(pu)){
    const maxH=pu.maxHours||0;
    if(maxH<=0) return 0;
    const total=pIST+pCarryMin;
    return Math.max(0,total-maxH*60)/60; // minutengenau – KEINE Viertelstunden-Rundung
  } else {
    const pSOLL=monthSOLL(pu,py,pm);
    const pDiff=pIST-pSOLL+pCarryMin;
    return pDiff/60; // minutengenau – KEINE Viertelstunden-Rundung
  }
}

export function getEffectiveCarryH(uid,user,y,m){
  const e=getEntry(uid,y,m);
  return e.carryoverManual?(e.carryover||0):computeAutoCarry(uid,user,y,m);
}

export function countZuord(entry,val){
  if(!entry||!entry.days) return 0;
  return Object.values(entry.days).filter(dd=>(dd.b1zuord||'')=== val).length;
}

export function vacDays(entry){
  if(!entry||!entry.days) return 0;
  return Object.values(entry.days).reduce((s,dd)=>{
    if((dd.b1zuord||'')==='Urlaub') return s+(dd.halfDay?0.5:1);
    return s;
  },0);
}

export function sickDays(entry){ return countZuord(entry,'AU/Krank'); }

export function totalVacUsed(uid,y){
  let used=0;
  for(let m=1;m<=12;m++){ const e=getEntry(uid,y,m); used+=vacDays(e); }
  return used;
}

// ── Resturlaub Vorjahr (Hausregel TPS) ─────────────────────────────
// Urlaub ist im selben Jahr zu nehmen; nicht genommene Tage dürfen noch im JANUAR des
// Folgejahres genommen werden („Resturlaub Vorjahr") und verfallen danach.
// Urlaub im Januar wird ZUERST vom Vorjahresrest abgezogen, erst danach vom neuen Anspruch.
// Gilt ab dem Übertrag 2026 → 2027 (VAC_CARRY_FROM); frühere Jahre bleiben unverändert.
export const VAC_CARRY_FROM=2027;
function _hasYearData(uid,y){
  for(let m=1;m<=12;m++){ const e=getEntry(uid,y,m); if(e&&e.days&&Object.keys(e.days).length) return true; }
  return false;
}
// Übertrag ins Jahr y (Tage, ≥ 0). Ohne Erfassung im Vorjahr kein Übertrag (sonst wäre der
// komplette Vorjahresanspruch „Rest").
export function vacCarryIn(uid,user,y,_d){
  _d=_d||0;
  if(!user||!y||y<VAC_CARRY_FROM||_d>5) return 0;
  const py=y-1;
  if(!_hasYearData(uid,py)) return 0;
  const pCarry=vacCarryIn(uid,user,py,_d+1);
  const pCarryUsed=Math.min(pCarry, vacDays(getEntry(uid,py,1)));
  const pUsedAnnual=totalVacUsed(uid,py)-pCarryUsed;
  return Math.max(0, annualVacDays(user,py)-pUsedAnnual);
}
// Urlaubsstand eines Jahres bis einschließlich Monat upToM – eine Quelle für alle Anzeigen.
//  annual   Jahresanspruch (anteilig)       carry      Resturlaub Vorjahr (nur im Januar nutzbar)
//  usedUpTo gegen den Jahresanspruch bis upToM   left  Resturlaub aus dem Jahresanspruch
//  carryLeft noch offener Vorjahresrest (nur Januar)   future  schon gebuchter späterer Urlaub
//  unbooked  noch nicht beantragter Anspruch
export function vacStatus(uid,user,y,upToM){
  const annual=annualVacDays(user,y);
  const carry=vacCarryIn(uid,user,y);
  const jan=vacDays(getEntry(uid,y,1));
  const carryUsed=Math.min(carry,jan);
  const usedUpTo=vacUsedUpToMonth(uid,y,upToM)-carryUsed;
  const usedYear=totalVacUsed(uid,y)-carryUsed;
  return {
    annual, carry, carryUsed,
    carryLeft: upToM<=1 ? Math.max(0,carry-jan) : 0,
    carryExpired: upToM>1 ? Math.max(0,carry-carryUsed) : 0,
    usedUpTo, usedYear,
    left: annual-usedUpTo,
    future: Math.max(0,usedYear-usedUpTo),
    unbooked: Math.max(0,annual-usedYear),
  };
}

// Urlaub bis einschließlich Monat upToM (für monatsweisen Resturlaub).
// Zukünftig genehmigter Urlaub zählt erst im jeweiligen Monat.
export function vacUsedUpToMonth(uid,y,upToM){
  let used=0;
  for(let m=1;m<=upToM;m++){ used+=vacDays(getEntry(uid,y,m)); }
  return used;
}

export function normZuord(z){
  if(!z) return z;
  if(/^(Ö-Arbeit|Öffentlichkeitsarbeit|Marketing\s*[\/&]\s*Öffentlichkeitsarbeit|Marketing\s*%2F\s*Öffentlichkeitsarbeit)$/i.test(z))
    return 'Marketing & Öffentlichkeitsarbeit';
  return z;
}

export function zuordBreakdown(entry){
  const map={};
  if(!entry||!entry.days) return map;
  Object.values(entry.days).forEach(dd=>{
    const m1=diffMin(dd.b1von||'',dd.b1bis||'');
    const m2=diffMin(dd.b2von||'',dd.b2bis||'');
    const mk=Number(dd.ktmin||0);
    const add=(key,min)=>{ if(key&&min>0){ const nk=normZuord(key); map[nk]=(map[nk]||0)+min; } };
    add(dd.b1zuord,m1); add(dd.b2zuord,m2); add(dd.ktzuord,mk);
  });
  return map;
}

export function buildZuordPivot(uid,y){
  const d=getData();
  const yearMap={};
  for(let m=1;m<=12;m++){
    const map=zuordBreakdown(d.entries[entryKey(uid,y,m)]||{});
    Object.entries(map).forEach(([cat,min])=>{
      if(!yearMap[cat]) yearMap[cat]={};
      yearMap[cat][m]=(yearMap[cat][m]||0)+min;
    });
  }
  const allCats=Object.keys(yearMap).sort((a,b)=>{
    const ta=Object.values(yearMap[a]).reduce((x,v)=>x+v,0);
    const tb=Object.values(yearMap[b]).reduce((x,v)=>x+v,0);
    return tb-ta;
  });
  return {yearMap,allCats};
}
