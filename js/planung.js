// ══════════════════════════════════════════════════════════════════
//  PLANUNG – ein gemeinsamer Bereich für Kalender und Projektmanagement (Prototyp „TPS-Knoten Planung")
//  Leiste: Start · Kalender · Teams · Veranstaltung. Kalender und Projektmanagement bleiben die
//  Rechen-/Zeichen-Engines (kalender.js, crm.js), die Leiste liegt über allen vier Ansichten, das gewählte
//  Team gilt überall (window._planTeam). Start = „Was ansteht" (Überfällig / Diese Woche / Später),
//  „Hinweise" (betrifft mich, 4 Wochen), „Meine Termine" (14 Tage), „Wer ist diese Woche da?".
//  Abwesenheit wird nur als „Abwesend" gezeigt, nie mit Grund; Krankheit erscheint nirgends.
//  Andere Module nur über window.* (kein benannter Import – Gerätecache), alles in try/catch.
// ══════════════════════════════════════════════════════════════════
import { getData } from './data.js';
import * as CD from './crm/crm-data.js';

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsq = s => esc(JSON.stringify(String(s==null?'':s)));
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse = s => { const p=String(s).slice(0,10).split('-').map(Number); return new Date(p[0],(p[1]||1)-1,p[2]||1,12); };
const addD = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const dowMon = d => (d.getDay()+6)%7;
const fmt = s => { if(!s) return ''; const d=parse(s); return d.getDate()+'.'+(d.getMonth()+1)+'.'+(d.getFullYear()!==new Date().getFullYear()?String(d.getFullYear()).slice(2):''); };
const DOW = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const me = () => (window.cu && window.cu.id) || '';

// ── Zugriff ──
function _ma(){ try{ return (window.crmModuleAccess && window.crmModuleAccess(window.cu)) || {}; }catch(e){ return {}; } }
function planTabs(){
  const ma=_ma(); const kal=!ma.kalender || ma.kalender!=='kein'; const pm=!ma.kanban || ma.kanban!=='kein';
  const t=[['start','Was ansteht','Was ansteht']];
  if(kal) t.push(['kalender','Kalender','Kalender']);
  if(pm) t.push(['teams','Projektmanagement · Teams','Teams'],['veranstaltung','Veranstaltung','Veranstaltung']);
  return t;
}

// ── Leiste (liegt über allen Ansichten) ──
function planBarHtml(tab){
  _styles();
  return `<div class="plan-bar no-print" role="navigation" aria-label="Planung">
    ${planTabs().map(([k,l,sh])=>`<button type="button" class="plan-tab${k===tab?' on':''}"${k===tab?' aria-current="page"':''} onclick="planGo(${jsq(k)})"><span class="pl-long">${esc(l)}</span><span class="pl-short">${esc(sh)}</span></button>`).join('')}
  </div>`;
}

// ── Navigation ──
function planGo(tab, opts){
  opts=opts||{};
  const tabs=planTabs().map(t=>t[0]); if(!tabs.includes(tab)) tab='start';
  window._planActive=true; window._planTab=tab;
  if(opts.team!==undefined) window._planTeam=opts.team;
  if(opts.va!==undefined) window._planVa=opts.va;
  window._planInternal=true;
  try{
    if(tab==='kalender'){
      if(window._planTeam!==undefined && window.kalSetTeamSilent) window.kalSetTeamSilent(window._planTeam||'');
      window.switchModule('kalender');
      if(opts.view && window.kalSetView) window.kalSetView(opts.view);
      if(opts.date && window.kalGotoDate) window.kalGotoDate(opts.date);
    } else if(tab==='teams' || tab==='veranstaltung'){
      window.switchModule('kanban');
      // keep: Ort steht schon fest (Zurück-Taste, Sprung aus Kalender/Startseite) → nur zeichnen, nicht umsetzen
      if(!opts.keep || (tab==='veranstaltung' && !window._crmVaSel) || (tab==='teams' && !window._crmTeamSel && !window._crmTeamProjSel))
        setTimeout(()=>{ try{ _openPm(tab); }catch(e){ console.warn('Planung:',e); } }, 0);
    } else {
      window.switchModule('planung');
    }
  } finally { window._planInternal=false; }
  _label();
}
function _label(){
  try{ const cur=document.getElementById('mb-current'); if(cur) cur.textContent='Planung';
    document.querySelectorAll('.mb-mod').forEach(b=>b.classList.toggle('active', b.dataset.mod==='planung')); }catch(e){}
}
function _teamsVisible(){ try{ const d=getData()||{}; return Array.isArray(d.teams)?d.teams.slice():[]; }catch(e){ return []; } }
function _myTeams(){ const u=window.cu||{}; return [...new Set([u.team].concat(Array.isArray(u.teams)?u.teams:[]).filter(Boolean))]; }
function _openPm(tab){
  if(tab==='teams'){
    let t=window._planTeam;
    if(!t){ t=_myTeams()[0]||_teamsVisible()[0]||''; window._planTeam=t; }
    window._crmMode='teams';
    if(t && window.crmOpenTeam) window.crmOpenTeam(encodeURIComponent(t));
    else if(window.crmShowTeams) window.crmShowTeams();
  } else {
    let id=window._planVa; const vs=_vasSorted();
    if(!id || !vs.some(v=>v.id===id)){ const up=vs.find(v=>String(v.ende||v.start||'')>=iso(new Date())); id=(up||vs[0]||{}).id||''; window._planVa=id; }
    window._crmMode='veranstaltungen';
    if(id && window.crmOpenVeranstaltung) window.crmOpenVeranstaltung(id);
  }
  _label();
}
function _vasSorted(){ let vs=[]; try{ vs=(CD.listVeranstaltungen?CD.listVeranstaltungen():[]).filter(v=>v&&!v.closed); }catch(e){}
  return vs.sort((a,b)=>String(a.start||'').localeCompare(String(b.start||''))); }
