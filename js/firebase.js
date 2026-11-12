import { STORAGE_KEY, _STAMP_KEY } from './config.js';
import { freshData, _migrate, getData, setDataCache, mutate, entryKey, noteGoodData, fbWriteMerge, mergeIncoming, flushPendingWrites, isAdminAccount } from './data.js';
import { addMin, diffMin, getHolidays } from './utils.js';
import { mfaResolve, mfaFriendly } from './mfa.js';

// ── Echte Firebase-Konten (Phase 1) ───────────────────────────────
// Bevorzugt die hinterlegte echte E-Mail; sonst technische E-Mail je ID
// (damit der Name-Login erhalten bleibt und niemand ohne E-Mail aussteigt).
function _accountEmail(id, email){
  // Die Firebase-Konto-Adresse wird IMMER technisch aus der id abgeleitet
  // (kein echtes E-Mail nötig). Vorteil: im öffentlichen loginDir stehen NUR
  // Namen, keine Mitarbeiter-E-Mails (kein PII-Leak), und die Adresse ist für
  // den Login-Client deterministisch berechenbar. (email-Param bleibt aus
  // Kompatibilität in der Signatur, wird aber nicht mehr verwendet.)
  return String(id||'').toLowerCase().replace(/[^a-z0-9._-]/g,'') + '@tps.intern';
}

// ── Login-Verzeichnis (öffentlich lesbar: nur Namen) ──────────────────
// SICHERHEIT (Umbau 2026-08): Vor dem Login liest der Client NICHT mehr die
// ganze Datenbank. Die echten Daten sind per Firebase-Regeln auf angemeldete,
// allowlistete Nutzer beschränkt und werden erst NACH dem Login geladen
// (loadFullData). Für die Login-Maske genügt das öffentliche Namensverzeichnis
// zeiterfassung/loginDir. Das frühere Bootstrap-Vollzugriffs-Konto entfällt.
export function getLoginDirUsers(){ return Array.isArray(window._loginDir)?window._loginDir:[]; }

// Wartet einmalig, bis Firebase den (evtl. persistierten) Anmeldestatus geklärt hat.
function _awaitAuthReady(){
  return new Promise(res=>{ try{ const u=firebase.auth().onAuthStateChanged(()=>{ try{u();}catch(_){}; res(firebase.auth().currentUser||null); }); }catch(e){ res(null); } });
}

// Login: Firebase prüft das Passwort (verifyFn bleibt nur der Signatur wegen, ungenutzt).
// Rückgabe {ok, migrated} bzw. {ok:false, reason}.
export async function authenticate(id, email, typedPw, verifyFn){
  const auth=firebase.auth();
  const acct=_accountEmail(id, email);
  // Seit v429: Das Passwort prüft ausschließlich Firebase. App-seitige Hashes (users[].pw) gibt es
  // nicht mehr (waren für alle Freigeschalteten lesbar), damit entfällt auch der frühere Übergangs-
  // Fallback über das berechenbare Stabil-Passwort. Konten, die noch auf dem Stabil-Passwort stehen,
  // zeigt Verwaltung → „Konten prüfen"; sie bekommen ein Einmal-Passwort.
  // v529: Bei „keine Verbindung“ (z. B. wackeliges Netz/VPN) nach 2 s EINMAL automatisch erneut versuchen.
  // Der letzte Fehler wird (ohne Name/Passwort) für den Verbindungstest der Anmeldemaske gemerkt.
  const _try=()=>auth.signInWithEmailAndPassword(acct, typedPw);
  const _t0=Date.now();
  try{
    try{ await _try(); }
    catch(e1){
      if(!(e1 && e1.code==='auth/network-request-failed')) throw e1;
      window._lastAuthErr={ code:e1.code, msg:String(e1.message||'').slice(0,200), ms:Date.now()-_t0, versuch:1, at:new Date().toISOString() };
      await new Promise(r=>setTimeout(r,2000));
      await _try();
    }
    return {ok:true, migrated:false};
  }
  catch(e){
    const c=(e&&e.code)||'';
    window._lastAuthErr={ code:c, msg:String((e&&e.message)||'').slice(0,200), ms:Date.now()-_t0, versuch:(window._lastAuthErr&&window._lastAuthErr.versuch===1&&c==='auth/network-request-failed')?2:1, at:new Date().toISOString() };
    // Zwei-Faktor eingerichtet: Code aus der Authenticator-App abfragen (js/mfa.js).
    if(c==='auth/multi-factor-auth-required'){
      try{ await mfaResolve(e); return {ok:true, migrated:false}; }
      catch(e2){ return {ok:false, reason:'error', msg:(e2&&e2.code==='auth/mfa-cancelled')?'abgebrochen':mfaFriendly(e2)}; }
    }
    if(c==='auth/user-not-found') return {ok:false, reason:'no-account'};
    if(c==='auth/user-disabled') return {ok:false, reason:'no-access'};
    if(c==='auth/too-many-requests') return {ok:false, reason:'error', msg:'zu viele Versuche, bitte kurz warten'};
    if(c==='auth/network-request-failed') return {ok:false, reason:'error', msg:'keine Verbindung'};
    return {ok:false, reason:'bad-pw'};
  }
}

