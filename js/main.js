// ── Core modules ──────────────────────────────────────────────────
import { getUser } from './data.js';
import { _TPS_LOGO, EMAILJS_PUBLIC_KEY } from './config.js';
import { initFirebase, initFirebaseEvents } from './firebase.js';
import { populateLoginDropdown, doLogin, doLogout, initAuthEvents,
         emergencyReset, doEmergencyReset, resetPasswordsOnly,
         showForgotPassword, sendPasswordReset,
         checkPasswordResetToken, saveResetPassword,
         filterLoginUsers, hideLoginDropdown, selectLoginUser,
         loginKeyNav } from './auth.js';
import { initApp, switchView, switchModule, changeMonth, rebuildEmpSelect, onEmpSelect,
         toggleModuleMenu, closeModuleMenu } from './app.js';
import { initZoom, zoomStep, zoomReset } from './zoom.js';
import { openModal, closeModal } from './utils.js';

// ── View modules ───────────────────────────────────────────────────
import { renderZeiterfassung, renderSignature, td_change, td_zuord,
         td_b1bis_change, td_tchange, fmtTimeIn, focusNextTInp, ztNav, saveCarryover,
         resetCarryover, syncAbsenceToTimesheets, clearAbsenceFromTimesheets,
         syncSickToTimesheets, syncVeranstaltungToTimesheets, doSubmit, doRecall, doApprove, doReject,
         doResetToDraft, rebuildAutoAbsences, rebuildNightShifts, toggleJahresverlauf } from './views/zeiterfassung.js';

import { populateUeberYear, populateUeberMon, populateUeberTeam,
         renderOverview, openEmpMonth, openJahresübersicht,
         printJahresübersicht, sendJahresbericht, recallYearReport,
         sendTimesheetReminders } from './views/uebersicht.js';

import { showVacRequestForm, onVrTypeChange, calcVrDays, onVrManualDaysInput, saveVacRequest, renderVADays, fillVADays,
         showRejectModal, approveVacRequest, deleteVacRequest, confirmRejectVac,
         updateAbBadge, setAbView, setAbSubView, changeAbNav, changeAbMonth,
         renderAbCalendar, renderAbCalendarWeek, renderAbCalendarYear,
         renderAbwesenheiten } from './views/abwesenheiten.js';

import { getStamp, renderStempelView, _refreshStempelView, _stempelLiveTick,
         updateZeitstempelBtn, openZeitstempel, startZeitstempel,
         cancelZeitstempel, stopZeitstempel,
         syncStempelVon, startZeitstempelAt } from './views/stempeln.js';

import { renderGFBerichte, viewTeamReport, markReportSeen, viewYearReport, deleteGfReport,
         markYearReportSeen, sendTeamReport, sendTeamReportForTeam, recallTeamReport } from './views/gfberichte.js';

import { renderSettings, addTeam, removeTeam, addCustomRole, removeCustomRole, savePermission,
         addTeamHistEntry, updateTeamHistEntry, deleteTeamHistEntry,
         addCategory, removeCat, addTeamCat, removeTeamCat, moveTeamCat,
         showAddUser, showEditUser, showEditDpw, saveEditDpw,
         _resolveUfRole, toggleFreelancerFields, toggleWerkstudentFields, toggleGFTimesheet, toggleLeitungReport, deleteUser,
         saveNewUser, saveEditUser, fixApproverToLeitung } from './views/einstellungen.js';

// ── Utility / print modules ────────────────────────────────────────
import { printFull, printBuchhaltung, printTeamBuchhaltung,
         _openPerEmpPrint, _teamReportStyle, renderBuchhaltungHTML } from './print.js';

import { importHistorical, importHistForUser } from './import-data.js';
import { exportData, importData, resetData,
         showCarryoverCleanup, runCarryoverCleanup,
         showPauseMigration, runPauseMigration, fixManualCarryovers } from './data-mgmt.js';
import { openProfileModal, saveProfile, shareApp, _downloadHtml } from './profile.js';
import { getTeams, catOptions, catOptionsFree, getCatsForTeam,
         catOptionsForUser } from './cats.js';

