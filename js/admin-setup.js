// ══════════════════════════════════════════════════════════════════
//  Sicherheits-Setup (einmalig beim Cutover, danach für neue Nutzer)
//  Provisioniert für JEDEN Nutzer ein technisches Firebase-Konto
//  (id@tps.intern, Stabil-Passwort) und befüllt:
//    - zeiterfassung/loginDir/{id} = { name }   (öffentliches Namensverzeichnis)
//    - zeiterfassung/allowed/{uid} = true       (Zugriffs-Allowlist)
//  Muss von einem bereits ANGEMELDETEN, freigeschalteten Admin laufen
//  (die Schreibzugriffe auf allowed/loginDir verlangen das per Regeln).
//  Idempotent: bereits vorhandene Konten werden nur angemeldet, nicht doppelt angelegt.
// ══════════════════════════════════════════════════════════════════
import { _PW_SALT, STORAGE_KEY } from './config.js';
import { getData, setDataCache } from './data.js';

const _accountEmail = id => String(id||'').toLowerCase().replace(/[^a-z0-9._-]/g,'') + '@tps.intern';
const _stableAuthPw = id => 'tpsfb$'+String(id||'').toLowerCase()+'$'+_PW_SALT;

// WICHTIG: Firebase verstümmelt Umlaute in DATENBANK-SCHLÜSSELN zu U+FFFD (Werte bleiben ok).
// Deshalb wird das Login-Verzeichnis unter einem ASCII-Schlüssel abgelegt (ö→oe usw.), und die
// ECHTE id steht im WERT ({id,name}). So bleibt der Schlüssel stabil (kein „j?rg"-Endlosfehler),
// und beim Lesen wird die echte id aus dem Wert genommen (firebase.js getLoginDirUsers).
const _dirKey = id => String(id||'')
  .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
  .replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue')
  .replace(/ß/g,'ss')
  .replace(/[^A-Za-z0-9._-]/g,'') || 'u';

// Liefert eine sekundäre App-Instanz (damit die Admin-Sitzung erhalten bleibt).
function _secApp(){
  const cfg=firebase.app().options;
  return (firebase.apps||[]).find(a=>a.name==='prov') || firebase.initializeApp(cfg,'prov');
}

export async function runSecuritySetup(opts){
  opts=opts||{};
  const log=opts.log||((m)=>console.log('[SecuritySetup]',m));
  const data=getData();
  if(!data||!Array.isArray(data.users)||!data.users.length) throw new Error('Keine Nutzerdaten geladen.');
  if(!firebase.auth().currentUser) throw new Error('Bitte zuerst als Admin anmelden.');

  const sec=_secApp();
  const users=data.users;
  const db=firebase.database();
  // Bereits provisionierte Nutzer (stehen schon im loginDir) NICHT erneut anfassen –
  // sonst scheitert das Stabil-Passwort bei bereits migrierten Konten.
  let existingDir={};
  try{ existingDir=(await db.ref('zeiterfassung/loginDir').once('value')).val()||{}; }catch(_){}
  const loginDir={};
  const allowed={};
  let created=0, existing=0, skipped=0, failed=0;
  const problems=[];

  for(const u of users){
    if(!u||!u.id) continue;
    const id=u.id;
    const dk=_dirKey(id);
    loginDir[dk]={ id, name:u.name||id };   // ASCII-Schlüssel + echte id im Wert (Umlaut-sicher)
    if(existingDir[dk]){ skipped++; log(`${id}: bereits eingerichtet (übersprungen)`); continue; }
    const em=_accountEmail(id);
    const pw=_stableAuthPw(id);
    let uid=null;
    try{
      const c=await sec.auth().createUserWithEmailAndPassword(em, pw);
      uid=c.user.uid; created++;
    }catch(e){
      if(e && e.code==='auth/email-already-in-use'){
        try{ const c=await sec.auth().signInWithEmailAndPassword(em, pw); uid=c.user.uid; existing++; }
        catch(e2){ failed++; problems.push(id+': existiert, aber Stabil-PW greift nicht (evtl. schon migriert) – manuell prüfen'); }
      } else { failed++; problems.push(id+': '+(e&&e.code||e)); }
    }
    if(uid) allowed[uid]=true;
    log(`${id}: ${uid?('uid '+uid.slice(0,6)+'…'):'FEHLER'}`);
  }
  try{ await sec.auth().signOut(); }catch(_){}

  // Mit der Admin-Sitzung schreiben (Regeln verlangen allowlisteten Nutzer).
  await db.ref('zeiterfassung/loginDir').update(loginDir);
  await db.ref('zeiterfassung/allowed').update(allowed);

  const summary={ users:users.length, created, existing, skipped, failed, allowlistedNew:Object.keys(allowed).length, problems };
  log('Fertig: '+JSON.stringify(summary));
  return summary;
}

