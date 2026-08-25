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
import { _PW_SALT } from './config.js';
import { getData } from './data.js';

const _accountEmail = id => String(id||'').toLowerCase().replace(/[^a-z0-9._-]/g,'') + '@tps.intern';
const _stableAuthPw = id => 'tpsfb$'+String(id||'').toLowerCase()+'$'+_PW_SALT;

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
    loginDir[id]={ name:u.name||id };   // Name im Verzeichnis immer aktuell halten
    if(existingDir[id]){ skipped++; log(`${id}: bereits eingerichtet (übersprungen)`); continue; }
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
  await db.ref('zeiterfassung/loginDir').update({ [id]: { name: u.name||id } });
  if(uid) await db.ref('zeiterfassung/allowed').update({ [uid]: true });
  return { id, uid, email:em, note };
}

// Für Konsole/Button erreichbar machen.
try{ window.runSecuritySetup = runSecuritySetup; }catch(_){}
try{ window.reprovisionUser = reprovisionUser; }catch(_){}
