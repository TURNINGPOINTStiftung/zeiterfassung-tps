// ══════════════════════════════════════════════════════════════════
//  CRM-UI  –  Einträge (Vereine/Sozialakteure/Fundraising) = "Projekte"
//  Aufgaben am Eintrag (Team + Zuständige), Team-Sammelansicht, Vorlagen
// ══════════════════════════════════════════════════════════════════
//  Selbst-registrierendes, isoliertes Modul. Alles in try/catch, damit
//  ein Fehler hier niemals die Zeiterfassung beeinträchtigt.

import { openModal, closeModal, toast } from '../utils.js';
import { getData } from '../data.js';   // NUR Lesen (Teams, Nutzer) – nie schreiben
import {
  ensureCrmReady, setCrmRenderHook, getCrm, getEntity, listEntities,
  saveEntity, deleteEntity, newId,
  saveVorlage, deleteVorlage, getVorlage, listVorlagen,
  saveTeamProjekt, deleteTeamProjekt, getTeamProjekt, listTeamProjekte,
  saveAccess, getAccess
} from './crm-data.js';
import {
  TREES, treeByKey, stammFields, MEMBER_FUNCTIONS,
  getAiEndpoint, setAiEndpoint,
  TASK_STATUS, taskStatusByKey, FALLBACK_TEAMS
} from './crm-config.js';

