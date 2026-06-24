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
function curContainer(){
  const ctx=window._crmTaskCtx; if(!ctx) return null;
  if(ctx.kind==='teamprojekt'){ const c=getTeamProjekt(ctx.id); if(c) normTasks(c); return c; }
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
      const show={ zeiterfassung:!cu.crmOnly, website:isAdmin, forum:isAdmin, crm:true, verwaltung:isAdmin };
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
  .vw-table{width:100%;border-collapse:collapse;font-size:14px}
  .vw-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);padding:6px 10px;border-bottom:2px solid var(--border);white-space:nowrap}
  .vw-table td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
  .vw-name{font-weight:700;color:var(--primary)}
  .vw-team{display:inline-block;font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:1px 7px;margin:1px 3px 1px 0;color:var(--muted)}
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
  .vw-vpick{display:flex;flex-direction:column;gap:2px;margin-top:6px;max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px}
  .vw-vpick label{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;white-space:nowrap}
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
  const homeActive = (mode==='teams'||mode==='meine');
  const homeLabel  = view ? '👥 Teams' : '🙋 Meine Aufgaben';
  const tabs = [`<button class="crm-tree-tab${homeActive?' active':''}" onclick="crmShowTeams()">${homeLabel}</button>`];
  if(view){
    getTrees().forEach(t=>tabs.push(`<button class="crm-tree-tab${(mode==='kontakte'&&t.key===window._crmTree)?' active':''}" onclick="crmSwitchTree('${t.key}')">${esc(t.icon||'')} ${esc(t.label)}</button>`));
    tabs.push(`<button class="crm-tree-tab${mode==='verteiler'?' active':''}" onclick="crmShowVerteiler()">✉️ Verteiler</button>`);
  } else if(lvl==='verein'){
    accessVereine().forEach(vid=>{ const ve=getEntity('vereine',vid); if(!ve) return; const nm=(ve.stamm&&ve.stamm.name)||'Verein';
      tabs.push(`<button class="crm-tree-tab${(mode==='kontakte'&&window._crmSelId===vid)?' active':''}" onclick="crmRestrictedOpen('${vid}')">🏛️ ${esc(nm)}</button>`); });
  }
  let right = '';
  if(view && mode==='kontakte'){
    right = `<input class="crm-search" type="search" placeholder="Suchen …" value="${esc(window._crmSearch||'')}" oninput="crmSearch(this.value)">
      ${full?`<button class="btn-sm-crm primary" onclick="crmOpenNew()">＋<span class="btn-lbl"> Neu</span></button>`:''}`;
  } else {
    right = `<span style="margin-left:auto"></span>`;
  }
  const adminBtns = full
    ? `<button class="btn-sm-crm" title="Aufgaben-Vorlagen verwalten" onclick="crmOpenVorlagen()">📋<span class="btn-lbl"> Vorlagen</span></button>
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
      const hay=[s.name,s.adresse,s.sitz,s.tags,s.email].map(x=>String(x||'').toLowerCase()).join(' ');
      const ctxt=(e.kontakte||[]).map(k=>k.name+' '+k.funktion).join(' ').toLowerCase();
      return (hay+' '+ctxt).includes(q);
    });
  }
  const cards = items.map(e=>{
    const s=e.stamm||{};
    const openTodos=entityOpenTaskCount(e);
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
  return e;
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
    ${attachChips(n)}
    <div class="kb-cardbtns">
      <button class="kb-additem" onclick="event.stopPropagation();crmAddChild('${n.id}')">＋ Schritt</button>
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
      <button class="kb-add" onclick="crmAddChild('${top.id}')">＋ Aufgabe</button>
    </div>`;
  }).join('');
  return `<div class="kb-board">${cols}
    <div class="kb-col kb-col-new" ondragover="crmDragOver(event)" ondrop="crmDropOnColumn(event,'__end__')"><button class="kb-add" onclick="crmOpenTask('')">＋ Spalte</button></div>
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

  const fields = stammFields(window._crmTree)
    .filter(f=>f.key!=='name')
    .map(f=>{ const v=s[f.key]; if(!v) return ''; const disp=f.type==='date'?esc(fmtDate(Date.parse(v))):linkify(v); return `<div class="crm-field"><label>${esc(f.label)}</label><div class="v">${disp}</div></div>`; })
    .filter(Boolean).join('');

  const kontakte=(e.kontakte||[]).map(k=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(k.name)}</span>${k.funktion?` <span class="fn">${esc(k.funktion)}</span>`:''}
        ${(k.email||k.tel)?`<div class="small crm-contact">${[
            k.email?`<a href="${mailHref(k.email)}" class="crm-mail">✉️ ${esc(k.email)}</a>`:'',
            k.tel?`<a href="${telHref(k.tel)}" class="crm-tel">📞 ${esc(k.tel)}</a>`:''
          ].filter(Boolean).join('<span class="sep">·</span>')}</div>`:''}
        ${k.note?`<div class="small">${linkify(k.note)}</div>`:''}
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

  const angebote=(e.angebote||[]).map(a=>`
    <div class="crm-row">
      <div class="grow"><span class="name">${esc(a.titel)}</span>${a.note?`<div class="small">${linkify(a.note)}</div>`:''}</div>
      <button class="crm-x" title="Entfernen" onclick="crmDeleteAngebot('${a.id}')">✕</button>
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Keine Angebote.</div>`;

  const projekteHtml = entityProjekteSectionHtml(e);

  const log=(e.log||[]).slice().sort((a,b)=>b.ts-a.ts).map(l=>`
    <div class="crm-logitem">
      <div class="lh"><span>${esc(l.autor||'')}${l.kuerzel?` <strong>[${esc(l.kuerzel)}]</strong>`:''}</span><span>${fmtDateTime(l.ts)} <button class="crm-x" onclick="crmDeleteNote('${l.id}')">✕</button></span></div>
      <div class="lt">${linkify(l.text||'')}</div>
      ${l.summary?`<div class="ls"><strong>KI-Zusammenfassung:</strong><br>${linkify(l.summary)}</div>`:''}
    </div>`).join('') || `<div class="small" style="color:var(--muted)">Noch keine Notizen.</div>`;

  // Statistik (nur bei Vereinen)
  const statsSec = (window._crmTree==='vereine') ? statsSecHtml(e) : '';

  root.innerHTML = barHtml() + `<div class="crm-body">
    <div class="crm-detail-head">
      <button class="btn-sm-crm" onclick="crmBackToList()">← ${crmCanView()?esc(tree.label):'Meine Aufgaben'}</button>
      <h2>${esc(s.name||'(ohne Name)')}</h2>
      ${(crmFull()||crmRestricted())?`<button class="btn-sm-crm" onclick="crmEditStamm()">✎ Stammdaten</button>`:''}
      ${crmFull()?`<button class="btn-sm-crm danger" onclick="crmDeleteEntity()">Löschen</button>`:''}
    </div>
    ${(e.createdAt||e.updatedByKuerzel)?`<div class="small" style="color:var(--muted);margin:-8px 0 14px">${
        e.createdAt?`angelegt ${e.createdByKuerzel?'von '+esc(e.createdByKuerzel)+' ':''}am ${esc(fmtDate(e.createdAt))}`:''
      }${e.updatedByKuerzel?` · zuletzt geändert von ${esc(e.updatedByKuerzel)}${e.updatedAt?' am '+esc(fmtDateTime(e.updatedAt)):''}`:''}</div>`:''}

    ${fields?`<div class="crm-sec"><h4><span class="ttl">📋 Stammdaten</span></h4><div class="crm-fields">${fields}</div></div>`:''}

    <div class="crm-sec">
      <h4><span class="ttl">👥 Kontakte / Mitglieder</span><span class="hbtns">${(e.kontakte||[]).some(k=>k.email)?`<button class="btn-sm-crm" title="Mail an alle Kontakte (BCC)" onclick="crmMailKontakte()">✉️ Mail an alle</button>`:''}<button class="btn-sm-crm" onclick="crmAddMember()">＋ Kontakt</button></span></h4>
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

    ${projekteHtml}

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
function crmBackToList(){ window._crmSelId=null; if(crmCanView()) paintList(); else { window._crmMode='meine'; paintMeine(); } }
function crmShowMeine(){ crmShowTeams(); }   /* „Meine Aufgaben" ist in die Teams-Ansicht integriert */
function crmOpenMyVerein(){ window._crmMode='kontakte'; window._crmTree='vereine'; window._crmSelId=accessVerein(); paintDetail(); }
// Restriktiver Nutzer öffnet einen seiner zugeordneten Vereine
function crmRestrictedOpen(vid){ window._crmMode='kontakte'; window._crmTree='vereine'; window._crmSelId=vid; paintDetail(); }

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
  const opts=memberFunctions().map(f=>`<option ${k.funktion===f?'selected':''}>${esc(f)}</option>`).join('');
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
    : (openP.length ? '' : `<div class="small" style="color:var(--muted)">Noch keine Projekte. Lege das erste an${closedP.length?' – oder öffne unten ein abgeschlossenes':''}.</div>`);
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
    inheritTeam:isTPCtx()?(e.team?[e.team]:[]):effectiveTeams(e, parentId),
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
  if(isTop && !isTPCtx()) rec.teams=Array.from(document.querySelectorAll('.crm-task-team-cb:checked')).map(x=>x.value);  // mehrere Teams je Top-Aufgabe
  return rec;
}
function crmSaveTask(tid){  // neue Hauptaufgabe (tid='') oder Bearbeiten
  const e=curContainer(); if(!e) return;
  let isTop=true; if(tid){ const f=findNode(e,tid); if(f) isTop=(f.parent===null); }
  const rec=_readNodeForm(e, isTop); if(!rec) return;
  mutateContainer(en=>{
    if(!Array.isArray(en.todos)) en.todos=[];
    if(tid){ const f=findNode(en, tid); if(f){ Object.assign(f.node, rec); if(!Array.isArray(f.node.children)) f.node.children=[]; } }
    else { en.todos.push({ id:newId(), children:[], teams: isTPCtx()?[]:(rec.teams||[]), ...rec }); }
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
    if(depth===0) node.teams = isTPCtx()?[]:(n.team?[n.team]:[]);
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
// Zählung (alle Ebenen) für die Team-Kacheln
function teamCounts(team){
  let total=0, open=0;
  teamMainTasks(team).forEach(x=>{
    flatTasks({ todos:[x.main] }).forEach(t=>{ total++; if(t.status!=='erledigt') open++; });
  });
  return { total, open };
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
    <div class="meta"><span class="crm-chip">${total} Aufgabe${total===1?'':'n'}</span>${open?`<span class="crm-chip warn">${open} offen</span>`:''}</div>
  </div>`;
}
function paintTeamsList(){
  const root=document.getElementById('crm-root'); if(!root) return;
  window._crmTaskCtx=null;
  // „Meine Aufgaben" oben – für alle
  const meine = meineSectionsHtml();
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
      <div class="small" style="color:var(--muted);margin-top:10px">Aufgaben werden an den Einträgen angelegt und hier nach Team gesammelt.</div>
    </div>`;
  }
  root.innerHTML = barHtml() + `<div class="crm-body">${meine}${teamsBlock}</div>`;
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
  // Team-Aufgaben als Board: Spalte = Eintrag, Karte = team-zugeordnete Hauptaufgabe
  const teamKbCard=(g,n)=>{
    const st=taskStatusByKey(n.status);
    const kids=n.children||[];
    const done=kids.filter(k=>k.status==='erledigt').length;
    const cdone=n.status==='erledigt';
    const visKids=_hideDone()?kids.filter(k=>k.status!=='erledigt'):kids;
    const checklist=visKids.map(k=>{
      const kd=k.status==='erledigt';
      return `<div class="kb-check${kd?' done':''}" onclick="event.stopPropagation()">
        <input type="checkbox" ${kd?'checked':''} onchange="crmTeamToggleDone('${g.tree}','${g.eid}','${k.id}')">
        <span class="kb-check-tx" onclick="crmTeamEditNode('${g.tree}','${g.eid}','${k.id}')">${esc(k.text)}</span>
        ${(k.children&&k.children.length)?`<span class="crm-prog">${k.children.filter(x=>x.status==='erledigt').length}/${k.children.length}</span>`:''}
      </div>`;
    }).join('');
    return `<div class="kb-card${cdone?' done':''}">
      <div class="kb-card-top">
        <input type="checkbox" ${cdone?'checked':''} onclick="event.stopPropagation()" onchange="crmTeamToggleDone('${g.tree}','${g.eid}','${n.id}')">
        <span class="kb-card-title" onclick="crmTeamEditNode('${g.tree}','${g.eid}','${n.id}')">${esc(n.text)}</span>
      </div>
      ${n.note?`<div class="kb-card-note">${linkify(n.note)}</div>`:''}
      ${(n.assigneeName||n.due||kids.length)?`<div class="kb-card-meta">
        <span class="crm-tstatus" style="background:${st.color}">${esc(st.label)}</span>
        ${kids.length?`<span class="crm-prog">✓ ${done}/${kids.length}</span>`:''}
        ${n.assigneeName?`<span class="kb-chip">👤 ${esc(n.assigneeName)}</span>`:''}
        ${n.due?`<span class="kb-chip">📅 ${esc(fmtDate(Date.parse(n.due)))}</span>`:''}
      </div>`:''}
      ${checklist?`<div class="kb-checklist">${checklist}</div>`:''}
      ${attachChips(n)}
      <div class="kb-cardbtns">
        <button class="kb-additem" onclick="event.stopPropagation();crmTeamAddChild('${g.tree}','${g.eid}','${n.id}')">＋ Schritt</button>
        <button class="kb-additem" onclick="event.stopPropagation();crmTeamAtt('${g.tree}','${g.eid}','${n.id}')">📎 Anlage${(n.attachments&&n.attachments.length)?' ('+n.attachments.length+')':''}</button>
      </div>
    </div>`;
  };
  const blocks=`<div class="kb-board">${groups.map(g=>{
    const tr=treeByKey(g.tree);
    const mains=_hideDone()?g.mains.filter(m=>m.status!=='erledigt'):g.mains;
    const cards=mains.map(m=>teamKbCard(g,m)).join('');
    return `<div class="kb-col">
      <div class="kb-col-head"><span class="kb-col-title" onclick="crmOpenEntryFromTeam('${g.tree}','${g.eid}')">${tr.icon} ${esc(g.ename)}</span></div>
      <div class="kb-cards">${cards}</div>
    </div>`;
  }).join('')}</div>`;
  // Eigenständige Team-Projekte (persönliche ausschließen), offen + abgeschlossen getrennt
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
    ${projektSec}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:18px 0 10px">
      <span style="font-size:13px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.5px">📋 Aufgaben aus Einträgen</span>
      <button class="btn-sm-crm" onclick="crmToggleHideDone()">${window._crmHideDone?'👁 Erledigte zeigen':'✓ Erledigte ausblenden'}</button>
    </div>
    ${ rel.length ? blocks : `<div class="small" style="color:var(--muted)">Diesem Team sind noch keine Aufgaben aus Einträgen zugeordnet.</div>` }
  </div>`;
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
  // 1) Mir zugewiesene Aufgaben (über alle Einträge und Projekte)
  const assigned=[];
  getTrees().forEach(tr=>{ listEntities(tr.key).forEach(e=>{ migEntityProjekte(e); e.projekte.forEach(p=>{ if(p.closed) return; flatNodes(p.todos).forEach(x=>{ if(x.ref.assigneeId===me) assigned.push({kind:'entity',tree:tr.key,id:e.id,name:(e.stamm&&e.stamm.name)||'(ohne Name)',node:x.ref}); }); }); }); });
  listTeamProjekte().forEach(p=>{ if(p.closed) return; normTasks(p); flatNodes(p.todos).forEach(x=>{ if(x.ref.assigneeId===me) assigned.push({kind:'teamprojekt',id:p.id,name:p.name||'(Projekt)',node:x.ref}); }); });
  assigned.sort((a,b)=> String(a.node.due||'9999').localeCompare(String(b.node.due||'9999')) );
  const arows = assigned.map(a=>{
    const t=a.node; const st=taskStatusByKey(t.status); const done=t.status==='erledigt';
    const meta=[(a.kind==='teamprojekt'?'📂 ':'📇 ')+a.name, t.due?('📅 '+fmtDate(Date.parse(t.due))):''].filter(Boolean).map(esc).join(' · ');
    const idArg=a.kind==='entity'?a.tree:''; const cArg=a.id;
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
  const emails=(e.kontakte||[]).map(k=>k.email).filter(Boolean);
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
  const emails=(e.kontakte||[]).map(k=>k.email).filter(Boolean);
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
  if((prev.statusQuo||'')!==(cur.statusQuo||'')) parts.push('Status quo geändert');
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
  host.innerHTML=`<div class="crm-sec">
    <h4><span class="ttl">🕘 Änderungs-Verlauf & Wiederherstellung</span>
      <span class="hbtns">
        <button class="btn-sm-crm${winH===48?' primary':''}" onclick="crmHistWindow(48)">48 Std.</button>
        <button class="btn-sm-crm${winH===168?' primary':''}" onclick="crmHistWindow(168)">7 Tage</button>
        <button class="btn-sm-crm" title="Neu laden" onclick="crmHistReload()">↻</button>
      </span>
    </h4>
    <div class="small" style="color:var(--muted);margin-bottom:10px">Jede inhaltliche Änderung (anlegen / ändern / löschen) der letzten ${winH===48?'48 Stunden':'7 Tage'} – mit Person und Zeit. <b>Wiederherstellen</b> spielt diesen Stand wieder ein (bei Gelöschtem wird der Eintrag neu angelegt; bei Geändertem auf diese Version zurückgesetzt). Verlauf wird nach 7 Tagen automatisch bereinigt.</div>
    <div id="hist-list" class="small" style="color:var(--muted)">Lade …</div>
  </div>`;
  listHistory(winH*36e5).then(rows=>{ window._histRows=rows; const el=document.getElementById('hist-list'); if(el) el.innerHTML=histRowsHtml(rows); });
}
function crmHistWindow(h){ window._histWinH=h; paintVerwHistory(); }
function crmHistReload(){ paintVerwHistory(); }
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

// ── Window-Registrierung (für inline onclick) ──────────────────────
Object.assign(window, {
  renderCRM, crmSetupModuleBar, renderVerwaltung, crmVerwSetLevel, crmVerwToggleVerein,
  crmRestrictedOpen, crmHistWindow, crmHistReload, crmHistRestore,
  _refreshVerwUsers: paintVerwUsers,
  // CRM-Konfiguration (Bäume & Felder)
  crmCfgTreeEdit, crmCfgTreeSave, crmCfgTreeMove, crmCfgTreeDel,
  crmCfgFieldTree, crmCfgFieldOverride, crmCfgFieldReset,
  crmCfgFieldEdit, crmCfgFieldSave, crmCfgFieldMove, crmCfgFieldDel,
  crmCfgFuncsSave,
  crmSwitchTree, crmSearch, crmOpenDetail, crmBackToList, crmCloseModal,
  crmShowMeine, crmOpenMyVerein, crmMeineToggle, crmMeineOpen,
  crmOpenMeinProjekt, crmNewMeinProjekt, crmSaveMeinProjekt,
  crmOpenNew, crmEditStamm, crmSaveStamm, crmDeleteEntity,
  crmAddMember, crmEditMember, crmSaveMember, crmDeleteMember,
  crmAddTermin, crmSaveTermin, crmDeleteTermin,
  crmAddAngebot, crmSaveAngebot, crmDeleteAngebot,
  crmSaveStatusQuo, crmCloseBoard, crmReopenBoard,
  crmNewEntityProjekt, crmSaveEntityProjekt, crmSelProjekt, crmRenameProjekt, crmSaveProjektName, crmDeleteProjekt,
  // E-Mail-Verteiler
  crmShowVerteiler, crmNewVerteiler, crmEditVerteiler, crmSaveVerteiler, crmDeleteVerteilerC,
  crmVerteilerAddVerein, crmVerteilerAddUser, crmVerteilerMail, crmCopyVerteiler, crmMailKontakte,
  crmAttOpen, crmAttLink, crmAttFile, crmAttDel, crmTeamAtt,
  crmAddStat, crmSaveStat, crmDeleteStat,
  // Aufgaben (beliebig tief + Abhängigkeiten + Häkchen)
  crmOpenTask, crmAddChild, crmTaskTeamChange, crmSaveTask, crmSaveChild,
  crmDeleteNode, crmToggleDone,
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
