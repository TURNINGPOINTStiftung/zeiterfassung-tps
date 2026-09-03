// ══════════════════════════════════════════════════════════════════
//  Kalender-Modul (eigener ☰-Pfad, isoliert – wie ki.js)
//  „Leitstand": CRM-Veranstaltungen gegen die Abwesenheiten aller Mitarbeiter,
//  damit auf einen Blick sichtbar ist, was passt und was kollidiert.
//  Tabs: Woche · Monat · Jahr · Konflikte. Reine LESE-Ansicht (ändert nichts).
//  Datenquellen: getData().vacRequests (approved, Typ Urlaub/AU-Krank/AZA)
//  + listVeranstaltungen() (CRM). Alles try/catch, self-registrierend.
// ══════════════════════════════════════════════════════════════════
import { getData } from '../data.js';
import { listVeranstaltungen, getCrm } from './crm-data.js';
const _RESERVED=new Set(['vorlagen','teamprojekte','access','config','verteiler','veranstaltungen','workflows']);

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Datum-Helfer (lokal, Mittag um TZ-Verschiebungen zu vermeiden) ──
const _pad=n=>String(n).padStart(2,'0');
const _iso=dt=>dt.getFullYear()+'-'+_pad(dt.getMonth()+1)+'-'+_pad(dt.getDate());
const _parse=s=>{ const[y,m,d]=String(s).split('-').map(Number); return new Date(y,(m||1)-1,d||1,12,0,0,0); };
const _addDays=(dt,n)=>{ const x=new Date(dt); x.setDate(x.getDate()+n); return x; };
const _daysInMonth=(y,m)=>new Date(y,m,0).getDate();               // m = 1..12
const _dowMon=dt=>((dt.getDay()+6)%7);                              // 0=Mo .. 6=So
const _todayISO=()=>_iso(new Date());
const _deDate=iso=>{ const p=String(iso).split('-'); return p.length===3?(+p[2]+'.'+ +p[1]+'.'):iso; };
const _mondayOf=dt=>_addDays(dt,-_dowMon(dt));
const _isoWeek=dt=>{ const t=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate())); const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3); const ft=new Date(Date.UTC(t.getUTCFullYear(),0,4)); const fd=(ft.getUTCDay()+6)%7; ft.setUTCDate(ft.getUTCDate()-fd+3); return 1+Math.round((t-ft)/6048e5); };
const DOW=['Mo','Di','Mi','Do','Fr','Sa','So'];
const MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const MON_ABBR=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const overlap=(a1,b1,a2,b2)=>a1<=b2&&a2<=b1;   // ISO-Strings vergleichbar (YYYY-MM-DD)
// Events, die sich datumsmäßig überlappen, auf getrennte Spuren (Lanes) verteilen → Stapeln.
// Setzt e._lane und liefert die Anzahl belegter Spuren.
function _laneAssign(evs){ const lanes=[]; evs.slice().sort((a,b)=>String(a.von).localeCompare(String(b.von))).forEach(e=>{ let L=0; while(lanes[L]&&lanes[L].some(x=>overlap(x.von,x.bis,e.von,e.bis))) L++; if(!lanes[L]) lanes[L]=[]; lanes[L].push(e); e._lane=L; }); return lanes.length; }

// ── Abwesenheits-Typen ──
// Krankheit (AU) wird im Kalender BEWUSST NICHT gezeigt (sensibel, für alle sichtbar).
const AB={ 'Urlaub':{k:'u',c:'#2b8a5a',lbl:'Urlaub'}, 'Arbeitszeitausgleich':{k:'a',c:'#2f6f9f',lbl:'AZA'} };
const KMETA={u:AB['Urlaub'],a:AB['Arbeitszeitausgleich']};

// ── Zustand ──
let V='monat';                         // woche | monat | jahr | konflikt
let curTeam='';
const _now=new Date();
let curY=_now.getFullYear(), curM=_now.getMonth()+1;   // Monat
let weekStart=_mondayOf(_now);                          // Woche

// ── Daten sammeln (aus echten Quellen) ──
function _abs(){ const d=getData()||{}; const out=[]; const vr=d.vacRequests||{};
  Object.keys(vr).forEach(k=>{ const r=vr[k]; if(!r||r.status!=='approved') return; const m=AB[r.type]; if(!m||!r.startDate) return;
    out.push({emp:r.userId, type:m.k, von:r.startDate, bis:r.endDate||r.startDate, half:!!r.halfDay, note:r.note||''}); });
  return out; }
function _events(){ let vs=[]; try{ vs=listVeranstaltungen()||[]; }catch(e){}
  return vs.filter(v=>v&&v.start).map(v=>({id:v.id||'', titel:v.titel||'(Veranstaltung)', typ:'va', von:v.start, bis:v.ende||v.start, uhr:v.uhrzeit||'', mitarbeiter:Array.isArray(v.mitarbeiter)?v.mitarbeiter:[]})); }
// CRM-Termine (auf Kontakten: e.termine) einsammeln – über alle Bäume/Einträge.
function _termine(){ const out=[]; try{
    const crm=getCrm()||{};
    Object.keys(crm).forEach(tk=>{ if(_RESERVED.has(tk)) return; const ents=crm[tk]; if(!ents||typeof ents!=='object') return;
      Object.keys(ents).forEach(eid=>{ const e=ents[eid]; const ts=(e&&e.termine)||[]; if(!Array.isArray(ts)) return;
        ts.forEach(t=>{ if(!t||!t.datum) return; out.push({ id:t.id||'', titel:t.titel||'(Termin)', typ:'termin', von:t.datum, bis:t.bis||t.datum, uhr:'', mitarbeiter:Array.isArray(t.mitarbeiter)?t.mitarbeiter:[], entity:(e.stamm&&e.stamm.name)||'', tree:tk, eid:eid }); });
      });
    });
  }catch(e){}
  return out; }
