// ══════════════════════════════════════════════════════════════════
//  Automatisches App-Backup → Firebase Storage (backups/daily/<YYYY-MM-DD>_<uid>.json)
//  Ergänzt die täglichen Firebase-Datenbank-Backups (Konsole, 30 Tage) um eine
//  langfristige Kopie: täglich 90 Tage, der 1. jedes Monats dauerhaft (ArbZG ≥ 2 Jahre).
//
//  • Das ERSTE Gerät des Tages (egal welcher Nutzer) legt das Backup an – mit dem frisch
//    vom SERVER gelesenen Stand (nie aus dem lokalen Cache → kein Sichern verstümmelter Daten).
//  • Storage-Regeln: Backups dürfen nur NEU angelegt, nie überschrieben werden; Lesen und
//    Löschen nur der Administrator-Account (firebase-rules/STORAGE.rules).
//  • Merker zeiterfassung/_fixes/lastAppBackup = Datum → andere Geräte laden nicht doppelt.
//  • Aufräumen (Aufbewahrung) läuft nur, wenn der Administrator angemeldet ist.
//  Alles best effort: Fehler landen nur in der Konsole und stören die App nie.
// ══════════════════════════════════════════════════════════════════
import { localISODate, openModal, closeModal, esc, toast, jsArg as jsq } from './utils.js';
import { PW_FUNCTION_URL } from './config.js';
import { runAutoUserBackup } from './user-backup.js';   // persönlicher Monats-Schnappschuss (Phase 2)

const KEEP_DAILY_DAYS = 90;
let _running = false;

function _ready(){
  return !!(window.firebase && firebase.storage && firebase.auth && firebase.auth().currentUser
    && window.cu && !window._offlineMode && !window._cloudUnverified);
}

export async function runAutoBackup(){
  // Persönlichen Monats-Schnappschuss (Phase 2) unabhängig mit anstoßen – hat eigene Guards.
  try{ runAutoUserBackup(); }catch(_){}
  if(_running || !_ready()) return;
  _running = true;
  try{
    const db = firebase.database();
    const today = localISODate();
    const mark = db.ref('zeiterfassung/_fixes/lastAppBackup');
    const last = (await mark.once('value')).val();
    if(last !== today){
      // Frischer Server-Stand (nicht der lokale Cache).
      const [ze, crm] = await Promise.all([
        db.ref('zeiterfassung').once('value').then(s=>s.val()),
        db.ref('crm').once('value').then(s=>s.val()).catch(()=>null),
      ]);
      if(ze && Array.isArray(ze.users) && ze.users.length){
        // CRM und Shop getrennt ablegen (Shop liegt technisch unter crm/shop*) – so lässt sich beim
        // Einspielen jeder Teil einzeln wiederherstellen.
        const SHOP_KEYS=['shopItems','shopPlaces','shopOrders','shopLog','shopLoans','shopConfig'];
        let crmPart=crm, shopPart=null;
        if(crm && typeof crm==='object'){ crmPart={}; shopPart={ _v:1 };
          Object.keys(crm).forEach(k=>{ if(SHOP_KEYS.includes(k)) shopPart[k]=crm[k]; else crmPart[k]=crm[k]; }); }
        const blob = { _type:'tps-vollbackup', _v:2, source:'auto', exportedAt:new Date().toISOString(),
                       byUser:window.cu.id, zeiterfassung:ze, crm:crmPart, shop:shopPart };
        const body = new Blob([JSON.stringify(blob)], {type:'application/json'});
        // Merker NUR nach erfolgreichem Upload setzen. Wird verweigert (Datei existiert schon, weil
        // ein anderes Gerät gleichzeitig schneller war – oder Regeln noch nicht aktiv), bleibt der
        // Merker unberührt; das erfolgreiche Gerät setzt ihn.
        try{ await (window.ensureAccessClaim&&window.ensureAccessClaim()); }catch(_){}   // Freigabe-Markierung (Storage-Regeln)
        await firebase.storage().ref('backups/daily/'+today+'_'+firebase.auth().currentUser.uid+'.json').put(body, {contentType:'application/json'});
        await mark.set(today);
        console.info('[Backup] Tages-Backup '+today+' gespeichert.');
      }
    }
    if(window.cu.role==='admin') await _pruneOld();
  }catch(e){
    console.warn('[Backup] Automatisches Backup fehlgeschlagen:', e && (e.code||e.message));
  }finally{ _running = false; }
}