// ── kleine Helfer ──────────────────────────────────────────────────
const esc = s => String(s==null?'':s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const nl2br = s => esc(s).replace(/\n/g,'<br>');
const val   = id => { const el=document.getElementById(id); return el ? el.value.trim() : ''; };
const fmtDate = ts => { try{ return new Date(ts).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});}catch(e){return '';} };
const fmtDateTime = ts => { try{ return new Date(ts).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';} };

// Namenskürzel (Initialen) – für Datums-/Namensstempel an Notizen & Einträgen
function initials(name){
  const n=String(name||'').trim(); if(!n) return '';
  const parts=n.split(/\s+/);
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function curName(){ return (window.cu&&window.cu.name)||''; }
function curKuerzel(){ return initials(curName()); }

function curEntity(){ return window._crmSelId ? getEntity(window._crmTree, window._crmSelId) : null; }

// Eintrag laden → ändern → speichern (mit Änderungs-Stempel)
function mutateEntity(fn){
  const ent = curEntity(); if(!ent) return;
  try{ fn(ent); }catch(e){ console.error('CRM mutate:',e); return; }
  ent.updatedByKuerzel = curKuerzel();
  ent.updatedByName    = curName();
  saveEntity(window._crmTree, ent);
}
// ── Aufgaben-Container: Eintrag ODER eigenständiges Team-Projekt ────
// Die Aufgaben-Engine (Haupt/Unter/Abhängigkeiten/Vorlagen) läuft über
// diese Abstraktion, damit sie an beiden Orten identisch funktioniert.
// ctx = { kind:'entity', tree, eid }  ODER  { kind:'teamprojekt', id }
// _crmAfterTask steuert, welche Ansicht nach einer Aufgaben-Aktion neu rendert.
function isTPCtx(){ return !!(window._crmTaskCtx && window._crmTaskCtx.kind==='teamprojekt'); }
function curContainer(){
  const ctx=window._crmTaskCtx; if(!ctx) return null;
  const c = ctx.kind==='teamprojekt' ? getTeamProjekt(ctx.id) : getEntity(ctx.tree, ctx.eid);
  if(c) normTasks(c);
  return c;
}
function mutateContainer(fn){
  const ctx=window._crmTaskCtx; if(!ctx) return;
  if(ctx.kind==='teamprojekt'){
    const p=getTeamProjekt(ctx.id); if(!p) return; normTasks(p);
    try{ fn(p); }catch(e){ console.error('CRM mutateContainer:',e); return; }
    p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
    saveTeamProjekt(p);
  } else {
    const ent=getEntity(ctx.tree, ctx.eid); if(!ent) return; normTasks(ent);
    try{ fn(ent); }catch(e){ console.error('CRM mutateContainer:',e); return; }
    ent.updatedByKuerzel=curKuerzel(); ent.updatedByName=curName();
    saveEntity(ctx.tree, ent);
  }
}
function repaintContainer(){
  switch(window._crmAfterTask){
    case 'projektdetail': paintTeamProjektDetail(); break;
    case 'teamdetail':    paintTeamDetail(); break;
    default:              paintDetail();
  }
}

// ── Read-only aus der Zeiterfassung (Teams & Nutzer) ───────────────
function zeTeams(){
  try{ const t=getData().teams; if(Array.isArray(t)&&t.length) return t.slice(); }catch(e){}
  return FALLBACK_TEAMS.slice();
}
function zeUsers(){
  try{ const u=getData().users; if(Array.isArray(u)) return u; }catch(e){}
  return [];
}
function userName(id){ const u=zeUsers().find(x=>x.id===id); return u?u.name:''; }
// Mitarbeitende eines Teams (für Zuständig-Dropdown). Ohne Team → alle.
function teamMembers(team){
  const us=zeUsers().filter(u=>u.id!=='admin');
  const list = !team ? us : us.filter(u=> u.team===team || (Array.isArray(u.teams)&&u.teams.includes(team)) );
  return list.map(u=>({id:u.id, name:u.name}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
}
function assigneeOptsHtml(team, selId){
  const opts=[`<option value="">– niemand –</option>`];
  teamMembers(team).forEach(u=>{ opts.push(`<option value="${esc(u.id)}" ${u.id===selId?'selected':''}>${esc(u.name)}</option>`); });
  return opts.join('');
}

// ── CRM-Zugriff des angemeldeten Nutzers ───────────────────────────
function accessLevel(){
  const cu=window.cu; if(!cu) return 'none';
  if(cu.role==='admin') return 'admin';
  const a=getAccess(cu.id);
  return (a && a.level) || 'none';
}
function accessVerein(){ const cu=window.cu; if(!cu) return ''; const a=getAccess(cu.id); return (a && a.vereinId) || ''; }
function crmRestricted(){ return accessLevel()==='verein'; }

// Modul-Leiste je nach Rechten ein-/ausblenden (von initApp aufgerufen).
function crmSetupModuleBar(){
  try{
    const cu=window.cu; if(!cu) return;
    const isAdmin=cu.role==='admin';
    const bar=document.getElementById('module-bar');
    if(bar) bar.style.display='flex';  // einziger Header → nach Login immer sichtbar
    ensureCrmReady().then(()=>{
      const lvl=accessLevel();
      const hasCrm = isAdmin || lvl==='full' || lvl==='verein';
      const show={ zeiterfassung:true, website:isAdmin, forum:isAdmin, crm:hasCrm, verwaltung:isAdmin };
      let count=0;
      Object.keys(show).forEach(mod=>{
        const b=document.querySelector('.mb-mod[data-mod="'+mod+'"]');
        if(b) b.style.display=show[mod]?'':'none';
        if(show[mod]) count++;
      });
      // ☰-Menü nur zeigen, wenn es mehr als ein Modul gibt
      const menuBtn=document.getElementById('mb-menu-btn'); if(menuBtn) menuBtn.style.display=count>1?'':'none';
      // Benutzerverwaltung/Berechtigungen früh in die Verwaltungs-Ebene umhängen
      if(isAdmin){ try{ ensureVerwMounted(); }catch(e){} }
    }).catch(()=>{});
  }catch(e){ console.error('crmSetupModuleBar:',e); }
}

// ── Styles (einmalig injizieren) ───────────────────────────────────
function injectStyles(){
  if(document.getElementById('crm-styles')) return;
  const css = `
  #crm-root{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--bg)}
  .crm-bar{display:flex;align-items:center;gap:10px;padding:10px 22px;background:#fff;border-bottom:1px solid var(--border);flex-wrap:wrap;position:sticky;top:0;z-index:20}
  .crm-trees{display:flex;gap:4px;flex-wrap:wrap}
  .crm-tree-tab{background:none;border:1.5px solid var(--border);border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;transition:all .15s}
  .crm-tree-tab:hover{border-color:var(--primary);color:var(--primary)}
  .crm-tree-tab.active{background:var(--primary);border-color:var(--primary);color:#fff}
  .crm-search{margin-left:auto;padding:7px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;min-width:180px;color:var(--text)}
  .crm-search:focus{outline:none;border-color:var(--primary-l)}
  .crm-body{padding:18px 22px;overflow-y:auto;flex:1}
  .crm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .crm-card{background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:14px 16px;cursor:pointer;transition:box-shadow .15s,border-color .15s}
  .crm-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.08);border-color:var(--primary-l)}
  .crm-card h3{font-size:15px;font-weight:700;color:var(--primary);margin:0 0 4px}
  .crm-card .sub{font-size:12px;color:var(--muted);margin-bottom:8px;white-space:pre-line}
  .crm-card .meta{display:flex;gap:8px;flex-wrap:wrap}
  .crm-chip{font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:2px 8px;color:var(--muted)}
  .crm-chip.warn{background:#fff4e5;border-color:#ffd9a0;color:#b56a00}
  .crm-empty{text-align:center;color:var(--muted);padding:60px 20px}
  .crm-detail-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .crm-detail-head h2{font-size:22px;font-weight:700;color:var(--primary);margin:0;flex:1;min-width:200px}
  .crm-sec{background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:14px}
  .crm-sec h4{font-size:13px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.5px;margin:0 0 12px;display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
  .crm-sec h4 .ttl{display:flex;align-items:center;gap:8px}
  .crm-sec h4 .hbtns{display:flex;gap:6px;flex-wrap:wrap}
  .crm-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 18px}
  .crm-field label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block}
  .crm-field .v{font-size:14px;color:var(--text);margin-top:2px;white-space:pre-line}
  .crm-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border);flex-wrap:wrap}
  .crm-row:first-of-type{border-top:none}
  .crm-row .grow{flex:1;min-width:140px}
  .crm-row .name{font-weight:600;color:var(--text)}
  .crm-row .fn{font-size:11px;color:#fff;background:var(--primary-l);border-radius:10px;padding:2px 8px;white-space:nowrap}
  .crm-row .small{font-size:12px;color:var(--muted)}
  .crm-x{background:none;border:none;color:#c0392b;cursor:pointer;font-size:15px;padding:2px 6px;border-radius:5px}
  .crm-x:hover{background:#fdecea}
  .crm-task{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border);flex-wrap:wrap}
  .crm-task:first-of-type{border-top:none}
  .crm-task.done .tx{text-decoration:line-through;color:var(--muted)}
  .crm-task .tx{font-weight:600;color:var(--text)}
  .crm-tstatus{font-size:11px;font-weight:700;color:#fff;border-radius:12px;padding:2px 9px;white-space:nowrap}
  .crm-tsel{padding:4px 7px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;background:#fff}
  .crm-logitem{border-top:1px solid var(--border);padding:10px 0}
  .crm-logitem .lh{font-size:11px;color:var(--muted);margin-bottom:4px;display:flex;justify-content:space-between;gap:8px}
  .crm-logitem .lt{font-size:14px;color:var(--text);white-space:pre-line}
  .crm-logitem .ls{margin-top:6px;background:#eef7ee;border-left:3px solid var(--accent);border-radius:6px;padding:7px 10px;font-size:13px;color:#2c5e2e}
  .crm-add-inline{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .crm-add-inline input,.crm-add-inline select{padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:13px}
  .crm-add-inline input:focus,.crm-add-inline select:focus{outline:none;border-color:var(--primary-l)}
  .crm-ta{width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;resize:vertical}
  .crm-ta:focus{outline:none;border-color:var(--primary-l)}
  .crm-mic{background:#fff;border:1.5px solid var(--border);border-radius:8px;padding:7px 12px;cursor:pointer;font-size:14px;font-weight:600;color:var(--primary)}
  .crm-mic.rec{background:#fdecea;border-color:#e74c3c;color:#c0392b;animation:crmPulse 1.1s infinite}
  @keyframes crmPulse{0%,100%{opacity:1}50%{opacity:.55}}
  .crm-modal-field{margin-bottom:12px}
  .crm-modal-field label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:4px}
  .crm-modal-field input,.crm-modal-field select,.crm-modal-field textarea{width:100%;box-sizing:border-box;padding:8px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit}
  .crm-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
  .btn-sm-crm{padding:6px 12px;font-size:13px;border-radius:7px;border:1.5px solid var(--border);background:#fff;color:var(--primary);font-weight:600;cursor:pointer}
  .btn-sm-crm:hover{border-color:var(--primary)}
  .btn-sm-crm.primary{background:var(--primary);border-color:var(--primary);color:#fff}
  .btn-sm-crm.danger{color:#c0392b;border-color:#f0bcb6}
  .crm-team-group{margin-bottom:22px}
  .crm-team-h{font-size:14px;font-weight:700;color:var(--primary);margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--primary);display:flex;align-items:center;gap:8px;cursor:pointer}
  .crm-mtask{border:1.5px solid var(--border);border-radius:9px;padding:6px 10px;margin-bottom:10px;background:var(--row-alt)}
  .crm-mtask>.crm-task:first-child{border-top:none}
  .crm-subs{margin:2px 0 2px 12px;padding-left:10px;border-left:2px solid var(--border)}
  .crm-task.sub{padding:6px 0}
  .crm-task.blocked{opacity:.7}
  .crm-locked{color:#b56a00;font-weight:600}
  .crm-deps-box{max-height:150px;overflow:auto;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;background:#fff}
  .crm-deps-box label{display:block;font-size:13px;margin:3px 0;cursor:pointer}
  .crm-tnode.top{border:1.5px solid var(--border);border-radius:9px;padding:4px 10px;margin-bottom:10px;background:var(--row-alt)}
  .crm-tnode>.crm-task{border-top:none}
  .crm-check{width:18px;height:18px;cursor:pointer;flex-shrink:0;margin:0}
  .crm-stats{width:100%;border-collapse:collapse;font-size:13px}
  .crm-stats th{text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:5px 8px;border-bottom:2px solid var(--border);white-space:nowrap}
  .crm-stats td{padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
  .crm-delta{font-size:11px;font-weight:700}
  .crm-delta.up{color:var(--accent)} .crm-delta.down{color:#c0392b}
  @media(max-width:640px){.crm-bar{padding:8px 12px}.crm-body{padding:12px}.crm-search{min-width:120px}}
  `;
  const st=document.createElement('style'); st.id='crm-styles'; st.textContent=css;
  document.head.appendChild(st);
}

// ── Einstieg ───────────────────────────────────────────────────────
export function renderCRM(){
  try{
    injectStyles();
    if(!window._crmTree) window._crmTree = TREES[0].key;
    if(!window._crmMode) window._crmMode = 'kontakte';
    window._crmModalOpen = false;
    const root = document.getElementById('crm-root');
    if(!root) return;
    root.innerHTML = '<div class="crm-empty">Lade CRM …</div>';
    ensureCrmReady().then(()=>{
      try{
        if(crmRestricted()){ window._crmMode='kontakte'; window._crmTree='vereine'; window._crmSelId=accessVerein(); }
        paint();
      }catch(e){ console.error('CRM paint:',e); }
    });
  }catch(e){ console.error('renderCRM Fehler:',e); }
}
setCrmRenderHook(()=>{ try{ paint(); }catch(e){} });

function paint(){
  window._crmModalOpen = false;
  if(crmRestricted()){
    if(window._crmSelId && curEntity()) paintDetail();
    else { const root=document.getElementById('crm-root'); if(root) root.innerHTML = barHtml()+`<div class="crm-body"><div class="crm-empty">Dir ist noch kein Verein zugeordnet.<br>Bitte an die Administration wenden.</div></div>`; }
    return;
  }
  const mode = window._crmMode || 'kontakte';
  if(mode==='teams'){
    if(window._crmTeamProjSel && getTeamProjekt(window._crmTeamProjSel)) paintTeamProjektDetail();
    else if(window._crmTeamSel) paintTeamDetail();
    else paintTeamsList();
    return;
  }
  if(window._crmSelId && curEntity()) paintDetail();
  else { window._crmSelId = null; paintList(); }
}

// ── Bar ────────────────────────────────────────────────────────────
function barHtml(){
  if(crmRestricted()){
    const e=curEntity(); const nm=(e&&e.stamm)?e.stamm.name:'';
    return `<div class="crm-bar"><div class="crm-trees"><span style="font-weight:700;color:var(--primary)">📇 CRM${nm?' · '+esc(nm):''}</span></div></div>`;
  }
  const mode = window._crmMode || 'kontakte';
  const treeTabs = TREES.map(t=>
    `<button class="crm-tree-tab${(mode==='kontakte'&&t.key===window._crmTree)?' active':''}" onclick="crmSwitchTree('${t.key}')">${t.icon} ${esc(t.label)}</button>`
  ).join('');
  const teamsTab = `<button class="crm-tree-tab${mode==='teams'?' active':''}" style="margin-left:8px" onclick="crmShowTeams()">👥 Teams</button>`;
  const aiOn = getAiEndpoint() ? '✓' : '–';
  let right = '';
  if(mode==='kontakte'){
    right = `<input class="crm-search" type="search" placeholder="Suchen …" value="${esc(window._crmSearch||'')}" oninput="crmSearch(this.value)">
      <button class="btn-sm-crm primary" onclick="crmOpenNew()">＋ Neu</button>`;
  } else {
    right = `<span style="margin-left:auto"></span>`;
  }
  return `<div class="crm-bar">
    <div class="crm-trees">${treeTabs}${teamsTab}</div>
    ${right}
    <button class="btn-sm-crm" title="Aufgaben-Vorlagen verwalten" onclick="crmOpenVorlagen()">📋 Vorlagen</button>
    <button class="btn-sm-crm" title="KI-Proxy für Zusammenfassungen" onclick="crmConfigAi()">⚙️ KI ${aiOn}</button>
  </div>`;
}

// ── Liste der Einträge ─────────────────────────────────────────────
function paintList(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const tree = treeByKey(window._crmTree);
  const q = (window._crmSearch||'').toLowerCase().trim();
  let items = listEntities(window._crmTree);
  if(q){
    items = items.filter(e=>{
      const s=e.stamm||{};
      const hay=[s.name,s.adresse,s.sitz,s.tags,s.email].map(x=>String(x||'').toLowerCase()).join(' ');
      const ctxt=(e.kontakte||[]).map(k=>k.name+' '+k.funktion).join(' ').toLowerCase();
      return (hay+' '+ctxt).includes(q);
    });
  }
  const cards = items.map(e=>{
    const s=e.stamm||{};
    const openTodos=(e.todos||[]).filter(t=>t.status!=='erledigt').length;
    const kCount=(e.kontakte||[]).length;
    const sub=[s.sitz,s.adresse].filter(Boolean).join(' · ');
    return `<div class="crm-card" onclick="crmOpenDetail('${e.id}')">
      <h3>${esc(s.name||'(ohne Name)')}</h3>
      ${sub?`<div class="sub">${esc(sub)}</div>`:''}
      <div class="meta">
        <span class="crm-chip">👤 ${kCount} Kontakt${kCount===1?'':'e'}</span>
        ${openTodos?`<span class="crm-chip warn">✓ ${openTodos} Aufgabe${openTodos===1?'':'n'}</span>`:''}
      </div>
    </div>`;
  }).join('');
  root.innerHTML = barHtml() + `<div class="crm-body">${
    items.length ? `<div class="crm-list">${cards}</div>`
                 : `<div class="crm-empty">Noch keine ${esc(tree.label)}.<br><br><button class="btn-sm-crm primary" onclick="crmOpenNew()">＋ ${esc(tree.single)} anlegen</button></div>`
  }</div>`;
}

// ── Aufgaben: hierarchisch (Hauptaufgabe + Unterpunkte) + Abhängigkeiten
// Datenmodell je Eintrag:
//   e.todos = [ { id, text, team, assigneeId, assigneeName, due, status,
//                 deps:[ids], subs:[ { id, text, assigneeId, assigneeName,
//                                      due, status, deps:[ids] } ] } ]
// Eine Aufgabe ist „blockiert", solange eine ihrer deps nicht 'erledigt' ist.

// Knoten-Normalisierung: altes `subs` → `children`, Felder absichern (rekursiv)
function normNode(n){
  if(n.subs && !n.children) n.children=n.subs;
  if(n.subs) delete n.subs;
  if(!Array.isArray(n.children)) n.children=[];
  if(!Array.isArray(n.deps)) n.deps=[];
  n.children.forEach(normNode);
}
function normTasks(c){ if(c && Array.isArray(c.todos)) c.todos.forEach(normNode); return c; }

// Flache Liste aller Knoten eines Arrays (rekursiv) mit Tiefe
function flatNodes(arr){
  const out=[];
  const walk=(n,d)=>{ out.push({ id:n.id, text:n.text, status:n.status, depth:d, ref:n }); (n.children||[]).forEach(ch=>walk(ch,d+1)); };
  (arr||[]).forEach(n=>walk(n,0));
  return out;
}
// Knoten + Elternarray in einem Array finden
function findNodeIn(arr, id){
  let res=null;
  const walk=(n, parent, a)=>{ if(n.id===id){ res={ node:n, parent, arr:a }; } (n.children||[]).forEach(ch=>walk(ch, n, n.children)); };
  (arr||[]).forEach(n=>walk(n, null, arr));
  return res;
}
function flatTasks(c){ return flatNodes(c.todos); }
function findNode(c, id){ return findNodeIn(c.todos, id); }
// Effektives Team eines Knotens = Team des obersten Vorfahren
function effectiveTeam(c, id){
  let found='';
  const walk=(n, depth, inherited)=>{ const t = depth===0 ? (n.team||'') : inherited; if(n.id===id) found=t; (n.children||[]).forEach(ch=>walk(ch, depth+1, t)); };
  (c.todos||[]).forEach(n=>walk(n,0,''));
  return found;
}
// Texte blockierender (noch nicht erledigter) deps – oder null
function blockingTexts(c, t){
  const deps=t&&t.deps; if(!Array.isArray(deps)||!deps.length) return null;
  const map={}; flatTasks(c).forEach(x=>map[x.id]=x);
  const open=deps.map(d=>map[d]).filter(x=>x && x.status!=='erledigt');
  return open.length?open.map(x=>x.text):null;
}
function statusOfId(c,id){ const x=flatTasks(c).find(y=>y.id===id); return x?x.status:null; }

// Rekursive Aufgaben-Darstellung (Detail-Ansicht: Eintrag & Team-Projekt)
function taskNodeHtml(c, n, depth){
  const st=taskStatusByKey(n.status);
  const blk=blockingTexts(c,n);
  const done=n.status==='erledigt';
  const parts=[];
  if(depth===0 && n.team) parts.push('👥 '+n.team);
  if(n.assigneeName) parts.push('👤 '+n.assigneeName);
  if(n.due) parts.push('📅 '+fmtDate(Date.parse(n.due)));
  const meta=parts.map(esc).join(' · ');
  const children=(n.children||[]).map(ch=>taskNodeHtml(c,ch,depth+1)).join('');
  return `<div class="crm-tnode${depth===0?' top':''}${done?' done':''}">
    <div class="crm-task${blk?' blocked':''}">
      <input type="checkbox" class="crm-check" ${done?'checked':''} ${(blk&&!done)?'disabled':''} title="Erledigt" onchange="crmToggleDone('${n.id}')">
      <span class="crm-tstatus" style="background:${st.color}">${esc(st.label)}</span>
      <div class="grow"><span class="tx">${esc(n.text)}</span>${meta?`<div class="small">${meta}</div>`:''}${blk?`<div class="small crm-locked">🔒 wartet auf: ${esc(blk.join(', '))}</div>`:''}</div>
      <button class="btn-sm-crm" title="Unterpunkt hinzufügen" onclick="crmAddChild('${n.id}')">＋</button>
      <button class="btn-sm-crm" title="Bearbeiten" onclick="crmOpenTask('${n.id}')">✎</button>
      <button class="crm-x" title="Löschen" onclick="crmDeleteNode('${n.id}')">✕</button>
    </div>
    ${(n.children&&n.children.length)?`<div class="crm-subs">${children}</div>`:''}
  </div>`;
}

// ── Detail eines Eintrags ──────────────────────────────────────────
function paintDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const e=curEntity(); if(!e){ window._crmSelId=null; paintList(); return; }
  normTasks(e);
  window._crmTaskCtx={ kind:'entity', tree:window._crmTree, eid:e.id };  // Engine zielt auf den Eintrag
  window._crmAfterTask='detail';
  const s=e.stamm||{};
  const tree=treeByKey(window._crmTree);

  const fields = stammFields(window._crmTree)
    .filter(f=>f.key!=='name')
    .map(f=>{ const v=s[f.key]; if(!v) return ''; const disp=f.type==='date'?esc(fmtDate(Date.parse(v))):nl2br(v); return `<div class="crm-field"><label>${esc(f.label)}</label><div class="v">${disp}</div></div>`; })
    .filter(Boolean).join('');

  const kontakte=(e.kontakte||[]).map(k=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(k.name)}</span>${k.funktion?` <span class="fn">${esc(k.funktion)}</span>`:''}
        ${(k.email||k.tel)?`<div class="small">${[k.email,k.tel].filter(Boolean).map(esc).join(' · ')}</div>`:''}
        ${k.note?`<div class="small">${esc(k.note)}</div>`:''}
      </div>
      <button class="btn-sm-crm" onclick="crmEditMember('${k.id}')">Bearbeiten</button>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteMember('${k.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Kontakte.</div>`;

  const _today=new Date().toISOString().slice(0,10);
  const terminRow=t=>{
    const start=t.datum||''; const end=t.bis||'';
    const dateStr = (end && end!==start) ? `${fmtDate(Date.parse(start))} – ${fmtDate(Date.parse(end))}`
                                         : (start?fmtDate(Date.parse(start)):'');
    return `<div class="crm-row">
      <div class="grow"><span class="name">${esc(t.titel)}</span>
        <div class="small">${[dateStr, t.ort].filter(Boolean).map(esc).join(' · ')}</div>
        ${t.note?`<div class="small">${esc(t.note)}</div>`:''}
      </div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteTermin('${t.id}')">✕</button>
    </div>`;
  };
  const allTermine=(e.termine||[]).slice().sort((a,b)=>(a.datumTs||0)-(b.datumTs||0));
  const isPast=t=>{ const end=t.bis||t.datum||''; return end && end < _today; };
  const upcoming=allTermine.filter(t=>!isPast(t));
  const past=allTermine.filter(isPast);
  const termine = (upcoming.map(terminRow).join('') || `<div class="small" style="color:var(--muted)">Keine anstehenden Termine.</div>`)
    + (past.length?`<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Vergangene Termine (${past.length})</summary><div style="margin-top:6px">${past.map(terminRow).join('')}</div></details>`:'');

  const angebote=(e.angebote||[]).map(a=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(a.titel)}</span>${a.note?`<div class="small">${esc(a.note)}</div>`:''}</div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteAngebot('${a.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Angebote.</div>`;

  const todos=(e.todos||[]).map(m=>taskNodeHtml(e,m,0)).join('') || `<div class="small" style="color:var(--muted)">Keine Aufgaben.</div>`;

  const log=(e.log||[]).slice().sort((a,b)=>b.ts-a.ts).map(l=>`
    <div class="crm-logitem">
      <div class="lh"><span>${esc(l.autor||'')}${l.kuerzel?` <strong>[${esc(l.kuerzel)}]</strong>`:''}</span><span>${fmtDateTime(l.ts)} <button class="crm-x" onclick="crmDeleteNote('${l.id}')">✕</button></span></div>
      <div class="lt">${nl2br(l.text||'')}</div>
      ${l.summary?`<div class="ls"><strong>KI-Zusammenfassung:</strong><br>${nl2br(l.summary)}</div>`:''}
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Notizen.</div>`;

  // Statistik (nur bei Vereinen)
  const statsSec = (window._crmTree==='vereine') ? statsSecHtml(e) : '';

  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      ${crmRestricted()?'':`<button class="btn-sm-crm" onclick="crmBackToList()">← ${esc(tree.label)}</button>`}
      <h2>${esc(s.name||'(ohne Name)')}</h2>
      <button class="btn-sm-crm" onclick="crmEditStamm()">✎ Stammdaten</button>
      ${crmRestricted()?'':`<button class="btn-sm-crm danger" onclick="crmDeleteEntity()">Löschen</button>`}
    </div>
    ${(e.createdAt||e.updatedByKuerzel)?`<div class="small" style="color:var(--muted);margin:-8px 0 14px">${
        e.createdAt?`angelegt ${e.createdByKuerzel?'von '+esc(e.createdByKuerzel)+' ':''}am ${esc(fmtDate(e.createdAt))}`:''
      }${e.updatedByKuerzel?` · zuletzt geändert von ${esc(e.updatedByKuerzel)}${e.updatedAt?' am '+esc(fmtDateTime(e.updatedAt)):''}`:''}</div>`:''}

    ${fields?`<div class="crm-sec"><h4><span class="ttl">📋 Stammdaten</span></h4><div class="crm-fields">${fields}</div></div>`:''}

    <div class="crm-sec">
      <h4><span class="ttl">✅ Aufgaben</span>
        <span class="hbtns">
          <button class="btn-sm-crm" onclick="crmApplyVorlagePick()">📋 Vorlage anwenden</button>
          <button class="btn-sm-crm primary" onclick="crmOpenTask('')">＋ Aufgabe</button>
        </span>
      </h4>
      ${todos}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">👥 Kontakte / Mitglieder</span><button class="btn-sm-crm" onclick="crmAddMember()">＋ Kontakt</button></h4>
      ${kontakte}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">📅 Termine</span><button class="btn-sm-crm" onclick="crmAddTermin()">＋ Termin</button></h4>
      ${termine}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">🎯 Angebote</span><button class="btn-sm-crm" onclick="crmAddAngebot()">＋ Angebot</button></h4>
      ${angebote}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">🧭 Status quo</span></h4>
      <textarea class="crm-ta" id="crm-statusquo" rows="3" placeholder="Wo stehen wir aktuell mit ${esc(s.name||'')}?">${esc(e.statusQuo||'')}</textarea>
      <div class="crm-modal-actions"><button class="btn-sm-crm primary" onclick="crmSaveStatusQuo()">Speichern</button></div>
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">💬 Interne Kommunikation</span><button class="btn-sm-crm primary" onclick="crmOpenNote()">🎤 Neue Notiz</button></h4>
      ${log}
    </div>

    ${statsSec}
  </div>`;
}

// ── Navigation ─────────────────────────────────────────────────────
function crmSwitchTree(key){ window._crmMode='kontakte'; window._crmTree=key; window._crmSelId=null; window._crmSearch=''; paintList(); }
function crmSearch(v){ window._crmSearch=v; paintList(); }
function crmOpenDetail(id){ window._crmMode='kontakte'; window._crmSelId=id; paintDetail(); }
function crmBackToList(){ window._crmSelId=null; paintList(); }

function crmOpenModalShell(){ window._crmModalOpen=true; }
function crmCloseModal(){ window._crmModalOpen=false; closeModal(); }

// ── Neu anlegen / Stammdaten bearbeiten ────────────────────────────
function stammFormHtml(s){
  return stammFields(window._crmTree).map(f=>{
    const v=esc(s[f.key]||'');
    const inp = f.type==='textarea'
      ? `<textarea id="crm-sf-${f.key}" rows="2">${v}</textarea>`
      : f.type==='date'
        ? `<input type="date" id="crm-sf-${f.key}" value="${v}">`
        : `<input id="crm-sf-${f.key}" value="${v}">`;
    return `<div class="crm-modal-field"><label>${esc(f.label)}${f.required?' *':''}${f.hint?` (${esc(f.hint)})`:''}</label>${inp}</div>`;
  }).join('');
}
function crmOpenNew(){
  crmOpenModalShell();
  const tree=treeByKey(window._crmTree);
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ ${esc(tree.single)} anlegen</h3>
    ${stammFormHtml({})}
    <div class="crm-modal-actions">
      <button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
      <button class="btn-sm-crm primary" onclick="crmSaveStamm(true)">Anlegen</button>
    </div>`);
}
function crmEditStamm(){
  const e=curEntity(); if(!e) return;
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✎ Stammdaten</h3>
    ${stammFormHtml(e.stamm||{})}
    <div class="crm-modal-actions">
      <button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
      <button class="btn-sm-crm primary" onclick="crmSaveStamm(false)">Speichern</button>
    </div>`);
}
function crmSaveStamm(isNew){
  const stamm={};
  stammFields(window._crmTree).forEach(f=>{ stamm[f.key]=val('crm-sf-'+f.key); });
  if(!stamm.name){ toast('Bitte einen Namen eingeben.','err'); return; }
  if(isNew){
    const id=newId();
    const ent={ id, tree:window._crmTree, createdAt:Date.now(),
      createdByKuerzel:curKuerzel(), createdByName:curName(), stamm,
      kontakte:[], termine:[], angebote:[], statusQuo:'', todos:[], log:[] };
    saveEntity(window._crmTree, ent);
    window._crmSelId=id;
    crmCloseModal(); paintDetail(); toast('Angelegt ✓','ok');
  } else {
    mutateEntity(e=>{ e.stamm=stamm; });
    crmCloseModal(); paintDetail(); toast('Gespeichert ✓','ok');
  }
}
function crmDeleteEntity(){
  const e=curEntity(); if(!e) return;
  if(!confirm(`„${(e.stamm&&e.stamm.name)||''}" wirklich löschen?`)) return;
  deleteEntity(window._crmTree, e.id);
  window._crmSelId=null; paintList(); toast('Gelöscht.','');
}

// ── Kontakte / Mitglieder ──────────────────────────────────────────
function memberFormHtml(k){
  const opts=MEMBER_FUNCTIONS.map(f=>`<option ${k.funktion===f?'selected':''}>${esc(f)}</option>`).join('');
  return `
   <div class="crm-modal-field"><label>Name *</label><input id="crm-mf-name" value="${esc(k.name||'')}"></div>
   <div class="crm-modal-field"><label>Funktion im Verein</label><select id="crm-mf-fn"><option value="">– keine –</option>${opts}</select></div>
   <div class="crm-modal-field"><label>E-Mail</label><input id="crm-mf-email" value="${esc(k.email||'')}"></div>
   <div class="crm-modal-field"><label>Telefon</label><input id="crm-mf-tel" value="${esc(k.tel||'')}"></div>
   <div class="crm-modal-field"><label>Notiz</label><input id="crm-mf-note" value="${esc(k.note||'')}"></div>`;
}
function crmAddMember(){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Kontakt</h3>${memberFormHtml({})}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveMember('')">Hinzufügen</button></div>`);
}
function crmEditMember(mid){
  const e=curEntity(); if(!e) return;
  const k=(e.kontakte||[]).find(x=>x.id===mid); if(!k) return;
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✎ Kontakt</h3>${memberFormHtml(k)}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveMember('${mid}')">Speichern</button></div>`);
}
function crmSaveMember(mid){
  const name=val('crm-mf-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const rec={ name, funktion:val('crm-mf-fn'), email:val('crm-mf-email'), tel:val('crm-mf-tel'), note:val('crm-mf-note') };
  mutateEntity(e=>{
    if(!Array.isArray(e.kontakte)) e.kontakte=[];
    if(mid){ const k=e.kontakte.find(x=>x.id===mid); if(k) Object.assign(k,rec); }
    else { rec.id=newId(); e.kontakte.push(rec); }
  });
  crmCloseModal(); paintDetail();
}
function crmDeleteMember(mid){
  mutateEntity(e=>{ e.kontakte=(e.kontakte||[]).filter(x=>x.id!==mid); });
  paintDetail();
}

// ── Termine ────────────────────────────────────────────────────────
function crmAddTermin(){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Termin / Training</h3>
   <div class="crm-modal-field"><label>Titel *</label><input id="crm-tf-titel" placeholder="z. B. Training, Treffen …"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Von</label><input id="crm-tf-datum" type="date"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Bis (optional)</label><input id="crm-tf-bis" type="date"></div>
   </div>
   <div class="crm-modal-field"><label>Ort</label><input id="crm-tf-ort"></div>
   <div class="crm-modal-field"><label>Notiz</label><input id="crm-tf-note"></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveTermin()">Hinzufügen</button></div>`);
}
function crmSaveTermin(){
  const titel=val('crm-tf-titel'); if(!titel){ toast('Bitte einen Titel eingeben.','err'); return; }
  const datum=val('crm-tf-datum'); let bis=val('crm-tf-bis');
  if(bis && datum && bis<datum) bis=datum;  // Ende nie vor Beginn
  mutateEntity(e=>{
    if(!Array.isArray(e.termine)) e.termine=[];
    e.termine.push({ id:newId(), titel, datum, bis, datumTs:datum?Date.parse(datum):null, ort:val('crm-tf-ort'), note:val('crm-tf-note') });
    e.termine.sort((a,b)=>(a.datumTs||0)-(b.datumTs||0));
  });
  crmCloseModal(); paintDetail();
}
function crmDeleteTermin(tid){
  mutateEntity(e=>{ e.termine=(e.termine||[]).filter(x=>x.id!==tid); });
  paintDetail();
}

// ── Angebote ───────────────────────────────────────────────────────
function crmAddAngebot(){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Angebot</h3>
   <div class="crm-modal-field"><label>Titel *</label><input id="crm-af-titel"></div>
   <div class="crm-modal-field"><label>Beschreibung</label><textarea id="crm-af-note" rows="2"></textarea></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveAngebot()">Hinzufügen</button></div>`);
}
function crmSaveAngebot(){
  const titel=val('crm-af-titel'); if(!titel){ toast('Bitte einen Titel eingeben.','err'); return; }
  mutateEntity(e=>{
    if(!Array.isArray(e.angebote)) e.angebote=[];
    e.angebote.push({ id:newId(), titel, note:val('crm-af-note') });
  });
  crmCloseModal(); paintDetail();
}
function crmDeleteAngebot(aid){
  mutateEntity(e=>{ e.angebote=(e.angebote||[]).filter(x=>x.id!==aid); });
  paintDetail();
}

// ── Status quo ─────────────────────────────────────────────────────
function crmSaveStatusQuo(){
  const v=val('crm-statusquo');
  mutateEntity(e=>{ e.statusQuo=v; });
  toast('Status gespeichert ✓','ok');
}

// ── Statistik (Zahlen·Daten·Fakten) – Entwicklung über die Zeit ────
const STAT_METRICS=[
  ['mitglieder','Vereinsmitglieder'],
  ['trainerInkl','Inkl. Trainer'],
  ['tnInkl','Inkl. TN'],
  ['tnAktiv','aktiv im Training'],
];
function statsSecHtml(e){
  const start=(e.stamm&&e.stamm.statStart)||'';
  let stats=(e.stats||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(start) stats=stats.filter(s=>String(s.date)>=start);
  const head=`<tr><th>Datum</th>${STAT_METRICS.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th></th></tr>`;
  const rows=stats.map((s,i)=>{
    const prev=i>0?stats[i-1]:null;
    const cells=STAT_METRICS.map(([k])=>{
      const cur=Number(s[k]||0);
      let d='';
      if(prev){ const dv=cur-Number(prev[k]||0); if(dv) d=` <span class="crm-delta ${dv>0?'up':'down'}">${dv>0?'▲':'▼'}${Math.abs(dv)}</span>`; }
      return `<td>${cur}${d}</td>`;
    }).join('');
    return `<tr><td>${esc(fmtDate(Date.parse(s.date)))}</td>${cells}<td><button class="crm-x" title="Löschen" onclick="crmDeleteStat('${s.id}')">✕</button></td></tr>`;
  }).join('');
  return `<div class="crm-sec">
    <h4><span class="ttl">📊 Zahlen · Daten · Fakten</span><button class="btn-sm-crm primary" onclick="crmAddStat()">＋ Erfassung</button></h4>
    ${stats.length
      ? `<div style="overflow-x:auto"><table class="crm-stats">${head}${rows}</table></div>`
      : `<div class="small" style="color:var(--muted)">Noch keine Erfassung.${start?` (Statistik ab ${esc(fmtDate(Date.parse(start)))})`:' Tipp: Startdatum unter „Stammdaten · Statistik ab" setzen.'}</div>`}
  </div>`;
}
function crmAddStat(){
  const e=curEntity(); if(!e) return;
  crmOpenModalShell();
  const def=(e.stamm&&e.stamm.statStart)||new Date().toISOString().slice(0,10);
  const f=(id,l)=>`<div class="crm-modal-field" style="flex:1;min-width:130px"><label>${esc(l)}</label><input id="${id}" type="number" min="0" inputmode="numeric"></div>`;
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Erfassung</h3>
   <div class="crm-modal-field"><label>Datum</label><input id="crm-stat-date" type="date" value="${esc(def)}"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">${f('crm-stat-mitglieder','Vereinsmitglieder')}${f('crm-stat-trainerInkl','Inkl. Trainer')}</div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">${f('crm-stat-tnInkl','Inkl. TN')}${f('crm-stat-tnAktiv','aktiv im Training')}</div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveStat()">Speichern</button></div>`);
}
function crmSaveStat(){
  const date=val('crm-stat-date'); if(!date){ toast('Bitte ein Datum wählen.','err'); return; }
  const num=id=>{ const x=document.getElementById(id); return x&&x.value!==''?Math.max(0,Number(x.value)||0):0; };
  mutateEntity(e=>{
    if(!Array.isArray(e.stats)) e.stats=[];
    e.stats.push({ id:newId(), date, mitglieder:num('crm-stat-mitglieder'), trainerInkl:num('crm-stat-trainerInkl'), tnInkl:num('crm-stat-tnInkl'), tnAktiv:num('crm-stat-tnAktiv') });
  });
  crmCloseModal(); paintDetail(); toast('Erfassung gespeichert ✓','ok');
}
function crmDeleteStat(id){
  mutateEntity(e=>{ e.stats=(e.stats||[]).filter(x=>x.id!==id); });
  paintDetail();
}

// ══════════════════════════════════════════════════════════════════
//  AUFGABEN  (am Eintrag) – Team + Zuständige + Status + Fälligkeit
// ══════════════════════════════════════════════════════════════════
// Abhängigkeits-Auswahl (Checkboxen aller anderen Aufgaben des Eintrags)
function depsBoxHtml(c, selfId, selected){
  const sel=new Set(selected||[]);
  const rows=flatTasks(c).filter(t=>t.id!==selfId).map(t=>
    `<label><input type="checkbox" value="${t.id}" ${sel.has(t.id)?'checked':''}> ${'↳ '.repeat(t.depth)}${esc(t.text)}${t.status==='erledigt'?' ✓':''}</label>`
  ).join('');
  return `<div class="crm-deps-box">${rows||'<div class="small" style="color:var(--muted)">Keine anderen Aufgaben vorhanden.</div>'}</div>`;
}
function readChecked(containerId){
  const c=document.getElementById(containerId); if(!c) return [];
  return Array.from(c.querySelectorAll('input[type=checkbox]:checked')).map(x=>x.value);
}
// Verhindert, dass eine blockierte Aufgabe gestartet/erledigt wird
function enforceBlock(e, deps, status){
  const open=(deps||[]).map(d=>statusOfId(e,d)).filter(s=>s&&s!=='erledigt');
  if(status!=='offen' && open.length){ toast('🔒 Noch blockiert – Status bleibt „Offen".','err'); return 'offen'; }
  return status;
}

// ── Aufgaben-Knoten (beliebig tief): Modal-Vorlage ─────────────────
// isTop=true → Team-Feld (außer im Team-Projekt). Sonst Team geerbt.
function nodeModal(o){
  const e=curContainer(); if(!e) return;
  const n=o.node||{}; const tp=isTPCtx();
  crmOpenModalShell();
  const statusOpts=TASK_STATUS.map(s=>`<option value="${s.key}" ${n.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('');
  let teamRow;
  if(o.isTop && !tp){
    const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option ${n.team===tm?'selected':''}>${esc(tm)}</option>`)).join('');
    teamRow=`<div style="display:flex;gap:10px;flex-wrap:wrap">
       <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Team</label><select id="crm-task-team" onchange="crmTaskTeamChange()">${teamOpts}</select></div>
       <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Zuständig</label><select id="crm-task-assignee">${assigneeOptsHtml(n.team||'', n.assigneeId||'')}</select></div>
     </div>`;
  } else {
    const it = tp ? (e.team||'') : (o.inheritTeam||'');
    teamRow=`<div class="crm-modal-field"><label>Zuständig${it?' ('+esc(it)+')':''}</label><select id="crm-task-assignee">${assigneeOptsHtml(it, n.assigneeId||'')}</select></div>`;
  }
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${esc(o.titel)}</h3>
   <div class="crm-modal-field"><label>${o.isTop?'Aufgabe':'Unterpunkt'} *</label><input id="crm-task-text" value="${esc(n.text||'')}"></div>
   ${teamRow}
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Fällig</label><input id="crm-task-due" type="date" value="${esc(n.due||'')}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Status</label><select id="crm-task-status">${statusOpts}</select></div>
   </div>
   <div class="crm-modal-field"><label>Abhängig von (muss vorher erledigt sein)</label><div id="crm-task-deps">${depsBoxHtml(e, n.id||null, n.deps)}</div></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="${o.saveOnclick}">Speichern</button></div>`);
}
function crmOpenTask(tid){  // tid='' → neue Hauptaufgabe, sonst Bearbeiten
  const e=curContainer(); if(!e) return;
  if(!tid){ nodeModal({ titel:'＋ Hauptaufgabe', node:{}, isTop:true, saveOnclick:"crmSaveTask('')" }); return; }
  const f=findNode(e, tid); if(!f) return;
  const isTop=(f.parent===null);
  nodeModal({ titel:isTop?'✎ Hauptaufgabe':'✎ Unterpunkt', node:f.node, isTop,
    inheritTeam:isTop?'':effectiveTeam(e, tid), saveOnclick:`crmSaveTask('${tid}')` });
}
function crmAddChild(parentId){
  const e=curContainer(); if(!e) return;
  const f=findNode(e, parentId); if(!f) return;
  nodeModal({ titel:'＋ Unterpunkt zu „'+(f.node.text||'')+'"', node:{}, isTop:false,
    inheritTeam:isTPCtx()?(e.team||''):effectiveTeam(e, parentId),
    saveOnclick:`crmSaveChild('${parentId}')` });
}
function crmTaskTeamChange(){
  const team=val('crm-task-team');
  const sel=document.getElementById('crm-task-assignee');
  if(sel) sel.innerHTML=assigneeOptsHtml(team, '');
}
function _readNodeForm(e, isTop){
  const text=val('crm-task-text'); if(!text){ toast('Bitte einen Text eingeben.','err'); return null; }
  const assigneeId=val('crm-task-assignee');
  const deps=readChecked('crm-task-deps');
  const status=enforceBlock(e, deps, val('crm-task-status')||'offen');
  const rec={ text, assigneeId, assigneeName: assigneeId?userName(assigneeId):'', due:val('crm-task-due'), status, deps };
  if(isTop && !isTPCtx()) rec.team=val('crm-task-team');  // Team nur bei Top-Aufgaben am Eintrag
  return rec;
}
function crmSaveTask(tid){  // neue Hauptaufgabe (tid='') oder Bearbeiten
  const e=curContainer(); if(!e) return;
  let isTop=true; if(tid){ const f=findNode(e,tid); if(f) isTop=(f.parent===null); }
  const rec=_readNodeForm(e, isTop); if(!rec) return;
  mutateContainer(en=>{
    if(!Array.isArray(en.todos)) en.todos=[];
    if(tid){ const f=findNode(en, tid); if(f){ Object.assign(f.node, rec); if(!Array.isArray(f.node.children)) f.node.children=[]; } }
    else { en.todos.push({ id:newId(), children:[], team: isTPCtx()?'':(rec.team||''), ...rec }); }
  });
  crmCloseModal(); repaintContainer();
}
function crmSaveChild(parentId){
  const e=curContainer(); if(!e) return;
  const rec=_readNodeForm(e, false); if(!rec) return;
  mutateContainer(en=>{
    const f=findNode(en, parentId); if(!f) return;
    if(!Array.isArray(f.node.children)) f.node.children=[];
    f.node.children.push({ id:newId(), children:[], ...rec });
  });
  crmCloseModal(); repaintContainer();
}
function crmDeleteNode(id){
  if(!confirm('Diese Aufgabe samt Unterpunkten löschen?')) return;
  mutateContainer(en=>{ const f=findNode(en, id); if(f && f.arr){ const i=f.arr.indexOf(f.node); if(i>=0) f.arr.splice(i,1); } });
  repaintContainer();
}
function crmToggleDone(id){
  const e=curContainer(); if(!e) return;
  const f=findNode(e, id); if(!f) return;
  if(f.node.status==='erledigt'){
    mutateContainer(en=>{ const g=findNode(en,id); if(g) g.node.status='offen'; });
  } else {
    const blk=blockingTexts(e, f.node);
    if(blk){ toast('🔒 Blockiert durch: '+blk.join(', '),'err'); repaintContainer(); return; }
    mutateContainer(en=>{ const g=findNode(en,id); if(g) g.node.status='erledigt'; });
  }
  repaintContainer();
}

// ── Vorlage auf den Eintrag anwenden ───────────────────────────────
function crmApplyVorlagePick(){
  const vs=listVorlagen();
  if(!vs.length){ if(confirm('Es gibt noch keine Vorlagen.\nJetzt eine anlegen?')) crmOpenVorlagen(); return; }
  crmOpenModalShell();
  const rows=vs.map(v=>`<div class="crm-row">
    <div class="grow"><span class="name">${esc(v.name)}</span> <span class="small">${(v.items||[]).length} Hauptaufgaben</span></div>
    <button class="btn-sm-crm primary" onclick="crmApplyVorlage('${v.id}')">Anwenden</button>
  </div>`).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">📋 Vorlage anwenden</h3>${rows}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Schließen</button>
   <button class="btn-sm-crm" onclick="crmOpenVorlagen()">Vorlagen verwalten</button></div>`);
}
// Sichert ids/children/deps für Vorlagen-Knoten (rekursiv, Lazy-Migration von subs→children)
function normVorlage(v){
  if(!v||!Array.isArray(v.items)) { if(v) v.items=[]; return v; }
  const fix=n=>{ if(!n.id) n.id=newId(); normNode(n); };
  v.items.forEach(fix);
  return v;
}
function crmApplyVorlage(id){
  const v=getVorlage(id); if(!v) return;
  normVorlage(v);
  // Neue ids für alle Knoten (jede Ebene) vergeben, Abhängigkeiten darauf ummappen
  const idMap={};
  flatNodes(v.items).forEach(x=>{ idMap[x.id]=newId(); });
  const build=(n,depth)=>{
    const node={ id:idMap[n.id], text:n.text, assigneeId:'', assigneeName:'', due:'', status:'offen',
      deps:(n.deps||[]).map(d=>idMap[d]).filter(Boolean),
      children:(n.children||[]).map(ch=>build(ch,depth+1)) };
    if(depth===0) node.team = isTPCtx()?'':(n.team||'');
    return node;
  };
  const mains=(v.items||[]).map(n=>build(n,0));
  mutateContainer(e=>{ if(!Array.isArray(e.todos)) e.todos=[]; mains.forEach(m=>e.todos.push(m)); });
  crmCloseModal(); repaintContainer();
  toast(`„${v.name}" übernommen (${mains.length} Hauptaufgabe${mains.length===1?'':'n'}) ✓`,'ok');
}

// ══════════════════════════════════════════════════════════════════
//  TEAM-ANSICHT  – sammelt alle Aufgaben je Team (eintragübergreifend)
// ══════════════════════════════════════════════════════════════════
// Hauptaufgaben eines Teams (eintragübergreifend): [{tree, eid, ename, main}]
function teamMainTasks(team){
  const out=[];
  TREES.forEach(tr=>{
    listEntities(tr.key).forEach(e=>{
      normTasks(e);
      (e.todos||[]).forEach(m=>{
        const match = team==='Ohne Team' ? !m.team : (m.team||'')===team;
        if(match) out.push({ tree:tr.key, eid:e.id, ename:(e.stamm&&e.stamm.name)||'(ohne Name)', main:m });
      });
    });
  });
  return out;
}
// Zählung (alle Ebenen) für die Team-Kacheln
function teamCounts(team){
  let total=0, open=0;
  teamMainTasks(team).forEach(x=>{
    flatTasks({ todos:[x.main] }).forEach(t=>{ total++; if(t.status!=='erledigt') open++; });
  });
  return { total, open };
}
// Beliebigen Knoten (jede Ebene) in einem Eintrag ändern
function updateAnyTask(tree, eid, id, fn){
  const ent=getEntity(tree,eid); if(!ent) return; normTasks(ent);
  const f=findNode(ent, id); if(!f) return;
  try{ fn(f.node); }catch(e){ console.error('CRM updateAnyTask:',e); return; }
  ent.updatedByKuerzel=curKuerzel(); ent.updatedByName=curName();
  saveEntity(tree, ent);
}
function crmShowTeams(){ window._crmMode='teams'; window._crmTeamSel=null; window._crmTeamProjSel=null; paintTeamsList(); }
function crmOpenTeam(enc){ window._crmTeamSel=decodeURIComponent(enc); window._crmTeamProjSel=null; paintTeamDetail(); }
function crmBackToTeams(){ window._crmTeamSel=null; window._crmTeamProjSel=null; paintTeamsList(); }
function crmOpenEntryFromTeam(tree,eid){ window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; paintDetail(); }
function crmOpenTeamProjekt(id){ window._crmTeamProjSel=id; paintTeamProjektDetail(); }
function crmBackToTeamProjekte(){ window._crmTeamProjSel=null; paintTeamDetail(); }

function teamCardHtml(tm, total, open){
  return `<div class="crm-card" onclick="crmOpenTeam('${encodeURIComponent(tm)}')">
    <h3>👥 ${esc(tm)}</h3>
    <div class="meta"><span class="crm-chip">${total} Aufgabe${total===1?'':'n'}</span>${open?`<span class="crm-chip warn">${open} offen</span>`:''}</div>
  </div>`;
}
function paintTeamsList(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const cards=[];
  zeTeams().forEach(tm=>{ const c=teamCounts(tm); cards.push(teamCardHtml(tm, c.total, c.open)); });
  const cNo=teamCounts('Ohne Team');
  if(cNo.total) cards.push(teamCardHtml('Ohne Team', cNo.total, cNo.open));
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-list">${cards.join('')}</div>
    <div class="small" style="color:var(--muted);margin-top:16px">Aufgaben werden an den Einträgen angelegt und hier nach Team gesammelt. Die Leitung verteilt sie über die Spalte „Zuständig".</div>
  </div>`;
}
function paintTeamDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const team=window._crmTeamSel;
  const rel=teamMainTasks(team);
  const groups=[];
  rel.forEach(x=>{
    let g=groups.find(y=>y.tree===x.tree && y.eid===x.eid);
    if(!g){ g={tree:x.tree, eid:x.eid, ename:x.ename, mains:[]}; groups.push(g); }
    g.mains.push(x.main);
  });
  const aOpts=(id)=>assigneeOptsHtml(team==='Ohne Team'?'':team, id||'');
  const stOpts=(t)=>TASK_STATUS.map(s=>`<option value="${s.key}" ${t.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('');
  const teamNodeHtml=(g,e,n,depth)=>{
    const blk=e?blockingTexts(e,n):null;
    const done=n.status==='erledigt';
    const children=(n.children||[]).map(ch=>teamNodeHtml(g,e,ch,depth+1)).join('');
    return `<div class="crm-tnode${depth===0?' top':''}${done?' done':''}">
      <div class="crm-task${blk?' blocked':''}">
        <input type="checkbox" class="crm-check" ${done?'checked':''} ${(blk&&!done)?'disabled':''} title="Erledigt" onchange="crmTeamToggleDone('${g.tree}','${g.eid}','${n.id}')">
        <select class="crm-tsel" onchange="crmTeamSetStatus('${g.tree}','${g.eid}','${n.id}',this.value)">${stOpts(n)}</select>
        <div class="grow"><span class="tx">${esc(n.text)}</span>${n.due?`<div class="small">📅 ${esc(fmtDate(Date.parse(n.due)))}</div>`:''}${blk?`<div class="small crm-locked">🔒 ${esc(blk.join(', '))}</div>`:''}</div>
        <select class="crm-tsel" title="Zuständig" onchange="crmTeamSetAssignee('${g.tree}','${g.eid}','${n.id}',this.value)">${aOpts(n.assigneeId)}</select>
        <button class="btn-sm-crm" title="Unterpunkt hinzufügen" onclick="crmTeamAddChild('${g.tree}','${g.eid}','${n.id}')">＋</button>
        <button class="btn-sm-crm" title="Bearbeiten" onclick="crmTeamEditNode('${g.tree}','${g.eid}','${n.id}')">✎</button>
      </div>
      ${(n.children&&n.children.length)?`<div class="crm-subs">${children}</div>`:''}
    </div>`;
  };
  const blocks=groups.map(g=>{
    const tr=treeByKey(g.tree);
    const e=getEntity(g.tree,g.eid);
    const rows=g.mains.map(m=>teamNodeHtml(g,e,m,0)).join('');
    return `<div class="crm-team-group">
      <div class="crm-team-h" onclick="crmOpenEntryFromTeam('${g.tree}','${g.eid}')">${tr.icon} ${esc(g.ename)} <span class="crm-chip">${g.mains.length}</span></div>
      ${rows}
    </div>`;
  }).join('');
  // Eigenständige Team-Projekte (unabhängig von Einträgen)
  const tprojekte=listTeamProjekte(team==='Ohne Team'?'':team);
  const projCards=tprojekte.map(p=>{
    const all=flatTasks(p); const openN=all.filter(t=>t.status!=='erledigt').length;
    return `<div class="crm-card" onclick="crmOpenTeamProjekt('${p.id}')">
      <h3>📂 ${esc(p.name||'(ohne Name)')}</h3>
      <div class="meta"><span class="crm-chip">${all.length} Aufgabe${all.length===1?'':'n'}</span>${openN?`<span class="crm-chip warn">${openN} offen</span>`:''}</div>
    </div>`;
  }).join('');
  const projektSec=`<div class="crm-sec">
    <h4><span class="ttl">📂 Eigene Projekte</span><button class="btn-sm-crm primary" onclick="crmNewTeamProjekt()">＋ Projekt</button></h4>
    ${tprojekte.length?`<div class="crm-list">${projCards}</div>`:`<div class="small" style="color:var(--muted)">Noch keine eigenen Projekte.</div>`}
  </div>`;
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToTeams()">← Teams</button>
      <h2>👥 ${esc(team)}</h2>
    </div>
    ${projektSec}
    <div style="font-size:13px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.5px;margin:18px 0 10px">📋 Aufgaben aus Einträgen</div>
    ${ rel.length ? blocks : `<div class="small" style="color:var(--muted)">Diesem Team sind noch keine Aufgaben aus Einträgen zugeordnet.</div>` }
  </div>`;
}
function crmTeamSetStatus(tree,eid,id,value){
  const e=getEntity(tree,eid); if(!e) return; normTasks(e);
  const x=flatTasks(e).find(t=>t.id===id); if(!x) return;
  const v=enforceBlock(e, x.ref.deps, value);
  updateAnyTask(tree,eid,id, t=>{ t.status=v; });
  paintTeamDetail();
}
function crmTeamSetAssignee(tree,eid,id,value){
  const name=value?userName(value):'';
  updateAnyTask(tree,eid,id, t=>{ t.assigneeId=value; t.assigneeName=name; });
  paintTeamDetail();
}
// Häkchen / Unterpunkt / Bearbeiten aus der Team-Ansicht (zielt auf den Eintrag)
function crmTeamToggleDone(tree,eid,id){ window._crmTaskCtx={kind:'entity',tree,eid}; window._crmAfterTask='teamdetail'; crmToggleDone(id); }
function crmTeamAddChild(tree,eid,id){ window._crmTaskCtx={kind:'entity',tree,eid}; window._crmAfterTask='teamdetail'; crmAddChild(id); }
function crmTeamEditNode(tree,eid,id){ window._crmTaskCtx={kind:'entity',tree,eid}; window._crmAfterTask='teamdetail'; crmOpenTask(id); }

// ── Eigenständige Team-Projekte ────────────────────────────────────
function paintTeamProjektDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const p=getTeamProjekt(window._crmTeamProjSel);
  if(!p){ window._crmTeamProjSel=null; paintTeamDetail(); return; }
  normTasks(p);
  window._crmTaskCtx={ kind:'teamprojekt', id:p.id };  // Aufgaben-Engine zielt aufs Projekt
  window._crmAfterTask='projektdetail';
  const todos=(p.todos||[]).map(m=>taskNodeHtml(p,m,0)).join('') || `<div class="small" style="color:var(--muted)">Keine Aufgaben.</div>`;
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToTeamProjekte()">← ${esc(p.team||'Team')}</button>
      <h2>📂 ${esc(p.name||'(ohne Name)')}</h2>
      <button class="btn-sm-crm" onclick="crmEditTeamProjekt()">✎ Bearbeiten</button>
      <button class="btn-sm-crm danger" onclick="crmDeleteTeamProjekt()">Löschen</button>
    </div>
    ${(p.createdAt||p.updatedByKuerzel)?`<div class="small" style="color:var(--muted);margin:-8px 0 14px">${p.createdAt?`angelegt ${p.createdByKuerzel?'von '+esc(p.createdByKuerzel)+' ':''}am ${esc(fmtDate(p.createdAt))}`:''}${p.updatedByKuerzel?` · zuletzt von ${esc(p.updatedByKuerzel)}${p.updatedAt?' am '+esc(fmtDateTime(p.updatedAt)):''}`:''}</div>`:''}
    ${p.beschreibung?`<div class="crm-sec"><div class="v" style="white-space:pre-line">${nl2br(p.beschreibung)}</div></div>`:''}
    <div class="crm-sec">
      <h4><span class="ttl">✅ Aufgaben</span>
        <span class="hbtns">
          <button class="btn-sm-crm" onclick="crmApplyVorlagePick()">📋 Vorlage anwenden</button>
          <button class="btn-sm-crm primary" onclick="crmOpenTask('')">＋ Hauptaufgabe</button>
        </span>
      </h4>
      ${todos}
    </div>
  </div>`;
}
function teamProjektFormHtml(p, isNew){
  const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option ${p.team===tm?'selected':''}>${esc(tm)}</option>`)).join('');
  return `<h3 style="color:var(--primary);margin:0 0 14px">${isNew?'＋ Team-Projekt':'✎ Projekt'}</h3>
   <div class="crm-modal-field"><label>Name *</label><input id="crm-tp-name" value="${esc(p.name||'')}"></div>
   <div class="crm-modal-field"><label>Team</label><select id="crm-tp-team">${teamOpts}</select></div>
   <div class="crm-modal-field"><label>Beschreibung</label><textarea id="crm-tp-besch" rows="3">${esc(p.beschreibung||'')}</textarea></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveTeamProjekt(${isNew?'true':'false'})">${isNew?'Anlegen':'Speichern'}</button></div>`;
}
function crmNewTeamProjekt(){
  crmOpenModalShell();
  const team=window._crmTeamSel==='Ohne Team'?'':(window._crmTeamSel||'');
  openModal(teamProjektFormHtml({ team }, true));
}
function crmEditTeamProjekt(){
  const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
  crmOpenModalShell();
  openModal(teamProjektFormHtml(p, false));
}
function crmSaveTeamProjekt(isNew){
  const name=val('crm-tp-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const team=val('crm-tp-team'); const beschreibung=val('crm-tp-besch');
  if(isNew){
    const id=newId();
    saveTeamProjekt({ id, name, team, beschreibung, createdAt:Date.now(),
      createdByKuerzel:curKuerzel(), createdByName:curName(), todos:[] });
    window._crmTeamProjSel=id;
    crmCloseModal(); paintTeamProjektDetail(); toast('Projekt angelegt ✓','ok');
  } else {
    const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
    p.name=name; p.team=team; p.beschreibung=beschreibung;
    p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
    saveTeamProjekt(p);
    crmCloseModal(); paintTeamProjektDetail(); toast('Gespeichert ✓','ok');
  }
}
function crmDeleteTeamProjekt(){
  const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
  if(!confirm(`Projekt „${p.name||''}" wirklich löschen?`)) return;
  deleteTeamProjekt(p.id); window._crmTeamProjSel=null; paintTeamDetail(); toast('Gelöscht.','');
}

// ══════════════════════════════════════════════════════════════════
//  VORLAGEN-VERWALTUNG  (wiederverwendbare ToDo-Sets, z. B. je Event)
// ══════════════════════════════════════════════════════════════════
function crmOpenVorlagen(){
  crmOpenModalShell();
  const vs=listVorlagen();
  const rows=vs.length ? vs.map(v=>`<div class="crm-row">
      <div class="grow"><span class="name">${esc(v.name)}</span> <span class="small">${(v.items||[]).length} Hauptaufgaben</span></div>
      <button class="btn-sm-crm" onclick="crmEditVorlage('${v.id}')">Bearbeiten</button>
      <button class="crm-x" title="Löschen" onclick="crmDeleteVorlage('${v.id}')">✕</button>
    </div>`).join('') : `<div class="small" style="color:var(--muted)">Noch keine Vorlagen.</div>`;
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">📋 Aufgaben-Vorlagen</h3>
   ${rows}
   <div class="crm-add-inline">
     <input id="crm-vorlage-name" placeholder="Neue Vorlage (z. B. Veranstaltung X)" style="flex:1;min-width:180px">
     <button class="btn-sm-crm primary" onclick="crmCreateVorlage()">Anlegen</button>
   </div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Schließen</button></div>`, true);
}
function crmCreateVorlage(){
  const name=val('crm-vorlage-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const id=newId();
  saveVorlage({ id, name, items:[] });
  crmEditVorlage(id);
}
// Rekursive Knoten-Darstellung im Vorlagen-Editor (beliebig tief)
function vNodeHtml(v,n,depth){
  const depNames=(n.deps||[]).map(d=>{ const x=flatNodes(v.items).find(y=>y.id===d); return x?x.text:''; }).filter(Boolean);
  const children=(n.children||[]).map(ch=>vNodeHtml(v,ch,depth+1)).join('');
  return `<div class="crm-tnode${depth===0?' top':''}">
    <div class="crm-task">
      <div class="grow"><span class="tx">${esc(n.text)}</span>${(depth===0&&n.team)?` <span class="fn">${esc(n.team)}</span>`:''}${depNames.length?`<div class="small crm-locked">↦ nach: ${esc(depNames.join(', '))}</div>`:''}</div>
      <button class="btn-sm-crm" title="Unterpunkt" onclick="crmVNodeAdd('${v.id}','${n.id}')">＋</button>
      <button class="btn-sm-crm" title="Bearbeiten" onclick="crmVNodeEdit('${v.id}','${n.id}')">✎</button>
      <button class="btn-sm-crm" title="Abhängigkeit" onclick="crmVNodeDeps('${v.id}','${n.id}')">⛓</button>
      <button class="crm-x" title="Löschen" onclick="crmVNodeDel('${v.id}','${n.id}')">✕</button>
    </div>
    ${(n.children&&n.children.length)?`<div class="crm-subs">${children}</div>`:''}
  </div>`;
}
function crmEditVorlage(id){
  const v=getVorlage(id); if(!v) return;
  normVorlage(v);
  crmOpenModalShell();
  const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option>${esc(tm)}</option>`)).join('');
  const itemsHtml=(v.items||[]).map(it=>vNodeHtml(v,it,0)).join('') || `<div class="small" style="color:var(--muted)">Noch keine Hauptaufgaben.</div>`;
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">📋 ${esc(v.name)}</h3>
   ${itemsHtml}
   <div class="crm-add-inline" style="margin-top:10px">
     <input id="crm-vit-text" placeholder="Neue Hauptaufgabe …" style="flex:1;min-width:150px">
     <select id="crm-vit-team" title="Standard-Team">${teamOpts}</select>
     <button class="btn-sm-crm primary" onclick="crmVorlageAddItem('${id}')">＋ Hauptaufgabe</button>
   </div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmOpenVorlagen()">← Zurück</button>
   <button class="btn-sm-crm primary" onclick="crmCloseModal()">Fertig</button></div>`, true);
}
function crmVorlageAddItem(id){
  const v=getVorlage(id); if(!v) return; normVorlage(v);
  const text=val('crm-vit-text'); if(!text){ toast('Bitte eine Hauptaufgabe eingeben.','err'); return; }
  v.items.push({ id:newId(), text, team:val('crm-vit-team'), deps:[], children:[] });
  saveVorlage(v); crmEditVorlage(id);
}
// ── Vorlagen-Knoten (beliebig tief): Unterpunkt / Bearbeiten / Abhängigkeit / Löschen
function crmVNodeAdd(vid, pid){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Unterpunkt</h3>
   <div class="crm-modal-field"><label>Unterpunkt *</label><input id="crm-vnode-text"></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmEditVorlage('${vid}')">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmVNodeAddSave('${vid}','${pid}')">Hinzufügen</button></div>`);
}
function crmVNodeAddSave(vid, pid){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const text=val('crm-vnode-text'); if(!text){ toast('Bitte einen Unterpunkt eingeben.','err'); return; }
  const f=findNodeIn(v.items, pid); if(!f) return;
  if(!Array.isArray(f.node.children)) f.node.children=[];
  f.node.children.push({ id:newId(), text, deps:[], children:[] });
  saveVorlage(v); crmEditVorlage(vid);
}
function crmVNodeEdit(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  const isTop=f.parent===null;
  crmOpenModalShell();
  const teamSel=isTop?`<div class="crm-modal-field"><label>Standard-Team</label><select id="crm-vnode-team">${['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option ${f.node.team===tm?'selected':''}>${esc(tm)}</option>`)).join('')}</select></div>`:'';
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✎ ${isTop?'Hauptaufgabe':'Unterpunkt'}</h3>
   <div class="crm-modal-field"><label>Text *</label><input id="crm-vnode-text" value="${esc(f.node.text||'')}"></div>
   ${teamSel}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmEditVorlage('${vid}')">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmVNodeEditSave('${vid}','${id}')">Speichern</button></div>`);
}
function crmVNodeEditSave(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  const text=val('crm-vnode-text'); if(!text){ toast('Bitte einen Text eingeben.','err'); return; }
  f.node.text=text;
  if(f.parent===null){ const t=document.getElementById('crm-vnode-team'); if(t) f.node.team=t.value; }
  saveVorlage(v); crmEditVorlage(vid);
}
function crmVNodeDel(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  if(!confirm('Diesen Punkt samt Unterpunkten löschen?')) return;
  const removed=new Set(flatNodes([f.node]).map(x=>x.id));
  const i=f.arr.indexOf(f.node); if(i>=0) f.arr.splice(i,1);
  flatNodes(v.items).forEach(x=>{ if(Array.isArray(x.ref.deps)) x.ref.deps=x.ref.deps.filter(d=>!removed.has(d)); });
  saveVorlage(v); crmEditVorlage(vid);
}
function crmVNodeDeps(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  crmOpenModalShell();
  const excl=new Set(flatNodes([f.node]).map(x=>x.id));  // sich selbst + eigene Unterpunkte
  const sel=new Set(f.node.deps||[]);
  const opts=flatNodes(v.items).filter(x=>!excl.has(x.id)).map(x=>
    `<label><input type="checkbox" value="${x.id}" ${sel.has(x.id)?'checked':''}> ${'↳ '.repeat(x.depth)}${esc(x.text)}</label>`
  ).join('') || '<div class="small" style="color:var(--muted)">Keine anderen Aufgaben vorhanden.</div>';
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">⛓ „${esc(f.node.text)}" startet erst nach …</h3>
   <div class="crm-deps-box" id="crm-vdeps">${opts}</div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmEditVorlage('${vid}')">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmVNodeDepsSave('${vid}','${id}')">Speichern</button></div>`);
}
function crmVNodeDepsSave(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  f.node.deps=readChecked('crm-vdeps');
  saveVorlage(v); crmEditVorlage(vid);
}
function crmDeleteVorlage(id){
  const v=getVorlage(id); if(!v) return;
  if(!confirm(`Vorlage „${v.name}" löschen?`)) return;
  deleteVorlage(id); crmOpenVorlagen();
}