// Sprung zur Veranstaltung im passenden Modul (Projektmanagement bevorzugt, sonst CRM).
function kalOpenVeranstaltung(id){
  if(!id) return;
  try{
    // Veranstaltungen leben im Projektmanagement (kanban) → Standard-Ziel. Nur wenn der Nutzer
    // sicher KEIN kanban, aber CRM hat, ins CRM. crmModuleAccess NICHT als Sperre nutzen (kann
    // vor dem CRM-Laden „kein" liefern); nur als Hinweis. Das eigentliche Laden/Öffnen macht
    // switchModule → renderKanban → ensureCrmReady → paint.
    let target='kanban';
    try{ const ma=window.crmModuleAccess&&window.crmModuleAccess(window.cu); if(ma && (!ma.kanban||ma.kanban==='kein') && ma.crm && ma.crm!=='kein') target='crm'; }catch(e){}
    // NUR den Ziel-Zustand setzen (nicht sofort malen – CRM ist evtl. noch nicht geladen und
    // würde die Auswahl zurücksetzen). Der asynchrone Board-Aufbau nach dem Moduswechsel
    // (ensureCrmReady → paint) sieht _crmMode='veranstaltungen' + _crmVaSel und öffnet sie direkt.
    window._crmSearch=''; window._crmVaReturn=null;
    window._crmMode='veranstaltungen'; window._crmVaSel=id;
    if(window.switchModule) window.switchModule(target);
  }catch(e){ console.error('kalOpenVeranstaltung:',e); }
}
// Sprung zu einem CRM-Termin: Kontakt öffnen und den Termin direkt aufklappen
// (Infos ansehen; Leitung/GF kann dort Mitarbeiter zuweisen).
function kalOpenTermin(tree,eid,tid){
  if(!tree||!eid) return;
  try{
    window._crmSearch=''; window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; window._crmProjSel='';
    window._crmDetailTab='aufgaben'; window._crmOpenTerminId=tid||'';
    if(window.switchModule) window.switchModule('crm');
  }catch(e){ console.error('kalOpenTermin:',e); }
}
// Klick-Attribute für einen Eintrag: Veranstaltung → Detail, Termin → Kontakt+Termin.
function _clk(it){
  if(it.typ==='va' && it.id) return { cls:' kal-clickable', on:' onclick="kalOpenVeranstaltung(\''+esc(it.id)+'\')"' };
  if(it.typ==='termin' && it.tree && it.eid) return { cls:' kal-clickable', on:' onclick="kalOpenTermin(\''+esc(it.tree)+'\',\''+esc(it.eid)+'\',\''+esc(it.id)+'\')"' };
  return { cls:'', on:'' };
}
// Einmaliges Mouseover-Tooltip (funktioniert auch bei winzigen Jahres-Markern).
let _tipEl=null;
function _tip(){ if(_tipEl) return _tipEl; _tipEl=document.createElement('div'); _tipEl.className='kal-tip'; document.body.appendChild(_tipEl); return _tipEl; }
function _bindTips(root){
  if(root._tipsBound) return; root._tipsBound=true;
  root.addEventListener('mouseover', e=>{ const t=e.target.closest('[data-tip]'); if(!t) return; const el=_tip(); el.textContent=t.getAttribute('data-tip'); el.style.display='block'; });
  root.addEventListener('mousemove', e=>{ if(!_tipEl||_tipEl.style.display==='none') return; const pad=14, w=_tipEl.offsetWidth, h=_tipEl.offsetHeight; let x=e.clientX+pad, y=e.clientY+pad; if(x+w>window.innerWidth) x=e.clientX-w-pad; if(y+h>window.innerHeight) y=e.clientY-h-pad; _tipEl.style.left=Math.max(4,x)+'px'; _tipEl.style.top=Math.max(4,y)+'px'; });
  root.addEventListener('mouseout', e=>{ if(e.target.closest('[data-tip]')&&_tipEl) _tipEl.style.display='none'; });
}
// Wer erscheint im Kalender: interne Mitarbeiter. Raus fliegen nur Admin und EXTERNE
// „nur CRM"-Nutzer (crmOnly). Die GF (noTimesheet = keine EIGENE Zeiterfassung) bleibt
// bewusst drin – sie nimmt Urlaub/Abwesenheiten, die für die Planung relevant sind.
function _emps(){ const d=getData()||{}; return (d.users||[]).filter(u=>u&&u.id&&u.id!=='admin'&&u.role!=='admin'&&!u.crmOnly); }
function _teamOf(u){ return u.team || (Array.isArray(u.teams)&&u.teams[0]) || '—'; }
function _teamsOrdered(emps){ const seen=[]; emps.forEach(u=>{ const t=_teamOf(u); if(!seen.includes(t)) seen.push(t); }); return seen; }
function empName(id){ const d=getData()||{}; const u=(d.users||[]).find(x=>x&&x.id===id); return u?u.name:id; }
function empTeamById(id){ const d=getData()||{}; const u=(d.users||[]).find(x=>x&&x.id===id); return u?_teamOf(u):''; }