// Aufbewahrung: tägliche Backups älter als 90 Tage löschen – AUSSER dem 1. jedes Monats.
async function _pruneOld(){
  const res = await firebase.storage().ref('backups/daily').listAll();
  const cut = new Date(); cut.setDate(cut.getDate()-KEEP_DAILY_DAYS);
  const cutStr = localISODate(cut);
  for(const item of res.items){
    const m = item.name.match(/^(\d{4}-\d{2}-(\d{2}))_[^.]+\.json$/);   // <Datum>_<uid>.json
    if(!m || m[2]==='01' || m[1] >= cutStr) continue;
    try{ await item.delete(); }catch(e){ console.warn('[Backup] Löschen fehlgeschlagen:', item.name); }
  }
}

// Liste der App-Backups (nur Administrator) – für die Anzeige in der Verwaltung.
export async function listAppBackups(){
  const res = await firebase.storage().ref('backups/daily').listAll();
  return res.items.map(i=>i.name).sort().reverse();
}

// Einzelnes Backup herunterladen (nur Administrator).
export async function downloadAppBackup(name){
  const url = await firebase.storage().ref('backups/daily/'+name).getDownloadURL();
  const a = document.createElement('a'); a.href = url; a.download = 'TPS-Backup_'+name; a.target = '_blank'; a.click();
}

