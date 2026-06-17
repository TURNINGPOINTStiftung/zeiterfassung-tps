// ══════════════════════════════════════════════════════════════════
//  CRM-UI  –  Liste / Detail / CRUD / interne Kommunikation / Diktat
// ══════════════════════════════════════════════════════════════════
//  Selbst-registrierendes, isoliertes Modul. Wird in main.js nur als
//  Seiteneffekt importiert. Alles läuft in try/catch, damit ein Fehler
//  hier niemals die Zeiterfassung beeinträchtigt.

import { openModal, closeModal, toast } from '../utils.js';
import { getData } from '../data.js';   // NUR Lesen (Teams) – nie schreiben
import {
  ensureCrmReady, setCrmRenderHook, getCrm, getEntity, listEntities,
  saveEntity, deleteEntity, newId,
  saveProjekt, deleteProjekt, getProjekt, listProjekte, listProjekteForEntity
} from './crm-data.js';
import {
  TREES, treeByKey, stammFields, MEMBER_FUNCTIONS,
  getAiEndpoint, setAiEndpoint,
  PROJEKT_STATUS, statusByKey, FALLBACK_TEAMS
} from './crm-config.js';

// Teams read-only aus der Zeiterfassung (mit Fallback). Schreibt NIE zurück.
function zeTeams(){
  try{ const t=getData().teams; if(Array.isArray(t)&&t.length) return t.slice(); }catch(e){}
  return FALLBACK_TEAMS.slice();
}

// ── kleine Helfer ──────────────────────────────────────────────────
const esc = s => String(s==null?'':s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const nl2br = s => esc(s).replace(/\n/g,'<br>');
const val   = id => { const el=document.getElementById(id); return el ? el.value.trim() : ''; };
const fmtDate = ts => { try{ return new Date(ts).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});}catch(e){return '';} };
const fmtDateTime = ts => { try{ return new Date(ts).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';} };

// Aktuell ausgewähltes Entity (oder null)
function curEntity(){ return window._crmSelId ? getEntity(window._crmTree, window._crmSelId) : null; }

// Entity laden → ändern → speichern
function mutateEntity(fn){
  const ent = curEntity(); if(!ent) return;
  try{ fn(ent); }catch(e){ console.error('CRM mutate:',e); return; }
  saveEntity(window._crmTree, ent);
}

// Projekt laden → ändern → speichern
function mutateProjekt(fn){
  const p = getProjekt(window._crmProjSelId); if(!p) return;
  try{ fn(p); }catch(e){ console.error('CRM mutateProjekt:',e); return; }
  saveProjekt(p);
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
  .crm-sec h4{font-size:13px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.5px;margin:0 0 12px;display:flex;align-items:center;gap:8px;justify-content:space-between}
  .crm-sec h4 .ttl{display:flex;align-items:center;gap:8px}
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
  .crm-todo{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border);flex-wrap:wrap}
  .crm-todo.done .tx{text-decoration:line-through;color:var(--muted)}
  .crm-todo input[type=checkbox]{width:18px;height:18px;cursor:pointer;flex-shrink:0}
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
  .crm-team-h{font-size:13px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid var(--primary);display:flex;align-items:center;gap:8px}
  .crm-status-sel{padding:5px 9px;border:none;border-radius:14px;font-size:12px;font-weight:700;color:#fff;cursor:pointer}
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
    window._crmModalOpen = false;
    const root = document.getElementById('crm-root');
    if(!root) return;
    root.innerHTML = '<div class="crm-empty">Lade CRM …</div>';
    ensureCrmReady().then(()=>{ try{ paint(); }catch(e){ console.error('CRM paint:',e); } });
  }catch(e){ console.error('renderCRM Fehler:',e); }
}
setCrmRenderHook(()=>{ try{ paint(); }catch(e){} });

function paint(){
  window._crmModalOpen = false;
  const mode = window._crmMode || 'kontakte';
  if(mode==='projekte'){
    if(window._crmProjSelId && getProjekt(window._crmProjSelId)) paintProjectDetail();
    else { window._crmProjSelId = null; paintProjectsList(); }
    return;
  }
  if(window._crmSelId && curEntity()) paintDetail();
  else { window._crmSelId = null; paintList(); }
}

// ── Bar (Baum-Tabs + Projekte + Kontext-Steuerung) ─────────────────
function barHtml(){
  const mode = window._crmMode || 'kontakte';
  const treeTabs = TREES.map(t=>
    `<button class="crm-tree-tab${(mode==='kontakte'&&t.key===window._crmTree)?' active':''}" onclick="crmSwitchTree('${t.key}')">${t.icon} ${esc(t.label)}</button>`
  ).join('');
  const projTab = `<button class="crm-tree-tab${mode==='projekte'?' active':''}" style="margin-left:8px" onclick="crmShowProjekte()">📋 Projekte</button>`;
  const aiOn = getAiEndpoint() ? '✓' : '–';
  let right;
  if(mode==='projekte'){
    const opts = ['<option value="">Alle Teams</option>']
      .concat(zeTeams().map(t=>`<option ${window._crmProjTeamFilter===t?'selected':''}>${esc(t)}</option>`)).join('');
    right = `<select class="crm-search" style="min-width:150px" onchange="crmProjTeamFilter(this.value)">${opts}</select>
      <button class="btn-sm-crm primary" onclick="crmOpenNewProjekt()">＋ Projekt</button>`;
  } else {
    right = `<input class="crm-search" type="search" placeholder="Suchen …" value="${esc(window._crmSearch||'')}" oninput="crmSearch(this.value)">
      <button class="btn-sm-crm primary" onclick="crmOpenNew()">＋ Neu</button>`;
  }
  return `<div class="crm-bar">
    <div class="crm-trees">${treeTabs}${projTab}</div>
    ${right}
    <button class="btn-sm-crm" title="KI-Proxy für Zusammenfassungen" onclick="crmConfigAi()">⚙️ KI ${aiOn}</button>
  </div>`;
}

// ── Liste ──────────────────────────────────────────────────────────
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
    const openTodos=(e.todos||[]).filter(t=>!t.done).length;
    const kCount=(e.kontakte||[]).length;
    const sub=[s.sitz,s.adresse].filter(Boolean).join(' · ');
    return `<div class="crm-card" onclick="crmOpenDetail('${e.id}')">
      <h3>${esc(s.name||'(ohne Name)')}</h3>
      ${sub?`<div class="sub">${esc(sub)}</div>`:''}
      <div class="meta">
        <span class="crm-chip">👤 ${kCount} Kontakt${kCount===1?'':'e'}</span>
        ${openTodos?`<span class="crm-chip warn">✓ ${openTodos} ToDo${openTodos===1?'':'s'}</span>`:''}
      </div>
    </div>`;
  }).join('');
  root.innerHTML = barHtml() + `<div class="crm-body">${
    items.length ? `<div class="crm-list">${cards}</div>`
                 : `<div class="crm-empty">Noch keine ${esc(tree.label)}.<br><br><button class="btn-sm-crm primary" onclick="crmOpenNew()">＋ ${esc(tree.single)} anlegen</button></div>`
  }</div>`;
}

