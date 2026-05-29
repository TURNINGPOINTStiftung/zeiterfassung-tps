// ── Core modules ──────────────────────────────────────────────────
import { getUser } from './data.js';
import { _TPS_LOGO } from './config.js';
import { initFirebase, initFirebaseEvents } from './firebase.js';
import { populateLoginDropdown, doLogin, doLogout, initAuthEvents,
         emergencyReset, doEmergencyReset, resetPasswordsOnly } from './auth.js';
import { initApp, switchView, changeMonth, rebuildEmpSelect, onEmpSelect } from './app.js';
import { initZoom, zoomStep, zoomReset } from './zoom.js';
import { openModal, closeModal } from './utils.js';

// ── View modules ───────────────────────────────────────────────────
import { renderZeiterfassung, renderSignature, td_change, td_zuord,
         td_b1bis_change, td_tchange, fmtTimeIn, check10hCarryover, saveCarryover,
         resetCarryover, syncAbsenceToTimesheets, clearAbsenceFromTimesheets,
         syncSickToTimesheets, doSubmit, doRecall, doApprove, doReject,
         doResetToDraft } from './views/zeiterfassung.js';

import { populateUeberYear, populateUeberMon, populateUeberTeam,
         renderOverview, openEmpMonth, openJahresübersicht,
         printJahresübersicht, sendJahresbericht } from './views/uebersicht.js';

import { showVacRequestForm, onVrTypeChange, calcVrDays, saveVacRequest,
         showRejectModal, approveVacRequest, deleteVacRequest, confirmRejectVac,
         updateAbBadge, setAbView, changeAbMonth, renderAbCalendar,
         renderAbwesenheiten } from './views/abwesenheiten.js';

import { getStamp, renderStempelView, _refreshStempelView, _stempelLiveTick,
         updateZeitstempelBtn, openZeitstempel, startZeitstempel,
         cancelZeitstempel, stopZeitstempel } from './views/stempeln.js';

import { renderGFBerichte, viewTeamReport, markReportSeen, viewYearReport,
         markYearReportSeen, sendTeamReport, sendTeamReportForTeam } from './views/gfberichte.js';

import { renderSettings, addTeam, removeTeam, addCustomRole, removeCustomRole,
         addCategory, removeCat, addTeamCat, removeTeamCat,
         showAddUser, showEditUser, showEditDpw, saveEditDpw,
         _resolveUfRole, toggleFreelancerFields, toggleGFTimesheet, deleteUser,
         saveNewUser, saveEditUser } from './views/einstellungen.js';

// ── Utility / print modules ────────────────────────────────────────
import { printFull, printBuchhaltung, printTeamBuchhaltung,
         _openPerEmpPrint, _teamReportStyle, renderBuchhaltungHTML } from './print.js';

import { importHistorical, importHistForUser } from './import-data.js';
import { exportData, importData, resetData,
         showCarryoverCleanup, runCarryoverCleanup } from './data-mgmt.js';
import { openProfileModal, saveProfile, shareApp, _downloadHtml } from './profile.js';
import { getTeams, catOptions, catOptionsFree, getCatsForTeam,
         catOptionsForUser } from './cats.js';

// ══════════════════════════════════════════════════════════════════
// Expose everything to window (for inline onclick handlers in HTML)
// ══════════════════════════════════════════════════════════════════

// Auth
window.populateLoginDropdown = populateLoginDropdown;
window.doLogin               = doLogin;
window.doLogout              = doLogout;
window.emergencyReset        = emergencyReset;
window.doEmergencyReset      = doEmergencyReset;
window.resetPasswordsOnly    = resetPasswordsOnly;

// App navigation
window.initApp          = initApp;
window.switchView       = switchView;
window.changeMonth      = changeMonth;
window.rebuildEmpSelect = rebuildEmpSelect;
window.onEmpSelect      = onEmpSelect;

// Zoom
window.zoomStep  = zoomStep;
window.zoomReset = zoomReset;

// Modal helpers (used by inline onclick="closeModal()")
window.openModal  = openModal;
window.closeModal = closeModal;

// Zeiterfassung view
window.renderZeiterfassung       = renderZeiterfassung;
window.renderSignature           = renderSignature;
window.td_change                 = td_change;
window.td_zuord                  = td_zuord;
window.td_b1bis_change           = td_b1bis_change;
window.td_tchange                = td_tchange;
window.fmtTimeIn                 = fmtTimeIn;
window.check10hCarryover         = check10hCarryover;
window.saveCarryover             = saveCarryover;
window.resetCarryover            = resetCarryover;
window.syncAbsenceToTimesheets   = syncAbsenceToTimesheets;
window.clearAbsenceFromTimesheets= clearAbsenceFromTimesheets;
window.syncSickToTimesheets      = syncSickToTimesheets;
window.doSubmit                  = doSubmit;
window.doRecall                  = doRecall;
window.doApprove                 = doApprove;
window.doReject                  = doReject;
window.doResetToDraft            = doResetToDraft;

// Übersicht view
window.populateUeberYear  = populateUeberYear;
window.populateUeberMon   = populateUeberMon;
window.populateUeberTeam  = populateUeberTeam;
window.renderOverview     = renderOverview;
window.openEmpMonth       = openEmpMonth;
window.openJahresübersicht= openJahresübersicht;
window.printJahresübersicht= printJahresübersicht;
window.sendJahresbericht  = sendJahresbericht;

