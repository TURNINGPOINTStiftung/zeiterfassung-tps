// 🔐 Zwei-Faktor-Anmeldung (TOTP: Code aus einer Authenticator-App).
// Das Firebase-SDK (compat 10.12) kennt TOTP nur intern, exportiert aber keinen TOTP-Generator.
// Darum sprechen Einrichtung und Code-Prüfung direkt die offizielle Identity-Toolkit-Schnittstelle
// (v2 mfaEnrollment/mfaSignIn) an und reichen das Ergebnis über ein „Assertion"-Objekt an das SDK
// zurück – so verwaltet das SDK Anmeldung und Tokens wie gewohnt.
// Sicherheit: Ist ein zweiter Faktor eingerichtet, gibt Firebase OHNE gültigen Code gar kein
// Anmelde-Token heraus (serverseitig) – das Passwort allein reicht dann nicht mehr.
// Voraussetzung (einmalig, Projekt-Einstellung): Identity Platform + TOTP-Anbieter aktiv.
import { esc, jsArg, openModal, closeModal, toast } from './utils.js';

const API='https://identitytoolkit.googleapis.com/v2/';
const ISSUER='TPS Zeiterfassung';

function _key(){ return firebase.app().options.apiKey; }

const _ERR={
  INVALID_CODE:'auth/invalid-verification-code', INVALID_VERIFICATION_CODE:'auth/invalid-verification-code',
  UNVERIFIED_EMAIL:'auth/unverified-email', OPERATION_NOT_ALLOWED:'auth/operation-not-allowed',
  INVALID_MFA_PENDING_CREDENTIAL:'auth/invalid-multi-factor-session', MISSING_MFA_PENDING_CREDENTIAL:'auth/invalid-multi-factor-session',
  INVALID_ID_TOKEN:'auth/requires-recent-login', CREDENTIAL_TOO_OLD_LOGIN_AGAIN:'auth/requires-recent-login', TOKEN_EXPIRED:'auth/requires-recent-login',
  TOO_MANY_ATTEMPTS_TRY_LATER:'auth/too-many-requests',
};
async function _api(path, body){
  let r;
  try{ r=await fetch(API+path+'?key='+encodeURIComponent(_key()), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); }
  catch(e){ const x=new Error('keine Verbindung'); x.code='auth/network-request-failed'; throw x; }
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    const m=String((j.error&&j.error.message)||('HTTP '+r.status));
    const k=m.split(/[\s:]/)[0];
    const x=new Error(m); x.code=_ERR[k]||('auth/'+k.toLowerCase().replace(/_/g,'-')); throw x;
  }
  return j;
}

// „Assertion" im Format, das das SDK intern erwartet (_process je nach Sitzungsart).
function _assertion(code, opts){
  return {
    factorId:'totp',
    _process(auth, session, displayName){
      if(session.type==='enroll') return _api('accounts/mfaEnrollment:finalize',
        { idToken:session.credential, displayName:displayName||'Authenticator', totpVerificationInfo:{ sessionInfo:opts.sessionInfo, verificationCode:code } });
      return _api('accounts/mfaSignIn:finalize',
        { mfaPendingCredential:session.credential, mfaEnrollmentId:opts.uid, totpVerificationInfo:{ verificationCode:code } });
    }
  };
}

export function mfaFriendly(e){
  const c=(e&&e.code)||'';
  if(c==='auth/invalid-verification-code') return 'Code falsch oder abgelaufen.';
  if(c==='auth/too-many-requests') return 'Zu viele Versuche – bitte kurz warten.';
  if(c==='auth/network-request-failed') return 'Keine Verbindung.';
  if(c==='auth/invalid-multi-factor-session') return 'Anmeldung abgelaufen – bitte neu anmelden.';
  if(c==='auth/requires-recent-login') return 'Bitte einmal ab- und wieder anmelden und es dann direkt erneut versuchen.';
  if(c==='auth/operation-not-allowed') return 'Zwei-Faktor-Anmeldung ist im Projekt noch nicht freigeschaltet.';
  if(c==='auth/unverified-email') return 'Das Konto ist noch nicht als „bestätigt" markiert (einmalige Einstellung durch den Administrator).';
  return (e&&e.message)||'Unbekannter Fehler';
}

