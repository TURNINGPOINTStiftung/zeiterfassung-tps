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
  saveAccess, getAccess, getCrmConfig, saveCrmConfig,
  saveVerteiler, deleteVerteiler, getVerteiler, listVerteiler,
  saveVeranstaltung, deleteVeranstaltung, getVeranstaltung, listVeranstaltungen,
  saveWorkflow, deleteWorkflow, getWorkflow, listWorkflows,
  listHistory, restoreHistory
} from './crm-data.js';
import {
  getTrees, treeByKey, stammFields, memberFunctions,
  getAiEndpoint, setAiEndpoint,
  getTaskStatus, taskStatusByKey, FALLBACK_TEAMS,
  DEFAULT_TREES, DEFAULT_STAMM_FIELDS, DEFAULT_MEMBER_FUNCTIONS, FIELD_TYPES
} from './crm-config.js';

// ── kleine Helfer ──────────────────────────────────────────────────
const esc = s => String(s==null?'':s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const nl2br = s => esc(s).replace(/\n/g,'<br>');
// Telefonnummer → tel:-Link (mobil öffnet das Tastenfeld). Nur Ziffern und + behalten.
const telHref  = t => 'tel:'+String(t==null?'':t).replace(/[^\d+]/g,'');
const mailHref = m => 'mailto:'+esc(String(m==null?'':m).trim());
// Freitext sicher escapen UND enthaltene Internet-Links / E-Mail-Adressen klickbar machen.
function linkify(s){
  let h = nl2br(s);
  // http(s)://… – abschließende Satzzeichen nicht mitnehmen
  h = h.replace(/\bhttps?:\/\/[^\s<]+/g, m=>{
    const url=m.replace(/[.,;:!?)\]]+$/,''); const tail=m.slice(url.length);
    return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
  });
  // www.… ohne Protokoll (nicht, wenn schon Teil eines href oben)
  h = h.replace(/(^|[\s(>])(www\.[^\s<]+)/g, (m,pre,u)=>{
    const url=u.replace(/[.,;:!?)\]]+$/,''); const tail=u.slice(url.length);
    return `${pre}<a href="https://${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
  });
  // E-Mail-Adressen → mailto: (öffnet Outlook/Standard-Mailprogramm als neue Nachricht)
  h = h.replace(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, m=>`<a href="mailto:${m}">${m}</a>`);
  return h;
}
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
function isEntityCtx(){ return !!(window._crmTaskCtx && window._crmTaskCtx.kind==='entity'); }
function curContainer(){
  const ctx=window._crmTaskCtx; if(!ctx) return null;
  if(ctx.kind==='teamprojekt'){ const c=getTeamProjekt(ctx.id); if(c) normTasks(c); return c; }
  if(ctx.kind==='veranstaltung'){ const c=getVeranstaltung(ctx.id); if(c){ normTasks(c); recoverV187VaItems(c); } return c; }
  // Eintrag: der Container ist das AUSGEWÄHLTE Projekt (ctx.pid)
  const ent=getEntity(ctx.tree, ctx.eid); if(!ent) return null; migEntityProjekte(ent);
  const p=(ent.projekte||[]).find(x=>x.id===ctx.pid); if(!p) return null;
  normTasks(p); return p;
}
function mutateContainer(fn){
  const ctx=window._crmTaskCtx; if(!ctx) return;
  if(ctx.kind==='teamprojekt'){
    const p=getTeamProjekt(ctx.id); if(!p) return; normTasks(p);
    try{ fn(p); }catch(e){ console.error('CRM mutateContainer:',e); return; }
    p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
    saveTeamProjekt(p);
  } else if(ctx.kind==='veranstaltung'){
    const v=getVeranstaltung(ctx.id); if(!v) return; normTasks(v); recoverV187VaItems(v);
    try{ fn(v); }catch(e){ console.error('CRM mutateContainer:',e); return; }
    v.updatedByKuerzel=curKuerzel(); v.updatedByName=curName();
    saveVeranstaltung(v);
  } else {
    const ent=getEntity(ctx.tree, ctx.eid); if(!ent) return; migEntityProjekte(ent);
    const p=(ent.projekte||[]).find(x=>x.id===ctx.pid); if(!p) return; normTasks(p);
    try{ fn(p); }catch(e){ console.error('CRM mutateContainer:',e); return; }
    ent.updatedByKuerzel=curKuerzel(); ent.updatedByName=curName();
    saveEntity(ctx.tree, ent);
  }
}
function repaintContainer(){
  switch(window._crmAfterTask){
    case 'projektdetail': paintTeamProjektDetail(); break;
    case 'teamdetail':    paintTeamDetail(); break;
    case 'meine':         paintMeine(); break;
    case 'veranstaltung': paintVeranstaltungDetail(); break;
    default:              paintDetail();
  }
  // Nach der Schnellerfassung den Fokus zurück ins Eingabefeld (flüssiges Tippen)
  const fa=window._crmFocusAfter; window._crmFocusAfter=null;
  if(fa){ const el=document.getElementById(fa); if(el){ try{ el.focus(); }catch(e){} } }
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
  const teams = Array.isArray(team) ? team.filter(Boolean) : (team?[team]:[]);
  const us=zeUsers().filter(u=>u.id!=='admin');
  const list = !teams.length ? us : us.filter(u=> teams.some(t=> u.team===t || (Array.isArray(u.teams)&&u.teams.includes(t)) ));
  return list.map(u=>({id:u.id, name:u.name}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
}
function assigneeOptsHtml(team, selId){
  const opts=[`<option value="">– niemand –</option>`];
  teamMembers(team).forEach(u=>{ opts.push(`<option value="${esc(u.id)}" ${u.id===selId?'selected':''}>${esc(u.name)}</option>`); });
  return opts.join('');
}

// ── Eintrags-Status (für Übersicht/Filter) ─────────────────────────
const CRM_STATUS=[
  { key:'ruhend',        label:'Ruhend',             color:'#9aa4b2' },
  { key:'aktiv',         label:'Aktiv',              color:'#12b347' },
  { key:'beratung',      label:'Beratung',           color:'#0d8a8a' },
  { key:'eigenstaendig', label:'Läuft eigenständig', color:'#2d6099' },
  { key:'foerderung',    label:'Förderung',          color:'#7b3fb3' },
  { key:'klaerung',      label:'Klärung',            color:'#e58a00' },
  { key:'sonstiges',     label:'Sonstiges',          color:'#6b7280' }
];
function crmStatusDef(k){ return CRM_STATUS.find(s=>s.key===k)||null; }
function crmStatusBadge(k){ const d=crmStatusDef(k); return d?`<span class="crm-statusbadge" style="background:${d.color}">${esc(d.label)}</span>`:''; }
function crmStatusOpts(sel){ return ['<option value="">– kein Status –</option>'].concat(CRM_STATUS.map(s=>`<option value="${s.key}"${sel===s.key?' selected':''}>${esc(s.label)}</option>`)).join(''); }
// Alle bereits vergebenen Schlagworte über ALLE Bäume (für Vorschläge)
function allTags(){
  const seen=new Map();
  try{ getTrees().forEach(tr=>listEntities(tr.key).forEach(e=>{
    String((e.stamm&&e.stamm.tags)||'').split(/[,;]+/).forEach(t=>{ const v=t.trim(); if(v){ const k=v.toLowerCase(); if(!seen.has(k)) seen.set(k,v); } });
  })); }catch(err){}
  return Array.from(seen.values()).sort((a,b)=>a.localeCompare(b,'de',{sensitivity:'base'}));
}

// ── CRM-Zugriff des angemeldeten Nutzers ───────────────────────────
function accessLevel(){
  const cu=window.cu; if(!cu) return 'none';
  if(cu.role==='admin') return 'admin';
  const a=getAccess(cu.id);
  return (a && a.level) || 'none';
}
// Zugeordnete Vereine (mehrere möglich; Abwärtskompat. zu einzelnem vereinId)
function accessVereine(){
  const cu=window.cu; if(!cu) return [];
  const a=getAccess(cu.id); if(!a) return [];
  if(Array.isArray(a.vereinIds)) return a.vereinIds.filter(Boolean);
  return a.vereinId ? [a.vereinId] : [];
}
function accessVerein(){ const v=accessVereine(); return v[0]||''; }  // Kompat (erster Verein)
function crmRestricted(){ return accessLevel()==='verein'; }
function crmFull(){ const l=accessLevel(); return l==='admin'||l==='full'; }
// Sieht alles (alle Bäume/Teams/Verteiler), aber 'readonly' darf nichts Strukturelles
// anlegen/löschen (Einträge, Projekte, Vorlagen, Verteiler) – nur Aufgaben bearbeiten.
function crmCanView(){ const l=accessLevel(); return l==='admin'||l==='full'||l==='readonly'; }

// Modul-Leiste je nach Rechten ein-/ausblenden (von initApp aufgerufen).
function crmSetupModuleBar(){
  try{
    const cu=window.cu; if(!cu) return;
    const isAdmin=cu.role==='admin';
    const bar=document.getElementById('module-bar');
    if(bar) bar.style.display='flex';  // einziger Header → nach Login immer sichtbar
    ensureCrmReady().then(()=>{
      // CRM für ALLE (jede Person hat „Meine Aufgaben"); Tiefe der Sicht regelt das CRM selbst.
      const isMgr=isAdmin||cu.role==='leitung'||cu.role==='geschaeftsfuehrer';
      const show={ zeiterfassung:!cu.crmOnly, website:isAdmin, forum:isAdmin, crm:true, auswertung:isMgr, verwaltung:isAdmin };
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
  #crm-root{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--bg);position:relative}
  .crm-search-panel{position:absolute;left:0;right:0;bottom:0;background:var(--bg);overflow-y:auto;z-index:25;padding:14px 22px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
  .crm-sr-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:10px}
  .crm-sr-grp{margin-bottom:16px}
  .crm-sr-h{font-size:13px;font-weight:700;color:var(--primary);margin:0 0 6px}
  .crm-sr{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;margin-bottom:6px}
  .crm-sr:hover{border-color:var(--primary-l);box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .crm-sr-i{font-size:18px;flex:none}
  .crm-sr-t{min-width:0}
  .crm-sr-n{font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crm-sr-s{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crm-sr-more{font-size:12px;color:var(--muted);padding:4px 2px}
  .crm-sr-empty{color:var(--muted);padding:10px 2px}
  .crm-bar{display:flex;align-items:center;gap:10px;padding:11px 22px;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.4) blur(8px);-webkit-backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--border);flex-wrap:wrap;position:sticky;top:0;z-index:20;box-shadow:0 1px 3px rgba(32,56,105,.05)}
  .crm-trees{display:flex;gap:6px;flex-wrap:wrap}
  .crm-tree-tab{background:#fff;border:1.5px solid var(--border);border-radius:999px;padding:7px 15px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;transition:background .15s,color .15s,border-color .15s,box-shadow .15s,transform .05s}
  .crm-tree-tab:hover{border-color:var(--primary-l);color:var(--primary);background:#f5f8fd}
  .crm-tree-tab:active{transform:translateY(1px)}
  .crm-tree-tab.active{background:var(--primary);border-color:var(--primary);color:#fff;box-shadow:0 2px 8px rgba(32,56,105,.25)}
  .crm-search{margin-left:auto;padding:8px 14px;border:1.5px solid var(--border);border-radius:999px;font-size:14px;min-width:200px;color:var(--text);background:#fff;transition:border-color .15s,box-shadow .15s}
  .crm-search:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .crm-body{padding:18px 22px;overflow-y:auto;flex:1}
  .crm-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .crm-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:15px 17px;cursor:pointer;transition:box-shadow .18s,border-color .18s,transform .12s;box-shadow:0 1px 2px rgba(32,56,105,.04)}
  .crm-card:hover{box-shadow:0 8px 22px rgba(32,56,105,.12);border-color:var(--primary-l);transform:translateY(-2px)}
  .crm-card h3{font-size:15px;font-weight:700;color:var(--primary);margin:0 0 4px}
  .crm-card .sub{font-size:12px;color:var(--muted);margin-bottom:8px;white-space:pre-line}
  .crm-card .meta{display:flex;gap:8px;flex-wrap:wrap}
  .crm-chip{font-size:11px;font-weight:600;background:#eef2f8;border:1px solid #e0e6f0;border-radius:999px;padding:3px 10px;color:var(--primary-l)}
  .crm-chip.warn{background:#fff4e5;border-color:#ffd9a0;color:#b56a00}
  /* Kontakt-Karten: kompakt, proportional zum Rest (nicht größer als normale Karten) */
  .crm-kontakt{padding:13px 15px}
  .crm-kontakt h3{font-size:14px;margin-bottom:3px}
  .crm-kontakt .sub{font-size:12px;color:var(--text);font-weight:500;margin-bottom:7px}
  .crm-kontakt .meta{gap:7px}
  .crm-kontakt .meta .crm-chip{font-size:11px;font-weight:600;padding:3px 10px}
  .crm-empty{text-align:center;color:var(--muted);padding:60px 20px}
  .crm-detail-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .crm-detail-head h2{font-size:22px;font-weight:700;color:var(--primary);margin:0;flex:1;min-width:200px}
  .crm-subtabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}
  .crm-subtab{background:none;border:none;border-bottom:2.5px solid transparent;padding:9px 15px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;margin-bottom:-1px;transition:color .15s,border-color .15s}
  .crm-subtab:hover{color:var(--primary)}
  .crm-subtab.active{color:var(--primary);border-bottom-color:var(--primary)}
  .crm-sec{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(32,56,105,.04)}
  .crm-sec h4{font-size:12px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.6px;margin:0 0 14px;display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
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
  .crm-tsel{padding:6px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:12px;background:#fff;color:var(--text);transition:border-color .15s,box-shadow .15s}
  .crm-tsel:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .crm-logitem{border-top:1px solid var(--border);padding:10px 0}
  .crm-logitem .lh{font-size:11px;color:var(--muted);margin-bottom:4px;display:flex;justify-content:space-between;gap:8px}
  .crm-logitem .lt{font-size:14px;color:var(--text);white-space:pre-line}
  .crm-logitem .ls{margin-top:6px;background:#eef7ee;border-left:3px solid var(--accent);border-radius:6px;padding:7px 10px;font-size:13px;color:#2c5e2e}
  .crm-add-inline{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .crm-add-inline input,.crm-add-inline select{padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;transition:border-color .15s,box-shadow .15s}
  .crm-add-inline input:focus,.crm-add-inline select:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .crm-ta{width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;transition:border-color .15s,box-shadow .15s}
  .crm-ta:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .crm-mic{background:#fff;border:1.5px solid var(--border);border-radius:8px;padding:7px 12px;cursor:pointer;font-size:14px;font-weight:600;color:var(--primary)}
  .crm-mic.rec{background:#fdecea;border-color:#e74c3c;color:#c0392b;animation:crmPulse 1.1s infinite}
  @keyframes crmPulse{0%,100%{opacity:1}50%{opacity:.55}}
  .crm-modal-field{margin-bottom:14px}
  .crm-modal-field label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:5px}
  .crm-modal-field input,.crm-modal-field select,.crm-modal-field textarea{width:100%;box-sizing:border-box;padding:10px 13px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;background:#fff;color:var(--text);transition:border-color .15s,box-shadow .15s}
  .crm-modal-field input::placeholder,.crm-modal-field textarea::placeholder{color:#aab2bd}
  .crm-modal-field input:focus,.crm-modal-field select:focus,.crm-modal-field textarea:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .crm-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap}
  .btn-sm-crm{padding:8px 15px;font-size:13px;border-radius:9px;border:1.5px solid var(--border);background:#fff;color:var(--primary);font-weight:600;cursor:pointer;transition:background .15s,color .15s,border-color .15s,box-shadow .15s,transform .05s}
  .btn-sm-crm:hover{border-color:var(--primary-l);background:#f5f8fd;box-shadow:0 2px 6px rgba(32,56,105,.08)}
  .btn-sm-crm:active{transform:translateY(1px)}
  .btn-sm-crm:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(32,56,105,.18)}
  .btn-sm-crm.primary{background:var(--primary);border-color:var(--primary);color:#fff}
  .btn-sm-crm.primary:hover{background:var(--primary-l);border-color:var(--primary-l);box-shadow:0 4px 12px rgba(32,56,105,.28)}
  .btn-sm-crm.danger{color:#c0392b;border-color:#f0bcb6}
  .btn-sm-crm.danger:hover{background:#fdecea;border-color:#e7a99f}
  .btn-sm-crm:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
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
  .crm-tnode.top{border:1.5px solid var(--border);border-radius:10px;padding:6px 12px;margin-bottom:10px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .crm-tnode>.crm-task{border-top:none}
  .crm-check{width:18px;height:18px;cursor:pointer;flex-shrink:0;margin:0}
  .crm-subs{margin-left:14px;padding-left:12px;border-left:2px solid var(--border)}
  .crm-tmeta{font-size:11px;color:var(--muted);margin-top:2px}
  .crm-tnote{font-size:13px;color:var(--text);margin-top:4px;white-space:pre-line;background:rgba(0,0,0,.035);border-radius:6px;padding:5px 9px}
  .crm-prog{font-size:11px;font-weight:700;color:var(--primary);background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:2px 9px;white-space:nowrap;flex-shrink:0}
  .crm-stats{width:100%;border-collapse:collapse;font-size:13px}
  .crm-stats th{text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:5px 8px;border-bottom:2px solid var(--border);white-space:nowrap}
  .crm-stats td{padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
  .crm-delta{font-size:11px;font-weight:700}
  .crm-delta.up{color:var(--accent)} .crm-delta.down{color:#c0392b}
  .crm-stat-year{margin-bottom:14px}
  .crm-stat-yhead{font-size:13px;font-weight:800;color:var(--primary);padding:2px 0 6px;letter-spacing:.3px}
  .crm-stat-typ{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:700;white-space:nowrap;color:#fff}
  .crm-stat-typ.t-training{background:#0d8a8a} .crm-stat-typ.t-veranstaltung{background:#7b3fb3} .crm-stat-typ.t-sonstiges{background:#6b7280}
  .crm-stat-notecell{white-space:normal;min-width:160px;max-width:320px}
  .crm-stat-note{white-space:pre-line;font-size:12.5px;line-height:1.45}
  .crm-stat-act{white-space:nowrap;text-align:right}
  .crm-stat-quote{background:rgba(45,96,153,.08);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:13px;color:var(--text)}
  .vw-table{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
  .vw-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);padding:8px 12px;border-bottom:2px solid var(--border);white-space:nowrap}
  .vw-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
  .vw-table tbody tr{transition:background .12s}
  .vw-table tbody tr:hover{background:#f5f8fd}
  .vw-name{font-weight:700;color:var(--primary)}
  .vw-team{display:inline-block;font-size:11px;font-weight:600;background:#eef2f8;border:1px solid #e0e6f0;border-radius:999px;padding:2px 9px;margin:1px 3px 1px 0;color:var(--primary-l)}
  .crm-viewtoggle{display:inline-flex;border:1.5px solid var(--border);border-radius:8px;overflow:hidden}
  .crm-viewtoggle button{background:#fff;border:none;padding:5px 11px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer}
  .crm-viewtoggle button.active{background:var(--primary);color:#fff}
  .crm-board-title{display:inline-flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:var(--primary);background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 12px;margin-bottom:10px;cursor:pointer}
  .crm-board-title:hover{border-color:var(--primary-l)}
  .crm-projtabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .crm-projtab{background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:6px 14px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer}
  .crm-projtab:hover{border-color:var(--primary-l)}
  .crm-projtab.active{background:var(--primary);color:#fff;border-color:var(--primary)}
  .crm-projtab .cnt{display:inline-block;min-width:16px;padding:0 5px;margin-left:4px;border-radius:9px;background:rgba(0,0,0,.16);font-size:11px;text-align:center}
  .crm-projhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
  .crm-projhead .crm-board-title{margin-bottom:0}
  .crm-projhist{margin-top:14px;border-top:1px dashed var(--border);padding-top:10px}
  .crm-projhist>summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
  .vt-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .crm-hist-sum{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px}
  .crm-hist-sum::-webkit-details-marker{display:none}
  .crm-hist-sum::before{content:'▸';color:var(--muted);font-size:13px;transition:transform .15s}
  details[open]>.crm-hist-sum::before{transform:rotate(90deg)}
  .crm-hist-sum .ttl{font-size:15px;font-weight:700;color:var(--primary)}
  .vw-vpick{display:flex;flex-direction:column;gap:2px;margin-top:6px;max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px}
  .vw-vpick label{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap}
  .vw-ie-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 14px;margin-bottom:12px}
  .vw-ie-item{display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:#fff}
  .vw-ie-item:hover{border-color:var(--primary-l)}
  .vw-ie-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .kb-atts{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .kb-att{font-size:11px;background:#eef2fa;border:1px solid var(--border);border-radius:8px;padding:2px 8px;color:var(--primary);text-decoration:none;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .kb-att:hover{background:#e2e9f6}
  .kb-cardbtns{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .crm-contact{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px}
  .crm-contact a{color:var(--primary);text-decoration:none;font-weight:600}
  .crm-contact a:hover{text-decoration:underline}
  .crm-contact .sep{color:var(--muted)}
  .crm-field .v a,.kb-card-note a,.crm-logitem a{color:var(--primary)}
  .crm-att-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)}
  .crm-att-row .grow{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crm-att-row .crm-x{border:none;background:none;color:#c0392b;cursor:pointer;font-size:14px;padding:2px 6px}
  .kb-board{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 10px;align-items:flex-start}
  .kb-col{flex:0 0 268px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:70px}
  .kb-col-new{background:none;border:1px dashed var(--border);align-items:flex-start}
  .kb-col-head{display:flex;align-items:center;gap:6px}
  .kb-grip{cursor:grab;color:var(--muted);font-size:13px;line-height:1;user-select:none;flex-shrink:0}
  .kb-grip:active{cursor:grabbing}
  .kb-col-title{font-weight:700;color:var(--primary);font-size:14px;cursor:pointer;flex:1}
  .kb-col-sub{font-size:11px;color:var(--muted);margin-top:-4px}
  .kb-cards{display:flex;flex-direction:column;gap:8px;min-height:8px}
  .kb-card{background:#fff;border:1px solid var(--border);border-radius:9px;padding:9px 10px;box-shadow:0 1px 2px rgba(0,0,0,.06);cursor:grab}
  .kb-card:active{cursor:grabbing}
  .kb-card.done{opacity:.65}
  .kb-card-top{display:flex;align-items:flex-start;gap:7px}
  .kb-card-title{font-weight:600;color:var(--text);font-size:13.5px;cursor:pointer}
  .kb-card.done .kb-card-title{text-decoration:line-through;color:var(--muted)}
  .kb-card-note{font-size:12px;color:var(--muted);margin-top:5px;white-space:pre-line}
  .kb-card-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;align-items:center}
  .kb-chip{font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:1px 7px;color:var(--muted)}
  .kb-checklist{margin-top:8px;border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:3px}
  .kb-check{display:flex;align-items:center;gap:6px;font-size:12.5px}
  .kb-check.done .kb-check-tx{text-decoration:line-through;color:var(--muted)}
  .kb-check-tx{cursor:pointer;flex:1}
  .kb-add,.kb-additem{background:none;border:none;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;text-align:left;padding:4px 2px}
  .kb-add:hover,.kb-additem:hover{text-decoration:underline}
  /* Inline-Schnellerfassung: Aufgabe/Spalte/Schritt direkt tippen + Enter (kein Dialog nötig) */
  .kb-qadd{width:100%;box-sizing:border-box;border:1px dashed var(--border);background:rgba(0,0,0,.02);border-radius:7px;padding:6px 9px;font-size:12.5px;color:var(--text);margin-top:6px;transition:border-color .12s,background .12s}
  .kb-qadd::placeholder{color:var(--muted)}
  .kb-qadd:focus{outline:none;border-style:solid;border-color:var(--primary);background:#fff;box-shadow:0 0 0 3px rgba(45,96,153,.12)}
  .kb-qadd-step{font-size:12px;padding:4px 8px;margin-top:6px}
  .kb-qadd-col{margin-top:0}
  /* Mehrfach-Eingabe (E-Mails/Telefon) im Kontaktformular */
  .crm-mf-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
  .crm-mf-row input{flex:1;min-width:0}
  .crm-mf-row .crm-x{flex-shrink:0}
  /* Kontaktnotizen mit History */
  .crm-kn-item{border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fff}
  .crm-kn-latest .crm-kn-item{border-color:var(--primary);background:rgba(45,96,153,.05)}
  .crm-kn-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-bottom:4px}
  .crm-kn-meta .crm-x{margin-left:auto}
  .crm-kn-text{white-space:pre-line;font-size:13.5px;line-height:1.5;word-break:break-word}
  .crm-kn-hist{margin-top:8px}
  .crm-kn-hist summary{cursor:pointer;font-size:12.5px;color:var(--primary);font-weight:600;padding:4px 0}
  .crm-kn-hist[open] summary{margin-bottom:6px}
  /* Einheitlicher Anlege-Knopf mit Menü */
  .crm-neu-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .crm-neu-wrap{position:relative}
  .crm-neu-menu{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:20;background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:5px;min-width:190px}
  .crm-neu-menu button{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 12px;border-radius:7px;font-size:14px;cursor:pointer;color:var(--text)}
  .crm-neu-menu button:hover{background:var(--hover,#eef3f9)}
  /* Status */
  .crm-statusrow{display:flex;align-items:center;gap:10px}
  .crm-statuslabel{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
  .crm-status-select{padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13.5px;background:#fff;color:var(--text)}
  .crm-statusbadge{display:inline-block;padding:2px 9px;border-radius:999px;color:#fff;font-size:11px;font-weight:700;white-space:nowrap}
  .crm-statusfilter{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .crm-sf-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
  .crm-sf-select{padding:6px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13.5px;background:#fff;color:var(--text);cursor:pointer}
  /* Schlagwort-Vorschläge */
  .crm-tag-suggest{display:none;position:absolute;left:0;right:0;top:100%;z-index:25;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.12);margin-top:2px;max-height:210px;overflow:auto;padding:4px}
  .crm-tag-suggest button{display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--text)}
  .crm-tag-suggest button:hover{background:var(--hover,#eef3f9)}
  .kb-card input[type=checkbox],.kb-check input[type=checkbox]{width:15px;height:15px;cursor:pointer;flex-shrink:0;margin:0}
  @media(max-width:640px){
    /* Ganze CRM-Seite scrollt (kein interner Scroll) → Header + Leiste verschwinden beim Scrollen */
    #crm-root{display:block;flex:none}
    .crm-body{overflow:visible;flex:none;display:block}
    .crm-bar{position:static;padding:6px 9px;gap:5px}
    .crm-trees{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;padding-bottom:3px}
    .crm-tree-tab{flex:0 0 auto;font-size:14px;padding:8px 14px}
    .crm-search{min-width:0;flex:1 1 110px;padding:6px 10px}
    .crm-bar .btn-sm-crm{padding:6px 9px;font-size:12px}
    .btn-lbl{display:none}              /* Buttons in der Leiste nur als Icon */
    .crm-body{padding:11px 9px}
    .crm-sec{padding:11px 11px;margin-bottom:11px}
    .crm-sec h4{font-size:12px}
    .crm-detail-head{gap:8px;margin-bottom:12px}
    .crm-detail-head h2{order:-1;width:100%;min-width:0;font-size:18px}   /* Titel auf eigener Zeile */
    .crm-fields{grid-template-columns:1fr}
    .crm-list{grid-template-columns:1fr}
    .kb-board{gap:10px;scroll-snap-type:x mandatory}
    .kb-col{flex:0 0 86vw;max-width:360px;scroll-snap-align:start}
    .crm-modal-actions{gap:8px}
    /* Verwaltungs-Mitarbeitertabelle als Karten statt breiter Tabelle */
    .vw-table,.vw-table tbody,.vw-table tr,.vw-table td{display:block;width:auto}
    .vw-table thead{display:none}
    .vw-table tr{border:1.5px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:9px;background:#fff}
    .vw-table td{border:none;padding:3px 0}
    .vw-table td .crm-tsel{margin:3px 6px 3px 0}
  }
  /* ── Workflows (Automatisierung) ── */
  .wf-list{display:flex;flex-direction:column;gap:10px;max-width:760px}
  .wf-item{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;cursor:pointer}
  .wf-item:hover{box-shadow:0 2px 10px rgba(0,0,0,.08)}
  .wf-item h3{margin:0;font-size:15px}
  .wf-item .sub{font-size:12.5px;color:var(--muted);margin-top:2px}
  .wf-badge{font-size:11px;font-weight:700;border-radius:999px;padding:2px 10px;white-space:nowrap}
  .wf-badge.pub{background:#e3f3e3;color:#2f7a33;border:1px solid #bfe0bf}
  .wf-badge.draft{background:#eef2f8;color:#5a6b85;border:1px solid #dbe2ee}
  .wf-canvas{display:flex;flex-direction:column;align-items:center;padding:6px 0 40px}
  .wf-step{width:min(440px,94%);background:#fff;border:1px solid #e3e7ee;border-radius:10px;box-shadow:0 1px 5px rgba(0,0,0,.07);overflow:hidden}
  .wf-step-hd{color:#fff;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:6px 12px;display:flex;justify-content:space-between;align-items:center}
  .wf-step-bd{padding:10px 13px}
  .wf-step-bd .t{font-weight:600;margin-bottom:2px}
  .wf-step-bd .d{font-size:12.5px;color:#5a6b85;white-space:pre-line}
  .wf-step-num{background:rgba(255,255,255,.28);border-radius:5px;padding:0 6px;margin-right:7px}
  .wf-conn{width:2px;height:22px;background:#c7cedd}
  .wf-acts{display:flex;gap:5px}
  .wf-acts button{background:rgba(255,255,255,.25);border:0;color:#fff;border-radius:5px;cursor:pointer;font-size:12px;line-height:1.6;padding:0 7px}
  .wf-acts button:hover{background:rgba(255,255,255,.45)}
  .wf-add{margin-top:8px;border:1.5px dashed #c7cedd;background:#fff;color:#2d6099;border-radius:10px;padding:9px 16px;cursor:pointer;font-weight:600;font-size:13px}
  .wf-add:hover{background:#f4f7fc}
  .wf-end{margin-top:8px;background:#eef2f8;color:#5a6b85;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600}
  .wf-ed-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
  .wf-name{font-size:18px;font-weight:700;border:0;border-bottom:1px solid transparent;background:transparent;padding:4px 2px;min-width:200px;flex:1;color:var(--text)}
  .wf-name:focus{outline:none;border-bottom-color:var(--primary)}
  .wf-kindpick{display:flex;flex-direction:column;gap:8px}
  .wf-kindpick button{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid var(--border);background:#fff;border-radius:9px;padding:10px 12px;cursor:pointer;font-size:14px}
  .wf-kindpick button:hover{border-color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .wf-kindpick .dot{width:12px;height:12px;border-radius:3px;flex:none}
  `;
  const st=document.createElement('style'); st.id='crm-styles'; st.textContent=css;
  document.head.appendChild(st);
}

// ── Einstieg ───────────────────────────────────────────────────────
export function renderCRM(){
  try{
    injectStyles();
    const _trees=getTrees();
    if(!window._crmTree || !_trees.some(t=>t.key===window._crmTree)) window._crmTree = _trees[0].key;
    if(!window._crmMode) window._crmMode = 'kontakte';
    window._crmModalOpen = false;
    const root = document.getElementById('crm-root');
    if(!root) return;
    root.innerHTML = '<div class="crm-empty">Lade CRM …</div>';
    ensureCrmReady().then(()=>{
      try{
        const lvl=accessLevel();
        if(lvl==='none') window._crmMode='teams';
        else if(lvl==='verein' && window._crmMode!=='teams' && window._crmMode!=='meine'){
          window._crmMode='kontakte'; window._crmTree='vereine';
          const vs=accessVereine(); if(!vs.includes(window._crmSelId)) window._crmSelId=vs[0]||'';
        }
        paint();
      }catch(e){ console.error('CRM paint:',e); }
    });
  }catch(e){ console.error('renderCRM Fehler:',e); }
}
setCrmRenderHook(()=>{ try{ paint(); }catch(e){} });

