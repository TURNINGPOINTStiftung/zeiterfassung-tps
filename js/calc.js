import { diffMin, daysInMonth, dateStr, getHolidays } from './utils.js';
import { getData, getEntry, entryKey } from './data.js';
import { isFreelancer } from './roles.js';

const _ABS_CATS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
function _isAbsDay(dd){ return !!(dd&&(_ABS_CATS.has(dd.b1zuord)||_ABS_CATS.has(dd.b1bem))); }

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

export function monthSOLL(user,y,m){
  if(isFreelancer(user)) return 0;
  const wh=user.wh||0;
  // Vollzeit ODER per Schalter "arbeitstaggenau": echte Arbeitstage × Tagessoll.
  // Sonst (Teilzeit-Standard): pauschal 4 × Wochenarbeitszeit.
  const workdayBased=isVollzeit(user)||!!user.sollWorkdays;
  if(!workdayBased||!y||!m) return wh*4*60;
  const dailyMin=dailyMinutes(user);
  const dim=daysInMonth(y,m);
  const holFree=user.holidaysLikeSunday!==false; // Standard: Feiertage = kein SOLL
  const hols=getHolidays(y,user.bundesland||'');
  let workdays=0;
  for(let d=1;d<=dim;d++){
    const ds=dateStr(y,m,d);
    const dw=new Date(y,m-1,d).getDay();
    if(dw!==0&&dw!==6&&(!holFree||!hols.has(ds))) workdays++;
  }
  return workdays*dailyMin;
}

export function monthSOLLdays(user,y,m){
  if((!isVollzeit(user)&&!user.sollWorkdays)||!y||!m) return 0;
  const dim=daysInMonth(y,m);
  const holFree=user.holidaysLikeSunday!==false;
  const hols=getHolidays(y,user.bundesland||'');
  let workdays=0;
  for(let d=1;d<=dim;d++){
    const ds=dateStr(y,m,d);
    const dw=new Date(y,m-1,d).getDay();
    if(dw!==0&&dw!==6&&(!holFree||!hols.has(ds))) workdays++;
  }
  return workdays;
}

// Wie monthSOLL, aber im LAUFENDEN Monat nur bis EINSCHLIESSLICH heute. Damit ziehen
// noch nicht gearbeitete Tage (Rest des Monats, geplante AZA/Freizeit) die laufende
// Über-/Unterstunden-Anzeige nicht vorab ins Minus. Abgeschlossene Monate: volles Soll.
// Zukünftige Monate: 0. Ändert NICHT den Übertrag – computeAutoCarry nutzt weiterhin das
// VOLLE Monats-Soll (monthSOLL) abgeschlossener Monate; dies ist reine Anzeige-Logik.
export function monthSOLLToDate(user,y,m){
  if(isFreelancer(user)||!y||!m) return monthSOLL(user,y,m);
  const now=new Date(); const cy=now.getFullYear(), cm=now.getMonth()+1, cd=now.getDate();
  if(y<cy||(y===cy&&m<cm)) return monthSOLL(user,y,m); // Vergangenheit → volles Soll
  if(y>cy||(y===cy&&m>cm)) return 0;                   // Zukunft → noch kein Soll fällig
  const dim=daysInMonth(y,m); const upto=Math.min(cd,dim);
  const holFree=user.holidaysLikeSunday!==false;
  const hols=getHolidays(y,user.bundesland||'');
  const countWd=(from,to)=>{ let n=0; for(let d=from;d<=to;d++){ const ds=dateStr(y,m,d); const dw=new Date(y,m-1,d).getDay(); if(dw!==0&&dw!==6&&(!holFree||!hols.has(ds))) n++; } return n; };
  if(isVollzeit(user)||user.sollWorkdays){
    return countWd(1,upto)*dailyMinutes(user); // arbeitstaggenau bis heute
  }
  // Teilzeit-Pauschal (4×Wochenarbeitszeit): anteilig nach vergangenen Wochentagen.
  const wdF=countWd(1,dim); const wdT=countWd(1,upto);
  return wdF>0?Math.round(monthSOLL(user,y,m)*wdT/wdF):0;
}

export function computeAutoCarry(uid,user,y,m,_d){
  _d=_d||0; if(_d>24) return 0;
  let py=y,pm=m-1; if(pm<1){pm=12;py--;}
  const pe=getEntry(uid,py,pm);
  const pIST=monthIST(pe,user);
  // Leerer Monat (noch nicht erfasst, kein manueller Übertrag): aufgelaufenen Saldo
  // UNVERÄNDERT durchreichen statt auf 0 zu setzen – sonst geht der Übertrag bei einer
  // Lücke zwischen erfassten Monaten verloren. (Leere Monate sind in monthIST sehr günstig.)
  if(pIST===0&&!pe.carryoverManual) return computeAutoCarry(uid,user,py,pm,_d+1);
  const pCarryH=pe.carryoverManual?(pe.carryover||0):computeAutoCarry(uid,user,py,pm,_d+1);
  const pCarryMin=Math.round(pCarryH*60); // Vormonats-Übertrag minutengenau (kein Float-Drift)
  if(isFreelancer(user)){
    const maxH=user.maxHours||0;
    if(maxH<=0) return 0;
    const total=pIST+pCarryMin;
    return Math.max(0,total-maxH*60)/60; // minutengenau – KEINE Viertelstunden-Rundung
  } else {
    const pSOLL=monthSOLL(user,py,pm);
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