// ── Styles (scoped auf #kalender-root) ──
function _styles(){ if(document.getElementById('kal-styles')) return;
  const el=document.createElement('style'); el.id='kal-styles';
  el.textContent=`
  #kalender-root{flex:1;min-height:0;overflow:auto;background:var(--bg,#eef2f7);padding:18px 18px 60px}
  .kal-wrap{max-width:none;margin:0;width:100%}
  .kal-h{font-family:var(--ci-serif,Georgia,serif);font-size:1.5rem;font-weight:800;color:var(--text,#15263a);margin:0 0 2px}
  .kal-sub{color:var(--muted,#5d7086);font-size:.9rem;margin:0 0 16px;max-width:70ch;line-height:1.5}
  .kal-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px}
  .kal-seg{display:inline-flex;border:1.5px solid var(--border,#c3cedb);border-radius:9px;overflow:hidden}
  .kal-seg button{appearance:none;border:none;background:var(--white,#fff);color:var(--muted,#5d7086);font:inherit;font-weight:600;font-size:.86rem;padding:7px 13px;cursor:pointer;border-left:1.5px solid var(--border,#c3cedb)}
  .kal-seg button:first-child{border-left:none} .kal-seg button.on{background:var(--primary,#1a3a5c);color:#fff}
  .kal-nav{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:1rem;color:var(--text,#15263a);min-width:190px}
  .kal-nav button{width:30px;height:30px;border-radius:8px;border:1.5px solid var(--border,#c3cedb);background:var(--white,#fff);color:var(--text,#15263a);cursor:pointer}
  .kal-today{padding:7px 12px;border:1.5px solid var(--border,#c3cedb);border-radius:9px;background:var(--white,#fff);color:var(--text,#15263a);font:inherit;font-weight:600;font-size:.84rem;cursor:pointer}
  .kal-sel{font:inherit;font-size:.86rem;padding:7px 10px;border:1.5px solid var(--border,#c3cedb);border-radius:9px;background:var(--white,#fff);color:var(--text,#15263a)}
  .kal-spacer{flex:1}
  .kal-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.8rem;color:var(--muted,#5d7086);margin:0 0 12px}
  .kal-lg{display:inline-flex;align-items:center;gap:6px} .kal-sw{width:12px;height:12px;border-radius:3px;display:inline-block}
  .kal-board{background:var(--white,#fff);border:1px solid var(--border,#dce3ec);border-radius:12px;box-shadow:0 1px 3px rgba(32,56,105,.06);overflow:hidden}
  .kal-scroll{overflow-x:auto}
  .kal-grid{display:block}
  .kal-row{display:grid;align-items:stretch;border-bottom:1px solid var(--border,#dce3ec)}
  .kal-name{position:sticky;left:0;z-index:3;background:var(--white,#fff);border-right:2px solid var(--border,#c3cedb);padding:0 10px;display:flex;align-items:center;font-weight:600;font-size:.84rem;grid-column:1;grid-row:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kal-head{position:sticky;top:0;z-index:5;background:var(--primary,#1a3a5c);color:#fff}
  .kal-head .kal-name{background:var(--primary,#1a3a5c);color:#fff;border-right-color:rgba(255,255,255,.25);z-index:6}
  .kal-dh{grid-row:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 0;border-right:1px solid rgba(255,255,255,.14);font-size:.72rem;line-height:1.15}
  .kal-dh .dow{opacity:.75;font-size:.62rem;text-transform:uppercase} .kal-dh .dn{font-weight:700;font-size:.84rem}
  .kal-dh.we{background:rgba(0,0,0,.16)} .kal-mh{grid-row:1;display:flex;align-items:center;justify-content:center;padding:6px 0;border-right:1px solid rgba(255,255,255,.16);font-size:.74rem;font-weight:700}
  .kal-teamrow{background:var(--row-alt,#f4f7fb);border-bottom:1px solid var(--border,#dce3ec);padding:5px 12px;font-size:.66rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#5d7086);position:sticky;left:0;z-index:2}
  .kal-cell{grid-row:1;border-right:1px solid var(--border,#e6ebf2);min-height:32px;position:relative} .kal-cell.we{background:#eef1f5} .kal-cell.today{background:#fff3e0}
  .kal-cell.cf{background:rgba(240,169,46,.14)}
  .kal-cell.mon{border-left:2px solid rgba(120,140,170,.32)}
  .kal-dh.mon{border-left:2px solid rgba(255,255,255,.32)}
  .kal-kw{font-size:8px;font-weight:700;letter-spacing:.02em;opacity:.85;line-height:1;margin-bottom:1px}
  .kal-bar-seg{grid-row:1;align-self:stretch;margin:4px 3px 4px 0;border-radius:5px;display:flex;align-items:center;padding:0 6px;font-size:.7rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;z-index:2;box-shadow:0 1px 2px rgba(0,0,0,.16)}
  .kal-track{grid-column:2 / -1;grid-row:1;position:relative;min-height:32px}
  .kal-seg-abs{position:absolute;top:3px;height:18px;border-radius:4px;min-width:3px;display:flex;align-items:center;padding:0 5px;font-size:.68rem;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;z-index:2;box-shadow:0 1px 2px rgba(0,0,0,.16)}
  .kal-ev{align-self:stretch;margin:2px 3px;border-radius:5px;display:flex;align-items:center;gap:4px;padding:0 8px;font-size:.76rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .kal-evband .kal-cell{min-height:0}
  .kal-ev-mark{position:absolute;top:4px;height:20px;border-radius:4px;min-width:5px;display:flex;align-items:center;gap:4px;padding:0 6px;font-size:.7rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;z-index:2}
  .kal-ev.cf,.kal-ev-mark.cf{outline:2px solid #f0a92e;outline-offset:1px}
  .kal-wline{position:absolute;top:0;bottom:0;width:1px;background:rgba(120,140,170,.18);z-index:0}
  .kal-today-line{position:absolute;top:0;bottom:0;width:2px;background:#e8892b;z-index:4}
  .kal-kwrow{position:sticky;top:31px;z-index:4;background:var(--row-alt,#f4f7fb);border-bottom:1px solid var(--border,#dce3ec)}
  .kal-kwrow .kal-name{background:var(--row-alt,#f4f7fb);font-size:.66rem;color:var(--muted,#5d7086)}
  .kal-kwtrack{grid-column:2 / -1;grid-row:1;position:relative;min-height:18px}
  .kal-kwlab{position:absolute;top:3px;font-size:9px;font-weight:600;color:#8598ab;padding-left:2px}
  .kal-empty{padding:26px;text-align:center;color:var(--muted,#5d7086);font-size:.92rem}
  .kal-tip{position:fixed;z-index:99999;background:#15263a;color:#fff;font-size:12px;font-weight:600;padding:6px 9px;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.28);pointer-events:none;max-width:300px;white-space:normal;line-height:1.35;display:none}
  .kal-clickable{cursor:pointer} .kal-clickable:hover{filter:brightness(1.12)}
  .kal-termin{border:1.5px dashed rgba(255,255,255,.65)}
  .kal-asg{margin:2px;border-radius:4px;min-width:4px;z-index:1}
  .kal-asg.cf{outline:2px solid #f0a92e;outline-offset:-2px}
  .kal-yasg{position:absolute;border-radius:4px;min-width:3px;z-index:1}
  .kal-yasg.cf{outline:2px solid #f0a92e;outline-offset:-2px}
  .kal-row.kal-me{box-shadow:inset 0 0 0 2px rgba(18,179,71,.6);position:relative;z-index:1}
  .kal-name.kal-me{background:#eafbef;box-shadow:inset 3px 0 0 #12b347;font-weight:700}
  .kal-cf{padding:2px 0}
  .kal-cfitem{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--border,#dce3ec)} .kal-cfitem:last-child{border-bottom:none}
  .kal-cfdate{font-weight:700;font-size:.82rem;color:var(--primary,#1a3a5c);min-width:120px;padding-top:2px}
  .kal-cfmain{flex:1} .kal-cftitle{font-weight:700} .kal-cfsub{color:var(--muted,#5d7086);font-size:.85rem;margin-top:1px}
  .kal-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .kal-chip{font-size:.76rem;font-weight:600;padding:2px 9px;border-radius:999px;color:#fff}
  .kal-badge{font-size:.74rem;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;align-self:center}
  /* ── Persönliche Ansicht („Nur ich"): klassische Layouts ── */
  .kal-pm{display:flex;flex-direction:column}
  .kal-pm-head{display:grid;grid-template-columns:repeat(7,1fr);background:var(--primary,#1a3a5c);color:#fff;border-radius:8px 8px 0 0;overflow:hidden}
  .kal-pm-hc{padding:7px 9px;font-size:.8rem;font-weight:700;border-left:1px solid rgba(255,255,255,.14)}
  .kal-pm-hc:first-child{border-left:none} .kal-pm-hc.we{background:rgba(0,0,0,.16)}
  .kal-pm-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid var(--border,#dce3ec);border-top:none}
  .kal-pm-cell{min-height:94px;border-right:1px solid var(--border,#e6ebf2);border-bottom:1px solid var(--border,#e6ebf2);padding:4px 5px;overflow:hidden}
  .kal-pm-cell:nth-child(7n){border-right:none}
  .kal-pm-cell.we{background:#f7f9fc} .kal-pm-cell.out{background:#fafbfd} .kal-pm-cell.today{background:#fff3e0}
  .kal-pm-dn{font-size:.8rem;font-weight:700;color:var(--muted,#5d7086);margin-bottom:3px} .kal-pm-cell.out .kal-pm-dn{color:#c2ccd8} .kal-pm-cell.today .kal-pm-dn{color:#e8892b}
  .kal-pm-items{display:flex;flex-direction:column;gap:3px}
  .kal-pchip{font-size:.72rem;font-weight:600;padding:2px 6px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 1px rgba(0,0,0,.08)}
  .kal-pchip.kal-clickable{cursor:pointer} .kal-pchip.kal-clickable:hover{filter:brightness(1.07)}
  .kal-pabs{font-size:.72rem;font-weight:700;color:#fff;padding:2px 6px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kal-pw{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid var(--border,#dce3ec);border-radius:8px;overflow:hidden;min-height:440px}
  .kal-pw-col{border-left:1px solid var(--border,#e6ebf2);display:flex;flex-direction:column} .kal-pw-col:first-child{border-left:none}
  .kal-pw-col.we{background:#f7f9fc} .kal-pw-col.today{background:#fff8ef}
  .kal-pw-h{background:var(--row-alt,#f4f7fb);border-bottom:1px solid var(--border,#dce3ec);padding:8px;font-size:.82rem;font-weight:700;color:var(--text,#15263a);text-align:center}
  .kal-pw-col.today .kal-pw-h{color:#e8892b}
  .kal-pw-body{display:flex;flex-direction:column;gap:4px;padding:6px}
  .kal-py{display:grid;border:1px solid var(--border,#dce3ec);border-radius:8px;overflow:hidden;font-size:11px}
  .kal-py-corner{background:var(--primary,#1a3a5c)}
  .kal-py-mh{background:var(--primary,#1a3a5c);color:#fff;font-weight:700;text-align:center;padding:5px 0;border-left:1px solid rgba(255,255,255,.14)}
  .kal-py-dl{background:var(--row-alt,#f4f7fb);color:var(--muted,#5d7086);font-weight:700;text-align:center;padding:2px 0;border-top:1px solid var(--border,#eef2f7)}
  .kal-py-cell{min-height:15px;border-left:1px solid var(--border,#eef2f7);border-top:1px solid var(--border,#eef2f7);display:flex;align-items:center;justify-content:center;position:relative}
  .kal-py-cell.empty{background:#fafbfd} .kal-py-cell.today{outline:2px solid #e8892b;outline-offset:-2px;z-index:1}
  .kal-py-dot{width:7px;height:7px;border-radius:50%;display:inline-block;box-shadow:0 0 0 1px rgba(255,255,255,.6)}
  `;
  document.head.appendChild(el);
}