function paint(){
  window._crmModalOpen = false;
  const mode = window._crmMode || 'kontakte';
  if(mode==='verteiler' && crmCanView()){ paintVerteiler(); return; }
  if(mode==='veranstaltungen' && crmCanView()){
    if(window._crmVaSel && getVeranstaltung(window._crmVaSel)) paintVeranstaltungDetail(); else paintVeranstaltungen();
    return;
  }
  if(mode==='meine'){
    if(window._crmTeamProjSel && getTeamProjekt(window._crmTeamProjSel)) paintTeamProjektDetail();
    else paintMeine();
    return;
  }
  if(mode==='teams'){
    if(window._crmTeamProjSel && getTeamProjekt(window._crmTeamProjSel)) paintTeamProjektDetail();
    else if(window._crmTeamSel) paintTeamDetail();
    else paintTeamsList();
    return;
  }
  if(window._crmSelId && curEntity()) paintDetail();
  else if(!crmCanView()){
    const vid=accessVerein();
    if(vid && getEntity('vereine',vid)){ window._crmTree='vereine'; window._crmSelId=vid; paintDetail(); }
    else { window._crmMode='meine'; paintMeine(); }
  }
  else { window._crmSelId = null; paintList(); }
}

// ── Bar ────────────────────────────────────────────────────────────
function barHtml(){
  const mode = window._crmMode || 'kontakte';
  const full = crmFull();
  const view = crmCanView();
  const lvl  = accessLevel();
  const homeActive = (mode==='teams'||mode==='meine'||mode==='veranstaltungen');
  const homeLabel  = view ? '👥 Teams' : '🙋 Meine Aufgaben';
  const tabs = [`<button class="crm-tree-tab${homeActive?' active':''}" onclick="crmShowTeams()">${homeLabel}</button>`];
  if(view){
    getTrees().forEach(t=>tabs.push(`<button class="crm-tree-tab${(mode==='kontakte'&&t.key===window._crmTree)?' active':''}" onclick="crmSwitchTree('${t.key}')">${esc(t.icon||'')} ${esc(t.label)}</button>`));
    // Veranstaltungen sind unter „Teams" integriert (kein eigener Top-Reiter mehr)
    tabs.push(`<button class="crm-tree-tab${mode==='verteiler'?' active':''}" onclick="crmShowVerteiler()">✉️ Verteiler</button>`);
  } else if(lvl==='verein'){
    accessVereine().forEach(vid=>{ const ve=getEntity('vereine',vid); if(!ve) return; const nm=(ve.stamm&&ve.stamm.name)||'Verein';
      tabs.push(`<button class="crm-tree-tab${(mode==='kontakte'&&window._crmSelId===vid)?' active':''}" onclick="crmRestrictedOpen('${vid}')">🏛️ ${esc(nm)}</button>`); });
  }
  let right = '';
  if(view){
    right = `<input class="crm-search" type="search" placeholder="Im ganzen CRM suchen …" value="${esc(window._crmSearch||'')}" oninput="crmSearchInput(this.value)">
      ${(mode==='kontakte'&&full)?`<button class="btn-sm-crm primary" onclick="crmOpenNew()">＋<span class="btn-lbl"> Neu</span></button>`:''}`;
  } else {
    right = `<span style="margin-left:auto"></span>`;
  }
  const adminBtns = full
    ? `<button class="btn-sm-crm" title="Aufgaben-Vorlagen verwalten" onclick="crmOpenVorlagen()">📋<span class="btn-lbl"> Vorlagen</span></button>
       <button class="btn-sm-crm" title="Kontakte/Daten als Excel exportieren & importieren" onclick="crmImpExpModal()">⇅<span class="btn-lbl"> Excel</span></button>
       <button class="btn-sm-crm" title="KI-Proxy für Zusammenfassungen" onclick="crmConfigAi()">⚙️<span class="btn-lbl"> KI ${getAiEndpoint()?'✓':'–'}</span></button>`
    : '';
  return `<div class="crm-bar"><div class="crm-trees">${tabs.join('')}</div>${right}${adminBtns}</div>`;
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
      const hay=Object.values(s).map(x=>String(x==null?'':x).toLowerCase()).join(' ');  // ALLE Stammfelder (inkl. Vereinskürzel, Mentor, Vereinsentwickler …)
      const ctxt=(e.kontakte||[]).map(k=>k.name+' '+k.funktion).join(' ').toLowerCase();
      return (hay+' '+ctxt).includes(q);
    });
  }
  // Status-Filter (bessere Übersicht)
  const sf=window._crmStatusFilter||'';
  if(sf) items=items.filter(e=>(e.status||'')===sf);
  const countBy=k=>listEntities(window._crmTree).filter(e=>(e.status||'')===k).length;
  const filterBar=`<div class="crm-statusfilter">
      <label class="crm-sf-label">Status</label>
      <select class="crm-sf-select" onchange="crmSetStatusFilter(this.value)">
        <option value="">Alle (${listEntities(window._crmTree).length})</option>
        ${CRM_STATUS.map(s=>{ const n=countBy(s.key); return `<option value="${s.key}"${sf===s.key?' selected':''}>${esc(s.label)}${n?` (${n})`:''}</option>`; }).join('')}
      </select>
    </div>`;
  const cards = items.map(e=>{
    const s=e.stamm||{};
    const openTodos=entityOpenTaskCount(e);
    const kCount=(e.kontakte||[]).length;
    const sub=[s.sitz,s.adresse].filter(Boolean).join(' · ');
    return `<div class="crm-card" onclick="crmOpenDetail('${e.id}')">
      <h3>${esc(s.name||'(ohne Name)')}</h3>
      ${sub?`<div class="sub">${esc(sub)}</div>`:''}
      <div class="meta">
        ${crmStatusBadge(e.status)}
        <span class="crm-chip">👤 ${kCount} Kontakt${kCount===1?'':'e'}</span>
        ${openTodos?`<span class="crm-chip warn">✓ ${openTodos} Aufgabe${openTodos===1?'':'n'}</span>`:''}
      </div>
    </div>`;
  }).join('');
  root.innerHTML = barHtml() + `<div class="crm-body">
    ${crmCanView()?filterBar:''}
    ${ items.length ? `<div class="crm-list">${cards}</div>`
                 : `<div class="crm-empty">${sf?'Keine Einträge mit diesem Status.':`Noch keine ${esc(tree.label)}.`}<br><br>${sf?`<button class="btn-sm-crm" onclick="crmSetStatusFilter('')">Filter zurücksetzen</button>`:`<button class="btn-sm-crm primary" onclick="crmOpenNew()">＋ ${esc(tree.single)} anlegen</button>`}</div>`
  }</div>`;
}
function crmSetStatusFilter(v){ window._crmStatusFilter=v; paintList(); }

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
  // Einzel-Team (Alt) → Team-Array (mehrere Teams je Aufgabe)
  if(!Array.isArray(n.teams)) n.teams = (n.team!=null && n.team!=='') ? [n.team] : [];
  if(!Array.isArray(n.attachments)) n.attachments=[];
  n.children.forEach(normNode);
}
function normTasks(c){ if(c && Array.isArray(c.todos)) c.todos.forEach(normNode); return c; }

// ── Mehrere parallele Projekte je Eintrag ──────────────────────────
// Ein Eintrag (Verein etc.) kann mehrere Projekte gleichzeitig haben.
// Jedes Projekt ist ein eigener Aufgaben-Container { id, name, todos[], closed, … }.
// Lazy-Migration: alte Einträge (e.todos / e.boardTitle) werden beim ersten
// Lesen in genau ein Projekt überführt – persistiert erst beim nächsten Speichern.
function migEntityProjekte(e){
  if(!e) return e;
  if(!Array.isArray(e.projekte)){
    const legacy = Array.isArray(e.todos) ? e.todos : [];
    // WICHTIG: deterministische id (aus der Eintrags-id) – sonst bekäme das
    // Projekt bei jedem Re-Render/Sync eine neue id und ctx.pid liefe ins Leere
    // (z. B. „Abschließen" ohne Wirkung), solange noch nichts gespeichert wurde.
    e.projekte = (legacy.length || e.boardTitle) ? [{
      id:'pl-'+e.id, name:e.boardTitle||'Projekt', todos:legacy,
      closed:!!e.boardClosed, closedAt:e.boardClosedAt||null, closedByKuerzel:e.boardClosedByKuerzel||'',
      createdAt:e.createdAt||Date.now()
    }] : [];
  }
  // Alt-Felder NIE behalten, sobald das Projekt-Modell gilt. Sonst „aufersteht"
  // ein gelöschtes/letztes Projekt wieder: Firebase verwirft das leere projekte:[],
  // und aus dem noch vorhandenen e.todos würde erneut migriert. (in-memory; beim
  // nächsten Speichern dauerhaft entfernt.)
  if('todos' in e) delete e.todos;
  if('boardTitle' in e) delete e.boardTitle;
  if('boardClosed' in e) delete e.boardClosed;
  if('boardClosedAt' in e) delete e.boardClosedAt;
  if('boardClosedByKuerzel' in e) delete e.boardClosedByKuerzel;
  e.projekte.forEach(p=>{ if(!Array.isArray(p.todos)) p.todos=[]; p.todos.forEach(normNode); });
  recoverV187EntityItems(e);
  return e;
}
// ── Sicherheits-Rückführung nach v187 ──────────────────────────────
// v187 hatte kurzzeitig ein flaches Modell `e.items` / `v.items`. Falls in
// diesem Fenster etwas NEU angelegt wurde (id noch nicht im Board), holen wir
// es verlustfrei zurück ins Board bzw. in die Termine. Idempotent (nutzt die
// Item-id als Knoten-id + eine stabile „Wiederhergestellt"-Spalte); die Quelle
// `.items` bleibt als Sicherung erhalten.
function _v187ItemToNode(it){
  const children=(it.checklist||[]).map(c=>({ id:c.id||newId(), text:c.text||'', status:c.done?'erledigt':'offen', children:[] }));
  return { id:it.id||newId(), text:it.text||'', status:it.done?'erledigt':'offen',
    due:it.frist||'', assigneeId:it.assigneeId||'', assigneeName:it.assigneeName||'', note:it.note||'', children };
}
function _recoverInto(todosOwner, colOwnerId, items, boardIds){
  const tasks=(items||[]).filter(it=>(it.kind==='aufgabe'||!it.kind) && !boardIds.has(it.id)).map(_v187ItemToNode);
  if(!tasks.length) return false;
  if(!Array.isArray(todosOwner.todos)) todosOwner.todos=[];
  let col=todosOwner.todos.find(t=>t.id==='recov-'+colOwnerId);
  if(!col){ col={ id:'recov-'+colOwnerId, text:'Wiederhergestellt', status:'offen', children:[] }; todosOwner.todos.push(col); }
  if(!Array.isArray(col.children)) col.children=[];
  const have=new Set(col.children.map(c=>c.id));
  tasks.forEach(n=>{ if(!have.has(n.id)) col.children.push(n); });
  return true;
}
function recoverV187EntityItems(e){
  if(!e || !Array.isArray(e.items) || !e.items.length) return;
  const boardIds=new Set(); (e.projekte||[]).forEach(p=>flatNodes(p.todos||[]).forEach(n=>boardIds.add(n.id)));
  // Aufgaben zurück ins Board (erstes offenes Projekt, sonst neues Projekt „Aufgaben")
  if(!Array.isArray(e.projekte)) e.projekte=[];
  let p=e.projekte.find(x=>!x.closed)||e.projekte[0];
  if(!p && e.items.some(it=>(it.kind==='aufgabe'||!it.kind)&&!boardIds.has(it.id))){ p={ id:'pl-'+e.id, name:'Aufgaben', todos:[], closed:false, createdAt:Date.now() }; e.projekte.push(p); }
  if(p) _recoverInto(p, e.id, e.items, boardIds);
  // Termine zurück in e.termine
  const terminIds=new Set((e.termine||[]).map(t=>t.id));
  const newTerm=e.items.filter(it=>it.kind==='termin' && !terminIds.has(it.id))
    .map(it=>({ id:it.id||newId(), titel:it.text||'', datum:it.date||'', bis:it.ende||'', ort:it.ort||'', note:it.note||'' }));
  if(newTerm.length){ if(!Array.isArray(e.termine)) e.termine=[]; e.termine.push(...newTerm); }
}
function recoverV187VaItems(v){
  if(!v || !Array.isArray(v.items) || !v.items.length) return;
  const boardIds=new Set(); flatNodes(v.todos||[]).forEach(n=>boardIds.add(n.id));
  _recoverInto(v, v.id, v.items, boardIds);
}
// Projekt eines Eintrags finden, das einen bestimmten Aufgaben-Knoten enthält
function _projForNode(e, nodeId){
  if(!e || !Array.isArray(e.projekte)) return null;
  for(const p of e.projekte){ if(findNodeIn(p.todos||[], nodeId)) return p; }
  return null;
}
// Offene Aufgaben über alle (offenen) Projekte eines Eintrags zählen
function entityOpenTaskCount(e){
  migEntityProjekte(e);
  let n=0;
  e.projekte.forEach(p=>{ if(p.closed) return; flatNodes(p.todos).forEach(t=>{ if(t.status!=='erledigt') n++; }); });
  return n;
}

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
// Effektive Teams eines Knotens = Teams des obersten Vorfahren (Array)
function effectiveTeams(c, id){
  let found=[];
  const walk=(n, depth, inherited)=>{ const t = depth===0 ? (n.teams||[]) : inherited; if(n.id===id) found=t; (n.children||[]).forEach(ch=>walk(ch, depth+1, t)); };
  (c.todos||[]).forEach(n=>walk(n,0,[]));
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
  if(depth===0 && n.teams && n.teams.length) parts.push('👥 '+n.teams.join(', '));
  if(n.assigneeName) parts.push('👤 '+n.assigneeName);
  if(n.due) parts.push('📅 '+fmtDate(Date.parse(n.due)));
  const meta=parts.map(esc).join(' · ');
  const kids=n.children||[];
  const prog=kids.length?`<span class="crm-prog">✓ ${kids.filter(k=>k.status==='erledigt').length}/${kids.length}</span>`:'';
  const children=kids.map(ch=>taskNodeHtml(c,ch,depth+1)).join('');
  return `<div class="crm-tnode${depth===0?' top':''}${done?' done':''}">
    <div class="crm-task${blk?' blocked':''}">
      <input type="checkbox" class="crm-check" ${done?'checked':''} ${(blk&&!done)?'disabled':''} title="Erledigt" onchange="crmToggleDone('${n.id}')">
      <span class="crm-tstatus" style="background:${st.color}">${esc(st.label)}</span>
      <div class="grow"><span class="tx">${esc(n.text)}</span>${meta?`<div class="crm-tmeta">${meta}</div>`:''}${n.note?`<div class="crm-tnote">${nl2br(n.note)}</div>`:''}${blk?`<div class="small crm-locked">🔒 wartet auf: ${esc(blk.join(', '))}</div>`:''}</div>
      ${prog}
      <button class="btn-sm-crm" title="Unterpunkt hinzufügen" onclick="crmAddChild('${n.id}')">＋</button>
      <button class="btn-sm-crm" title="Bearbeiten" onclick="crmOpenTask('${n.id}')">✎</button>
      <button class="crm-x" title="Löschen" onclick="crmDeleteNode('${n.id}')">✕</button>
    </div>
    ${kids.length?`<div class="crm-subs">${children}</div>`:''}
  </div>`;
}

