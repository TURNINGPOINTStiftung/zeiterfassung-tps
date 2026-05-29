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
  var list=document.getElementById('login-user-list');
  var hidden=document.getElementById('login-user');
  list.innerHTML='';
  hidden.value='';
  var users=[];
  try{ users=getData().users||[]; }catch(e){}
  if(!users.length) users=DEFAULT_USERS.slice();
  users.forEach(function(u,i){
    var tile=document.createElement('button');
    tile.type='button';
    tile.className='user-tile'+(i===0?' selected':'');
    tile.setAttribute('data-uid',u.id);
    tile.innerHTML=esc(u.name);
    tile.onclick=function(){
      list.querySelectorAll('.user-tile').forEach(function(t){ t.classList.remove('selected'); });
      tile.classList.add('selected');
    };
    list.appendChild(tile);
  });
}

export async function doLogin(){
  var errEl=document.getElementById('login-err');
  var selectedTile=document.querySelector('#login-user-list .user-tile.selected');
  if(!selectedTile){
    errEl.textContent='Bitte eine Person auswählen.';
    errEl.style.display='block'; return;
  }
  var uid=selectedTile.getAttribute('data-uid');
  var pw=document.getElementById('login-pw').value;
  var u=getUser(uid);
  if(!u){
    errEl.textContent='Benutzer nicht gefunden – bitte "Login-Probleme?" verwenden.';
    errEl.style.display='block'; return;
  }
  var match=false;
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

export function emergencyReset(){
  var users=[];
  try{ users=getData().users||[]; }catch(e){}
  var rows='';
  for(var i=0;i<users.length;i++){
    var u=users[i];
    rows+='<tr><td style="padding:5px 8px">'+esc(u.name)+'</td>'
      +'<td style="padding:5px 8px;font-family:monospace;color:#1a3a5c">'+esc(u.id)+'</td>'
      +'<td style="padding:5px 8px"><span class="chip chip-'+u.role+'">'+u.role+'</span></td></tr>';
  }
  if(!rows) rows='<tr><td colspan="3" style="padding:8px;color:#7f8c8d;text-align:center">Keine Benutzer lesbar</td></tr>';
  var pwRows='';
  for(var j=0;j<users.length;j++){
    var uu=users[j];
    var def=null;
    for(var k=0;k<DEFAULT_USERS.length;k++){ if(DEFAULT_USERS[k].id===uu.id){ def=DEFAULT_USERS[k]; break; } }
    if(def) pwRows+='<tr><td style="padding:2px 8px 2px 0">'+esc(uu.name)+'</td>'
      +'<td style="padding:2px 8px 2px 0;font-family:monospace;color:#1a3a5c">'+def.pw+'</td></tr>';
  }
  openModal(
    '<h3>Login-Hilfe</h3>'
    +'<p style="font-size:13px;color:#7f8c8d;margin-bottom:14px">Gespeicherte Benutzer im System:</p>'
    +'<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">'
    +'<thead><tr style="background:#f0f2f5"><th style="padding:5px 8px;text-align:left;font-size:11px">Name</th>'
    +'<th style="padding:5px 8px;text-align:left;font-size:11px">Login-ID</th>'
    +'<th style="padding:5px 8px;text-align:left;font-size:11px">Rolle</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table>'
    +'<p style="font-size:12px;color:#7f8c8d;margin-bottom:16px">Passw&ouml;rter &auml;ndern: nach Login unter <strong>Einstellungen &rarr; Mitarbeiter bearbeiten</strong>.</p>'
    +'<details style="margin-bottom:12px"><summary style="font-size:13px;font-weight:700;color:#e67e22;cursor:pointer">Passw&ouml;rter auf Standard zur&uuml;cksetzen</summary>'
    +'<p style="font-size:12px;color:#7f8c8d;margin:8px 0">Zeitdaten bleiben erhalten!</p>'
    +(pwRows ? '<table style="font-size:12px;margin:6px 0 10px 0;border-collapse:collapse">'
      +'<tr><th style="padding:2px 8px 2px 0;text-align:left;font-size:11px">Name</th>'
      +'<th style="padding:2px 8px 2px 0;text-align:left;font-size:11px">Neues Passwort</th></tr>'
      +pwRows+'</table>' : '')
    +'<button class="btn btn-warn btn-sm" onclick="resetPasswordsOnly()">Passw&ouml;rter zur&uuml;cksetzen</button></details>'
    +'<details style="margin-bottom:12px"><summary style="font-size:13px;font-weight:700;color:#c0392b;cursor:pointer">Notfall: Alle Daten l&ouml;schen</summary>'
    +'<p style="font-size:12px;color:#7f8c8d;margin:8px 0">L&ouml;scht alle Zeitdaten. Nicht r&uuml;ckg&auml;ngig zu machen!</p>'
    +'<button class="btn btn-danger btn-sm" onclick="doEmergencyReset()">Alles l&ouml;schen &amp; neu starten</button></details>'
    +'<div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Schlie&szlig;en</button></div>'
  );
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