// ══════════════════════════════════════════════════════════════════
//  INTERNE KOMMUNIKATION  – Notiz + Diktat + KI
// ══════════════════════════════════════════════════════════════════
function noteModalHtml(saveFn){
  const autor=esc((window.cu&&window.cu.name)||'');
  return `<h3 style="color:var(--primary);margin:0 0 14px">🎤 Neue Notiz</h3>
   <div class="crm-modal-field"><label>Autor</label><input id="crm-note-autor" value="${autor}"></div>
   <div class="crm-modal-field"><label>Notiz / Diktat</label>
     <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
       <button type="button" class="crm-mic" id="crm-mic-btn" onclick="crmDictate('crm-note-text',this)">🎤 Diktat starten</button>
       <button type="button" class="btn-sm-crm" id="crm-sum-btn" onclick="crmSummarizeNote()">✨ KI-Zusammenfassung</button>
     </div>
     <textarea class="crm-ta" id="crm-note-text" rows="5" placeholder="Sprechen oder tippen …"></textarea>
   </div>
   <div class="crm-modal-field"><label>KI-Zusammenfassung (optional)</label><textarea class="crm-ta" id="crm-note-summary" rows="3" placeholder="Wird durch ✨ erzeugt – oder leer lassen"></textarea></div>
   <div class="crm-modal-actions">
     <button class="btn-sm-crm" onclick="crmCancelNote()">Abbrechen</button>
     <button class="btn-sm-crm primary" onclick="${saveFn}()">Speichern</button>
   </div>`;
}
function crmOpenNote(){ crmOpenModalShell(); openModal(noteModalHtml('crmSaveNote'), true); }
function _stopDictation(){
  if(window._crmRec){ try{ window._crmRec.stop(); }catch(e){} window._crmRec=null; }
}
function crmCancelNote(){ _stopDictation(); crmCloseModal(); }
function crmSaveNote(){
  _stopDictation();
  const text=val('crm-note-text');
  if(!text){ toast('Bitte zuerst etwas diktieren oder tippen.','err'); return; }
  const autor=val('crm-note-autor');
  mutateEntity(e=>{
    if(!Array.isArray(e.log)) e.log=[];
    e.log.push({ id:newId(), ts:Date.now(), autor, kuerzel:(initials(autor)||curKuerzel()), text, summary:val('crm-note-summary') });
  });
  crmCloseModal(); paintDetail(); toast('Notiz gespeichert ✓','ok');
}