function planTeamSet(t){ window._planTeam=t; planGo(window._planTab==='kalender'?'kalender':'teams'); }
function planVaSet(id){ window._planVa=id; planGo('veranstaltung'); }

// ── Daten für „Start" ──
function _abs(){ const out=[]; try{ const vr=(getData()||{}).vacRequests||{}; Object.keys(vr).forEach(k=>{ const r=vr[k]; if(!r||r.status!=='approved'||!r.startDate) return;
  if(r.type!=='Urlaub' && r.type!=='Arbeitszeitausgleich') return; out.push({ emp:r.userId, von:String(r.startDate).slice(0,10), bis:String(r.endDate||r.startDate).slice(0,10) }); }); }catch(e){} return out; }
function _emps(){ try{ return ((getData()||{}).users||[]).filter(u=>u&&u.id&&u.id!=='admin'&&u.role!=='admin'&&!u.crmOnly&&!u.archived); }catch(e){ return []; } }
function _teamCol(t){ const ts=_teamsVisible(); const i=ts.indexOf(t); return i<0?'var(--muted,#5d7086)':'var(--team-'+((i%8)+1)+')'; }
const _ST={ offen:'Offen', inarbeit:'In Arbeit', erledigt:'Erledigt' };
function _srcTag(a){ const ic=a.kind==='veranstaltung'?'📅':(a.kind==='entity'?'📇':'📂'); return `<span class="plan-tag">${ic} ${esc(a.containerName||(a.kind==='veranstaltung'?'Veranstaltung':(a.kind==='entity'?'Eintrag':'Projekt')))}</span>`; }
function _open(a){ return `crmMeineOpen(${jsq(a.kind)},${jsq(a.tree||'')},${jsq(a.containerId)},${jsq(a.node.id)})`; }

