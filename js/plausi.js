// ══════════════════════════════════════════════════════════════════
//  Plausibilitätsprüfungen der Zeiterfassung
//   • überlappende Zeitblöcke (Block 1 / Block 2 am selben Tag)
//   • Ruhezeit < 11 h zwischen Arbeitsende und Arbeitsbeginn am Folgetag (§ 5 ArbZG)
//   • mehr als 10 h Arbeitszeit am Tag (§ 3 ArbZG) – für die Einreichen-Prüfung
//   • vergessenes Ausstempeln (laufender Stempel seit einem früheren Tag bzw. > 12 h)
//  Reine Hinweise: nichts wird blockiert oder verändert.
//  Freiberufliche fallen nicht unter das ArbZG → nur die Überlappung (Datenfehler) wird geprüft.
// ══════════════════════════════════════════════════════════════════
import { getData, entryKey } from './data.js';
import { isFreelancer } from './roles.js';
import { autoPauseMin } from './calc.js';
import { diffMin, tMin, daysInMonth, dateStr, localISODate, dstDayAdj } from './utils.js';

const ABS = new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich','Veranstaltung AU']);
const REST_MIN = 11*60;

function _isAbs(dd){ return !!dd && (ABS.has(dd.b1zuord)||ABS.has(dd.b1bem)); }
function _blocks(dd){
  const out=[];
  if(dd&&dd.b1von&&dd.b1bis) out.push([tMin(dd.b1von), tMin(dd.b1bis)]);
  if(dd&&dd.b2von&&dd.b2bis) out.push([tMin(dd.b2von), tMin(dd.b2bis)]);
  // Ende vor Beginn = über Mitternacht → Ende am Folgetag
  return out.map(([a,b])=>[a, b<a ? b+1440 : b]);
}
function _fmtH(min){ return (Math.round(min/6)/10).toString().replace('.',',')+' h'; }
function _ddmm(ds){ return ds.slice(8,10)+'.'+ds.slice(5,7)+'.'; }
function _hhmm(min){ min=((min%1440)+1440)%1440; return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0'); }

// Tagesdaten ohne Seiteneffekte lesen (getEntry würde leere Einträge anlegen).
function _day(uid,ds){
  const y=Number(ds.slice(0,4)), m=Number(ds.slice(5,7));
  const e=getData().entries[entryKey(uid,y,m)];
  return (e&&e.days&&e.days[ds])||null;
}
function _prevDs(ds){ const d=new Date(ds+'T12:00:00'); d.setDate(d.getDate()-1); return localISODate(d); }

// Prüft einen Monat. Liefert { byDay: {ds:[{kind,text}]}, list:[{ds,kind,text}] }
export function checkMonth(uid, user, y, m){
  const byDay={}, list=[];
  const add=(ds,kind,text)=>{ (byDay[ds]=byDay[ds]||[]).push({kind,text}); list.push({ds,kind,text}); };
  if(!user) return {byDay,list};
  const free=isFreelancer(user);
  const dim=daysInMonth(y,m);
  for(let d=1; d<=dim; d++){
    const ds=dateStr(y,m,d), dd=_day(uid,ds);
    if(!dd) continue;
    const bl=_blocks(dd);
    // 1) Überlappung von Block 1 und Block 2
    if(bl.length===2){
      const [a,b]=bl; const s=Math.max(a[0],b[0]), e=Math.min(a[1],b[1]);
      if(s<e) add(ds,'overlap',`Zeitblöcke überschneiden sich (${dd.b1von}–${dd.b1bis} und ${dd.b2von}–${dd.b2bis})`);
    }
    if(free||_isAbs(dd)) continue;
    // 2) > 10 h Arbeitszeit (netto nach Pflichtpause, wie in der Tabelle)
    const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0)+dstDayAdj(dd,ds);
    const net=Math.max(0,gross-autoPauseMin(dd,user,ds));
    if(Math.round(net/15)*15>600) add(ds,'over10h',`Mehr als 10 h Arbeitszeit (${_fmtH(net)})`);
    // 3) Ruhezeit zum Vortag
    if(!bl.length) continue;
    const pds=_prevDs(ds), pd=_day(uid,pds);
    if(!pd||_isAbs(pd)) continue;
    const pbl=_blocks(pd); if(!pbl.length) continue;
    const prevEnd=Math.max(...pbl.map(b=>b[1]));        // Minuten ab 0:00 des Vortags (ggf. > 1440)
    const start=Math.min(...bl.map(b=>b[0]));            // Minuten ab 0:00 dieses Tags
    // Nachtschicht-Fortsetzung (Vortag bis 23:59/24:00, heute ab 00:00) ist keine Ruhezeit-Lücke.
    if(prevEnd>=1439 && start===0) continue;
    const rest=(1440-prevEnd)+start;
    if(rest>=0 && rest<REST_MIN) add(ds,'rest',`Ruhezeit nur ${_fmtH(rest)} (seit ${_ddmm(pds)} ${_hhmm(prevEnd)} Uhr, mind. 11 h)`);
  }
  return {byDay,list};
}

// Laufender Stempel, der vermutlich vergessen wurde: begonnen an einem früheren Tag
// oder seit mehr als 12 Stunden aktiv. Liefert Hinweistext oder ''.
export function forgottenStampText(uid){
  const st=(getData().stamps||{})[uid];
  if(!st||!st.startTime) return '';
  const start=new Date(st.startTime); if(isNaN(start)) return '';
  const hours=(Date.now()-start.getTime())/3600000;
  const sd=st.startDate||localISODate(start);
  if(sd<localISODate() || hours>12){
    return `Stempel läuft seit ${_ddmm(sd)} ${st.von||_hhmm(start.getHours()*60+start.getMinutes())} Uhr (${Math.floor(hours)} h) – vergessen auszustempeln?`;
  }
  return '';
}

// Zusammenfassung für die Einreichen-Prüfung.
export function submitWarnings(uid,user,y,m){
  const {list}=checkMonth(uid,user,y,m);
  const out=list.map(w=>`${_ddmm(w.ds)}: ${w.text}`);
  const fs=forgottenStampText(uid); if(fs) out.unshift(fs);
  return out;
}