// Einzelnen Nutzer neu provisionieren (Firebase-Konto + loginDir + allowed).
// Für kaputte/gelöschte Konten (z. B. beschädigte Umlaut-ID): legt das Konto mit dem
// Stabil-Passwort NEU an und trägt Verzeichnis + Allowlist ein. Existiert das Konto noch
// mit UNBEKANNTEM Passwort, muss es zuerst in der Firebase-Konsole (Authentication)
// gelöscht werden – dann liefert diese Funktion eine klare Meldung.
export async function reprovisionUser(id){
  const data=getData();
  const u=(data.users||[]).find(x=>x&&x.id===id);
  if(!u) throw new Error('Nutzer nicht gefunden.');
  if(!firebase.auth().currentUser) throw new Error('Bitte zuerst als Admin anmelden.');
  const sec=_secApp();
  const em=_accountEmail(id), pw=_stableAuthPw(id);
  let uid=null, note='';
  try{ const c=await sec.auth().createUserWithEmailAndPassword(em, pw); uid=c.user.uid; note='Konto neu angelegt'; }
  catch(e){
    if(e && e.code==='auth/email-already-in-use'){
      try{ const c=await sec.auth().signInWithEmailAndPassword(em, pw); uid=c.user.uid; note='Konto vorhanden (Stabil-PW ok)'; }
      catch(e2){ try{ await sec.auth().signOut(); }catch(_){}
        throw new Error('Das Login-Konto '+em+' existiert noch mit einem unbekannten Passwort. Bitte es zuerst in der Firebase-Konsole unter „Authentication" löschen und dann erneut „Zugang neu aufsetzen".'); }
    } else { throw e; }
  }
  try{ await sec.auth().signOut(); }catch(_){}
  const db=firebase.database();
  await db.ref('zeiterfassung/loginDir').update({ [_dirKey(id)]: { id, name: u.name||id } });
  if(uid) await db.ref('zeiterfassung/allowed').update({ [uid]: true });
  return { id, uid, email:em, note };
}

// ══════════════════════════════════════════════════════════════════
//  ID-Migration: Nicht-ASCII aus einer Login-ID entfernen (z. B. jörg→joerg)
//  Grund: Umlaute in Firebase-SCHLÜSSELN überleben den Round-Trip nicht
//  zuverlässig (→ „j?rg"). Nach der Migration ist die ID rein ASCII →
//  der Fehler kann in KEINEM Schlüssel mehr entstehen (loginDir, entries,
//  stamps, vacRequests, teamReports, yearReports, crm/access).
// ══════════════════════════════════════════════════════════════════

// Reiner Transform (OHNE Seiteneffekte, offline testbar): tiefe Kopie, ersetzt oldId überall.
export function _migrateIdInBlob(d, oldId, newId){
  const clone=JSON.parse(JSON.stringify(d));
  const report={ entries:0, stamps:0, vacRequests:0, yearReports:0, teamReports:0, values:0 };
  // 1) WERT-Pass: jeder String-Wert === oldId → newId. Fängt users[].id, reviewedBy, userId,
  //    employeeIds[], leitungId, sentBy, deputyId, byId, statusLog[].by, carryoverLog[].by, uid …
  (function walk(o){
    if(Array.isArray(o)){ for(let i=0;i<o.length;i++){ const v=o[i]; if(v===oldId){ o[i]=newId; report.values++; } else if(v&&typeof v==='object') walk(v); } return; }
    if(o&&typeof o==='object'){ for(const k of Object.keys(o)){ const v=o[k]; if(v===oldId){ o[k]=newId; report.values++; } else if(v&&typeof v==='object') walk(v); } }
  })(clone);
  // 2) SCHLÜSSEL-Pass: zusammengesetzte Schlüssel mit der ID am Anfang umschlüsseln.
  const lead=oldId+'_';
  const rekey=(name, fn, ck)=>{ const map=clone[name]; if(!map||typeof map!=='object'||Array.isArray(map)) return; for(const key of Object.keys(map)){ const nk=fn(key); if(nk&&nk!==key){ if(map[nk]===undefined){ map[nk]=map[key]; } delete map[key]; report[ck]++; } } };
  rekey('entries',     k=> (k===oldId||k.startsWith(lead)) ? newId+k.slice(oldId.length) : null, 'entries');
  rekey('stamps',      k=> (k===oldId) ? newId : null, 'stamps');
  rekey('vacRequests', k=> k.startsWith(lead) ? newId+k.slice(oldId.length) : null, 'vacRequests');
  rekey('yearReports', k=> k.startsWith(lead) ? newId+k.slice(oldId.length) : null, 'yearReports');
  rekey('teamReports', k=> k.startsWith(lead) ? newId+k.slice(oldId.length) : (k.startsWith('LEIT_'+lead) ? 'LEIT_'+newId+k.slice(('LEIT_'+oldId).length) : null), 'teamReports');
  return { data:clone, report };
}

