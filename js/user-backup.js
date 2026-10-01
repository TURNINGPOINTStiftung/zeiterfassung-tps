// ══════════════════════════════════════════════════════════════════
//  Theme 2 – Persönliches Zeiterfassungs-Backup (eigene Daten)
//  Jede Person mit aktiver Zeiterfassung kann ihre EIGENE Zeiterfassung
//  (alle eigenen Monate) als Datei sichern und wieder einspielen.
//
//  • Export = reines Lesen der eigenen Monate → immer vollständig
//    (Entwurf, eingereicht UND genehmigt sind im Backup enthalten).
//  • Restore = feldgenaues MERGE über mutate(): fehlende Tage werden ergänzt,
//    abweichende aus dem Backup übernommen; vorhandene Tage gehen NIE verloren.
//    Nur die EIGENEN Monate, und nur solange sie NICHT genehmigt sind
//    (genehmigte Monate sind server-seitig ohnehin geschützt → Admin-Sache).
//  • saveRaw scheidet aus (schriebe den ganzen Baum inkl. fremder users/entries,
//    würde von den Server-Regeln abgelehnt). Deshalb konsequent über mutate.
//
//  Phase 2 (automatischer Cloud-Schnappschuss am 10.) folgt separat und braucht
//  eine neue Storage-Regel, die der Administrator veröffentlicht.
// ══════════════════════════════════════════════════════════════════
import { getData, getUser, mutate } from './data.js';
import { openModal, closeModal, toast, esc, localISODate } from './utils.js';

const BK_TYPE = 'tps-ze-user-backup';
const _MON = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

// Ist die Zeiterfassung für diese Person aktiv? (Nur dann ist ein ZE-Backup sinnvoll.)
// Nutzt den Modul-Zugriff, mit Fallback aufs Legacy-Feld crmOnly (nie fälschlich ausblenden).
function _zeActive(cu){
  try{ const ma = window.crmModuleAccess && window.crmModuleAccess(cu); if(ma && ma.zeiterfassung) return ma.zeiterfassung !== 'kein'; }catch(e){}
  return !(cu && cu.crmOnly);
}