export async function initFirebase(){
  firebase.initializeApp({
    apiKey:'AIzaSyA1SxyoH1NwIk6nWK66PNvV2EmvSwPJNOk',
    authDomain:'zeiterfassung-tps.firebaseapp.com',
    databaseURL:'https://zeiterfassung-tps-default-rtdb.europe-west1.firebasedatabase.app',
    projectId:'zeiterfassung-tps',
    storageBucket:'zeiterfassung-tps.firebasestorage.app',
    messagingSenderId:'527053392310',
    appId:'1:527053392310:web:37d12a851b0e5c0acb9917'
  });
  // Dateispeicher (v571, 12.11.2026): neuer EU-Bucket (europe-west1) statt des US-Standard-Buckets (us-east1).
  // tpsStore() = EU (schreiben/lesen), tpsStoreOld() = alter US-Bucket – nur zum Lesen, bis alles kopiert ist.
  window.tpsStore=()=>{ try{ return firebase.app().storage('gs://zeiterfassung-tps-eu'); }catch(e){ return firebase.storage(); } };
  window.tpsStoreOld=()=>firebase.storage();
  const _fbRef=firebase.database().ref('zeiterfassung');
  window._fbRef=_fbRef;
  window._offlineMode=false;
  window._pendingSync=false;
  window.loadFullData = loadFullData;

  // Verbindung zur Datenbank von Anfang an beobachten (v527): Steht nach 3 s keine Verbindung, gilt die
  // App als offline → Änderungen gehen sofort in die dauerhafte Warteschlange, Hinweis „Offline – Stand von …“.
  _watchConnection();
  setTimeout(()=>{ if(window._fbConnected!==true){ window._offlineMode=true; try{ window.tpsPerf&&window.tpsPerf.mark('offline'); }catch(e){} _netChip(); } }, 3000);

  // Persistierten Anmeldestatus abwarten (für Auto-Login auf bekannten Geräten).
  try{ await _awaitAuthReady(); }catch(e){}
  try{ window.tpsPerf&&window.tpsPerf.mark('authBereit'); }catch(e){}

  // SICHERHEIT: Vor dem Login NUR das öffentliche Namensverzeichnis lesen (keine Daten).
  // v527: Bei bestehender Anmeldung mit lokalem Datenstand wird NICHT mehr darauf gewartet (die Liste braucht
  // nur die Anmeldemaske) – sie lädt nebenher. Ohne Sitzung höchstens 3 s warten (früher 6 s), dann gemerkte Namen.
  let _sess=false;
  try{ _sess=!!(firebase.auth().currentUser && localStorage.getItem('tp_zt_session') && localStorage.getItem(STORAGE_KEY)); }catch(e){}
  window._loginDirReady=_loadLoginDir(_sess?15000:3000, !_sess);
  if(!_sess) await window._loginDirReady;
}
// v530: Die Namensliste wird zusätzlich auf dem Gerät gemerkt (tps_login_dir – nur Namen + Kennung, derselbe Inhalt
// wie das ohnehin öffentlich lesbare loginDir). So findet die Anmeldemaske den Namen auch, wenn die Datenbank gerade
// nicht (oder nur langsam, z. B. im VPN) erreichbar ist. Die Abfrage läuft nach Ablauf der Wartezeit WEITER
// (window._loginDirP) – kommt die Liste später, steht sie sofort für Autovervollständigung und Anmeldung bereit.
const _LOGIN_DIR_LS='tps_login_dir';
function _loadLoginDir(ms, blocking){
  const _timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
  if(!(Array.isArray(window._loginDir)&&window._loginDir.length)){
    try{ const c=JSON.parse(localStorage.getItem(_LOGIN_DIR_LS)||'null'); if(Array.isArray(c)&&c.length){ window._loginDir=c; window._loginDirSrc='Gerätespeicher'; } }catch(e){}
  }
  if(!window._loginDirP) window._loginDirP=firebase.database().ref('zeiterfassung/loginDir').once('value').then(snap=>{
    const dir=snap.val()||{};
    try{ window.tpsPerf&&window.tpsPerf.mark('loginDir'); }catch(e){}
    // id kommt aus dem WERT (dir[k].id), NICHT aus dem Schlüssel: Umlaut-Schlüssel werden von
    // Firebase verstümmelt (j?rg). Altbestand ohne id-im-Wert → Fallback auf den Schlüssel.
    window._loginDir=Object.keys(dir).map(k=>({id:(dir[k]&&dir[k].id)||k,name:(dir[k]&&dir[k].name)||k,email:(dir[k]&&dir[k].email)||''}));
    window._loginDirLive=true; window._loginDirSrc='Server';
    try{ if(window._loginDir.length) localStorage.setItem(_LOGIN_DIR_LS, JSON.stringify(window._loginDir.map(u=>({id:u.id,name:u.name,email:''})))); }catch(e){}
  });
  return Promise.race([window._loginDirP,_timeout(ms)]).catch(e=>{
    console.warn('loginDir nicht erreichbar:',e.message);
    if(blocking) window._offlineMode=true;
    if(!(Array.isArray(window._loginDir)&&window._loginDir.length)){
      try{ const ls=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); if(ls&&Array.isArray(ls.users)){ window._loginDir=ls.users.map(u=>({id:u.id,name:u.name,email:u.email||''})); window._loginDirSrc='Datenstand'; } }catch(_){}
    }
  });
}

