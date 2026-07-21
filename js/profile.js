import { getUser, getData, mutate } from './data.js';
import { verifyPw, makePwRecord } from './auth.js';
import { esc, openModal, closeModal, toast, wsPeriodRows, wsCollectPeriods } from './utils.js';

// Ist der/die aktuelle Nutzer:in als „Werkstudent" benannt?
function _cuIsWerkstudent(cu){
  const crs=getData().customRoles||[];
  const ids=Array.isArray(cu.customRoles)?cu.customRoles:(cu.customRole?[cu.customRole]:[]);
  return ids.some(cid=>{ const cr=crs.find(r=>r.id===cid); return cr&&(cr.label||'').toLowerCase().includes('werkstudent'); });
}

export function openProfileModal(){
  const cu=window.cu;
  const BL=[['','– Bundesland –'],['BW','Baden-Württemberg'],['BY','Bayern'],['BE','Berlin'],
    ['BB','Brandenburg'],['HB','Bremen'],['HH','Hamburg'],['HE','Hessen'],
    ['MV','Mecklenburg-Vorpommern'],['NI','Niedersachsen'],['NW','Nordrhein-Westfalen'],
    ['RP','Rheinland-Pfalz'],['SL','Saarland'],['SN','Sachsen'],['ST','Sachsen-Anhalt'],
    ['SH','Schleswig-Holstein'],['TH','Thüringen']];
  const blOpts=BL.map(([v,l])=>`<option value="${v}"${(cu.bundesland||'')===v?' selected':''}>${l}</option>`).join('');
  // Werkstudent: eigene Vorlesungszeiten UND Brückentage pflegen – bis zu einem Jahr im Voraus.
  // (Zusätzlich zentral in der Verwaltung pflegbar; beide schreiben dieselben Felder.)
  const _maxD=new Date(); _maxD.setFullYear(_maxD.getFullYear()+1);
  const maxDate=_maxD.toISOString().slice(0,10);
  let wstSection='';
  if(_cuIsWerkstudent(cu)){
    wstSection=`<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">
      <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">🎓 Meine Vorlesungszeiten</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">In der Vorlesungszeit gilt die 20h-/Woche-Grenze (Mo–Fr, 8–20 Uhr). Semester bis zu einem Jahr im Voraus eintragen. Abgelaufene Jahre landen automatisch im Verlauf.</div>
      ${wsPeriodRows(cu.lecturePeriods,'prof-lp',4,'Semester',maxDate)}
      <div style="font-size:14px;font-weight:700;color:var(--primary);margin:16px 0 8px">🌉 Brückentage / vorlesungsfreie Tage</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Tage innerhalb der Vorlesungszeit, an denen die 20h-Grenze NICHT gilt. Einzelner Tag: bei „von" und „bis" dasselbe Datum.</div>
      ${wsPeriodRows(cu.lectureFreeDays,'prof-lf',6,'Zeitraum',maxDate)}`;
  }
  openModal(`<h3>👤 Mein Profil</h3>
    <div class="form-group"><label>Name</label>
      <input type="text" value="${esc(cu.name)}" disabled style="opacity:.6;cursor:not-allowed"></div>
    <div class="form-group"><label>E-Mail</label>
      <input type="email" id="prof-email" value="${esc(cu.email||'')}" placeholder="vorname@beispiel.de" autocomplete="email"></div>
    <div class="form-group"><label>Wohnort</label>
      <input type="text" id="prof-city" value="${esc(cu.city||'')}" placeholder="z.B. Berlin"></div>
    <div class="form-group"><label>Bundesland</label>
      <select id="prof-bl">${blOpts}</select></div>
    ${wstSection}
    <hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:12px">🔒 Passwort ändern</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Nur ausfüllen, wenn Sie Ihr Passwort ändern möchten.</div>
    <div class="form-group"><label>Aktuelles Passwort</label>
      <input type="password" id="prof-pw-cur" placeholder="Aktuelles Passwort" autocomplete="current-password"></div>
    <div class="form-group"><label>Neues Passwort</label>
      <input type="password" id="prof-pw-new" placeholder="Neues Passwort" autocomplete="new-password"></div>
    <div class="form-group"><label>Neues Passwort bestätigen</label>
      <input type="password" id="prof-pw-confirm" placeholder="Bestätigung" autocomplete="new-password"></div>
    <hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">🔄 App aktualisieren</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Holt die neueste Version (Cache leeren & neu laden) – z. B. nach einem Update.</div>
    <button class="btn btn-outline" onclick="forceAppUpdate()" style="width:100%">🔄 App jetzt aktualisieren</button>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" onclick="saveProfile()">Speichern</button>
    </div>`);
}

