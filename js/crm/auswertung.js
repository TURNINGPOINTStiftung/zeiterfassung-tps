// ── Modul „Auswertung" (für Leitung & GF) ─────────────────────────
// Eigenes Top-Modul neben Zeiterfassung/CRM. Wertet die CRM-Daten aus:
// Statistik (Mitglieder/TN…) und Veranstaltungen – pro Jahr und
// gesamt, je Projekt einzeln auswählbar, mit Excel-Download.
// ISOLIERT: liest nur über die crm-data-Accessoren; fasst weder ZE noch
// window._fbRef an. Alles in try/catch, damit ein Fehler nichts anderes stört.
import { ensureCrmReady, listEntities, listVeranstaltungen } from './crm-data.js';
import { getTrees } from './crm-config.js';
import { esc, toast, jsArg as jsq } from '../utils.js';

const FSTATUS = [['beantragt','Beantragt'],['genehmigt','Genehmigt'],['abgelehnt','Abgelehnt'],['abgeschlossen','Abgeschlossen']];
let _xlsxP=null;
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(_xlsxP) return _xlsxP;
  _xlsxP=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='js/vendor/xlsx.full.min.js';
    s.onload=()=>res(window.XLSX);
    s.onerror=()=>{ _xlsxP=null; rej(new Error('Excel-Bibliothek konnte nicht geladen werden (Internetverbindung nötig).')); };
    document.head.appendChild(s);
  });
  return _xlsxP;
}