// Nach erfolgreichem Login (allowlistete Sitzung): volle Daten laden, migrieren,
// cachen und den Realtime-Listener starten. (Früher Teil von initFirebase.)
export async function loadFullData(){
  if(window._tpsKiosk) return;   // Kiosk-Konto (js/messe.js): nie Zeiterfassungsdaten laden/zwischenspeichern
  const _fbRef=window._fbRef||firebase.database().ref('zeiterfassung');
  const _timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
  let fbData=null;
  try{ window.tpsPerf&&window.tpsPerf.mark('zeStart'); }catch(e){}
  try{
    const snap=await Promise.race([_fbRef.once('value'),_timeout(8000)]);
    fbData=snap.val(); _zp.snap=snap;
    try{ if(window.tpsPerf&&!window._perfZeDone){ window._perfZeDone=true; const k=window.tpsPerf.kb(fbData); window.tpsPerf.mark('zeFertig',{zeKB:k.kb,zeJsonMs:k.ms}); } }catch(e){}
    window._offlineMode=false;
    _noteSync();
  } catch(e){
    console.warn('Firebase nicht erreichbar, Offline-Modus:',e.message);
    window._offlineMode=true;
    try{ window.tpsPerf&&window.tpsPerf.info({zeTimeout:true}); }catch(_){}
  }
  _netChip();

  // Personaldaten privat: lesbare Personen aus ze_private laden (höchstens 6 s warten, sonst alter Stand als Übergang)
  let _sc=null;
  if(fbData){ try{ _sc=zpScope(fbData, _zpUid()); if(_sc){ await Promise.race([_zpSubscribe(_sc), new Promise(r=>setTimeout(r,6000))]); zpBuild(fbData, _sc, _zp); } }catch(e){ console.warn('[Personaldaten privat] Laden:', e&&e.message); } }

  let lsData=null;
  try{ const ls=localStorage.getItem(STORAGE_KEY); if(ls) lsData=JSON.parse(ls); }catch(e){}

  const fbOk=fbData&&Array.isArray(fbData.users)&&fbData.users.length>0;
  const lsOk=lsData&&Array.isArray(lsData.users)&&lsData.users.length>0;
  let data=null;
  if(fbOk&&lsOk){
    const fbCnt=Object.keys(fbData.entries||{}).length;
    const lsCnt=Object.keys(lsData.entries||{}).length;
    data=fbData;
    if(lsCnt>fbCnt){
      if(!data.entries) data.entries={};
      const _rd=_sc?new Set(_sc.ids):null;   // nur Personen, die gelesen werden dürfen (älterer Gerätestand enthielt alle)
      for(const [k,v] of Object.entries(lsData.entries||{})){
        if(_rd && !_rd.has(_zpOwner(k))) continue;
        if(!data.entries[k]&&v&&v.days&&Object.keys(v.days).length>0)
          data.entries[k]=v;
      }
    }
  } else if(fbOk){ data=fbData; }
  else if(lsOk){ data=lsData; }

  if(data&&Array.isArray(data.users)&&data.users.length>0){
    const needsCleanup=
      data.users.some(u=>u.id==='admin'&&u.role!=='admin')||
      !data.users.some(u=>u.id==='admin')||
      !data.teamReports||
      data.users.some(u=>u.role==='leitung'&&!Array.isArray(u.teams))||
      data.users.some(u=>u.role==='freiberuflich'&&u.maxHours===undefined)||
      data.users.some(u=>!u.dpw)||
      !data.vacRequests||
      !data.teamCats||
      Object.values(data.entries||{}).some(e=>e&&!e.days)||
      data.users.some(u=>(u.id==='christian_bittner'||u.name==='Christian Bittner')&&(u.role!=='freiberuflich'||!u.maxHours));
    const hadPauseMig=!!(data._fixes&&data._fixes.pauseMigrationV2);
    const hadB2Mig=!!(data._fixes&&data._fixes.b2PauseMigrationV1);
    const hadFreeRb=!!(data._fixes&&data._fixes.freelancerPauseRollbackV1);
    const hadAbsV3=!!(data._fixes&&data._fixes.absSpecV3);
    const hadVANoPause=!!(data._fixes&&data._fixes.veranstaltungNoPauseV1);
    let needsSave=needsCleanup;
    let migrated=_migrate(data);
    // Wenn eine Pausen-Migration gerade gelaufen ist → unbedingt nach Firebase speichern
    if(!hadPauseMig&&migrated._fixes&&migrated._fixes.pauseMigrationV1) needsSave=true;
    if(!hadB2Mig&&migrated._fixes&&migrated._fixes.b2PauseMigrationV1) needsSave=true;
    if(!hadFreeRb&&migrated._fixes&&migrated._fixes.freelancerPauseRollbackV1) needsSave=true;
    setDataCache(migrated);
    noteGoodData(migrated); // Datenverlust-Schutz: vertrauenswürdigen Stand merken
    _runAbsMigrations(migrated); // Abwesenheits-Migrationen hier ausführen
    if(!hadAbsV3&&migrated._fixes&&migrated._fixes.absSpecV3) needsSave=true;
    if(!hadVANoPause&&migrated._fixes&&migrated._fixes.veranstaltungNoPauseV1) needsSave=true;
    if(needsSave){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));}catch(e){} if(!window._offlineMode&&isAdminAccount()) await fbWriteMerge(migrated).catch(()=>{}); }   // Voll-Write nur Administrator (sonst würden fremde Einträge mitgeschrieben)
  } else if(!window._offlineMode){
    // Kein brauchbarer Datenstand geladen. WICHTIG: Der Client schreibt Default-User NIEMALS
    // automatisch in die Cloud. Ein leerer/fehlgeschlagener Read (auch fbData==null) darf echte
    // Cloud-User nicht mit Defaults überschreiben – genau das hat die Nutzerliste zweimal auf die
    // 3 Standard-User geplättet. Defaults gibt es nur lokal; der Realtime-Listener lädt gleich den
    // echten Stand nach und hebt die Sperre (window._cloudUnverified) wieder auf. Eine wirklich
    // leere DB wird bewusst manuell (Firebase-Konsole / Import) befüllt, nicht automatisch.
    const d=freshData();
    setDataCache(d);
    window._cloudUnverified=true;
    console.warn('[Datenschutz] Kein Cloud-Stand geladen – Defaults NUR lokal, KEIN automatischer Cloud-Write. Warte auf echten Snapshot.');
  } else if(!getData()){
    // Offline und gar kein Stand → Defaults nur lokal; Cloud gilt als unbestätigt, damit ein
    // reiner Offline-Start beim Reconnect nie Defaults hochlädt.
    setDataCache(freshData());
    window._cloudUnverified=true;
  }

  _zp.ready=true;
  _setupRealtimeSync();
}

