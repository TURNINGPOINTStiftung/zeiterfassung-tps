import { MONTHS } from './config.js';
import { getUser } from './data.js';
import { isManagerRole, hasPermission, roleLabel } from './roles.js';
import { dailyMinutes } from './calc.js';

export function initApp(){
  const cu=window.cu;
  document.getElementById('hdr-name').textContent=cu.name;
  document.getElementById('hdr-role').textContent=roleLabel(cu.role,cu);
  const isMgr=isManagerRole(cu);
  const isAdmin=cu.role==='admin';
  const _showVer=isAdmin||cu.name==='Moritz Kriese';
  document.getElementById('hdr-version').textContent=_showVer?'Zeiterfassung · v26.05.29b':'Zeiterfassung';
  const isGF=cu.role==='geschaeftsfuehrer';
  const now=new Date();
  window.year=now.getFullYear(); window.mon=now.getMonth()+1;
  window.abCalYear=window.year; window.abCalMon=window.mon;
  window.viewEmpId=cu.id;

  // noTimesheet: ZE komplett weg (GF-Konzept)
  // noReport: ZE bleibt, aber privat — kein Einreichen, GF hat keinen Zugriff (Leitungs-Konzept)
  const gfNoZE=isGF&&!!cu.noTimesheet;
  const role=cu.role;
  const tabZE=document.querySelector('[data-view="zeiterfassung"]');
  if(tabZE) tabZE.style.display=(isAdmin||gfNoZE)?'none':'';
  document.getElementById('tab-uebersicht').style.display=hasPermission('tab_uebersicht',role)?'':'none';
  document.getElementById('tab-gfberichte').style.display=hasPermission('tab_gfberichte',role)?'':'none';
  document.getElementById('tab-abwesenheiten').style.display='';
  document.getElementById('tab-einstellungen').style.display=isAdmin?'':'none';
  const btnTeam=document.getElementById('btn-teamberichte');
  if(btnTeam) btnTeam.style.display=hasPermission('btn_teamberichte',role)?'':'none';
  const hideStempel=isAdmin||gfNoZE||!hasPermission('stempel',role);
  const btnZs=document.getElementById('btn-zeitstempel');
  if(btnZs) btnZs.style.display=hideStempel?'none':'inline-flex';
  const tabZsMob=document.getElementById('tab-stempeln-mobile');
  if(tabZsMob) tabZsMob.style.display=hideStempel?'none':'';

  if(hasPermission('tab_uebersicht',role)){
    window.populateUeberYear?.();
    window.populateUeberMon?.();
    window.populateUeberTeam?.();
  }
  window.updateZeitstempelBtn?.();
  if(isAdmin) switchView('uebersicht');
  else if(gfNoZE) switchView(hasPermission('tab_uebersicht',role)?'uebersicht':'gfberichte');
  else if(hasPermission('tab_gfberichte',role)&&!hasPermission('tab_uebersicht',role)) switchView('gfberichte');
  else if(window.innerWidth<=640) switchView('stempeln');
  else switchView('zeiterfassung');

  // Modul-Navigation nur für Admin
  const moduleBar=document.getElementById('module-bar');
  if(moduleBar) moduleBar.style.display=isAdmin?'flex':'none';
  switchModule('zeiterfassung');
}

// Wechsel zwischen Modulen (Zeiterfassung / Website / Forum / CRM) – Admin
export function switchModule(name){
  window._activeModule=name;
  document.querySelectorAll('.mb-tab').forEach(t=>t.classList.toggle('active',t.dataset.mod===name));
  const isZE=name==='zeiterfassung';
  const hdr=document.querySelector('.app-header');
  const nav=document.getElementById('app-nav');
  const main=document.querySelector('.app-content');
  if(hdr) hdr.style.display=isZE?'':'none';
  if(nav) nav.style.display=isZE?'':'none';
  if(main) main.style.display=isZE?'':'none';
  ['website','forum','crm'].forEach(m=>{
    const el=document.getElementById('mod-'+m);
    if(el) el.style.display=(name===m)?'flex':'none';
  });
  // Website-iframe erst beim ersten Öffnen laden
  if(name==='website'){
    const f=document.getElementById('iframe-website');
    if(f&&f.dataset.src&&f.getAttribute('src')==='about:blank') f.src=f.dataset.src;
  }
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
  if(v==='stempeln') window.renderStempelView?.();
}

export function changeMonth(delta){
  window.mon+=delta;
  if(window.mon<1){window.mon=12;window.year--;} if(window.mon>12){window.mon=1;window.year++;}
  window.renderZeiterfassung?.();
}