// Monats-Schlüssel (entries/<uid>_<yyyy>_<mm>), die der angegebenen Person gehören.
// Robust gegenüber Unterstrichen in der ID: Monat + Jahr hinten abtrennen, Rest = uid.
function _ownKeys(entries, uid){
  return Object.keys(entries || {}).filter(k => {
    const p = k.split('_'); const mm = p.pop(); const yy = p.pop();
    return p.join('_') === uid && /^\d{4}$/.test(yy||'') && /^\d{2}$/.test(mm||'');
  });
}
function _keyLabel(k){ const p=k.split('_'); const mm=+p.pop(); const yy=+p.pop(); return (_MON[mm-1]||('M'+mm))+' '+yy; }
function _safe(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'Nutzer'; }
function _clr(el){ try{ if(el) el.value=''; }catch(_){} }
function _isGF(cu){ return !!(cu && (cu.role === 'geschaeftsfuehrer' || cu.role === 'admin')); }
// JSON-Objekt als Datei herunterladen.
function _dl(obj, filename){
  const body = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(body);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Backup-Daten = ZUSAMMENFÜHRUNG aus Server UND lokalem Cache, damit NICHTS verloren geht:
//  • Server ist die Basis (autoritativ, geschützte Monate sauber).
//  • Alles, was NUR lokal existiert (noch nicht synchronisierte Zeiten) ODER lokal NEUER
//    ist (per Feld-Zeitstempel _ts), wird zusätzlich übernommen.
// So deckt das Backup beide Fehlerfälle ab: (1) veralteter/geplätteter Cache verliert gegen
// den neueren Server-Wert, (2) nur lokal getippte, nie hochgeladene Zeiten bleiben erhalten.
function _mergeForBackup(server, local){
  const out = JSON.parse(JSON.stringify(server || {}));
  for(const k of Object.keys(local || {})){
    const le = local[k]; if(!le) continue;
    if(!out[k]){ out[k] = JSON.parse(JSON.stringify(le)); continue; }   // Monat nur lokal → komplett übernehmen
    const oe = out[k]; if(!oe.days) oe.days = {};
    const ld = le.days || {};
    for(const ds of Object.keys(ld)){
      if(!oe.days[ds]){ oe.days[ds] = JSON.parse(JSON.stringify(ld[ds])); continue; }  // Tag nur lokal → übernehmen
      const od = oe.days[ds], lday = ld[ds];
      const lts = lday._ts || {}, ots = od._ts || {};
      for(const f of Object.keys(lday)){                                  // Tag auf beiden Seiten → pro Feld neuere _ts gewinnt
        if(f === '_ts') continue;
        if((lts[f]||0) > (ots[f]||0)){ od[f] = lday[f]; if(!od._ts) od._ts = {}; od._ts[f] = lts[f]; }
      }
    }
  }
  return out;
}
async function _backupEntries(){
  const local = getData().entries || {};
  try{
    if(window.firebase && firebase.database && firebase.auth && firebase.auth().currentUser && !window._offlineMode){
      const server = (await firebase.database().ref('zeiterfassung/entries').once('value')).val() || {};
      return { data: _mergeForBackup(server, local), source: 'server+local' };
    }
  }catch(e){ console.warn('[Backup] Server-Lesen fehlgeschlagen, nutze nur lokalen Stand:', e && (e.code||e.message)); }
  return { data: local, source: 'local' };
}

// ── Export: eigene Zeiterfassung als JSON-Datei ────────────────────────
export async function exportOwnZE(){
  const cu = window.cu; if(!cu){ toast('Nicht angemeldet.','err'); return; }
  const { data: allEntries, source } = await _backupEntries();
  const keys = _ownKeys(allEntries, cu.id);
  const entries = {}; keys.forEach(k => { entries[k] = allEntries[k]; });
  const u = getUser(cu.id) || cu;
  const blob = {
    _type: BK_TYPE, version: 1, exportedAt: new Date().toISOString(), source,
    userId: cu.id, userName: cu.name,
    // Profil-Schnappschuss (nur zur Info im Backup – wird beim Restore NICHT geschrieben).
    profile: { name: u.name, email: u.email||'', city: u.city||'', bundesland: u.bundesland||'',
               wh: u.wh, dpw: u.dpw, al: u.al, vacHoursPerDay: u.vacHoursPerDay },
    monthCount: keys.length,
    entries
  };
  _dl(blob, 'Meine-Zeiterfassung_' + _safe(cu.name) + '_' + localISODate() + '.json');
  if(source === 'local') toast('⚠ Backup nur aus LOKALEM Stand (Server nicht erreichbar) – bei bestehender Verbindung erneut sichern.', 'err');
  else toast('Backup deiner Zeiterfassung erstellt (' + keys.length + ' Monate, Server + lokal zusammengeführt) ✓', 'ok');
}

// ── GF: alle eingereichten Berichte sichern (nur Lesen) ────────────────
// Sichert alle Monate, die eingereicht oder genehmigt sind (die „offiziellen"
// Berichte, die bei der Geschäftsführung angekommen sind). Reiner Export.
export async function exportSubmittedReports(){
  const cu = window.cu; if(!_isGF(cu)){ toast('Nur für die Geschäftsführung.','err'); return; }
  const { data: allEntries, source } = await _backupEntries();
  const entries = {}; let n = 0;
  Object.keys(allEntries).forEach(k => {
    const e = allEntries[k]; if(!e) return;
    if(e.status === 'submitted' || e.status === 'approved'){ entries[k] = e; n++; }
  });
  const blob = {
    _type: 'tps-ze-reports-backup', version: 1, exportedAt: new Date().toISOString(), source,
    byUser: cu.id, scope: 'submitted+approved', reportCount: n, entries
  };
  _dl(blob, 'Eingereichte-Berichte_' + localISODate() + '.json');
  if(source === 'local') toast('⚠ Backup nur aus LOKALEM Stand (Server nicht erreichbar) – bei bestehender Verbindung erneut sichern.', 'err');
  else toast('Backup der eingereichten Berichte erstellt (' + n + ' Berichte, Server + lokal zusammengeführt) ✓', 'ok');
}

// ── Import aus Datei → Vorschau → Restore ──────────────────────────────
let _pending = null;   // {src, keys} zwischen Vorschau und Bestätigung

export function importOwnZEFile(inputEl){
  const file = inputEl && inputEl.files && inputEl.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let blob = null;
    try{ blob = JSON.parse(ev.target.result); }catch(e){ toast('Datei ist kein gültiges JSON.','err'); _clr(inputEl); return; }
    _previewRestore(blob, inputEl);
  };
  reader.readAsText(file);
}