// ══ „Personaldaten privat“, Phase 3 (v551, Regeln v16) ══════════════════════════════════════════════════
// Zeiteinträge, Anträge und Stempelzeiten kommen aus ze_private/<Person> – gelesen wird NUR je Person (die Regel
// erlaubt ze_private nicht als Ganzes): Admin alle, sonst die eigene Person + zeiterfassung/seeOf/<auth.uid>.
// Leitung/GF/Genehmiger:in (managers bzw. grants/genehmigung_abwesenheit) lesen zusätzlich ze_private/<u>/vacRequests
// aller. Wer eine Person nicht lesen darf, bekommt deren Abwesenheiten nur aus zeiterfassung/abwesend als Pseudo-Antrag
// {type:'Abwesend', status:'approved', _public:true} – Kalender, Planner, Abwesenheiten, Konflikte laufen damit
// unverändert, und Krankheit erscheint dort nur als „abwesend“. Datenmodell im Speicher (d.entries usw.) bleibt gleich.
// Übergang bis Phase 4: für lesbare Personen alter Stand ∪ ze_private je Schlüssel (ze_private gewinnt), siehe zpBuild.
// Pro Person ein Live-Listener; jede Änderung baut den Stand neu zusammen.
const _zp={ subs:{}, person:{}, vac:{}, snap:null, timer:0, ready:false };
function _zpOwner(k){ const m=/^(.+)_([0-9]{4})_([0-9]{2})$/.exec(String(k||'')); return m?m[1]:''; }
function _zpUid(){ try{ const u=firebase.auth().currentUser; return (u&&u.uid)||''; }catch(e){ return ''; } }
// Wer darf was lesen? null = unbekannt (dann bleibt alles wie geladen).
export function zpScope(val, authUid){
  if(!val||!authUid) return null;
  const isAdm=!!(val.admins&&val.admins[authUid]===true);
  const me=(val.uidUser&&val.uidUser[authUid])||'';
  if(!isAdm && !me) return null;
  const ids=new Set();
  if(isAdm){
    (val.users||[]).concat(Array.isArray(val.archivedUsers)?val.archivedUsers:[]).forEach(u=>{ if(u&&u.id) ids.add(u.id); });
    Object.keys(val.entries||{}).forEach(k=>{ const o=_zpOwner(k); if(o) ids.add(o); });
    Object.values(val.vacRequests||{}).forEach(r=>{ if(r&&r.userId) ids.add(r.userId); });
    Object.keys(val.stamps||{}).forEach(u=>ids.add(u));
  } else {
    ids.add(me); Object.keys((val.seeOf&&val.seeOf[authUid])||{}).forEach(u=>{ if(val.seeOf[authUid][u]===true) ids.add(u); });
  }
  const vacAll=!isAdm && !!((val.managers&&val.managers[authUid]===true) || (val.grants&&val.grants.genehmigung_abwesenheit&&val.grants.genehmigung_abwesenheit[authUid]===true));
  const vacIds=vacAll ? (val.users||[]).map(u=>u&&u.id).filter(id=>id && !ids.has(id)) : [];
  return { ids:[...ids], vacIds, me, isAdm };
}
// Werktage (Mo–Fr ohne Feiertage des Wohnorts) für die Anzeige der Pseudo-Anträge
function _zpWorkDays(von, bis, u, halb){
  if(halb) return 0.5;
  let n=0; const cur=new Date(von+'T12:00:00'), end=new Date(bis+'T12:00:00'); let guard=0;
  while(cur<=end && guard++<800){ const wd=cur.getDay(); const ds=cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0');
    if(wd!==0&&wd!==6){ let hol=false; try{ hol=getHolidays(cur.getFullYear(),(u&&u.bundesland)||'').has(ds); }catch(e){} if(!hol) n++; }
    cur.setDate(cur.getDate()+1); }
  return n;
}
// Reine Logik (testbar): baut entries/vacRequests/stamps von val aus den privaten Ständen neu.
// priv = { person:{<u>:{entries,vacRequests,stamps}|undefined}, vac:{<u>:{…}|undefined} } (undefined = nicht geladen)
export function zpBuild(val, scope, priv){
  if(!val||!scope) return val;
  priv=priv||{}; const P=priv.person||{}, V=priv.vac||{};
  // Nach Phase 4 (zeiterfassung/zePrivOnly) gilt nur noch ze_private – liegengebliebene Reste am alten Ort werden ignoriert.
  const only=val.zePrivOnly===true;
  const oldE=only?{}:(val.entries||{}), oldV=only?{}:(val.vacRequests||{}), oldS=only?{}:(val.stamps||{});
  const E={}, VR={}, S={}; const readable=new Set(scope.ids);
  const oldVacOf=u=>{ const o={}; Object.entries(oldV).forEach(([k,r])=>{ if(r&&r.userId===u) o[k]=r; }); return o; };
  // Übergang bis Phase 4: je Schlüssel alter Stand ∪ ze_private, ze_private gewinnt. So bleibt auch ein Monatsblatt
  // sichtbar, das (z. B. von einem Gerät mit alter App-Version) nur im alten Bestand liegt; beim nächsten Bearbeiten
  // schreibt data.js privMirror es ganz nach ze_private. Gelöscht wird immer in beiden (atomar) → nichts lebt wieder auf.
  scope.ids.forEach(u=>{
    const p=P[u];
    Object.keys(oldE).forEach(k=>{ if(_zpOwner(k)===u) E[k]=oldE[k]; });
    Object.assign(E, (p&&p.entries)||{});
    Object.assign(VR, oldVacOf(u), (p&&p.vacRequests)||{});
    if(p&&p.stamps) S[u]=p.stamps; else if(oldS[u]) S[u]=oldS[u];
  });
  const realVac=new Set();
  (scope.vacIds||[]).forEach(u=>{ Object.assign(VR, oldVacOf(u), V[u]||{}); realVac.add(u); });
  const users={}; (val.users||[]).forEach(u=>{ if(u&&u.id) users[u.id]=u; });
  Object.entries(val.abwesend||{}).forEach(([id,a])=>{
    if(!a||!a.uid||!a.von||readable.has(a.uid)||realVac.has(a.uid)||VR[id]) return;
    const von=String(a.von).slice(0,10), bis=String(a.bis||a.von).slice(0,10), u=users[a.uid];
    VR[id]={ id, userId:a.uid, userName:(u&&u.name)||'', startDate:von, endDate:bis, halfDay:!!a.halb,
      workDays:_zpWorkDays(von,bis,u,!!a.halb), status:'approved', type:'Abwesend', _public:true };
  });
  val.entries=E; val.vacRequests=VR; val.stamps=S;
  return val;
}
// Für data.js (privMirror): Gibt es den Datensatz in ze_private schon? true/false, undefined = unbekannt.
window._zpHas=function(u,coll,key){
  const p=_zp.person[u];
  if(coll==='vacRequests' && p===undefined && _zp.vac[u]!==undefined) return !!(_zp.vac[u]&&_zp.vac[u][key]);
  if(!p) return undefined;
  return !!(p[coll]&&p[coll][key]);
};
// Live-Listener je Person anmelden/abmelden; liefert ein Promise, das nach dem ersten Stand aller neuen Listener erfüllt ist.
function _zpSubscribe(scope){
  if(!scope) return Promise.resolve();
  const want={}; scope.ids.forEach(u=>{ want['p:'+u]=u; }); scope.vacIds.forEach(u=>{ want['v:'+u]=u; });
  Object.keys(_zp.subs).forEach(k=>{ if(!want[k]){ const s=_zp.subs[k]; try{ s.ref.off('value', s.cb); }catch(e){} delete _zp.subs[k]; if(k[0]==='p') delete _zp.person[s.u]; else delete _zp.vac[s.u]; } });
  const firsts=[];
  Object.entries(want).forEach(([k,u])=>{
    if(_zp.subs[k]) return;
    const isP=k[0]==='p';
    let ref; try{ ref=firebase.database().ref('ze_private/'+u+(isP?'':'/vacRequests')); }catch(e){ return; }
    let done; firsts.push(new Promise(r=>{ done=r; }));
    const cb=s=>{ const v=s.val(); if(isP) _zp.person[u]=v||{}; else _zp.vac[u]=v||{}; done(); _zpChanged(); };
    const err=e=>{ console.warn('[Personaldaten privat] '+k+' nicht lesbar:', e&&(e.code||e.message)); done(); };   // bleibt „nicht geladen“ → alter Stand
    _zp.subs[k]={ ref, cb, u };
    try{ ref.on('value', cb, err); }catch(e){ done(); }
  });
  return Promise.all(firsts);
}
// Eine private Änderung → letzten zeiterfassung-Stand neu zusammenbauen (kurz gebündelt).
function _zpChanged(){
  if(!_zp.ready || !_zp.snap || _zp.timer) return;   // erst nach loadFullData (das wartet selbst auf den ersten Stand)
  _zp.timer=setTimeout(()=>{ _zp.timer=0; try{ const v=_zp.snap.val(); if(v) _applyFirebaseSnap(v); }catch(e){ console.warn('[Personaldaten privat] Neuaufbau:', e&&e.message); } }, 120);
}
function _zpApply(val){
  const sc=zpScope(val, _zpUid());
  if(!sc) return val;
  _zpSubscribe(sc);
  return zpBuild(val, sc, _zp);
}
window.zpBuild=zpBuild; window.zpScope=zpScope;