// Abwesenheiten view
window.showVacRequestForm = showVacRequestForm;
window.onVrTypeChange     = onVrTypeChange;
window.calcVrDays         = calcVrDays;
window.saveVacRequest     = saveVacRequest;
window.showRejectModal    = showRejectModal;
window.approveVacRequest  = approveVacRequest;
window.deleteVacRequest   = deleteVacRequest;
window.confirmRejectVac   = confirmRejectVac;
window.updateAbBadge      = updateAbBadge;
window.setAbView          = setAbView;
window.changeAbMonth      = changeAbMonth;
window.renderAbCalendar   = renderAbCalendar;
window.renderAbwesenheiten= renderAbwesenheiten;

// Stempeln view
window.getStamp            = getStamp;
window.renderStempelView   = renderStempelView;
window._refreshStempelView = _refreshStempelView;
window._stempelLiveTick    = _stempelLiveTick;
window.updateZeitstempelBtn= updateZeitstempelBtn;
window.openZeitstempel     = openZeitstempel;
window.startZeitstempel    = startZeitstempel;
window.cancelZeitstempel   = cancelZeitstempel;
window.stopZeitstempel     = stopZeitstempel;

// GF-Berichte view
window.renderGFBerichte    = renderGFBerichte;
window.viewTeamReport      = viewTeamReport;
window.markReportSeen      = markReportSeen;
window.viewYearReport      = viewYearReport;
window.markYearReportSeen  = markYearReportSeen;
window.sendTeamReport      = sendTeamReport;
window.sendTeamReportForTeam= sendTeamReportForTeam;

// Einstellungen view
window.renderSettings        = renderSettings;
window.addTeam               = addTeam;
window.removeTeam            = removeTeam;
window.addCustomRole         = addCustomRole;
window.removeCustomRole      = removeCustomRole;
window.addCategory           = addCategory;
window.removeCat             = removeCat;
window.addTeamCat            = addTeamCat;
window.removeTeamCat         = removeTeamCat;
window.showAddUser           = showAddUser;
window.showEditUser          = showEditUser;
window.showEditDpw           = showEditDpw;
window.saveEditDpw           = saveEditDpw;
window._resolveUfRole        = _resolveUfRole;
window.toggleFreelancerFields= toggleFreelancerFields;
window.toggleGFTimesheet     = toggleGFTimesheet;
window.deleteUser            = deleteUser;
window.saveNewUser           = saveNewUser;
window.saveEditUser          = saveEditUser;

// Print
window.printFull             = printFull;
window.printBuchhaltung      = printBuchhaltung;
window.printTeamBuchhaltung  = printTeamBuchhaltung;
window._openPerEmpPrint      = _openPerEmpPrint;
window._teamReportStyle      = _teamReportStyle;
window.renderBuchhaltungHTML = renderBuchhaltungHTML;

// Import / data management
window.importHistorical      = importHistorical;
window.importHistForUser     = importHistForUser;
window.exportData            = exportData;
window.importData            = importData;
window.resetData             = resetData;
window.showCarryoverCleanup  = showCarryoverCleanup;
window.runCarryoverCleanup   = runCarryoverCleanup;

// Profile / share
window.openProfileModal  = openProfileModal;
window.saveProfile       = saveProfile;
window.shareApp          = shareApp;
window._downloadHtml     = _downloadHtml;

// Categories / teams (used in some inline contexts)
window.getTeams         = getTeams;
window.catOptions       = catOptions;
window.catOptionsFree   = catOptionsFree;
window.getCatsForTeam   = getCatsForTeam;
window.catOptionsForUser= catOptionsForUser;

// ══════════════════════════════════════════════════════════════════
// Modal close on background click
// ══════════════════════════════════════════════════════════════════
document.getElementById('modal-bg').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-bg')) closeModal();
});

// ══════════════════════════════════════════════════════════════════
// Boot sequence
// ══════════════════════════════════════════════════════════════════

// Logo initialization
['load-logo','login-logo-img','hdr-logo'].forEach(id=>{
  const el=document.getElementById(id); if(el) el.src=_TPS_LOGO;
});

initZoom();
initAuthEvents();

initFirebase().then(function(){
  document.getElementById('fb-loading').style.display='none';
  initFirebaseEvents();

  // Restore saved session (survives F5 reload)
  try{
    const savedUid=localStorage.getItem('tp_zt_session');
    if(savedUid&&getUser(savedUid)){
      window.cu=getUser(savedUid);
      document.getElementById('login-screen').style.display='none';
      document.getElementById('app').classList.add('visible');
      try{ initApp(); }catch(e){ console.error('Auto-Login Fehler:',e); doLogout(); return; }
      try{ updateAbBadge(); }catch(e){}
      return;
    }
  }catch(e){}
  try{ populateLoginDropdown(); }
  catch(e){
    const el=document.getElementById('login-user-list');
    if(el) el.innerHTML='<div style="background:#fdd;border:1px solid red;border-radius:5px;padding:10px;font-size:12px;color:red">Fehler beim Laden: '+e.message+'</div>';
    console.error('Boot-Fehler:',e);
  }
}).catch(function(e){
  console.error('Firebase Verbindungsfehler:',e);
  document.getElementById('fb-loading').innerHTML=
    '<div style="font-size:17px;color:#ff6b6b;font-weight:700">&#9888; Verbindungsfehler</div>'
    +'<div style="font-size:13px;margin-top:10px;opacity:.8">Bitte Seite neu laden.<br><small>'+e.message+'</small></div>';
});

// Service Worker
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  });
}