// Browser-Spracherkennung (Web Speech API) – Text sofort, kein Upload.
function crmDictate(targetId, btn){
  try{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ toast('Spracherkennung wird hier nicht unterstützt – am besten Chrome oder Edge.','err'); return; }
    if(window._crmRec){ _stopDictation(); if(btn){ btn.classList.remove('rec'); btn.textContent='🎤 Diktat starten'; } return; }
    const ta=document.getElementById(targetId); if(!ta) return;
    const rec=new SR();
    rec.lang='de-DE'; rec.continuous=true; rec.interimResults=true;
    let base = ta.value ? ta.value.replace(/\s+$/,'')+' ' : '';
    rec.onresult=e=>{
      let finals='', interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        const t=e.results[i][0].transcript;
        if(e.results[i].isFinal) finals+=t; else interim+=t;
      }
      if(finals) base += finals.trim()+' ';
      ta.value=(base+interim).trim();
    };
    rec.onerror=ev=>{ toast('Diktat-Fehler: '+(ev.error||''),'err'); };
    rec.onend=()=>{ window._crmRec=null; const b=document.getElementById('crm-mic-btn'); if(b){ b.classList.remove('rec'); b.textContent='🎤 Diktat starten'; } };
    window._crmRec=rec; rec.start();
    if(btn){ btn.classList.add('rec'); btn.textContent='⏹ Diktat stoppen'; }
    toast('🎤 Diktat läuft – sprich jetzt.','');
  }catch(e){ toast('Diktat konnte nicht gestartet werden.','err'); }
}