// ── Code-Abfrage (Anmelden / Passwort-Prüfung) ─────────────────────────
// Eigenes Fenster, unabhängig vom App-Modal (funktioniert auch auf der Login-Maske).
function _askCode(errText){
  return new Promise(res=>{
    document.getElementById('mfa-ask')?.remove();
    const d=document.createElement('div');
    d.id='mfa-ask';
    d.setAttribute('role','dialog'); d.setAttribute('aria-modal','true'); d.setAttribute('aria-labelledby','mfa-ask-t');
    d.style.cssText='position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45)';
    d.innerHTML=`<form style="background:var(--surface,#fff);color:var(--text,#1a1a1a);border-radius:var(--radius,14px);box-shadow:var(--shadow-2);padding:22px;max-width:360px;width:100%;font-family:var(--font)">
      <h3 id="mfa-ask-t" style="margin:0 0 6px;font-size:18px">🔐 Bestätigungscode</h3>
      <p style="margin:0 0 14px;font-size:14px;color:var(--muted,#555)">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
      <input id="mfa-ask-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" aria-label="Bestätigungscode"
        style="width:100%;box-sizing:border-box;font-size:24px;letter-spacing:6px;text-align:center;padding:10px;border:1.5px solid var(--border-strong,#888);border-radius:var(--radius-sm,10px);background:var(--surface,#fff);color:var(--text,#1a1a1a)">
      <div id="mfa-ask-err" role="alert" style="min-height:20px;margin:8px 0;font-size:13px;color:var(--danger-text,#a61b1b)">${esc(errText||'')}</div>
      <div style="display:flex;gap:8px"><button type="button" class="btn btn-outline" id="mfa-ask-x" style="flex:1">Abbrechen</button>
        <button type="submit" class="btn btn-primary" style="flex:1">Bestätigen</button></div>
    </form>`;
    document.body.appendChild(d);
    const inp=d.querySelector('#mfa-ask-code');
    const done=v=>{ d.remove(); res(v); };
    d.querySelector('#mfa-ask-x').onclick=()=>done(null);
    d.addEventListener('keydown',ev=>{ if(ev.key==='Escape') done(null); });
    d.querySelector('form').onsubmit=ev=>{ ev.preventDefault(); const v=inp.value.replace(/\D/g,'');
      if(v.length!==6){ d.querySelector('#mfa-ask-err').textContent='Bitte 6 Ziffern eingeben.'; inp.focus(); return; } done(v); };
    setTimeout(()=>inp.focus(),30);
  });
}

// Löst eine „zweiter Faktor nötig"-Fehlermeldung auf (Anmeldung ODER erneute Passwortprüfung).
// Gibt das UserCredential zurück; wirft bei Abbruch einen Fehler mit code 'auth/mfa-cancelled'.
export async function mfaResolve(err){
  const rs=err&&err.resolver;
  const hint=rs && (rs.hints||[]).find(h=>h.factorId==='totp');
  if(!hint){ const x=new Error('Der eingerichtete zweite Faktor wird hier nicht unterstützt.'); x.code='auth/unsupported-mfa'; throw x; }
  let msg='';
  for(let i=0;i<5;i++){
    const code=await _askCode(msg);
    if(code===null){ const x=new Error('abgebrochen'); x.code='auth/mfa-cancelled'; throw x; }
    try{ return await rs.resolveSignIn(_assertion(code,{ uid:hint.uid })); }
    catch(e){ if(e&&e.code==='auth/invalid-verification-code'){ msg='Code falsch oder abgelaufen – bitte neuen Code eingeben.'; continue; } throw e; }
  }
  const x=new Error('Zu viele falsche Codes.'); x.code='auth/too-many-requests'; throw x;
}

// ── Einrichtung im Profil ─────────────────────────────────────────────
function _factors(){ try{ return (firebase.auth().currentUser.multiFactor.enrolledFactors||[]).filter(f=>f.factorId==='totp'); }catch(e){ return []; } }

