// ── Modul „Auswertung" (für Leitung & GF) ─────────────────────────
// Eigenes Top-Modul neben Zeiterfassung/CRM. Wertet die CRM-Daten aus:
// Förderungen, Statistik (Mitglieder/TN…) und Veranstaltungen – pro Jahr und
// gesamt, je Projekt einzeln auswählbar, mit Excel-Download.
// ISOLIERT: liest nur über die crm-data-Accessoren; fasst weder ZE noch
// window._fbRef an. Alles in try/catch, damit ein Fehler nichts anderes stört.
import { ensureCrmReady, listEntities, listVeranstaltungen } from './crm-data.js';
import { getTrees } from './crm-config.js';
import { esc, toast } from '../utils.js';

const FSTATUS = [['beantragt','Beantragt'],['genehmigt','Genehmigt'],['abgelehnt','Abgelehnt'],['abgeschlossen','Abgeschlossen']];
let _xlsxP=null;
function loadXLSX(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(_xlsxP) return _xlsxP;
  _xlsxP=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>res(window.XLSX);
    s.onerror=()=>{ _xlsxP=null; rej(new Error('Excel-Bibliothek konnte nicht geladen werden (Internetverbindung nötig).')); };
    document.head.appendChild(s);
  });
  return _xlsxP;
}