// ── Kanban-Board (Teams-Planner-Stil) ──────────────────────────────
// Spalte = Hauptaufgabe · Karte = Unterpunkt · Checkliste = deren Unterpunkte.
function crmSetTaskView(v){ window._crmTaskView=v; repaintContainer(); }
function _hideDone(){ return !!window._crmHideDone; }
function crmToggleHideDone(){ window._crmHideDone=!window._crmHideDone; paint(); }
function kbCardHtml(c, n){
  const st=taskStatusByKey(n.status);
  const kids=n.children||[];
  const done=kids.filter(k=>k.status==='erledigt').length;
  const visKids=_hideDone()?kids.filter(k=>k.status!=='erledigt'):kids;
  const checklist=visKids.map(k=>{
    const kdone=k.status==='erledigt';
    return `<div class="kb-check${kdone?' done':''}" onclick="event.stopPropagation()">
      <input type="checkbox" ${kdone?'checked':''} onchange="crmToggleDone('${k.id}')">
      <span class="kb-check-tx" onclick="crmOpenTask('${k.id}')">${esc(k.text)}</span>
      ${(k.children&&k.children.length)?`<span class="crm-prog">${k.children.filter(x=>x.status==='erledigt').length}/${k.children.length}</span>`:''}
    </div>`;
  }).join('');
  const cdone=n.status==='erledigt';
  return `<div class="kb-card${cdone?' done':''}" draggable="true" ondragstart="crmDragStart(event,'${n.id}')">
    <div class="kb-card-top">
      <input type="checkbox" ${cdone?'checked':''} onclick="event.stopPropagation()" onchange="crmToggleDone('${n.id}')">
      <span class="kb-card-title" onclick="crmOpenTask('${n.id}')">${esc(n.text)}</span>
    </div>
    ${n.note?`<div class="kb-card-note">${linkify(n.note)}</div>`:''}
    ${(n.assigneeName||n.due||kids.length)?`<div class="kb-card-meta">
       <span class="crm-tstatus" style="background:${st.color}">${esc(st.label)}</span>
       ${kids.length?`<span class="crm-prog">✓ ${done}/${kids.length}</span>`:''}
       ${n.assigneeName?`<span class="kb-chip">👤 ${esc(n.assigneeName)}</span>`:''}
       ${n.due?`<span class="kb-chip">📅 ${esc(fmtDate(Date.parse(n.due)))}</span>`:''}
     </div>`:''}
    ${checklist?`<div class="kb-checklist">${checklist}</div>`:''}
    <input class="kb-qadd kb-qadd-step" id="kb-qa-step-${n.id}" placeholder="＋ Schritt (Enter)" onmousedown="event.stopPropagation()" onclick="event.stopPropagation()" onkeydown="crmQaKey(event,'step','${n.id}')">
    ${attachChips(n)}
    <div class="kb-cardbtns">
      <button class="kb-additem" onclick="event.stopPropagation();crmAttOpen('${n.id}')">📎 Anlage${(n.attachments&&n.attachments.length)?' ('+n.attachments.length+')':''}</button>
    </div>
  </div>`;
}
function taskBoardHtml(c){
  const tops=_hideDone()?(c.todos||[]).filter(t=>t.status!=='erledigt'):(c.todos||[]);
  const cols=tops.map(top=>{
    const childs=_hideDone()?(top.children||[]).filter(card=>card.status!=='erledigt'):(top.children||[]);
    const cards=childs.map(card=>kbCardHtml(c,card)).join('');
    return `<div class="kb-col" ondragover="crmDragOver(event)" ondrop="crmDropOnColumn(event,'${top.id}')">
      <div class="kb-col-head">
        <span class="kb-grip" draggable="true" ondragstart="crmColDragStart(event,'${top.id}')" title="Spalte verschieben">⠿</span>
        <span class="kb-col-title" onclick="crmOpenTask('${top.id}')">${esc(top.text)}</span>
        <button class="crm-x" title="Spalte löschen" onclick="crmDeleteNode('${top.id}')">✕</button>
      </div>
      ${(top.teams&&top.teams.length)?`<div class="kb-col-sub">👥 ${esc(top.teams.join(', '))}</div>`:''}
      <div class="kb-cards">${cards}</div>
      <input class="kb-qadd" id="kb-qa-card-${top.id}" placeholder="＋ Aufgabe (Enter)" onkeydown="crmQaKey(event,'card','${top.id}')">
    </div>`;
  }).join('');
  return `<div class="kb-board">${cols}
    <div class="kb-col kb-col-new" ondragover="crmDragOver(event)" ondrop="crmDropOnColumn(event,'__end__')"><input class="kb-qadd kb-qadd-col" id="kb-qa-col" placeholder="＋ Spalte (Enter)" onkeydown="crmQaKey(event,'col','')"></div>
  </div>`;
}
function crmDragStart(ev,id){ window._crmDragId=id; window._crmDragKind='card'; try{ ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain',id); }catch(e){} }
function crmColDragStart(ev,id){ window._crmDragId=id; window._crmDragKind='col'; try{ ev.dataTransfer.effectAllowed='move'; ev.dataTransfer.setData('text/plain',id); }catch(e){} ev.stopPropagation(); }
function crmDragOver(ev){ ev.preventDefault(); try{ ev.dataTransfer.dropEffect='move'; }catch(e){} }
function crmDropOnColumn(ev,topId){
  ev.preventDefault();
  const dragId=window._crmDragId; const kind=window._crmDragKind;
  window._crmDragId=null; window._crmDragKind=null;
  if(!dragId) return;
  if(kind==='col'){
    // Spalten (Hauptaufgaben) umsortieren
    if(dragId===topId) return;
    mutateContainer(c=>{
      const arr=c.todos||[]; const from=arr.findIndex(x=>x.id===dragId); if(from<0) return;
      const [moved]=arr.splice(from,1);
      let to = topId==='__end__' ? arr.length : arr.findIndex(x=>x.id===topId);
      if(to<0) to=arr.length;
      arr.splice(to,0,moved);
    });
  } else {
    // Karte (Unterpunkt) in eine andere Spalte verschieben
    if(dragId===topId || topId==='__end__') return;
    mutateContainer(c=>{
      const f=findNode(c,dragId); if(!f) return;
      if(flatNodes([f.node]).some(x=>x.id===topId)) return; // nicht in eigenen Teilbaum
      const target=findNode(c,topId); if(!target) return;
      const i=f.arr.indexOf(f.node); if(i>=0) f.arr.splice(i,1);
      if(!Array.isArray(target.node.children)) target.node.children=[];
      target.node.children.push(f.node);
    });
  }
  repaintContainer();
}

// ── Detail eines Eintrags ──────────────────────────────────────────
function paintDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const e=curEntity(); if(!e){ window._crmSelId=null; paintList(); return; }
  migEntityProjekte(e);
  // Ausgewähltes Projekt bestimmen (Default: erstes offenes Projekt)
  const _openProj=e.projekte.filter(p=>!p.closed);
  if(!e.projekte.some(p=>p.id===window._crmProjSel)) window._crmProjSel = _openProj.length?_openProj[0].id:'';
  window._crmTaskCtx={ kind:'entity', tree:window._crmTree, eid:e.id, pid:window._crmProjSel };  // Engine zielt aufs ausgewählte Projekt
  window._crmAfterTask='detail';
  const s=e.stamm||{};
  const tree=treeByKey(window._crmTree);
  const canCfg=crmFull()||crmRestricted();     // Feld-Bezeichnung (pro Eintrag) per Doppelklick umbenennen
  const canEditK=crmFull()||crmRestricted();   // Kontakt-Rolle per Doppelklick ändern
  const flbls=e.fieldLabels||{};               // pro-Eintrag umbenannte Feld-Bezeichnungen

  const fields = stammFields(window._crmTree)
    .filter(f=>f.key!=='name')
    .map(f=>{ const v=s[f.key]; if(!v) return ''; const disp=f.type==='date'?esc(fmtDate(Date.parse(v))):linkify(v); const flabel=flbls[f.key]||f.label; const lbl=canCfg?`<label ondblclick="crmQuickRenameField('${f.key}')" title="Doppelklick: Bezeichnung ändern" style="cursor:pointer">${esc(flabel)}</label>`:`<label>${esc(flabel)}</label>`; return `<div class="crm-field">${lbl}<div class="v">${disp}</div></div>`; })
    .filter(Boolean).join('');

  // Kontakte als klickbare Karten (wie im Gartenverein-CRM) → Detail-Ansicht beim Klick.
  const kCards=(e.kontakte||[]).map(k=>`
    <div class="crm-card crm-kontakt" onclick="crmMemberDetail('${k.id}')">
      <h3>👤 ${esc(k.name||'(Kontakt)')}</h3>
      ${k.funktion?`<div class="sub">${esc(k.funktion)}</div>`:''}
      ${(kEmails(k).length||kTels(k).length)?`<div class="meta" onclick="event.stopPropagation()">
        ${kEmails(k).map(em=>`<a href="${mailHref(em)}" class="crm-chip">✉️ ${esc(em)}</a>`).join('')}
        ${kTels(k).map(t=>`<a href="${telHref(t)}" class="crm-chip">📞 ${esc(t)}</a>`).join('')}
      </div>`:''}
    </div>`).join('');
  const kontakte = kCards ? `<div class="crm-list">${kCards}</div>` : `<div class="small" style="color:var(--muted)">Noch keine Kontakte.</div>`;

  const _today=new Date().toISOString().slice(0,10);
  const terminRow=t=>{
    const start=t.datum||''; const end=t.bis||'';
    const dateStr = (end && end!==start) ? `${fmtDate(Date.parse(start))} – ${fmtDate(Date.parse(end))}`
                                         : (start?fmtDate(Date.parse(start)):'');
    return `<div class="crm-row">
      <div class="grow"><span class="name">${esc(t.titel)}</span>
        <div class="small">${[dateStr, t.ort].filter(Boolean).map(esc).join(' · ')}</div>
        ${t.note?`<div class="small">${linkify(t.note)}</div>`:''}
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

  // Übergreifende Veranstaltungen, an denen dieser Eintrag beteiligt ist
  const vaList=veranstaltungenForEntity(window._crmTree, e.id);
  const vaRow=v=>`<div class="crm-row" style="cursor:pointer" onclick="crmOpenVeranstaltung('${v.id}')">
      <div class="grow"><span class="name">${v.online?'💻':'📅'} ${esc(v.titel||'(ohne Titel)')}${v.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</span>
        <div class="small">${vaDateLabel(v)||'—'}${(v.teilnehmer||[]).length>1?` · mit ${(v.teilnehmer||[]).length-1} weiteren`:''}</div></div>
      <span class="btn-sm-crm">öffnen ↗</span>
    </div>`;
  const vaUpc=vaList.filter(v=>!vaIsPast(v)&&!v.closed), vaPast=vaList.filter(v=>vaIsPast(v)||v.closed);
  const vaSection = !crmCanView() ? '' : `<div class="crm-sec">
    <h4><span class="ttl">📅 Veranstaltungen</span></h4>
    ${vaUpc.length?vaUpc.map(vaRow).join(''):`<div class="small" style="color:var(--muted)">Keine anstehenden Veranstaltungen mit diesem Eintrag.</div>`}
    ${vaPast.length?`<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Vergangene / abgeschlossene (${vaPast.length})</summary><div style="margin-top:6px">${vaPast.map(vaRow).join('')}</div></details>`:''}
  </div>`;

  const angebote=(e.angebote||[]).map(a=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(a.titel)}</span>${a.note?`<div class="small">${linkify(a.note)}</div>`:''}</div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteAngebot('${a.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Angebote.</div>`;

  const log=(e.log||[]).slice().sort((a,b)=>b.ts-a.ts).map(l=>`
    <div class="crm-logitem">
      <div class="lh"><span>${esc(l.autor||'')}${l.kuerzel?` <strong>[${esc(l.kuerzel)}]</strong>`:''}</span><span>${fmtDateTime(l.ts)} <button class="crm-x" onclick="crmDeleteNote('${l.id}')">✕</button></span></div>
      <div class="lt">${linkify(l.text||'')}</div>
      ${l.summary?`<div class="ls"><strong>KI-Zusammenfassung:</strong><br>${linkify(l.summary)}</div>`:''}
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Notizen.</div>`;

  // Statistik (nur bei Vereinen)
  const statsSec = (window._crmTree==='vereine') ? statsSecHtml(e) : '';
  // Förderungen (für alle Baum-Typen)
  const foerderungenSec = foerderungenSecHtml(e);

  // Einzelne Sektionen (wie bisher) – werden je nach Unterreiter eingeblendet
  const stammSec = fields?`<div class="crm-sec"><h4><span class="ttl">📋 Stammdaten</span></h4><div class="crm-fields">${fields}</div></div>`:'';
  const aufgabenSec = entityProjekteSectionHtml(e);
  const _kEdit=crmFull()||crmRestricted();
  const kontakteSec = `<div class="crm-sec">
      <h4><span class="ttl">👥 Kontakte / Mitglieder</span><span class="hbtns">${(e.kontakte||[]).some(k=>kEmails(k).length)?`<button class="btn-sm-crm" title="Mail an alle Kontakte (BCC)" onclick="crmMailKontakte()">✉️ Mail an alle</button>`:''}${(e.kontakte||[]).length?`<button class="btn-sm-crm" title="Kontakte als vCard für Outlook exportieren" onclick="crmExportContactsVcf()">📇 Outlook-Export</button>`:''}${_kEdit?`<label class="btn-sm-crm" style="cursor:pointer" title="Kontakte aus Outlook (vCard/CSV) importieren">📥 Outlook-Import<input type="file" accept=".vcf,.csv,text/vcard,text/csv" style="display:none" onchange="crmImportContactsFile(this)"></label>`:''}<button class="btn-sm-crm" onclick="crmAddMember()">＋ Kontakt</button></span></h4>
      ${kontakte}
    </div>`;
  const termineSec = `<div class="crm-sec">
      <h4><span class="ttl">📅 Termine</span></h4>
      ${termine}
    </div>`;
  const angeboteSec = `<div class="crm-sec">
      <h4><span class="ttl">🎯 Angebote</span><button class="btn-sm-crm" onclick="crmAddAngebot()">＋ Angebot</button></h4>
      ${angebote}
    </div>`;
  const statusSec = kontaktnotizenSecHtml(e);
  const kommSec = `<div class="crm-sec">
      <h4><span class="ttl">💬 Interne Kommunikation</span><button class="btn-sm-crm primary" onclick="crmOpenNote()">🎤 Neue Notiz</button></h4>
      ${log}
    </div>`;

  // Unterreiter (wie in den Referenz-Screenshots) – eine Ansicht statt langem Scrollen
  const openTasks=entityOpenTaskCount(e);
  const kCount=(e.kontakte||[]).length;
  const tabs=[['allgemeines','Allgemeines'],['aufgaben','Aufgaben & Termine'+(openTasks?` (${openTasks})`:'')]];
  tabs.push(['kommunikation','Kommunikation']);
  if(window._crmTree==='vereine') tabs.push(['statistik','Statistik']);
  tabs.push(['foerderungen','Förderungen']);
  let dt=window._crmDetailTab; if(!tabs.some(t=>t[0]===dt)) dt='allgemeines';
  const subbar=`<div class="crm-subtabs">${tabs.map(([k,l])=>`<button class="crm-subtab${k===dt?' active':''}" onclick="crmDetailTab('${k}')">${esc(l)}</button>`).join('')}</div>`;
  const canCreate=crmFull()||crmRestricted();
  // EIN Anlege-Knopf mit Auswahl (Aufgabe/Termin/Veranstaltung) – bündelt die Wege,
  // ohne Funktionen zu entfernen (Board + Inline-Anlegen bleiben voll erhalten).
  const neuBtn = canCreate ? `<div class="crm-neu-bar"><div class="crm-neu-wrap">
      <button class="btn-sm-crm primary" onclick="crmNeuToggle(event)">＋ Neu ▾</button>
      <div class="crm-neu-menu" id="crm-neu-menu">
        <button type="button" onclick="crmNeuPick('aufgabe')">✓ Aufgabe</button>
        <button type="button" onclick="crmNeuPick('termin')">📅 Termin</button>
        ${crmFull()?`<button type="button" onclick="crmNeuPick('veranstaltung')">🎪 Veranstaltung</button>`:''}
      </div>
    </div><span class="small" style="color:var(--muted)">Aufgabe, Termin oder Veranstaltung – hier wählen.</span></div>` : '';
  const statusCtrl = `<div class="crm-sec crm-statusrow"><span class="crm-statuslabel">Status</span>${
     canCreate ? `<select class="crm-status-select" onchange="crmSetStatus(this.value)">${crmStatusOpts(e.status||'')}</select>`
               : (crmStatusBadge(e.status)||'<span class="small" style="color:var(--muted)">kein Status</span>') }</div>`;
  const bodyByTab={
    allgemeines: statusCtrl + (stammSec || `<div class="crm-sec"><div class="small" style="color:var(--muted)">Keine Stammdaten hinterlegt. Über „✎ Stammdaten" bearbeiten.</div></div>`) + kontakteSec,
    aufgaben: neuBtn + termineSec + vaSection + angeboteSec + aufgabenSec,
    kommunikation: statusSec + kommSec,
    statistik: statsSec,
    foerderungen: foerderungenSec
  };

  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToList()">← ${crmCanView()?esc(tree.label):'Meine Aufgaben'}</button>
      <h2>${esc(s.name||'(ohne Name)')}</h2>
      ${(crmFull()||crmRestricted())?`<button class="btn-sm-crm" onclick="crmEditStamm()">✎ Stammdaten</button>`:''}
      ${crmFull()?`<button class="btn-sm-crm danger" onclick="crmDeleteEntity()">Löschen</button>`:''}
    </div>
    ${(e.createdAt||e.updatedByKuerzel)?`<div class="small" style="color:var(--muted);margin:-8px 0 12px">${
        e.createdAt?`angelegt ${e.createdByKuerzel?'von '+esc(e.createdByKuerzel)+' ':''}am ${esc(fmtDate(e.createdAt))}`:''
      }${e.updatedByKuerzel?` · zuletzt geändert von ${esc(e.updatedByKuerzel)}${e.updatedAt?' am '+esc(fmtDateTime(e.updatedAt)):''}`:''}</div>`:''}
    ${subbar}
    ${bodyByTab[dt]||''}
  </div>`;
}
function crmDetailTab(t){ window._crmDetailTab=t; paintDetail(); }
function crmSetStatus(v){ mutateEntity(e=>{ e.status=v; }); paintDetail(); }

// ── Einheitliches Anlegen: EIN Knopf, Auswahl per Menü ─────────────
function crmNeuToggle(ev){ if(ev){ ev.stopPropagation(); } const m=document.getElementById('crm-neu-menu'); if(!m) return;
  const show=m.style.display!=='block'; m.style.display=show?'block':'none';
  if(show) setTimeout(()=>document.addEventListener('click', _crmNeuClose), 0);
}
function _crmNeuClose(){ const m=document.getElementById('crm-neu-menu'); if(m) m.style.display='none'; document.removeEventListener('click', _crmNeuClose); }
function crmNeuPick(kind){ _crmNeuClose();
  if(kind==='termin') return crmAddTermin();
  if(kind==='veranstaltung') return crmNewVeranstaltungFor();
  return crmNewAufgabeDialog();
}
// Aufgabe anlegen: volle Felder + Wahl der Spalte (oder neue Spalte). Unteraufgaben/
// Abhängigkeiten ergänzt man danach an der Karte im Board (Funktionen bleiben erhalten).
function crmNewAufgabeDialog(){
  const e=curEntity(); if(!e) return;
  migEntityProjekte(e);
  const openP=e.projekte.filter(p=>!p.closed);
  const proj=openP.find(p=>p.id===window._crmProjSel)||openP[0]||null;
  const cols=proj?(proj.todos||[]):[];
  const colOpts=cols.map(c=>`<option value="${esc(c.id)}">${esc(c.text||'(Spalte)')}</option>`).join('');
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✓ Neue Aufgabe</h3>
    <div class="crm-modal-field"><label>Aufgabe *</label><input id="crm-na-text" placeholder="Was ist zu tun?"></div>
    <div class="crm-modal-field"><label>Spalte / Bereich</label>
      <select id="crm-na-col" onchange="document.getElementById('crm-na-newcol-wrap').style.display=(this.value==='__new__'?'block':'none')">
        ${colOpts}<option value="__new__">＋ Neue Spalte …</option>
      </select>
      <div id="crm-na-newcol-wrap" style="display:${cols.length?'none':'block'};margin-top:6px"><input id="crm-na-newcol" placeholder="Name der neuen Spalte (z. B. Vorbereitung)"></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Zuständig (optional)</label><select id="crm-na-assignee">${assigneeOptsHtml([],'')}</select></div>
      <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Frist bis (optional)</label><input type="date" id="crm-na-due"></div>
    </div>
    <div class="crm-modal-field"><label>Notiz (optional)</label><input id="crm-na-note"></div>
    <div class="small" style="color:var(--muted);margin-bottom:8px">Unteraufgaben &amp; Abhängigkeiten kannst du danach an der Karte im Board ergänzen.</div>
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmSaveNewAufgabe()">Anlegen</button></div>`);
  if(!cols.length){ const sel=document.getElementById('crm-na-col'); if(sel) sel.value='__new__'; }
}
function crmSaveNewAufgabe(){
  const text=(val('crm-na-text')||'').trim(); if(!text){ toast('Bitte eine Aufgabe eingeben.','err'); return; }
  const colSel=val('crm-na-col'); const newColName=(val('crm-na-newcol')||'').trim();
  const assigneeId=val('crm-na-assignee'); const due=val('crm-na-due'); const note=(val('crm-na-note')||'').trim();
  const card={ id:newId(), text, children:[], deps:[], teams:[], attachments:[], status:'offen',
    assigneeId:assigneeId||'', assigneeName:assigneeId?userName(assigneeId):'', due:due||'', note };
  mutateEntity(en=>{
    migEntityProjekte(en);
    let p=en.projekte.find(x=>x.id===window._crmProjSel&&!x.closed) || en.projekte.find(x=>!x.closed);
    if(!p){ p={ id:'pl-'+en.id, name:'Aufgaben', todos:[], closed:false, createdAt:Date.now(), createdByKuerzel:curKuerzel() }; en.projekte.push(p); }
    window._crmProjSel=p.id;
    let col;
    if(colSel==='__new__' || !(p.todos||[]).length){ col={ id:newId(), text:newColName||'Aufgaben', status:'offen', children:[], teams:[], deps:[] }; if(!Array.isArray(p.todos)) p.todos=[]; p.todos.push(col); }
    else { col=p.todos.find(c=>c.id===colSel) || p.todos[0]; }
    if(!Array.isArray(col.children)) col.children=[];
    col.children.push(card);
  });
  crmCloseModal(); window._crmDetailTab='aufgaben'; paintDetail(); toast('Aufgabe angelegt ✓','ok');
}

// ── Globale CRM-Suche (über ALLE Bäume/Einträge/Kontakte/Projekte/Aufgaben) ──
// Wichtig: tippt der Nutzer, wird NUR das Ergebnis-Overlay aktualisiert – die Bar
// (und damit das Suchfeld) wird NICHT neu gezeichnet → Cursor/Fokus bleiben erhalten.
function crmSearchAll(q){
  q=String(q||'').toLowerCase().trim();
  const res={ entries:[], contacts:[], projects:[], tasks:[], events:[] };
  if(!q) return res;
  const hit=(...vals)=>vals.map(x=>String(x==null?'':x).toLowerCase()).join(' ').includes(q);
  getTrees().forEach(tr=>{
    listEntities(tr.key).forEach(e=>{
      const s=e.stamm||{};
      if(hit(...Object.values(s)))   // ALLE Stammfelder durchsuchen (nicht nur Name/Adresse/…)
        res.entries.push({tree:tr.key, eid:e.id, name:s.name||'(ohne Name)', sub:tr.label});
      (e.kontakte||[]).forEach(k=>{ if(hit(k.name,k.funktion,kEmails(k).join(' '),kTels(k).join(' ')))
        res.contacts.push({tree:tr.key, eid:e.id, name:k.name||'(Kontakt)', sub:(s.name||'')+(k.funktion?' · '+k.funktion:'')}); });
      migEntityProjekte(e);
      e.projekte.forEach(p=>{
        if(hit(p.name)) res.projects.push({kind:'entity', tree:tr.key, eid:e.id, pid:p.id, name:p.name||'Projekt', sub:s.name||'', closed:!!p.closed});
        flatNodes(p.todos).forEach(x=>{ if(hit(x.text,x.note))
          res.tasks.push({kind:'entity', tree:tr.key, eid:e.id, pid:p.id, name:x.text||'(Aufgabe)', sub:(s.name||'')+' · '+(p.name||'Projekt')}); });
      });
    });
  });
  listTeamProjekte().forEach(p=>{
    const me=(window.cu&&window.cu.id)||'';
    const sub=p.owner?(p.owner===me?'Mein Projekt':'Eigenes Projekt'):(p.team||'Team-Projekt');
    if(hit(p.name,p.beschreibung)) res.projects.push({kind:'teamprojekt', id:p.id, name:p.name||'Projekt', sub, closed:!!p.closed});
    flatNodes(p.todos).forEach(x=>{ if(hit(x.text,x.note))
      res.tasks.push({kind:'teamprojekt', id:p.id, name:x.text||'(Aufgabe)', sub:p.name||'Projekt'}); });
  });
  listVeranstaltungen().forEach(v=>{
    if(hit(v.titel,v.beschreibung,v.ortOderLink)) res.events.push({id:v.id, name:v.titel||'(Veranstaltung)', sub:vaDateLabel(v)||'Veranstaltung'});
    flatNodes(v.todos).forEach(x=>{ if(hit(x.text,x.note))
      res.tasks.push({kind:'veranstaltung', id:v.id, name:x.text||'(Aufgabe)', sub:v.titel||'Veranstaltung'}); });
  });
  return res;
}
function crmSearchPanelHtml(q){
  const r=crmSearchAll(q);
  const total=r.entries.length+r.contacts.length+r.projects.length+r.tasks.length+r.events.length;
  if(!total) return `<div class="crm-sr-empty">Keine Treffer für „${esc(q)}".</div>`;
  const row=(onclick,icon,name,sub,closed)=>`<div class="crm-sr" onclick="${onclick}"><span class="crm-sr-i">${icon}</span><div class="crm-sr-t"><div class="crm-sr-n">${esc(name)}${closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</div>${sub?`<div class="crm-sr-s">${esc(sub)}</div>`:''}</div></div>`;
  const grp=(title,arr,fn)=> arr.length?`<div class="crm-sr-grp"><div class="crm-sr-h">${title} (${arr.length})</div>${arr.slice(0,20).map(fn).join('')}${arr.length>20?`<div class="crm-sr-more">… ${arr.length-20} weitere – Suche verfeinern</div>`:''}</div>`:'';
  return `<div class="crm-sr-head">${total} Treffer für „${esc(q)}"</div>`
    + grp('📇 Einträge', r.entries, x=>row(`crmGoEntry('${esc(x.tree)}','${esc(x.eid)}')`,'📇',x.name,x.sub))
    + grp('👤 Kontakte', r.contacts, x=>row(`crmGoEntry('${esc(x.tree)}','${esc(x.eid)}')`,'👤',x.name,x.sub))
    + grp('📂 Projekte', r.projects, x=> x.kind==='entity'
        ? row(`crmGoEntityProj('${esc(x.tree)}','${esc(x.eid)}','${esc(x.pid)}')`,'📂',x.name,x.sub,x.closed)
        : row(`crmGoTeamProj('${esc(x.id)}')`,'📂',x.name,x.sub,x.closed))
    + grp('📅 Veranstaltungen', r.events, x=>row(`crmOpenVeranstaltung('${esc(x.id)}')`,'📅',x.name,x.sub))
    + grp('✅ Aufgaben', r.tasks, x=> x.kind==='entity'
        ? row(`crmGoEntityProj('${esc(x.tree)}','${esc(x.eid)}','${esc(x.pid)}')`,'✅',x.name,x.sub)
        : (x.kind==='veranstaltung'
            ? row(`crmOpenVeranstaltung('${esc(x.id)}')`,'✅',x.name,x.sub)
            : row(`crmGoTeamProj('${esc(x.id)}')`,'✅',x.name,x.sub)));
}
function crmSearchInput(v){
  window._crmSearch=v;
  const root=document.getElementById('crm-root'); if(!root) return;
  let panel=document.getElementById('crm-search-panel');
  if(!String(v||'').trim()){ if(panel) panel.remove(); return; }
  if(!panel){ panel=document.createElement('div'); panel.id='crm-search-panel'; panel.className='crm-search-panel'; root.appendChild(panel); }
  const bar=root.querySelector('.crm-bar'); panel.style.top=(bar?bar.offsetHeight:56)+'px';
  panel.innerHTML=crmSearchPanelHtml(v);
}
function crmGoEntry(tree,eid){ window._crmSearch=''; window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; window._crmProjSel=''; paintDetail(); }
function crmGoEntityProj(tree,eid,pid){ window._crmSearch=''; window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; window._crmProjSel=pid; paintDetail(); }
function crmGoTeamProj(id){
  window._crmSearch=''; const p=getTeamProjekt(id); if(!p) return;
  window._crmTeamProjSel=id;
  if(p.owner && p.owner===(window.cu&&window.cu.id)){ window._crmMode='meine'; window._crmProjReturn='meine'; }
  else { window._crmMode='teams'; window._crmTeamSel=p.team||null; window._crmProjReturn='team'; }
  paintTeamProjektDetail();
}

// ── Navigation ─────────────────────────────────────────────────────
function crmSwitchTree(key){ window._crmMode='kontakte'; window._crmTree=key; window._crmSelId=null; window._crmSearch=''; paintList(); }
function crmSearch(v){ window._crmSearch=v; paintList(); }
function crmOpenDetail(id){ window._crmMode='kontakte'; window._crmSelId=id; paintDetail(); }
function crmBackToList(){ window._crmSelId=null; if(crmCanView()) paintList(); else { window._crmMode='meine'; paintMeine(); } }
function crmShowMeine(){ crmShowTeams(); }   /* „Meine Aufgaben" ist in die Teams-Ansicht integriert */
function crmOpenMyVerein(){ window._crmMode='kontakte'; window._crmTree='vereine'; window._crmSelId=accessVerein(); paintDetail(); }
// Restriktiver Nutzer öffnet einen seiner zugeordneten Vereine
function crmRestrictedOpen(vid){ window._crmMode='kontakte'; window._crmTree='vereine'; window._crmSelId=vid; paintDetail(); }

function crmOpenModalShell(){ window._crmModalOpen=true; }
function crmCloseModal(){ window._crmModalOpen=false; closeModal(); }

// ── Neu anlegen / Stammdaten bearbeiten ────────────────────────────
function stammFormHtml(s, flbls){
  flbls=flbls||{};
  return stammFields(window._crmTree).map(f=>{
    const v=esc(s[f.key]||'');
    let inp;
    if(f.key==='tags'){
      // Schlagworte mit Vorschlägen aus bereits vorhandenen Tags (verhindert Wildwuchs)
      inp = `<input id="crm-sf-tags" value="${v}" autocomplete="off" placeholder="Tippen für Vorschläge …" oninput="crmTagSuggest(this)" onfocus="crmTagSuggest(this)" onblur="setTimeout(crmTagHide,180)">
        <div id="crm-tag-suggest" class="crm-tag-suggest"></div>`;
    } else if(f.type==='textarea'){
      inp = `<textarea id="crm-sf-${f.key}" rows="2">${v}</textarea>`;
    } else if(f.type==='date'){
      inp = `<input type="date" id="crm-sf-${f.key}" value="${v}">`;
    } else {
      inp = `<input id="crm-sf-${f.key}" value="${v}">`;
    }
    const flabel=flbls[f.key]||f.label;
    return `<div class="crm-modal-field"${f.key==='tags'?' style="position:relative"':''}><label>${esc(flabel)}${f.required?' *':''}${f.hint?` (${esc(f.hint)})`:''}</label>${inp}</div>`;
  }).join('');
}
// Schlagwort-Vorschläge (Token nach letztem Komma gegen vorhandene Tags)
function crmTagSuggest(inp){
  const box=document.getElementById('crm-tag-suggest'); if(!box) return;
  const parts=String(inp.value||'').split(',');
  const token=(parts[parts.length-1]||'').trim().toLowerCase();
  const used=new Set(parts.slice(0,-1).map(t=>t.trim().toLowerCase()).filter(Boolean));
  let list=allTags().filter(t=>!used.has(t.toLowerCase()));
  if(token) list=list.filter(t=>t.toLowerCase().includes(token));
  list=list.slice(0,10);
  if(!list.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML=list.map(t=>`<button type="button" data-tag="${esc(t)}" onmousedown="event.preventDefault()" onclick="crmTagPick(this.getAttribute('data-tag'))">${esc(t)}</button>`).join('');
  box.style.display='block';
}
function crmTagPick(tag){
  const inp=document.getElementById('crm-sf-tags'); if(!inp) return;
  const parts=String(inp.value||'').split(',');
  parts[parts.length-1]=tag;
  inp.value=parts.map(p=>p.trim()).filter(Boolean).join(', ')+', ';
  crmTagHide(); inp.focus();
}
function crmTagHide(){ const box=document.getElementById('crm-tag-suggest'); if(box) box.style.display='none'; }
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
    ${stammFormHtml(e.stamm||{}, e.fieldLabels||{})}
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
      kontakte:[], termine:[], angebote:[], kontaktnotizen:[], todos:[], log:[] };
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
// Kontakt kann MEHRERE E-Mails/Telefonnummern haben (k.emails[]/k.tels[]).
// Rückwärtskompatibel: alte Einzelfelder k.email/k.tel werden weiter gelesen.
function kEmails(k){ if(k&&Array.isArray(k.emails)) return k.emails.filter(Boolean); const e=k&&k.email; return e?[e]:[]; }
function kTels(k){ if(k&&Array.isArray(k.tels)) return k.tels.filter(Boolean); const t=k&&k.tel; return t?[t]:[]; }
function _mfRow(kind,v){ return `<div class="crm-mf-row"><input class="crm-mf-${kind}" value="${esc(v||'')}" placeholder="${kind==='email'?'name@beispiel.de':'z. B. 0431 123456'}"><button type="button" class="crm-x" title="Entfernen" onclick="crmMfDelRow(this)">✕</button></div>`; }
function crmMfAddRow(kind){ const box=document.getElementById('crm-mf-'+kind+'s'); if(!box) return; box.insertAdjacentHTML('beforeend', _mfRow(kind,'')); const ins=box.querySelectorAll('input'); if(ins.length) ins[ins.length-1].focus(); }
function crmMfDelRow(btn){ const row=btn&&btn.closest('.crm-mf-row'); if(row) row.remove(); }
function memberFormHtml(k){
  const opts=memberFunctions().map(f=>`<option ${k.funktion===f?'selected':''}>${esc(f)}</option>`).join('');
  const lists=listVerteiler();
  const emails=kEmails(k), tels=kTels(k);
  const myMail=String(emails[0]||'').toLowerCase().trim();
  const vBlock = lists.length ? `<div class="crm-modal-field"><label>✉️ Zu Verteiler hinzufügen <span style="font-size:11px;color:var(--muted)">(mehrere möglich)</span></label>
     <div class="vw-vpick">${lists.map(v=>{ const inIt = myMail && _normEmails(v.emails).some(e=>e.toLowerCase()===myMail);
        return `<label><input type="checkbox" class="crm-mf-vt" value="${esc(v.id)}" ${inIt?'checked':''}> ${esc(v.name||'(ohne Name)')}</label>`; }).join('')}</div>
     <div class="small" style="color:var(--muted);margin-top:3px">Wirkt nur mit hinterlegter E-Mail.</div></div>` : '';
  return `
   <div class="crm-modal-field"><label>Name *</label><input id="crm-mf-name" value="${esc(k.name||'')}"></div>
   <div class="crm-modal-field"><label>Funktion im Verein</label><select id="crm-mf-fn"><option value="">– keine –</option>${opts}</select></div>
   <div class="crm-modal-field"><label>E-Mail-Adressen</label>
     <div id="crm-mf-emails">${(emails.length?emails:['']).map(v=>_mfRow('email',v)).join('')}</div>
     <button type="button" class="btn-sm-crm" onclick="crmMfAddRow('email')">＋ E-Mail</button></div>
   <div class="crm-modal-field"><label>Telefonnummern</label>
     <div id="crm-mf-tels">${(tels.length?tels:['']).map(v=>_mfRow('tel',v)).join('')}</div>
     <button type="button" class="btn-sm-crm" onclick="crmMfAddRow('tel')">＋ Telefon</button></div>
   <div class="crm-modal-field"><label>Notiz</label><input id="crm-mf-note" value="${esc(k.note||'')}"></div>
   ${vBlock}`;
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
  const emails=Array.from(document.querySelectorAll('.crm-mf-email')).map(x=>x.value.trim()).filter(Boolean);
  const tels=Array.from(document.querySelectorAll('.crm-mf-tel')).map(x=>x.value.trim()).filter(Boolean);
  const rec={ name, funktion:val('crm-mf-fn'), emails, tels, note:val('crm-mf-note') };
  // Verteiler-Auswahl AUS DEM DOM lesen, BEVOR das Modal geschlossen wird (primäre = erste E-Mail)
  const email=String(emails[0]||'').trim();
  const want=new Set(Array.from(document.querySelectorAll('.crm-mf-vt:checked')).map(x=>x.value));
  const allBoxes=Array.from(document.querySelectorAll('.crm-mf-vt')).map(x=>x.value);
  mutateEntity(e=>{
    if(!Array.isArray(e.kontakte)) e.kontakte=[];
    if(mid){ const k=e.kontakte.find(x=>x.id===mid); if(k){ Object.assign(k,rec); delete k.email; delete k.tel; } }
    else { rec.id=newId(); e.kontakte.push(rec); }
  });
  // Verteiler-Mitgliedschaft setzen (nur mit E-Mail)
  let added=0;
  if(email && /@/.test(email)){
    allBoxes.forEach(vid=>{
      const v=getVerteiler(vid); if(!v) return;
      const cur=_normEmails(v.emails); const has=cur.some(e=>e.toLowerCase()===email.toLowerCase());
      if(want.has(vid) && !has){ v.emails=_normEmails([...cur, email]); saveVerteiler(v); added++; }
      else if(!want.has(vid) && has){ v.emails=cur.filter(e=>e.toLowerCase()!==email.toLowerCase()); saveVerteiler(v); }
    });
  }
  crmCloseModal(); paintDetail();
  toast(added?`Kontakt gespeichert · zu ${added} Verteiler${added===1?'':'n'} hinzugefügt ✓`:'Kontakt gespeichert ✓','ok');
}
function crmDeleteMember(mid){
  mutateEntity(e=>{ e.kontakte=(e.kontakte||[]).filter(x=>x.id!==mid); });
  paintDetail();
}
function crmDeleteMemberConfirm(mid){
  const e=curEntity(); if(!e) return;
  const k=(e.kontakte||[]).find(x=>x.id===mid); if(!k) return;
  if(!confirm('Kontakt „'+(k.name||'')+'" wirklich entfernen?')) return;
  crmCloseModal();
  crmDeleteMember(mid);
}
// Detail-Ansicht eines Kontakts (wie im Gartenverein): Anzeige + Bearbeiten/Löschen.
function crmMemberDetail(mid){
  const e=curEntity(); if(!e) return;
  const k=(e.kontakte||[]).find(x=>x.id===mid); if(!k) return;
  const canEdit=crmFull()||crmRestricted();
  const det=(label,inner)=>inner?`<div class="crm-field" style="margin-bottom:10px"><label>${esc(label)}</label><div class="v">${inner}</div></div>`:'';
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 12px">👤 ${esc(k.name||'(Kontakt)')}</h3>
    ${det('Rolle / Funktion', k.funktion?esc(k.funktion):'')}
    ${det('E-Mail', kEmails(k).map(em=>`<a href="${mailHref(em)}">${esc(em)}</a>`).join('<br>'))}
    ${det('Telefon', kTels(k).map(t=>`<a href="${telHref(t)}">${esc(t)}</a>`).join('<br>'))}
    ${det('Notiz', k.note?`<span style="white-space:pre-line">${linkify(k.note)}</span>`:'')}
    <div class="crm-modal-actions" style="margin-top:16px">
      ${canEdit?`<button class="btn-sm-crm danger" style="margin-right:auto" onclick="crmDeleteMemberConfirm('${k.id}')">🗑 Löschen</button>`:''}
      <button class="btn-sm-crm" onclick="crmCloseModal()">Schließen</button>
      ${canEdit?`<button class="btn-sm-crm primary" onclick="crmEditMember('${k.id}')">✎ Bearbeiten</button>`:''}
    </div>`);
}

// ── Outlook-Austausch der Kontakte (vCard / CSV) ────────────────────
function _vcEsc(s){ return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function crmContactsToVCard(list){
  return (list||[]).map(k=>{
    const nm=String(k.name||'').trim(); const sp=nm.lastIndexOf(' ');
    const last=sp>0?nm.slice(sp+1):nm, first=sp>0?nm.slice(0,sp):'';
    const L=['BEGIN:VCARD','VERSION:3.0','FN:'+_vcEsc(k.name||''),'N:'+_vcEsc(last)+';'+_vcEsc(first)+';;;'];
    if(k.funktion) L.push('TITLE:'+_vcEsc(k.funktion));
    kEmails(k).forEach(em=>L.push('EMAIL;TYPE=INTERNET:'+_vcEsc(em)));
    kTels(k).forEach(t=>L.push('TEL;TYPE=CELL:'+_vcEsc(t)));
    if(k.note) L.push('NOTE:'+_vcEsc(k.note));
    L.push('END:VCARD');
    return L.join('\r\n');
  }).join('\r\n');
}
function crmExportContactsVcf(){
  const e=curEntity(); if(!e) return;
  const list=e.kontakte||[]; if(!list.length){ toast('Keine Kontakte zum Exportieren.','err'); return; }
  const vcf=crmContactsToVCard(list);
  const nm=((e.stamm&&e.stamm.name)||'Kontakte').replace(/[^\wäöüÄÖÜß\-]+/g,'_');
  const blob=new Blob([vcf],{type:'text/vcard;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Kontakte_'+nm+'.vcf';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  toast(list.length+' Kontakt'+(list.length!==1?'e':'')+' als vCard exportiert ✓','ok');
}
function _parseVCard(txt){
  const raw=String(txt).replace(/\r\n/g,'\n').replace(/\n[ \t]/g,''); // Zeilenfaltung auflösen
  const out=[]; let cur=null;
  raw.split('\n').forEach(line=>{
    const t=line.trim();
    if(/^BEGIN:VCARD/i.test(t)){ cur={}; return; }
    if(/^END:VCARD/i.test(t)){ if(cur) out.push(cur); cur=null; return; }
    if(!cur) return;
    const ci=t.indexOf(':'); if(ci<0) return;
    const prop=t.slice(0,ci).split(';')[0].split('.').pop().toUpperCase();
    const val=t.slice(ci+1).replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').trim();
    if(prop==='FN'&&!cur.name) cur.name=val;
    else if(prop==='N'&&!cur.name){ const p=val.split(';'); const nm=((p[1]||'')+' '+(p[0]||'')).trim(); if(nm) cur.name=nm; }
    else if(prop==='TITLE'&&!cur.funktion) cur.funktion=val;
    else if(prop==='EMAIL'&&!cur.email) cur.email=val;
    else if(prop==='TEL'&&!cur.tel) cur.tel=val;
    else if(prop==='NOTE'&&!cur.note) cur.note=val;
  });
  return out.filter(c=>c.name||c.email);
}
function _csvRows(txt){
  txt=String(txt).replace(/^﻿/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const first=(txt.split('\n')[0]||''); const delim=(first.split(';').length>first.split(',').length)?';':',';
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<txt.length;i++){ const ch=txt[i];
    if(q){ if(ch==='"'){ if(txt[i+1]==='"'){ cell+='"'; i++; } else q=false; } else cell+=ch; }
    else { if(ch==='"') q=true; else if(ch===delim){ row.push(cell); cell=''; } else if(ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; } else cell+=ch; } }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c||'').trim()!==''));
}
function _parseContactsCsv(txt){
  const rows=_csvRows(txt); if(rows.length<2) return [];
  const head=rows[0].map(h=>String(h||'').trim().toLowerCase());
  const find=(...cands)=>{ for(const c of cands){ const i=head.indexOf(c); if(i>=0) return i; } for(const c of cands){ const i=head.findIndex(h=>h.includes(c)); if(i>=0) return i; } return -1; };
  const iFirst=find('vorname','first name','given name'), iLast=find('nachname','last name','surname');
  const iName=find('anzeigename','display name','vollständiger name'), iMail=find('e-mail-adresse','email address','e-mail','email');
  const iTel=find('mobiltelefon','telefon (geschäftlich)','telefon (privat)','mobile phone','business phone','telefon','phone');
  const iRole=find('position','beruf','job title','funktion','rolle','title'), iNote=find('notizen','notes','bemerkung','note');
  const out=[];
  for(let r=1;r<rows.length;r++){ const row=rows[r]; const g=i=>i>=0?String(row[i]||'').trim():'';
    let name=g(iName); if(!name) name=((g(iFirst))+' '+(g(iLast))).trim();
    const email=g(iMail); if(!name&&!email) continue;
    out.push({name:name||email, funktion:g(iRole), email, tel:g(iTel), note:g(iNote)});
  }
  return out;
}
function crmImportContactsFile(inp){
  const file=inp&&inp.files&&inp.files[0]; if(!file) return;
  if(!(crmFull()||crmRestricted())){ toast('Keine Berechtigung.','err'); inp.value=''; return; }
  if(!curEntity()){ inp.value=''; return; }
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const txt=String(ev.target.result||'');
      const isVcf=/BEGIN:VCARD/i.test(txt)||/\.vcf$/i.test(file.name);
      const parsed=isVcf?_parseVCard(txt):_parseContactsCsv(txt);
      if(!parsed.length){ toast('Keine Kontakte in der Datei gefunden.','err'); inp.value=''; return; }
      let added=0;
      mutateEntity(ent=>{
        if(!Array.isArray(ent.kontakte)) ent.kontakte=[];
        const seen=new Set(ent.kontakte.flatMap(k=>kEmails(k)).map(e=>String(e).toLowerCase()).filter(Boolean));
        parsed.forEach(c=>{
          const mail=String(c.email||'').toLowerCase();
          if(mail&&seen.has(mail)) return; // Dublette per E-Mail überspringen
          ent.kontakte.push({ id:newId(), name:c.name||'', funktion:c.funktion||'', emails:c.email?[c.email]:[], tels:c.tel?[c.tel]:[], note:c.note||'' });
          if(mail) seen.add(mail); added++;
        });
      });
      paintDetail();
      toast(added?(added+' Kontakt'+(added!==1?'e':'')+' importiert ✓'):'Keine neuen Kontakte (bereits vorhanden).', added?'ok':'');
    }catch(err){ toast('Import fehlgeschlagen: '+((err&&err.message)||''),'err'); }
    inp.value='';
  };
  reader.readAsText(file,'utf-8');
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

// ── Kontaktnotizen (früher „Status quo") mit echter History ────────
// Jede Notiz wird gespeichert (nicht überschrieben): {id,ts,text,byKuerzel,byName}.
// Neueste immer oben; ältere in einer aufklappbaren History.
function migKontaktnotizen(e){
  if(!e) return e;
  if(!Array.isArray(e.kontaktnotizen)) e.kontaktnotizen=[];
  if(!e._knMig){
    if(e.statusQuo && String(e.statusQuo).trim()){
      e.kontaktnotizen.push({ id:newId(), ts:e.updatedAt||e.createdAt||Date.now(), text:String(e.statusQuo),
        byKuerzel:e.updatedByKuerzel||'', byName:e.updatedByName||'' });
    }
    e._knMig=true;
  }
  return e;
}
function _knMeta(n){ return `${n.ts?esc(fmtDateTime(n.ts)):''}${n.byKuerzel?' · '+esc(n.byKuerzel):(n.byName?' · '+esc(n.byName):'')}`; }
function kontaktnotizenSecHtml(e){
  migKontaktnotizen(e);
  const canEdit=crmFull()||crmRestricted();
  const notes=(e.kontaktnotizen||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  const noteHtml=n=>`<div class="crm-kn-item">
      <div class="crm-kn-meta">${_knMeta(n)}${canEdit?`<button class="crm-x" title="Notiz löschen" onclick="crmDeleteKontaktnotiz('${n.id}')">✕</button>`:''}</div>
      <div class="crm-kn-text">${linkify(n.text||'')}</div>
    </div>`;
  const latest=notes[0], older=notes.slice(1);
  const input=canEdit?`<textarea class="crm-ta" id="crm-kn-new" rows="3" placeholder="Neue Kontaktnotiz …"></textarea>
      <div class="crm-modal-actions"><button class="btn-sm-crm primary" onclick="crmAddKontaktnotiz()">＋ Notiz speichern</button></div>`:'';
  const latestHtml = latest ? `<div class="crm-kn-latest">${noteHtml(latest)}</div>`
    : `<div class="small" style="color:var(--muted)">Noch keine Kontaktnotizen.</div>`;
  const history = older.length ? `<details class="crm-kn-hist"><summary>🕘 Frühere Kontaktnotizen (${older.length})</summary>${older.map(noteHtml).join('')}</details>` : '';
  return `<div class="crm-sec">
    <h4><span class="ttl">🗒 Kontaktnotizen</span></h4>
    ${input}
    ${latestHtml}
    ${history}
  </div>`;
}
function crmAddKontaktnotiz(){
  const t=(val('crm-kn-new')||'').trim(); if(!t){ toast('Bitte eine Notiz eingeben.','err'); return; }
  mutateEntity(e=>{ migKontaktnotizen(e); e.kontaktnotizen.unshift({ id:newId(), ts:Date.now(), text:t, byKuerzel:curKuerzel(), byName:curName() }); });
  paintDetail(); toast('Kontaktnotiz gespeichert ✓','ok');
}
function crmDeleteKontaktnotiz(id){
  if(!confirm('Diese Kontaktnotiz löschen?')) return;
  mutateEntity(e=>{ migKontaktnotizen(e); e.kontaktnotizen=(e.kontaktnotizen||[]).filter(x=>x.id!==id); });
  paintDetail();
}
// ── Projekte-Bereich eines Eintrags (mehrere parallel + History) ───
function entityProjekteSectionHtml(e){
  migEntityProjekte(e);
  const openP=e.projekte.filter(p=>!p.closed);
  const closedP=e.projekte.filter(p=>p.closed);
  const selPid=window._crmProjSel;
  const sel=e.projekte.find(p=>p.id===selPid)||null;
  const tab=(p)=>{ const open=flatNodes(p.todos).filter(t=>t.status!=='erledigt').length;
    return `<button class="crm-projtab${p.id===selPid?' active':''}" onclick="crmSelProjekt('${p.id}')">${esc(p.name||'Projekt')}${(!p.closed&&open)?` <span class="cnt">${open}</span>`:''}</button>`; };
  const openTabs = openP.length ? `<div class="crm-projtabs">${openP.map(tab).join('')}</div>` : '';
  const board = sel ? entityProjBoardHtml(sel)
    : (openP.length ? '' : `<div class="small" style="color:var(--muted);margin-bottom:8px">Noch keine Aufgaben.${closedP.length?' (Unten gibt es abgeschlossene Projekte.)':''}</div>${(crmFull()||crmRestricted())?`<input class="kb-qadd" id="kb-qa-col" placeholder="Erste Spalte anlegen + Enter – z. B. „Vorbereitung"" onkeydown="crmQaKey(event,'col','')">`:''}`);
  const history = closedP.length ? `<details class="crm-projhist" ${(sel&&sel.closed)?'open':''}>
      <summary>🏁 Abgeschlossene Projekte (${closedP.length})</summary>
      <div class="crm-projtabs" style="margin-top:8px">${closedP.map(tab).join('')}</div>
    </details>` : '';
  return `<div class="crm-sec">
    <h4><span class="ttl">📋 Projekte</span>${crmFull()?`<button class="btn-sm-crm primary" onclick="crmNewEntityProjekt()">＋ Neues Projekt</button>`:''}</h4>
    ${openTabs}
    ${board}
    ${history}
  </div>`;
}
function entityProjBoardHtml(p){
  const closed=!!p.closed;
  return `<div class="crm-projhead">
      ${closed?`<span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>`:''}
      <span class="hbtns" style="margin-left:auto">
        ${crmFull()?`<button class="btn-sm-crm" title="Projekt umbenennen" onclick="crmRenameProjekt('${p.id}')">✎ Umbenennen</button>`:''}
        <button class="btn-sm-crm" onclick="crmToggleHideDone()">${window._crmHideDone?'👁 Erledigte zeigen':'✓ Erledigte ausblenden'}</button>
        ${crmFull()?`<button class="btn-sm-crm" onclick="${closed?'crmReopenBoard':'crmCloseBoard'}()">${closed?'↺ Wieder öffnen':'🏁 Abschließen'}</button>`:''}
        ${crmFull()?`<button class="crm-x" title="Projekt löschen" onclick="crmDeleteProjekt('${p.id}')">✕</button>`:''}
      </span>
    </div>
    ${closed?`<div class="small" style="color:var(--muted);margin:-2px 0 10px">🏁 Abgeschlossen am ${esc(fmtDate(p.closedAt))}${p.closedByKuerzel?' von '+esc(p.closedByKuerzel):''}.</div>`:''}
    ${taskBoardHtml(p)}`;
}
function crmSelProjekt(pid){ window._crmProjSel=pid; paintDetail(); }
function crmNewEntityProjekt(){
  crmOpenModalShell();
  const vs=listVorlagen();
  const vorlageOpts=['<option value="">– ohne Vorlage (leeres Board) –</option>']
    .concat(vs.map(v=>`<option value="${v.id}">${esc(v.name)} (${(v.items||[]).length})</option>`)).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Neues Projekt</h3>
   <div class="crm-modal-field"><label>Projektname *</label><input id="crm-np-name" placeholder="z. B. Wendekurs 2026"></div>
   <div class="crm-modal-field"><label>Vorlage</label><select id="crm-np-vorlage">${vorlageOpts}</select>
     <div class="small" style="color:var(--muted);margin-top:4px">Die Aufgaben der Vorlage werden direkt ins neue Projekt übernommen.</div></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveEntityProjekt()">Anlegen</button></div>`);
}
function crmSaveEntityProjekt(){
  const name=val('crm-np-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const vsel=document.getElementById('crm-np-vorlage'); const vid=vsel?vsel.value:'';
  const e=curEntity(); if(!e) return;
  const id=newId();
  mutateEntity(en=>{ migEntityProjekte(en); en.projekte.push({ id, name, todos:[], closed:false, createdAt:Date.now(), createdByKuerzel:curKuerzel() }); });
  window._crmProjSel=id;
  // Vorlage (optional) direkt ins neue Projekt bauen
  let added=0;
  if(vid){
    window._crmTaskCtx={ kind:'entity', tree:window._crmTree, eid:e.id, pid:id };
    window._crmAfterTask='detail';
    added=_applyVorlageCore(vid);
  }
  crmCloseModal(); paintDetail();
  toast(added?`Projekt mit Vorlage angelegt (${added} Hauptaufgabe${added===1?'':'n'}) ✓`:'Projekt angelegt ✓','ok');
}
function crmRenameProjekt(pid){
  const e=curEntity(); if(!e) return; migEntityProjekte(e);
  const p=e.projekte.find(x=>x.id===pid); if(!p) return;
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">📌 Projektname</h3>
   <div class="crm-modal-field"><label>Name</label><input id="crm-pn" value="${esc(p.name||'')}"></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveProjektName('${pid}')">Speichern</button></div>`);
}
function crmSaveProjektName(pid){
  const v=val('crm-pn'); if(!v){ toast('Bitte einen Namen eingeben.','err'); return; }
  mutateEntity(e=>{ migEntityProjekte(e); const p=e.projekte.find(x=>x.id===pid); if(p) p.name=v; });
  crmCloseModal(); paintDetail();
}
function crmDeleteProjekt(pid){
  const e=curEntity(); if(!e) return; migEntityProjekte(e);
  const p=e.projekte.find(x=>x.id===pid); if(!p) return;
  const cnt=flatNodes(p.todos).length;
  if(!window.confirm(`Projekt „${p.name||'Projekt'}" wirklich löschen?`+(cnt?`\n\n${cnt} Aufgaben gehen dabei verloren.`:''))) return;
  mutateEntity(en=>{ migEntityProjekte(en); en.projekte=en.projekte.filter(x=>x.id!==pid); });
  if(window._crmProjSel===pid) window._crmProjSel='';
  paintDetail(); toast('Projekt gelöscht.','ok');
}
// Ausgewähltes Projekt abschließen / wieder öffnen (Container = das Projekt)
function crmCloseBoard(){
  mutateContainer(p=>{ p.closed=true; p.closedAt=Date.now(); p.closedByKuerzel=curKuerzel(); });
  // Auswahl auf ein anderes offenes Projekt wechseln → das geschlossene wandert in die History
  const e=curEntity(); if(e){ migEntityProjekte(e); const nextOpen=e.projekte.find(p=>!p.closed); window._crmProjSel = nextOpen?nextOpen.id:''; }
  paintDetail(); toast('Projekt abgeschlossen ✓','ok');
}
function crmReopenBoard(){
  mutateContainer(p=>{ p.closed=false; });
  paintDetail(); toast('Projekt wieder geöffnet','ok');
}
// ── Anlagen an einer Aufgabe (Links + OneDrive/SharePoint-Dateien) ──
function _storageOn(){ return !!(window.firebase && firebase.storage); }
// Erkennt Datei-Freigaben (OneDrive/SharePoint/Teams oder Dateiendung) → 📎-Icon
function _looksLikeFile(url){
  return /sharepoint\.com|onedrive|1drv\.ms|office\.com|\.(pdf|docx?|xlsx?|pptx?|csv|txt|jpe?g|png|gif|zip|rar)(\?|#|$)/i.test(String(url||''));
}
function attachChips(n){
  const a=(n&&n.attachments)||[]; if(!a.length) return '';
  return `<div class="kb-atts" onclick="event.stopPropagation()">${a.map(x=>
    `<a class="kb-att" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title||x.name||x.url)}">${x.type==='file'?'📎':'🔗'} ${esc((x.title||x.name||x.url).slice(0,26))}</a>`
  ).join('')}</div>`;
}
function crmAttOpen(nid){
  const c=curContainer(); if(!c) return;
  const f=findNode(c, nid); if(!f) return;
  crmOpenModalShell();
  const a=f.node.attachments||[];
  const rows=a.length ? a.map(x=>`<div class="crm-att-row">
      <a href="${esc(x.url)}" target="_blank" rel="noopener" class="grow" style="color:var(--primary);font-weight:600;text-decoration:none">${x.type==='file'?'📎':'🔗'} ${esc(x.title||x.name||x.url)}</a>
      ${x.size?`<span class="small" style="color:var(--muted)">${Math.round(x.size/1024)} KB</span>`:''}
      <button class="crm-x" title="Entfernen" onclick="crmAttDel('${nid}','${x.id}')">✕</button>
    </div>`).join('') : `<div class="small" style="color:var(--muted);padding:4px 0">Noch keine Anlagen.</div>`;
  openModal(`<h3 style="color:var(--primary);margin:0 0 12px">📎 Anlagen</h3>
   <div style="margin-bottom:6px;font-size:13px;color:var(--muted)">${esc(f.node.text||'')}</div>
   ${rows}
   <div class="crm-att-add">
     <div style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin:14px 0 6px">📎 Datei oder Link anhängen</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap">
       <input id="crm-att-title" placeholder="Bezeichnung (optional)" style="flex:1;min-width:130px">
       <input id="crm-att-url" placeholder="Link einfügen (z. B. OneDrive-Freigabelink)" style="flex:2;min-width:200px">
       <button class="btn-sm-crm primary" onclick="crmAttLink('${nid}')">＋ Anhängen</button>
     </div>
     <div class="small" style="color:var(--muted);margin-top:8px;line-height:1.5">📂 <b>Datei aus OneDrive / Teams anhängen:</b> Datei dort ablegen → <b>Teilen</b> → <b>Link kopieren</b> → oben einfügen. <a href="https://www.office.com/launch/onedrive" target="_blank" rel="noopener" style="color:var(--primary);font-weight:600">OneDrive öffnen ↗</a></div>
   </div>
   <div class="crm-modal-actions"><button class="btn-sm-crm primary" onclick="crmCloseModal();repaintContainer()">Fertig</button></div>`);
}
function crmAttLink(nid){
  const url=val('crm-att-url'); if(!url){ toast('Bitte einen Link einfügen.','err'); return; }
  const u=/^https?:\/\//i.test(url)?url:('https://'+url.replace(/^\/+/,''));
  const title=val('crm-att-title');
  const type=_looksLikeFile(u)?'file':'link';
  mutateContainer(c=>{ const f=findNode(c,nid); if(!f) return; if(!Array.isArray(f.node.attachments)) f.node.attachments=[]; f.node.attachments.push({id:newId(),type,title,url:u}); });
  crmAttOpen(nid); toast(type==='file'?'Datei verknüpft ✓':'Link hinzugefügt ✓','ok');
}
function crmAttFile(nid){
  const fi=document.getElementById('crm-att-file'); const file=fi&&fi.files&&fi.files[0];
  if(!file){ toast('Bitte eine Datei wählen.','err'); return; }
  if(file.size>15*1024*1024){ toast('Datei zu groß (max. 15 MB).','err'); return; }
  if(!_storageOn()){ toast('Firebase Storage ist nicht verfügbar.','err'); return; }
  const safe=file.name.replace(/[^\w.\-]+/g,'_');
  const path='crm-anlagen/'+nid+'/'+Date.now()+'_'+safe;
  toast('Lädt hoch …','');
  try{
    const ref=firebase.storage().ref(path);
    ref.put(file).then(s=>s.ref.getDownloadURL()).then(url=>{
      mutateContainer(c=>{ const f=findNode(c,nid); if(!f) return; if(!Array.isArray(f.node.attachments)) f.node.attachments=[]; f.node.attachments.push({id:newId(),type:'file',name:file.name,url,size:file.size,path}); });
      crmAttOpen(nid); toast('Datei hochgeladen ✓','ok');
    }).catch(e=>{ toast('Upload fehlgeschlagen: '+((e&&e.message)||''),'err'); });
  }catch(e){ toast('Upload-Fehler: '+((e&&e.message)||''),'err'); }
}
function crmAttDel(nid, attId){
  let delPath=null;
  mutateContainer(c=>{ const f=findNode(c,nid); if(!f||!Array.isArray(f.node.attachments)) return; const x=f.node.attachments.find(a=>a.id===attId); if(x&&x.path) delPath=x.path; f.node.attachments=f.node.attachments.filter(a=>a.id!==attId); });
  if(delPath && _storageOn()){ try{ firebase.storage().ref(delPath).delete().catch(()=>{}); }catch(e){} }
  crmAttOpen(nid);
}
// Team-Ansicht: Anlagen mit passendem Container-Kontext öffnen
function crmTeamAtt(tree,eid,id){ _entityNodeCtx(tree,eid,id); crmAttOpen(id); }

// ── Statistik · Inklusion – Entwicklung über die Zeit ──────────────
// Felder: für Inklusion engagierte Mitglieder, Inklusions-Trainer, inklusive TN,
// Trainingsgruppen (nur Zahlen) + mehrzeilige Notiz. „Art" trennt regelmäßiges
// Training von Veranstaltungen. Δ wird ggü. dem vorherigen Eintrag GLEICHER Art
// gebildet → Veränderung übers Jahr sichtbar. Altdaten bleiben erhalten:
// trainer/tn lesen notfalls die alten Schlüssel (trainerInkl/tnInkl); alte
// „Vereinsmitglieder"/„aktiv im Training" werden als „früher erfasst" gezeigt.
const STAT_TYPES=[['training','Regelmäßiges Training'],['veranstaltung','Veranstaltung'],['sonstiges','Sonstiges']];
function statTypLabel(t){ const x=STAT_TYPES.find(z=>z[0]===t); return x?x[1]:''; }
const STAT_METRICS=[
  { key:'engagierte', label:'Engagierte Mitglieder', title:'Vereinsmitglieder, die sich im Verein für Inklusion engagieren' },
  { key:'trainer',    label:'Inklusions-Trainer',    title:'Inklusions-Trainer', legacy:'trainerInkl' },
  { key:'tn',         label:'Inklusive TN',          title:'Inklusive Teilnehmende', legacy:'tnInkl' },
  { key:'gruppen',    label:'Trainingsgruppen',      title:'Anzahl der Trainingsgruppen' },
];
function statNum(s,m){ if(!s) return 0; let v=s[m.key]; if((v==null||v==='')&&m.legacy) v=s[m.legacy]; return Number(v||0); }
function statsSecHtml(e){
  const start=(e.stamm&&e.stamm.statStart)||'';
  let stats=(e.stats||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(start) stats=stats.filter(s=>String(s.date)>=start);
  // vorheriger Eintrag GLEICHER Art (chronologisch) → Δ pro Art
  const prevOf=new Map(), lastByTyp={};
  stats.forEach(s=>{ const t=s.typ||'_'; prevOf.set(s.id, lastByTyp[t]||null); lastByTyp[t]=s; });
  const canEdit=crmFull()||crmRestricted();
  const metricHead=STAT_METRICS.map(m=>`<th title="${esc(m.title||m.label)}">${esc(m.label)}</th>`).join('');
  // nach Jahr gruppieren (neueste zuerst)
  const byYear={}; stats.forEach(s=>{ const y=(String(s.date).match(/^(\d{4})/)||[])[1]||'—'; (byYear[y]=byYear[y]||[]).push(s); });
  const years=Object.keys(byYear).sort().reverse();
  const tnM=STAT_METRICS.find(m=>m.key==='tn');
  const yearBlocks=years.map(y=>{
    // Weitermach-Quote: TN des letzten Trainings ÷ TN der Auftaktveranstaltung (frühestes Event) des Jahres
    const ye=byYear[y];
    const evs=ye.filter(s=>s.typ==='veranstaltung').slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const trs=ye.filter(s=>{const t=s.typ||''; return t===''||t==='training';}).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const auftaktTN=evs.length?statNum(evs[0],tnM):0;
    const trainTN=trs.length?statNum(trs[trs.length-1],tnM):0;
    const quoteBox=(auftaktTN>0&&trs.length)
      ? `<div class="crm-stat-quote">🎯 Weitermach-Quote: Auftaktveranstaltung <b>${auftaktTN}</b> TN → Training <b>${trainTN}</b> TN = <b>${Math.round(trainTN/auftaktTN*100)} %</b></div>` : '';
    const rows=byYear[y].slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(s=>{
      const prev=prevOf.get(s.id);
      const cells=STAT_METRICS.map(m=>{ const cur=statNum(s,m); let d='';
        if(prev){ const dv=cur-statNum(prev,m); if(dv) d=` <span class="crm-delta ${dv>0?'up':'down'}">${dv>0?'▲':'▼'}${Math.abs(dv)}</span>`; }
        return `<td>${cur}${d}</td>`; }).join('');
      const typ=s.typ?`<span class="crm-stat-typ t-${esc(s.typ)}">${esc(statTypLabel(s.typ)||s.typ)}</span>`:'<span class="small" style="color:var(--muted)">—</span>';
      const legacy=[];
      if(s.mitglieder!=null&&s.mitglieder!=='') legacy.push('Vereinsmitglieder: '+Number(s.mitglieder||0));
      if(s.tnAktiv!=null&&s.tnAktiv!=='') legacy.push('aktiv im Training: '+Number(s.tnAktiv||0));
      const noteHtml=[ s.notiz?`<div class="crm-stat-note">${nl2br(esc(s.notiz))}</div>`:'', legacy.length?`<div class="small" style="color:var(--muted)">früher erfasst · ${esc(legacy.join(' · '))}</div>`:'' ].join('');
      return `<tr><td>${esc(fmtDate(Date.parse(s.date)))}</td><td>${typ}</td>${cells}<td class="crm-stat-notecell">${noteHtml||'<span class="small" style="color:var(--muted)">—</span>'}</td>
        <td class="crm-stat-act">${canEdit?`<button class="btn-sm-crm" title="Bearbeiten" onclick="crmEditStat('${s.id}')">✎</button><button class="crm-x" title="Löschen" onclick="crmDeleteStat('${s.id}')">✕</button>`:''}</td></tr>`;
    }).join('');
    return `<div class="crm-stat-year"><div class="crm-stat-yhead">${esc(y)}</div>${quoteBox}
      <div style="overflow-x:auto"><table class="crm-stats"><tr><th>Datum</th><th>Art</th>${metricHead}<th>Notiz</th><th></th></tr>${rows}</table></div></div>`;
  }).join('');
  return `<div class="crm-sec">
    <h4><span class="ttl">📊 Statistik · Inklusion</span>${canEdit?`<button class="btn-sm-crm primary" onclick="crmAddStat()">＋ Erfassung</button>`:''}</h4>
    <div class="small" style="color:var(--muted);margin-bottom:8px">Pro Erfassung Art wählen (Training/Veranstaltung). ▲▼ zeigt die Veränderung zur vorigen Erfassung gleicher Art.</div>
    ${stats.length ? yearBlocks
      : `<div class="small" style="color:var(--muted)">Noch keine Erfassung.${start?` (ab ${esc(fmtDate(Date.parse(start)))})`:''}</div>`}
  </div>`;
}
function crmStatModal(s){
  const e=curEntity(); if(!e) return;
  const isEdit=!!s; s=s||{};
  crmOpenModalShell();
  const def=s.date||(e.stamm&&e.stamm.statStart)||new Date().toISOString().slice(0,10);
  const typOpts=STAT_TYPES.map(([k,l])=>`<option value="${k}"${(s.typ||'training')===k?' selected':''}>${esc(l)}</option>`).join('');
  const f=m=>{ const pre=isEdit?statNum(s,m):0; return `<div class="crm-modal-field" style="flex:1;min-width:150px"><label title="${esc(m.title||m.label)}">${esc(m.label)}</label><input id="crm-stat-${m.key}" type="number" min="0" inputmode="numeric" value="${pre?pre:''}"></div>`; };
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${isEdit?'✎':'＋'} Erfassung</h3>
   <input type="hidden" id="crm-stat-id" value="${isEdit?esc(s.id):''}">
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Datum</label><input id="crm-stat-date" type="date" value="${esc(def)}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:180px"><label>Art</label><select id="crm-stat-typ">${typOpts}</select></div>
   </div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">${f(STAT_METRICS[0])}${f(STAT_METRICS[1])}</div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">${f(STAT_METRICS[2])}${f(STAT_METRICS[3])}</div>
   <div class="crm-modal-field"><label>Notiz</label><textarea id="crm-stat-notiz" rows="3" placeholder="Freitext, mehrzeilig …">${isEdit?esc(s.notiz||''):''}</textarea></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveStat()">Speichern</button></div>`);
}
function crmAddStat(){ crmStatModal(null); }
function crmEditStat(id){ const e=curEntity(); if(!e) return; const s=(e.stats||[]).find(x=>x.id===id); if(s) crmStatModal(s); }
function crmSaveStat(){
  const date=val('crm-stat-date'); if(!date){ toast('Bitte ein Datum wählen.','err'); return; }
  const id=val('crm-stat-id');
  const num=k=>{ const x=document.getElementById('crm-stat-'+k); return x&&x.value!==''?Math.max(0,Number(x.value)||0):0; };
  const rec={ date, typ:val('crm-stat-typ')||'training', engagierte:num('engagierte'), trainer:num('trainer'), tn:num('tn'), gruppen:num('gruppen'), notiz:(val('crm-stat-notiz')||'').trim() };
  mutateEntity(e=>{
    if(!Array.isArray(e.stats)) e.stats=[];
    if(id){ const s=e.stats.find(x=>x.id===id); if(s) Object.assign(s, rec); }   // Altfelder (mitglieder/tnAktiv) bleiben erhalten
    else { rec.id=newId(); e.stats.push(rec); }
  });
  crmCloseModal(); paintDetail(); toast('Erfassung gespeichert ✓','ok');
}
function crmDeleteStat(id){
  if(!confirm('Diese Erfassung löschen?')) return;
  mutateEntity(e=>{ e.stats=(e.stats||[]).filter(x=>x.id!==id); });
  paintDetail();
}

