import { _PW_SALT, DEFAULT_USERS, STORAGE_KEY } from './config.js';
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
  const sel=document.getElementById('login-user-select');
  if(!sel) return;
  sel.innerHTML='<option value="">– Bitte auswählen –</option>';
  let users=[];
  try{ users=getData().users||[]; }catch(e){}
  if(!users.length) users=DEFAULT_USERS.slice();
  [...users].sort((a,b)=>a.name.localeCompare(b.name,'de')).forEach(u=>{
    const opt=document.createElement('option');
    opt.value=u.id;
    opt.textContent=u.name;
    sel.appendChild(opt);
  });
}

export async function doLogin(){
  const errEl=document.getElementById('login-err');
  const uid=document.getElementById('login-user-select').value;
  if(!uid){
    errEl.textContent='Bitte einen Namen auswählen.';
    errEl.style.display='block'; return;
  }
  const pw=document.getElementById('login-pw').value;
  const u=getUser(uid);
  if(!u){
    errEl.textContent='Benutzer nicht gefunden.';
    errEl.style.display='block'; return;
  }
  let match=false;
  if(isHashed(u.pw)){
    match=(await hashPw(pw))===u.pw;
  } else {
    match=pw===u.pw;
    if(match){ const h=await hashPw(pw); mutate(d=>{const x=d.users.find(y=>y.id===uid);if(x)x.pw=h;}); }
  }
  if(!match){
    errEl.textContent='Falsches Passwort.';
    errEl.style.display='block'; return;
  }
  window.cu=getUser(uid);
  try{ localStorage.setItem('tp_zt_session',uid); }catch(e){}
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
  populateLoginDropdown();
}

export function showForgotPassword(){
  let users=[];
  try{ users=getData().users||[]; }catch(e){}
  const admins=users.filter(u=>u.role==='admin'||u.role==='geschaeftsfuehrer');
  const contactHtml=admins.length
    ? admins.map(a=>`<div style="margin:4px 0;font-size:14px">👤 <strong>${esc(a.name)}</strong>${a.email?` – <a href="mailto:${esc(a.email)}" style="color:var(--primary)">${esc(a.email)}</a>`:''}</div>`).join('')
    : '<div style="font-size:13px;color:var(--muted)">Bitte wende dich an den Administrator.</div>';
  openModal(`<h3>Passwort vergessen?</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Passwörter können nur vom Administrator zurückgesetzt werden. Bitte wende dich an:</p>
    <div style="background:#f0f4f8;border-radius:8px;padding:12px 14px;margin-bottom:16px">${contactHtml}</div>
    <p style="font-size:12px;color:var(--muted)">Nach dem Login kannst du dein Passwort unter <strong>Profil → Passwort ändern</strong> selbst anpassen.</p>
    <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>`);
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
  document.getElementById('login-pw').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
}