// ── Tag-Raster (Woche + Monat) ──
function _dayGrid(days){
  const emps=_emps(); if(!emps.length) return '<div class="kal-empty">Keine Mitarbeiter vorhanden.</div>';
  const abs=_abs(); const items=_events().concat(_termine()); const N=days.length;
  const myId=(window.cu&&window.cu.id)||'';
  const isoList=days.map(d=>d.iso);
  const cs='grid-template-columns:180px repeat('+N+',minmax(34px,1fr));';
  const cfSet=new Set();
  days.forEach(dd=>{ if(items.some(e=>overlap(e.von,e.bis,dd.iso,dd.iso))&&abs.some(a=>overlap(a.von,a.bis,dd.iso,dd.iso))) cfSet.add(dd.iso); });
  const colOf=iso=>{ const i=isoList.indexOf(iso); return i<0?-1:i+2; };
  const clampCols=(von,bis)=>{ let a=von<isoList[0]?isoList[0]:von, b=bis>isoList[N-1]?isoList[N-1]:bis; const ca=colOf(a), cb=colOf(b); if(ca<0||cb<0) return null; return [ca,cb]; };
  // Benannter Balken oben im Band „Veranstaltungen" (einmal je Eintrag – gilt für alle)
  const namedBar=(it)=>{ const cc=clampCols(it.von,it.bis); if(!cc) return '';
    const isVa=it.typ==='va'; const col=isVa?'#7b3fb3':'#0d8a8a'; const ic=isVa?'📅':'•';
    const tip=(isVa?'📅 ':'• ')+it.titel+(it.entity?(' · '+it.entity):'')+' · '+_deDate(it.von)+(it.bis!==it.von?('–'+_deDate(it.bis)):'')+(it.uhr?(' '+it.uhr):'');
    const c=_clk(it);
    return '<div class="kal-ev'+c.cls+(it.typ==='termin'?' kal-termin':'')+'" style="grid-column:'+cc[0]+' / '+(cc[1]+1)+';grid-row:'+(it._lane+1)+';background:'+col+'" data-tip="'+esc(tip)+'"'+c.on+'>'+ic+' '+esc(it.titel)+'</div>';
  };
  // Zuweisungs-Balken auf der Personenzeile: volle Zeilenhöhe, heller Ton, kein Text (Name steht oben)
  const asgBar=(it,rowAbs)=>{ const cc=clampCols(it.von,it.bis); if(!cc) return '';
    const isVa=it.typ==='va'; const col=isVa?'#bd9fd9':'#86c5c5';
    const cfl=(rowAbs||[]).some(a=>overlap(a.von,a.bis,it.von,it.bis));
    const tip=(isVa?'📅 ':'• ')+it.titel+(it.entity?(' · '+it.entity):'')+' · '+_deDate(it.von)+(it.bis!==it.von?('–'+_deDate(it.bis)):'');
    const c=_clk(it);
    return '<div class="kal-asg'+(cfl?' cf':'')+c.cls+'" style="grid-column:'+cc[0]+' / '+(cc[1]+1)+';grid-row:1 / -1;background:'+col+'" data-tip="'+esc(tip)+'"'+c.on+'></div>';
  };
  let h='<div class="kal-grid" style="min-width:'+(180+N*34)+'px">';
  // Kopf
  h+='<div class="kal-row kal-head" style="'+cs+'"><div class="kal-name">Mitarbeiter</div>';
  days.forEach((dd,i)=>{ const isMon=dd.dow===0; const kw=(isMon||i===0)?_isoWeek(_parse(dd.iso)):null; h+='<div class="kal-dh'+(dd.we?' we':'')+(isMon?' mon':'')+'" style="grid-column:'+(i+2)+'">'+(kw!=null?'<span class="kal-kw">KW'+kw+'</span>':'')+'<span class="dow">'+DOW[dd.dow]+'</span><span class="dn">'+dd.dom+'</span></div>'; });
  h+='</div>';
  // Band = ALLE Veranstaltungen/Termine, benannt (die „für alle" gültige Zeile)
  if(items.length){
    const laneN=Math.max(1,_laneAssign(items));
    const laneH=laneN===1?32:(laneN===2?27:23);
    h+='<div class="kal-row kal-evband" style="'+cs+'grid-auto-rows:'+laneH+'px"><div class="kal-name" style="color:#7b3fb3;grid-row:1 / span '+laneN+'">Veranstaltungen</div>';
    days.forEach((dd,i)=>{ h+='<div class="kal-cell'+(dd.we?' we':'')+(dd.dow===0?' mon':'')+(cfSet.has(dd.iso)?' cf':'')+'" style="grid-column:'+(i+2)+';grid-row:1 / span '+laneN+'"></div>'; });
    items.forEach(it=>{ h+=namedBar(it); });
    h+='</div>';
  }
  // Mitarbeiter nach Team – Abwesenheiten (voll) + schmale Zuweisungs-Marker
  _teamsOrdered(emps).forEach(t=>{
    if(curTeam&&t!==curTeam) return;
    h+='<div class="kal-teamrow">'+esc(t)+'</div>';
    emps.filter(u=>_teamOf(u)===t).forEach(u=>{
      const myAbs=abs.filter(a=>a.emp===u.id);
      const myAsg=items.filter(it=>(it.mitarbeiter||[]).indexOf(u.id)>=0);
      const absLanes=myAbs.length?_laneAssign(myAbs):0;
      const aRows=Math.max(absLanes,1);
      const laneH=(30/aRows).toFixed(2);   // alle Zeilen gleich hoch (30px); überlappende Abwesenheiten teilen sich die Höhe
      const rowsCss='grid-template-rows:repeat('+aRows+','+laneH+'px);';
      const isMe=u.id===myId;
      h+='<div class="kal-row'+(isMe?' kal-me':'')+'" style="'+cs+rowsCss+'"><div class="kal-name'+(isMe?' kal-me':'')+'" style="grid-row:1 / -1" title="'+esc(u.name)+'">'+esc(u.name)+'</div>';
      days.forEach((dd,i)=>{ h+='<div class="kal-cell'+(dd.we?' we':'')+(dd.today?' today':'')+(dd.dow===0?' mon':'')+(cfSet.has(dd.iso)?' cf':'')+'" style="grid-column:'+(i+2)+';grid-row:1 / -1"></div>'; });
      myAsg.forEach(it=>{ h+=asgBar(it, myAbs); });   // heller Balken (volle Höhe) zuerst – Abwesenheit liegt darüber
      myAbs.forEach(a=>{ const cc=clampCols(a.von,a.bis); if(!cc) return; const m=KMETA[a.type]; const wide=(cc[1]-cc[0])>=1; const tip=m.lbl+' · '+u.name+' · '+_deDate(a.von)+'–'+_deDate(a.bis)+(a.half?' (½ Tag)':''); h+='<div class="kal-bar-seg" style="grid-column:'+cc[0]+' / '+(cc[1]+1)+';grid-row:'+(a._lane+1)+';background:'+m.c+'" data-tip="'+esc(tip)+'">'+(wide?m.lbl:'')+'</div>'; });
      h+='</div>';
    });
  });
  h+='</div>';
  return h;
}