// ── Förderungen (Fördermittel-Tracking je Eintrag) ─────────────────
const FOERDER_STATUS=[
  ['beantragt','Beantragt'],
  ['genehmigt','Genehmigt'],
  ['abgelehnt','Abgelehnt'],
  ['abgeschlossen','Abgeschlossen'],
];
function foerderStatusLabel(s){ const f=FOERDER_STATUS.find(x=>x[0]===s); return f?f[1]:(s||'–'); }
function foerderBadge(s){
  const col={beantragt:['#8a5a00','#fff7e6'],genehmigt:['#1a7f37','#e9f8ee'],abgelehnt:['#b3261e','#fdecea'],abgeschlossen:['#3a4a5c','#eef1f5']}[s]||['#555','#eee'];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${col[0]};background:${col[1]}">${esc(foerderStatusLabel(s))}</span>`;
}
function fmtEuro(n){ n=Number(n||0); return n.toLocaleString('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:2}); }
function foerderungenSecHtml(e){
  const canEdit=crmFull()||crmRestricted();
  const list=(e.foerderungen||[]).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const rows=list.map(f=>`<tr>
      <td>${f.date?esc(fmtDate(Date.parse(f.date))):'–'}</td>
      <td style="text-align:right;white-space:nowrap">${fmtEuro(f.betrag)}</td>
      <td>${esc(f.was||'')}</td>
      <td>${foerderBadge(f.status)}</td>
      <td style="white-space:nowrap">${canEdit?`<button class="crm-x" title="Bearbeiten" onclick="crmEditFoerderung('${f.id}')">✎</button> <button class="crm-x" title="Löschen" onclick="crmDeleteFoerderung('${f.id}')">✕</button>`:''}</td>
    </tr>`).join('');
  const sum=pred=>list.filter(pred).reduce((s,f)=>s+Number(f.betrag||0),0);
  const bewilligt=sum(f=>f.status==='genehmigt'||f.status==='abgeschlossen');
  const beantragt=sum(f=>f.status==='beantragt');
  return `<div class="crm-sec">
    <h4><span class="ttl">💶 Förderungen</span>${canEdit?`<button class="btn-sm-crm primary" onclick="crmAddFoerderung()">＋ Förderung</button>`:''}</h4>
    ${list.length
      ? `<div style="overflow-x:auto"><table class="crm-stats"><tr><th>Wann</th><th style="text-align:right">Fördersumme</th><th>Was</th><th>Status</th><th></th></tr>${rows}</table></div>
         <div class="small" style="color:var(--muted);margin-top:8px">Bewilligt (genehmigt/abgeschlossen): <b>${fmtEuro(bewilligt)}</b> &nbsp;·&nbsp; offen beantragt: <b>${fmtEuro(beantragt)}</b> &nbsp;·&nbsp; ${list.length} Eintrag/Einträge</div>`
      : `<div class="small" style="color:var(--muted)">Noch keine Förderungen erfasst.</div>`}
  </div>`;
}
function crmFoerderModal(f){
  crmOpenModalShell();
  const isEdit=!!f;
  const statusOpts=FOERDER_STATUS.map(([k,l])=>`<option value="${k}"${f&&f.status===k?' selected':''}>${esc(l)}</option>`).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${isEdit?'✎ Förderung bearbeiten':'＋ Förderung'}</h3>
   <input type="hidden" id="crm-foerder-id" value="${isEdit?esc(f.id):''}">
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Wann?</label><input id="crm-foerder-date" type="date" value="${isEdit&&f.date?esc(f.date):new Date().toISOString().slice(0,10)}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Fördersumme (€)</label><input id="crm-foerder-betrag" type="number" min="0" step="0.01" inputmode="decimal" value="${isEdit&&f.betrag!=null?esc(String(f.betrag)):''}"></div>
   </div>
   <div class="crm-modal-field"><label>Was? (Zweck / Programm)</label><input id="crm-foerder-was" type="text" value="${isEdit?esc(f.was||''):''}" placeholder="z. B. Vereinsheim-Sanierung, Landesprogramm …"></div>
   <div class="crm-modal-field"><label>Status</label><select id="crm-foerder-status">${statusOpts}</select></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveFoerderung()">Speichern</button></div>`);
}
function crmAddFoerderung(){ if(!curEntity()) return; crmFoerderModal(null); }
function crmEditFoerderung(id){ const e=curEntity(); if(!e) return; const f=(e.foerderungen||[]).find(x=>x.id===id); if(f) crmFoerderModal(f); }
function crmSaveFoerderung(){
  const date=val('crm-foerder-date');
  const betrag=Math.max(0, Number(document.getElementById('crm-foerder-betrag')?.value)||0);
  const was=(val('crm-foerder-was')||'').trim();
  const status=val('crm-foerder-status')||'beantragt';
  const id=val('crm-foerder-id');
  if(!date&&!was){ toast('Bitte Datum oder Zweck angeben.','err'); return; }
  mutateEntity(e=>{
    if(!Array.isArray(e.foerderungen)) e.foerderungen=[];
    if(id){ const f=e.foerderungen.find(x=>x.id===id); if(f){ f.date=date; f.betrag=betrag; f.was=was; f.status=status; } }
    else { e.foerderungen.push({ id:newId(), date, betrag, was, status }); }
  });
  crmCloseModal(); paintDetail(); toast('Förderung gespeichert ✓','ok');
}
function crmDeleteFoerderung(id){
  if(!confirm('Diese Förderung wirklich löschen?')) return;
  mutateEntity(e=>{ e.foerderungen=(e.foerderungen||[]).filter(x=>x.id!==id); });
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
  const n=o.node||{}; const tp=!isEntityCtx();
  crmOpenModalShell();
  const statusOpts=getTaskStatus().map(s=>`<option value="${s.key}" ${n.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('');
  let teamRow;
  if(o.isTop && !tp){
    const teamBoxes=zeTeams().map(tm=>`<label style="display:inline-flex;align-items:center;gap:5px;font-size:13px;margin:0 14px 5px 0"><input type="checkbox" class="crm-task-team-cb" value="${esc(tm)}" ${(n.teams||[]).includes(tm)?'checked':''} onchange="crmTaskTeamChange()"> ${esc(tm)}</label>`).join('');
    teamRow=`<div class="crm-modal-field"><label>Teams <span style="font-size:11px;color:var(--muted)">(mehrere möglich)</span></label><div id="crm-task-teams" style="padding:4px 0">${teamBoxes||'<span class="small" style="color:var(--muted)">Keine Teams angelegt.</span>'}</div></div>
     <div class="crm-modal-field"><label>Zuständig</label><select id="crm-task-assignee">${assigneeOptsHtml(n.teams||[], n.assigneeId||'')}</select></div>`;
  } else {
    const it = tp ? (e.team?[e.team]:[]) : (o.inheritTeam||[]);
    const itLabel = it.join(', ');
    teamRow=`<div class="crm-modal-field"><label>Zuständig${itLabel?' ('+esc(itLabel)+')':''}</label><select id="crm-task-assignee">${assigneeOptsHtml(it, n.assigneeId||'')}</select></div>`;
  }
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${esc(o.titel)}</h3>
   <div class="crm-modal-field"><label>${o.isTop?'Aufgabe':'Unterpunkt'} *</label><input id="crm-task-text" value="${esc(n.text||'')}"></div>
   ${teamRow}
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Fällig</label><input id="crm-task-due" type="date" value="${esc(n.due||'')}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Status</label><select id="crm-task-status">${statusOpts}</select></div>
   </div>
   <div class="crm-modal-field"><label>Beschreibung / Notiz</label><textarea id="crm-task-note" rows="3" placeholder="Details, Kontext, Notizen …">${esc(n.note||'')}</textarea></div>
   <details class="crm-modal-field"${(n.deps&&n.deps.length)?' open':''}>
     <summary style="cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">🔗 Abhängig von …${(n.deps&&n.deps.length)?` (${n.deps.length})`:''}</summary>
     <div style="font-size:11px;color:var(--muted);margin:6px 0">Diese Aufgabe startet erst, wenn die hier gewählten erledigt sind.</div>
     <div id="crm-task-deps">${depsBoxHtml(e, n.id||null, n.deps)}</div>
   </details>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="${o.saveOnclick}">Speichern</button></div>`);
}
function crmOpenTask(tid){  // tid='' → neue Hauptaufgabe, sonst Bearbeiten
  const e=curContainer(); if(!e) return;
  if(!tid){ nodeModal({ titel:'＋ Hauptaufgabe', node:{}, isTop:true, saveOnclick:"crmSaveTask('')" }); return; }
  const f=findNode(e, tid); if(!f) return;
  const isTop=(f.parent===null);
  nodeModal({ titel:isTop?'✎ Hauptaufgabe':'✎ Unterpunkt', node:f.node, isTop,
    inheritTeam:isTop?[]:effectiveTeams(e, tid), saveOnclick:`crmSaveTask('${tid}')` });
}
function crmAddChild(parentId){
  const e=curContainer(); if(!e) return;
  const f=findNode(e, parentId); if(!f) return;
  nodeModal({ titel:'＋ Unterpunkt zu „'+(f.node.text||'')+'"', node:{}, isTop:false,
    inheritTeam:isEntityCtx()?effectiveTeams(e, parentId):(e.team?[e.team]:[]),
    saveOnclick:`crmSaveChild('${parentId}')` });
}
function crmTaskTeamChange(){
  const teams=Array.from(document.querySelectorAll('.crm-task-team-cb:checked')).map(x=>x.value);
  const sel=document.getElementById('crm-task-assignee');
  if(sel){ const cur=sel.value; sel.innerHTML=assigneeOptsHtml(teams, cur); }
}
function _readNodeForm(e, isTop){
  const text=val('crm-task-text'); if(!text){ toast('Bitte einen Text eingeben.','err'); return null; }
  const assigneeId=val('crm-task-assignee');
  const deps=readChecked('crm-task-deps');
  const status=enforceBlock(e, deps, val('crm-task-status')||'offen');
  const rec={ text, note:val('crm-task-note'), assigneeId, assigneeName: assigneeId?userName(assigneeId):'', due:val('crm-task-due'), status, deps };
  if(isTop && isEntityCtx()) rec.teams=Array.from(document.querySelectorAll('.crm-task-team-cb:checked')).map(x=>x.value);  // mehrere Teams je Top-Aufgabe
  return rec;
}
function crmSaveTask(tid){  // neue Hauptaufgabe (tid='') oder Bearbeiten
  const e=curContainer(); if(!e) return;
  let isTop=true; if(tid){ const f=findNode(e,tid); if(f) isTop=(f.parent===null); }
  const rec=_readNodeForm(e, isTop); if(!rec) return;
  mutateContainer(en=>{
    if(!Array.isArray(en.todos)) en.todos=[];
    if(tid){ const f=findNode(en, tid); if(f){ Object.assign(f.node, rec); if(!Array.isArray(f.node.children)) f.node.children=[]; } }
    else { en.todos.push({ id:newId(), children:[], teams: isEntityCtx()?(rec.teams||[]):[], ...rec }); }
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

// ── Schnellerfassung (Inline, ohne Dialog) ─────────────────────────
// Enter im Inline-Feld legt sofort an; Details später per Klick auf die Karte.
function crmQaKey(ev, kind, parentId){
  if(ev.key!=='Enter') return;
  ev.preventDefault();
  const inp=ev.target; const text=(inp.value||'').trim(); if(!text) return;
  inp.value='';
  if(kind==='col') crmQuickAddColumn(text, inp.id);
  else crmQuickAddChildInline(parentId, text, inp.id);
}
function crmQuickAddColumn(text, focusId){
  // Bei Einträgen: sicherstellen, dass ein offenes Projekt existiert (sonst automatisch anlegen),
  // damit der Nutzer nie erst ein Projekt einrichten muss.
  if(isEntityCtx()){
    const e=curEntity();
    if(e){ migEntityProjekte(e);
      let p=e.projekte.find(x=>x.id===window._crmProjSel && !x.closed) || e.projekte.find(x=>!x.closed);
      let pid = p ? p.id : ('pl-'+e.id);
      if(!p){ mutateEntity(en=>{ migEntityProjekte(en); if(!en.projekte.some(x=>x.id===pid)) en.projekte.push({ id:pid, name:'Aufgaben', todos:[], closed:false, createdAt:Date.now(), createdByKuerzel:curKuerzel() }); }); }
      window._crmProjSel=pid;
      window._crmTaskCtx={ kind:'entity', tree:window._crmTree, eid:e.id, pid };
      window._crmAfterTask='detail';
    }
  }
  mutateContainer(en=>{ if(!Array.isArray(en.todos)) en.todos=[]; en.todos.push({ id:newId(), text, status:'offen', children:[], teams:[] }); });
  window._crmFocusAfter=focusId||'kb-qa-col';
  repaintContainer();
}
function crmQuickAddChildInline(parentId, text, focusId){
  mutateContainer(en=>{ const f=findNode(en, parentId); if(!f) return; if(!Array.isArray(f.node.children)) f.node.children=[]; f.node.children.push({ id:newId(), text, status:'offen', children:[] }); });
  window._crmFocusAfter=focusId;
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
// Kern: baut die Vorlage in den AKTUELLEN Container (ctx) – ohne UI-Nebenwirkungen.
// Liefert die Anzahl Hauptaufgaben (0 = nichts/Fehler).
function _applyVorlageCore(id){
  const v=getVorlage(id); if(!v) return 0;
  normVorlage(v);
  const idMap={};
  flatNodes(v.items).forEach(x=>{ idMap[x.id]=newId(); });
  const build=(n,depth)=>{
    const node={ id:idMap[n.id], text:n.text, note:n.note||'', assigneeId:'', assigneeName:'', due:'', status:'offen',
      deps:(n.deps||[]).map(d=>idMap[d]).filter(Boolean),
      children:(n.children||[]).map(ch=>build(ch,depth+1)) };
    if(depth===0) node.teams = isEntityCtx()?(n.team?[n.team]:[]):[];
    return node;
  };
  const mains=(v.items||[]).map(n=>build(n,0));
  mutateContainer(c=>{ if(!Array.isArray(c.todos)) c.todos=[]; mains.forEach(m=>c.todos.push(m)); if(!isTPCtx() && !c.name) c.name=v.name; });
  return mains.length;
}
function crmApplyVorlage(id){
  const v=getVorlage(id);
  const n=_applyVorlageCore(id);
  crmCloseModal(); repaintContainer();
  if(n||v) toast(`„${v?v.name:''}" übernommen (${n} Hauptaufgabe${n===1?'':'n'}) ✓`,'ok');
}

// ══════════════════════════════════════════════════════════════════
//  TEAM-ANSICHT  – sammelt alle Aufgaben je Team (eintragübergreifend)
// ══════════════════════════════════════════════════════════════════
// Hauptaufgaben eines Teams (eintragübergreifend): [{tree, eid, ename, main}]
function teamMainTasks(team){
  const out=[];
  getTrees().forEach(tr=>{
    listEntities(tr.key).forEach(e=>{
      migEntityProjekte(e);
      e.projekte.forEach(p=>{
        if(p.closed) return;
        (p.todos||[]).forEach(m=>{
          const match = team==='Ohne Team' ? !(m.teams&&m.teams.length) : (m.teams||[]).includes(team);
          if(match) out.push({ tree:tr.key, eid:e.id, ename:(e.stamm&&e.stamm.name)||'(ohne Name)', main:m });
        });
      });
    });
  });
  return out;
}
// Veranstaltungen eines Teams (Ohne Team = ohne team-Zuordnung / übergeordnet)
function teamVeranstaltungen(team){
  return listVeranstaltungen().filter(v=> team==='Ohne Team' ? !v.team : (v.team===team));
}
// Zählung für die Team-Kacheln: Veranstaltungen (gesamt / anstehend)
function teamCounts(team){
  const vs=teamVeranstaltungen(team);
  return { total:vs.length, open:vs.filter(v=>!v.closed && !vaIsPast(v)).length };
}
// Beliebigen Knoten (jede Ebene) in einem Eintrag ändern – sucht über alle Projekte
function updateAnyTask(tree, eid, id, fn){
  const ent=getEntity(tree,eid); if(!ent) return; migEntityProjekte(ent);
  let f=null; for(const p of ent.projekte){ f=findNodeIn(p.todos||[], id); if(f) break; }
  if(!f) return;
  try{ fn(f.node); }catch(e){ console.error('CRM updateAnyTask:',e); return; }
  ent.updatedByKuerzel=curKuerzel(); ent.updatedByName=curName();
  saveEntity(tree, ent);
}
function crmShowTeams(){ window._crmMode='teams'; window._crmTeamSel=null; window._crmTeamProjSel=null; paintTeamsList(); }
function crmOpenTeam(enc){ window._crmTeamSel=decodeURIComponent(enc); window._crmTeamProjSel=null; paintTeamDetail(); }
function crmBackToTeams(){ window._crmTeamSel=null; window._crmTeamProjSel=null; paintTeamsList(); }
function crmOpenEntryFromTeam(tree,eid){ window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; paintDetail(); }
function crmOpenTeamProjekt(id){ window._crmProjReturn='team'; window._crmTeamProjSel=id; paintTeamProjektDetail(); }
function crmBackToTeamProjekte(){
  window._crmTeamProjSel=null;
  if(window._crmProjReturn==='meine'){ window._crmProjReturn=null; window._crmMode='meine'; paintMeine(); }
  else paintTeamDetail();
}

function teamCardHtml(tm, total, open){
  return `<div class="crm-card" onclick="crmOpenTeam('${encodeURIComponent(tm)}')">
    <h3>👥 ${esc(tm)}</h3>
    <div class="meta"><span class="crm-chip">${total} Veranstaltung${total===1?'':'en'}</span>${open?`<span class="crm-chip warn">${open} anstehend</span>`:''}</div>
  </div>`;
}
function paintTeamsList(){
  const root=document.getElementById('crm-root'); if(!root) return;
  window._crmTaskCtx=null;
  // „Meine Aufgaben" oben – für alle
  const meine = meineSectionsHtml();
  // Veranstaltungen: deutlich sichtbarer Button GANZ OBEN in der Teams-Ansicht
  const actions=[];
  if(crmCanView()) actions.push(`<button class="btn-sm-crm primary" onclick="crmShowVeranstaltungen()">📅 Veranstaltungen</button>`);
  const topBar = actions.length ? `<div class="crm-sec" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <span style="font-weight:700;color:var(--primary);font-size:13px;text-transform:uppercase;letter-spacing:.6px">CRM-Bereiche</span>
      ${actions.join('')}
    </div>` : '';
  // Teams-Kacheln für alle, die alles sehen dürfen (voll + erweitert)
  let teamsBlock='';
  if(crmCanView()){
    const cards=[];
    zeTeams().forEach(tm=>{ const c=teamCounts(tm); cards.push(teamCardHtml(tm, c.total, c.open)); });
    const cNo=teamCounts('Ohne Team');
    if(cNo.total) cards.push(teamCardHtml('Ohne Team', cNo.total, cNo.open));
    teamsBlock = `<div class="crm-sec">
      <h4><span class="ttl">👥 Teams</span></h4>
      <div class="crm-list">${cards.join('')}</div>
      <div class="small" style="color:var(--muted);margin-top:10px">Pro Team: Veranstaltungen und eigene Projekte.</div>
    </div>`;
  }
  root.innerHTML = barHtml() + `<div class="crm-body">${topBar}${meine}${teamsBlock}</div>`;
}
function paintTeamDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const team=window._crmTeamSel;
  window._crmTaskCtx=null;
  // Veranstaltungen des Teams
  const vs=teamVeranstaltungen(team);
  const vaCard=v=>`<div class="crm-card" onclick="crmOpenVeranstaltung('${v.id}')">
      <h3>${v.online?'💻':'📅'} ${esc(v.titel||'(ohne Titel)')}${v.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h3>
      <div class="sub">${vaDateLabel(v)||'—'}${v.online?' · Online':''}</div>
      <div class="meta">${(v.teilnehmer||[]).length?`<span class="crm-chip">👥 ${(v.teilnehmer||[]).length} beteiligt</span>`:`<span class="crm-chip">übergeordnet</span>`}</div>
    </div>`;
  const vaUpc=vs.filter(v=>!vaIsPast(v)&&!v.closed), vaPast=vs.filter(v=>vaIsPast(v)||v.closed);
  const vaSec=`<div class="crm-sec">
    <h4><span class="ttl">📅 Veranstaltungen</span>${crmFull()?`<button class="btn-sm-crm primary" onclick="crmNewVeranstaltungForTeam('${esc(team)}')">＋ Veranstaltung</button>`:''}</h4>
    ${vaUpc.length?`<div class="crm-list">${vaUpc.map(vaCard).join('')}</div>`:`<div class="small" style="color:var(--muted)">Keine anstehenden Veranstaltungen für dieses Team.</div>`}
    ${vaPast.length?`<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Vergangene / abgeschlossene (${vaPast.length})</summary><div class="crm-list" style="margin-top:8px">${vaPast.map(vaCard).join('')}</div></details>`:''}
  </div>`;
  // Eigenständige Team-Projekte (persönliche ausschließen)
  const allProj=listTeamProjekte(team==='Ohne Team'?'':team).filter(p=>!p.owner);
  const projCardHtml=p=>{ const all=flatTasks(p); const openN=all.filter(t=>t.status!=='erledigt').length;
    return `<div class="crm-card" onclick="crmOpenTeamProjekt('${p.id}')">
      <h3>📂 ${esc(p.name||'(ohne Name)')}${p.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h3>
      <div class="meta"><span class="crm-chip">${all.length} Aufgabe${all.length===1?'':'n'}</span>${openN?`<span class="crm-chip warn">${openN} offen</span>`:''}</div>
    </div>`; };
  const openP=allProj.filter(p=>!p.closed), closedP=allProj.filter(p=>p.closed);
  const projektSec=`<div class="crm-sec">
    <h4><span class="ttl">📂 Eigene Projekte</span><button class="btn-sm-crm primary" onclick="crmNewTeamProjekt()">＋ Projekt</button></h4>
    ${openP.length?`<div class="crm-list">${openP.map(projCardHtml).join('')}</div>`:`<div class="small" style="color:var(--muted)">Noch keine eigenen Projekte.</div>`}
    ${closedP.length?`<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Abgeschlossen (${closedP.length})</summary><div class="crm-list" style="margin-top:8px">${closedP.map(projCardHtml).join('')}</div></details>`:''}
  </div>`;
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToTeams()">← Teams</button>
      <h2>👥 ${esc(team)}</h2>
    </div>
    ${vaSec}
    ${projektSec}
  </div>`;
}
// Neue Veranstaltung direkt aus einer Team-Ansicht (Team vorbelegt)
function crmNewVeranstaltungForTeam(team){
  window._vaTeiln=[];
  crmOpenModalShell(); openModal(veranstaltungFormHtml({ team:(team==='Ohne Team'?'':team) }, true));
}
function crmTeamSetStatus(tree,eid,id,value){
  const e=getEntity(tree,eid); if(!e) return; migEntityProjekte(e);
  const p=_projForNode(e,id); if(!p) return;
  const x=flatNodes(p.todos).find(t=>t.id===id); if(!x) return;
  const v=enforceBlock(p, x.ref.deps, value);
  updateAnyTask(tree,eid,id, t=>{ t.status=v; });
  paintTeamDetail();
}
function crmTeamSetAssignee(tree,eid,id,value){
  const name=value?userName(value):'';
  updateAnyTask(tree,eid,id, t=>{ t.assigneeId=value; t.assigneeName=name; });
  paintTeamDetail();
}
// Häkchen / Unterpunkt / Bearbeiten aus der Team-Ansicht (zielt auf den Eintrag)
// Kontext für einen Knoten aus der Team-Ansicht: passendes Projekt auflösen
function _entityNodeCtx(tree,eid,id){
  const e=getEntity(tree,eid); let pid='';
  if(e){ migEntityProjekte(e); const p=_projForNode(e,id); if(p) pid=p.id; }
  window._crmTaskCtx={kind:'entity',tree,eid,pid}; window._crmAfterTask='teamdetail';
}
function crmTeamToggleDone(tree,eid,id){ _entityNodeCtx(tree,eid,id); crmToggleDone(id); }
function crmTeamAddChild(tree,eid,id){ _entityNodeCtx(tree,eid,id); crmAddChild(id); }
function crmTeamEditNode(tree,eid,id){ _entityNodeCtx(tree,eid,id); crmOpenTask(id); }

// ── Eigenständige Team-Projekte ────────────────────────────────────
function paintTeamProjektDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const p=getTeamProjekt(window._crmTeamProjSel);
  if(!p){ window._crmTeamProjSel=null; paintTeamDetail(); return; }
  normTasks(p);
  window._crmTaskCtx={ kind:'teamprojekt', id:p.id };  // Aufgaben-Engine zielt aufs Projekt
  window._crmAfterTask='projektdetail';
  const todos = taskBoardHtml(p);
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToTeamProjekte()">← ${window._crmProjReturn==='meine'?'Meine Aufgaben':esc(p.team||'Team')}</button>
      <h2>📂 ${esc(p.name||'(ohne Name)')}${p.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h2>
      <button class="btn-sm-crm" onclick="${p.closed?'crmReopenProjekt':'crmCloseProjekt'}()">${p.closed?'↺ Wieder öffnen':'✓ Abschließen'}</button>
      <button class="btn-sm-crm" onclick="crmEditTeamProjekt()">✎ Bearbeiten</button>
      <button class="btn-sm-crm danger" onclick="crmDeleteTeamProjekt()">Löschen</button>
    </div>
    ${(p.createdAt||p.updatedByKuerzel)?`<div class="small" style="color:var(--muted);margin:-8px 0 14px">${p.createdAt?`angelegt ${p.createdByKuerzel?'von '+esc(p.createdByKuerzel)+' ':''}am ${esc(fmtDate(p.createdAt))}`:''}${p.updatedByKuerzel?` · zuletzt von ${esc(p.updatedByKuerzel)}${p.updatedAt?' am '+esc(fmtDateTime(p.updatedAt)):''}`:''}</div>`:''}
    ${linkedEntityName(p)?`<div style="margin:-6px 0 14px"><button class="btn-sm-crm" onclick="crmOpenLinkedEntity('${esc(p.linkTree)}','${esc(p.linkEid)}')">🔗 ${esc(linkedEntityName(p))}</button></div>`:''}
    ${p.beschreibung?`<div class="crm-sec"><div class="v" style="white-space:pre-line">${nl2br(p.beschreibung)}</div></div>`:''}
    <div class="crm-sec">
      <h4><span class="ttl">✅ Aufgaben</span>
        <span class="hbtns">
          <button class="btn-sm-crm" onclick="crmToggleHideDone()">${window._crmHideDone?'👁 Erledigte zeigen':'✓ Erledigte ausblenden'}</button>
          <button class="btn-sm-crm" onclick="crmApplyVorlagePick()">📋 Vorlage</button>
          <button class="btn-sm-crm primary" onclick="crmOpenTask('')">＋ Spalte</button>
        </span>
      </h4>
      ${todos}
    </div>
  </div>`;
}
// Optionen für die Zuordnung eines Projekts zu einem CRM-Eintrag (alle Bäume)
function entityLinkOptions(selVal){
  const opts=['<option value="">– keinem Eintrag zugeordnet –</option>'];
  getTrees().forEach(tr=>{
    listEntities(tr.key).forEach(e=>{
      const v=tr.key+'::'+e.id;
      opts.push(`<option value="${v}" ${selVal===v?'selected':''}>${esc(tr.icon||'')} ${esc((e.stamm&&e.stamm.name)||'(ohne Name)')}</option>`);
    });
  });
  return opts.join('');
}
function linkedEntityName(p){
  if(!p||!p.linkEid||!p.linkTree) return '';
  const e=getEntity(p.linkTree,p.linkEid);
  return e?((e.stamm&&e.stamm.name)||'(ohne Name)'):'';
}
// "tree::eid" aus einem Select lesen und auf das Projekt anwenden (oder löschen)
function _applyLink(p, raw){
  if(raw && raw.indexOf('::')>0){ const i=raw.indexOf('::'); p.linkTree=raw.slice(0,i); p.linkEid=raw.slice(i+2); }
  else { delete p.linkTree; delete p.linkEid; }
}
function crmOpenLinkedEntity(tree,eid){
  if(!getEntity(tree,eid)){ toast('Verknüpfter Eintrag nicht gefunden.','err'); return; }
  window._crmMode='kontakte'; window._crmTree=tree; window._crmSelId=eid; window._crmTeamProjSel=null; window._crmProjReturn=null;
  paintDetail();
}
function teamProjektFormHtml(p, isNew){
  const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option ${p.team===tm?'selected':''}>${esc(tm)}</option>`)).join('');
  const linkSel=(p.linkTree&&p.linkEid)?p.linkTree+'::'+p.linkEid:'';
  return `<h3 style="color:var(--primary);margin:0 0 14px">${isNew?'＋ Team-Projekt':'✎ Projekt'}</h3>
   <div class="crm-modal-field"><label>Name *</label><input id="crm-tp-name" value="${esc(p.name||'')}"></div>
   <div class="crm-modal-field"><label>Team</label><select id="crm-tp-team">${teamOpts}</select></div>
   <div class="crm-modal-field"><label>Zuordnung <span style="font-size:11px;color:var(--muted)">(Verein / Sozialakteur …)</span></label><select id="crm-tp-link">${entityLinkOptions(linkSel)}</select></div>
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
  const team=val('crm-tp-team'); const beschreibung=val('crm-tp-besch'); const link=val('crm-tp-link');
  if(isNew){
    const id=newId();
    const p={ id, name, team, beschreibung, createdAt:Date.now(),
      createdByKuerzel:curKuerzel(), createdByName:curName(), todos:[] };
    _applyLink(p, link);
    saveTeamProjekt(p);
    window._crmTeamProjSel=id;
    crmCloseModal(); paintTeamProjektDetail(); toast('Projekt angelegt ✓','ok');
  } else {
    const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
    p.name=name; p.team=team; p.beschreibung=beschreibung; _applyLink(p, link);
    p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
    saveTeamProjekt(p);
    crmCloseModal(); paintTeamProjektDetail(); toast('Gespeichert ✓','ok');
  }
}
function crmDeleteTeamProjekt(){
  const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
  if(!confirm(`Projekt „${p.name||''}" wirklich löschen?`)) return;
  const ret=window._crmProjReturn;
  deleteTeamProjekt(p.id); window._crmTeamProjSel=null;
  if(ret==='meine'){ window._crmProjReturn=null; window._crmMode='meine'; paintMeine(); } else paintTeamDetail();
  toast('Gelöscht.','');
}
function crmCloseProjekt(){
  const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
  p.closed=true; p.closedAt=Date.now(); p.closedByKuerzel=curKuerzel();
  p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
  saveTeamProjekt(p); paintTeamProjektDetail(); toast('Projekt abgeschlossen ✓','ok');
}
function crmReopenProjekt(){
  const p=getTeamProjekt(window._crmTeamProjSel); if(!p) return;
  p.closed=false; p.updatedByKuerzel=curKuerzel(); p.updatedByName=curName();
  saveTeamProjekt(p); paintTeamProjektDetail(); toast('Projekt wieder geöffnet ✓','ok');
}

// ══════════════════════════════════════════════════════════════════
//  MEINE AUFGABEN  (für jede angemeldete Person) – zugewiesen + eigene
// ══════════════════════════════════════════════════════════════════
// „Meine Aufgaben" als wiederverwendbarer Baustein (in der Teams-Ansicht eingebettet)
function paintMeine(){ window._crmMode='teams'; window._crmTeamSel=null; paintTeamsList(); }
function meineSectionsHtml(){
  const me=(window.cu&&window.cu.id)||'';
  // 1) Mir zugewiesene Aufgaben (aus Veranstaltungen und Projekten)
  const assigned=[];
  listVeranstaltungen().forEach(v=>{ if(v.closed) return; normTasks(v); flatNodes(v.todos).forEach(x=>{ if(x.ref.assigneeId===me) assigned.push({kind:'veranstaltung',id:v.id,name:v.titel||'(Veranstaltung)',node:x.ref}); }); });
  listTeamProjekte().forEach(p=>{ if(p.closed) return; normTasks(p); flatNodes(p.todos).forEach(x=>{ if(x.ref.assigneeId===me) assigned.push({kind:'teamprojekt',id:p.id,name:p.name||'(Projekt)',node:x.ref}); }); });
  assigned.sort((a,b)=> String(a.node.due||'9999').localeCompare(String(b.node.due||'9999')) );
  const arows = assigned.map(a=>{
    const t=a.node; const st=taskStatusByKey(t.status); const done=t.status==='erledigt';
    const meta=[(a.kind==='veranstaltung'?'📅 ':'📂 ')+a.name, t.due?('📅 '+fmtDate(Date.parse(t.due))):''].filter(Boolean).map(esc).join(' · ');
    const idArg=''; const cArg=a.id;
    return `<div class="crm-task${done?' done':''}">
      <input type="checkbox" class="crm-check" ${done?'checked':''} onchange="crmMeineToggle('${a.kind}','${idArg}','${cArg}','${t.id}')">
      <span class="crm-tstatus" style="background:${st.color}">${esc(st.label)}</span>
      <div class="grow"><span class="tx">${esc(t.text)}</span><div class="crm-tmeta">${meta}</div>${t.note?`<div class="crm-tnote">${nl2br(t.note)}</div>`:''}</div>
      <button class="btn-sm-crm" onclick="crmMeineOpen('${a.kind}','${idArg}','${cArg}','${t.id}')">Öffnen</button>
    </div>`;
  }).join('') || `<div class="small" style="color:var(--muted)">Dir sind aktuell keine Aufgaben zugewiesen.</div>`;
  // 2) Meine eigenen Projekte (offen + abgeschlossen getrennt)
  const myProj=listTeamProjekte().filter(p=>p.owner===me);
  const pcard=p=>{ const all=flatNodes(p.todos); const openN=all.filter(t=>t.status!=='erledigt').length; const ln=linkedEntityName(p);
    return `<div class="crm-card" onclick="crmOpenMeinProjekt('${p.id}')"><h3>📂 ${esc(p.name||'(ohne Name)')}${p.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h3><div class="meta"><span class="crm-chip">${all.length} Aufgabe${all.length===1?'':'n'}</span>${openN?`<span class="crm-chip warn">${openN} offen</span>`:''}${ln?`<span class="crm-chip">🔗 ${esc(ln)}</span>`:''}</div></div>`; };
  const openMine=myProj.filter(p=>!p.closed), closedMine=myProj.filter(p=>p.closed);
  return `<div class="crm-sec">
      <h4><span class="ttl">📌 Mir zugewiesen</span></h4>
      ${arows}
    </div>
    <div class="crm-sec">
      <h4><span class="ttl">📂 Meine Projekte</span><button class="btn-sm-crm primary" onclick="crmNewMeinProjekt()">＋ Projekt</button></h4>
      ${openMine.length?`<div class="crm-list">${openMine.map(pcard).join('')}</div>`:`<div class="small" style="color:var(--muted)">Du hast noch keine eigenen Projekte. Lege eins an und weise Aufgaben zu.</div>`}
      ${closedMine.length?`<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Abgeschlossen (${closedMine.length})</summary><div class="crm-list" style="margin-top:8px">${closedMine.map(pcard).join('')}</div></details>`:''}
    </div>`;
}
function _meSetCtx(kind,tree,id,tid){
  if(kind==='teamprojekt'){ window._crmTaskCtx={kind:'teamprojekt',id}; }
  else if(kind==='veranstaltung'){ window._crmTaskCtx={kind:'veranstaltung',id}; }
  else {
    const e=getEntity(tree,id); let pid='';
    if(e){ migEntityProjekte(e); const p=_projForNode(e,tid); if(p) pid=p.id; }
    window._crmTaskCtx={kind:'entity',tree,eid:id,pid};
  }
  window._crmAfterTask='meine';
}
function crmMeineToggle(kind,tree,id,tid){ _meSetCtx(kind,tree,id,tid); crmToggleDone(tid); }
function crmMeineOpen(kind,tree,id,tid){ _meSetCtx(kind,tree,id,tid); crmOpenTask(tid); }
function crmOpenMeinProjekt(id){ window._crmMode='meine'; window._crmProjReturn='meine'; window._crmTeamProjSel=id; paintTeamProjektDetail(); }
function crmNewMeinProjekt(){
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">＋ Eigenes Projekt</h3>
    <div class="crm-modal-field"><label>Name *</label><input id="crm-mp-name"></div>
    <div class="crm-modal-field"><label>Zuordnung <span style="font-size:11px;color:var(--muted)">(Verein / Sozialakteur …)</span></label><select id="crm-mp-link">${entityLinkOptions('')}</select></div>
    <div class="crm-modal-field"><label>Beschreibung</label><textarea id="crm-mp-besch" rows="3"></textarea></div>
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmSaveMeinProjekt()">Anlegen</button></div>`);
}
function crmSaveMeinProjekt(){
  const name=val('crm-mp-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const id=newId();
  const p={ id, name, team:'', owner:(window.cu&&window.cu.id)||'', beschreibung:val('crm-mp-besch'),
    createdAt:Date.now(), createdByKuerzel:curKuerzel(), createdByName:curName(), todos:[] };
  _applyLink(p, val('crm-mp-link'));
  saveTeamProjekt(p);
  window._crmMode='meine'; window._crmProjReturn='meine'; window._crmTeamProjSel=id;
  crmCloseModal(); paintTeamProjektDetail(); toast('Projekt angelegt ✓','ok');
}

// ══════════════════════════════════════════════════════════════════
//  VERANSTALTUNGEN  (übergreifend; referenzieren 0..n Einträge)
// ══════════════════════════════════════════════════════════════════
function _vaTodayISO(){ return new Date().toISOString().slice(0,10); }
function vaIsPast(v){ const end=v.ende||v.start||''; return end && end < _vaTodayISO(); }
function vaDateLabel(v){
  const s=v.start?fmtDate(Date.parse(v.start)):'';
  const e=(v.ende&&v.ende!==v.start)?(' – '+fmtDate(Date.parse(v.ende))):'';
  return (s+e)+(v.uhrzeit?(' · '+esc(v.uhrzeit)):'');
}
function vaEntityName(t){ const e=getEntity(t.tree,t.eid); return e?((e.stamm&&e.stamm.name)||'(ohne Name)'):'(gelöscht)'; }
function vaTeilnChip(t,i,removable){
  const tr=getTrees().find(x=>x.key===t.tree);
  return `<span class="crm-chip" style="font-size:12px">${esc((tr&&tr.icon)||'')} ${esc(vaEntityName(t))}${removable?` <span style="cursor:pointer;color:#c0392b;font-weight:700" onclick="crmVaRemoveTeiln(${i})">✕</span>`:''}</span>`;
}
function crmShowVeranstaltungen(){ window._crmMode='veranstaltungen'; window._crmVaSel=null; window._crmSearch=''; paint(); }
function paintVeranstaltungen(){
  const root=document.getElementById('crm-root'); if(!root) return;
  window._crmTaskCtx=null;
  const all=listVeranstaltungen();
  const card=v=>{ const op=flatNodes(v.todos).filter(t=>t.status!=='erledigt').length;
    return `<div class="crm-card" onclick="crmOpenVeranstaltung('${v.id}')">
      <h3>${v.online?'💻':'📅'} ${esc(v.titel||'(ohne Titel)')}${v.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h3>
      <div class="sub">${vaDateLabel(v)||'—'}${v.online?' · Online':(v.ortOderLink?' · '+esc(v.ortOderLink):'')}</div>
      <div class="meta">${(v.teilnehmer||[]).length?`<span class="crm-chip">👥 ${(v.teilnehmer||[]).length} beteiligt</span>`:`<span class="crm-chip">übergeordnet</span>`}${op?`<span class="crm-chip warn">${op} offen</span>`:''}</div>
    </div>`; };
  const upcoming=all.filter(v=>!vaIsPast(v)&&!v.closed);
  const past=all.filter(v=>vaIsPast(v)||v.closed);
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-sec">
      <h4><span class="ttl">📅 Veranstaltungen</span>${crmFull()?`<button class="btn-sm-crm primary" onclick="crmNewVeranstaltung()">＋ Veranstaltung</button>`:''}</h4>
      <div class="small" style="color:var(--muted);margin-bottom:10px">Übergreifende Termine & Online-Treffen – mit beliebig vielen beteiligten Einträgen (Vereine, Sozialakteure …) oder ganz ohne (übergeordnet).</div>
      ${upcoming.length?`<div class="crm-list">${upcoming.map(card).join('')}</div>`:`<div class="small" style="color:var(--muted)">Keine anstehenden Veranstaltungen.</div>`}
      ${past.length?`<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--muted);font-size:13px;font-weight:600">Vergangene / abgeschlossene (${past.length})</summary><div class="crm-list" style="margin-top:10px">${past.map(card).join('')}</div></details>`:''}
    </div>
  </div>`;
}
function crmOpenVeranstaltung(id){ window._crmSearch=''; window._crmMode='veranstaltungen'; window._crmVaSel=id; paintVeranstaltungDetail(); }
function paintVeranstaltungDetail(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const v=getVeranstaltung(window._crmVaSel);
  if(!v){ window._crmVaSel=null; paintVeranstaltungen(); return; }
  normTasks(v); recoverV187VaItems(v);
  window._crmTaskCtx={ kind:'veranstaltung', id:v.id }; window._crmAfterTask='veranstaltung';
  const teiln=(v.teilnehmer||[]).map(t=>`<span class="crm-chip" style="cursor:pointer;font-size:12px" onclick="crmGoEntry('${esc(t.tree)}','${esc(t.eid)}')">${esc((getTrees().find(x=>x.key===t.tree)||{}).icon||'')} ${esc(vaEntityName(t))} ↗</span>`).join('') || '<span class="small" style="color:var(--muted)">Übergeordnet – keine beteiligten Einträge.</span>';
  const ortLine = v.online
    ? `💻 Online${v.ortOderLink?' · '+linkify(v.ortOderLink):''}`
    : (v.ortOderLink?('📍 '+esc(v.ortOderLink)):'');
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToVeranstaltungen()">← Veranstaltungen</button>
      <h2>${v.online?'💻':'📅'} ${esc(v.titel||'(ohne Titel)')}${v.closed?' <span class="crm-chip" style="background:var(--accent);color:#fff;border-color:var(--accent)">abgeschlossen</span>':''}</h2>
      ${crmFull()?`<button class="btn-sm-crm" onclick="${v.closed?'crmReopenVeranstaltung':'crmCloseVeranstaltung'}()">${v.closed?'↺ Wieder öffnen':'🏁 Abschließen'}</button>
      <button class="btn-sm-crm" onclick="crmEditVeranstaltung()">✎ Bearbeiten</button>
      <button class="btn-sm-crm danger" onclick="crmDeleteVeranstaltungC()">Löschen</button>`:''}
    </div>
    <div class="crm-sec">
      <div class="crm-fields">
        <div class="crm-field"><label>Wann</label><div class="v">${vaDateLabel(v)||'—'}</div></div>
        ${ortLine?`<div class="crm-field"><label>Wo</label><div class="v">${ortLine}</div></div>`:''}
        ${v.team?`<div class="crm-field"><label>Team</label><div class="v">${esc(v.team)}</div></div>`:''}
      </div>
      <div style="margin-top:12px"><label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:6px">Beteiligte Einträge</label><div style="display:flex;gap:6px;flex-wrap:wrap">${teiln}</div></div>
      ${v.beschreibung?`<div style="margin-top:12px" class="v">${linkify(v.beschreibung)}</div>`:''}
    </div>
    <div class="crm-sec">
      <h4><span class="ttl">✅ Aufgaben</span>
        <span class="hbtns">
          <button class="btn-sm-crm" onclick="crmToggleHideDone()">${window._crmHideDone?'👁 Erledigte zeigen':'✓ Erledigte ausblenden'}</button>
          <button class="btn-sm-crm" onclick="crmApplyVorlagePick()">📋 Vorlage</button>
          <button class="btn-sm-crm primary" onclick="crmOpenTask('')">＋ Spalte</button>
        </span>
      </h4>
      ${taskBoardHtml(v)}
    </div>
  </div>`;
}
function crmBackToVeranstaltungen(){ window._crmVaSel=null; paintVeranstaltungen(); }
// ── Teilnehmer-Auswahl im Formular (window._vaTeiln = Arbeitskopie) ──
function vaTeilnEditHtml(){ return (window._vaTeiln||[]).map((t,i)=>vaTeilnChip(t,i,true)).join('')||'<span class="small" style="color:var(--muted)">Keine – übergeordnete Veranstaltung.</span>'; }
function crmVaAddTeiln(){
  const sel=document.getElementById('crm-va-add'); const raw=sel?sel.value:''; if(sel) sel.value='';
  if(!raw||raw.indexOf('::')<0) return;
  const i=raw.indexOf('::'); const t={tree:raw.slice(0,i), eid:raw.slice(i+2)};
  if(!Array.isArray(window._vaTeiln)) window._vaTeiln=[];
  if(!window._vaTeiln.some(x=>x.tree===t.tree&&x.eid===t.eid)) window._vaTeiln.push(t);
  const box=document.getElementById('crm-va-teiln'); if(box) box.innerHTML=vaTeilnEditHtml();
}
function crmVaRemoveTeiln(idx){ if(Array.isArray(window._vaTeiln)) window._vaTeiln.splice(idx,1); const box=document.getElementById('crm-va-teiln'); if(box) box.innerHTML=vaTeilnEditHtml(); }
function veranstaltungFormHtml(v,isNew){
  const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(tm=>`<option ${v.team===tm?'selected':''}>${esc(tm)}</option>`)).join('');
  return `<h3 style="color:var(--primary);margin:0 0 14px">${isNew?'＋ Veranstaltung':'✎ Veranstaltung'}</h3>
   <div class="crm-modal-field"><label>Titel *</label><input id="crm-va-titel" value="${esc(v.titel||'')}" placeholder="z. B. Netzwerktreffen, Online-Schulung …"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Von *</label><input id="crm-va-start" type="date" value="${esc(v.start||'')}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:140px"><label>Bis (optional)</label><input id="crm-va-ende" type="date" value="${esc(v.ende||'')}"></div>
     <div class="crm-modal-field" style="flex:1;min-width:120px"><label>Uhrzeit</label><input id="crm-va-uhrzeit" value="${esc(v.uhrzeit||'')}" placeholder="14:00–16:00"></div>
   </div>
   <div class="crm-modal-field"><label style="display:inline-flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;color:var(--text)"><input type="checkbox" id="crm-va-online" ${v.online?'checked':''} style="width:auto"> 💻 Online-Treffen</label></div>
   <div class="crm-modal-field"><label>Ort / Link</label><input id="crm-va-ort" value="${esc(v.ortOderLink||'')}" placeholder="Adresse oder Meeting-Link"></div>
   <div class="crm-modal-field"><label>Team</label><select id="crm-va-team">${teamOpts}</select></div>
   <div class="crm-modal-field"><label>Beteiligte Einträge <span style="font-size:11px;color:var(--muted)">(beliebig viele, aus allen Bäumen)</span></label>
     <div id="crm-va-teiln" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${vaTeilnEditHtml()}</div>
     <select id="crm-va-add" onchange="crmVaAddTeiln()">${entityLinkOptions('')}</select>
   </div>
   <div class="crm-modal-field"><label>Beschreibung</label><textarea id="crm-va-besch" rows="3">${esc(v.beschreibung||'')}</textarea></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveVeranstaltung(${isNew?'true':'false'})">${isNew?'Anlegen':'Speichern'}</button></div>`;
}
function crmNewVeranstaltung(){ window._vaTeiln=[]; crmOpenModalShell(); openModal(veranstaltungFormHtml({}, true)); }
function crmEditVeranstaltung(){
  const v=getVeranstaltung(window._crmVaSel); if(!v) return;
  window._vaTeiln=(v.teilnehmer||[]).map(t=>({tree:t.tree,eid:t.eid}));
  crmOpenModalShell(); openModal(veranstaltungFormHtml(v, false));
}
function crmSaveVeranstaltung(isNew){
  const titel=val('crm-va-titel'); if(!titel){ toast('Bitte einen Titel eingeben.','err'); return; }
  const start=val('crm-va-start'); if(!start){ toast('Bitte ein Startdatum wählen.','err'); return; }
  const rec={ titel, start, ende:val('crm-va-ende'), uhrzeit:val('crm-va-uhrzeit'),
    online:!!(document.getElementById('crm-va-online')&&document.getElementById('crm-va-online').checked),
    ortOderLink:val('crm-va-ort'), team:val('crm-va-team'), beschreibung:val('crm-va-besch'),
    teilnehmer:(window._vaTeiln||[]).map(t=>({tree:t.tree,eid:t.eid})) };
  if(isNew){
    const id=newId();
    saveVeranstaltung({ id, ...rec, todos:[], closed:false, createdAt:Date.now(), createdByKuerzel:curKuerzel(), createdByName:curName() });
    window._crmVaSel=id; crmCloseModal(); paintVeranstaltungDetail(); toast('Veranstaltung angelegt ✓','ok');
  } else {
    const v=getVeranstaltung(window._crmVaSel); if(!v) return;
    Object.assign(v, rec); v.updatedByKuerzel=curKuerzel(); v.updatedByName=curName();
    saveVeranstaltung(v); crmCloseModal(); paintVeranstaltungDetail(); toast('Gespeichert ✓','ok');
  }
}
function crmDeleteVeranstaltungC(){
  const v=getVeranstaltung(window._crmVaSel); if(!v) return;
  if(!window.confirm(`Veranstaltung „${v.titel||''}" wirklich löschen?`)) return;
  deleteVeranstaltung(v.id); window._crmVaSel=null; paintVeranstaltungen(); toast('Gelöscht.','');
}
function crmCloseVeranstaltung(){
  const v=getVeranstaltung(window._crmVaSel); if(!v) return;
  v.closed=true; v.closedAt=Date.now(); v.closedByKuerzel=curKuerzel(); v.updatedByKuerzel=curKuerzel();
  saveVeranstaltung(v); paintVeranstaltungDetail(); toast('Veranstaltung abgeschlossen ✓','ok');
}
function crmReopenVeranstaltung(){
  const v=getVeranstaltung(window._crmVaSel); if(!v) return;
  v.closed=false; v.updatedByKuerzel=curKuerzel(); saveVeranstaltung(v); paintVeranstaltungDetail(); toast('Wieder geöffnet ✓','ok');
}
// Veranstaltungen, an denen ein Eintrag beteiligt ist (für den Abschnitt am Eintrag)
function veranstaltungenForEntity(tree,eid){
  return listVeranstaltungen().filter(v=>(v.teilnehmer||[]).some(t=>t.tree===tree&&t.eid===eid));
}
// Neue Veranstaltung direkt vom Eintrag aus – mit diesem Eintrag als Teilnehmer
function crmNewVeranstaltungFor(){
  const e=curEntity(); if(!e) return;
  window._vaTeiln=[{tree:window._crmTree, eid:e.id}];
  crmOpenModalShell(); openModal(veranstaltungFormHtml({}, true));
}

// ══════════════════════════════════════════════════════════════════
//  E-MAIL-VERTEILER  (Adresslisten → Outlook mit BCC öffnen)
// ══════════════════════════════════════════════════════════════════
// Adressen aus beliebigem Text (Zeilen/Komma/Semikolon) säubern + dedupen
function _normEmails(parts){
  const seen=new Set(); const out=[];
  (Array.isArray(parts)?parts:[parts]).forEach(s=>{
    String(s||'').split(/[,;\s]+/).forEach(tok=>{
      const e=tok.trim();
      if(e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){ const k=e.toLowerCase(); if(!seen.has(k)){ seen.add(k); out.push(e); } }
    });
  });
  return out;
}
// Outlook/Standard-Mailprogramm öffnen – feld='bcc' (verdeckt) oder 'to' (sichtbar)
function _openMail(emails, feld){
  const list=_normEmails(emails);
  if(!list.length){ toast('Keine gültigen E-Mail-Adressen.','err'); return; }
  const url='mailto:?'+(feld||'bcc')+'='+encodeURIComponent(list.join(','));
  if(url.length>1900) toast('Sehr viele Adressen – falls Outlook nicht alle übernimmt, nutze „Adressen kopieren".','');
  try{ window.location.href=url; }
  catch(e){ try{ const a=document.createElement('a'); a.href=url; document.body.appendChild(a); a.click(); a.remove(); }catch(_){ toast('Mail konnte nicht geöffnet werden.','err'); } }
}
function _openBcc(emails){ _openMail(emails,'bcc'); }
function _openTo(emails){ _openMail(emails,'to'); }
function _copyEmails(emails){
  const txt=_normEmails(emails).join('; ');
  if(!txt){ toast('Keine Adressen zum Kopieren.','err'); return; }
  const done=()=>toast('Adressen kopiert ✓','ok');
  try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done,()=>_copyFallback(txt,done)); return; } }catch(e){}
  _copyFallback(txt,done);
}
function _copyFallback(txt,done){ try{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }catch(e){ toast('Kopieren nicht möglich.','err'); } }

function crmShowVerteiler(){ window._crmMode='verteiler'; window._crmSelId=null; window._crmTeamSel=null; window._crmTeamProjSel=null; paintVerteiler(); }
function paintVerteiler(){
  const root=document.getElementById('crm-root'); if(!root) return;
  window._crmTaskCtx=null;
  const lists=listVerteiler();
  const cards=lists.map(v=>{
    const n=_normEmails(v.emails).length;
    return `<div class="crm-card">
      <h3>✉️ ${esc(v.name||'(ohne Name)')}</h3>
      <div class="meta"><span class="crm-chip">${n} Adresse${n===1?'':'n'}</span></div>
      <div class="vt-actions">
        <button class="btn-sm-crm primary" onclick="crmVerteilerMail('${v.id}')">✉️ Mail (BCC)</button>
        <button class="btn-sm-crm" onclick="crmCopyVerteiler('${v.id}')">⧉ Kopieren</button>
        ${crmFull()?`<button class="btn-sm-crm" onclick="crmEditVerteiler('${v.id}')">Bearbeiten</button>
        <button class="crm-x" title="Löschen" onclick="crmDeleteVerteilerC('${v.id}')">✕</button>`:''}
      </div>
    </div>`;
  }).join('') || `<div class="small" style="color:var(--muted)">Noch keine Verteiler. Lege einen an und füge Adressen hinzu – manuell oder per Klick aus den Kontakten eines Vereins.</div>`;
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-sec">
      <h4><span class="ttl">✉️ E-Mail-Verteiler</span>${crmFull()?`<button class="btn-sm-crm primary" onclick="crmNewVerteiler()">＋ Verteiler</button>`:''}</h4>
      <div class="small" style="color:var(--muted);margin-bottom:10px">„Mail (BCC)" öffnet Outlook mit allen Adressen im <b>BCC</b>-Feld – die Empfänger sehen einander nicht.</div>
      <div class="crm-list">${cards}</div>
    </div>
  </div>`;
}
function crmNewVerteiler(){ _verteilerModal({}); }
function crmEditVerteiler(id){ const v=getVerteiler(id); if(v) _verteilerModal(v); }
function _verteilerModal(v){
  crmOpenModalShell();
  const vereinOpts=['<option value="">– Kontakte eines Eintrags übernehmen –</option>']
    .concat(getTrees().map(tr=>listEntities(tr.key).map(e=>`<option value="${tr.key}::${e.id}">${esc(tr.icon||'')} ${esc((e.stamm&&e.stamm.name)||'(ohne Name)')}</option>`).join('')).join('')).join('');
  const usersWithMail=zeUsers().filter(u=>u.id!=='admin' && u.email)
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
  const userOpts=['<option value="">– Person aus dem System hinzufügen –</option>']
    .concat(usersWithMail.map(u=>`<option value="${esc(u.email)}">${esc(u.name)} (${esc(u.email)})</option>`)).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">✉️ Verteiler</h3>
   <div class="crm-modal-field"><label>Name *</label><input id="crm-vt-name" value="${esc(v.name||'')}" placeholder="z. B. Alle Vereinsvorstände"></div>
   <div class="crm-modal-field"><label>E-Mail-Adressen <span style="font-size:11px;color:var(--muted)">(eine pro Zeile)</span></label><textarea id="crm-vt-emails" rows="8" placeholder="name@example.de">${esc((v.emails||[]).join('\n'))}</textarea></div>
   <div class="crm-modal-field"><label>Personen hinzufügen <span style="font-size:11px;color:var(--muted)">(Nutzer mit hinterlegter Mailadresse)</span></label><select id="crm-vt-user" onchange="crmVerteilerAddUser()">${userOpts}</select></div>
   <div class="crm-modal-field"><label>Kontakte hinzufügen</label><select id="crm-vt-pick" onchange="crmVerteilerAddVerein()">${vereinOpts}</select></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmSaveVerteiler('${esc(v.id||'')}')">Speichern</button></div>`);
}
function crmVerteilerAddUser(){
  const sel=document.getElementById('crm-vt-user'); const mail=sel?sel.value:''; if(sel) sel.value='';
  if(!mail) return;
  const ta=document.getElementById('crm-vt-emails');
  const before=_normEmails([ta?ta.value:'']).length;
  const merged=_normEmails([(ta?ta.value:''), mail]);
  if(ta) ta.value=merged.join('\n');
  toast(merged.length>before?'Person übernommen ✓':'Adresse ist bereits in der Liste','ok');
}
function crmVerteilerAddVerein(){
  const sel=document.getElementById('crm-vt-pick'); const v0=sel?sel.value:''; if(!v0) return;
  const sepIdx=v0.indexOf('::'); const tree=v0.slice(0,sepIdx), eid=v0.slice(sepIdx+2);
  const e=getEntity(tree,eid);
  if(sel) sel.value='';
  if(!e) return;
  const emails=(e.kontakte||[]).flatMap(k=>kEmails(k)).filter(Boolean);
  const stammMail=(e.stamm&&e.stamm.email)||''; if(stammMail) emails.push(stammMail);
  const ta=document.getElementById('crm-vt-emails');
  const before=_normEmails([ta?ta.value:'']).length;
  const merged=_normEmails([(ta?ta.value:''), ...emails]);
  if(ta) ta.value=merged.join('\n');
  const added=merged.length-before;
  toast(added?`${added} neue Adresse(n) übernommen ✓`:'Keine neuen Adressen gefunden','ok');
}
function crmSaveVerteiler(id){
  const name=val('crm-vt-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const ta=document.getElementById('crm-vt-emails');
  const emails=_normEmails([ta?ta.value:'']);
  const ex=id?getVerteiler(id):null;
  saveVerteiler({ id:id||newId(), name, emails,
    createdAt:(ex&&ex.createdAt)||Date.now(), createdByKuerzel:(ex&&ex.createdByKuerzel)||curKuerzel(),
    updatedByKuerzel:curKuerzel(), updatedByName:curName() });
  crmCloseModal(); paintVerteiler(); toast('Verteiler gespeichert ✓','ok');
}
function crmDeleteVerteilerC(id){ const v=getVerteiler(id); if(!v) return; if(!window.confirm(`Verteiler „${v.name||''}" löschen?`)) return; deleteVerteiler(id); paintVerteiler(); toast('Verteiler gelöscht.','ok'); }
function crmVerteilerMail(id){ const v=getVerteiler(id); if(v) _openBcc(v.emails); }
function crmCopyVerteiler(id){ const v=getVerteiler(id); if(v) _copyEmails(v.emails); }
// Schnellaktion am Eintrag: Mail an alle Kontakte (BCC)
function crmMailKontakte(){
  const e=curEntity(); if(!e) return;
  const emails=(e.kontakte||[]).flatMap(k=>kEmails(k)).filter(Boolean);
  if(!emails.length){ toast('An diesem Eintrag sind keine Kontakt-E-Mails hinterlegt.','err'); return; }
  _openTo(emails);  // Kontakte eines Eintrags kennen sich → sichtbar im An-Feld
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
      <div class="grow"><span class="tx">${esc(n.text)}</span>${(depth===0&&n.team)?` <span class="fn">${esc(n.team)}</span>`:''}${n.note?`<div class="crm-tnote">${nl2br(n.note)}</div>`:''}${depNames.length?`<div class="small crm-locked">↦ nach: ${esc(depNames.join(', '))}</div>`:''}</div>
      <button class="btn-sm-crm" title="Unterpunkt" onclick="crmVNodeAdd('${v.id}','${n.id}')">＋</button>
      <button class="btn-sm-crm" title="Bearbeiten" onclick="crmVNodeEdit('${v.id}','${n.id}')">✎</button>
      <button class="btn-sm-crm" title="Abhängigkeit" onclick="crmVNodeDeps('${v.id}','${n.id}')">🔗</button>
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
   <div class="crm-modal-field"><label>Beschreibung / Notiz</label><textarea id="crm-vnode-note" rows="2"></textarea></div>
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmEditVorlage('${vid}')">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmVNodeAddSave('${vid}','${pid}')">Hinzufügen</button></div>`);
}
function crmVNodeAddSave(vid, pid){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const text=val('crm-vnode-text'); if(!text){ toast('Bitte einen Unterpunkt eingeben.','err'); return; }
  const f=findNodeIn(v.items, pid); if(!f) return;
  if(!Array.isArray(f.node.children)) f.node.children=[];
  f.node.children.push({ id:newId(), text, note:val('crm-vnode-note'), deps:[], children:[] });
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
   <div class="crm-modal-field"><label>Beschreibung / Notiz</label><textarea id="crm-vnode-note" rows="2">${esc(f.node.note||'')}</textarea></div>
   ${teamSel}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmEditVorlage('${vid}')">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmVNodeEditSave('${vid}','${id}')">Speichern</button></div>`);
}
function crmVNodeEditSave(vid, id){
  const v=getVorlage(vid); if(!v) return; normVorlage(v);
  const f=findNodeIn(v.items, id); if(!f) return;
  const text=val('crm-vnode-text'); if(!text){ toast('Bitte einen Text eingeben.','err'); return; }
  f.node.text=text;
  f.node.note=val('crm-vnode-note');
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
// Verwaltungs-Gerüst bauen + die ZE-Organisationsbausteine (Teams/Rollen/
// Kategorien/Daten) EINMALIG hierher umhängen (gleiche Elemente/IDs →
// renderSettings füllt sie am neuen Ort). Mitarbeiter rendern wir selbst
// als breite Tabelle. Idempotent.
function ensureVerwMounted(){
  const root=document.getElementById('verw-root'); if(!root) return;
  if(document.getElementById('verw-users')) return;
  root.innerHTML = `<div class="crm-bar"><div class="crm-trees"><span style="font-weight:700;color:var(--primary)">🔑 Verwaltung</span></div></div>
   <div class="crm-body">
     <div id="verw-users"></div>
     <div id="verw-crmcfg"></div>
     <div id="verw-impexp"></div>
     <div id="verw-history"></div>
     <div id="verw-config"></div>
   </div>`;
  const cfg=document.getElementById('verw-config');
  ['set-org-box','set-cats-box'].forEach(id=>{ const el=document.getElementById(id); if(el&&cfg) cfg.appendChild(el); });
}
function renderVerwaltung(){
  try{
    injectStyles();
    const root=document.getElementById('verw-root'); if(!root) return;
    if(!window.cu || window.cu.role!=='admin'){ root.innerHTML='<div class="crm-empty">Kein Zugriff.</div>'; return; }
    ensureCrmReady().then(()=>{
      try{
        ensureVerwMounted();
        paintVerwUsers();
        paintVerwImpExp();
        paintVerwConfig();
        paintVerwHistory();
        if(window.renderSettings) window.renderSettings();  // füllt Teams/Rollen/Kategorien
      }catch(e){ console.error('Verwaltung:',e); }
    });
  }catch(e){ console.error('renderVerwaltung:',e); }
}
function paintVerwUsers(){
  const host=document.getElementById('verw-users'); if(!host) return;
  const vereine=listEntities('vereine');
  const vOpts=sel=>['<option value="">– Verein wählen –</option>']
    .concat(vereine.map(v=>`<option value="${v.id}" ${sel===v.id?'selected':''}>${esc((v.stamm&&v.stamm.name)||'(ohne Name)')}</option>`)).join('');
  const users=zeUsers().filter(u=>u.id!=='admin')
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'de',{sensitivity:'base'}));
  const rows=users.map(u=>{
    const a=getAccess(u.id)||{level:'none'};
    const lvl=a.level||'none';
    const vereinIds=Array.isArray(a.vereinIds)?a.vereinIds:(a.vereinId?[a.vereinId]:[]);
    const lvlSel=[['none','Kein Zugriff'],['verein','Nur zugeordnete Vereine'],['readonly','Erweitert – alles sehen'],['full','Voll']]
      .map(([L,t])=>`<option value="${L}" ${lvl===L?'selected':''}>${t}</option>`).join('');
    const teams=(Array.isArray(u.teams)&&u.teams.length?u.teams:(u.team?[u.team]:[])).filter(Boolean);
    const vereinPick = lvl==='verein'
      ? `<div class="vw-vpick">${vereine.map(v=>`<label><input type="checkbox" ${vereinIds.includes(v.id)?'checked':''} onchange="crmVerwToggleVerein('${u.id}','${v.id}',this.checked)"> ${esc((v.stamm&&v.stamm.name)||'(ohne Name)')}</label>`).join('')||'<span class="small" style="color:var(--muted)">Keine Vereine angelegt.</span>'}</div>`
      : '';
    return `<tr>
      <td><span class="vw-name">${esc(u.name)}</span>${u.crmOnly?' <span class="vw-team" title="Nur CRM, keine Zeiterfassung">CRM-only</span>':''}</td>
      <td>${esc(roleLbl(u))}</td>
      <td>${teams.map(t=>`<span class="vw-team">${esc(t)}</span>`).join('')||'<span class="small" style="color:var(--muted)">–</span>'}</td>
      <td><select class="crm-tsel" onchange="crmVerwSetLevel('${u.id}',this.value)">${lvlSel}</select>${vereinPick}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-sm-crm" onclick="showEditUser('${u.id}')">Bearbeiten</button>
        <button class="crm-x" title="Löschen" onclick="deleteUser('${u.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
  host.innerHTML = `<div class="crm-sec">
    <h4><span class="ttl">👥 Mitarbeiter &amp; Zugriff</span><button class="btn-sm-crm primary" onclick="showAddUser()">＋ Hinzufügen</button></h4>
    <div class="small" style="color:var(--muted);margin-bottom:10px">CRM-Zugriff direkt hier setzen. <b>Erweitert</b> = sieht alle Bäume/Teams, kann aber nichts anlegen/löschen/umbenennen (nur Aufgaben bearbeiten). Bei <b>Nur zugeordnete Vereine</b> mehrere Vereine ankreuzbar. „Bearbeiten" öffnet Rolle, Teams, Stunden und Berechtigungen.</div>
    <div style="overflow-x:auto"><table class="vw-table">
      <thead><tr><th>Name</th><th>Rolle</th><th>Team(s)</th><th>CRM-Zugriff</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="small" style="color:var(--muted)">Keine Nutzer.</td></tr>'}</tbody>
    </table></div>
  </div>`;
}
function crmVerwSetLevel(uid, level){
  const a=getAccess(uid)||{};
  const vereinIds=Array.isArray(a.vereinIds)?a.vereinIds:(a.vereinId?[a.vereinId]:[]);
  if(level==='none') saveAccess(uid, null);
  else saveAccess(uid, { level, vereinIds: level==='verein'?vereinIds:[] });
  paintVerwUsers();
}
function crmVerwToggleVerein(uid, vid, checked){
  const a=getAccess(uid)||{level:'verein'};
  let ids=Array.isArray(a.vereinIds)?a.vereinIds.slice():(a.vereinId?[a.vereinId]:[]);
  if(checked){ if(!ids.includes(vid)) ids.push(vid); } else { ids=ids.filter(x=>x!==vid); }
  saveAccess(uid, { level:'verein', vereinIds:ids });
}

// ── Änderungs-Verlauf & Wiederherstellung (Backup) ─────────────────
function _histCollLabel(coll){
  if(coll==='teamprojekte') return 'Projekt';
  if(coll==='vorlagen') return 'Vorlage';
  if(coll==='verteiler') return 'Verteiler';
  if(coll==='config') return 'Konfiguration';
  try{ const t=getTrees().find(x=>x.key===coll); if(t) return t.single||t.label; }catch(e){}
  return coll;
}
function _statusLabel(k){ try{ const s=getTaskStatus().find(x=>x.key===k); return s?s.label:k; }catch(e){ return k; } }
function _flatTaskMap(todos){ const m={}; try{ flatNodes(todos||[]).forEach(x=>{ m[x.id]={text:x.text,status:x.status}; }); }catch(e){} return m; }
function _diffTasks(prevTodos, curTodos, parts){
  const pm=_flatTaskMap(prevTodos), cm=_flatTaskMap(curTodos);
  Object.keys(cm).forEach(id=>{ const c=cm[id], p=pm[id];
    if(!p) parts.push(`Aufgabe „${c.text||''}" hinzugefügt`);
    else if(p.status!==c.status) parts.push(`Aufgabe „${c.text||''}" → ${_statusLabel(c.status)}`);
    else if(p.text!==c.text) parts.push(`Aufgabe umbenannt → „${c.text||''}"`);
  });
  Object.keys(pm).forEach(id=>{ if(!cm[id]) parts.push(`Aufgabe „${pm[id].text||''}" entfernt`); });
}
function _diffById(prevArr, curArr, label, nameFn, parts){
  const p=Array.isArray(prevArr)?prevArr:[], c=Array.isArray(curArr)?curArr:[];
  const pm={}, cm={}; p.forEach(x=>{ if(x&&x.id) pm[x.id]=x; }); c.forEach(x=>{ if(x&&x.id) cm[x.id]=x; });
  c.forEach(x=>{ if(!pm[x.id]) parts.push(`${label} „${nameFn(x)||''}" hinzugefügt`);
    else if(JSON.stringify(pm[x.id])!==JSON.stringify(x)) parts.push(`${label} „${nameFn(x)||''}" geändert`); });
  p.forEach(x=>{ if(!cm[x.id]) parts.push(`${label} „${nameFn(x)||''}" entfernt`); });
}
function _diffProjekte(prevP, curP, parts){
  const p=Array.isArray(prevP)?prevP:[], c=Array.isArray(curP)?curP:[];
  const pm={}, cm={}; p.forEach(x=>pm[x.id]=x); c.forEach(x=>cm[x.id]=x);
  c.forEach(x=>{ const o=pm[x.id];
    if(!o){ parts.push(`Projekt „${x.name||''}" angelegt`); return; }
    if((o.name||'')!==(x.name||'')) parts.push(`Projekt umbenannt → „${x.name||''}"`);
    if(!!o.closed!==!!x.closed) parts.push(`Projekt „${x.name||''}" ${x.closed?'abgeschlossen':'wieder geöffnet'}`);
    _diffTasks(o.todos, x.todos, parts);
  });
  p.forEach(x=>{ if(!cm[x.id]) parts.push(`Projekt „${x.name||''}" gelöscht`); });
}
// Kurze Beschreibung WAS sich geändert hat (cur ggü. prev). '' = nichts Inhaltliches.
function _histDescribe(prev, cur, coll){
  if(!cur) return '';
  const parts=[];
  if(coll==='config') return 'Konfiguration angepasst';
  if(coll==='verteiler'){
    if(!prev) return 'angelegt';
    if((prev.name||'')!==(cur.name||'')) parts.push(`umbenannt → „${cur.name||''}"`);
    const pe=(prev.emails||[]).length, ce=(cur.emails||[]).length;
    if(pe!==ce) parts.push(`Adressen ${ce>pe?'+':'−'}${Math.abs(ce-pe)} (jetzt ${ce})`);
    return parts.join('; ');
  }
  if(coll==='vorlagen'){
    if(!prev) return 'angelegt';
    if((prev.name||'')!==(cur.name||'')) parts.push(`umbenannt → „${cur.name||''}"`);
    _diffTasks((prev.items||[]),(cur.items||[]),parts);
    return parts.slice(0,4).join('; ')+(parts.length>4?` (+${parts.length-4})`:'');
  }
  if(coll==='teamprojekte'){
    if(!prev) return 'Projekt angelegt';
    if((prev.name||'')!==(cur.name||'')) parts.push(`umbenannt → „${cur.name||''}"`);
    if(!!prev.closed!==!!cur.closed) parts.push(cur.closed?'abgeschlossen':'wieder geöffnet');
    _diffTasks(prev.todos, cur.todos, parts);
    return parts.slice(0,4).join('; ')+(parts.length>4?` (+${parts.length-4})`:'');
  }
  // Baum-Eintrag (Verein etc.)
  if(!prev) return 'angelegt';
  const ps=prev.stamm||{}, cs=cur.stamm||{};
  const stCh=Object.keys(Object.assign({},ps,cs)).filter(k=>String(ps[k]==null?'':ps[k])!==String(cs[k]==null?'':cs[k]));
  if(stCh.length) parts.push('Stammdaten geändert');
  _diffById(prev.kontakte, cur.kontakte, 'Kontakt', k=>k.name, parts);
  _diffById(prev.termine, cur.termine, 'Termin', t=>t.titel, parts);
  _diffById(prev.angebote, cur.angebote, 'Angebot', a=>a.titel, parts);
  _diffById(prev.stats, cur.stats, 'Statistik', s=>{ try{return fmtDate(Date.parse(s.date));}catch(e){return '';} }, parts);
  _diffById(prev.foerderungen, cur.foerderungen, 'Förderung', f=>f.was||foerderStatusLabel(f.status), parts);
  _diffById(prev.kontaktnotizen, cur.kontaktnotizen, 'Kontaktnotiz', n=>String(n.text||'').slice(0,24), parts);
  if((prev.statusQuo||'')!==(cur.statusQuo||'')) parts.push('Kontaktnotiz geändert');
  _diffProjekte(prev.projekte, cur.projekte, parts);
  return parts.slice(0,4).join('; ')+(parts.length>4?` (+${parts.length-4} weitere)`:'');
}
function histRowsHtml(rows){
  if(!rows || !rows.length) return `<div class="small" style="color:var(--muted)">Keine Änderungen im gewählten Zeitraum.<br>Falls hier nie etwas erscheint, fehlt evtl. die Firebase-Regel für <code>crm_history</code>.</div>`;
  // Vorgänger-Schnappschuss je Datensatz (rows neueste-zuerst → nächster älterer mit gleicher coll+recId)
  const out=[];
  rows.forEach((h,i)=>{
    const del=h.action==='delete';
    let desc='', prev=null;
    if(del){ desc='komplett gelöscht'; }
    else {
      for(let j=i+1;j<rows.length;j++){ if(rows[j].coll===h.coll && rows[j].recId===h.recId){ prev=rows[j]; break; } }
      desc=_histDescribe(prev?prev.data:null, h.data, h.coll);
      if(!desc && prev) return;            // reiner Speicher ohne Inhalt → ausblenden
      if(!desc) desc='(Stand erfasst)';
    }
    const icon=del?'🗑':'✎';
    out.push(`<tr>
      <td style="white-space:nowrap">${esc(fmtDateTime(h.ts))}</td>
      <td>${esc(h.byName||h.byKuerzel||'?')}</td>
      <td><span class="vw-team" style="${del?'background:#fde8e8;color:#9b2c2c':''}">${icon} ${del?'gelöscht':'geändert'}</span></td>
      <td><b>${esc(_histCollLabel(h.coll))}: ${esc(h.name||h.recId||'')}</b><div class="small" style="color:var(--muted)">${esc(desc)}</div></td>
      <td style="text-align:right"><button class="btn-sm-crm${del?' primary':''}" onclick="crmHistRestore('${h._key}')">↩ Wiederherstellen</button></td>
    </tr>`);
  });
  if(!out.length) return `<div class="small" style="color:var(--muted)">Keine inhaltlichen Änderungen im gewählten Zeitraum (nur automatische Speicherungen).</div>`;
  return `<div style="overflow-x:auto"><table class="vw-table">
    <thead><tr><th>Wann</th><th>Wer</th><th>Aktion</th><th>Was</th><th></th></tr></thead>
    <tbody>${out.join('')}</tbody></table></div>`;
}
function paintVerwHistory(){
  const host=document.getElementById('verw-history'); if(!host) return;
  const winH=window._histWinH||168;  // Stunden: 48 oder 168 (7 Tage)
  const open=!!window._histOpen;
  host.innerHTML=`<details class="crm-sec crm-hist" ${open?'open':''} ontoggle="crmHistToggle(this)">
    <summary class="crm-hist-sum"><span class="ttl">🕘 Änderungs-Verlauf & Wiederherstellung</span><span class="small" style="color:var(--muted);font-weight:400">(aufklappen)</span></summary>
    <div style="margin-top:12px">
      <div class="hbtns" style="margin-bottom:8px">
        <button class="btn-sm-crm${winH===48?' primary':''}" onclick="crmHistWindow(48)">48 Std.</button>
        <button class="btn-sm-crm${winH===168?' primary':''}" onclick="crmHistWindow(168)">7 Tage</button>
        <button class="btn-sm-crm" title="Neu laden" onclick="crmHistReload()">↻</button>
      </div>
      <div class="small" style="color:var(--muted);margin-bottom:10px">Jede inhaltliche Änderung (anlegen / ändern / löschen) der letzten ${winH===48?'48 Stunden':'7 Tage'} – mit Person und Zeit. <b>Wiederherstellen</b> spielt diesen Stand wieder ein (bei Gelöschtem wird der Eintrag neu angelegt; bei Geändertem auf diese Version zurückgesetzt). Verlauf wird nach 7 Tagen automatisch bereinigt.</div>
      <div id="hist-list" class="small" style="color:var(--muted)">${open?'Lade …':''}</div>
    </div>
  </details>`;
  if(open) crmHistLoad();
}
function crmHistToggle(el){ window._histOpen=!!(el&&el.open); if(window._histOpen) crmHistLoad(); }
function crmHistLoad(){
  const winH=window._histWinH||168;
  const el=document.getElementById('hist-list'); if(el) el.innerHTML='Lade …';
  listHistory(winH*36e5).then(rows=>{ window._histRows=rows; const e2=document.getElementById('hist-list'); if(e2) e2.innerHTML=histRowsHtml(rows); });
}
function crmHistWindow(h){ window._histWinH=h; window._histOpen=true; paintVerwHistory(); }
function crmHistReload(){ crmHistLoad(); }
function crmHistRestore(key){
  const r=(window._histRows||[]).find(x=>x._key===key); if(!r){ toast('Eintrag nicht gefunden.','err'); return; }
  const what=r.name||_histCollLabel(r.coll);
  if(!window.confirm(`„${what}" auf den Stand vom ${fmtDateTime(r.ts)} (${r.byName||r.byKuerzel||'?'}) zurücksetzen?`)) return;
  Promise.resolve(restoreHistory(r)).then(()=>{ toast('Wiederhergestellt ✓','ok'); setTimeout(crmHistReload, 500); });
}

