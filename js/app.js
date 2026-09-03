import { MONTHS } from './config.js';
import { getUser } from './data.js';
import { isManagerRole, hasPermission, roleLabel } from './roles.js';
import { dailyMinutes } from './calc.js';

// Hat der Nutzer überhaupt IRGENDEINEN Bereich frei? (Modul-Zugriff, Übersicht/GF-Berichte,
// Voll-Verwaltung). FAIL-OPEN: lässt sich der Zugriff nicht bestimmen (CRM-Modul noch nicht
// geladen), gilt „Zugriff" – es wird NIEMALS jemand fälschlich ausgesperrt.
function _hasAnyAccess(cu){
  if(!cu) return true;
  if(cu.role==='admin') return true;
  try{
    const ma = window.crmModuleAccess ? window.crmModuleAccess(cu) : null;
    if(!ma) return true; // Zugriffslogik noch nicht bereit → nicht aussperren
    if(['zeiterfassung','crm','kanban','verteiler','ki','messe','auswertung'].some(k=>ma[k]&&ma[k]!=='kein')) return true;
    if(ma.system==='ja') return true;
  }catch(e){ return true; }
  try{ if(hasPermission('tab_uebersicht',cu)||hasPermission('tab_gfberichte',cu)||hasPermission('zugriff_verwaltung',cu)) return true; }catch(e){}
  return false;
}

// Ist die Zeiterfassung für diesen Nutzer freigeschaltet? Jetzt über den Modul-Zugriff
// (path_zeiterfassung via crmModuleAccess) statt nur über das Legacy-Feld cu.crmOnly.
// FAIL-SAFE: ist die Zugriffslogik noch nicht geladen, greift der bisherige Fallback (!crmOnly),
// damit sich für Bestandsnutzer nichts ändert und niemand fälschlich ausgesperrt wird.
function _zeActive(cu){
  try{
    const ma = window.crmModuleAccess ? window.crmModuleAccess(cu) : null;
    if(ma && ma.zeiterfassung) return ma.zeiterfassung!=='kein';
  }catch(e){}
  return !cu.crmOnly;
}