function _applyFirebaseSnap(val){
  if(!val||!getData()||window._tpsKiosk) return;
  const _pt=performance.now();
  try{ _applyFirebaseSnapInner(val); }
  finally{ try{ window.tpsPerf&&window.tpsPerf.snap('ze', performance.now()-_pt); }catch(e){} }
}
function _applyFirebaseSnapInner(val){
  // Echter Cloud-Stand ist da → „unbestätigt"-Sperre aufheben (Writes dürfen wieder in die Cloud).
  if(Array.isArray(val.users)&&val.users.length>0){ window._cloudUnverified=false; _noteSync(); }
  // Cloud bestätigt → evtl. noch offene (offline eingereihte) Änderungen gezielt nachholen.
  try{ flushPendingWrites(); }catch(e){}
  _zpApply(val);   // Personaldaten privat: entries/vacRequests/stamps aus ze_private (+ Pseudo-Anträge aus abwesend)
  const hadPauseMig=!!(val._fixes&&val._fixes.pauseMigrationV2);
  const hadB2Mig=!!(val._fixes&&val._fixes.b2PauseMigrationV1);
  const migrated=_migrate(val);
  // Feld-genauer Merge: lokal NEUERE Tagesfelder (per _ts) überleben einen älteren Snapshot,
  // damit eine gerade getippte, noch nicht zurückgespiegelte Eingabe nicht kurz „verschwindet".
  mergeIncoming(getData(), migrated);
  setDataCache(migrated);
  noteGoodData(migrated); // Datenverlust-Schutz: vertrauenswürdigen Stand merken
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated)); }catch(e){}
  // Migration-Flags nach Firebase schreiben damit sie nicht wiederholt laufen
  if((!hadPauseMig&&migrated._fixes&&migrated._fixes.pauseMigrationV1)||
     (!hadB2Mig&&migrated._fixes&&migrated._fixes.b2PauseMigrationV1)){
    if(isAdminAccount()) fbWriteMerge(migrated).catch(()=>{});   // nur Administrator: Voll-Write
  }
  if(window.cu&&!(migrated.stamps&&migrated.stamps[window.cu.id])){
    try{ localStorage.removeItem(_STAMP_KEY); }catch(e){}
  }
  try{ window.updateZeitstempelBtn?.(); }catch(e){}
  try{ window._refreshStempelView?.(); }catch(e){}
  try{ window.updateAbBadge?.(); }catch(e){}
  try{ window.renderZeNotices?.(); }catch(e){}   // Mitteilungen (z. B. GF-Rückgabe) live auffrischen
  try{
    const active=document.querySelector('.view.active');
    const vid=active?active.id:'';
    const ae=document.activeElement;
    const editing=ae&&/^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
    if(editing){
      // Nutzer tippt/wählt gerade IRGENDWO (Tabelle, Prüfvermerk, Filter, Modal) →
      // NICHT neu rendern, sonst geht die laufende Eingabe + Cursor verloren.
      // Für die Zeiterfassung das Rendern vormerken (läuft nach dem Tippen).
      if(vid==='view-zeiterfassung') window._ztRenderPending=true;
    } else if(vid==='view-zeiterfassung') window.renderZeiterfassung?.();
    else if(vid==='view-uebersicht') window.renderOverview?.();
    else if(vid==='view-gfberichte') window.renderGFBerichte?.();
    else if(vid==='view-abwesenheiten') window.renderAbwesenheiten?.();
    else if(vid==='view-einstellungen') window.renderSettings?.();
  }catch(e){}
}