// ══════════════════════════════════════════════════════════════════
//  CRM-Konfiguration (admin): Bäume & Stammdaten-Felder editierbar
// ══════════════════════════════════════════════════════════════════
const CFG_RESERVED = ['vorlagen','teamprojekte','access','config'];
const _clone = o => JSON.parse(JSON.stringify(o));
// Arbeitskopie der Config: aus crm/config oder (falls leer) aus den Defaults.
function _cfgWork(){
  const c=getCrmConfig();
  return {
    trees: (c&&Array.isArray(c.trees)&&c.trees.length) ? _clone(c.trees) : _clone(DEFAULT_TREES),
    stammFields: (c&&c.stammFields&&typeof c.stammFields==='object') ? _clone(c.stammFields) : { __default:_clone(DEFAULT_STAMM_FIELDS) },
    memberFunctions: (c&&Array.isArray(c.memberFunctions)&&c.memberFunctions.length) ? _clone(c.memberFunctions) : _clone(DEFAULT_MEMBER_FUNCTIONS)
  };
}
function _slug(label, takenArr){
  let base=String(label||'').toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,'').slice(0,24) || 'x';
  const taken=new Set([...(takenArr||[]), ...CFG_RESERVED]);
  let k=base, i=2; while(taken.has(k)){ k=base+i; i++; } return k;
}
// Effektive Feldliste eines Baums innerhalb der Arbeitskopie
function _cfgFields(work, sel){
  if(sel==='__default') return work.stammFields.__default || _clone(DEFAULT_STAMM_FIELDS);
  return work.stammFields[sel] || work.stammFields.__default || _clone(DEFAULT_STAMM_FIELDS);
}