// ── Jahres-Raster (Monate + KW) ──
function _yearGrid(year){
  const emps=_emps(); if(!emps.length) return '<div class="kal-empty">Keine Mitarbeiter vorhanden.</div>';
  const abs=_abs(); const items=_events().concat(_termine());
  const myId=(window.cu&&window.cu.id)||'';
  const MD=[]; for(let m=1;m<=12;m++) MD.push(_daysInMonth(year,m));
  const YLEN=MD.reduce((s,x)=>s+x,0); const CUM=[0]; for(let i=0;i<12;i++) CUM.push(CUM[i]+MD[i]);
  const Y0=year+'-01-01', Y1=year+'-12-31';
  const doy=iso=>{ const[,m,d]=iso.split('-').map(Number); return CUM[m-1]+(d-1); };
  const leftPct=iso=>{ let x=iso<Y0?Y0:(iso>Y1?Y1:iso); return doy(x)/YLEN*100; };
  const spanPct=(v,b)=>{ let a=v<Y0?Y0:v, c=b>Y1?Y1:b; return (doy(c)-doy(a)+1)/YLEN*100; };
  const inYear=(v,b)=>overlap(v,b,Y0,Y1);
  const weeks=[]; { let dt=new Date(year,0,1,12); weeks.push({doy:0,kw:_isoWeek(dt)}); for(let dy=1;dy<YLEN;dy++){ const c=_addDays(new Date(year,0,1,12),dy); if(_dowMon(c)===0) weeks.push({doy:dy,kw:_isoWeek(c)}); } }
  const wlines=weeks.filter(w=>w.doy>0).map(w=>'<div class="kal-wline" style="left:'+(w.doy/YLEN*100)+'%"></div>').join('');
  const tISO=_todayISO(); const todayLine=(tISO>=Y0&&tISO<=Y1)?'<div class="kal-today-line" style="left:'+leftPct(tISO)+'%"></div>':'';
  const cs='grid-template-columns:180px '+MD.map(d=>d+'fr').join(' ')+';';
  const mcells=()=>{ let s=''; for(let i=0;i<12;i++) s+='<div class="kal-cell" style="grid-column:'+(i+2)+';border-right:1px solid var(--border,#c3cedb)"></div>'; return s; };
  const mH=22;
  // benannter Marker oben im Band „Veranstaltungen"
  const namedMark=(it)=>{ const isVa=it.typ==='va'; const col=isVa?'#7b3fb3':'#0d8a8a'; const w=spanPct(it.von,it.bis);
    const tip=(isVa?'📅 ':'• ')+it.titel+(it.entity?(' · '+it.entity):'')+' · '+_deDate(it.von)+(it.bis!==it.von?('–'+_deDate(it.bis)):'')+(it.uhr?(' '+it.uhr):'');
    const c=_clk(it);
    return '<div class="kal-ev-mark'+c.cls+(it.typ==='termin'?' kal-termin':'')+'" style="left:'+leftPct(it.von)+'%;width:'+w+'%;top:'+(3+it._lane*mH)+'px;height:'+(mH-3)+'px;background:'+col+'" data-tip="'+esc(tip)+'"'+c.on+'>'+(isVa?'📅 ':'• ')+esc(it.titel)+'</div>';
  };
  // benannte Abwesenheit auf der Personenzeile
  const absMark=(a,nm,segH)=>{ const m=KMETA[a.type]; const w=spanPct(a.von,a.bis); const tip=m.lbl+' · '+nm+' · '+_deDate(a.von)+'–'+_deDate(a.bis); return '<div class="kal-seg-abs" style="left:'+leftPct(a.von)+'%;width:'+w+'%;top:'+(3+a._lane*segH)+'px;height:'+(segH-2)+'px;background:'+m.c+'" data-tip="'+esc(tip)+'">'+(w>2.5?m.lbl:'')+'</div>'; };
  // schmaler Zuweisungs-Marker (nur Farbe, kein Text)
  const asgMark=(it,rowH,rowAbs)=>{ const isVa=it.typ==='va'; const col=isVa?'#bd9fd9':'#86c5c5'; const w=spanPct(it.von,it.bis);
    const cfl=(rowAbs||[]).some(a=>overlap(a.von,a.bis,it.von,it.bis));
    const tip=(isVa?'📅 ':'• ')+it.titel+(it.entity?(' · '+it.entity):'')+' · '+_deDate(it.von)+(it.bis!==it.von?('–'+_deDate(it.bis)):'');
    const c=_clk(it);
    return '<div class="kal-yasg'+(cfl?' cf':'')+c.cls+'" style="left:'+leftPct(it.von)+'%;width:'+w+'%;top:3px;height:'+(rowH-6)+'px;background:'+col+'" data-tip="'+esc(tip)+'"'+c.on+'></div>';
  };
  let h='<div class="kal-grid" style="min-width:1500px">';
  h+='<div class="kal-row kal-head" style="'+cs+'"><div class="kal-name">Mitarbeiter · '+year+'</div>';
  for(let i=0;i<12;i++) h+='<div class="kal-mh" style="grid-column:'+(i+2)+'">'+MON_ABBR[i]+'</div>';
  h+='</div>';
  h+='<div class="kal-row kal-kwrow" style="'+cs+'"><div class="kal-name">KW</div><div class="kal-kwtrack">'+weeks.map(w=>'<div class="kal-kwlab" style="left:'+(w.doy/YLEN*100)+'%">'+w.kw+'</div>').join('')+'</div></div>';
  // Band = ALLE Events/Termine, benannt
  const yItems=items.filter(it=>inYear(it.von,it.bis));
  if(yItems.length){
    const bN=Math.max(1,_laneAssign(yItems));
    h+='<div class="kal-row" style="'+cs+'"><div class="kal-name" style="color:#7b3fb3">Veranstaltungen</div>'+mcells();
    h+='<div class="kal-track" style="min-height:'+(bN*mH+6)+'px">'+wlines+todayLine;
    yItems.forEach(it=>{ h+=namedMark(it); });
    h+='</div></div>';
  }
  // Mitarbeiter – Abwesenheiten (voll) + schmale Zuweisungs-Marker
  _teamsOrdered(emps).forEach(t=>{
    if(curTeam&&t!==curTeam) return;
    h+='<div class="kal-teamrow">'+esc(t)+'</div>';
    emps.filter(u=>_teamOf(u)===t).forEach(u=>{
      const myAbs=abs.filter(a=>a.emp===u.id&&inYear(a.von,a.bis));
      const myAsg=items.filter(it=>(it.mitarbeiter||[]).indexOf(u.id)>=0&&inYear(it.von,it.bis));
      const absLanes=myAbs.length?_laneAssign(myAbs):0;
      const aL=Math.max(absLanes,1);
      const rowH=30;                 // alle Zeilen gleich hoch
      const segH=(rowH-6)/aL;        // Abwesenheits-Spuren teilen sich die Höhe
      const isMe=u.id===myId;
      h+='<div class="kal-row'+(isMe?' kal-me':'')+'" style="'+cs+'"><div class="kal-name'+(isMe?' kal-me':'')+'" title="'+esc(u.name)+'">'+esc(u.name)+'</div>'+mcells();
      h+='<div class="kal-track" style="min-height:'+rowH+'px">'+wlines+todayLine;
      myAsg.forEach(it=>{ h+=asgMark(it, rowH, myAbs); });   // heller Balken volle Höhe (z1)
      myAbs.forEach(a=>{ h+=absMark(a, u.name, segH); });    // Abwesenheit darüber (z2)
      h+='</div></div>';
    });
  });
  h+='</div>';
  return h;
}