export async function saveProfile(){
  const cu=window.cu;
  const email=document.getElementById('prof-email').value.trim();
  const city=document.getElementById('prof-city').value.trim();
  const bl=document.getElementById('prof-bl').value;
  const pwCur=document.getElementById('prof-pw-cur').value;
  const pwNew=document.getElementById('prof-pw-new').value;
  const pwConfirm=document.getElementById('prof-pw-confirm').value;
  let newPwHash=null;
  if(pwCur||pwNew||pwConfirm){
    if(!pwCur){ toast('Bitte aktuelles Passwort eingeben.','err'); return; }
    const user=getUser(cu.id);
    const match=(await verifyPw(pwCur,user.pw)).ok;
    if(!match){ toast('Aktuelles Passwort falsch.','err'); return; }
    if(!pwNew){ toast('Bitte neues Passwort eingeben.','err'); return; }
    if(pwNew!==pwConfirm){ toast('Neue Passwörter stimmen nicht überein.','err'); return; }
    if(pwNew.length<8){ toast('Neues Passwort zu kurz (min. 8 Zeichen).','err'); return; }
    newPwHash=await makePwRecord(pwNew);
  }
  // Werkstudent: Vorlesungszeiten + Brückentage einsammeln (aktive Slots + im Verlauf mitgeführte),
  // nur wenn die Felder existieren.
  let lecturePeriods=null, lectureFreeDays=null;
  if(document.getElementById('prof-lp-von-0')){
    lecturePeriods=wsCollectPeriods('prof-lp',4);
    lectureFreeDays=wsCollectPeriods('prof-lf',6);
  }
  await mutate(d=>{
    const u=d.users.find(x=>x.id===cu.id);
    if(u){ u.email=email; u.city=city; u.bundesland=bl; if(newPwHash) u.pw=newPwHash; if(lecturePeriods) u.lecturePeriods=lecturePeriods; if(lectureFreeDays) u.lectureFreeDays=lectureFreeDays; }
  });
  window.cu=getUser(cu.id);
  closeModal();
  toast('Profil gespeichert. ✓','ok');
}

export function shareApp(){
  const appUrl='https://turningpointstiftung.github.io/zeiterfassung-tps/';
  openModal(
    '<h3 style="margin-bottom:16px">📱 App installieren</h3>'
    +'<p style="font-size:13px;color:var(--muted);margin-bottom:18px">Die Zeiterfassung kann als App auf dem Homescreen installiert werden – kein App Store nötig.</p>'
    +'<div style="background:#f0f4f8;border-radius:8px;padding:14px 16px;margin-bottom:12px">'
    +'<div style="font-size:13px;font-weight:700;color:#1a3a5c;margin-bottom:8px">🍎 iOS (iPhone / iPad)</div>'
    +'<ol style="font-size:12px;color:var(--text);padding-left:18px;line-height:1.8">'
    +'<li>Safari öffnen und diese Seite aufrufen</li>'
    +'<li>Unten auf <strong>Teilen</strong> tippen (□↑)</li>'
    +'<li><strong>„Zum Home-Bildschirm"</strong> wählen</li>'
    +'<li>Oben rechts <strong>Hinzufügen</strong> tippen</li>'
    +'</ol></div>'
    +'<div style="background:#f0f4f8;border-radius:8px;padding:14px 16px;margin-bottom:16px">'
    +'<div style="font-size:13px;font-weight:700;color:#1a3a5c;margin-bottom:8px">🤖 Android</div>'
    +'<ol style="font-size:12px;color:var(--text);padding-left:18px;line-height:1.8">'
    +'<li>APK-Datei herunterladen (Button unten)</li>'
    +'<li>APK öffnen und Installation bestätigen</li>'
    +'<li><em>Ggf. „Installation aus unbekannten Quellen" erlauben</em></li>'
    +'</ol></div>'
    +'<div style="display:flex;flex-direction:column;gap:8px">'
    +'<button class="btn btn-ok" onclick="window.open(\''+appUrl+'\',\'_blank\')">🔗 App-Link öffnen / teilen</button>'
    +'<button class="btn btn-outline" onclick="_downloadHtml()">⬇ HTML-Datei herunterladen</button>'
    +'<button class="btn btn-outline" onclick="closeModal()">Schließen</button>'
    +'</div>'
  );
}

export function _downloadHtml(){
  const html='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='Zeiterfassung_TURNING_POINT.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Download gestartet ✓','ok');
}