// KI-Zusammenfassung über konfigurierbaren Proxy (kein Key im Frontend).
async function crmSummarizeNote(){
  const ta=document.getElementById('crm-note-text');
  if(!ta||!ta.value.trim()){ toast('Bitte zuerst Text diktieren oder eingeben.',''); return; }
  const endpoint=getAiEndpoint();
  if(!endpoint){ if(confirm('Es ist noch kein KI-Proxy hinterlegt.\nJetzt die Proxy-URL eintragen?')) crmConfigAi(); return; }
  const out=document.getElementById('crm-note-summary');
  const btn=document.getElementById('crm-sum-btn');
  try{
    if(btn){ btn.disabled=true; btn.textContent='⏳ Zusammenfassen …'; }
    const res=await fetch(endpoint,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text:ta.value, task:'summary' }) });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const summary=data.summary||data.result||data.text||'';
    if(out) out.value=summary;
    toast('KI-Zusammenfassung erstellt ✓','ok');
  }catch(e){ toast('KI-Zusammenfassung fehlgeschlagen: '+(e.message||''),'err'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='✨ KI-Zusammenfassung'; } }
}
function crmDeleteNote(nid){
  mutateEntity(e=>{ e.log=(e.log||[]).filter(x=>x.id!==nid); });
  paintDetail();
}
function crmConfigAi(){
  const cur=getAiEndpoint();
  const url=prompt('URL des KI-Proxys (z. B. Cloudflare Worker).\nLeer lassen zum Entfernen:', cur||'');
  if(url===null) return;
  setAiEndpoint(url.trim());
  toast(url.trim()?'KI-Proxy gespeichert ✓':'KI-Proxy entfernt.','ok');
  if(window._activeModule==='crm' && !window._crmModalOpen) paint();
}