// Freundlicher „Noch nichts freigeschaltet"-Screen (nur Login + eigenes Profil).
function _showNoAccessScreen(){
  ['module-bar','app-nav'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  const main=document.querySelector('.app-content'); if(main) main.style.display='none';
  ['website','forum','crm','auswertung','verwaltung','ki'].forEach(m=>{ const el=document.getElementById('mod-'+m); if(el) el.style.display='none'; });
  let box=document.getElementById('no-access-screen');
  if(!box){
    box=document.createElement('div'); box.id='no-access-screen';
    box.style.cssText='position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;background:#f5f7fa;z-index:40';
    box.innerHTML='<div style="font-size:44px">👋</div>'
      +'<h2 style="margin:0;color:#203869">Willkommen, <span id="na-name"></span>!</h2>'
      +'<p style="max-width:440px;color:#5a6572;font-size:15px;margin:0;line-height:1.5">Für dich ist aktuell noch <b>kein Bereich freigeschaltet</b>. Bitte wende dich an die Administration, damit deine Zugänge eingerichtet werden.</p>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:6px">'
      +'<button class="btn btn-outline" onclick="openProfileModal()">👤 Mein Profil</button>'
      +'<button class="btn btn-outline" onclick="doLogout()">Abmelden</button></div>';
    (document.getElementById('app')||document.body).appendChild(box);
  }
  const nn=document.getElementById('na-name'); if(nn) nn.textContent=(window.cu&&window.cu.name)||'';
  box.style.display='flex';
}

export function initApp(){
  const cu=window.cu;
  document.getElementById('hdr-name').textContent=cu.name;
  document.getElementById('hdr-role').textContent=roleLabel(cu.role,cu);
  const isMgr=isManagerRole(cu);
  const isAdmin=cu.role==='admin';
  const _showVer=isAdmin||cu.name==='Moritz Kriese';
  var _hv=document.getElementById('hdr-version');
  if(_hv) _hv.textContent=_showVer?'v321':'';
  // Manuelles Aktualisieren (Button im Profil): Cache leeren, SW prüfen, neu laden.
  window.forceAppUpdate=function(){
    Promise.resolve()
      .then(function(){ return ('caches' in window)?caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}):null; })
      .then(function(){ return (navigator.serviceWorker&&navigator.serviceWorker.getRegistrations)?navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.update();}));}):null; })
      .catch(function(){})
      .then(function(){ location.reload(); });
  };
  const isGF=cu.role==='geschaeftsfuehrer';
  const now=new Date();
  window.year=now.getFullYear(); window.mon=now.getMonth()+1;
  window.abCalYear=window.year; window.abCalMon=window.mon;
  window.viewEmpId=cu.id;

  // Evtl. vorherigen Null-Zugriff-Zustand zurücksetzen (Nutzerwechsel ohne Reload).
  try{ const _na=document.getElementById('no-access-screen'); if(_na) _na.style.display='none'; }catch(e){}
  const _mbEl=document.getElementById('module-bar'); if(_mbEl) _mbEl.style.display='flex';
  const _navEl=document.getElementById('app-nav'); if(_navEl) _navEl.style.display='';
  const _mainEl=document.querySelector('.app-content'); if(_mainEl) _mainEl.style.display='';

  // Null-Zugriff: kein einziger Bereich freigeschaltet → freundlicher Hinweis + Profil,
  // statt in einer leeren Zeiterfassung zu stranden.
  if(!_hasAnyAccess(cu)){ _showNoAccessScreen(); return; }

  // Bereits gespeicherte Nachtschichten des eingeloggten Users einmalig erkennen.
  // (Die Erkennung läuft sonst nur bei Zeit-Eingaben – nicht beim Laden.)
  try{ window.rebuildNightShifts?.(cu.id); }catch(e){ console.error('Nachtschicht-Init Fehler:',e); }

  // noTimesheet: ZE komplett weg (GF-Konzept)
  // noReport: ZE bleibt, aber privat — kein Einreichen, GF hat keinen Zugriff (Leitungs-Konzept)
  const gfNoZE=isGF&&!!cu.noTimesheet;
  const crmOnly=!_zeActive(cu);   // „ZE aus" – jetzt über Modul-Zugriff (path_zeiterfassung), nicht mehr nur cu.crmOnly
  const role=cu.role;
  const tabZE=document.querySelector('[data-view="zeiterfassung"]');
  if(tabZE) tabZE.style.display=(isAdmin||gfNoZE||crmOnly)?'none':'';
  document.getElementById('tab-uebersicht').style.display=hasPermission('tab_uebersicht',cu)?'':'none';
  document.getElementById('tab-gfberichte').style.display=hasPermission('tab_gfberichte',cu)?'':'none';
  document.getElementById('tab-vertretungen').style.display=(isGF||isAdmin)?'':'none';
  document.getElementById('tab-abwesenheiten').style.display='';
  document.getElementById('tab-einstellungen').style.display='none'; // Einstellungen sind in die Verwaltung umgezogen
  const btnTeam=document.getElementById('btn-teamberichte');
  if(btnTeam) btnTeam.style.display=hasPermission('btn_teamberichte',cu)?'':'none';
  const hideStempel=isAdmin||gfNoZE||crmOnly||!hasPermission('stempel',cu);
  const btnZs=document.getElementById('btn-zeitstempel');
  if(btnZs) btnZs.style.display=hideStempel?'none':'inline-flex';
  const tabZsMob=document.getElementById('tab-stempeln-mobile');
  if(tabZsMob) tabZsMob.style.display=hideStempel?'none':'';

  if(hasPermission('tab_uebersicht',cu)){
    window.populateUeberYear?.();
    window.populateUeberMon?.();
    window.populateUeberTeam?.();
  }
  window.updateZeitstempelBtn?.();
  if(isAdmin) switchView('uebersicht');
  else if(gfNoZE) switchView(hasPermission('tab_uebersicht',cu)?'uebersicht':'gfberichte');
  else if(hasPermission('tab_gfberichte',cu)&&!hasPermission('tab_uebersicht',cu)) switchView('gfberichte');
  else if(window.innerWidth<=640) switchView('stempeln');
  else switchView('zeiterfassung');

  // Top-Leiste ist jetzt der EINZIGE Header (für alle sichtbar). Welche Module
  // im ☰-Menü erscheinen (und ob das Menü überhaupt nötig ist), steuert das
  // CRM-Modul anhand der Rechte (crmSetupModuleBar).
  const moduleBar=document.getElementById('module-bar');
  if(moduleBar) moduleBar.style.display='flex';
  try{ window.crmSetupModuleBar&&window.crmSetupModuleBar(); }catch(e){ console.error('CRM Modulleiste:',e); }
  // Zuletzt geöffnetes Modul wiederherstellen (sonst landet man nach Reload immer in der ZE).
  let _lastMod='zeiterfassung';
  try{ _lastMod=localStorage.getItem('tp_zt_module')||'zeiterfassung'; }catch(e){}
  const _canVerw = isAdmin || hasPermission('zugriff_verwaltung',cu);
  const _modOk = _lastMod==='zeiterfassung' || _lastMod==='crm' || _lastMod==='kanban' || _lastMod==='verteiler' || (isMgr && (_lastMod==='auswertung'||_lastMod==='ki')) || (isAdmin && (_lastMod==='website'||_lastMod==='forum')) || (_canVerw && _lastMod==='verwaltung');
  // CRM-only-Nutzer landen immer im CRM (Zeiterfassung ist für sie ausgeblendet)
  switchModule(crmOnly ? 'crm' : (_modOk?_lastMod:'zeiterfassung'));
}