// ── Konflikte-Liste ──
function _conflictList(from,to){
  const zeIds=new Set(_emps().map(u=>u.id));   // nur Mitarbeiter mit Zeiterfassung
  const abs=_abs().filter(a=>zeIds.has(a.emp));
  const items=_events().concat(_termine()).filter(e=>overlap(e.von,e.bis,from,to)).sort((a,b)=>a.von<b.von?-1:1);
  if(!items.length) return '<div class="kal-empty">Keine Veranstaltungen oder Termine in diesem Zeitraum.</div>';
  const inTeam=id=>!curTeam||empTeamById(id)===curTeam;
  let h='<div class="kal-cf">';
  items.forEach(e=>{
    const ic=e.typ==='va'?'📅':'•';
    const assignedIds=(e.mitarbeiter||[]).filter(id=>zeIds.has(id)&&inTeam(id));
    let absentList, sub;
    if(assignedIds.length){
      absentList=abs.filter(a=>assignedIds.indexOf(a.emp)>=0 && overlap(a.von,a.bis,e.von,e.bis));
      sub=(assignedIds.length-absentList.length)+' von '+assignedIds.length+' zugewiesen verfügbar'+(absentList.length?(' · '+absentList.length+' abwesend'):'');
    } else {
      absentList=abs.filter(a=>overlap(a.von,a.bis,e.von,e.bis)&&inTeam(a.emp));
      sub=absentList.length?(absentList.length+' abwesend an diesem Tag'):'niemand abwesend';
    }
    const cnt=absentList.length;
    const dl=e.von===e.bis?_deDate(e.von):(_deDate(e.von)+' – '+_deDate(e.bis));
    h+='<div class="kal-cfitem"><div class="kal-cfdate">'+dl+'</div><div class="kal-cfmain"><div class="kal-cftitle">'+ic+' '+esc(e.titel)+(e.entity?(' <span style="font-weight:400;color:var(--muted)">· '+esc(e.entity)+'</span>'):'')+'</div>';
    h+='<div class="kal-cfsub">'+sub+'</div>';
    if(cnt) h+='<div class="kal-chips">'+absentList.map(a=>{const m=KMETA[a.type];return '<span class="kal-chip" style="background:'+m.c+'">'+esc(empName(a.emp))+' · '+m.lbl+'</span>';}).join('')+'</div>';
    h+='</div><div class="kal-badge" style="background:'+(cnt?'#fbe4df;color:#c8442f':'#dff1e7;color:#2b8a5a')+'">'+(cnt?('⚠ '+cnt):'✓ frei')+'</div></div>';
  });
  return h+'</div>';
}