function _ausAllowed(){ const cu=window.cu; return !!cu && (cu.role==='admin'||cu.role==='leitung'||cu.role==='geschaeftsfuehrer'); }
function _yearOf(d){ const t=Date.parse(d); if(isNaN(t)) return null; return new Date(t).getFullYear(); }
function _eName(e){ return (e && e.stamm && e.stamm.name) || (e && e.name) || '(ohne Name)'; }
function _num(x){ return Number(x||0); }
// Statistik-Feld lesen, mit Fallback auf alte Schlüssel (v194-)
function _sNum(s,key,legacy){ if(!s) return 0; let v=s[key]; if((v==null||v==='')&&legacy) v=s[legacy]; return Number(v||0); }
// Spalten der Inklusions-Statistik (neue Felder)
const STAT_COLS=[['engagierte','Engagierte Mitglieder',null],['trainer','Inkl.-Trainer','trainerInkl'],['tn','Inklusive TN','tnInkl'],['gruppen','Trainingsgruppen',null]];
function _euro(n){ return _num(n).toLocaleString('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2}); }

// Alle Einträge (Projekte) aus allen Bäumen einsammeln
function _allEntities(){
  const out=[];
  try{ (getTrees()||[]).forEach(t=>{ (listEntities(t.key)||[]).forEach(e=>{ if(e&&e.id) out.push({ tree:t.key, treeLabel:t.label, id:e.id, name:_eName(e), e }); }); }); }catch(err){ console.error('Auswertung _allEntities:',err); }
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
// Statistik: je Verein die JEWEILS LETZTE Erfassung eines Jahres, dann summiert
function _statByYear(entities){
  const by={};
  entities.forEach(x=>{
    const perYear={};
    (x.e.stats||[]).forEach(s=>{ const y=_yearOf(s.date); if(y==null) return; if(!perYear[y]||String(s.date)>String(perYear[y].date)) perYear[y]=s; });
    Object.keys(perYear).forEach(y=>{ const s=perYear[y];
      if(!by[y]) by[y]={engagierte:0,trainer:0,tn:0,gruppen:0};
      STAT_COLS.forEach(([k,,leg])=>{ by[y][k]+=_sNum(s,k,leg); });
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
  .aus-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(32,56,105,.05)}
  .aus-card h3{font-size:15px;color:var(--primary);margin:0 0 10px}
  .aus-filter{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
  .aus-ent{max-height:190px;overflow:auto;border:1.5px solid var(--border);border-radius:8px;padding:8px;min-width:260px;flex:1}
  .aus-ent label{display:flex;gap:7px;align-items:center;font-size:13px;padding:2px 0;cursor:pointer}
  .aus-ent .grp{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0 2px}
  table.aus-t{width:100%;border-collapse:collapse;min-width:420px}
  table.aus-t th,table.aus-t td{border:1px solid var(--border);padding:6px 9px;font-size:13px;text-align:right}
  table.aus-t th:first-child,table.aus-t td:first-child{text-align:left}
  table.aus-t thead th{background:var(--primary);color:#fff;font-size:12px}
  table.aus-t tr.total td{font-weight:800;background:#eef2f8}
  .aus-badge{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700}
  .aus-btn{background:var(--primary);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer}
  .aus-btn.sec{background:#fff;color:var(--primary);border:1.5px solid var(--border)}
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
function _tblStat(entities){
  const by=_applyYear(_statByYear(entities)); const years=Object.keys(by).sort();
  const rows=years.map(y=>{ const r=by[y]; return `<tr><td>${esc(y)}</td>${STAT_COLS.map(([k])=>`<td>${r[k]}</td>`).join('')}</tr>`; }).join('');
  return `<div class="aus-card"><h3>📊 Statistik · Inklusion</h3><div class="aus-scroll"><table class="aus-t">
    <thead><tr><th>Jahr</th>${STAT_COLS.map(([,l])=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${rows||`<tr><td colspan="${STAT_COLS.length+1}" style="text-align:center;color:var(--muted)">Keine Statistik im Auswahlbereich.</td></tr>`}</tbody></table></div>
    <div class="aus-sub" style="margin:8px 0 0">Pro Jahr die jeweils letzte Erfassung je Verein, über die Auswahl summiert.</div></div>`;
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
  // Pro Projekt: bewilligte Förderung gesamt, Anzahl Veranstaltungen, aktuelle Mitglieder/TN
  const rows=entities.map(x=>{
    const f=(x.e.foerderungen||[]);
    const bew=f.filter(v=>v.status==='genehmigt'||v.status==='abgeschlossen').reduce((s,v)=>s+_num(v.betrag),0);
    const bea=f.filter(v=>v.status==='beantragt').reduce((s,v)=>s+_num(v.betrag),0);
    const {total:va}=_veranstByYear([x]);
    // aktuellste Statistik
    const stats=(x.e.stats||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const last=stats[stats.length-1]||{};
    return `<tr><td>${esc(x.name)}</td><td style="text-align:left">${esc(x.treeLabel||'')}</td><td>${_euro(bew)}</td><td>${_euro(bea)}</td><td>${va}</td><td>${_sNum(last,'engagierte',null)}</td><td>${_sNum(last,'tn','tnInkl')}</td></tr>`;
  }).join('');
  return `<div class="aus-card"><h3>📁 Pro Projekt (Einzelübersicht)</h3><div class="aus-scroll"><table class="aus-t">
    <thead><tr><th>Projekt</th><th>Baum</th><th>Förderung bewilligt</th><th>offen beantragt</th><th>Veranst.</th><th>Engagierte (akt.)</th><th>Inkl. TN (akt.)</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--muted)">Keine Projekte gewählt.</td></tr>'}</tbody></table></div></div>`;
}

function _filterBar(){
  const all=_allEntities(); const sel=_selectedSet();
  const isSel=x=> !sel || sel.has(_key(x.tree,x.id));
  // Jahre für Dropdown
  const yset=new Set();
  all.forEach(x=>{ (x.e.foerderungen||[]).forEach(f=>{const y=_yearOf(f.date); if(y)yset.add(y);}); (x.e.stats||[]).forEach(s=>{const y=_yearOf(s.date); if(y)yset.add(y);}); });
  try{ (listVeranstaltungen()||[]).forEach(v=>{const y=_yearOf(v.start); if(y)yset.add(y);}); }catch(e){}
  const years=[...yset].sort();
  const yearOpts=`<option value="">Alle Jahre</option>`+years.map(y=>`<option value="${y}"${String(_yearsFilter())===String(y)?' selected':''}>${y}</option>`).join('');
  // Einträge gruppiert nach Baum
  const byTree={}; all.forEach(x=>{ (byTree[x.treeLabel]=byTree[x.treeLabel]||[]).push(x); });
  const entHtml=Object.keys(byTree).map(tl=>`<div class="grp">${esc(tl)}</div>`+byTree[tl].map(x=>`<label><input type="checkbox" ${isSel(x)?'checked':''} onchange="ausToggle('${esc(_key(x.tree,x.id))}')"> ${esc(x.name)}</label>`).join('')).join('');
  return `<div class="aus-card"><h3>Auswahl</h3>
    <div class="aus-filter">
      <div style="min-width:170px">
        <label style="font-size:12px;font-weight:700;color:var(--muted)">Zeitraum</label><br>
        <select onchange="ausSetYear(this.value)" style="margin-top:5px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:14px">${yearOpts}</select>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="aus-btn sec" onclick="ausAll()">Alle</button>
          <button class="aus-btn sec" onclick="ausNone()">Keine</button>
        </div>
        <div style="margin-top:12px"><button class="aus-btn" onclick="ausExport()">⬇ Als Excel herunterladen</button></div>
      </div>
      <div class="aus-ent">${entHtml||'<div class="aus-sub">Noch keine Projekte im CRM.</div>'}</div>
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
        <div class="aus-sub">Förderungen, Statistik und Veranstaltungen über die gewählten Projekte – pro Jahr und gesamt. ${ents.length} Projekt(e) gewählt.</div>
        ${_filterBar()}
        ${_tblFoerder(ents)}
        ${_tblStat(ents)}
        ${_tblVeranst(ents)}
        ${_tblProProjekt(ents)}`;
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

export function ausExport(){
  const ents=_selectedEntities();
  loadXLSX().then(XLSX=>{
    try{
      const wb=XLSX.utils.book_new();
      const p=n=>String(n).padStart(2,'0');
      // Förderungen
      const fBy=_applyYear(_foerderByYear(ents)); const fYears=Object.keys(fBy).sort();
      const fRows=fYears.map(y=>{const r=fBy[y]; return {Jahr:y,Beantragt:r.beantragt,Genehmigt:r.genehmigt,Abgelehnt:r.abgelehnt,Abgeschlossen:r.abgeschlossen,'Bewilligt (gen.+abg.)':r.genehmigt+r.abgeschlossen,Anzahl:r.count};});
      const fTot={Jahr:'Gesamt',Beantragt:0,Genehmigt:0,Abgelehnt:0,Abgeschlossen:0,'Bewilligt (gen.+abg.)':0,Anzahl:0};
      fRows.forEach(r=>{fTot.Beantragt+=r.Beantragt;fTot.Genehmigt+=r.Genehmigt;fTot.Abgelehnt+=r.Abgelehnt;fTot.Abgeschlossen+=r.Abgeschlossen;fTot['Bewilligt (gen.+abg.)']+=r['Bewilligt (gen.+abg.)'];fTot.Anzahl+=r.Anzahl;});
      if(fRows.length) fRows.push(fTot);
      const fHead=['Jahr','Beantragt','Genehmigt','Abgelehnt','Abgeschlossen','Bewilligt (gen.+abg.)','Anzahl'];
      XLSX.utils.book_append_sheet(wb, fRows.length?XLSX.utils.json_to_sheet(fRows,{header:fHead}):XLSX.utils.aoa_to_sheet([fHead]), 'Förderungen');
      // Statistik
      const sBy=_applyYear(_statByYear(ents)); const sYears=Object.keys(sBy).sort();
      const sRows=sYears.map(y=>{const r=sBy[y]; const o={Jahr:y}; STAT_COLS.forEach(([k,l])=>{o[l]=r[k];}); return o;});
      const sHead=['Jahr',...STAT_COLS.map(([,l])=>l)];
      XLSX.utils.book_append_sheet(wb, sRows.length?XLSX.utils.json_to_sheet(sRows,{header:sHead}):XLSX.utils.aoa_to_sheet([sHead]), 'Statistik');
      // Veranstaltungen
      const {by:vByAll}=_veranstByYear(ents); const vBy=_applyYear(vByAll); const vYears=Object.keys(vBy).sort();
      const vRows=vYears.map(y=>({Jahr:y,'Anzahl Veranstaltungen':vBy[y]}));
      if(vRows.length) vRows.push({Jahr:'Gesamt','Anzahl Veranstaltungen':vYears.reduce((s,y)=>s+vBy[y],0)});
      XLSX.utils.book_append_sheet(wb, vRows.length?XLSX.utils.json_to_sheet(vRows,{header:['Jahr','Anzahl Veranstaltungen']}):XLSX.utils.aoa_to_sheet([['Jahr','Anzahl Veranstaltungen']]), 'Veranstaltungen');
      // Pro Projekt
      const pRows=ents.map(x=>{
        const f=(x.e.foerderungen||[]);
        const bew=f.filter(v=>v.status==='genehmigt'||v.status==='abgeschlossen').reduce((s,v)=>s+_num(v.betrag),0);
        const bea=f.filter(v=>v.status==='beantragt').reduce((s,v)=>s+_num(v.betrag),0);
        const {total:va}=_veranstByYear([x]);
        const stats=(x.e.stats||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))); const last=stats[stats.length-1]||{};
        return {Projekt:x.name,Baum:x.treeLabel||'','Förderung bewilligt':bew,'offen beantragt':bea,Veranstaltungen:va,'Engagierte (aktuell)':_sNum(last,'engagierte',null),'Inkl. TN (aktuell)':_sNum(last,'tn','tnInkl')};
      });
      const pHead=['Projekt','Baum','Förderung bewilligt','offen beantragt','Veranstaltungen','Engagierte (aktuell)','Inkl. TN (aktuell)'];
      XLSX.utils.book_append_sheet(wb, pRows.length?XLSX.utils.json_to_sheet(pRows,{header:pHead}):XLSX.utils.aoa_to_sheet([pHead]), 'Pro Projekt');
      const d=new Date();
      XLSX.writeFile(wb, `Auswertung-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.xlsx`);
      toast('Excel-Datei erstellt ✓','ok');
    }catch(err){ console.error('ausExport:',err); toast('Export fehlgeschlagen (siehe Konsole).','err'); }
  }).catch(err=>{ toast(err.message||'Excel-Bibliothek nicht geladen.','err'); });
}

Object.assign(window, { renderAuswertung, ausToggle, ausAll, ausNone, ausSetYear, ausExport });