// ══════════════════════════════════════════════════════════════════
//  VERWALTUNG  (eigene Top-Ebene, nur Admin) – CRM-Zugriff je Nutzer
// ══════════════════════════════════════════════════════════════════
function roleLbl(u){
  return u.role==='geschaeftsfuehrer'?'Geschäftsführung':u.role==='leitung'?'Leitung':
         u.role==='berater'?'Berater/in':u.role==='freiberuflich'?'Freiberuflich':'Mitarbeiter/in';
}
// Baut das Verwaltungs-Gerüst und hängt die ZE-Bausteine „Mitarbeiter" und
// „Berechtigungen" EINMALIG hierher um (gleiche Elemente/IDs → renderSettings
// funktioniert unverändert weiter). Idempotent.
function ensureVerwMounted(){
  const root=document.getElementById('verw-root'); if(!root) return;
  if(document.getElementById('verw-access')) return;
  root.innerHTML = `<div class="crm-bar"><div class="crm-trees"><span style="font-weight:700;color:var(--primary)">🔑 Verwaltung</span></div></div>
   <div class="crm-body">
     <div id="verw-usersmount"></div>
     <div id="verw-access"></div>
     <div id="verw-permsmount"></div>
   </div>`;
  const ub=document.getElementById('set-users-box'), um=document.getElementById('verw-usersmount'); if(ub&&um) um.appendChild(ub);
  const pb=document.getElementById('set-perms-box'), pm=document.getElementById('verw-permsmount'); if(pb&&pm) pm.appendChild(pb);
}
function renderVerwaltung(){
  try{
    injectStyles();
    const root=document.getElementById('verw-root'); if(!root) return;
    if(!window.cu || window.cu.role!=='admin'){ root.innerHTML='<div class="crm-empty">Kein Zugriff.</div>'; return; }
    ensureCrmReady().then(()=>{
      try{
        ensureVerwMounted();
        paintVerwAccess();
        if(window.renderSettings) window.renderSettings();  // füllt Mitarbeiter-/Berechtigungs-Bausteine
      }catch(e){ console.error('Verwaltung:',e); }
    });
  }catch(e){ console.error('renderVerwaltung:',e); }
}
function paintVerwAccess(){
  const host=document.getElementById('verw-access'); if(!host) return;
  const vereine=listEntities('vereine');
  const vOpts=sel=>['<option value="">– Verein wählen –</option>']
    .concat(vereine.map(v=>`<option value="${v.id}" ${sel===v.id?'selected':''}>${esc((v.stamm&&v.stamm.name)||'(ohne Name)')}</option>`)).join('');
  const users=zeUsers().filter(u=>u.id!=='admin')
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
  const rows=users.map(u=>{
    const a=getAccess(u.id)||{level:'none',vereinId:''};
    const lvl=a.level||'none';
    const lvlSel=[['none','Kein Zugriff'],['verein','Nur eigener Verein'],['full','Voll']]
      .map(([L,t])=>`<option value="${L}" ${lvl===L?'selected':''}>${t}</option>`).join('');
    return `<div class="crm-row">
      <div class="grow"><span class="name">${esc(u.name)}</span> <span class="small">${esc(roleLbl(u))}</span></div>
      <select class="crm-tsel" onchange="crmVerwSetLevel('${u.id}',this.value)">${lvlSel}</select>
      <select class="crm-tsel" ${lvl==='verein'?'':'style="visibility:hidden"'} title="Zugeordneter Verein" onchange="crmVerwSetVerein('${u.id}',this.value)">${vOpts(a.vereinId)}</select>
    </div>`;
  }).join('');
  host.innerHTML = `<div class="crm-sec">
    <h4><span class="ttl">📇 CRM-Zugriff je Nutzer</span></h4>
    <div class="small" style="color:var(--muted);margin-bottom:10px">„Nur eigener Verein" = sieht ausschließlich seinen zugeordneten Verein samt dessen Aufgaben. „Voll" = sieht das gesamte CRM.</div>
    ${rows||'<div class="small" style="color:var(--muted)">Keine Nutzer.</div>'}
  </div>`;
}
function crmVerwSetLevel(uid, level){
  const a=getAccess(uid)||{};
  if(level==='none') saveAccess(uid, null);
  else saveAccess(uid, { level, vereinId: level==='verein'?(a.vereinId||''):'' });
  paintVerwAccess();
}
function crmVerwSetVerein(uid, vid){
  saveAccess(uid, { level:'verein', vereinId:vid });
}