// Rest-Vorkommen von id finden (Schlüssel ODER Wert) – Sicherheitsprüfung NACH dem Transform.
export function _scanForId(o, id, path, hits){
  path=path||''; hits=hits||[];
  if(hits.length>25) return hits;
  const keyHit=k=> k===id || k.startsWith(id+'_') || k.startsWith('LEIT_'+id+'_');
  if(Array.isArray(o)){ for(let i=0;i<o.length;i++){ const v=o[i]; if(v===id) hits.push(path+'['+i+']=WERT'); else if(v&&typeof v==='object') _scanForId(v,id,path+'['+i+']',hits); } return hits; }
  if(o&&typeof o==='object'){ for(const k of Object.keys(o)){ if(keyHit(k)) hits.push(path+'/'+k+'=SCHLÜSSEL'); const v=o[k]; if(v===id) hits.push(path+'/'+k+'=WERT'); else if(v&&typeof v==='object') _scanForId(v,id,path+'/'+k,hits); } }
  return hits;
}

// Baut ein MINIMALES Firebase-update: nur geänderte Pfade (alte Schlüssel→null, neue/geänderte→Wert).
// So wird NICHT ein ganzer Container überschrieben → parallele Änderungen anderer Geräte gehen nicht verloren.
export function _buildMigrateUpdate(orig, nd){
  const upd={};
  ['entries','stamps','vacRequests','teamReports','yearReports'].forEach(c=>{
    const o=(orig&&orig[c])||{}, n=(nd&&nd[c])||{};
    for(const k of Object.keys(o)){ if(!(k in n)) upd[c+'/'+k]=null; }              // entfernter/umgeschlüsselter alter Key
    for(const k of Object.keys(n)){ if(JSON.stringify(n[k])!==JSON.stringify(o[k])) upd[c+'/'+k]=n[k]; }  // neu/geändert
  });
  if(JSON.stringify(orig.users)!==JSON.stringify(nd.users)) upd['users']=nd.users;                 // Array, klein, admin-verwaltet
  if(nd.vertretungen!==undefined && JSON.stringify(orig.vertretungen)!==JSON.stringify(nd.vertretungen)) upd['vertretungen']=nd.vertretungen;
  return upd;
}

