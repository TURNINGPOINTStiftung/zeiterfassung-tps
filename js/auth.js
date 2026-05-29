import { _PW_SALT, DEFAULT_USERS, STORAGE_KEY,
         EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, APP_URL } from './config.js';
import { getData, getUser, mutate } from './data.js';
import { esc, toast, openModal, closeModal } from './utils.js';

// ── Password hashing ──────────────────────────────────────────────
export async function hashPw(pw){
  if(!pw) return '';
  const data=new TextEncoder().encode(pw+_PW_SALT);
  const buf=await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function isHashed(pw){ return pw&&pw.length===64&&/^[0-9a-f]+$/.test(pw); }

// ── Login UI ──────────────────────────────────────────────────────
export function populateLoginDropdown(){
  const dl=document.getElementById('login-users-datalist');
  if(!dl) return;
  dl.innerHTML='';
  let users=[];
  try{ users=getData().users||[]; }catch(e){}
  if(!users.length) users=DEFAULT_USERS.slice();
  [...users].sort((a,b)=>a.name.localeCompare(b.name,'de')).forEach(u=>{
    const opt=document.createElement('option');
    opt.value=u.name;
    dl.appendChild(opt);
  });
  // Gespeicherten Benutzer wiederherstellen
  try{
    const rid=localStorage.getItem('tp_zt_remember');
    if(rid){
      const ru=getUser(rid);
      if(ru){
        const inp=document.getElementById('login-user-input');
        if(inp&&!inp.value) inp.value=ru.name;
        const cb=document.getElementById('login-remember');
        if(cb) cb.checked=true;
      }
    }
  }catch(e){}
}

export async function doLogin(){
  const errEl=document.getElementById('login-err');
  const inp=document.getElementById('login-user-input');
  const name=(inp?.value||'').trim();
  if(!name){
    errEl.textContent='Bitte einen Namen eingeben.';
    errEl.style.display='block'; return;
  }
  let users=[];
  try{ users=getData().users||[]; }catch(e){}
  const u=users.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(!u){
    errEl.textContent='Benutzer nicht gefunden.';
    errEl.style.display='block'; return;
  }
  const pw=document.getElementById('login-pw').value;
  let match=false;
  if(isHashed(u.pw)){
    match=(await hashPw(pw))===u.pw;
  } else {
    match=pw===u.pw;
    if(match){ const h=await hashPw(pw); mutate(d=>{const x=d.users.find(y=>y.id===u.id);if(x)x.pw=h;}); }
  }
  if(!match){
    errEl.textContent='Falsches Passwort.';
    errEl.style.display='block'; return;
  }
  // Angemeldet bleiben: Benutzer-ID speichern oder löschen
  try{
    const cb=document.getElementById('login-remember');
    if(cb?.checked) localStorage.setItem('tp_zt_remember',u.id);
    else localStorage.removeItem('tp_zt_remember');
  }catch(e){}
  window.cu=getUser(u.id);
  try{ localStorage.setItem('tp_zt_session',u.id); }catch(e){}
  errEl.style.display='none';
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').classList.add('visible');
  try{ window.initApp?.(); } catch(e){ console.error('initApp Fehler:',e); }
  try{ window.updateAbBadge?.(); } catch(e){ console.error('updateAbBadge Fehler:',e); }
}

export function doLogout(){
  window.cu=null; window.viewEmpId=null;
  try{ localStorage.removeItem('tp_zt_session'); }catch(e){}
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-pw').value='';
  // Eingabefeld leeren, damit populateLoginDropdown ggf. gespeicherten Namen einträgt
  const inp=document.getElementById('login-user-input');
  if(inp) inp.value='';
  populateLoginDropdown();
}

function _emailjsReady(){
  return EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID;
}

function _genResetToken(){
  const arr=new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function showForgotPassword(){
  if(!_emailjsReady()){
    // Fallback: show admin contact if EmailJS not configured
    let users=[];
    try{ users=getData().users||[]; }catch(e){}
    const admins=users.filter(u=>u.role==='admin'||u.role==='geschaeftsfuehrer');
    const contactHtml=admins.length
      ? admins.map(a=>`<div style="margin:4px 0;font-size:14px">👤 <strong>${esc(a.name)}</strong>${a.email?` – <a href="mailto:${esc(a.email)}" style="color:var(--primary)">${esc(a.email)}</a>`:''}</div>`).join('')
      : '<div style="font-size:13px;color:var(--muted)">Bitte wende dich an den Administrator.</div>';
    openModal(`<h3>Passwort vergessen?</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Bitte wende dich an:</p>
      <div style="background:#f0f4f8;border-radius:8px;padding:12px 14px;margin-bottom:16px">${contactHtml}</div>
      <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>`);
    return;
  }
  openModal(`<h3>🔑 Passwort vergessen?</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      Gib deine E-Mail-Adresse ein. Du erhältst einen Link zum Zurücksetzen.
    </p>
    <div class="form-group">
      <label for="reset-email">E-Mail-Adresse</label>
      <input type="email" id="reset-email" placeholder="deine@email.de" autocomplete="email"
             onkeydown="if(event.key==='Enter') sendPasswordReset()">
    </div>
    <div id="reset-msg" style="margin-top:8px"></div>
    <div class="modal-btns" id="reset-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="sendPasswordReset()">Link senden</button>
    </div>`);
  setTimeout(()=>document.getElementById('reset-email')?.focus(),100);
}

export async function sendPasswordReset(){
  const emailEl=document.getElementById('reset-email');
  const msgEl=document.getElementById('reset-msg');
  const btnsEl=document.getElementById('reset-btns');
  const email=(emailEl?.value||'').trim();
  if(!email){
    msgEl.innerHTML='<div style="color:var(--danger);font-size:13px">Bitte E-Mail-Adresse eingeben.</div>';
    return;
  }
  btnsEl.innerHTML='<div style="font-size:13px;color:var(--muted)">⏳ Wird gesendet…</div>';

  let users=[];
  try{ users=getData().users||[]; }catch(e){}
  const user=users.find(u=>u.email&&u.email.toLowerCase()===email.toLowerCase());

  const showSuccess=()=>{
    msgEl.innerHTML='';
    btnsEl.innerHTML='<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:12px;font-size:13px;color:#155724">✅ Falls diese E-Mail hinterlegt ist, erhältst du gleich einen Reset-Link.</div><div class="modal-btns" style="margin-top:12px"><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>';
  };

  // Always show success (don't reveal if email exists – security)
  if(!user){ showSuccess(); return; }

  const token=_genResetToken();
  const expiry=Date.now()+3600000; // 1 Stunde

  try{
    await firebase.database().ref('pwResetTokens/'+token).set({uid:user.id, expiry});
  }catch(e){
    btnsEl.innerHTML='<div style="color:var(--danger);font-size:13px">Fehler. Bitte versuche es erneut.</div><div class="modal-btns" style="margin-top:8px"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>';
    return;
  }

  const resetLink=APP_URL+'?pw_reset='+token;
  try{
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: user.email,
      to_name:  user.name,
      reset_link: resetLink
    }, EMAILJS_PUBLIC_KEY);
    showSuccess();
  }catch(e){
    firebase.database().ref('pwResetTokens/'+token).remove().catch(()=>{});
    btnsEl.innerHTML='<div style="color:var(--danger);font-size:13px">E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.</div><div class="modal-btns" style="margin-top:8px"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>';
  }
}