// ═══ Persönliche Ansicht („Nur ich"): klassische Kalender-Layouts ═══
// Zeigt ALLE Veranstaltungen/Termine (eigene hervorgehoben) + NUR die eigenen Abwesenheiten.
function _persItems(){ return _events().concat(_termine()); }
function _persMine(it){ const myId=(window.cu&&window.cu.id)||''; return (it.mitarbeiter||[]).indexOf(myId)>=0; }
function _persMyAbs(){ const myId=(window.cu&&window.cu.id)||''; return _abs().filter(a=>a.emp===myId); }
function _persChip(it){
  const isVa=it.typ==='va'; const mine=_persMine(it); const base=isVa?'#7b3fb3':'#0d8a8a'; const c=_clk(it);
  const tip=(isVa?'📅 ':'• ')+it.titel+(it.entity?(' · '+it.entity):'')+' · '+_deDate(it.von)+(it.bis!==it.von?('–'+_deDate(it.bis)):'')+(it.uhr?(' '+it.uhr):'')+(mine?' · dir zugewiesen':'');
  const style=mine?('background:'+base+';color:#fff'):('background:#fff;color:'+base+';border:1px solid '+base);
  return '<div class="kal-pchip'+c.cls+'" style="'+style+'" data-tip="'+esc(tip)+'"'+c.on+'>'+(isVa?'📅':'•')+' '+esc(it.titel)+(it.uhr?(' '+esc(it.uhr)):'')+'</div>';
}
function _persAbsChip(a){ const m=KMETA[a.type]; return '<div class="kal-pabs" style="background:'+m.c+'" data-tip="'+esc(m.lbl+' · '+_deDate(a.von)+'–'+_deDate(a.bis)+(a.half?' (½ Tag)':''))+'">'+m.lbl+'</div>'; }
function _persDayEntries(iso){
  const abs=_persMyAbs().filter(a=>overlap(a.von,a.bis,iso,iso)).map(_persAbsChip);
  const its=_persItems().filter(it=>overlap(it.von,it.bis,iso,iso)).sort((x,y)=>(_persMine(y)?1:0)-(_persMine(x)?1:0));
  return abs.concat(its.map(_persChip)).join('');
}
const _DOWLONG=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
function _persMonth(y,m){
  const first=new Date(y,m-1,1,12); const startDow=_dowMon(first); const dim=_daysInMonth(y,m);
  const cells=[];
  for(let i=0;i<startDow;i++) cells.push({dt:_addDays(first,-(startDow-i)),out:true});
  for(let d=1;d<=dim;d++) cells.push({dt:new Date(y,m-1,d,12),out:false});
  while(cells.length%7!==0){ const last=cells[cells.length-1].dt; cells.push({dt:_addDays(last,1),out:true}); }
  let h='<div class="kal-pm"><div class="kal-pm-head">'+_DOWLONG.map((d,i)=>'<div class="kal-pm-hc'+(i>=5?' we':'')+'">'+d+'</div>').join('')+'</div><div class="kal-pm-grid">';
  cells.forEach(c=>{ const iso=_iso(c.dt); const dow=_dowMon(c.dt); const today=iso===_todayISO();
    h+='<div class="kal-pm-cell'+(c.out?' out':'')+(dow>=5?' we':'')+(today?' today':'')+'"><div class="kal-pm-dn">'+c.dt.getDate()+'</div><div class="kal-pm-items">'+(c.out?'':_persDayEntries(iso))+'</div></div>';
  });
  return h+'</div></div>';
}
function _persWeek(ws){
  let h='<div class="kal-pw">';
  for(let i=0;i<7;i++){ const dt=_addDays(ws,i); const iso=_iso(dt); const dow=_dowMon(dt); const today=iso===_todayISO();
    h+='<div class="kal-pw-col'+(dow>=5?' we':'')+(today?' today':'')+'"><div class="kal-pw-h">'+DOW[dow]+' '+dt.getDate()+'.'+(dt.getMonth()+1)+'.</div><div class="kal-pw-body">'+_persDayEntries(iso)+'</div></div>';
  }
  return h+'</div>';
}
function _persYear(year){
  const ITEMS=_persItems(), MYABS=_persMyAbs();   // einmal berechnen (statt 372×)
  let h='<div class="kal-py" style="grid-template-columns:34px repeat(12,1fr)"><div class="kal-py-corner"></div>';
  for(let m=0;m<12;m++) h+='<div class="kal-py-mh">'+MON_ABBR[m]+'</div>';
  for(let d=1;d<=31;d++){
    h+='<div class="kal-py-dl">'+d+'</div>';
    for(let m=1;m<=12;m++){
      if(d>_daysInMonth(year,m)){ h+='<div class="kal-py-cell empty"></div>'; continue; }
      const dt=new Date(year,m-1,d,12); const iso=_iso(dt); const dow=_dowMon(dt);
      const myAbs=MYABS.filter(a=>overlap(a.von,a.bis,iso,iso));
      const its=ITEMS.filter(it=>overlap(it.von,it.bis,iso,iso));
      let bg=''; if(myAbs.length) bg='background:'+KMETA[myAbs[0].type].c+';'; else if(dow>=5) bg='background:#eef1f5;';
      let dot=''; if(its.length){ const hasVa=its.some(i=>i.typ==='va'); const hasMine=its.some(_persMine); dot='<span class="kal-py-dot" style="background:'+(hasVa?'#7b3fb3':'#0d8a8a')+(hasMine?'':';opacity:.4')+'"></span>'; }
      const parts=[]; myAbs.forEach(a=>parts.push(KMETA[a.type].lbl)); its.forEach(it=>parts.push((it.typ==='va'?'📅 ':'• ')+it.titel+(_persMine(it)?' (zugew.)':'')));
      const tip=parts.length?(_deDate(iso)+': '+parts.join(', ')):'';
      h+='<div class="kal-py-cell'+(iso===_todayISO()?' today':'')+'" style="'+bg+'"'+(tip?(' data-tip="'+esc(tip)+'"'):'')+'>'+dot+'</div>';
    }
  }
  return h+'</div>';
}
function _persConflict(from,to){
  const myId=(window.cu&&window.cu.id)||''; const myAbs=_abs().filter(a=>a.emp===myId);
  const mine=_persItems().filter(it=>_persMine(it)&&overlap(it.von,it.bis,from,to)).sort((a,b)=>a.von<b.von?-1:1);
  if(!mine.length) return '<div class="kal-empty">Dir sind in diesem Zeitraum keine Veranstaltungen oder Termine zugewiesen.</div>';
  let h='<div class="kal-cf">';
  mine.forEach(e=>{ const ic=e.typ==='va'?'📅':'•'; const clash=myAbs.filter(a=>overlap(a.von,a.bis,e.von,e.bis)); const cnt=clash.length;
    const dl=e.von===e.bis?_deDate(e.von):(_deDate(e.von)+' – '+_deDate(e.bis));
    h+='<div class="kal-cfitem"><div class="kal-cfdate">'+dl+'</div><div class="kal-cfmain"><div class="kal-cftitle">'+ic+' '+esc(e.titel)+(e.entity?(' <span style="font-weight:400;color:var(--muted)">· '+esc(e.entity)+'</span>'):'')+'</div>';
    h+='<div class="kal-cfsub">'+(cnt?('überschneidet sich mit deiner Abwesenheit: '+clash.map(a=>KMETA[a.type].lbl).join(', ')):'frei – keine Überschneidung')+'</div>';
    h+='</div><div class="kal-badge" style="background:'+(cnt?'#fbe4df;color:#c8442f':'#dff1e7;color:#2b8a5a')+'">'+(cnt?'⚠ Konflikt':'✓ frei')+'</div></div>';
  });
  return h+'</div>';
}