function paintVerwConfig(){
  const host=document.getElementById('verw-crmcfg'); if(!host) return;
  const work=_cfgWork();
  const live=!!getCrmConfig();
  // ── Bäume ──
  const treeRows=work.trees.map((t,i)=>`<tr>
      <td style="font-size:18px">${esc(t.icon||'')}</td>
      <td><span class="vw-name">${esc(t.label)}</span><div class="small" style="color:var(--muted)">${esc(t.single||'')} · <code>${esc(t.key)}</code></div></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-sm-crm" ${i===0?'disabled':''} onclick="crmCfgTreeMove('${t.key}',-1)">↑</button>
        <button class="btn-sm-crm" ${i===work.trees.length-1?'disabled':''} onclick="crmCfgTreeMove('${t.key}',1)">↓</button>
        <button class="btn-sm-crm" onclick="crmCfgTreeEdit('${t.key}')">✎</button>
        <button class="crm-x" title="Entfernen" onclick="crmCfgTreeDel('${t.key}')">✕</button>
      </td></tr>`).join('');
  // ── Felder ──
  const sel=window._cfgFieldTree||'__default';
  const treeOpts=[`<option value="__default" ${sel==='__default'?'selected':''}>Standard (alle Bäume)</option>`]
    .concat(work.trees.map(t=>`<option value="${esc(t.key)}" ${sel===t.key?'selected':''}>${esc(t.label)}</option>`)).join('');
  const hasOverride = sel!=='__default' && Array.isArray(work.stammFields[sel]);
  const usesDefault = sel!=='__default' && !hasOverride;
  const fields=_cfgFields(work, sel);
  const fieldRows=fields.map((f,i)=>`<tr>
      <td><span class="vw-name">${esc(f.label)}</span>${f.required?' <span class="vw-team">Pflicht</span>':''}<div class="small" style="color:var(--muted)">${esc((FIELD_TYPES.find(x=>x.key===f.type)||{}).label||f.type||'text')} · <code>${esc(f.key)}</code>${f.hint?' · '+esc(f.hint):''}</div></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-sm-crm" ${i===0||usesDefault?'disabled':''} onclick="crmCfgFieldMove('${i}',-1)">↑</button>
        <button class="btn-sm-crm" ${i===fields.length-1||usesDefault?'disabled':''} onclick="crmCfgFieldMove('${i}',1)">↓</button>
        <button class="btn-sm-crm" ${usesDefault?'disabled':''} onclick="crmCfgFieldEdit('${f.key}')">✎</button>
        <button class="crm-x" title="Entfernen" ${(usesDefault||f.key==='name')?'disabled':''} onclick="crmCfgFieldDel('${f.key}')">✕</button>
      </td></tr>`).join('');
  const funcs=(work.memberFunctions||[]).join('\n');

  host.innerHTML = `
  <div class="crm-sec">
    <h4><span class="ttl">🌳 CRM-Bäume</span><button class="btn-sm-crm primary" onclick="crmCfgTreeEdit('')">＋ Baum</button></h4>
    <div class="small" style="color:var(--muted);margin-bottom:8px">Oberste Ebenen im CRM. Umbenennen/Icon ändern jederzeit; der interne Schlüssel bleibt fix. Löschen blendet den Baum aus – <b>vorhandene Einträge bleiben in der Datenbank erhalten</b>.${live?'':' <i>(Noch nicht angepasst – es gelten die Standardwerte.)</i>'}</div>
    <div style="overflow-x:auto"><table class="vw-table"><tbody>${treeRows}</tbody></table></div>
  </div>
  <div class="crm-sec">
    <h4><span class="ttl">📋 Stammdaten-Felder</span><button class="btn-sm-crm primary" ${usesDefault?'disabled':''} onclick="crmCfgFieldEdit('')">＋ Feld</button></h4>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <label class="small" style="color:var(--muted)">Für:</label>
      <select class="crm-tsel" onchange="crmCfgFieldTree(this.value)">${treeOpts}</select>
      ${hasOverride?`<button class="btn-sm-crm" onclick="crmCfgFieldReset('${esc(sel)}')">↩ Auf Standard zurücksetzen</button>`:''}
    </div>
    ${usesDefault?`<div class="small" style="color:var(--muted);margin-bottom:8px">Dieser Baum nutzt aktuell die Standard-Felder. <button class="btn-sm-crm" onclick="crmCfgFieldOverride('${esc(sel)}')">Eigene Felder für diesen Baum anlegen</button></div>`:''}
    <div style="overflow-x:auto"><table class="vw-table"><tbody>${fieldRows}</tbody></table></div>
  </div>
  <div class="crm-sec">
    <h4><span class="ttl">👤 Kontakt-Funktionen</span></h4>
    <div class="small" style="color:var(--muted);margin-bottom:6px">Auswahl im Kontakt-Formular – eine Funktion pro Zeile.</div>
    <textarea id="cfg-funcs" rows="6" style="width:100%;box-sizing:border-box">${esc(funcs)}</textarea>
    <div style="margin-top:8px"><button class="btn-sm-crm primary" onclick="crmCfgFuncsSave()">Funktionen speichern</button></div>
  </div>`;
}