function _qrSvg(text){
  try{ const q=window.qrcode(0,'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize:5, margin:3, scalable:true }); }
  catch(e){ return ''; }
}
function _loadQr(){
  if(window.qrcode) return Promise.resolve();
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=new URL('./vendor/qrcode.min.js', import.meta.url).href; s.onload=()=>res(); s.onerror=()=>rej(new Error('QR-Code-Baustein nicht ladbar')); document.head.appendChild(s); });
}

export function mfaProfileHtml(cu){
  if(!cu || !(cu.role==='admin' || (cu.perms&&cu.perms.zugriff_verwaltung))) return '';
  const on=_factors().length>0;
  return `<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">🔐 Zwei-Faktor-Anmeldung</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Zusätzlich zum Passwort fragt die App beim Anmelden einen Code aus einer Authenticator-App ab
      (z. B. Microsoft Authenticator, Google Authenticator). Schützt Konten mit Verwaltungsrechten.</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="badge" style="background:var(${on?'--ok-bg':'--warn-bg'});color:var(${on?'--ok-text':'--warn-text'})">${on?'✓ Eingeschaltet':'Aus'}</span>
      <button type="button" class="btn btn-sm ${on?'btn-outline':'btn-primary'}" style="width:auto" onclick="mfaOpenSetup()">${on?'Verwalten':'Jetzt einrichten'}</button>
    </div>`;
}

let _enroll=null;   // { sessionInfo, secret }

export async function mfaOpenSetup(){
  const fu=firebase.auth().currentUser; if(!fu){ toast('Bitte anmelden.','err'); return; }
  const fs=_factors();
  if(fs.length){
    openModal(`<h3>🔐 Zwei-Faktor-Anmeldung</h3>
      <p style="font-size:14px">Eingeschaltet. Beim Anmelden wird ein Code aus deiner Authenticator-App abgefragt.</p>
      ${fs.map(f=>`<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px">
        <span style="flex:1">📱 ${esc(f.displayName||'Authenticator')}<br><span style="font-size:12px;color:var(--muted)">eingerichtet ${esc(new Date(f.enrollmentTime).toLocaleDateString('de-DE'))}</span></span>
        <button type="button" class="btn btn-sm btn-danger" style="width:auto" onclick="mfaRemove(${jsArg(f.uid)})">Entfernen</button></div>`).join('')}
      <p style="font-size:12px;color:var(--muted)">Neues Handy? Erst hier entfernen, dann neu einrichten – oder vorher eine zweite App hinzufügen.</p>
      <div class="modal-btns"><button class="btn btn-outline" onclick="mfaStartEnroll()">+ Weitere App</button><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>`);
    return;
  }
  mfaStartEnroll();
}

