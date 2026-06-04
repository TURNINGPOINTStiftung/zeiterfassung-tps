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
  // Erfasste Pause zwischen Block 1 und 2 (Lücke) = bereits genommene Pause
  // → keine zusätzliche Pflichtpause. Nur durchgehende Blöcke werden bepaust.
  if(dd.b1bis&&dd.b2von&&diffMin(dd.b1bis,dd.b2von)>0) return 0;
  const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
  return gross>=585?45:gross>=390?30:0;
}

export function dayMinutes(dd,user){
  if(!dd) return 0;
  const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
  const isAbs=_isAbsDay(dd);
  const net=isAbs?gross:Math.max(0,gross-autoPauseMin(dd,user));
  if(net<=0) return 0;
  // Identisch zur Zeiterfassungs-Ansicht: Arbeitstage auf 15-Min-Raster, max 10h/Tag.
  // (Sonst weicht der Monats-/Übertragswert von der angezeigten Monatssumme ab.)
  return Math.min(isAbs?net:Math.round(net/15)*15,600);
}
export function monthIST(entry,user){
  if(!entry||!entry.days) return 0;
  return Object.values(entry.days).reduce((s,dd)=>s+dayMinutes(dd,user),0);
}
export function dailyMinutes(user){ return Math.round((user.wh||0)/((user.dpw||5))*60); }
export function isVollzeit(user){ return !isFreelancer(user)&&(user.wh||0)>=39; }
export function _isAZADay(dd){ return !!(dd&&(dd.b1zuord==='Arbeitszeitausgleich'||dd.b1bem==='Arbeitszeitausgleich')); }

export function monthSOLL(user,y,m){
  if(isFreelancer(user)) return 0;
  const wh=user.wh||0;
  if(!isVollzeit(user)||!y||!m) return wh*4*60;
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
  if(!isVollzeit(user)||!y||!m) return 0;
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

export function computeAutoCarry(uid,user,y,m,_d){
  _d=_d||0; if(_d>24) return 0;
  let py=y,pm=m-1; if(pm<1){pm=12;py--;}
  const pe=getEntry(uid,py,pm);
  const pIST=monthIST(pe,user);
  if(pIST===0&&!pe.carryoverManual) return 0;
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