export async function checkPasswordResetToken(){
  const params=new URLSearchParams(window.location.search);
  const token=params.get('pw_reset');
  if(!token) return;
  window.history.replaceState({},'',window.location.pathname);
  try{
    const snap=await firebase.database().ref('pwResetTokens/'+token).once('value');
    const data=snap.val();
    if(!data||data.expiry<Date.now()){
      openModal(`<h3>Link abgelaufen</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Dieser Reset-Link ist abgelaufen oder wurde bereits verwendet.</p>
        <div class="modal-btns">
          <button class="btn btn-primary" onclick="closeModal();showForgotPassword()">Neuen Link anfordern</button>
        </div>`);
      return;
    }
    const user=getUser(data.uid);
    openModal(`<h3>🔑 Neues Passwort</h3>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Hallo <strong>${esc(user?.name||'')}</strong>! Bitte wähle ein neues Passwort.</p>
      <div class="form-group">
        <label>Neues Passwort</label>
        <input type="password" id="new-pw-1" placeholder="Mindestens 4 Zeichen" autocomplete="new-password"
               onkeydown="if(event.key==='Enter') saveResetPassword('${token}','${data.uid}')">
      </div>
      <div class="form-group">
        <label>Passwort bestätigen</label>
        <input type="password" id="new-pw-2" placeholder="Wiederholen" autocomplete="new-password"
               onkeydown="if(event.key==='Enter') saveResetPassword('${token}','${data.uid}')">
      </div>
      <div id="new-pw-msg" style="margin-top:8px"></div>
      <div class="modal-btns">
        <button class="btn btn-primary" onclick="saveResetPassword('${token}','${data.uid}')">Passwort speichern</button>
      </div>`);
    setTimeout(()=>document.getElementById('new-pw-1')?.focus(),100);
  }catch(e){ console.error('Reset-Token Fehler:',e); }
}