// ── Periodenbezeichnung + Board ──
function _periodLabel(){
  if(V==='monat') return MONTHS[curM-1]+' '+curY;
  if(V==='woche'){ const e=_addDays(weekStart,6); const kw=_isoWeek(weekStart); return 'KW '+kw+' · '+weekStart.getDate()+'.'+(weekStart.getMonth()+1)+'. – '+e.getDate()+'.'+(e.getMonth()+1)+'. '+e.getFullYear(); }
  if(V==='jahr') return String(curY);
  return String(curY);
}
function _boardHtml(){
  const personal = curTeam==='@me';   // „Nur ich" → klassische persönliche Ansicht
  if(V==='monat'){ if(personal) return _persMonth(curY,curM); const n=_daysInMonth(curY,curM); const days=[]; for(let d=1;d<=n;d++){ const dt=new Date(curY,curM-1,d,12); const iso=_iso(dt); days.push({iso,dom:d,dow:_dowMon(dt),we:_dowMon(dt)>=5,today:iso===_todayISO()}); } return _dayGrid(days); }
  if(V==='woche'){ if(personal) return _persWeek(weekStart); const days=[]; for(let i=0;i<7;i++){ const dt=_addDays(weekStart,i); const iso=_iso(dt); days.push({iso,dom:dt.getDate(),dow:_dowMon(dt),we:_dowMon(dt)>=5,today:iso===_todayISO()}); } return _dayGrid(days); }
  if(V==='jahr'){ return personal?_persYear(curY):_yearGrid(curY); }
  // konflikt
  return personal ? _persConflict(curY+'-01-01', curY+'-12-31') : _conflictList(curY+'-01-01', curY+'-12-31');
}

export function renderKalender(){
  try{
    _styles();
    const root=document.getElementById('kalender-root'); if(!root) return;
    _bindTips(root);
    const tabs=[['woche','Woche'],['monat','Monat'],['jahr','Jahr'],['konflikt','Konflikte']];
    const emps=_emps(); const personal=curTeam==='@me';
    const teamOpts=['<option value="@me"'+(personal?' selected':'')+'>👤 Nur ich</option>','<option value=""'+(curTeam===''?' selected':'')+'>Alle Teams</option>'].concat(_teamsOrdered(emps).map(t=>'<option value="'+esc(t)+'"'+(curTeam===t?' selected':'')+'>'+esc(t)+'</option>')).join('');
    root.innerHTML=`<div class="kal-wrap">
      <div class="kal-h">📅 Kalender</div>
      <p class="kal-sub">${personal?'Deine persönliche Ansicht: alle Veranstaltungen &amp; Termine (deine hervorgehoben) plus deine Abwesenheiten.':'Veranstaltungen aus dem CRM gegen die Abwesenheiten aller Mitarbeiter — damit sichtbar ist, was passt und was kollidiert.'}</p>
      <div class="kal-bar">
        <div class="kal-seg" id="kal-tabs">${tabs.map(t=>`<button data-v="${t[0]}" class="${V===t[0]?'on':''}" onclick="kalSetView('${t[0]}')">${t[1]}</button>`).join('')}</div>
        ${V==='konflikt'?'':`<span class="kal-nav"><button onclick="kalNav(-1)">‹</button> <span>${_periodLabel()}</span> <button onclick="kalNav(1)">›</button></span><button class="kal-today" onclick="kalToday()">Heute</button>`}
        <span class="kal-spacer"></span>
        <select class="kal-sel" onchange="kalSetTeam(this.value)">${teamOpts}</select>
      </div>
      <div class="kal-legend">
        <span class="kal-lg"><span class="kal-sw" style="background:#7b3fb3"></span>Veranstaltung</span>
        <span class="kal-lg"><span class="kal-sw" style="background:#0d8a8a;border:1.5px dashed #fff"></span>Termin</span>
        ${personal
          ? `<span class="kal-lg"><span class="kal-sw" style="background:#fff;border:1px solid #7b3fb3"></span>nicht dir zugewiesen (nur Umriss)</span>
        <span class="kal-lg"><span class="kal-sw" style="background:#2b8a5a"></span>Urlaub</span>
        <span class="kal-lg"><span class="kal-sw" style="background:#2f6f9f"></span>Arbeitszeitausgleich</span>`
          : `<span class="kal-lg"><span class="kal-sw" style="background:#bd9fd9"></span>eingeplant (helle Fläche auf der Zeile)</span>
        <span class="kal-lg"><span class="kal-sw" style="background:#2b8a5a"></span>Urlaub</span>
        <span class="kal-lg"><span class="kal-sw" style="background:#2f6f9f"></span>Arbeitszeitausgleich</span>
        <span class="kal-lg"><span class="kal-sw" style="background:transparent;outline:2px solid #f0a92e"></span>Konflikt (eingeplant &amp; abwesend)</span>`}
      </div>
      ${V==='konflikt'?`<div class="kal-board">${_boardHtml()}</div>`:`<div class="kal-board"><div class="kal-scroll">${_boardHtml()}</div></div>`}
    </div>`;
  }catch(e){ console.error('renderKalender Fehler:',e); }
}

function kalSetView(v){ V=v; renderKalender(); }
function kalSetTeam(t){ curTeam=t; renderKalender(); }
function kalToday(){ const n=new Date(); curY=n.getFullYear(); curM=n.getMonth()+1; weekStart=_mondayOf(n); renderKalender(); }
function kalNav(dir){
  if(V==='monat'){ curM+=dir; if(curM<1){curM=12;curY--;} if(curM>12){curM=1;curY++;} }
  else if(V==='woche'){ weekStart=_addDays(weekStart,7*dir); }
  else if(V==='jahr'){ curY+=dir; }
  renderKalender();
}
Object.assign(window, { renderKalender, kalSetView, kalSetTeam, kalToday, kalNav, kalOpenVeranstaltung, kalOpenTermin });