function _todoCard(){
  let all=[]; try{ all=window.crmListAllTasks?window.crmListAllTasks():[]; }catch(e){}
  const today=iso(new Date()); const wkEnd=iso(addD(new Date(), 6-dowMon(new Date())));
  const mine=all.filter(a=>(a.node.assigneeId===me() || (a.kind==='teamprojekt' && a.owner===me())) && a.node.status!=='erledigt' && !(Array.isArray(a.node.children)&&a.node.children.length))
    .sort((x,y)=>String(x.node.due||'9').localeCompare(String(y.node.due||'9')));
  const groups=[['Überfällig',mine.filter(a=>a.node.due&&a.node.due<today),'crit'],['Diese Woche',mine.filter(a=>a.node.due&&a.node.due>=today&&a.node.due<=wkEnd),''],['Später',mine.filter(a=>!a.node.due||a.node.due>wkEnd),'']];
  const row=a=>{ const n=a.node; const col=_teamCol((a.teamsEff||[])[0]);
    return `<div class="plan-item" role="button" tabindex="0" onclick="${_open(a)}"><span class="plan-barc" style="background:${col}"></span><div class="plan-main"><div class="plan-t">${esc(n.text||'Aufgabe')}</div><div class="plan-row">${_srcTag(a)}<span class="plan-tag">${esc(_ST[n.status]||'Offen')}</span>${(n.assigneeId&&n.assigneeId!==me())?`<span class="plan-tag">→ ${esc(_uName(n.assigneeId))}</span>`:''}${n.fromNote?'<span class="plan-tag">aus Kontaktnotiz</span>':''}</div></div><span class="plan-when">${esc(fmt(n.due))}</span></div>`; };
  const body=groups.filter(g=>g[1].length).map(g=>`<div class="plan-grp ${g[2]}">${g[0]} · ${g[1].length}</div>${g[1].map(row).join('')}`).join('')
    || '<div class="plan-empty">Gerade steht nichts an. Hier erscheinen Aufgaben, die dir zugeteilt sind, und alle offenen Aufgaben aus deinen eigenen Projekten.</div>';
  return `<section class="plan-card"><div class="plan-h"><h2>📌 Was ansteht</h2><span class="plan-sub">mir zugeteilt oder aus meinen eigenen Projekten · aus Veranstaltungen 📅, Projekten 📂 und CRM-Einträgen 📇</span></div>${body}</section>${_myProjCard()}`;
}
function _uName(id){ try{ const u=((getData()||{}).users||[]).find(x=>x&&x.id===id); return (u&&u.name)||id; }catch(e){ return id; } }
// Meine Projekte (persönlich, owner = ich): nur hier sichtbar, öffnen = bearbeiten/abschließen/löschen
function _myProjCard(){
  let ps=[]; try{ ps=Object.values(((CD.getCrm&&CD.getCrm())||{}).teamprojekte||{}).filter(p=>p&&p.owner===me()); }catch(e){}
  const can=(()=>{ try{ const u=window.cu; return !u||u.role==='admin'||!window.tpsRechteOf||!!window.tpsRechteOf(u).pm_proj_eigen; }catch(e){ return true; } })();
  if(!ps.length && !can) return '';
  const cnt=p=>{ let n=0; const w=a=>(a||[]).forEach(t=>{ if(!t) return; if(!(Array.isArray(t.children)&&t.children.length) && t.status!=='erledigt') n++; w(t.children); }); w(p.todos); return n; };
  const open=ps.filter(p=>!p.closed).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de')), closed=ps.filter(p=>p.closed);
  const row=p=>`<div class="plan-item" role="button" tabindex="0" onclick="planOpenMyProj(${jsq(p.id)})"><span class="plan-barc" style="background:var(--primary,#203869)"></span><div class="plan-main"><div class="plan-t">${esc(p.name||'Projekt')}</div><div class="plan-row"><span class="plan-tag">${cnt(p)} offen</span>${p.closed?'<span class="plan-tag">abgeschlossen</span>':''}</div></div></div>`;
  return `<section class="plan-card" style="margin-top:14px"><div class="plan-h"><h2>📂 Meine Projekte</h2>${can?`<button class="btn-sm-crm primary" onclick="planNewMyProj()">＋ Projekt</button>`:''}</div>
    <div class="plan-sub" style="margin:-4px 0 8px">nur für dich sichtbar · öffnen zum Bearbeiten, Abschließen oder Löschen</div>
    ${open.map(row).join('')||'<div class="plan-empty">Noch keine eigenen Projekte.</div>'}
    ${closed.length?`<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--muted,#5d7086);font-weight:600;font-size:13px">Abgeschlossen (${closed.length})</summary>${closed.map(row).join('')}</details>`:''}</section>`;
}
// Persönliches Projekt im Projektmanagement-Teil der Planung öffnen; „Zurück" führt wieder zu „Was ansteht"
function planOpenMyProj(id){ try{ window._crmTeamProjSel=id; window._crmMode='meine'; window._crmProjReturn='meine'; planGo('teams',{keep:true}); setTimeout(()=>{ try{ window.crmOpenMeinProjekt&&window.crmOpenMeinProjekt(id); }catch(e){} },0); }catch(e){ console.warn('Planung:',e); } }
function planNewMyProj(){ try{ window.crmNewMeinProjekt&&window.crmNewMeinProjekt(); }catch(e){ console.warn('Planung:',e); } }
function _hintCard(){
  let cf={ tasks:[], events:[] }; try{ cf=window.kalMyConflicts?window.kalMyConflicts(28):cf; }catch(e){}
  const rows=cf.tasks.filter(t=>!t.over).map(t=>`<div class="plan-item" role="button" tabindex="0" onclick="crmMeineOpen(${jsq(t.kind)},${jsq(t.tree||'')},${jsq(t.cid)},${jsq(t.id)})"><span class="plan-barc" style="background:var(--danger,#c0392b)"></span><div class="plan-main"><div class="plan-t">${esc(t.text)} <span class="plan-sub">· ${t.kanal?'Beitrag '+esc(t.kanal):'Aufgabe'}</span></div><div class="plan-row"><span class="plan-tag crit">${esc(t.issue)}</span><span class="plan-tag">${esc(t.src)}</span></div></div><span class="plan-when">${esc(fmt(t.due))}</span></div>`)
    .concat(cf.events.map(e=>`<div class="plan-item"><span class="plan-barc" style="background:var(--danger,#c0392b)"></span><div class="plan-main"><div class="plan-t">${esc(e.titel)} <span class="plan-sub">· ${e.typ==='va'?'Veranstaltung':'Termin'}</span></div><div class="plan-row"><span class="plan-tag crit">du bist eingeplant, aber abwesend</span></div></div><span class="plan-when">${esc(fmt(e.von))}</span></div>`)).join('');
  return `<section class="plan-card"><div class="plan-h"><h2>⚠ Hinweise</h2><span class="plan-sub">betrifft mich · 4 Wochen</span></div>${rows||'<div class="plan-empty">Keine Konflikte in den nächsten 4 Wochen.</div>'}</section>`;
}
function _termCard(){
  const today=iso(new Date()), until=iso(addD(new Date(),14)); const out=[];
  try{ _vasSorted().forEach(v=>{ const s=String(v.start||'').slice(0,10), e=String(v.ende||v.start||'').slice(0,10); if(!s||e<today||s>until) return; if(!(v.mitarbeiter||[]).includes(me())) return; out.push({ t:v.titel||'Veranstaltung', d:s, k:'va', id:v.id }); }); }catch(e){}
  try{ const crm=(CD.getCrm&&CD.getCrm())||{}; const R=new Set(['vorlagen','teamprojekte','access','config','verteiler','veranstaltungen','workflows','pathAccess','shopItems','shopPlaces','shopOrders','shopLog','shopLoans','shopConfig','userPrefs']);
    Object.keys(crm).forEach(tk=>{ if(R.has(tk)) return; const es=crm[tk]; if(!es||typeof es!=='object') return; Object.values(es).forEach(e=>{ (e&&e.termine||[]).forEach(t=>{ if(!t||!t.datum) return; const s=t.datum, en=t.bis||t.datum; if(en<today||s>until) return; if(!(t.mitarbeiter||[]).includes(me())) return; out.push({ t:t.titel||'Termin', d:s, k:'te', tree:tk, eid:e.id, tid:t.id }); }); }); }); }catch(e){}
  out.sort((a,b)=>a.d.localeCompare(b.d));
  const row=x=>`<div class="plan-item" role="button" tabindex="0" onclick="${x.k==='va'?`planVaSet(${jsq(x.id)})`:`crmOpenTerminFromHome(${jsq(x.tree)},${jsq(x.eid)},${jsq(x.tid)})`}"><span class="plan-barc" style="background:${x.k==='va'?'var(--danger,#dc2626)':'var(--warn,#d97706)'}"></span><div class="plan-main"><div class="plan-t">${esc(x.t)}</div><div class="plan-sub">${x.k==='va'?'Veranstaltung':'Termin'}</div></div><span class="plan-when">${esc(fmt(x.d))}</span></div>`;
  return `<section class="plan-card"><div class="plan-h"><h2>📅 Meine Termine</h2><span class="plan-sub">nächste 14 Tage</span></div>${out.map(row).join('')||'<div class="plan-empty">Keine Termine, in denen du eingeplant bist.</div>'}</section>`;
}
function _whoCard(){
  const now=new Date(); const mon=addD(now,-dowMon(now)); const days=[0,1,2,3,4].map(i=>addD(mon,i)); const abs=_abs();
  const kw=(()=>{ const t=new Date(Date.UTC(mon.getFullYear(),mon.getMonth(),mon.getDate())); const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3); const ft=new Date(Date.UTC(t.getUTCFullYear(),0,4)); const fd=(ft.getUTCDay()+6)%7; ft.setUTCDate(ft.getUTCDate()-fd+3); return 1+Math.round((t-ft)/6048e5); })();
  // Rechte wie im Kalender (kal_ansehen: alle/team/eigene, kal_abw: Abwesenheiten anderer) – im Zweifel nur ich
  let emps=[]; try{ emps=window.kalVisibleEmps?window.kalVisibleEmps():_emps().filter(u=>u.id===me()); }catch(e){ emps=_emps().filter(u=>u.id===me()); }
  const today=iso(now);
  let h=`<div class="plan-who" style="grid-template-columns:minmax(64px,140px) repeat(5,minmax(0,1fr))"><div></div>${days.map(d=>`<div class="plan-whoh${iso(d)===today?' today':''}">${DOW[dowMon(d)]} ${d.getDate()}.</div>`).join('')}`;
  // Nur die eigenen Teams (Haupt- + Zweit-/Dritt-Teams aus der Verwaltung); wer keinem Team angehört, sieht alle (Rechte oben)
  const tOf=u=>[...new Set([u.team].concat(Array.isArray(u.teams)?u.teams:[]).filter(Boolean))];
  const myT=_myTeams();
  const groups=[]; const shown=new Set();
  if(myT.length){ myT.forEach(t=>{ const g=emps.filter(u=>!shown.has(u.id) && tOf(u).includes(t)); g.forEach(u=>shown.add(u.id)); if(g.length) groups.push([t,g]); }); }
  else groups.push(['',emps]);
  const cell=u=>`<div class="plan-whon">${esc(u.name)}</div>`+days.map(d=>{ const x=iso(d); const ab=abs.some(a=>a.emp===u.id&&a.von<=x&&x<=a.bis); return `<div class="plan-whoc${ab?' abw':''}">${ab?'Abwesend':''}</div>`; }).join('');
  groups.forEach(([t,g])=>{ if(t && myT.length>1) h+=`<div class="plan-whot">${esc(t)}</div>`; g.forEach(u=>{ h+=cell(u); }); });
  h+='</div>';
  const n=groups.reduce((a,g)=>a+g[1].length,0);
  const sub=myT.length?(myT.length>1?'deine Teams':'dein Team')+': '+myT.map(esc).join(', ')+' · ':'';
  return `<section class="plan-card plan-wide"><div class="plan-h"><h2>Wer ist diese Woche da?</h2><span class="plan-sub">${sub}KW ${kw} · nur „Abwesend", ohne Grund</span></div>${n?h:'<div class="plan-empty">Keine Personen sichtbar.</div>'}</section>`;
}
function renderPlanungStart(){
  const root=document.getElementById('planung-root'); if(!root) return;
  window._planActive=true; window._planTab='start';
  const go=()=>{ try{
    root.innerHTML=planBarHtml('start')+`<div class="plan-body"><div class="plan-grid"><div>${_todoCard()}</div><div class="plan-col">${_hintCard()}${_termCard()}</div></div>${_whoCard()}</div>`;
  }catch(e){ console.error('Planung Start:', e); root.innerHTML=planBarHtml('start')+'<div class="plan-body"><div class="plan-empty">Die Übersicht konnte nicht geladen werden.</div></div>'; } };
  go();
  try{ if(CD.ensureCrmReady) CD.ensureCrmReady().then(()=>{ if(window._planTab==='start' && document.getElementById('planung-root')===root) go(); }).catch(()=>{}); }catch(e){}
  _label();
}

