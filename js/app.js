import { MONTHS } from './config.js';
import { getUser } from './data.js';
import { isManagerRole } from './roles.js';
import { roleLabel } from './roles.js';
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

  const isLeitung=cu.role==='leitung';
  const gfNoZE=isGF&&!!cu.noTimesheet;
  const tabZE=document.querySelector('[data-view="zeiterfassung"]');
  if(tabZE) tabZE.style.display=(isAdmin||gfNoZE)?'none':'';
  document.getElementById('tab-uebersicht').style.display=(isLeitung||isAdmin)?'':'none';
  document.getElementById('tab-gfberichte').style.display=(isGF||isAdmin)?'':'none';
  document.getElementById('tab-abwesenheiten').style.display='';
  document.getElementById('tab-einstellungen').style.display=isAdmin?'':'none';
  const btnTeam=document.getElementById('btn-teamberichte');
  if(btnTeam) btnTeam.style.display=isLeitung?'':'none';
  const hideStempel=isAdmin||gfNoZE;
  const btnZs=document.getElementById('btn-zeitstempel');
  if(btnZs) btnZs.style.display=hideStempel?'none':'inline-flex';
  const tabZsMob=document.getElementById('tab-stempeln-mobile');
  if(tabZsMob) tabZsMob.style.display=hideStempel?'none':'';

  if(isLeitung||isAdmin){
    window.populateUeberYear?.();
    window.populateUeberMon?.();
    window.populateUeberTeam?.();
  }
  window.updateZeitstempelBtn?.();
  if(isAdmin) switchView('uebersicht');
  else if(isGF||gfNoZE) switchView('gfberichte');
  else if(window.innerWidth<=640) switchView('stempeln');
  else switchView('zeiterfassung');
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