function _previewRestore(blob, inputEl){
  const cu = window.cu; if(!cu){ toast('Nicht angemeldet.','err'); _clr(inputEl); return; }
  // Quelle: eigenes ZE-Backup, Voll-Backup oder rohes ZE-Blob → jeweils die entries herausziehen.
  let src = null;
  if(blob && blob._type === BK_TYPE) src = blob.entries;
  else if(blob && blob._type === 'tps-vollbackup' && blob.zeiterfassung) src = blob.zeiterfassung.entries;
  else if(blob && blob.entries) src = blob.entries;
  if(!src || typeof src !== 'object'){ toast('Keine Zeiterfassungs-Daten in der Datei gefunden.','err'); _clr(inputEl); return; }

  const d = getData();
  const ownKeys = _ownKeys(src, cu.id);
  const restore = [], approved = [];
  ownKeys.forEach(k => { const cur = d.entries[k]; if(cur && cur.status === 'approved') approved.push(k); else restore.push(k); });
  const foreign = Object.keys(src).length - ownKeys.length;
  _clr(inputEl);

  if(!restore.length){
    openModal('<h3 style="margin-bottom:10px">↩ Zeiterfassung wiederherstellen</h3>'
      + '<p style="color:var(--muted);font-size:13px">Nichts wiederherzustellen.'
      + (approved.length ? ' Alle ' + approved.length + ' passenden Monate sind bereits <b>genehmigt</b> und damit geschützt.' : '')
      + (foreign ? ' Die Datei enthält außerdem ' + foreign + ' Monat(e), die nicht zu deinem Konto gehören (übersprungen).' : '')
      + '</p><div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
    return;
  }

  restore.sort();
  _pending = { src, keys: restore };
  const list = restore.map(k => '<span class="chip" style="font-size:11px;margin:2px">' + esc(_keyLabel(k)) + '</span>').join('');
  openModal('<h3 style="margin-bottom:8px">↩ Zeiterfassung wiederherstellen</h3>'
    + '<p style="font-size:13px;color:var(--muted);margin-bottom:10px">Folgende <b>' + restore.length + ' Monate</b> werden aus dem Backup in deine Zeiterfassung eingespielt:</p>'
    + '<div style="margin-bottom:12px;line-height:1.9">' + list + '</div>'
    + '<div style="background:#f0f4f8;border-radius:8px;padding:10px 12px;font-size:12px;color:var(--text);margin-bottom:6px">'
    + '↳ Fehlende Tage werden <b>ergänzt</b>, abweichende aus dem Backup <b>übernommen</b>. Bereits vorhandene Daten gehen dabei <b>nicht verloren</b>.'
    + (approved.length ? '<br>🔒 ' + approved.length + ' <b>genehmigte</b> Monat(e) werden übersprungen (geschützt).' : '')
    + (foreign ? '<br>ℹ ' + foreign + ' Monat(e) aus der Datei gehören nicht zu deinem Konto und werden übersprungen.' : '')
    + '</div>'
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>'
    + '<button class="btn btn-ok" onclick="ubConfirmRestore()">↩ Wiederherstellen</button></div>');
}

// Restore ausführen: feldgenaues MERGE der eigenen, nicht-genehmigten Monate.
export function ubConfirmRestore(){
  const p = _pending; _pending = null;
  if(!p || !p.keys || !p.keys.length){ closeModal(); return; }
  const cu = window.cu;
  let months = 0, days = 0;
  mutate(dd => {
    if(!dd.entries) dd.entries = {};
    p.keys.forEach(k => {
      // Doppelte Absicherung: nur eigene, nicht genehmigte Monate anfassen.
      const kp = k.split('_'); kp.pop(); kp.pop();
      if(kp.join('_') !== cu.id) return;
      const cur0 = dd.entries[k];
      if(cur0 && cur0.status === 'approved') return;
      const bk = p.src[k]; if(!bk) return;
      let cur = dd.entries[k];
      if(!cur){ cur = dd.entries[k] = { status:'draft', carryover:Number(bk.carryover)||0, managerNote:'', submittedAt:null, reviewedAt:null, reviewedBy:null, days:{} }; }
      if(!cur.days) cur.days = {};
      const bdays = bk.days || {};
      for(const ds of Object.keys(bdays)){
        const day = Object.assign({}, bdays[ds]); delete day._ts;   // frische _ts erzeugt mutate → Restore gewinnt beim Merge
        cur.days[ds] = day; days++;
      }
      // Übertrag nur füllen, wenn aktuell keiner gesetzt ist (vorhandenen nicht überschreiben).
      if((cur.carryover === undefined || cur.carryover === 0) && typeof bk.carryover === 'number') cur.carryover = bk.carryover;
      months++;
    });
  });
  closeModal();
  toast(months + ' Monat(e) wiederhergestellt (' + days + ' Tage) ✓', 'ok');
  try{ window.renderZeiterfassung && window.renderZeiterfassung(); window.renderOverview && window.renderOverview(); }catch(e){}
}

// ══════════════════════════════════════════════════════════════════
//  Phase 2 – Automatischer Cloud-Schnappschuss (Firebase Storage) am 10.
//  • Opt-in per Häkchen im Profil (localStorage, pro Gerät).
//  • Läuft beim ersten App-Start am/nach dem 10., 1× pro Monat (Merker localStorage).
//  • Ziel: backups/user/<authUid>/<YYYY-MM>_ze.json  (+ _reports.json für GF).
//  • Quelle wie beim manuellen Backup: Server + lokal zusammengeführt.
//  • Best effort: schlägt still fehl, solange die Storage-Regel noch nicht veröffentlicht ist.
//  • Wiederherstellen aus der Cloud: eigene Schnappschuss-Liste → auswählen → gleicher Restore.
// ══════════════════════════════════════════════════════════════════
const _AB_ON_KEY = 'tp_zt_autobackup';        // '1' = aktiviert (pro Gerät)
const _AB_LAST_KEY = 'tp_zt_autobackup_last';  // 'YYYY-MM' = letzter erledigter Monat

export function autoBackupOn(){ try{ return localStorage.getItem(_AB_ON_KEY) === '1'; }catch(e){ return false; } }
export function toggleAutoBackup(cb){
  try{ localStorage.setItem(_AB_ON_KEY, cb && cb.checked ? '1' : '0'); }catch(e){}
  toast(cb && cb.checked ? 'Automatische Monats-Sicherung aktiviert (dieses Gerät) ✓' : 'Automatische Monats-Sicherung deaktiviert.', 'ok');
  if(cb && cb.checked) setTimeout(() => { try{ runAutoUserBackup(); }catch(e){} }, 500);   // gleich einmal versuchen
}

function _storageReady(){
  try{ return !!(window.firebase && firebase.storage && firebase.auth && firebase.auth().currentUser
    && window.cu && !window._offlineMode && !window._cloudUnverified); }catch(e){ return false; }
}
function _putStorage(path, obj){
  const body = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  return firebase.storage().ref(path).put(body, { contentType: 'application/json' });
}

// Wird 20 s nach Login über backup.js/runAutoBackup ausgelöst.
export async function runAutoUserBackup(){
  try{
    const cu = window.cu; if(!cu || !autoBackupOn()) return;
    if(!_zeActive(cu) && !_isGF(cu)) return;
    const now = new Date();
    if(now.getDate() < 10) return;                        // erst ab dem 10.
    const ym = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
    try{ if(localStorage.getItem(_AB_LAST_KEY) === ym) return; }catch(e){}   // diesen Monat schon erledigt
    if(!_storageReady()) return;
    const uid = firebase.auth().currentUser.uid;
    const { data: allEntries } = await _backupEntries();
    if(_zeActive(cu)){
      const keys = _ownKeys(allEntries, cu.id); const entries = {}; keys.forEach(k => entries[k] = allEntries[k]);
      await _putStorage('backups/user/'+uid+'/'+ym+'_ze.json',
        { _type:BK_TYPE, version:1, exportedAt:new Date().toISOString(), source:'auto', userId:cu.id, userName:cu.name, monthCount:keys.length, entries });
    }
    if(_isGF(cu)){
      const entries = {}; let n = 0;
      Object.keys(allEntries).forEach(k => { const e = allEntries[k]; if(e && (e.status==='submitted'||e.status==='approved')){ entries[k]=e; n++; } });
      await _putStorage('backups/user/'+uid+'/'+ym+'_reports.json',
        { _type:'tps-ze-reports-backup', version:1, exportedAt:new Date().toISOString(), source:'auto', byUser:cu.id, reportCount:n, entries });
    }
    try{ localStorage.setItem(_AB_LAST_KEY, ym); }catch(e){}
    console.info('[UserBackup] Monats-Schnappschuss ' + ym + ' in der Cloud gespeichert.');
  }catch(e){
    console.warn('[UserBackup] Auto-Cloud-Backup fehlgeschlagen (Storage-Regel schon veröffentlicht?):', e && (e.code||e.message));
  }
}

// Eigene Cloud-Schnappschüsse auflisten + wiederherstellen.
export async function showCloudSnapshots(){
  const cu = window.cu; if(!cu){ toast('Nicht angemeldet.','err'); return; }
  if(!_storageReady()){ toast('Cloud gerade nicht erreichbar – bitte online und angemeldet erneut versuchen.','err'); return; }
  openModal('<h3 style="margin-bottom:10px">☁ Cloud-Schnappschüsse</h3><p style="color:var(--muted)">Lädt …</p>');
  let items = [];
  try{
    const uid = firebase.auth().currentUser.uid;
    const res = await firebase.storage().ref('backups/user/'+uid).listAll();
    items = res.items.map(i => i.name).sort().reverse();
  }catch(e){
    openModal('<h3 style="margin-bottom:10px">☁ Cloud-Schnappschüsse</h3><p style="color:var(--danger)">Konnte nicht geladen werden ('+esc((e&&(e.code||e.message))||'')+'). Ist die Storage-Regel veröffentlicht?</p><div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
    return;
  }
  const zeItems = items.filter(n => /_ze\.json$/.test(n));
  const repItems = items.filter(n => /_reports\.json$/.test(n));
  const _row = (n, isReport) => { const ym = n.slice(0,7);
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">'
      + '<span>'+esc(ym)+(isReport?' <span class="chip" style="font-size:10px">Berichte</span>':'')+'</span>'
      + '<button class="btn btn-outline btn-sm" onclick="ubDownloadCloud(\''+esc(n)+'\')">⬇ Laden</button>'
      + '</div>'; };
  const body = (zeItems.length || repItems.length)
    ? (zeItems.length ? '<div style="font-size:12px;font-weight:700;color:var(--primary);margin:4px 0">Meine Zeiterfassung</div>'+zeItems.map(n=>_row(n,false)).join('') : '')
      + (repItems.length ? '<div style="font-size:12px;font-weight:700;color:var(--primary);margin:10px 0 4px">Eingereichte Berichte</div>'+repItems.map(n=>_row(n,true)).join('') : '')
    : '<p style="color:var(--muted)">Noch keine Cloud-Schnappschüsse vorhanden. Sie entstehen automatisch am 10. (wenn aktiviert).</p>';
  openModal('<h3 style="margin-bottom:6px">☁ Cloud-Schnappschüsse</h3>'
    + '<p style="font-size:12px;color:var(--muted);margin-bottom:12px">Automatische Monats-Sicherungen. Zum Wiederherstellen den Schnappschuss <b>herunterladen</b> und dann oben über <b>„⬆ Backup wiederherstellen"</b> einspielen (spielt nur deine eigenen, nicht genehmigten Monate ein, mit Vorschau).</p>'
    + '<div style="max-height:50vh;overflow-y:auto">'+body+'</div>'
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
}
// Download eines Cloud-Schnappschusses OHNE fetch → kein CORS-Problem: die Download-URL
// direkt als Browser-Download aufrufen (wie js/backup.js). Wiederherstellen danach über
// „⬆ Backup wiederherstellen" (importOwnZEFile) – spielt die heruntergeladene Datei ein.
export async function ubDownloadCloud(name){
  try{
    if(!_storageReady()){ toast('Cloud gerade nicht erreichbar.','err'); return; }
    const uid = firebase.auth().currentUser.uid;
    const url = await firebase.storage().ref('backups/user/'+uid+'/'+name).getDownloadURL();
    const a = document.createElement('a'); a.href = url; a.download = 'Cloud_'+name; a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('Schnappschuss wird heruntergeladen – danach über „⬆ Backup wiederherstellen" einspielen.','ok');
  }catch(e){ toast('Download fehlgeschlagen ('+((e&&(e.code||e.message))||'')+').','err'); }
}

// ── UI-Abschnitt für den Profil-Dialog ─────────────────────────────────
// Wird nur angezeigt, wenn die Zeiterfassung für die Person aktiv ist.
export function ownBackupSectionHtml(cu){
  cu = cu || window.cu; if(!cu) return '';
  let html = '';
  if(_zeActive(cu)){
    html += '<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">'
      + '<div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">💾 Meine Zeiterfassung sichern</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Sichert deine eigene Zeiterfassung (alle Monate) als Datei. Falls mal Daten durch einen Anzeige-/Cache-Fehler verschwinden, kannst du sie hieraus wiederherstellen. Genehmigte Monate sind ohnehin geschützt.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button type="button" class="btn btn-outline" onclick="exportOwnZE()">⬇ Backup herunterladen</button>'
      + '<label class="btn btn-outline" style="cursor:pointer;margin:0">⬆ Backup wiederherstellen'
      + '<input type="file" accept="application/json,.json" style="display:none" onchange="importOwnZEFile(this)"></label>'
      + '</div>';
  }
  if(_isGF(cu)){
    html += '<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">'
      + '<div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">📥 Eingereichte Berichte sichern</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Sichert alle <b>eingereichten und genehmigten</b> Monatsberichte aller Mitarbeiter als Datei – dein persönliches Backup der offiziellen Berichte.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button type="button" class="btn btn-outline" onclick="exportSubmittedReports()">⬇ Eingereichte Berichte herunterladen</button>'
      + '</div>';
  }
  // Cloud-Schnappschüsse + automatische Monats-Sicherung (für ZE-Nutzer und GF).
  if(_zeActive(cu) || _isGF(cu)){
    html += '<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">'
      + '<div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:8px">☁ Cloud-Sicherung</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:10px">Automatische Sicherung in der Cloud, einmal im Monat ab dem 10. Wiederherstellen jederzeit aus der Liste.</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'
      + '<button type="button" class="btn btn-outline" onclick="showCloudSnapshots()">☁ Cloud-Schnappschüsse …</button>'
      + '</div>'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">'
      + '<input type="checkbox" onchange="toggleAutoBackup(this)"' + (autoBackupOn() ? ' checked' : '') + '>'
      + 'Automatische Monats-Sicherung am 10. aktivieren <span style="color:var(--muted);font-size:11px">(dieses Gerät)</span></label>';
  }
  return html;
}

try{
  window.exportOwnZE = exportOwnZE;
  window.exportSubmittedReports = exportSubmittedReports;
  window.importOwnZEFile = importOwnZEFile;
  window.ubConfirmRestore = ubConfirmRestore;
  window.ownBackupSectionHtml = ownBackupSectionHtml;
  window.runAutoUserBackup = runAutoUserBackup;
  window.toggleAutoBackup = toggleAutoBackup;
  window.autoBackupOn = autoBackupOn;
  window.showCloudSnapshots = showCloudSnapshots;
  window.ubDownloadCloud = ubDownloadCloud;
}catch(_){}