// Ausführen: benennt oldId → newId in der GESAMTEN Datenschicht um. Muss als angemeldeter Admin laufen.
export async function migrateUserId(oldId, newId, opts){
  opts=opts||{}; const log=opts.log||(m=>console.log('[migrateUserId]',m));
  if(!oldId||!newId||oldId===newId) throw new Error('Ungültige IDs.');
  if(!/^[a-z0-9._-]+$/.test(newId)) throw new Error('Neue ID muss reines ASCII sein (a–z 0–9 . _ -): '+newId);
  if(!firebase.auth().currentUser) throw new Error('Bitte zuerst als Admin anmelden.');
  const d=getData();
  if(!d||!Array.isArray(d.users)||d.users.length<2) throw new Error('Keine (vollständigen) Daten geladen – abgebrochen.');
  if(!d.users.find(u=>u&&u.id===oldId)) throw new Error('Alte ID nicht gefunden: '+oldId);
  if(d.users.find(u=>u&&u.id===newId)) throw new Error('Neue ID existiert bereits: '+newId);
  // Zusätzliches Sicherheits-Backup (neben dem manuellen Export) in localStorage.
  try{ localStorage.setItem('tp_zt_premigrate_'+newId, JSON.stringify(d)); }catch(e){}
  const beforeEntries=Object.keys(d.entries||{}).length, beforeUsers=d.users.length;
  log('Vorher: '+beforeUsers+' Nutzer, '+beforeEntries+' Monats-Einträge.');
  const { data:nd, report }=_migrateIdInBlob(d, oldId, newId);
  // Verifikation VOR dem Schreiben
  if(Object.keys(nd.entries||{}).length!==beforeEntries) throw new Error('Entry-Anzahl weicht ab – abgebrochen.');
  if(nd.users.length!==beforeUsers) throw new Error('Nutzer-Anzahl weicht ab – abgebrochen.');
  if(!nd.users.find(u=>u&&u.id===newId)||nd.users.find(u=>u&&u.id===oldId)) throw new Error('User-Datensatz nicht sauber umgestellt – abgebrochen.');
  // NUR die Daten prüfen, die wir wirklich schreiben. loginDir/allowed/pwResetTokens werden
  // separat behandelt (reprovisionUser + Login-Cleanup), NICHT über den Haupt-Write – daher hier ausklammern.
  const scanTarget={}; ['users','entries','stamps','vacRequests','teamReports','yearReports','vertretungen'].forEach(kk=>{ if(nd[kk]!==undefined) scanTarget[kk]=nd[kk]; });
  const rest=_scanForId(scanTarget, oldId);
  if(rest.length){ throw new Error('Nach Transform noch '+rest.length+'× "'+oldId+'": '+rest.slice(0,8).join(' , ')+' – NICHTS geschrieben.'); }
  log('Transform OK '+JSON.stringify(report)+' – keine Rest-Vorkommen von "'+oldId+'".');
  // Schreiben: betroffene Top-Level-Knoten KOMPLETT ersetzen (entfernt alte Schlüssel); Rest unberührt.
  const ref=window._fbRef; if(!ref) throw new Error('Keine Firebase-Verbindung.');
  const upd=_buildMigrateUpdate(d, nd);   // NUR geänderte Pfade – keine Ganz-Container-Überschreibung
  const paths=Object.keys(upd);
  log('Schreibe '+paths.length+' Pfade (alte Schlüssel→gelöscht, neue→Wert).');
  if(paths.length) await ref.update(JSON.parse(JSON.stringify(upd)));
  setDataCache(nd); try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(nd)); }catch(e){}
  log('Hauptdaten geschrieben.');
  // CRM-Zugriff übertragen (best effort, separater crm-Baum)
  try{
    const acc=window.crmUserAccess?window.crmUserAccess(oldId):null;
    if(acc&&acc.level&&acc.level!=='none'&&window.crmSetUserAccess){ await window.crmSetUserAccess(newId, acc.level, acc.vereinIds||[]); await window.crmSetUserAccess(oldId,'none',[]); log('CRM-Zugriff übertragen ('+acc.level+').'); }
  }catch(e){ log('CRM-Zugriff Warnung: '+((e&&e.message)||e)); }
  // Auth-Konto + loginDir(ASCII) + allowed für die neue ID
  try{ const r=await reprovisionUser(newId); log('Login eingerichtet: '+((r&&r.email)||newId)+' – '+((r&&r.note)||'')); }
  catch(e){ log('Login-Setup-Hinweis: '+((e&&e.message)||e)); }
  // Alten Login-Verzeichnis-Eintrag der ALTEN id entfernen – sonst gibt es zwei Einträge mit
  // demselben Namen und der Namensabgleich beim Login könnte den (toten) alten treffen → Logout.
  try{
    const dir=(await firebase.database().ref('zeiterfassung/loginDir').once('value')).val()||{};
    const del={}; Object.keys(dir).forEach(k=>{ const e=dir[k]||{}; if((e.id||k)===oldId) del[k]=null; });
    if(Object.keys(del).length){ await firebase.database().ref('zeiterfassung/loginDir').update(del); log('Alte Login-Einträge entfernt: '+Object.keys(del).join(', ')); }
  }catch(e){ log('Login-Cleanup-Hinweis: '+((e&&e.message)||e)); }
  log('FERTIG. Jörg bitte einmal neu einloggen (Name bleibt „Jörg Aleith", Passwort neu setzen).');
  return { ok:true, report };
}

// Für Konsole/Button erreichbar machen.
try{ window.runSecuritySetup = runSecuritySetup; }catch(_){}
try{ window.migrateUserId = migrateUserId; }catch(_){}
try{ window.reprovisionUser = reprovisionUser; }catch(_){}