const MODULE_LABELS={zeiterfassung:'Zeiterfassung',website:'Website',forum:'Forum',crm:'CRM',kanban:'Projektmanagement',verteiler:'Verteiler',ki:'KI',auswertung:'Auswertung',verwaltung:'Verwaltung'};

// ☰-Dropdown öffnen/schließen
export function toggleModuleMenu(){ const d=document.getElementById('mb-dropdown'); if(d) d.style.display=(d.style.display==='none'||!d.style.display)?'block':'none'; }
export function closeModuleMenu(){ const d=document.getElementById('mb-dropdown'); if(d) d.style.display='none'; }

// Wechsel zwischen Modulen (Zeiterfassung / Website / Forum / CRM / Verwaltung)
export function switchModule(name){
  window._activeModule=name;
  try{ localStorage.setItem('tp_zt_module', name); }catch(e){}
  document.querySelectorAll('.mb-mod').forEach(t=>t.classList.toggle('active',t.dataset.mod===name));
  const cur=document.getElementById('mb-current'); if(cur) cur.textContent=MODULE_LABELS[name]||name;
  const isZE=name==='zeiterfassung';
  const bar=document.getElementById('module-bar'); if(bar) bar.classList.toggle('nonze',!isZE);
  const nav=document.getElementById('app-nav');
  const main=document.querySelector('.app-content');
  if(nav) nav.style.display=isZE?'':'none';
  if(main) main.style.display=isZE?'':'none';
  // Projektmanagement + Verteiler sind eigene ☰-Pfade, nutzen aber denselben #mod-crm-Rahmen (gemeinsame CRM-Engine).
  const frame = (name==='kanban'||name==='verteiler') ? 'crm' : name;
  ['website','forum','crm','auswertung','verwaltung','ki'].forEach(m=>{
    const el=document.getElementById('mod-'+m);
    if(el) el.style.display=(frame===m)?'flex':'none';
  });
  closeModuleMenu();
  // CRM/Kanban/Auswertung/Verwaltung rendern sich selbst (isoliert). In try/catch, damit ein
  // Fehler dort niemals das Umschalten oder die Zeiterfassung beeinträchtigt.
  if(name==='crm'){ try{ window.renderCRM&&window.renderCRM(); }catch(e){ console.error('CRM Render-Fehler (ignoriert):',e); } }
  if(name==='kanban'){ try{ window.renderKanban&&window.renderKanban(); }catch(e){ console.error('Kanban Render-Fehler (ignoriert):',e); } }
  if(name==='verteiler'){ try{ window.renderVerteiler&&window.renderVerteiler(); }catch(e){ console.error('Verteiler Render-Fehler (ignoriert):',e); } }
  if(name==='auswertung'){ try{ window.renderAuswertung&&window.renderAuswertung(); }catch(e){ console.error('Auswertung Render-Fehler (ignoriert):',e); } }
  if(name==='verwaltung'){ try{ window.renderVerwaltung&&window.renderVerwaltung(); }catch(e){ console.error('Verwaltung Render-Fehler (ignoriert):',e); } }
  if(name==='ki'){ try{ window.renderKI&&window.renderKI(); }catch(e){ console.error('KI Render-Fehler (ignoriert):',e); } }
  // Suche/Glocke der oberen Leiste ans aktive Modul angleichen (in CRM-Pfaden füllen, sonst leeren)
  try{ window.crmUpdateTopTools&&window.crmUpdateTopTools(); }catch(e){}
}

export function rebuildEmpSelect(){
  document.getElementById('emp-select-wrap').style.display='none';
  if(!window.viewEmpId||!getUser(window.viewEmpId)) window.viewEmpId=window.cu?window.cu.id:null;
}

export function onEmpSelect(){
  window.viewEmpId=document.getElementById('emp-select').value;
  window.renderZeiterfassung?.();
}

export function switchView(v){
  if(window._zsClockInt){ clearInterval(window._zsClockInt); window._zsClockInt=null; }
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const vEl=document.getElementById('view-'+v); if(vEl) vEl.classList.add('active');
  const tEl=document.querySelector(`[data-view="${v}"]`); if(tEl) tEl.classList.add('active');
  if(v==='zeiterfassung') window.renderZeiterfassung?.();
  if(v==='uebersicht') window.renderOverview?.();
  if(v==='einstellungen') window.renderSettings?.();
  if(v==='gfberichte') window.renderGFBerichte?.();
  if(v==='abwesenheiten') window.renderAbwesenheiten?.();
  if(v==='vertretungen') window.renderVertretungen?.();
  if(v==='stempeln') window.renderStempelView?.();
}

export function changeMonth(delta){
  window.mon+=delta;
  if(window.mon<1){window.mon=12;window.year--;} if(window.mon>12){window.mon=1;window.year++;}
  window.renderZeiterfassung?.();
}