export async function saveResetPassword(token,uid){
  const pw1=document.getElementById('new-pw-1')?.value||'';
  const pw2=document.getElementById('new-pw-2')?.value||'';
  const msgEl=document.getElementById('new-pw-msg');
  if(pw1.length<4){ msgEl.innerHTML='<div style="color:var(--danger);font-size:13px">Mindestens 4 Zeichen.</div>'; return; }
  if(pw1!==pw2){ msgEl.innerHTML='<div style="color:var(--danger);font-size:13px">Passwörter stimmen nicht überein.</div>'; return; }
  const hash=await hashPw(pw1);
  await mutate(d=>{ const u=d.users.find(x=>x.id===uid); if(u) u.pw=hash; });
  await firebase.database().ref('pwResetTokens/'+token).remove().catch(()=>{});
  closeModal();
  toast('✅ Passwort gespeichert. Du kannst dich jetzt einloggen.','ok');
  populateLoginDropdown();
}

export function emergencyReset(){
  // Kept for admin use only – called from Einstellungen
  openModal(`<h3>⚠ Notfall-Reset</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Diese Funktion ist nur für Administratoren.</p>
    <details style="margin-bottom:12px"><summary style="font-size:13px;font-weight:700;color:#e67e22;cursor:pointer">Passwörter auf Standard zurücksetzen</summary>
    <p style="font-size:12px;color:var(--muted);margin:8px 0">Zeitdaten bleiben erhalten!</p>
    <button class="btn btn-warn btn-sm" onclick="resetPasswordsOnly()">Passwörter zurücksetzen</button></details>
    <details style="margin-bottom:12px"><summary style="font-size:13px;font-weight:700;color:#c0392b;cursor:pointer">Alle Daten löschen</summary>
    <p style="font-size:12px;color:var(--muted);margin:8px 0">Löscht alle Zeitdaten unwiderruflich!</p>
    <button class="btn btn-danger btn-sm" onclick="doEmergencyReset()">Alles löschen &amp; neu starten</button></details>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button></div>`);
}

export function doEmergencyReset(){
  if(!confirm('Wirklich ALLE Daten löschen?\nDieser Schritt kann nicht rückgängig gemacht werden.')) return;
  try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  closeModal();
  location.reload();
}

export async function resetPasswordsOnly(){
  if(!confirm('Passwörter aller Benutzer auf Standard zurücksetzen?\nZeitdaten bleiben erhalten.')) return;
  const hashMap={};
  for(const def of DEFAULT_USERS){ hashMap[def.id]=await hashPw(def.pw); }
  mutate(d=>{
    d.users.forEach(u=>{ if(hashMap[u.id]) u.pw=hashMap[u.id]; });
  });
  closeModal();
  toast('Passwörter zurückgesetzt.','ok');
  populateLoginDropdown();
}

export function initAuthEvents(){
  // Enter auf Passwort-Feld → Anmelden (Fallback; Form-Submit macht dasselbe)
  document.getElementById('login-pw').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
}
