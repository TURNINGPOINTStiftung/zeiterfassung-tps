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
import { localISODate, openModal, esc, toast } from './utils.js';

const KEEP_DAILY_DAYS = 90;
let _running = false;

function _ready(){
  return !!(window.firebase && firebase.storage && firebase.auth && firebase.auth().currentUser
    && window.cu && !window._offlineMode && !window._cloudUnverified);
}

export async function runAutoBackup(){
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
        const blob = { _type:'tps-vollbackup', source:'auto', exportedAt:new Date().toISOString(),
                       byUser:window.cu.id, zeiterfassung:ze, crm };
        const body = new Blob([JSON.stringify(blob)], {type:'application/json'});
        // Merker NUR nach erfolgreichem Upload setzen. Wird verweigert (Datei existiert schon, weil
        // ein anderes Gerät gleichzeitig schneller war – oder Regeln noch nicht aktiv), bleibt der
        // Merker unberührt; das erfolgreiche Gerät setzt ihn.
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
    ? names.map(n=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)"><span>'+esc(n.slice(0,10))+(/^\d{4}-\d{2}-01_/.test(n)?' <span class="chip" style="font-size:10px">dauerhaft</span>':'')+'</span><button class="btn btn-outline btn-sm" onclick="downloadAppBackup(\''+esc(n)+'\')">⬇ Laden</button></div>').join('')
    : '<p style="color:var(--muted)">Noch keine App-Backups vorhanden.</p>';
  openModal('<h3 style="margin-bottom:6px">☁ Automatische App-Backups</h3>'
    +'<p style="font-size:12px;color:var(--muted);margin-bottom:12px">Täglich automatisch (Server-Stand). Aufbewahrung 90 Tage, der 1. jedes Monats dauerhaft. Einspielen über „Backup einspielen (JSON)".</p>'
    +'<div style="max-height:50vh;overflow-y:auto">'+rows+'</div>'
    +'<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Schließen</button></div>');
}

try{ window.runAutoBackup = runAutoBackup; window.listAppBackups = listAppBackups; window.downloadAppBackup = downloadAppBackup; window.showAppBackups = showAppBackups; }catch(_){}