// Darf der angemeldete Nutzer die Auswertung sehen? Admin immer; sonst entscheidet die
// Pro-Person-/Rollen-Freigabe aus der Verwaltung (crmModuleAccess → path_auswertung) – NICHT nur
// die Systemrolle. So kann z. B. ein Mitarbeiter, der in der Verwaltung für die Auswertung
// freigeschaltet wurde, sie einsehen; ein explizit entzogener Zugriff bleibt gesperrt.
// Fallback (crmModuleAccess noch nicht geladen): bisherige Rollen-Regel (Leitung/GF).
function _ausAllowed(){
  const cu=window.cu; if(!cu) return false;
  if(cu.role==='admin') return true;
  try{ if(window.crmModuleAccess) return window.crmModuleAccess(cu).auswertung!=='kein'; }catch(e){}
  return cu.role==='leitung'||cu.role==='geschaeftsfuehrer';
}
function _yearOf(d){ const t=Date.parse(d); if(isNaN(t)) return null; return new Date(t).getFullYear(); }
function _eName(e){ return (e && e.stamm && e.stamm.name) || (e && e.name) || '(ohne Name)'; }
function _num(x){ return Number(x||0); }
// Statistik-Feld lesen, mit Fallback auf alte Schlüssel (v194-)
function _sNum(s,key,legacy){ if(!s) return 0; let v=s[key]; if((v==null||v==='')&&legacy) v=s[legacy]; return Number(v||0); }
// Spalten der Inklusions-Statistik (neue Felder)
const STAT_COLS=[['engagierte','Engagierte Mitglieder',null],['trainer','Inkl.-Trainer','trainerInkl'],['tn','Inklusive TN','tnInkl'],['gruppen','Trainingsgruppen',null],['termine','Termine im Jahr',null]];
// Laufende Angebote: regelmäßiges Training + regelmäßige Veranstaltung (z. B. monatliche Segelsonntage, v487)
const _isRun=t=>{ t=t||''; return t===''||t==='training'||t==='reihe'; };
// Einmalige Events der Vereins-Statistik: die drei WENDE-Events + Alt-Typ „veranstaltung" (vor v618).
const _EVENT_TYPES=['wendestart','wendekurs','wendetraining','veranstaltung'];
const _EVENT_LABELS={wendestart:'WENDESTART',wendekurs:'WENDEKURS',wendetraining:'WENDETRAINING',veranstaltung:'Veranstaltung (einmalig)'};
const _isEvent=t=>_EVENT_TYPES.indexOf(t||'')>=0;
function _eventFilter(){ return window._ausEvent||''; }
// Zählt diese Erfassung für die aktuelle Event-Filterwahl? Ohne Filter: alle Events; mit Filter: nur der gewählte Typ.
function _eventMatches(t){ const f=_eventFilter(); return f ? (t===f) : _isEvent(t); }
const _PERSON_COLS={engagierte:1,trainer:1};   // Personen – bei mehreren Angeboten eines Vereins NICHT doppelt zählen
function _euro(n){ return _num(n).toLocaleString('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2}); }

// Alle Einträge (Projekte) aus allen Bäumen einsammeln – nur solche mit mindestens einem Eintrag
// in der Statistik (eigen oder per Kooperation). Förderungen gehören seit v501 nicht mehr zur Auswertung.
// Gemeinsame Erfassungen (Kooperation, v492): liegen beim Anlegenden, gelten für alle in sharedWith.
// Index: '<tree>|<eid>' → Liste der mit diesem Eintrag geteilten Erfassungen anderer.
function _sharedIndex(){ const idx={};
  try{ (getTrees()||[]).forEach(t=>(listEntities(t.key)||[]).forEach(e=>(e&&Array.isArray(e.stats)?e.stats:[]).forEach(s=>{
    (Array.isArray(s.sharedWith)?s.sharedWith:[]).forEach(w=>{ if(!w||!w.tree||!w.eid) return; const k=w.tree+'|'+w.eid; (idx[k]=idx[k]||[]).push(s); }); }))); }catch(err){}
  return idx; }
function _hasData(e, key, sidx){ return (Array.isArray(e.stats)&&e.stats.length>0) || !!(sidx && (sidx[key]||[]).length); }
function _allEntities(){
  const out=[]; const sidx=_sharedIndex();
  try{ (getTrees()||[]).forEach(t=>{ (listEntities(t.key)||[]).forEach(e=>{ if(e&&e.id&&_hasData(e, t.key+'|'+e.id, sidx)) out.push({ tree:t.key, treeLabel:t.label, id:e.id, name:_eName(e), e }); }); }); }catch(err){ console.error('Auswertung _allEntities:',err); }
  out.sort((a,b)=>a.name.localeCompare(b.name,'de'));
  return out;
}
function _key(tree,id){ return tree+'|'+id; }
function _selectedSet(){
  // undefined = „alle" (Standard); sonst die im Set gewählten Keys
  if(!(window._ausSel instanceof Set)) return null;
  return window._ausSel;
}
function _selectedEntities(){
  const all=_allEntities(); const sel=_selectedSet();
  if(!sel) return all;
  return all.filter(x=>sel.has(_key(x.tree,x.id)));
}

// ── Aggregationen ──────────────────────────────────────────────────
function _foerderByYear(entities){
  const by={};
  entities.forEach(x=>(x.e.foerderungen||[]).forEach(f=>{
    const y=_yearOf(f.date); const key=(y==null)?'(ohne Datum)':String(y);
    if(!by[key]) by[key]={beantragt:0,genehmigt:0,abgelehnt:0,abgeschlossen:0,count:0};
    const st=f.status||'beantragt'; if(by[key][st]==null) by[key][st]=0;
    by[key][st]+=_num(f.betrag); by[key].count++;
  }));
  return by;
}
// Statistik je Jahr: laufende Werte aus dem LETZTEN Training je Verein; Auftakt-TN
// aus der FRÜHESTEN Veranstaltung je Verein → Summen + Weitermach-Quote.
// Personen-Zahl einer Erfassung aus Sicht eines Eintrags: aufgeteilt → dessen Anteil; sonst beim Besitzer voll, beim Partner 0
function _personVal(s, k, key, own, leg){ if(s && s.split && typeof s.split==='object') return Number((s.split[key]||{})[k]||0); return own ? _sNum(s,k,leg) : 0; }
function _statByYear(entities){
  const by={}; const sidx=_sharedIndex(); const counted=new Set(), countedEv=new Set();   // gemeinsame Zahlen je Erfassung nur EINMAL
  entities.forEach(x=>{ const key=x.tree+'|'+x.id; const ownSet=new Set(x.e.stats||[]);
    const recs=(x.e.stats||[]).concat((sidx[key]||[]).filter(s=>!ownSet.has(s)));
    // je Jahr und je laufendem Angebot (Training / regelmäßige Veranstaltung): letzte + erste Erfassung;
    // Summe ALLER einmaligen Veranstaltungs-TN; Wintertraining ja/nein
    const last={}, first={}, eventSum={}, eventUeb={}, eventUebSet={}, winter={};
    recs.forEach(s=>{ const y=_yearOf(s.date); if(y==null) return; const t=s.typ||'';
      if(_eventMatches(t)){ const id=s.id||s; if(!countedEv.has(id)){ countedEv.add(id); eventSum[y]=(eventSum[y]||0)+_sNum(s,'tn','tnInkl'); if(s.uebergang!=null&&s.uebergang!==''){ eventUeb[y]=(eventUeb[y]||0)+Number(s.uebergang||0); eventUebSet[y]=true; } } else if(!(y in eventSum)) eventSum[y]=eventSum[y]||0; }
      else if(_isRun(t)){ const k=t==='reihe'?'reihe':'training'; last[y]=last[y]||{}; first[y]=first[y]||{};
        if(!last[y][k]||String(s.date)>String(last[y][k].date)) last[y][k]=s;
        if(!first[y][k]||String(s.date)<String(first[y][k].date)) first[y][k]=s;
        if(s.winter) winter[y]=true; }
    });
    const yset=new Set([...Object.keys(last),...Object.keys(eventSum)]);
    yset.forEach(y=>{ if(!by[y]) by[y]={engagierte:0,trainer:0,tn:0,tnRegel:0,tnEinmal:0,gruppen:0,termine:0,eventTN:0,eventUeb:0,eventUebSet:false,zuwachs:0,winter:0};
      const offers=Object.values(last[y]||{});
      // gemeinsame Zahlen: nur Erfassungen, die noch nicht gezählt wurden (Kooperation zählt einmal)
      const fresh=offers.filter(tr=>{ const id=tr.id||tr; if(counted.has(id)) return false; counted.add(id); return true; });
      STAT_COLS.forEach(([k,,leg])=>{
        if(_PERSON_COLS[k]){ const vals=offers.map(tr=>_personVal(tr,k,key,ownSet.has(tr),leg)); if(vals.length) by[y][k]+=Math.max(...vals); }
        else { const vals=fresh.map(tr=>_sNum(tr,k,leg)); by[y][k]+=vals.reduce((a,b)=>a+b,0); } });
      by[y].eventTN += (eventSum[y]||0);
      by[y].eventUeb += (eventUeb[y]||0); if(eventUebSet[y]) by[y].eventUebSet=true;
      Object.keys(last[y]||{}).forEach(k=>{ const tr=last[y][k], trF=first[y][k]; if(tr&&trF&&fresh.includes(tr)) by[y].zuwachs += (_sNum(tr,'tn','tnInkl') - _sNum(trF,'tn','tnInkl')); });
      if(winter[y]) by[y].winter++;
    });
  });
  return by;
}
// Veranstaltungen je Jahr: Events, an denen ein gewählter Eintrag teilnimmt (pro Event 1×)
function _veranstByYear(entities){
  const keys=new Set(entities.map(x=>_key(x.tree,x.id)));
  const by={}; let total=0;
  try{ (listVeranstaltungen()||[]).forEach(v=>{
    const teil=(v.teilnehmer||[]).some(t=>t&&keys.has(_key(t.tree,t.eid)));
    if(!teil) return;
    const y=_yearOf(v.start)||_yearOf(v.ende); const key=(y==null)?'(ohne Datum)':String(y);
    by[key]=(by[key]||0)+1; total++;
  }); }catch(err){ console.error('Auswertung _veranstByYear:',err); }
  return { by, total };
}
function _yearsFilter(){ return window._ausYear||''; }
function _applyYear(obj){ const y=_yearsFilter(); if(!y) return obj; const o={}; if(obj[y]!=null) o[y]=obj[y]; return o; }

// ── Rendering ──────────────────────────────────────────────────────
function _injectStyles(){
  if(document.getElementById('aus-styles')) return;
  const css=`
  #aus-root{flex:1;min-height:0;overflow:auto;background:var(--bg);padding:18px 22px}
  .aus-h1{font-size:20px;font-weight:800;color:var(--primary);margin:0 0 4px}
  .aus-sub{font-size:13px;color:var(--muted);margin:0 0 16px}
  .aus-card{background:var(--surface,#fff);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(32,56,105,.05)}
  .aus-card h3{font-size:15px;color:var(--primary);margin:0 0 10px}
  .aus-filter{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  .aus-ent{max-height:190px;overflow:auto;border:1.5px solid var(--border);border-radius:8px;padding:8px;min-width:260px;flex:1}
  .aus-ent label{display:flex;gap:7px;align-items:center;font-size:13px;padding:2px 0;cursor:pointer}
  .aus-ent .grp{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0 2px}
  table.aus-t{width:100%;border-collapse:collapse;min-width:420px}
  table.aus-t th,table.aus-t td{border:1px solid var(--border);padding:6px 9px;font-size:13px;text-align:right}
  table.aus-t th:first-child,table.aus-t td:first-child{text-align:left}
  table.aus-t thead th{background:var(--primary);color:var(--on-primary,#fff);font-size:12px}
  table.aus-t tr.total td{font-weight:800;background:var(--surface-2,#eef2f8)}
  .aus-badge{display:inline-block;padding:1px 7px;border-radius:9px;font-size:12px;font-weight:700}
  .aus-btn{background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer}
  .aus-btn.sec{background:var(--surface,#fff);color:var(--primary);border:1.5px solid var(--border)}
  .aus-scroll{overflow-x:auto}`;
  const st=document.createElement('style'); st.id='aus-styles'; st.textContent=css; document.head.appendChild(st);
}

function _tblFoerder(entities){
  const byAll=_foerderByYear(entities); const by=_applyYear(byAll);
  const years=Object.keys(by).sort();
  const tot={beantragt:0,genehmigt:0,abgelehnt:0,abgeschlossen:0,count:0};
  const rows=years.map(y=>{ const r=by[y]; ['beantragt','genehmigt','abgelehnt','abgeschlossen','count'].forEach(k=>tot[k]+=_num(r[k]));
    return `<tr><td>${esc(y)}</td><td>${_euro(r.beantragt)}</td><td>${_euro(r.genehmigt)}</td><td>${_euro(r.abgelehnt)}</td><td>${_euro(r.abgeschlossen)}</td><td>${_euro(r.genehmigt+r.abgeschlossen)}</td><td>${r.count}</td></tr>`; }).join('');
  const totalRow=`<tr class="total"><td>Gesamt</td><td>${_euro(tot.beantragt)}</td><td>${_euro(tot.genehmigt)}</td><td>${_euro(tot.abgelehnt)}</td><td>${_euro(tot.abgeschlossen)}</td><td>${_euro(tot.genehmigt+tot.abgeschlossen)}</td><td>${tot.count}</td></tr>`;
  return `<div class="aus-card"><h3>💶 Förderungen</h3><div class="aus-scroll"><table class="aus-t">
    <thead><tr><th>Jahr</th><th>Beantragt</th><th>Genehmigt</th><th>Abgelehnt</th><th>Abgeschlossen</th><th>Bewilligt</th><th>Anzahl</th></tr></thead>
    <tbody>${rows||''}${years.length?totalRow:'<tr><td colspan="7" style="text-align:center;color:var(--muted)">Keine Förderungen im Auswahlbereich.</td></tr>'}</tbody></table></div></div>`;
}
// Weitermach-Quote = (TN, die nach Events ins regelmäßige Training übergingen) ÷ TN der Events.
// Immer 0–100 %. Nicht eingetragener Übergang zählt als 0 (v621). „–" nur, wenn es im Zeitraum gar
// keine Veranstaltungs-TN gibt.
function _statQuote(r){ if(!r.eventTN) return '–'; return Math.min(100, Math.round(r.eventUeb/r.eventTN*100))+' %'; }
function _sign(n){ n=Number(n||0); return (n>0?'+':'')+n; }
// letzte laufende Erfassung (Training/Alt, keine Veranstaltung) eines Vereins
function _lastTrain(e){ return (e.stats||[]).filter(s=>_isRun(s.typ)).sort((a,b)=>String(a.date).localeCompare(String(b.date))).pop()||{}; }
function _lastTrainX(x){ const key=x.tree+'|'+x.id; const own=new Set(x.e.stats||[]); const sidx=_sharedIndex();
  const rec=(x.e.stats||[]).concat((sidx[key]||[]).filter(s=>!own.has(s))).filter(s=>_isRun(s.typ)).sort((a,b)=>String(a.date).localeCompare(String(b.date))).pop()||{};
  return { rec, eng:_personVal(rec,'engagierte',key,own.has(rec),null), tr:_personVal(rec,'trainer',key,own.has(rec),'trainerInkl') }; }
function _tblStat(entities){
  const by=_applyYear(_statByYear(entities)); const years=Object.keys(by).sort();
  const evLbl=_eventFilter()?(_EVENT_LABELS[_eventFilter()]||'Veranstaltungen'):'Veranstaltungen';
  const rows=years.map(y=>{ const r=by[y]; return `<tr><td>${esc(y)}</td>${STAT_COLS.map(([k])=>`<td>${r[k]}</td>`).join('')}<td>${r.winter||'–'}</td><td>${r.eventTN||'–'}</td><td>${r.eventTN?r.eventUeb:'–'}</td><td>${_sign(r.zuwachs)}</td><td><b>${_statQuote(r)}</b></td></tr>`; }).join('');
  // Gesamt über alle Jahre: nur die Veranstaltungs-Zahlen summieren sich sinnvoll (Flüsse); Stand-Werte bleiben „–". (v621)
  const gTN=years.reduce((a,y)=>a+(by[y].eventTN||0),0), gUeb=years.reduce((a,y)=>a+(by[y].eventUeb||0),0);
  const totalRow=years.length?`<tr class="total"><td>Gesamt</td>${STAT_COLS.map(()=>`<td>–</td>`).join('')}<td>–</td><td>${gTN||'–'}</td><td>${gTN?gUeb:'–'}</td><td>–</td><td><b>${_statQuote({eventTN:gTN,eventUeb:gUeb})}</b></td></tr>`:'';
  const cols=STAT_COLS.length+6;
  return `<div class="aus-card"><h3>📊 Statistik · Inklusion</h3><div class="aus-scroll"><table class="aus-t">
    <thead><tr><th>Jahr</th>${STAT_COLS.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th>Vereine mit Wintertraining</th><th>TN ${esc(evLbl)}</th><th title="Von diesen TN danach ins regelmäßige Training übergegangen">↪ ins Training</th><th>Zuwachs Training</th><th title="Anteil der Veranstaltungs-TN, die danach ins regelmäßige Training übergegangen sind">Weitermach-Quote</th></tr></thead>
    <tbody>${rows||`<tr><td colspan="${cols}" style="text-align:center;color:var(--muted)">Keine Statistik im Auswahlbereich.</td></tr>`}${totalRow}</tbody></table></div>
    <div class="aus-sub" style="margin:8px 0 0">Laufende Werte = letzte Erfassung je Verein und Angebot (regelmäßiges Training bzw. regelmäßige Veranstaltung), über die Auswahl summiert; Engagierte/Trainer je Verein nur einmal. <b>Gesamt</b> summiert nur die Veranstaltungs-Zahlen über alle Jahre (Stand-Werte wie Engagierte/Trainer sind Momentaufnahmen → „–"). <b>Weitermach-Quote</b> = „ins regelmäßige Training übergegangen" ÷ TN der Veranstaltungen (0–100 %); nicht eingetragener Übergang zählt als 0, „–" nur ohne Veranstaltungs-TN.</div></div>`;
}
// ── Entwicklung je Verein über die Jahre (NUR regelmäßiges Training/Reihe) ──────────
const _ENTW_METRICS=[['tn','Inklusive TN (regelmäßig)','tnInkl'],['gruppen','Trainingsgruppen',null],['engagierte','Engagierte Mitglieder',null],['termine','Termine im Jahr',null]];
function _entwMetric(){ const m=window._ausEntwMetric; return _ENTW_METRICS.some(x=>x[0]===m)?m:'tn'; }
// Je Verein: {Jahr: Wert} aus der LETZTEN laufenden Erfassung (Training/Reihe) des Jahres. Eigene
// Erfassungen des Vereins (x.e.stats), damit die Entwicklung je Verein sauber zuordenbar bleibt.
function _entwData(entities, metric, leg){
  const yset=new Set();
  const rows=entities.map(x=>{
    const byY={};
    (x.e.stats||[]).filter(s=>_isRun(s.typ)).forEach(s=>{ const y=_yearOf(s.date); if(y==null) return;
      if(!byY[y] || String(s.date)>String(byY[y].date)) byY[y]=s; });
    const vals={}; Object.keys(byY).forEach(y=>{ vals[y]=_sNum(byY[y],metric,leg); yset.add(y); });
    return { name:x.name, vals };
  }).filter(r=>Object.keys(r.vals).length).sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
  let years=[...yset].map(Number).sort((a,b)=>a-b).map(String);
  const yf=_yearsFilter(); if(yf) years=years.filter(y=>y===String(yf));
  return { rows, years };
}
function _tblEntwicklung(entities){
  const metric=_entwMetric(); const def=_ENTW_METRICS.find(x=>x[0]===metric)||_ENTW_METRICS[0];
  const metricSel=`<select aria-label="Kennzahl" onchange="ausSetEntwMetric(this.value)" style="margin-left:8px;padding:5px 8px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-weight:600;vertical-align:middle">${_ENTW_METRICS.map(([k,l])=>`<option value="${k}"${k===metric?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
  const foot='<div class="aus-sub" style="margin:8px 0 0">Nur regelmäßiges Angebot (Training / regelmäßige Veranstaltung) – je Jahr der letzte Stand je Verein. ▲▼ = Veränderung gegenüber dem zuletzt erfassten Jahr.</div>';
  const { rows, years }=_entwData(entities, metric, def[2]);
  if(!rows.length || !years.length) return `<div class="aus-card"><h3>📈 Entwicklung je Verein${metricSel}</h3><div class="aus-sub" style="margin:0">Noch keine regelmäßigen Trainings-Erfassungen im Auswahlbereich.</div></div>`;
  const head=`<tr><th>Verein</th>${years.map(y=>`<th>${esc(y)}</th>`).join('')}</tr>`;
  const body=rows.map(r=>{ let prev=null;
    const cells=years.map(y=>{ const has=(y in r.vals); const v=has?r.vals[y]:null; let arr='';
      if(has && prev!=null && v!==prev){ arr = v>prev?' <span style="color:#1b7f37">▲</span>':' <span style="color:#b3261e">▼</span>'; }
      if(has) prev=v;
      return `<td>${has?(v+arr):'<span style="color:var(--muted)">–</span>'}</td>`; });
    return `<tr><td>${esc(r.name)}</td>${cells.join('')}</tr>`; }).join('');
  const totals=years.map(y=>rows.reduce((a,r)=>a+((y in r.vals)?r.vals[y]:0),0));
  const totalRow=`<tr class="total"><td>Gesamt</td>${totals.map(t=>`<td>${t}</td>`).join('')}</tr>`;
  return `<div class="aus-card"><h3>📈 Entwicklung je Verein${metricSel}</h3>
    <div class="aus-scroll"><table class="aus-t" style="min-width:420px"><thead>${head}</thead><tbody>${body}${totalRow}</tbody></table></div>${foot}</div>`;
}
function _tblVeranst(entities){
  const {by:byAll}=_veranstByYear(entities); const by=_applyYear(byAll); const years=Object.keys(by).sort();
  let total=0; const rows=years.map(y=>{ total+=by[y]; return `<tr><td>${esc(y)}</td><td>${by[y]}</td></tr>`; }).join('');
  const totalRow=`<tr class="total"><td>Gesamt</td><td>${total}</td></tr>`;
  return `<div class="aus-card"><h3>📅 Veranstaltungen</h3><div class="aus-scroll"><table class="aus-t" style="min-width:260px">
    <thead><tr><th>Jahr</th><th>Anzahl Veranstaltungen</th></tr></thead>
    <tbody>${rows||''}${years.length?totalRow:'<tr><td colspan="2" style="text-align:center;color:var(--muted)">Keine Veranstaltungen im Auswahlbereich.</td></tr>'}</tbody></table></div></div>`;
}
function _tblProProjekt(entities){
  // Pro Projekt: Anzahl Veranstaltungen, aktuelle Mitglieder/TN
  const rows=entities.map(x=>{
    const {total:va}=_veranstByYear([x]);
    const LX=_lastTrainX(x), last=LX.rec;   // aktueller Stand = letzte laufende Erfassung (inkl. Kooperation)
    return `<tr><td>${esc(x.name)}</td><td style="text-align:left">${esc(x.treeLabel||'')}</td><td>${va}</td><td>${LX.eng}</td><td>${_sNum(last,'tn','tnInkl')}</td><td>${last.termine==null?'–':_sNum(last,'termine',null)}</td><td>${last.winter?'🧊':''}</td></tr>`;
  }).join('');
  return `<div class="aus-card"><h3>📁 Pro Projekt (Einzelübersicht)</h3><div class="aus-scroll"><table class="aus-t">
    <thead><tr><th>Projekt</th><th>Baum</th><th>Veranst.</th><th>Engagierte (akt.)</th><th>Inkl. TN (akt.)</th><th>Termine/Jahr</th><th>Winter</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:var(--muted)">Keine Projekte gewählt.</td></tr>'}</tbody></table></div></div>`;
}

function _filterBar(){
  const all=_allEntities(); const sel=_selectedSet();
  const isSel=x=> !sel || sel.has(_key(x.tree,x.id));
  // Jahre für Dropdown
  const yset=new Set();
  all.forEach(x=>{ (x.e.stats||[]).forEach(s=>{const y=_yearOf(s.date); if(y)yset.add(y);}); });
  try{ (listVeranstaltungen()||[]).forEach(v=>{const y=_yearOf(v.start); if(y)yset.add(y);}); }catch(e){}
  const years=[...yset].sort();
  const yearOpts=`<option value="">Alle Jahre</option>`+years.map(y=>`<option value="${y}"${String(_yearsFilter())===String(y)?' selected':''}>${y}</option>`).join('');
  // Event-Filter: die drei WENDE-Events; Alt-„veranstaltung" nur anbieten, wenn solche Altdaten da sind.
  const evSet=new Set(); all.forEach(x=>(x.e.stats||[]).forEach(s=>{ if(_isEvent(s.typ)) evSet.add(s.typ); }));
  const evTypes=['wendestart','wendekurs','wendetraining'].concat(evSet.has('veranstaltung')?['veranstaltung']:[]);
  const curEv=_eventFilter();
  const eventOpts=`<option value="">Alle Veranstaltungen</option>`+evTypes.map(t=>`<option value="${t}"${curEv===t?' selected':''}>${esc(_EVENT_LABELS[t]||t)}</option>`).join('');
  // Einträge gruppiert nach Baum
  const byTree={}; all.forEach(x=>{ (byTree[x.treeLabel]=byTree[x.treeLabel]||[]).push(x); });
  const entHtml=Object.keys(byTree).map(tl=>`<div class="grp">${esc(tl)}</div>`+byTree[tl].map(x=>`<label><input type="checkbox" ${isSel(x)?'checked':''} onchange="ausToggle(${jsq(_key(x.tree,x.id))})"> ${esc(x.name)}</label>`).join('')).join('');
  return `<div class="aus-card"><h3>Auswahl</h3>
    <div class="aus-filter">
      <div style="min-width:170px">
        <label style="font-size:12px;font-weight:700;color:var(--muted)">Zeitraum</label><br>
        <select aria-label="Zeitraum" onchange="ausSetYear(this.value)" style="margin-top:5px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">${yearOpts}</select>
        <div style="margin-top:12px">
          <label style="font-size:12px;font-weight:700;color:var(--muted)">Veranstaltung</label><br>
          <select aria-label="Veranstaltung" onchange="ausSetEvent(this.value)" style="margin-top:5px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">${eventOpts}</select>
          <div class="aus-sub" style="margin:4px 0 0;font-size:11px">Filtert „TN Veranstaltungen" &amp; Weitermach-Quote.</div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="aus-btn sec" onclick="ausAll()">Alle</button>
          <button class="aus-btn sec" onclick="ausNone()">Keine</button>
        </div>
        <div style="margin-top:12px"><button class="aus-btn" onclick="ausExport()">⬇ Als Excel herunterladen</button></div>
      </div>
      <div class="aus-ent">${entHtml||'<div class="aus-sub">Noch keine Einträge mit Statistik.</div>'}<div class="aus-sub" style="margin:8px 0 0;font-size:12px">Es erscheinen nur Einträge mit Statistik.</div></div>
    </div></div>`;
}

export function renderAuswertung(){
  const root=document.getElementById('aus-root'); if(!root) return;
  _injectStyles();
  if(!_ausAllowed()){ root.innerHTML='<div class="aus-card">Diese Auswertung ist der Leitung und Geschäftsführung vorbehalten.</div>'; return; }
  root.innerHTML='<div class="aus-sub">Lade Daten …</div>';
  ensureCrmReady().then(()=>{
    try{
      const ents=_selectedEntities();
      root.innerHTML=`
        <div class="aus-h1">📈 Auswertung</div>
        <div class="aus-sub">Statistik, Weitermach-Quote und Entwicklung je Verein über die gewählten Projekte – pro Jahr und gesamt. ${ents.length} Projekt(e) gewählt.</div>
        ${_filterBar()}
        ${_tblStat(ents)}
        ${_tblEntwicklung(ents)}
        ${_tblProProjekt(ents)}`;   /* Veranstaltungen-Karte (_tblVeranst) auf Wunsch ausgeblendet; Funktion bleibt für spätere Reaktivierung */
    }catch(err){ console.error('renderAuswertung:',err); root.innerHTML='<div class="aus-card">Fehler beim Aufbau der Auswertung (siehe Konsole). Die übrigen Module sind nicht betroffen.</div>'; }
  }).catch(err=>{ root.innerHTML='<div class="aus-card">CRM-Daten konnten nicht geladen werden.</div>'; console.error(err); });
}

export function ausToggle(key){
  if(!(window._ausSel instanceof Set)) window._ausSel=new Set(_allEntities().map(x=>_key(x.tree,x.id)));
  if(window._ausSel.has(key)) window._ausSel.delete(key); else window._ausSel.add(key);
  renderAuswertung();
}
export function ausAll(){ window._ausSel=new Set(_allEntities().map(x=>_key(x.tree,x.id))); renderAuswertung(); }
export function ausNone(){ window._ausSel=new Set(); renderAuswertung(); }
export function ausSetYear(y){ window._ausYear=y||''; renderAuswertung(); }
export function ausSetEvent(t){ window._ausEvent=t||''; renderAuswertung(); }
export function ausSetEntwMetric(m){ window._ausEntwMetric=m||'tn'; renderAuswertung(); }

export function ausExport(){
  const ents=_selectedEntities();
  loadXLSX().then(XLSX=>{
    try{
      const wb=XLSX.utils.book_new();
      const p=n=>String(n).padStart(2,'0');
      // Statistik
      const sBy=_applyYear(_statByYear(ents)); const sYears=Object.keys(sBy).sort();
      const evCol='TN '+(_eventFilter()?(_EVENT_LABELS[_eventFilter()]||'Veranstaltungen'):'Veranstaltungen');
      const sRows=sYears.map(y=>{const r=sBy[y]; const o={Jahr:y}; STAT_COLS.forEach(([k,l])=>{o[l]=r[k];}); o['Vereine mit Wintertraining']=r.winter; o[evCol]=r.eventTN; o['Übergegangen ins Training']=r.eventTN?r.eventUeb:''; o['Zuwachs Training']=_sign(r.zuwachs); o['Weitermach-Quote']=_statQuote(r); return o;});
      if(sYears.length){ const gTN=sYears.reduce((a,y)=>a+(sBy[y].eventTN||0),0), gUeb=sYears.reduce((a,y)=>a+(sBy[y].eventUeb||0),0); const g={Jahr:'Gesamt'}; g[evCol]=gTN; g['Übergegangen ins Training']=gTN?gUeb:''; g['Weitermach-Quote']=_statQuote({eventTN:gTN,eventUeb:gUeb}); sRows.push(g); }
      const sHead=['Jahr',...STAT_COLS.map(([,l])=>l),'Vereine mit Wintertraining',evCol,'Übergegangen ins Training','Zuwachs Training','Weitermach-Quote'];
      XLSX.utils.book_append_sheet(wb, sRows.length?XLSX.utils.json_to_sheet(sRows,{header:sHead}):XLSX.utils.aoa_to_sheet([sHead]), 'Statistik');
      // Veranstaltungen
      const {by:vByAll}=_veranstByYear(ents); const vBy=_applyYear(vByAll); const vYears=Object.keys(vBy).sort();
      const vRows=vYears.map(y=>({Jahr:y,'Anzahl Veranstaltungen':vBy[y]}));
      if(vRows.length) vRows.push({Jahr:'Gesamt','Anzahl Veranstaltungen':vYears.reduce((s,y)=>s+vBy[y],0)});
      XLSX.utils.book_append_sheet(wb, vRows.length?XLSX.utils.json_to_sheet(vRows,{header:['Jahr','Anzahl Veranstaltungen']}):XLSX.utils.aoa_to_sheet([['Jahr','Anzahl Veranstaltungen']]), 'Veranstaltungen');
      // Pro Projekt
      const pRows=ents.map(x=>{
        const {total:va}=_veranstByYear([x]);
        const LX=_lastTrainX(x), last=LX.rec;
        return {Projekt:x.name,Baum:x.treeLabel||'',Veranstaltungen:va,'Engagierte (aktuell)':LX.eng,'Inkl. TN (aktuell)':_sNum(last,'tn','tnInkl'),'Termine im Jahr':last.termine==null?'':_sNum(last,'termine',null),'Wintertraining':last.winter?'ja':''};
      });
      const pHead=['Projekt','Baum','Veranstaltungen','Engagierte (aktuell)','Inkl. TN (aktuell)','Termine im Jahr','Wintertraining'];
      XLSX.utils.book_append_sheet(wb, pRows.length?XLSX.utils.json_to_sheet(pRows,{header:pHead}):XLSX.utils.aoa_to_sheet([pHead]), 'Pro Projekt');
      // Entwicklung je Verein (regelmäßiges Training) – gewählte Kennzahl
      const eMetric=_entwMetric(); const eDef=_ENTW_METRICS.find(x=>x[0]===eMetric)||_ENTW_METRICS[0];
      const { rows:eRows, years:eYears }=_entwData(ents, eMetric, eDef[2]);
      const eHead=['Verein',...eYears];
      const eData=eRows.map(r=>{ const o={Verein:r.name}; eYears.forEach(y=>{ o[y]=(y in r.vals)?r.vals[y]:''; }); return o; });
      XLSX.utils.book_append_sheet(wb, eData.length?XLSX.utils.json_to_sheet(eData,{header:eHead}):XLSX.utils.aoa_to_sheet([eHead.length?eHead:['Verein']]), 'Entwicklung');
      const d=new Date();
      XLSX.writeFile(wb, `Auswertung-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.xlsx`);
      toast('Excel-Datei erstellt ✓','ok');
    }catch(err){ console.error('ausExport:',err); toast('Export fehlgeschlagen (siehe Konsole).','err'); }
  }).catch(err=>{ toast(err.message||'Excel-Bibliothek nicht geladen.','err'); });
}

Object.assign(window, { renderAuswertung, ausToggle, ausAll, ausNone, ausSetYear, ausSetEvent, ausSetEntwMetric, ausExport });