export async function mfaStartEnroll(){
  const fu=firebase.auth().currentUser; if(!fu) return;
  openModal('<h3>🔐 Zwei-Faktor einrichten</h3><div class="loading"><span class="spinner"></span> Wird vorbereitet …</div>');
  try{
    const [_, r]=await Promise.all([_loadQr(), _api('accounts/mfaEnrollment:start',{ idToken:await fu.getIdToken(), totpEnrollmentInfo:{} })]);
    const t=r.totpSessionInfo||{};
    _enroll={ sessionInfo:t.sessionInfo, secret:t.sharedSecretKey };
    const label=(window.cu&&window.cu.name)||fu.email;
    const uri=`otpauth://totp/${encodeURIComponent(ISSUER+':'+label)}?secret=${t.sharedSecretKey}&issuer=${encodeURIComponent(ISSUER)}&algorithm=${t.hashingAlgorithm||'SHA1'}&digits=${t.verificationCodeLength||6}&period=${t.periodSec||30}`;
    const grp=String(t.sharedSecretKey||'').replace(/(.{4})/g,'$1 ').trim();
    openModal(`<h3>🔐 Zwei-Faktor einrichten</h3>
      <ol style="font-size:14px;padding-left:20px;margin:0 0 10px">
        <li>Authenticator-App auf dem Handy öffnen (z. B. Microsoft oder Google Authenticator) → „Konto hinzufügen".</li>
        <li>Diesen QR-Code scannen:</li></ol>
      <div style="background:#fff;border-radius:var(--radius-sm);padding:8px;width:220px;max-width:100%;margin:0 auto 8px" aria-label="QR-Code für die Authenticator-App" role="img">${_qrSvg(uri)}</div>
      <details style="font-size:12px;color:var(--muted);margin-bottom:10px"><summary>QR-Code geht nicht? Schlüssel von Hand eingeben</summary>
        <div style="margin-top:6px">Kontoname: <b>${esc(ISSUER)}</b> · Schlüssel (zeitbasiert):<br><code style="font-size:14px;user-select:all;word-break:break-all">${esc(grp)}</code>
        <br><a href="${esc(uri)}">Auf diesem Handy direkt in der App öffnen</a></div></details>
      <ol start="3" style="font-size:14px;padding-left:20px;margin:0 0 6px"><li>Den 6-stelligen Code aus der App hier eingeben:</li></ol>
      <div class="form-group"><input id="mfa-enr-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" aria-label="Code aus der App"
        style="font-size:22px;letter-spacing:6px;text-align:center" onkeydown="if(event.key==='Enter')mfaFinishEnroll()"></div>
      <div id="mfa-enr-err" role="alert" style="font-size:13px;color:var(--danger-text);min-height:18px"></div>
      <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button><button class="btn btn-primary" id="mfa-enr-btn" onclick="mfaFinishEnroll()">Einschalten</button></div>`);
    setTimeout(()=>document.getElementById('mfa-enr-code')?.focus(),50);
  }catch(e){
    console.error('MFA start:',e);
    openModal(`<h3>🔐 Zwei-Faktor einrichten</h3><div class="empty-state"><span class="es-icon">⚠️</span><span class="es-title">Einrichtung nicht möglich</span><span>${esc(mfaFriendly(e))}</span></div>
      <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>`);
  }
}

export async function mfaFinishEnroll(){
  const inp=document.getElementById('mfa-enr-code'), er=document.getElementById('mfa-enr-err'), btn=document.getElementById('mfa-enr-btn');
  const code=(inp&&inp.value||'').replace(/\D/g,'');
  if(code.length!==6){ er.textContent='Bitte die 6 Ziffern aus der App eingeben.'; return; }
  if(!_enroll){ er.textContent='Bitte neu starten.'; return; }
  btn.disabled=true; er.textContent='';
  try{
    await firebase.auth().currentUser.multiFactor.enroll(_assertion(code,{ sessionInfo:_enroll.sessionInfo }), 'Authenticator');
    _enroll=null;
    openModal(`<h3>🔐 Zwei-Faktor eingeschaltet ✓</h3>
      <p style="font-size:14px">Ab der nächsten Anmeldung fragt die App nach Passwort <b>und</b> Code aus der Authenticator-App.</p>
      <p style="font-size:13px;color:var(--muted)">Tipp: Den Eintrag in der App nicht löschen. Bei Handy-Wechsel vorher hier „Entfernen" und neu einrichten.</p>
      <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Fertig</button></div>`);
  }catch(e){
    console.error('MFA enroll:',e);
    er.textContent=mfaFriendly(e); btn.disabled=false; inp.select();
  }
}

export async function mfaRemove(uid){
  if(!confirm('Zwei-Faktor-Anmeldung für diese App entfernen? Danach reicht wieder das Passwort.')) return;
  const fu=firebase.auth().currentUser;
  try{ await fu.multiFactor.unenroll(uid); toast('Zwei-Faktor entfernt.'); closeModal(); }
  catch(e){
    if(e&&e.code==='auth/requires-recent-login') toast('Aus Sicherheitsgründen: bitte ab- und wieder anmelden, dann direkt entfernen.','err');
    else toast('Entfernen fehlgeschlagen: '+mfaFriendly(e),'err');
  }
}

try{ Object.assign(window,{ mfaOpenSetup, mfaStartEnroll, mfaFinishEnroll, mfaRemove, mfaResolve }); }catch(e){}