let _rtOn=false, _connWatch=false, _wasConnected=false;
function _setupRealtimeSync(){
  // Live-Listener IMMER anmelden (auch nach Timeout/Offline-Start) – Firebase verbindet selbst neu und
  // liefert den Stand, sobald er da ist. Ein echter Snapshot beendet den Offline-Modus.
  if(!_rtOn && window._fbRef){ _rtOn=true;
    window._fbRef.on('value', snap=>{ _zp.snap=snap; const v=snap.val(); if(v&&Array.isArray(v.users)&&v.users.length) window._offlineMode=false; _applyFirebaseSnap(v); }); }
  _watchConnection();
}
// Echte Verbindung zum Server beobachten (.info/connected) statt nur auf das „online“-Ereignis des Geräts zu warten.
function _watchConnection(){
  if(_connWatch) return; _connWatch=true;
  try{ firebase.database().ref('.info/connected').on('value', s=>{
    // window._fbConnected: echter Verbindungsstand – data.js reiht Änderungen ohne Verbindung sofort dauerhaft ein.
    window._fbConnected=(s.val()===true);
    if(s.val()===true){ try{ window.tpsPerf&&window.tpsPerf.mark('verbunden'); }catch(e){} _wasConnected=true; window._offlineMode=false; try{ flushPendingWrites(); }catch(e){} }
    else if(_wasConnected){ window._offlineMode=true; }   // erst nach einer echten Verbindung als „offline“ werten (Start: 3-s-Regel in initFirebase)
    _netChip();
  }); }catch(e){}
}
// Zeitpunkt des letzten echten Server-Stands (für „Offline – Stand von …“). Keine Personendaten.
function _noteSync(){ try{ localStorage.setItem('tps_last_sync', String(Date.now())); }catch(e){} }
// Dezenter Hinweis oben rechts, solange die Daten nicht vom Server bestätigt sind. Klick = sofort neu versuchen.
function _netChip(){
  try{
    const off=!!window._offlineMode && window._fbConnected!==true;
    let el=document.getElementById('net-chip');
    if(!off || !window.cu){ if(el) el.remove(); return; }
    const host=document.querySelector('#module-bar .header-right'); if(!host) return;
    if(!el){ el=document.createElement('button'); el.id='net-chip'; el.type='button'; el.className='net-chip no-print';
      el.onclick=()=>{ try{ window.retrySyncNow&&window.retrySyncNow(); window.toast&&window.toast('Verbindung wird erneut versucht …',''); }catch(e){} };
      host.insertBefore(el, host.firstChild); }
    let t=0; try{ t=parseInt(localStorage.getItem('tps_last_sync')||'0',10)||0; }catch(e){}
    let stand='';
    if(t){ const d=new Date(t), heute=new Date().toDateString()===d.toDateString();
      stand=heute? d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})
                 : d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+', '+d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); }
    el.innerHTML='📴 Offline<span class="net-chip-x">'+(stand?' – Stand von '+stand:' – gespeicherter Stand')+'</span>';
    el.title='Keine Verbindung zur Datenbank. Angezeigt wird der zuletzt auf diesem Gerät gespeicherte Stand'+(stand?' ('+stand+')':'')+'. Änderungen werden gespeichert und automatisch übertragen, sobald die Verbindung wieder steht. Klicken = jetzt neu versuchen.';
  }catch(e){}
}
window._netChip=_netChip;
// Für den Klick auf das „nicht synchronisiert“-Kärtchen: Offline-Annahme verwerfen und sofort neu versuchen.
export function retrySyncNow(){
  window._offlineMode=false;
  _setupRealtimeSync();
  try{ flushPendingWrites(); }catch(e){}
  _pollFirebase();
}
// Über window bereitstellen statt als benannter Import in main.js: Lädt ein Gerät nach einem Update
// kurzzeitig eine ältere firebase.js aus dem Zwischenspeicher, darf main.js nicht an einem fehlenden Export scheitern.
window.retrySyncNow = retrySyncNow;