// ── Detail ─────────────────────────────────────────────────────────
function paintDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const e=curEntity(); if(!e){ window._crmSelId=null; paintList(); return; }
  const s=e.stamm||{};
  const tree=treeByKey(window._crmTree);

  // Stammdaten (Lese-Ansicht)
  const fields = stammFields(window._crmTree)
    .filter(f=>f.key!=='name')
    .map(f=>{ const v=s[f.key]; return v ? `<div class="crm-field"><label>${esc(f.label)}</label><div class="v">${nl2br(v)}</div></div>` : ''; })
    .filter(Boolean).join('');

  // Kontakte / Mitglieder
  const kontakte=(e.kontakte||[]).map(k=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(k.name)}</span>${k.funktion?` <span class="fn">${esc(k.funktion)}</span>`:''}
        ${(k.email||k.tel)?`<div class="small">${[k.email,k.tel].filter(Boolean).map(esc).join(' · ')}</div>`:''}
        ${k.note?`<div class="small">${esc(k.note)}</div>`:''}
      </div>
      <button class="btn-sm-crm" onclick="crmEditMember('${k.id}')">Bearbeiten</button>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteMember('${k.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Kontakte.</div>`;

  // Termine
  const termine=(e.termine||[]).map(t=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(t.titel)}</span>
        <div class="small">${[t.datum?fmtDate(t.datumTs||Date.parse(t.datum)):'', t.ort].filter(Boolean).map(esc).join(' · ')}</div>
        ${t.note?`<div class="small">${esc(t.note)}</div>`:''}
      </div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteTermin('${t.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Termine.</div>`;

  // Angebote
  const angebote=(e.angebote||[]).map(a=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(a.titel)}</span>${a.note?`<div class="small">${esc(a.note)}</div>`:''}</div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteAngebot('${a.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Angebote.</div>`;

  // ToDos
  const todos=(e.todos||[]).map(t=>`
    <div class="crm-todo${t.done?' done':''}">
      <input type="checkbox" ${t.done?'checked':''} onchange="crmToggleTodo('${t.id}')">
      <div class="grow"><span class="tx">${esc(t.text)}</span>${t.zustaendig?` <span class="fn">${esc(t.zustaendig)}</span>`:''}</div>
      <button class="crm-x" title="Löschen" onclick="crmDeleteTodo('${t.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine ToDos.</div>`;

  // Kommunikations-Log
  const log=(e.log||[]).slice().sort((a,b)=>b.ts-a.ts).map(l=>`
    <div class="crm-logitem">
      <div class="lh"><span>${esc(l.autor||'')}</span><span>${fmtDateTime(l.ts)} <button class="crm-x" onclick="crmDeleteNote('${l.id}')">✕</button></span></div>
      <div class="lt">${nl2br(l.text||'')}</div>
      ${l.summary?`<div class="ls"><strong>KI-Zusammenfassung:</strong><br>${nl2br(l.summary)}</div>`:''}
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Notizen.</div>`;

  // Verknüpfte Projekte (Cross-Link zum Projektmanagement)
  const linkedProjekte = listProjekteForEntity(window._crmTree, e.id);
  const projekteRows = linkedProjekte.length ? linkedProjekte.map(p=>{
      const st=statusByKey(p.status);
      return `<div class="crm-row">
        <div class="grow"><span class="name">${esc(p.titel||'')}</span>
          <span class="crm-chip" style="background:${st.color};color:#fff;border-color:${st.color}">${esc(st.label)}</span>
          ${p.team?` <span class="small">${esc(p.team)}</span>`:''}
        </div>
        <button class="btn-sm-crm" onclick="crmOpenProjFromEntity('${p.id}')">Öffnen</button>
      </div>`;
    }).join('') : `<div class="small" style="color:var(--muted)">Keine verknüpften Projekte.</div>`;

  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToList()">← ${esc(tree.label)}</button>
      <h2>${esc(s.name||'(ohne Name)')}</h2>
      <button class="btn-sm-crm" onclick="crmEditStamm()">✎ Stammdaten</button>
      <button class="btn-sm-crm danger" onclick="crmDeleteEntity()">Löschen</button>
    </div>

    ${fields?`<div class="crm-sec"><h4><span class="ttl">📋 Stammdaten</span></h4><div class="crm-fields">${fields}</div></div>`:''}

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
      <h4><span class="ttl">📋 Verknüpfte Projekte</span><button class="btn-sm-crm" onclick="crmNewProjektForEntity()">＋ Projekt</button></h4>
      ${projekteRows}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">🧭 Status quo</span></h4>
      <textarea class="crm-ta" id="crm-statusquo" rows="3" placeholder="Wo stehen wir aktuell mit ${esc(s.name||'')}?">${esc(e.statusQuo||'')}</textarea>
      <div class="crm-modal-actions"><button class="btn-sm-crm primary" onclick="crmSaveStatusQuo()">Speichern</button></div>
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">✅ ToDos &amp; Zuständigkeit</span></h4>
      ${todos}
      <div class="crm-add-inline">
        <input id="crm-todo-text" placeholder="Nächstes ToDo …" class="grow" style="flex:1;min-width:160px">
        <input id="crm-todo-resp" placeholder="Zuständig" style="width:130px">
        <button class="btn-sm-crm primary" onclick="crmAddTodo()">Hinzufügen</button>
      </div>
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">💬 Interne Kommunikation</span><button class="btn-sm-crm primary" onclick="crmOpenNote()">🎤 Neue Notiz</button></h4>
      ${log}
    </div>
  </div>`;
}

// ── Navigation ─────────────────────────────────────────────────────
function crmSwitchTree(key){ window._crmMode='kontakte'; window._crmTree=key; window._crmSelId=null; window._crmSearch=''; paintList(); }
function crmSearch(v){ window._crmSearch=v; paintList(); }
function crmOpenDetail(id){ window._crmSelId=id; paintDetail(); }
function crmBackToList(){ window._crmSelId=null; paintList(); }

function crmOpenModalShell(){ window._crmModalOpen=true; }
function crmCloseModal(){ window._crmModalOpen=false; closeModal(); }

// ── Neu anlegen / Stammdaten bearbeiten ────────────────────────────
function stammFormHtml(s){
  return stammFields(window._crmTree).map(f=>{
    const v=esc(s[f.key]||'');
    const inp = f.type==='textarea'
      ? `<textarea id="crm-sf-${f.key}" rows="2">${v}</textarea>`
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
    const ent={ id, tree:window._crmTree, createdAt:Date.now(), stamm,
      kontakte:[], termine:[], angebote:[], statusQuo:'', todos:[], log:[] };
    saveEntity(window._crmTree, ent);
    window._crmSelId=id;
    crmCloseModal();
    paintDetail();
    toast('Angelegt ✓','ok');
  } else {
    mutateEntity(e=>{ e.stamm=stamm; });
    crmCloseModal();
    paintDetail();
    toast('Gespeichert ✓','ok');
  }
}

function crmDeleteEntity(){
  const e=curEntity(); if(!e) return;
  if(!confirm(`„${(e.stamm&&e.stamm.name)||''}" wirklich löschen?`)) return;
  deleteEntity(window._crmTree, e.id);
  window._crmSelId=null;
  paintList();
  toast('Gelöscht.','');
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
   <div class="crm-modal-field"><label>Datum</label><input id="crm-tf-datum" type="date"></div>
   <div class="crm-modal-field"><label>Ort</label><input id="crm-tf-ort"></div>
   <div class="crm-modal-field"><label>Notiz</label><input id="crm-tf-note"></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveTermin()">Hinzufügen</button></div>`);
}
function crmSaveTermin(){
  const titel=val('crm-tf-titel'); if(!titel){ toast('Bitte einen Titel eingeben.','err'); return; }
  const datum=val('crm-tf-datum');
  mutateEntity(e=>{
    if(!Array.isArray(e.termine)) e.termine=[];
    e.termine.push({ id:newId(), titel, datum, datumTs:datum?Date.parse(datum):null, ort:val('crm-tf-ort'), note:val('crm-tf-note') });
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

// ── Status quo / ToDos ─────────────────────────────────────────────
function crmSaveStatusQuo(){
  const v=val('crm-statusquo');
  mutateEntity(e=>{ e.statusQuo=v; });
  toast('Status gespeichert ✓','ok');
}
function crmAddTodo(){
  const text=val('crm-todo-text'); if(!text){ toast('Bitte ein ToDo eingeben.','err'); return; }
  const resp=val('crm-todo-resp');
  mutateEntity(e=>{
    if(!Array.isArray(e.todos)) e.todos=[];
    e.todos.push({ id:newId(), text, zustaendig:resp, done:false });
  });
  paintDetail();
}
function crmToggleTodo(tid){
  mutateEntity(e=>{ const t=(e.todos||[]).find(x=>x.id===tid); if(t) t.done=!t.done; });
  paintDetail();
}
function crmDeleteTodo(tid){
  mutateEntity(e=>{ e.todos=(e.todos||[]).filter(x=>x.id!==tid); });
  paintDetail();
}

// ── Interne Kommunikation: Notiz + Diktat + KI ─────────────────────
// Gemeinsame Modal-Vorlage – von Eintrags- UND Projekt-Notizen genutzt.
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
  const summary=val('crm-note-summary');
  const autor=val('crm-note-autor');
  mutateEntity(e=>{
    if(!Array.isArray(e.log)) e.log=[];
    e.log.push({ id:newId(), ts:Date.now(), autor, text, summary });
  });
  crmCloseModal(); paintDetail();
  toast('Notiz gespeichert ✓','ok');
}

// Browser-Spracherkennung (Web Speech API) – Text sofort, kein Upload.
function crmDictate(targetId, btn){
  try{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ toast('Spracherkennung wird hier nicht unterstützt – am besten Chrome oder Edge.','err'); return; }
    if(window._crmRec){ // läuft → stoppen
      _stopDictation();
      if(btn){ btn.classList.remove('rec'); btn.textContent='🎤 Diktat starten'; }
      return;
    }
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
    window._crmRec=rec;
    rec.start();
    if(btn){ btn.classList.add('rec'); btn.textContent='⏹ Diktat stoppen'; }
    toast('🎤 Diktat läuft – sprich jetzt.','');
  }catch(e){ toast('Diktat konnte nicht gestartet werden.','err'); }
}

// KI-Zusammenfassung über konfigurierbaren Proxy (kein Key im Frontend).
async function crmSummarizeNote(){
  const ta=document.getElementById('crm-note-text');
  if(!ta||!ta.value.trim()){ toast('Bitte zuerst Text diktieren oder eingeben.',''); return; }
  const endpoint=getAiEndpoint();
  if(!endpoint){
    if(confirm('Es ist noch kein KI-Proxy hinterlegt.\nJetzt die Proxy-URL eintragen?')) crmConfigAi();
    return;
  }
  const out=document.getElementById('crm-note-summary');
  const btn=document.getElementById('crm-sum-btn');
  try{
    if(btn){ btn.disabled=true; btn.textContent='⏳ Zusammenfassen …'; }
    const res=await fetch(endpoint,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ text:ta.value, task:'summary' })
    });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    const summary=data.summary||data.result||data.text||'';
    if(out) out.value=summary;
    toast('KI-Zusammenfassung erstellt ✓','ok');
  }catch(e){
    toast('KI-Zusammenfassung fehlgeschlagen: '+(e.message||''),'err');
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='✨ KI-Zusammenfassung'; }
  }
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
//  PROJEKTMANAGEMENT  –  Projekte nach Team, verknüpft mit CRM-Einträgen
// ══════════════════════════════════════════════════════════════════

function crmShowProjekte(){ window._crmMode='projekte'; window._crmProjSelId=null; paintProjectsList(); }
function crmProjTeamFilter(v){ window._crmProjTeamFilter=v; paintProjectsList(); }
function crmOpenProjDetail(id){ window._crmProjSelId=id; paintProjectDetail(); }
function crmBackToProjects(){ window._crmProjSelId=null; paintProjectsList(); }

// Sprung Projekt ⇄ CRM-Eintrag (Verknüpfung)
function crmOpenProjFromEntity(id){ window._crmMode='projekte'; window._crmProjSelId=id; paintProjectDetail(); }
function crmOpenLinkedEntity(tree,id){ window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=id; paintDetail(); }

// Projekt-Karte
function projCardHtml(p){
  const st=statusByKey(p.status);
  const openTasks=(p.tasks||[]).filter(t=>!t.done).length;
  const links=(p.links||[]).length;
  const due=p.faellig?fmtDate(Date.parse(p.faellig)):'';
  const sub=[p.verantwortlich?('👤 '+p.verantwortlich):'', due?('📅 '+due):''].filter(Boolean).map(esc).join(' · ');
  return `<div class="crm-card" onclick="crmOpenProjDetail('${p.id}')">
    <h3>${esc(p.titel||'(ohne Titel)')}</h3>
    ${sub?`<div class="sub">${sub}</div>`:''}
    <div class="meta">
      <span class="crm-chip" style="background:${st.color};color:#fff;border-color:${st.color}">${esc(st.label)}</span>
      ${openTasks?`<span class="crm-chip warn">✓ ${openTasks} offen</span>`:''}
      ${links?`<span class="crm-chip">🔗 ${links}</span>`:''}
    </div>
  </div>`;
}

// Liste, gruppiert nach Team (gleiche Teams wie in der Zeiterfassung)
function paintProjectsList(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const filter=window._crmProjTeamFilter||'';
  let items=listProjekte();
  if(filter) items=items.filter(p=>(p.team||'')===filter);
  const order=zeTeams();
  const groups=[];
  const ensure=name=>{ let g=groups.find(x=>x.name===name); if(!g){ g={name,items:[]}; groups.push(g);} return g; };
  order.forEach(ensure);
  items.forEach(p=>{ if(p.team && !order.includes(p.team)) ensure(p.team); });
  ensure('Ohne Team');
  items.forEach(p=>{ ensure(p.team||'Ohne Team').items.push(p); });
  const blocks=groups.filter(g=>g.items.length).map(g=>
    `<div class="crm-team-group"><div class="crm-team-h">${esc(g.name)} <span class="crm-chip">${g.items.length}</span></div>
     <div class="crm-list">${g.items.map(projCardHtml).join('')}</div></div>`
  ).join('');
  root.innerHTML = barHtml() + `<div class="crm-body">${
    items.length ? blocks
      : `<div class="crm-empty">Noch keine Projekte${filter?' in diesem Team':''}.<br><br><button class="btn-sm-crm primary" onclick="crmOpenNewProjekt()">＋ Projekt anlegen</button></div>`
  }</div>`;
}

// Detail
function paintProjectDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const p=getProjekt(window._crmProjSelId); if(!p){ window._crmProjSelId=null; paintProjectsList(); return; }
  const st=statusByKey(p.status);
  const statusOpts=PROJEKT_STATUS.map(s=>`<option value="${s.key}" ${s.key===p.status?'selected':''}>${esc(s.label)}</option>`).join('');

  const links=(p.links||[]).map((l,idx)=>{
    const ent=getEntity(l.tree,l.id); const tr=treeByKey(l.tree);
    const name=ent?((ent.stamm&&ent.stamm.name)||'(ohne Name)'):'(gelöscht)';
    return `<div class="crm-row">
      <div class="grow"><span class="name">${tr.icon} ${esc(name)}</span> <span class="small">${esc(tr.single)}</span></div>
      ${ent?`<button class="btn-sm-crm" onclick="crmOpenLinkedEntity('${l.tree}','${l.id}')">Öffnen</button>`:''}
      <button class="crm-x" title="Verknüpfung entfernen" onclick="crmProjRemoveLink(${idx})">✕</button>
    </div>`;
  }).join('') || `<div class="small" style="color:var(--muted)">Keine Verknüpfungen.</div>`;

  const tasks=(p.tasks||[]).map(t=>`
    <div class="crm-todo${t.done?' done':''}">
      <input type="checkbox" ${t.done?'checked':''} onchange="crmProjToggleTask('${t.id}')">
      <div class="grow"><span class="tx">${esc(t.text)}</span>${t.zustaendig?` <span class="fn">${esc(t.zustaendig)}</span>`:''}${t.faellig?` <span class="small">📅 ${esc(fmtDate(Date.parse(t.faellig)))}</span>`:''}</div>
      <button class="crm-x" onclick="crmProjDeleteTask('${t.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Aufgaben.</div>`;

  const log=(p.log||[]).slice().sort((a,b)=>b.ts-a.ts).map(l=>`
    <div class="crm-logitem">
      <div class="lh"><span>${esc(l.autor||'')}</span><span>${fmtDateTime(l.ts)} <button class="crm-x" onclick="crmProjDeleteNote('${l.id}')">✕</button></span></div>
      <div class="lt">${nl2br(l.text||'')}</div>
      ${l.summary?`<div class="ls"><strong>KI-Zusammenfassung:</strong><br>${nl2br(l.summary)}</div>`:''}
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Notizen.</div>`;

  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToProjects()">← Projekte</button>
      <h2>${esc(p.titel||'(ohne Titel)')}</h2>
      <button class="btn-sm-crm" onclick="crmEditProjekt()">✎ Bearbeiten</button>
      <button class="btn-sm-crm danger" onclick="crmDeleteProjekt()">Löschen</button>
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">📋 Projekt</span>
        <select class="crm-status-sel" style="background:${st.color}" onchange="crmProjSetStatus(this.value)">${statusOpts}</select>
      </h4>
      <div class="crm-fields">
        <div class="crm-field"><label>Team</label><div class="v">${esc(p.team||'– kein Team –')}</div></div>
        <div class="crm-field"><label>Verantwortlich</label><div class="v">${esc(p.verantwortlich||'–')}</div></div>
        <div class="crm-field"><label>Start</label><div class="v">${p.start?esc(fmtDate(Date.parse(p.start))):'–'}</div></div>
        <div class="crm-field"><label>Fällig</label><div class="v">${p.faellig?esc(fmtDate(Date.parse(p.faellig))):'–'}</div></div>
      </div>
      ${p.beschreibung?`<div class="crm-field" style="margin-top:12px"><label>Beschreibung</label><div class="v">${nl2br(p.beschreibung)}</div></div>`:''}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">🔗 Verknüpfte CRM-Einträge</span><button class="btn-sm-crm" onclick="crmProjAddLink()">＋ Verknüpfen</button></h4>
      ${links}
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">✅ Aufgaben &amp; Zuständigkeit</span></h4>
      ${tasks}
      <div class="crm-add-inline">
        <input id="crm-ptask-text" placeholder="Neue Aufgabe …" style="flex:1;min-width:150px">
        <input id="crm-ptask-resp" placeholder="Zuständig" style="width:120px">
        <input id="crm-ptask-due" type="date" style="width:150px">
        <button class="btn-sm-crm primary" onclick="crmProjAddTask()">Hinzufügen</button>
      </div>
    </div>

    <div class="crm-sec">
      <h4><span class="ttl">💬 Verlauf / Notizen</span><button class="btn-sm-crm primary" onclick="crmProjOpenNote()">🎤 Neue Notiz</button></h4>
      ${log}
    </div>
  </div>`;
}

// Formular (Anlegen/Bearbeiten)
function projFormHtml(p){
  const teamOpts=['<option value="">– kein Team –</option>']
    .concat(zeTeams().map(t=>`<option ${p.team===t?'selected':''}>${esc(t)}</option>`)).join('');
  const statusOpts=PROJEKT_STATUS.map(s=>`<option value="${s.key}" ${p.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('');
  return `
   <div class="crm-modal-field"><label>Titel *</label><input id="crm-pf-titel" value="${esc(p.titel||'')}"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:160px"><label>Team</label><select id="crm-pf-team">${teamOpts}</select></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Status</label><select id="crm-pf-status">${statusOpts}</select></div>
   </div>
   <div class="crm-modal-field"><label>Verantwortlich</label><input id="crm-pf-resp" value="${esc(p.verantwortlich||'')}"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Start</label><input id="crm-pf-start" type="date" value="${esc(p.start||'')}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Fällig</label><input id="crm-pf-faellig" type="date" value="${esc(p.faellig||'')}"></div>
   </div>
   <div class="crm-modal-field"><label>Beschreibung</label><textarea id="crm-pf-besch" rows="3">${esc(p.beschreibung||'')}</textarea></div>`;
}
function crmOpenNewProjekt(){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Projekt anlegen</h3>
    ${projFormHtml({status:'geplant', team:window._crmProjTeamFilter||''})}
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmSaveProjekt(true)">Anlegen</button></div>`, true);
}
// Projekt aus einem CRM-Eintrag heraus anlegen (gleich verknüpft)
function crmNewProjektForEntity(){
  const e=curEntity(); if(!e) return;
  window._crmPendingLink={ tree:window._crmTree, id:e.id };
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Projekt für „${esc((e.stamm&&e.stamm.name)||'')}"</h3>
    ${projFormHtml({status:'geplant'})}
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCancelEntityProjekt()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmSaveProjekt(true,true)">Anlegen &amp; verknüpfen</button></div>`, true);
}
function crmCancelEntityProjekt(){ window._crmPendingLink=null; crmCloseModal(); }
function crmEditProjekt(){
  const p=getProjekt(window._crmProjSelId); if(!p) return;
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✎ Projekt</h3>
    ${projFormHtml(p)}
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmSaveProjekt(false)">Speichern</button></div>`, true);
}
function crmSaveProjekt(isNew, fromEntity){
  const titel=val('crm-pf-titel'); if(!titel){ toast('Bitte einen Titel eingeben.','err'); return; }
  const data={ titel, team:val('crm-pf-team'), status:val('crm-pf-status')||'geplant',
    verantwortlich:val('crm-pf-resp'), start:val('crm-pf-start'), faellig:val('crm-pf-faellig'),
    beschreibung:val('crm-pf-besch') };
  if(isNew){
    const id=newId();
    const links=(fromEntity && window._crmPendingLink)?[window._crmPendingLink]:[];
    const p={ id, createdAt:Date.now(), links, tasks:[], log:[], ...data };
    saveProjekt(p);
    window._crmPendingLink=null;
    crmCloseModal();
    if(fromEntity){ paintDetail(); toast('Projekt angelegt & verknüpft ✓','ok'); }
    else { window._crmMode='projekte'; window._crmProjSelId=id; paintProjectDetail(); toast('Projekt angelegt ✓','ok'); }
  } else {
    mutateProjekt(p=>{ Object.assign(p, data); });
    crmCloseModal(); paintProjectDetail(); toast('Gespeichert ✓','ok');
  }
}
function crmDeleteProjekt(){
  const p=getProjekt(window._crmProjSelId); if(!p) return;
  if(!confirm(`Projekt „${p.titel||''}" wirklich löschen?`)) return;
  deleteProjekt(p.id); window._crmProjSelId=null; paintProjectsList(); toast('Gelöscht.','');
}
function crmProjSetStatus(key){ mutateProjekt(p=>{ p.status=key; }); paintProjectDetail(); }

// Aufgaben
function crmProjAddTask(){
  const text=val('crm-ptask-text'); if(!text){ toast('Bitte eine Aufgabe eingeben.','err'); return; }
  mutateProjekt(p=>{ if(!Array.isArray(p.tasks)) p.tasks=[]; p.tasks.push({ id:newId(), text, zustaendig:val('crm-ptask-resp'), faellig:val('crm-ptask-due'), done:false }); });
  paintProjectDetail();
}
function crmProjToggleTask(tid){ mutateProjekt(p=>{ const t=(p.tasks||[]).find(x=>x.id===tid); if(t) t.done=!t.done; }); paintProjectDetail(); }
function crmProjDeleteTask(tid){ mutateProjekt(p=>{ p.tasks=(p.tasks||[]).filter(x=>x.id!==tid); }); paintProjectDetail(); }

// Verknüpfungen mit CRM-Einträgen
function crmProjAddLink(){
  const groups=TREES.map(tr=>{
    const opts=listEntities(tr.key).map(e=>`<option value="${tr.key}:${e.id}">${esc((e.stamm&&e.stamm.name)||'(ohne Name)')}</option>`).join('');
    return opts?`<optgroup label="${esc(tr.label)}">${opts}</optgroup>`:'';
  }).join('');
  if(!groups){ toast('Es gibt noch keine CRM-Einträge zum Verknüpfen.',''); return; }
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">🔗 CRM-Eintrag verknüpfen</h3>
    <div class="crm-modal-field"><label>Eintrag</label><select id="crm-link-sel">${groups}</select></div>
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmProjSaveLink()">Verknüpfen</button></div>`);
}
function crmProjSaveLink(){
  const v=val('crm-link-sel'); if(!v) return;
  const i=v.indexOf(':'); if(i<0) return;
  const tree=v.slice(0,i), id=v.slice(i+1);
  mutateProjekt(p=>{ if(!Array.isArray(p.links)) p.links=[]; if(!p.links.some(l=>l.tree===tree&&l.id===id)) p.links.push({tree,id}); });
  crmCloseModal(); paintProjectDetail();
}
function crmProjRemoveLink(idx){ mutateProjekt(p=>{ if(Array.isArray(p.links)) p.links.splice(idx,1); }); paintProjectDetail(); }

// Projekt-Notizen (gleiche Diktat-/KI-Vorlage)
function crmProjOpenNote(){ crmOpenModalShell(); openModal(noteModalHtml('crmProjSaveNote'), true); }
function crmProjSaveNote(){
  _stopDictation();
  const text=val('crm-note-text'); if(!text){ toast('Bitte zuerst etwas diktieren oder tippen.','err'); return; }
  mutateProjekt(p=>{ if(!Array.isArray(p.log)) p.log=[]; p.log.push({ id:newId(), ts:Date.now(), autor:val('crm-note-autor'), text, summary:val('crm-note-summary') }); });
  crmCloseModal(); paintProjectDetail(); toast('Notiz gespeichert ✓','ok');
}
function crmProjDeleteNote(nid){ mutateProjekt(p=>{ p.log=(p.log||[]).filter(x=>x.id!==nid); }); paintProjectDetail(); }

// ── Window-Registrierung (für inline onclick) ──────────────────────
Object.assign(window, {
  renderCRM,
  crmSwitchTree, crmSearch, crmOpenDetail, crmBackToList, crmCloseModal,
  crmOpenNew, crmEditStamm, crmSaveStamm, crmDeleteEntity,
  crmAddMember, crmEditMember, crmSaveMember, crmDeleteMember,
  crmAddTermin, crmSaveTermin, crmDeleteTermin,
  crmAddAngebot, crmSaveAngebot, crmDeleteAngebot,
  crmSaveStatusQuo, crmAddTodo, crmToggleTodo, crmDeleteTodo,
  crmOpenNote, crmCancelNote, crmSaveNote, crmDictate, crmSummarizeNote, crmConfigAi,
  // Projektmanagement
  crmShowProjekte, crmProjTeamFilter, crmOpenProjDetail, crmBackToProjects,
  crmOpenProjFromEntity, crmOpenLinkedEntity, crmNewProjektForEntity, crmCancelEntityProjekt,
  crmOpenNewProjekt, crmEditProjekt, crmSaveProjekt, crmDeleteProjekt, crmProjSetStatus,
  crmProjAddTask, crmProjToggleTask, crmProjDeleteTask,
  crmProjAddLink, crmProjSaveLink, crmProjRemoveLink,
  crmProjOpenNote, crmProjSaveNote, crmProjDeleteNote
});