// ── Stil (einmal) – Design-Variablen der App, keine festen Farben außer Teamfarben ──
function _styles(){
  if(document.getElementById('plan-styles')) return;
  const st=document.createElement('style'); st.id='plan-styles';
  st.textContent=`
  /* Teamfarben (Planung, Kalender-Jahr, Teamseite) – hell/dunkel, keine festen Farben im Code */
  #planung-root{flex:1;min-height:0;overflow:auto;background:var(--bg,#f3f5f9)}
  .plan-bar{display:flex;flex-wrap:nowrap;gap:6px;padding:10px 12px;margin:14px 18px 0;background:var(--surface,#fff);border:1px solid var(--border,#dce3ec);border-radius:12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .plan-bar::-webkit-scrollbar{display:none}
  .plan-tab{flex:none;white-space:nowrap}
  .plan-tab .pl-short{display:none}
  @media(max-width:640px){ .plan-tab .pl-long{display:none} .plan-tab .pl-short{display:inline} .plan-tab{padding:8px 12px;font-size:14px;min-height:42px} .crm-team-chips .btn-sm-crm,.red-ph,.red-seg button,.plan-item{min-height:42px} }
  .plan-tab{border:0;background:transparent;color:var(--muted,#5d7086);font:inherit;font-size:15px;font-weight:600;padding:9px 14px;border-radius:9px;cursor:pointer}
  .plan-tab:hover{color:var(--primary-d,#15263a);background:var(--surface-2,#f4f7fb)}
  .plan-tab.on{background:var(--primary,#203869);color:var(--on-primary,#fff)}
  .plan-tab:focus-visible{outline:2px solid var(--primary,#203869);outline-offset:2px}
  .plan-body{padding:16px 18px 40px;display:grid;gap:16px}
  .plan-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);gap:16px;align-items:start}
  .plan-col{display:grid;gap:16px}
  @media(max-width:480px){ .plan-bar{display:grid;grid-template-columns:1fr 1fr;overflow:visible} .plan-bar .plan-tab{text-align:center} }
  @media(max-width:860px){ .plan-grid{grid-template-columns:1fr} .plan-bar{margin:10px 10px 0} .plan-body{padding:12px 10px 30px} }
  .plan-card{background:var(--surface,#fff);border:1px solid var(--border,#dce3ec);border-radius:14px;padding:16px 18px;min-width:0}
  .plan-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;margin:0 0 10px}
  .plan-h h2{margin:0;font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--primary-d,#15263a)}
  .plan-sub{font-size:13px;color:var(--muted,#5d7086);font-weight:400}
  .plan-grp{font-size:13px;font-weight:700;color:var(--muted,#5d7086);margin:10px 0 6px}
  .plan-grp.crit{color:var(--danger,#c0392b)}
  .plan-item{display:flex;gap:12px;align-items:flex-start;background:var(--surface-2,#f6f8fb);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer}
  .plan-item:hover{background:var(--info-bg,#eef3fb)}
  .plan-item:not([role]){cursor:default}
  .plan-item:not([role]):hover{background:var(--surface-2,#f6f8fb)}
  .plan-item[role]:focus-visible{outline:2px solid var(--primary,#203869);outline-offset:2px}
  .plan-barc{flex:none;width:4px;align-self:stretch;border-radius:3px}
  .plan-main{flex:1;min-width:0}
  .plan-t{font-weight:700;color:var(--primary-d,#15263a)}
  .plan-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}
  .plan-tag{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--border,#dce3ec);background:var(--surface,#fff);color:var(--muted,#5d7086)}
  .plan-tag.crit{background:var(--danger-bg,#fde8e8);color:var(--danger,#b42318);border-color:transparent}
  .plan-tag.warn{background:var(--warn-bg,#fef3c7);color:var(--warn-text,#7a4a00);border-color:transparent}
  .plan-when{flex:none;font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted,#5d7086);font-family:ui-monospace,Consolas,monospace}
  .plan-empty{color:var(--muted,#5d7086);font-size:14px;padding:6px 2px}
  .plan-who{display:grid;gap:4px;align-items:center;overflow-x:auto}
  .plan-who > *{min-width:0}
  .plan-whoh{font-size:12px;color:var(--muted,#5d7086);text-align:center;font-family:ui-monospace,Consolas,monospace}
  .plan-whoh.today{color:var(--primary,#203869);font-weight:700}
  .plan-whot{grid-column:1 / -1;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5d7086);padding:8px 0 2px}
  .plan-whon{font-size:14px;color:var(--primary-d,#15263a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .plan-whoc{height:22px;border-radius:5px;background:var(--ok-bg,#e3f3e9);font-size:12px;color:var(--on-primary,#fff);display:flex;align-items:center;justify-content:center;font-weight:600;overflow:hidden;white-space:nowrap}
  @media(max-width:640px){ .plan-whoc{font-size:0} .plan-whoc.abw::after{content:'abw.';font-size:12px} .plan-whoh{font-size:12px} }
  .plan-whoc.abw{background:var(--info,#2563eb)}
  `;
  document.head.appendChild(st);
}

try{ Object.assign(window, { planOpenMyProj, planNewMyProj, planGo, planBarHtml, planTeamSet, planVaSet, renderPlanungStart, planTabs }); }catch(e){}
export { renderPlanungStart };
// Tastatur: Einträge mit role=button per Enter/Leertaste öffnen
document.addEventListener('keydown', e=>{ if(e.key!=='Enter' && e.key!==' ') return; const t=e.target; if(!t || !t.classList || !t.classList.contains('plan-item') || t.getAttribute('role')!=='button') return; e.preventDefault(); t.click(); });