export async function _pollFirebase(){
  if(window._offlineMode||!getData()) return;
  try{
    const snap=await window._fbRef.once('value');
    _zp.snap=snap;
    _applyFirebaseSnap(snap.val());
  }catch(e){}
}

export function initFirebaseEvents(){
  setInterval(()=>{ if(!document.hidden) _pollFirebase(); },30000);
  setInterval(_netChip, 5000);   // Offline-Hinweis aktuell halten (z. B. nach dem Anmelden)
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) _pollFirebase(); });
  window.addEventListener('online',()=>{
    window._offlineMode=false;
    _setupRealtimeSync();   // falls nach einem Offline-Start noch kein Live-Listener läuft
    // Gezielt nur die offline eingereihten Pfade nachholen (kein Voll-Bestand mehr).
    flushPendingWrites();
    // Voll-Schreibvorgang (Fallback aus saveRaw) nur noch als Administrator-Account –
    // er würde sonst fremde Einträge mitschreiben.
    if(window._pendingSync&&getData()&&!window._cloudUnverified&&isAdminAccount()){
      fbWriteMerge(getData()).then(()=>{ window._pendingSync=false; }).catch(()=>{});
    }
  });
  window.addEventListener('offline',()=>{
    window._offlineMode=true; _netChip();
    window.toast?.('📵 Offline – Änderungen werden lokal gespeichert.','');
  });
}