// ── Bäume ──
function crmCfgTreeEdit(key){
  const work=_cfgWork();
  const t = key? work.trees.find(x=>x.key===key) : {icon:'',label:'',single:''};
  if(!t) return;
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${key?'✎ Baum bearbeiten':'＋ Neuer Baum'}</h3>
   <div style="display:flex;gap:10px;flex-wrap:wrap">
     <div class="crm-modal-field" style="width:90px"><label>Icon</label><input id="cfg-tree-icon" value="${esc(t.icon||'')}" placeholder="🏛️" maxlength="4"></div>
     <div class="crm-modal-field" style="flex:1;min-width:160px"><label>Bezeichnung (Mehrzahl) *</label><input id="cfg-tree-label" value="${esc(t.label||'')}" placeholder="z. B. Vereine"></div>
   </div>
   <div class="crm-modal-field"><label>Einzahl (für „Neuer …")</label><input id="cfg-tree-single" value="${esc(t.single||'')}" placeholder="z. B. Verein"></div>
   ${key?`<div class="small" style="color:var(--muted)">Schlüssel <code>${esc(key)}</code> ist fest und ändert sich nicht.</div>`:''}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmCfgTreeSave('${esc(key)}')">Speichern</button></div>`);
}
function crmCfgTreeSave(origKey){
  const label=val('cfg-tree-label'); if(!label){ toast('Bitte eine Bezeichnung eingeben.','err'); return; }
  const work=_cfgWork();
  const icon=val('cfg-tree-icon'), single=val('cfg-tree-single')||label;
  if(origKey){ const t=work.trees.find(x=>x.key===origKey); if(t){ t.label=label; t.icon=icon; t.single=single; } }
  else { const key=_slug(label, work.trees.map(t=>t.key)); work.trees.push({ key, label, icon, single }); }
  saveCrmConfig(work); crmCloseModal(); paintVerwConfig();
  toast('Baum gespeichert ✓','ok');
}
function crmCfgTreeMove(key, dir){
  const work=_cfgWork(); const i=work.trees.findIndex(t=>t.key===key); const j=i+dir;
  if(i<0||j<0||j>=work.trees.length) return;
  const tmp=work.trees[i]; work.trees[i]=work.trees[j]; work.trees[j]=tmp;
  saveCrmConfig(work); paintVerwConfig();
}
function crmCfgTreeDel(key){
  const work=_cfgWork();
  if(work.trees.length<=1){ toast('Mindestens ein Baum muss bestehen bleiben.','err'); return; }
  const t=work.trees.find(x=>x.key===key);
  const cnt=Object.keys((getCrm()[key])||{}).length;
  const msg=`Baum „${(t&&t.label)||key}" entfernen?`+(cnt?`\n\n${cnt} vorhandene Einträge bleiben in der Datenbank erhalten, werden aber nicht mehr angezeigt.`:'');
  if(!window.confirm(msg)) return;
  work.trees=work.trees.filter(x=>x.key!==key);
  if(work.stammFields[key]) delete work.stammFields[key];
  saveCrmConfig(work);
  if(window._cfgFieldTree===key) window._cfgFieldTree='__default';
  paintVerwConfig();
  toast('Baum entfernt.','ok');
}

// ── Stammdaten-Felder ──
function crmCfgFieldTree(sel){ window._cfgFieldTree=sel; paintVerwConfig(); }
function crmCfgFieldOverride(sel){
  const work=_cfgWork();
  work.stammFields[sel]=_clone(_cfgFields(work, sel));
  saveCrmConfig(work); paintVerwConfig();
}
function crmCfgFieldReset(sel){
  if(!window.confirm('Eigene Felder dieses Baums verwerfen und wieder die Standard-Felder nutzen?')) return;
  const work=_cfgWork(); delete work.stammFields[sel];
  saveCrmConfig(work); paintVerwConfig();
}
function _cfgEnsureArr(work, sel){
  if(sel==='__default'){ if(!Array.isArray(work.stammFields.__default)) work.stammFields.__default=_clone(DEFAULT_STAMM_FIELDS); return work.stammFields.__default; }
  if(!Array.isArray(work.stammFields[sel])) work.stammFields[sel]=_clone(_cfgFields(work, sel));
  return work.stammFields[sel];
}
function crmCfgFieldEdit(key){
  const sel=window._cfgFieldTree||'__default';
  const work=_cfgWork();
  const arr=_cfgFields(work, sel);
  const f = key? arr.find(x=>x.key===key) : {label:'',type:'text',required:false,hint:''};
  if(!f) return;
  const typeOpts=FIELD_TYPES.map(t=>`<option value="${t.key}" ${f.type===t.key?'selected':''}>${esc(t.label)}</option>`).join('');
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${key?'✎ Feld bearbeiten':'＋ Neues Feld'}</h3>
   <div class="crm-modal-field"><label>Bezeichnung *</label><input id="cfg-f-label" value="${esc(f.label||'')}" placeholder="z. B. Ansprechpartner"></div>
   <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
     <div class="crm-modal-field" style="flex:1;min-width:150px"><label>Typ</label><select id="cfg-f-type">${typeOpts}</select></div>
     <label style="display:inline-flex;align-items:center;gap:6px;margin-bottom:12px;font-size:14px"><input type="checkbox" id="cfg-f-req" ${f.required?'checked':''}> Pflichtfeld</label>
   </div>
   <div class="crm-modal-field"><label>Hinweis (optional)</label><input id="cfg-f-hint" value="${esc(f.hint||'')}" placeholder="kleiner Hilfetext"></div>
   ${key?`<div class="small" style="color:var(--muted)">Schlüssel <code>${esc(key)}</code> ist fest.</div>`:''}
   <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
   <button class="btn-sm-crm primary" onclick="crmCfgFieldSave('${esc(key)}')">Speichern</button></div>`);
}
function crmCfgFieldSave(origKey){
  const label=val('cfg-f-label'); if(!label){ toast('Bitte eine Bezeichnung eingeben.','err'); return; }
  const sel=window._cfgFieldTree||'__default';
  const work=_cfgWork();
  const arr=_cfgEnsureArr(work, sel);
  const type=val('cfg-f-type')||'text';
  const required=!!(document.getElementById('cfg-f-req')&&document.getElementById('cfg-f-req').checked);
  const hint=val('cfg-f-hint');
  if(origKey){ const f=arr.find(x=>x.key===origKey); if(f){ f.label=label; f.type=type; f.required=required; f.hint=hint; } }
  else { const key=_slug(label, arr.map(f=>f.key)); arr.push({ key, label, type, required, hint }); }
  saveCrmConfig(work); crmCloseModal(); paintVerwConfig();
  toast('Feld gespeichert ✓','ok');
}
// Doppelklick direkt am Eintrag: Stammfeld-Bezeichnung NUR für DIESEN Eintrag umbenennen
// (pro Verein/Sozialakteur individuell, gespeichert an e.fieldLabels). Interner Schlüssel
// bleibt unverändert → bestehende Werte bleiben erhalten. Andere Einträge sind nicht betroffen.
function crmQuickRenameField(key){
  if(!(crmFull()||crmRestricted())){ toast('Keine Berechtigung zum Ändern.','err'); return; }
  const e=curEntity(); if(!e) return;
  const def=(stammFields(window._crmTree).find(x=>x.key===key)||{}).label||key;
  const cur=(e.fieldLabels&&e.fieldLabels[key])||def;
  const nl=window.prompt('Feld-Bezeichnung für diesen Eintrag ändern:', cur);
  if(nl==null) return;
  const label=String(nl).trim(); if(!label){ toast('Bezeichnung darf nicht leer sein.','err'); return; }
  mutateEntity(ent=>{
    if(!ent.fieldLabels) ent.fieldLabels={};
    if(label===def) delete ent.fieldLabels[key]; // gleich wie Standard → Override entfernen
    else ent.fieldLabels[key]=label;
  });
  paintDetail();
  toast('Feld umbenannt ✓','ok');
}
// Doppelklick auf die Rolle eines Kontakts: frei umbenennen (pro Kontakt).
function crmQuickRenameFunktion(mid){
  if(!(crmFull()||crmRestricted())){ toast('Keine Berechtigung zum Ändern.','err'); return; }
  const e=curEntity(); if(!e) return;
  const k=(e.kontakte||[]).find(x=>x.id===mid); if(!k) return;
  const nf=window.prompt('Rolle / Funktion ändern:', k.funktion||'');
  if(nf==null) return;
  mutateEntity(ent=>{ const kk=(ent.kontakte||[]).find(x=>x.id===mid); if(kk) kk.funktion=String(nf).trim(); });
  paintDetail();
  toast('Rolle geändert ✓','ok');
}
function crmCfgFieldMove(idx, dir){
  const sel=window._cfgFieldTree||'__default';
  const work=_cfgWork(); const arr=_cfgEnsureArr(work, sel);
  const i=parseInt(idx,10), j=i+dir;
  if(i<0||j<0||j>=arr.length) return;
  const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  saveCrmConfig(work); paintVerwConfig();
}
function crmCfgFieldDel(key){
  if(key==='name'){ toast('Das Namensfeld kann nicht entfernt werden.','err'); return; }
  const sel=window._cfgFieldTree||'__default';
  const work=_cfgWork(); const arr=_cfgEnsureArr(work, sel);
  const f=arr.find(x=>x.key===key);
  if(!window.confirm(`Feld „${(f&&f.label)||key}" entfernen?\n\nBereits erfasste Werte bleiben gespeichert, werden aber nicht mehr angezeigt.`)) return;
  const idx=arr.findIndex(x=>x.key===key); if(idx>=0) arr.splice(idx,1);
  saveCrmConfig(work); paintVerwConfig();
}

// ── Kontakt-Funktionen ──
function crmCfgFuncsSave(){
  const ta=document.getElementById('cfg-funcs');
  const lines=(ta?ta.value:'').split('\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){ toast('Mindestens eine Funktion angeben.','err'); return; }
  const work=_cfgWork(); work.memberFunctions=lines;
  saveCrmConfig(work); paintVerwConfig();
  toast('Funktionen gespeichert ✓','ok');
}

// ══════════════════════════════════════════════════════════════════
//  Import / Export  –  alle CRM-Daten einzeln auswählbar als Excel
// ══════════════════════════════════════════════════════════════════
//  Erzeugt eine .xlsx mit je einem Tabellenblatt pro Datenart. Komplexe,
//  verschachtelte Felder (Aufgaben, Kontakte, Teilnehmer …) liegen als
//  JSON in der Spalte "_rest" → verlustfrei importierbar (Upsert per id).
//  SheetJS wird nur bei Bedarf (Admin öffnet Verwaltung & klickt) vom CDN
//  geladen. Komplett isoliert; Fehler können die Zeiterfassung nie treffen.
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
// Primär-Spalten (menschenlesbar) je Datenart; alles Übrige wandert nach _rest.
const IE_PRIMARY={
  vorlagen:['id','name'],
  teamprojekte:['id','name','team','beschreibung'],
  veranstaltungen:['id','titel','start','ende','ortOderLink','team','beschreibung'],
  verteiler:['id','name','emails','note'],
};
function impexpColls(){
  const out=[{type:'kontakte', key:'kontakte', label:'Kontakte / E-Mail-Liste'}];
  getTrees().forEach(t=>out.push({type:'entity', key:t.key, label:t.label, single:t.single}));
  out.push({type:'vorlagen',        key:'vorlagen',        label:'Vorlagen'});
  out.push({type:'teamprojekte',    key:'teamprojekte',    label:'Team-Projekte'});
  out.push({type:'veranstaltungen', key:'veranstaltungen', label:'Veranstaltungen'});
  out.push({type:'verteiler',       key:'verteiler',       label:'E-Mail-Verteiler'});
  return out;
}
function allContactRows(){
  const rows=[];
  getTrees().forEach(t=>{ listEntities(t.key).forEach(e=>{
    (e.kontakte||[]).forEach(k=>{
      rows.push({ baum:t.label, eintrag:(e.stamm&&e.stamm.name)||'',
        name:k.name||'', funktion:k.funktion||'', email:kEmails(k).join('; '), tel:kTels(k).join('; '), note:k.note||'' });
    });
  }); });
  return rows;
}
// Baum anhand Label ODER Key finden (Import ist so tolerant)
function treeByLabelOrKey(v){ const s=String(v||'').toLowerCase().trim(); return getTrees().find(t=>String(t.label).toLowerCase().trim()===s || String(t.key).toLowerCase().trim()===s)||null; }
function ieCount(c){
  try{
    if(c.type==='kontakte') return allContactRows().length;
    if(c.type==='entity') return listEntities(c.key).length;
    if(c.type==='vorlagen') return listVorlagen().length;
    if(c.type==='teamprojekte') return listTeamProjekte().length;
    if(c.type==='veranstaltungen') return listVeranstaltungen().length;
    return listVerteiler().length;
  }catch(e){ return 0; }
}
function ieList(c){
  if(c.type==='vorlagen') return listVorlagen();
  if(c.type==='teamprojekte') return listTeamProjekte();
  if(c.type==='veranstaltungen') return listVeranstaltungen();
  return listVerteiler();
}
function ieSheetName(key){ return String(key).replace(/[\[\]\:\*\?\/\\]/g,'_').slice(0,31); }
// Tabellenblatt-Inhalt (Kopf + Zeilen) je Datenart bauen
function ieBuildRows(c){
  if(c.type==='kontakte'){
    return { header:['baum','eintrag','name','funktion','email','tel','note'], rows:allContactRows() };
  }
  if(c.type==='entity'){
    const fields=stammFields(c.key).map(f=>f.key);
    const header=['id',...fields,'_rest'];
    const rows=listEntities(c.key).map(e=>{
      const row={id:e.id};
      fields.forEach(k=>{ row[k]=(e.stamm&&e.stamm[k]!=null)?e.stamm[k]:''; });
      const rest=Object.assign({}, e); delete rest.id; delete rest.stamm;
      row._rest=JSON.stringify(rest);
      return row;
    });
    return {header, rows};
  }
  const prim=IE_PRIMARY[c.type];
  const header=[...prim,'_rest'];
  const rows=ieList(c).map(rec=>{
    const row={};
    prim.forEach(k=>{
      let v;
      if(k==='emails') v=_normEmails(rec.emails).join('; ');
      else v=rec[k];
      if(v==null) v='';
      else if(typeof v==='object') v=JSON.stringify(v);
      row[k]=v;
    });
    const rest={}; Object.keys(rec).forEach(k=>{ if(!prim.includes(k)) rest[k]=rec[k]; });
    row._rest=JSON.stringify(rest);
    return row;
  });
  return {header, rows};
}
// Eine eingelesene Zeile in einen Datensatz zurückführen (Upsert per id)
function ieImportRow(c, row){
  if(c.type==='kontakte'){
    const tree=treeByLabelOrKey(row.baum); if(!tree) return false;
    const bk=tree.key;
    // Eintrag bestimmen: bevorzugt per eid (falls Spalte vorhanden), sonst per Name
    let e=null; const eid=String(row.eid||'').trim();
    if(eid) e=getEntity(bk, eid);
    if(!e){ const nm=String(row.eintrag||'').toLowerCase().trim();
      if(nm) e=listEntities(bk).find(x=>String((x.stamm&&x.stamm.name)||'').toLowerCase().trim()===nm); }
    if(!e) return false;                                         // Eintrag muss existieren
    const ent=Object.assign({}, e); ent.kontakte=(e.kontakte||[]).map(k=>Object.assign({},k));
    const kid=String(row.kid||'').trim();
    let k = kid ? ent.kontakte.find(x=>x.id===kid) : null;
    if(!k && String(row.name||'').trim()) k = ent.kontakte.find(x=>String(x.name||'').toLowerCase().trim()===String(row.name).toLowerCase().trim());
    const set=o=>{ ['name','funktion','email','tel','note'].forEach(f=>{ const v=row[f]; if(v!=null && String(v).trim()!=='') o[f]=String(v).trim(); }); };
    if(k){ set(k); }
    else { if(!String(row.name||'').trim()) return false; const nk={ id:newId() }; set(nk); ent.kontakte.push(nk); }
    saveEntity(bk, ent);
    return true;
  }
  let rest={}; if(row._rest){ try{ rest=JSON.parse(row._rest)||{}; }catch(e){} }
  const id=String(row.id||'').trim()||newId();
  if(c.type==='entity'){
    const ex=getEntity(c.key,id)||{};
    const stamm=Object.assign({}, ex.stamm||{});
    stammFields(c.key).forEach(f=>{ const v=row[f.key]; if(v!=null && String(v).trim()!=='') stamm[f.key]=String(v); });
    if(!stamm.name) return false; // Eintrag ohne Name überspringen
    const ent=Object.assign({}, ex, rest, {id, tree:c.key, stamm});
    if(!ent.createdAt) ent.createdAt=Date.now();
    saveEntity(c.key, ent);
    return true;
  }
  const prim=IE_PRIMARY[c.type];
  const ex = c.type==='vorlagen'?getVorlage(id) : c.type==='teamprojekte'?getTeamProjekt(id)
           : c.type==='veranstaltungen'?getVeranstaltung(id) : getVerteiler(id);
  const rec=Object.assign({}, ex||{}, rest);
  prim.forEach(k=>{ if(k==='id') return; const v=row[k]; if(v==null||String(v).trim()==='') return;
    if(k==='emails') rec.emails=String(v).split(/[;,\n]+/).map(s=>s.trim()).filter(Boolean);
    else rec[k]=v;
  });
  rec.id=id;
  if(c.type==='vorlagen'){ if(!rec.name) return false; saveVorlage(rec); }
  else if(c.type==='teamprojekte'){ if(!rec.name) return false; saveTeamProjekt(rec); }
  else if(c.type==='veranstaltungen'){ if(!rec.titel) return false; saveVeranstaltung(rec); }
  else { if(!rec.name) return false; saveVerteiler(rec); }
  return true;
}
function paintVerwImpExp(){
  const host=document.getElementById('verw-impexp'); if(!host) return;
  const colls=impexpColls();
  const boxes=colls.map(c=>`<label class="vw-ie-item"><input type="checkbox" class="crm-ie-col" value="${esc(c.key)}" checked> ${esc(c.label)} <span class="small" style="color:var(--muted)">(${ieCount(c)})</span></label>`).join('');
  host.innerHTML=`<div class="crm-sec">
    <h4><span class="ttl">📊 Import / Export (Excel)</span></h4>
    <div class="small" style="color:var(--muted);margin-bottom:10px">Wähle die CRM-Daten, die exportiert oder importiert werden sollen. Der <b>Export</b> erzeugt eine Excel-Datei mit je einem Tabellenblatt pro Datenart. <b>Kontakte / E-Mail-Liste</b> ist eine flache Liste aller Ansprechpartner (Name, E-Mail, Telefon, Funktion) – ideal für Serienmails/Adresslisten. Beim <b>Import</b> werden Zeilen anhand der <b>id</b> (bei Kontakten: <b>Baum + Eintragsname + Kontaktname</b>) aktualisiert; neue Zeilen werden angelegt. Die Spalte <b>_rest</b> enthält verschachtelte Daten – am besten unverändert lassen.</div>
    <div class="vw-ie-grid">${boxes}</div>
    <div class="vw-ie-actions">
      <button class="btn-sm-crm" onclick="crmIeSelectAll(true)">Alle</button>
      <button class="btn-sm-crm" onclick="crmIeSelectAll(false)">Keine</button>
      <button class="btn-sm-crm primary" onclick="crmExportXlsx()">⬇️ Export als Excel</button>
      <label class="btn-sm-crm" style="cursor:pointer">⬆️ Import aus Excel<input id="crm-ie-file" type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="crmImportXlsx(this)"></label>
    </div>
    <div id="crm-ie-status" class="small" style="color:var(--muted);margin-top:8px"></div>
  </div>`;
}
function crmIeSelectAll(v){ document.querySelectorAll('.crm-ie-col').forEach(x=>{ x.checked=!!v; }); }
// Import/Export direkt im CRM – für ALLE mit Vollzugriff (nicht nur Admin/Verwaltung)
function crmImpExpModal(){
  if(!crmFull()){ toast('Nur mit Voll-Zugriff.','err'); return; }
  crmOpenModalShell();
  const boxes=impexpColls().map(c=>`<label class="vw-ie-item"><input type="checkbox" class="crm-ie-col" value="${esc(c.key)}" checked> ${esc(c.label)} <span class="small" style="color:var(--muted)">(${ieCount(c)})</span></label>`).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 12px">📊 Import / Export (Excel)</h3>
    <div class="small" style="color:var(--muted);margin-bottom:10px">Wähle die Datenart(en). <b>Kontakte / E-Mail-Liste</b> = flache Liste aller Ansprechpartner (Name, E-Mail, Telefon) – ideal für Serienmails. Beim Import werden vorhandene Zeilen aktualisiert (Kontakte per Baum + Eintragsname + Kontaktname), neue angelegt.</div>
    <div class="vw-ie-grid">${boxes}</div>
    <div class="vw-ie-actions">
      <button class="btn-sm-crm" onclick="crmIeSelectAll(true)">Alle</button>
      <button class="btn-sm-crm" onclick="crmIeSelectAll(false)">Keine</button>
      <button class="btn-sm-crm primary" onclick="crmExportXlsx()">⬇️ Export als Excel</button>
      <label class="btn-sm-crm" style="cursor:pointer">⬆️ Import aus Excel<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="crmImportXlsx(this)"></label>
    </div>
    <div id="crm-ie-status" class="small" style="color:var(--muted);margin-top:8px"></div>
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Schließen</button></div>`);
}
function _ieStatus(t){ const el=document.getElementById('crm-ie-status'); if(el) el.textContent=t||''; }
async function crmExportXlsx(){
  const keys=Array.from(document.querySelectorAll('.crm-ie-col:checked')).map(x=>x.value);
  if(!keys.length){ toast('Bitte mindestens eine Datenart auswählen.','err'); return; }
  _ieStatus('Excel-Datei wird erstellt …');
  try{
    const XLSX=await loadXLSX();
    const colls=impexpColls();
    const wb=XLSX.utils.book_new();
    keys.forEach(key=>{
      const c=colls.find(x=>x.key===key); if(!c) return;
      const {header,rows}=ieBuildRows(c);
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows,{header}) : XLSX.utils.aoa_to_sheet([header]);
      XLSX.utils.book_append_sheet(wb, ws, ieSheetName(c.key));
    });
    const d=new Date(), p=n=>String(n).padStart(2,'0');
    XLSX.writeFile(wb, `CRM-Export-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.xlsx`);
    _ieStatus(`Export erstellt: ${keys.length} Datenart(en).`);
    toast('Excel-Export erstellt ✓','ok');
  }catch(e){ console.error('CRM-Export:',e); _ieStatus(''); toast('Export fehlgeschlagen: '+((e&&e.message)||e),'err'); }
}
async function crmImportXlsx(input){
  const file=input && input.files && input.files[0]; if(!file){ return; }
  if(!confirm('Import jetzt starten?\n\nVorhandene Einträge mit derselben id werden überschrieben, neue Zeilen (ohne id) angelegt. Nur die oben angehakten Datenarten werden importiert.')){ input.value=''; return; }
  const allowed=new Set(Array.from(document.querySelectorAll('.crm-ie-col:checked')).map(x=>x.value));
  _ieStatus('Datei wird gelesen …');
  try{
    const XLSX=await loadXLSX();
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    const colls=impexpColls();
    let total=0, sheets=0; const skipped=[];
    wb.SheetNames.forEach(sn=>{
      const c=colls.find(x=>ieSheetName(x.key)===sn || x.key===sn);
      if(!c){ skipped.push(sn); return; }
      if(!allowed.has(c.key)) return;
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
      let n=0; rows.forEach(r=>{ try{ if(ieImportRow(c,r)) n++; }catch(e){ console.warn('Import-Zeile übersprungen:',e); } });
      total+=n; sheets++;
    });
    input.value='';
    _ieStatus(`Import abgeschlossen: ${total} Datensätze aus ${sheets} Tabellenblatt/-blättern.${skipped.length?' Ignorierte Blätter: '+skipped.join(', '):''}`);
    toast(`Import: ${total} Datensätze übernommen ✓`,'ok');
    try{ paintVerwImpExp(); }catch(e){}
  }catch(e){ console.error('CRM-Import:',e); _ieStatus(''); toast('Import fehlgeschlagen: '+((e&&e.message)||e),'err'); }
}

// ══════════════════════════════════════════════════════════════════
//  Workflows – visueller Automatisierungs-Builder (im CAS-Stil)
// ══════════════════════════════════════════════════════════════════
//  Entwurf/Veröffentlichen + Versionierung. Ausgeführt werden derzeit
//  veröffentlichte Workflows mit Auslöser „Eintrag angelegt": Bedingung,
//  Aufgabe erstellen, Notiz/Log am Eintrag. Benachrichtigung/Pause/Webhook
//  werden als Log-Eintrag protokolliert (echte Zustellung braucht Backend).
const WF_KIND={
  aktion:{label:'AKTION', color:'#e8833a'},
  bedingung:{label:'STEUERUNG', color:'#2d6099'},
  pause:{label:'PAUSE', color:'#e3b53b'},
  benachrichtigung:{label:'BENACHRICHTIGUNG', color:'#2d6099'},
  log:{label:'LOG', color:'#7f8c8d'}
};
const WF_TRIGGERS=[['entryCreated','Eintrag angelegt'],['entryUpdated','Eintrag geändert'],['manual','Manuell / Testlauf'],['webhook','Webhook (extern)']];
const WF_OPS=[['enthaelt','enthält'],['gleich','ist gleich'],['nichtleer','ist ausgefüllt'],['leer','ist leer']];
function wfTriggerLabel(t){ const x=WF_TRIGGERS.find(z=>z[0]===t); return x?x[1]:t; }
function wfOpLabel(o){ const x=WF_OPS.find(z=>z[0]===o); return x?x[1]:o; }
function wfFieldOptions(tree, sel){
  const fs=[{key:'name',label:'Name'}].concat(stammFields(tree||'vereine').filter(f=>f.key!=='name'));
  return fs.map(f=>`<option value="${esc(f.key)}" ${sel===f.key?'selected':''}>${esc(f.label)}</option>`).join('');
}
function wfFieldLabel(tree, key){
  if(key==='name'||!key) return 'Name';
  const f=stammFields(tree||'vereine').find(x=>x.key===key); return f?f.label:key;
}
function wfStepSummary(w,s){
  if(s.kind==='aktion'){ if(s.action==='addNote') return 'Notiz/Log: '+(s.text||'(leer)'); return 'Aufgabe erstellen: '+(s.titel||'(ohne Titel)')+(s.team?(' · Team '+s.team):''); }
  if(s.kind==='bedingung'){ const f=wfFieldLabel(w.trigger&&w.trigger.tree, s.feld); return 'Wenn '+f+' '+wfOpLabel(s.op||'enthaelt')+(['nichtleer','leer'].includes(s.op)?'':' „'+(s.wert||'')+'"'); }
  if(s.kind==='pause') return (s.stunden||0)+' Stunden warten';
  if(s.kind==='benachrichtigung') return (s.kanal==='chat'?'Chat-Nachricht':'E-Mail')+' an '+(s.an||'?')+(s.betreff?(' · '+s.betreff):'');
  if(s.kind==='log') return s.text||'';
  return '';
}
// — Liste —
function paintWorkflows(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const wfs=listWorkflows();
  const cards=wfs.map(w=>{
    const pub=w.status==='published';
    const n=(w.steps||[]).length;
    return `<div class="wf-item" onclick="crmWfOpen('${w.id}')">
      <div style="min-width:0">
        <h3>⚡ ${esc(w.name||'(ohne Name)')}</h3>
        <div class="sub">Auslöser: ${esc(wfTriggerLabel((w.trigger&&w.trigger.type)||'manual'))} · ${n} Schritt${n===1?'':'e'} · v${w.version||1}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="wf-badge ${pub?'pub':'draft'}">${pub?'Veröffentlicht':'Entwurf'}</span>
        <button class="crm-x" title="Löschen" onclick="event.stopPropagation();crmWfDelete('${w.id}')">✕</button>
      </div>
    </div>`;
  }).join('') || '<div class="crm-empty" style="text-align:left">Noch keine Workflows.</div>';
  root.innerHTML = barHtml() + `<div class="crm-body"><div class="crm-sec">
    <h4><span class="ttl">⚡ Workflows – Automatisierung</span><button class="btn-sm-crm primary" onclick="crmWfNew()">＋ Neuer Workflow</button></h4>
    <div class="small" style="color:var(--muted);margin-bottom:12px">Automatisierte Abläufe nach dem Auslöser-/Aktions-Prinzip. <b>Veröffentlichte</b> Workflows mit Auslöser „Eintrag angelegt" laufen automatisch beim Anlegen eines Eintrags (Bedingung, Aufgabe erstellen, Notiz). Benachrichtigung/Pause/Webhook werden protokolliert.</div>
    <div class="wf-list">${cards}</div>
  </div></div>`;
}
function crmShowWorkflows(){ window._crmMode='workflows'; window._wfSel=null; window._crmSearch=''; paint(); }
function crmWfNew(){
  const w={ id:newId(), name:'Neuer Workflow', status:'draft', version:1,
    trigger:{ type:'entryCreated', tree:getTrees()[0].key }, steps:[], createdAt:Date.now() };
  saveWorkflow(w); window._wfSel=w.id; paint();
}
function crmWfOpen(id){ window._wfSel=id; paint(); }
function crmWfBack(){ window._wfSel=null; paint(); }
function crmWfDelete(id){ const w=getWorkflow(id); if(!w) return; if(!confirm(`Workflow „${w.name||''}" löschen?`)) return; deleteWorkflow(id); if(window._wfSel===id) window._wfSel=null; paint(); toast('Workflow gelöscht.',''); }
// — Editor —
function paintWorkflowEditor(){
  const root=document.getElementById('crm-root'); if(!root) return;
  const w=getWorkflow(window._wfSel); if(!w){ window._wfSel=null; paint(); return; }
  const tr=w.trigger||{};
  const isEntry=(tr.type==='entryCreated'||tr.type==='entryUpdated');
  const treeOpts=getTrees().map(t=>`<option value="${t.key}" ${tr.tree===t.key?'selected':''}>${esc(t.label)}</option>`).join('');
  const trigCard=`<div class="wf-step"><div class="wf-step-hd" style="background:#2d6099"><span><span class="wf-step-num">1</span>AUSLÖSER</span></div>
    <div class="wf-step-bd">
      <select class="crm-tsel" style="width:100%;margin-bottom:6px" onchange="crmWfSetTrigger('${w.id}',this.value)">${WF_TRIGGERS.map(([v,l])=>`<option value="${v}" ${tr.type===v?'selected':''}>${l}</option>`).join('')}</select>
      ${isEntry?`<select class="crm-tsel" style="width:100%" onchange="crmWfSetTriggerTree('${w.id}',this.value)">${treeOpts}</select>`:''}
      ${tr.type==='webhook'?`<div class="d">Externer Aufruf – die Webhook-URL wird beim Veröffentlichen bereitgestellt (Backend erforderlich).</div>`:''}
    </div></div>`;
  const stepCards=(w.steps||[]).map((s,i)=>{
    const meta=WF_KIND[s.kind]||WF_KIND.log;
    return `<div class="wf-conn"></div><div class="wf-step"><div class="wf-step-hd" style="background:${meta.color}">
      <span><span class="wf-step-num">${i+2}</span>${meta.label}</span>
      <span class="wf-acts">
        <button title="nach oben" onclick="crmWfMove('${w.id}','${s.id}',-1)">▲</button>
        <button title="nach unten" onclick="crmWfMove('${w.id}','${s.id}',1)">▼</button>
        <button title="bearbeiten" onclick="crmWfEditStep('${w.id}','${s.id}')">✎</button>
        <button title="löschen" onclick="crmWfDelStep('${w.id}','${s.id}')">✕</button>
      </span></div>
      <div class="wf-step-bd"><div class="d">${esc(wfStepSummary(w,s))}</div></div></div>`;
  }).join('');
  const pub=w.status==='published';
  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="wf-ed-top">
      <button class="btn-sm-crm" onclick="crmWfBack()">‹ Zurück</button>
      <input class="wf-name" value="${esc(w.name||'')}" onchange="crmWfRename('${w.id}',this.value)">
      <span class="wf-badge ${pub?'pub':'draft'}">${pub?'Veröffentlicht':'Entwurf'} · v${w.version||1}</span>
      <button class="btn-sm-crm" onclick="crmWfRun('${w.id}')">▶ Testlauf</button>
      <button class="btn-sm-crm" onclick="crmWfSaveDraft('${w.id}')">Als Entwurf speichern</button>
      <button class="btn-sm-crm primary" onclick="crmWfPublish('${w.id}')">Veröffentlichen</button>
    </div>
    <div class="wf-canvas">
      ${trigCard}
      ${stepCards}
      <div class="wf-conn"></div>
      <button class="wf-add" onclick="crmWfAddStep('${w.id}')">＋ Schritt hinzufügen</button>
      <div class="wf-end">Abschlusselement</div>
    </div>
  </div>`;
}
function crmWfRename(id,v){ const w=getWorkflow(id); if(!w) return; w.name=String(v||'').trim()||'Workflow'; saveWorkflow(w); }
function crmWfSetTrigger(id,type){ const w=getWorkflow(id); if(!w) return; w.trigger=Object.assign({},w.trigger,{type}); if(!w.trigger.tree) w.trigger.tree=getTrees()[0].key; saveWorkflow(w); paint(); }
function crmWfSetTriggerTree(id,tree){ const w=getWorkflow(id); if(!w) return; w.trigger=Object.assign({},w.trigger,{tree}); saveWorkflow(w); }
function crmWfSaveDraft(id){ const w=getWorkflow(id); if(!w) return; w.status='draft'; saveWorkflow(w); paint(); toast('Als Entwurf gespeichert ✓','ok'); }
function crmWfPublish(id){ const w=getWorkflow(id); if(!w) return;
  if(!(w.steps||[]).length){ toast('Bitte zuerst mindestens einen Schritt hinzufügen.','err'); return; }
  w.status='published'; w.version=(w.version||1)+1;
  saveWorkflow(w); paint(); toast(`Veröffentlicht ✓ (v${w.version})`,'ok'); }
function crmWfMove(id,sid,dir){ const w=getWorkflow(id); if(!w) return; const a=w.steps||[]; const i=a.findIndex(s=>s.id===sid); if(i<0) return; const j=i+dir; if(j<0||j>=a.length) return; const t=a[i]; a[i]=a[j]; a[j]=t; saveWorkflow(w); paint(); }
function crmWfDelStep(id,sid){ const w=getWorkflow(id); if(!w) return; w.steps=(w.steps||[]).filter(s=>s.id!==sid); saveWorkflow(w); paint(); }
// Schritt-Typ wählen
function crmWfAddStep(id){
  crmOpenModalShell();
  const rows=Object.keys(WF_KIND).map(k=>{ const m=WF_KIND[k];
    return `<button onclick="crmWfAddKind('${id}','${k}')"><span class="dot" style="background:${m.color}"></span>${esc(wfKindNice(k))}</button>`; }).join('');
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">Schritt hinzufügen</h3><div class="wf-kindpick">${rows}</div>
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button></div>`);
}
function wfKindNice(k){ return ({aktion:'Aktion (Aufgabe/Notiz)',bedingung:'Bedingung (Steuerung)',pause:'Pause',benachrichtigung:'Benachrichtigung (E-Mail/Chat)',log:'Log-Nachricht'})[k]||k; }
function crmWfAddKind(id,kind){
  const w=getWorkflow(id); if(!w) return; if(!Array.isArray(w.steps)) w.steps=[];
  const base={ id:newId(), kind };
  if(kind==='aktion'){ base.action='createTask'; base.titel=''; base.team=''; base.text=''; }
  else if(kind==='bedingung'){ base.feld='name'; base.op='enthaelt'; base.wert=''; }
  else if(kind==='pause'){ base.stunden=2; }
  else if(kind==='benachrichtigung'){ base.kanal='email'; base.an=''; base.betreff=''; base.text=''; }
  else if(kind==='log'){ base.text=''; }
  w.steps.push(base); saveWorkflow(w); crmCloseModal(); crmWfEditStep(id, base.id);
}
function crmWfEditStep(id,sid){
  const w=getWorkflow(id); if(!w) return; const s=(w.steps||[]).find(x=>x.id===sid); if(!s) return;
  const tree=(w.trigger&&w.trigger.tree)||'vereine';
  let body='';
  if(s.kind==='aktion'){
    const teamOpts=['<option value="">– kein Team –</option>'].concat(zeTeams().map(t=>`<option ${s.team===t?'selected':''}>${esc(t)}</option>`)).join('');
    body=`<div class="crm-modal-field"><label>Aktion</label><select id="wf-action" onchange="crmWfActionToggle()">
        <option value="createTask" ${s.action!=='addNote'?'selected':''}>Aufgabe am Eintrag erstellen</option>
        <option value="addNote" ${s.action==='addNote'?'selected':''}>Notiz / Log am Eintrag</option></select></div>
      <div id="wf-ct" style="display:${s.action==='addNote'?'none':'block'}">
        <div class="crm-modal-field"><label>Aufgaben-Titel <span style="font-size:11px;color:var(--muted)">[name] = Eintragsname</span></label><input id="wf-titel" value="${esc(s.titel||'')}" placeholder="z. B. Erstkontakt zu [name]"></div>
        <div class="crm-modal-field"><label>Team</label><select id="wf-team">${teamOpts}</select></div>
        <div class="crm-modal-field"><label>Fällig in (Tagen, optional)</label><input id="wf-due" type="number" min="0" value="${esc(s.dueDays||'')}"></div>
      </div>
      <div id="wf-an" style="display:${s.action==='addNote'?'block':'none'}">
        <div class="crm-modal-field"><label>Notiztext</label><textarea id="wf-text" rows="3">${esc(s.text||'')}</textarea></div>
      </div>`;
  } else if(s.kind==='bedingung'){
    body=`<div class="crm-modal-field"><label>Feld</label><select id="wf-feld">${wfFieldOptions(tree, s.feld)}</select></div>
      <div class="crm-modal-field"><label>Vergleich</label><select id="wf-op">${WF_OPS.map(([v,l])=>`<option value="${v}" ${s.op===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="crm-modal-field"><label>Wert</label><input id="wf-wert" value="${esc(s.wert||'')}"></div>
      <div class="small" style="color:var(--muted)">Trifft die Bedingung nicht zu, werden die folgenden Schritte übersprungen.</div>`;
  } else if(s.kind==='pause'){
    body=`<div class="crm-modal-field"><label>Pause (Stunden)</label><input id="wf-stunden" type="number" min="0" value="${esc(s.stunden||0)}"></div>
      <div class="small" style="color:var(--muted)">Wird derzeit protokolliert (echtes zeitgesteuertes Warten benötigt ein Backend).</div>`;
  } else if(s.kind==='benachrichtigung'){
    body=`<div class="crm-modal-field"><label>Kanal</label><select id="wf-kanal"><option value="email" ${s.kanal!=='chat'?'selected':''}>E-Mail</option><option value="chat" ${s.kanal==='chat'?'selected':''}>Chat-Nachricht</option></select></div>
      <div class="crm-modal-field"><label>An (E-Mail/Empfänger)</label><input id="wf-an" value="${esc(s.an||'')}"></div>
      <div class="crm-modal-field"><label>Betreff</label><input id="wf-betreff" value="${esc(s.betreff||'')}"></div>
      <div class="crm-modal-field"><label>Text</label><textarea id="wf-text" rows="3">${esc(s.text||'')}</textarea></div>
      <div class="small" style="color:var(--muted)">Wird beim automatischen Lauf protokolliert; echte Zustellung benötigt ein Backend.</div>`;
  } else if(s.kind==='log'){
    body=`<div class="crm-modal-field"><label>Log-Text</label><textarea id="wf-text" rows="3">${esc(s.text||'')}</textarea></div>`;
  }
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 14px">${esc(WF_KIND[s.kind].label)} bearbeiten</h3>${body}
    <div class="crm-modal-actions"><button class="btn-sm-crm" onclick="crmCloseModal()">Abbrechen</button>
    <button class="btn-sm-crm primary" onclick="crmWfSaveStep('${id}','${sid}')">Übernehmen</button></div>`);
}
function crmWfActionToggle(){ const a=val('wf-action'); const ct=document.getElementById('wf-ct'), an=document.getElementById('wf-an');
  if(ct) ct.style.display=(a==='addNote')?'none':'block'; if(an) an.style.display=(a==='addNote')?'block':'none'; }
function crmWfSaveStep(id,sid){
  const w=getWorkflow(id); if(!w) return; const s=(w.steps||[]).find(x=>x.id===sid); if(!s) return;
  if(s.kind==='aktion'){ s.action=val('wf-action')||'createTask';
    if(s.action==='addNote'){ s.text=val('wf-text'); }
    else { s.titel=val('wf-titel'); s.team=val('wf-team'); s.dueDays=val('wf-due'); } }
  else if(s.kind==='bedingung'){ s.feld=val('wf-feld')||'name'; s.op=val('wf-op')||'enthaelt'; s.wert=val('wf-wert'); }
  else if(s.kind==='pause'){ s.stunden=val('wf-stunden'); }
  else if(s.kind==='benachrichtigung'){ s.kanal=val('wf-kanal')||'email'; s.an=val('wf-an'); s.betreff=val('wf-betreff'); s.text=val('wf-text'); }
  else if(s.kind==='log'){ s.text=val('wf-text'); }
  saveWorkflow(w); crmCloseModal(); paint();
}
// — Ausführung —
function wfFieldVal(ent, field){ if(field==='name'||!field) return (ent.stamm&&ent.stamm.name)||''; return (ent.stamm&&ent.stamm[field])||''; }
function wfCond(s, ent){ const v=String(wfFieldVal(ent, s.feld)).toLowerCase().trim(); const x=String(s.wert||'').toLowerCase().trim();
  switch(s.op||'enthaelt'){ case 'enthaelt': return v.includes(x); case 'gleich': return v===x; case 'nichtleer': return v!==''; case 'leer': return v===''; default: return true; } }
function wfFill(t, ent){ return String(t==null?'':t).replace(/\[name\]/gi, (ent.stamm&&ent.stamm.name)||''); }
function wfDueDate(days){ const n=parseInt(days,10); if(isNaN(n)||n<=0) return ''; const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
// Echte Ausführung (Seiteneffekte) für Auslöser „Eintrag angelegt/geändert".
function wfApply(ent, trigger){
  try{
    const wfs=listWorkflows().filter(w=>w.status==='published' && ((w.trigger&&w.trigger.type)||'')===trigger);
    if(!wfs.length) return;
    let changed=false;
    wfs.forEach(w=>{
      const tr=w.trigger||{};
      if(tr.tree && tr.tree!==ent.tree) return;
      for(const s of (w.steps||[])){
        if(s.kind==='bedingung'){ if(!wfCond(s, ent)) break; continue; }
        if(s.kind==='aktion' && s.action==='addNote'){
          if(!Array.isArray(ent.log)) ent.log=[];
          ent.log.push({ id:newId(), ts:Date.now(), autor:'Workflow: '+(w.name||''), kuerzel:'WF', text:wfFill(s.text||'', ent), summary:'' }); changed=true;
        } else if(s.kind==='aktion'){
          migEntityProjekte(ent);
          if(!ent.projekte.length) ent.projekte.push({ id:newId(), name:'Aufgaben', todos:[], closed:false, createdAt:Date.now() });
          const proj = ent.projekte.find(p=>!p.closed) || ent.projekte[0];
          if(!Array.isArray(proj.todos)) proj.todos=[];
          proj.todos.push({ id:newId(), children:[], teams:s.team?[s.team]:[], text:wfFill(s.titel||'Aufgabe', ent), note:'(automatisch durch Workflow „'+(w.name||'')+'")', assigneeId:'', assigneeName:'', due:wfDueDate(s.dueDays), status:'offen', deps:[] }); changed=true;
        } else if(s.kind==='benachrichtigung' || s.kind==='pause' || s.kind==='log'){
          if(!Array.isArray(ent.log)) ent.log=[];
          const desc = s.kind==='benachrichtigung' ? ((s.kanal==='chat'?'Chat':'E-Mail')+' an '+(s.an||'')+(s.betreff?(': '+s.betreff):''))
                     : (s.kind==='pause' ? ('Pause '+(s.stunden||0)+' h') : (s.text||''));
          ent.log.push({ id:newId(), ts:Date.now(), autor:'Workflow: '+(w.name||''), kuerzel:'WF', text:'⚡ '+desc, summary:'' }); changed=true;
        }
      }
    });
    if(changed) saveEntity(ent.tree, ent);
  }catch(e){ console.warn('Workflow-Ausführung (ignoriert):', e&&e.message); }
}
// Testlauf (Trockenlauf, ohne Seiteneffekte) – zeigt den Ablaufplan.
function crmWfRun(id){
  const w=getWorkflow(id); if(!w) return;
  const tree=(w.trigger&&w.trigger.tree)||'';
  const sample=listEntities(tree)[0]||{ stamm:{name:'(Beispiel)'} , tree};
  const out=[]; out.push('Auslöser: '+wfTriggerLabel((w.trigger&&w.trigger.type)||'manual')+(tree?(' · Baum '+(treeByKey(tree).label)):''));
  out.push('Beispiel-Eintrag: '+((sample.stamm&&sample.stamm.name)||'(keiner vorhanden)'));
  out.push('────────────');
  let stopped=false;
  (w.steps||[]).forEach((s,i)=>{
    if(stopped){ out.push((i+1)+'. übersprungen'); return; }
    if(s.kind==='bedingung'){ const ok=wfCond(s, sample); out.push((i+1)+'. Bedingung: '+wfStepSummary(w,s)+' → '+(ok?'erfüllt':'NICHT erfüllt – Abbruch')); if(!ok) stopped=true; }
    else if(s.kind==='aktion' && s.action==='addNote') out.push((i+1)+'. würde Notiz schreiben: „'+wfFill(s.text||'',sample)+'"');
    else if(s.kind==='aktion') out.push((i+1)+'. würde Aufgabe anlegen: „'+wfFill(s.titel||'',sample)+'"'+(s.team?(' (Team '+s.team+')'):''));
    else if(s.kind==='pause') out.push((i+1)+'. Pause '+(s.stunden||0)+' h (protokolliert)');
    else if(s.kind==='benachrichtigung') out.push((i+1)+'. '+(s.kanal==='chat'?'Chat':'E-Mail')+' an '+(s.an||'?')+' (protokolliert)');
    else if(s.kind==='log') out.push((i+1)+'. Log: '+(s.text||''));
  });
  crmOpenModalShell();
  openModal(`<h3 style="color:var(--primary);margin:0 0 12px">▶ Testlauf (Trockenlauf)</h3>
    <div style="font-family:monospace;font-size:12.5px;white-space:pre-wrap;line-height:1.6;background:#f6f8fb;border:1px solid var(--border);border-radius:8px;padding:12px">${esc(out.join('\n'))}</div>
    <div class="small" style="color:var(--muted);margin-top:8px">Trockenlauf ohne Seiteneffekte. Im Echtbetrieb laufen veröffentlichte Workflows automatisch beim Anlegen eines Eintrags.</div>
    <div class="crm-modal-actions"><button class="btn-sm-crm primary" onclick="crmCloseModal()">Schließen</button></div>`);
}

// ── Window-Registrierung (für inline onclick) ──────────────────────
Object.assign(window, {
  renderCRM, crmSetupModuleBar, renderVerwaltung, crmVerwSetLevel, crmVerwToggleVerein,
  crmRestrictedOpen, crmHistWindow, crmHistReload, crmHistRestore, crmHistToggle,
  _refreshVerwUsers: paintVerwUsers,
  // Import / Export (Excel)
  crmIeSelectAll, crmExportXlsx, crmImportXlsx, crmImpExpModal,
  // CRM-Konfiguration (Bäume & Felder)
  crmCfgTreeEdit, crmCfgTreeSave, crmCfgTreeMove, crmCfgTreeDel,
  crmCfgFieldTree, crmCfgFieldOverride, crmCfgFieldReset,
  crmCfgFieldEdit, crmCfgFieldSave, crmCfgFieldMove, crmCfgFieldDel,
  crmCfgFuncsSave, crmQuickRenameField, crmQuickRenameFunktion,
  crmSwitchTree, crmSearch, crmOpenDetail, crmBackToList, crmCloseModal, crmDetailTab,
  crmSetStatus, crmSetStatusFilter, crmNeuToggle, crmNeuPick, crmNewAufgabeDialog, crmSaveNewAufgabe,
  crmTagSuggest, crmTagPick, crmTagHide,
  crmSearchInput, crmGoEntry, crmGoEntityProj, crmGoTeamProj,
  crmShowMeine, crmOpenMyVerein, crmMeineToggle, crmMeineOpen,
  crmOpenMeinProjekt, crmNewMeinProjekt, crmSaveMeinProjekt,
  crmOpenNew, crmEditStamm, crmSaveStamm, crmDeleteEntity,
  crmAddMember, crmEditMember, crmSaveMember, crmDeleteMember, crmMemberDetail, crmDeleteMemberConfirm,
  crmMfAddRow, crmMfDelRow,
  crmExportContactsVcf, crmImportContactsFile,
  crmAddTermin, crmSaveTermin, crmDeleteTermin,
  crmAddAngebot, crmSaveAngebot, crmDeleteAngebot,
  crmAddKontaktnotiz, crmDeleteKontaktnotiz, crmCloseBoard, crmReopenBoard,
  crmNewEntityProjekt, crmSaveEntityProjekt, crmSelProjekt, crmRenameProjekt, crmSaveProjektName, crmDeleteProjekt,
  // E-Mail-Verteiler
  crmShowVerteiler, crmNewVerteiler, crmEditVerteiler, crmSaveVerteiler, crmDeleteVerteilerC,
  crmVerteilerAddVerein, crmVerteilerAddUser, crmVerteilerMail, crmCopyVerteiler, crmMailKontakte,
  // Veranstaltungen
  crmShowVeranstaltungen, crmOpenVeranstaltung, crmBackToVeranstaltungen, crmNewVeranstaltungForTeam,
  crmNewVeranstaltung, crmEditVeranstaltung, crmSaveVeranstaltung, crmDeleteVeranstaltungC,
  crmCloseVeranstaltung, crmReopenVeranstaltung, crmVaAddTeiln, crmVaRemoveTeiln, crmNewVeranstaltungFor,
  crmAttOpen, crmAttLink, crmAttFile, crmAttDel, crmTeamAtt,
  crmAddStat, crmEditStat, crmSaveStat, crmDeleteStat,
  crmAddFoerderung, crmEditFoerderung, crmSaveFoerderung, crmDeleteFoerderung,
  // Aufgaben (beliebig tief + Abhängigkeiten + Häkchen)
  crmOpenTask, crmAddChild, crmTaskTeamChange, crmSaveTask, crmSaveChild,
  crmDeleteNode, crmToggleDone,
  crmQaKey, crmQuickAddColumn, crmQuickAddChildInline,
  crmApplyVorlagePick, crmApplyVorlage,
  // Kanban-Board
  crmSetTaskView, crmDragStart, crmColDragStart, crmDragOver, crmDropOnColumn, crmToggleHideDone,
  // Team-Ansicht
  crmShowTeams, crmOpenTeam, crmBackToTeams, crmOpenEntryFromTeam,
  crmTeamSetStatus, crmTeamSetAssignee, crmTeamToggleDone, crmTeamAddChild, crmTeamEditNode,
  // Eigenständige Team-Projekte
  crmOpenTeamProjekt, crmBackToTeamProjekte, crmNewTeamProjekt,
  crmEditTeamProjekt, crmSaveTeamProjekt, crmDeleteTeamProjekt, crmCloseProjekt, crmReopenProjekt,
  crmOpenLinkedEntity,
  // Vorlagen (beliebig tief)
  crmOpenVorlagen, crmCreateVorlage, crmEditVorlage, crmVorlageAddItem, crmDeleteVorlage,
  crmVNodeAdd, crmVNodeAddSave, crmVNodeEdit, crmVNodeEditSave, crmVNodeDel, crmVNodeDeps, crmVNodeDepsSave,
  // Kommunikation
  crmOpenNote, crmCancelNote, crmSaveNote, crmDictate, crmSummarizeNote, crmDeleteNote, crmConfigAi
});