// Übersicht der App-Backups (Verwaltung → Daten & Backup) – nur Administrator.
export async function showAppBackups(){
  if(!window.cu || window.cu.role!=='admin'){ toast('Nur der Administrator-Account kann Backups einsehen.','err'); return; }
  openModal('<h3 style="margin-bottom:10px">☁ Automatische App-Backups</h3><p style="color:var(--muted)">Lädt …</p>');
  let names=[];
  try{ names=await listAppBackups(); }
  catch(e){ openModal('<h3>☁ Automatische App-Backups</h3><p style="color:var(--danger)">Konnte nicht geladen werden ('+esc((e&&(e.code||e.message))||'')+').</p><div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>'); return; }
  const rows=names.length
    ? names.map(n=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)"><span>'+esc(n.slice(0,10))+(/^\d{4}-\d{2}-01_/.test(n)?' <span class="chip" style="font-size:10px">dauerhaft</span>':'')+'</span><button class="btn btn-outline btn-sm" onclick="downloadAppBackup('+jsq(n)+')">⬇ Laden</button></div>').join('')
    : '<p style="color:var(--muted)">Noch keine App-Backups vorhanden.</p>';
  openModal('<h3 style="margin-bottom:6px">☁ Automatische App-Backups</h3>'
    +'<p style="font-size:12px;color:var(--muted);margin-bottom:12px">Täglich automatisch (Server-Stand). Aufbewahrung 90 Tage, der 1. jedes Monats dauerhaft. Einspielen über „Backup einspielen (JSON)".</p>'
    +'<div style="max-height:50vh;overflow-y:auto">'+rows+'</div>'
    +'<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
}

try{ window.runAutoBackup = runAutoBackup; window.listAppBackups = listAppBackups; window.downloadAppBackup = downloadAppBackup; window.showAppBackups = showAppBackups; }catch(_){}

// ══════════════════════════════════════════════════════════════════
//  Backups für „System-Verwaltung erweitert“ (seit v454) – alles über die Cloud Function tpsPw
//  (backupList / backupGet / restore), weil Storage und das Überschreiben der Daten dem Admin vorbehalten
//  sind. Der Server sichert vor dem Einspielen den aktuellen Stand und übernimmt KEINE Rechte aus dem Backup.
// ══════════════════════════════════════════════════════════════════
export function isBackupPlus(cu){ cu=cu||window.cu; return !!(cu && cu.role!=='admin' && cu.perms && cu.perms.zugriff_verwaltung===true && cu.perms.zugriff_verwaltung_plus===true); }
async function _fn(payload, fresh){
  const me=firebase.auth().currentUser; if(!me) throw new Error('Nicht angemeldet.');
  const tok=await me.getIdToken(!!fresh);
  const r=await fetch(PW_FUNCTION_URL,{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok}, body:JSON.stringify(payload) });
  let j={}; try{ j=await r.json(); }catch(_){}
  if(!r.ok || !j.ok) throw new Error(j.error==='reauth-required' ? 'Die Bestätigung ist abgelaufen – bitte erneut mit Passwort und Code bestätigen.' : j.error==='mfa-required' ? 'Dafür ist eine Anmeldung mit Zwei-Faktor-Code nötig (ab- und wieder anmelden).'
    : (j.error==='forbidden' ? 'Keine Berechtigung (System-Verwaltung erweitert nötig).' : (r.status===413 ? 'Die Datei ist zu groß.' : 'Server: '+(j.error||r.status))));
  return j;
}
const _PARTS=[['ze','⏱️ Zeiterfassung'],['crm','📇 CRM'],['shop','📦 Lager']];
export async function showPlusBackups(){
  if(!isBackupPlus()){ toast('Nur mit „System-Verwaltung erweitert“.','err'); return; }
  openModal('<h3>☁ Automatische Backups</h3><p style="color:var(--muted)">Lädt …</p>');
  let names=[];
  try{ names=(await _fn({ action:'backupList' })).names||[]; }
  catch(e){ openModal('<h3>☁ Automatische Backups</h3><p style="color:var(--danger)">'+esc(e.message)+'</p><div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>'); return; }
  const lbl=n=>esc(n.slice(8,10)+'.'+n.slice(5,7)+'.'+n.slice(0,4))+(/_vorEinspielen-/.test(n)?' <span class="chip" style="font-size:10px">Sicherung vor Einspielen</span>':(/^\d{4}-\d{2}-01_/.test(n)?' <span class="chip" style="font-size:10px">dauerhaft</span>':''));
  const rows=names.length ? names.map(n=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><span>${lbl(n)}</span>
      <span style="display:flex;gap:6px"><button class="btn btn-outline btn-sm" onclick="plusBackupDownload(${jsq(n)})">⬇ Laden</button><button class="btn btn-warn btn-sm" onclick="plusRestoreAsk(${jsq(n)})">↺ Einspielen</button></span></div>`).join('')
    : '<p style="color:var(--muted)">Noch keine automatischen Backups vorhanden.</p>';
  openModal('<h3 style="margin-bottom:6px">☁ Automatische Backups</h3><p style="font-size:12px;color:var(--muted);margin-bottom:12px">Täglich automatisch; 90 Tage, der 1. jedes Monats dauerhaft. Vor jedem Einspielen sichert der Server den aktuellen Stand.</p>'
    +'<div style="max-height:50vh;overflow-y:auto">'+rows+'</div><div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
}
export async function plusBackupDownload(name){
  try{ toast('Lade Backup …',''); const d=(await _fn({ action:'backupGet', name })).data;
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(d)],{type:'application/json'})); a.download='TPS-Backup_'+name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
  catch(e){ toast(e.message,'err'); }
}
// Einspielen: erst Teile wählen + bestätigen. src = { name } (automatisches Backup) oder { data } (Datei)
let _pending=null;
function _partsOf(d){
  if(!d) return ['ze','crm','shop'];
  if(d._type==='tps-vollbackup') return ['ze'].concat(d.crm?['crm']:[], (d.shop||(d.crm&&d.crm.shopItems))?['shop']:[]);
  if(d._type==='tps-crm-backup') return ['crm'].concat(d.crm&&d.crm.shopItems?['shop']:[]);
  if(d._type==='tps-shop-backup') return ['shop'];
  return (d.users&&d.entries)?['ze']:[];
}
function _askParts(src, avail, title){
  if(!avail.length){ toast('Unbekannte oder leere Backup-Datei.','err'); return; }
  _pending=src;
  openModal(`<h3>↺ Backup einspielen</h3><p style="font-size:13px;margin:0 0 10px">${title}</p>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">${_PARTS.map(([k,l])=>`<label style="display:flex;gap:8px;align-items:center;font-size:14px;${avail.includes(k)?'':'opacity:.45'}"><input type="checkbox" class="plus-rp" value="${k}" style="width:auto" ${avail.includes(k)?'':'disabled'}> ${l}</label>`).join('')}</div>
    <div style="font-size:12.5px;background:var(--warn-bg);border:1.5px solid var(--warn);border-radius:8px;padding:10px 12px;margin-bottom:10px">⚠ Die angehakten Bereiche werden <b>für alle</b> durch den Stand des Backups ersetzt. Vorher sichert der Server den aktuellen Stand (erscheint danach in der Backup-Liste).<br>Rechte, Rollen, Zugriffe und Anmeldedaten bleiben wie jetzt.</div>
    <div class="form-group" style="margin-bottom:6px"><label for="plus-rp-pw" style="font-size:13px;font-weight:600">🔐 Zur Sicherheit: dein Passwort</label>
      <input type="password" id="plus-rp-pw" autocomplete="current-password" style="width:100%;box-sizing:border-box">
      <div style="font-size:12px;color:var(--muted);margin-top:4px">Danach fragt die App einen neuen Code aus deiner Authenticator-App ab – erst dann wird eingespielt.</div></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button><button class="btn btn-danger" onclick="submitBtn(this,()=>plusRestoreRun())">Einspielen</button></div>`);
}
export function plusRestoreAsk(name){ if(!isBackupPlus()) return; _askParts({ name }, ['ze','crm','shop'], 'Automatisches Backup vom <b>'+esc(name.slice(8,10)+'.'+name.slice(5,7)+'.'+name.slice(0,4))+'</b>. Welche Bereiche?'); }
export function plusRestoreFile(){
  if(!isBackupPlus()) return;
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ let d=null; try{ d=JSON.parse(r.result); }catch(_){ toast('Keine gültige Backup-Datei (JSON).','err'); return; }
      _askParts({ data:d }, _partsOf(d), 'Datei <b>'+esc(f.name)+'</b>. Welche Bereiche?'); };
    r.readAsText(f); };
  inp.click();
}
export async function plusRestoreRun(){
  const src=_pending; if(!src) return;
  const parts={}; document.querySelectorAll('.plus-rp:checked').forEach(c=>{ parts[c.value]=true; });
  if(!Object.keys(parts).length){ toast('Bitte mindestens einen Bereich anhaken.','err'); return; }
  // Extra-Bestätigung (User 14.10.2026): Passwort + neuer Zwei-Faktor-Code direkt vor dem Einspielen.
  // Der Server prüft, dass diese Bestätigung höchstens 5 Minuten alt ist.
  const pw=(document.getElementById('plus-rp-pw')||{}).value||'';
  if(!pw){ toast('Bitte dein Passwort eingeben.','err'); return; }
  const fu=firebase.auth().currentUser; if(!fu||!fu.email){ toast('Keine gültige Anmeldung – bitte neu anmelden.','err'); return; }
  try{
    const cred=firebase.auth.EmailAuthProvider.credential(fu.email, pw);
    try{ await fu.reauthenticateWithCredential(cred); toast('Für dieses Konto ist kein Zwei-Faktor eingerichtet – Einspielen nicht möglich.','err'); return; }
    catch(e1){ if(e1&&e1.code==='auth/multi-factor-auth-required') await window.mfaResolve(e1); else throw e1; }
  }catch(e){
    const c=(e&&e.code)||'';
    if(c==='auth/mfa-cancelled'){ toast('Einspielen abgebrochen.','err'); return; }
    toast(/wrong-password|invalid-credential|invalid-login/.test(c)?'Passwort falsch.':((window.mfaFriendly&&/verification|multi-factor|too-many/.test(c))?window.mfaFriendly(e):('Bestätigung fehlgeschlagen: '+(c||e&&e.message||''))),'err'); return;
  }
  try{ toast('Spiele Backup ein …',''); const j=await _fn(Object.assign({ action:'restore', parts }, src), true);
    _pending=null; closeModal(); toast('Backup eingespielt ✓ (Sicherung vorher: '+(j.safety||'')+') – Seite wird neu geladen …','ok');
    setTimeout(()=>location.reload(),1800); }
  catch(e){ toast('Einspielen fehlgeschlagen: '+e.message,'err'); }
}
try{ Object.assign(window, { showPlusBackups, plusBackupDownload, plusRestoreAsk, plusRestoreFile, plusRestoreRun, isBackupPlus }); }catch(_){}