// ── CRM-Modul (isoliert, self-registriert window.renderCRM & co.) ──
// Nur als Seiteneffekt importiert. Komplett unabhängig von der
// Zeiterfassung (eigener Firebase-Ref, eigener Cache, Lazy-Init).
import './crm/crm.js';
import './crm/auswertung.js';

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
window.showForgotPassword      = showForgotPassword;
window.sendPasswordReset       = sendPasswordReset;
window.checkPasswordResetToken = checkPasswordResetToken;
window.saveResetPassword       = saveResetPassword;
window.filterLoginUsers        = filterLoginUsers;
window.hideLoginDropdown       = hideLoginDropdown;
window.selectLoginUser         = selectLoginUser;
window.loginKeyNav             = loginKeyNav;

// App navigation
window.initApp          = initApp;
window.switchView       = switchView;
window.switchModule     = switchModule;
window.toggleModuleMenu = toggleModuleMenu;
window.closeModuleMenu  = closeModuleMenu;
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
window.focusNextTInp             = focusNextTInp;
window.ztNav                     = ztNav;
window.saveCarryover             = saveCarryover;
window.resetCarryover            = resetCarryover;
window.syncAbsenceToTimesheets   = syncAbsenceToTimesheets;
window.clearAbsenceFromTimesheets= clearAbsenceFromTimesheets;
window.rebuildAutoAbsences       = rebuildAutoAbsences;
window.rebuildNightShifts        = rebuildNightShifts;
window.syncSickToTimesheets      = syncSickToTimesheets;
window.syncVeranstaltungToTimesheets = syncVeranstaltungToTimesheets;
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
window.sendJahresbericht      = sendJahresbericht;
window.recallYearReport       = recallYearReport;
window.sendTimesheetReminders = sendTimesheetReminders;

// Abwesenheiten view
window.showVacRequestForm = showVacRequestForm;
window.onVrTypeChange     = onVrTypeChange;
window.calcVrDays         = calcVrDays;
window.onVrManualDaysInput = onVrManualDaysInput;
window.saveVacRequest     = saveVacRequest;
window.renderVADays       = renderVADays;
window.fillVADays         = fillVADays;
window.showRejectModal    = showRejectModal;
window.approveVacRequest  = approveVacRequest;
window.deleteVacRequest   = deleteVacRequest;
window.confirmRejectVac   = confirmRejectVac;
window.updateAbBadge         = updateAbBadge;
window.setAbView             = setAbView;
window.setAbSubView          = setAbSubView;
window.changeAbNav           = changeAbNav;
window.changeAbMonth         = changeAbMonth;
window.renderAbCalendar      = renderAbCalendar;
window.renderAbCalendarWeek  = renderAbCalendarWeek;
window.renderAbCalendarYear  = renderAbCalendarYear;
window.renderAbwesenheiten   = renderAbwesenheiten;

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
window.syncStempelVon      = syncStempelVon;
window.startZeitstempelAt  = startZeitstempelAt;

// GF-Berichte view
window.renderGFBerichte    = renderGFBerichte;
window.viewTeamReport      = viewTeamReport;
window.deleteGfReport      = deleteGfReport;
window.markReportSeen      = markReportSeen;
window.viewYearReport      = viewYearReport;
window.markYearReportSeen  = markYearReportSeen;
window.sendTeamReport      = sendTeamReport;
window.sendTeamReportForTeam= sendTeamReportForTeam;
window.recallTeamReport    = recallTeamReport;