// ── Window-Registrierung (für inline onclick) ──────────────────────
Object.assign(window, {
  renderCRM, crmSetupModuleBar, renderVerwaltung, crmVerwSetLevel, crmVerwSetVerein,
  crmSwitchTree, crmSearch, crmOpenDetail, crmBackToList, crmCloseModal,
  crmOpenNew, crmEditStamm, crmSaveStamm, crmDeleteEntity,
  crmAddMember, crmEditMember, crmSaveMember, crmDeleteMember,
  crmAddTermin, crmSaveTermin, crmDeleteTermin,
  crmAddAngebot, crmSaveAngebot, crmDeleteAngebot,
  crmSaveStatusQuo,
  crmAddStat, crmSaveStat, crmDeleteStat,
  // Aufgaben (beliebig tief + Abhängigkeiten + Häkchen)
  crmOpenTask, crmAddChild, crmTaskTeamChange, crmSaveTask, crmSaveChild,
  crmDeleteNode, crmToggleDone,
  crmApplyVorlagePick, crmApplyVorlage,
  // Team-Ansicht
  crmShowTeams, crmOpenTeam, crmBackToTeams, crmOpenEntryFromTeam,
  crmTeamSetStatus, crmTeamSetAssignee, crmTeamToggleDone, crmTeamAddChild, crmTeamEditNode,
  // Eigenständige Team-Projekte
  crmOpenTeamProjekt, crmBackToTeamProjekte, crmNewTeamProjekt,
  crmEditTeamProjekt, crmSaveTeamProjekt, crmDeleteTeamProjekt,
  // Vorlagen (beliebig tief)
  crmOpenVorlagen, crmCreateVorlage, crmEditVorlage, crmVorlageAddItem, crmDeleteVorlage,
  crmVNodeAdd, crmVNodeAddSave, crmVNodeEdit, crmVNodeEditSave, crmVNodeDel, crmVNodeDeps, crmVNodeDepsSave,
  // Kommunikation
  crmOpenNote, crmCancelNote, crmSaveNote, crmDictate, crmSummarizeNote, crmDeleteNote, crmConfigAi
});