// Abwesenheits-Migrationen (benötigen getHolidays → hier statt data.js)
function _runAbsMigrations(d){
  try{
    const _mk=(uid,y,m)=>`${uid}_${y}_${String(m).padStart(2,'0')}`;
    const _ds=(y,m,dd)=>`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    // Freelancer-Cleanup: durch sync entstandene Zeiteinträge löschen
    if(!d._fixes.freelancerAbsCleanup){
      const freeIds=new Set((d.users||[]).filter(u=>u.role==='freiberuflich').map(u=>u.id));
      Object.keys(d.entries||{}).forEach(k=>{
        const uid2=k.split('_').slice(0,-2).join('_');
        if(!freeIds.has(uid2)) return;
        Object.keys(d.entries[k]?.days||{}).forEach(ds=>{
          const day=d.entries[k].days[ds];
          if(day&&day.b1von==='08:00'&&day.b1bis&&!day.b1zuord&&!day.b2von){
            day.b1von=''; day.b1bis=''; day.b1bem=''; day.ktmin='';
          }
        });
      });
      d._fixes.freelancerAbsCleanup=true;
    }
    // Abwesenheiten mit Feiertags-Check eintragen
    if(!d._fixes.allAbsBemerkungV2){
      const userMap={}; (d.users||[]).forEach(u=>{ userMap[u.id]=u; });
      if(d._fixes.allAbsBemerkung){
        Object.values(d.vacRequests||{}).forEach(req=>{
          if(req.status!=='approved'||req._public) return;
          const u=userMap[req.userId]; if(!u||u.role==='freiberuflich') return;
          if(u.holidaysLikeSunday===false) return;
          let cur=new Date(req.startDate+'T12:00:00');
          while(cur<=new Date(req.endDate+'T12:00:00')){
            const wd=cur.getDay();
            if(wd!==0&&wd!==6){
              const y=cur.getFullYear(),m=cur.getMonth()+1,dd2=cur.getDate();
              const ds=_ds(y,m,dd2);
              const hols=getHolidays(y,u.bundesland||'');
              if(hols.has(ds)){
                const k=_mk(u.id,y,m);
                const day=d.entries?.[k]?.days?.[ds];
                if(day&&day.b1zuord===req.type&&!day.b2von){
                  day.b1von=''; day.b1bis=''; day.b1zuord=''; day.b1bem='';
                }
              }
            }
            cur.setDate(cur.getDate()+1);
          }
        });
      }
      Object.values(d.vacRequests||{}).forEach(req=>{
        if(req.status!=='approved'||req._public) return;
        const u=userMap[req.userId]; if(!u) return;
        const isFree=u.role==='freiberuflich';
        const holFree=u.holidaysLikeSunday!==false;
        const wh=u.wh||0; const dpw=u.dpw||5;
        const vhpd=u.vacHoursPerDay||Math.round(wh/(dpw||5))||8;
        const fullMins=isFree?0:(req.type==='AU/Krank'?(Math.round(wh*60/(dpw||5))||480):(vhpd*60)||480);
        let cur=new Date(req.startDate+'T12:00:00');
        while(cur<=new Date(req.endDate+'T12:00:00')){
          const wd=cur.getDay();
          if(wd!==0&&wd!==6){
            const y=cur.getFullYear(),m=cur.getMonth()+1,dd2=cur.getDate();
            const ds=_ds(y,m,dd2);
            const hols=getHolidays(y,u.bundesland||'');
            if(!holFree||!hols.has(ds)){
              const k=_mk(u.id,y,m);
              if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
              if(!d.entries[k].days) d.entries[k].days={};
              if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
              const day=d.entries[k].days[ds];
              if(isFree){ if(!day.b1bem) day.b1bem=req.type||'Abwesenheit'; }
              else if(!day.b1von&&fullMins>0&&req.type!=='Arbeitszeitausgleich'){
                day.b1von='08:00'; day.b1bis=addMin('08:00',fullMins);
                day.b1zuord=req.type; day.b2von=''; day.b2bis='';
              }
            }
          }
          cur.setDate(cur.getDate()+1);
        }
      });
      d._fixes.freelancerAbsBemerkung=true;
      d._fixes.allAbsBemerkung=true;
      d._fixes.allAbsBemerkungV2=true;
    }

    // V3: Alle genehmigten Abwesenheiten exakt nach Spec korrigieren
    //  - Urlaub/AU (Festangestellte): Stunden + Zuordnung=Typ
    //  - Freiberufler/Sonstiges/Arbeitszeitausgleich: nur Bemerkung
    // Es werden nur leere Tage oder alte Sync-Artefakte angefasst (keine echte Arbeit).
    if(!d._fixes.absSpecV3){
      const userMap={}; (d.users||[]).forEach(u=>{ userMap[u.id]=u; });
      const _wk=dt=>{const t=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate()));const dy=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-dy+3);const f=new Date(Date.UTC(t.getUTCFullYear(),0,4));return t.getUTCFullYear()+'-'+(1+Math.round(((t-f)/864e5-3+((f.getUTCDay()+6)%7))/7));};
      const _isArtifact=day=>day&&day.b1von==='08:00'&&!day.b2von&&(day.b1zuord===''||day.b1zuord==='Sonstiges'||day.b1zuord==='Urlaub'||day.b1zuord==='AU/Krank');
      Object.values(d.vacRequests||{}).forEach(req=>{
        if(req.status!=='approved'||req._public) return;
        const u=userMap[req.userId]; if(!u) return;
        const isFree=u.role==='freiberuflich';
        const holFree=u.holidaysLikeSunday!==false;
        const dpw=Math.max(1,Math.min(7,u.dpw||5));
        const hoursType=!isFree&&(req.type==='Urlaub'||req.type==='AU/Krank');
        const dailyMin=Math.round((u.wh||0)*60/dpw)||480;
        const perWeek={};
        let cur=new Date(req.startDate+'T12:00:00');
        while(cur<=new Date(req.endDate+'T12:00:00')){
          const wd=cur.getDay();
          if(wd!==0&&wd!==6){
            const y=cur.getFullYear(),m=cur.getMonth()+1,dd2=cur.getDate();
            const ds=_ds(y,m,dd2);
            const hols=getHolidays(y,u.bundesland||'');
            if(!holFree||!hols.has(ds)){
              const k=_mk(u.id,y,m);
              if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
              if(!d.entries[k].days) d.entries[k].days={};
              if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
              const day=d.entries[k].days[ds];
              const empty=!day.b1von&&!day.b1bis&&!day.b2von&&!day.ktmin&&!day.b1bem;
              if(hoursType&&(perWeek[_wk(cur)]||0)<dpw&&(empty||_isArtifact(day))){
                const mins=req.halfDay&&req.type==='Urlaub'?Math.round(dailyMin/2):dailyMin;
                day.b1von='08:00'; day.b1bis=addMin('08:00',mins); day.b1zuord=req.type;
                day.b1bem=''; day.b2von=''; day.b2bis='';
                perWeek[_wk(cur)]=(perWeek[_wk(cur)]||0)+1;
              } else if(!hoursType){
                // nur Bemerkung: evtl. falsche Sync-Stunden entfernen
                if(_isArtifact(day)){ day.b1von=''; day.b1bis=''; day.b1zuord=''; }
                if(!day.b1bem) day.b1bem=req.type;
              }
            }
          }
          cur.setDate(cur.getDate()+1);
        }
      });
      d._fixes.absSpecV3=true;
    }

    // Veranstaltung = keine Pflichtpause: die früher aufgeschlagene Pause aus der
    // Abfahrt bereits erfasster Veranstaltungstage wieder herausrechnen (einmalig).
    if(!d._fixes.veranstaltungNoPauseV1){
      const uMap={}; (d.users||[]).forEach(u=>{ uMap[u.id]=u; });
      Object.keys(d.entries||{}).forEach(k=>{
        const pr=k.split('_'); pr.pop(); pr.pop(); const uid=pr.join('_');
        const u=uMap[uid]; if(!u||u.role==='freiberuflich') return;
        const days=d.entries[k].days||{};
        Object.keys(days).forEach(ds=>{
          const day=days[ds];
          if(!day||day.b1zuord!=='Veranstaltung'||day._nightShift) return;
          const hasB2=!!(day.b2von&&day.b2bis);
          const lastF=hasB2?'b2bis':'b1bis';
          const lastVon=hasB2?day.b2von:day.b1von;
          if(!day[lastF]||!lastVon) return;
          const gross=diffMin(day.b1von||'',day.b1bis||'')+diffMin(day.b2von||'',day.b2bis||'')+Number(day.ktmin||0);
          let gap=0; if(day.b1bis&&day.b2von){ const g=diffMin(day.b1bis,day.b2von); if(g>0) gap=g; }
          const req=gross>=585?45:gross>=390?30:0;
          const pause=Math.max(0,req-gap);
          if(pause>0) day[lastF]=addMin(day[lastF],-pause);
        });
      });
      d._fixes.veranstaltungNoPauseV1=true;
    }
  }catch(e){ console.error('AbsMigration Fehler:',e); }
}