// Einstellungen view
window.renderSettings        = renderSettings;
window.savePermission        = savePermission;
window.addTeamHistEntry      = addTeamHistEntry;
window.updateTeamHistEntry   = updateTeamHistEntry;
window.deleteTeamHistEntry   = deleteTeamHistEntry;
window.addTeam               = addTeam;
window.removeTeam            = removeTeam;
window.addCustomRole         = addCustomRole;
window.removeCustomRole      = removeCustomRole;
window.addCategory           = addCategory;
window.removeCat             = removeCat;
window.addTeamCat            = addTeamCat;
window.removeTeamCat         = removeTeamCat;
window.moveTeamCat           = moveTeamCat;
window.showAddUser           = showAddUser;
window.showEditUser          = showEditUser;
window.showEditDpw           = showEditDpw;
window.saveEditDpw           = saveEditDpw;
window._resolveUfRole        = _resolveUfRole;
window.toggleFreelancerFields= toggleFreelancerFields;
window.toggleWerkstudentFields= toggleWerkstudentFields;
window.toggleGFTimesheet     = toggleGFTimesheet;
window.toggleLeitungReport   = toggleLeitungReport;
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
window.fixApproverToLeitung  = fixApproverToLeitung;
window.runCarryoverCleanup   = runCarryoverCleanup;
window.fixManualCarryovers   = fixManualCarryovers;
window.showPauseMigration    = showPauseMigration;
window.runPauseMigration     = runPauseMigration;

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

// ☰-Modul-Dropdown bei Klick außerhalb schließen
document.addEventListener('click',e=>{
  const wrap=document.querySelector('.mb-menu-wrap');
  if(wrap && !wrap.contains(e.target)) closeModuleMenu();
});

// Aufgeschobenes Neu-Rendern nachholen, sobald der Nutzer die Zeiterfassungs-
// Felder verlässt (Sync-Render wird während des Tippens unterdrückt).
document.addEventListener('focusout',e=>{
  if(!window._ztRenderPending) return;
  if(e.target&&e.target.closest&&e.target.closest('#zt')){
    setTimeout(()=>{
      const ae=document.activeElement;
      const stillTyping=ae&&ae.closest&&ae.closest('#zt')&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
      if(!stillTyping&&window._ztRenderPending){
        window._ztRenderPending=false;
        const vze=document.getElementById('view-zeiterfassung');
        if(vze&&vze.classList.contains('active')) window.renderZeiterfassung?.();
      }
    },150);
  }
});

// ══════════════════════════════════════════════════════════════════
// Boot sequence
// ══════════════════════════════════════════════════════════════════

// EmailJS v4 initialisieren (Public Key) – nötig für Passwort-Reset & Erinnerungen
try{ if(window.emailjs&&EMAILJS_PUBLIC_KEY) window.emailjs.init({publicKey:EMAILJS_PUBLIC_KEY}); }catch(e){ console.warn('EmailJS init:',e); }

// Logo initialization
['load-logo','login-logo-img','hdr-logo','mb-logo'].forEach(id=>{
  const el=document.getElementById(id); if(el) el.src=_TPS_LOGO;
});

initZoom();
initAuthEvents();

initFirebase().then(function(){
  document.getElementById('fb-loading').style.display='none';
  initFirebaseEvents();
  checkPasswordResetToken();

  // Einmaliges erzwungenes Neu-Anmelden (Umstellung auf echte Firebase-Konten).
  // Zahl hochsetzen, um erneut für alle einen Re-Login zu erzwingen.
  try{
    const _RELOGIN_EPOCH='1';
    if(localStorage.getItem('tp_zt_relogin_epoch')!==_RELOGIN_EPOCH){
      localStorage.setItem('tp_zt_relogin_epoch',_RELOGIN_EPOCH);
      localStorage.removeItem('tp_zt_session');
      localStorage.removeItem('tp_zt_remember');
    }
  }catch(e){}

  // Restore saved session (survives F5 reload)
  try{
    const savedUid=localStorage.getItem('tp_zt_session');
    if(savedUid&&getUser(savedUid)){
      window.cu=getUser(savedUid);
      document.getElementById('login-screen').style.display='none';
      document.getElementById('app').classList.add('visible');
      try{ initApp(); }catch(e){ console.error('Auto-Login Fehler:',e); /* kein doLogout – Nutzer eingeloggt lassen */ }
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

// Service Worker wird jetzt inline in index.html registriert
// (unabhängig vom Modul-Graph – siehe Kommentar dort)
