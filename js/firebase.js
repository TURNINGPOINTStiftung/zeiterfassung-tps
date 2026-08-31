import { STORAGE_KEY, _STAMP_KEY, _PW_SALT } from './config.js';
import { freshData, _migrate, getData, setDataCache, mutate, entryKey, noteGoodData, fbWriteMerge, mergeIncoming } from './data.js';
import { makePwRecord, isPwHashed } from './auth.js';
import { addMin, diffMin, getHolidays } from './utils.js';

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
// Stabiles, APP-VERWALTETES Firebase-Passwort je Nutzer – bewusst UNABHÄNGIG vom Login-
// Passwort des Nutzers. Dadurch bleibt das Firebase-Konto gültig, auch wenn der Nutzer sein
// (App-)Passwort ändert; genau diese Kopplung hat sonst dazu geführt, dass ein Passwort-
// wechsel das Firebase-Login auf ein neues Gerät aussperrte. (KEIN Sicherheits-Boundary:
// die Firebase-Regeln verlangen nur IRGENDEINE nicht-anonyme Anmeldung; die echte
// Zugangskontrolle macht die App über das gehashte u.pw.)
function _stableAuthPw(id){ return 'tpsfb$'+String(id||'').toLowerCase()+'$'+_PW_SALT; }

// Beim Login: echtes Firebase-Konto verwenden oder (einmalig) anlegen. NON-BLOCKING –
// schlägt es fehl (z. B. Provider nicht aktiv), bleibt der App-Login unberührt. Das Konto
// nutzt das STABILE Passwort. Alt-Konten, die noch mit dem Login-Passwort angelegt wurden,
// werden beim nächsten erfolgreichen Login EINMALIG darauf umgestellt (Selbst-Migration) –
// danach kann kein Passwortwechsel das Firebase-Login mehr aus dem Tritt bringen.
export function ensureRealAuth(id, pw, email){
  try{
    if(!window.firebase || !firebase.auth || !id) return;
    const acct=_accountEmail(id, email);
    const authPw=_stableAuthPw(id);
    const auth=firebase.auth();
    const create=()=>auth.createUserWithEmailAndPassword(acct, authPw).catch(e=>{
      const c=e&&e.code;
      if(c!=='auth/email-already-in-use' && c!=='auth/operation-not-allowed' && c!=='auth/network-request-failed') console.warn('CRM-Auth anlegen:', e&&e.message);
    });
    // 1) Bevorzugt mit dem stabilen Passwort anmelden.
    auth.signInWithEmailAndPassword(acct, authPw).catch(()=>{
      // 2) Klappt nicht → evtl. Alt-Konto (mit Login-Passwort angelegt). Damit anmelden und
      //    danach EINMALIG auf das stabile Passwort umstellen. Sonst: Konto neu anlegen.
      if(pw){
        auth.signInWithEmailAndPassword(acct, pw)
          .then(cred=>{ try{ cred.user.updatePassword(authPw).catch(()=>{}); }catch(_){} })
          .catch(()=>create());
      } else {
        create();
      }
    });
  }catch(e){ console.warn('ensureRealAuth:', e&&e.message); }
}
// Admin legt Nutzer an → Konto über eine SEKUNDÄRE App-Instanz anlegen,
// damit die Admin-Sitzung nicht ersetzt wird. Best effort.
export function provisionAuthAccount(id, pw, email){
  try{
    if(!window.firebase || !id) return;
    const acct=_accountEmail(id, email);
    const authPw=_stableAuthPw(id);   // stabiles Passwort (unabhängig vom Login-Passwort)
    const cfg=firebase.app().options;
    const sec=(firebase.apps||[]).find(a=>a.name==='admin-prov') || firebase.initializeApp(cfg, 'admin-prov');
    sec.auth().createUserWithEmailAndPassword(acct, authPw)
      .then(()=>{ try{ sec.auth().signOut(); }catch(_){} })
      .catch(e=>{ const c=e&&e.code; if(c!=='auth/email-already-in-use'&&c!=='auth/operation-not-allowed') console.warn('CRM-Auth provisionieren:', e&&e.message); try{ sec.auth().signOut(); }catch(_){} });
  }catch(e){ console.warn('provisionAuthAccount:', e&&e.message); }
}

// Festes technisches „Bootstrap"-Konto: erlaubt einem FRISCHEN Gerät (ohne gespeicherte
// Sitzung), die Daten ZU LESEN, damit die Login-Maske die echten Nutzer zeigt. Nötig, seit
// die anonyme Anmeldung deaktiviert ist – die Regeln verlangen eine NICHT-anonyme Sitzung,
// und ohne Lese-Zugriff käme ein neues Gerät gar nicht mehr an die Nutzerliste. Kein
// zusätzliches Sicherheitsrisiko: Wer den (öffentlichen) Code hat, könnte sich ohnehin ein
// Firebase-Konto anlegen; die echte Zugangskontrolle macht die App über das gehashte u.pw.
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

// Login mit sanfter Migration: 1) mit dem echten (getippten) Passwort anmelden;
// 2) sonst Übergangs-Fallback über das Stabil-Passwort, dann Hash clientseitig
// prüfen (verifyFn) und das Firebase-Konto-Passwort auf das echte umstellen.
// Rückgabe {ok, migrated} bzw. {ok:false, reason}.
export async function authenticate(id, email, typedPw, verifyFn){
  const auth=firebase.auth();
  const acct=_accountEmail(id, email);
  try{ await auth.signInWithEmailAndPassword(acct, typedPw); return {ok:true, migrated:false}; }
  catch(e){ /* evtl. noch nicht migriert → Fallback */ }
  try{ await auth.signInWithEmailAndPassword(acct, _stableAuthPw(id)); }
  catch(e){ return {ok:false, reason:'no-account'}; }
  let users;
  try{ const s=await firebase.database().ref('zeiterfassung/users').once('value'); users=s.val()||[]; }
  catch(e){ try{ await auth.signOut(); }catch(_){}; return {ok:false, reason:'no-access'}; }
  const arr=Array.isArray(users)?users:Object.values(users);
  const u=arr.find(x=>x&&x.id===id);
  if(!u){ try{ await auth.signOut(); }catch(_){}; return {ok:false, reason:'no-user'}; }
  const v=await verifyFn(typedPw, u.pw);
  if(!v||!v.ok){ try{ await auth.signOut(); }catch(_){}; return {ok:false, reason:'bad-pw'}; }
  try{ await auth.currentUser.updatePassword(typedPw); }catch(e){ /* z.B. requires-recent-login – klappt beim nächsten Login */ }
  return {ok:true, migrated:true};
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
  const _fbRef=firebase.database().ref('zeiterfassung');
  window._fbRef=_fbRef;
  window._offlineMode=false;
  window._pendingSync=false;
  window.ensureRealAuth = ensureRealAuth;
  window.provisionAuthAccount = provisionAuthAccount;
  window.loadFullData = loadFullData;

  // Persistierten Anmeldestatus abwarten (für Auto-Login auf bekannten Geräten).
  try{ await _awaitAuthReady(); }catch(e){}

  // SICHERHEIT: Vor dem Login NUR das öffentliche Namensverzeichnis lesen (keine Daten).
  const _timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
  try{
    const snap=await Promise.race([firebase.database().ref('zeiterfassung/loginDir').once('value'),_timeout(6000)]);
    const dir=snap.val()||{};
    // id kommt aus dem WERT (dir[k].id), NICHT aus dem Schlüssel: Umlaut-Schlüssel werden von
    // Firebase verstümmelt (j?rg). Altbestand ohne id-im-Wert → Fallback auf den Schlüssel.
    window._loginDir=Object.keys(dir).map(k=>({id:(dir[k]&&dir[k].id)||k,name:(dir[k]&&dir[k].name)||k,email:(dir[k]&&dir[k].email)||''}));
  }catch(e){
    console.warn('loginDir nicht erreichbar:',e.message);
    window._offlineMode=true;
    try{ const ls=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); if(ls&&Array.isArray(ls.users)) window._loginDir=ls.users.map(u=>({id:u.id,name:u.name,email:u.email||''})); }catch(_){}
  }
}

// Nach erfolgreichem Login (allowlistete Sitzung): volle Daten laden, migrieren,
// cachen und den Realtime-Listener starten. (Früher Teil von initFirebase.)
export async function loadFullData(){
  const _fbRef=window._fbRef||firebase.database().ref('zeiterfassung');
  const _timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
  let fbData=null;
  try{
    const snap=await Promise.race([_fbRef.once('value'),_timeout(8000)]);
    fbData=snap.val();
    window._offlineMode=false;
  } catch(e){
    console.warn('Firebase nicht erreichbar, Offline-Modus:',e.message);
    window._offlineMode=true;
  }

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
      for(const [k,v] of Object.entries(lsData.entries||{})){
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
    for(const u of migrated.users){
      if(!isPwHashed(u.pw)){ u.pw=await makePwRecord(u.pw); needsSave=true; }
    }
    setDataCache(migrated);
    noteGoodData(migrated); // Datenverlust-Schutz: vertrauenswürdigen Stand merken
    _runAbsMigrations(migrated); // Abwesenheits-Migrationen hier ausführen
    if(!hadAbsV3&&migrated._fixes&&migrated._fixes.absSpecV3) needsSave=true;
    if(!hadVANoPause&&migrated._fixes&&migrated._fixes.veranstaltungNoPauseV1) needsSave=true;
    if(needsSave){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));}catch(e){} if(!window._offlineMode) await fbWriteMerge(migrated).catch(()=>{}); }
  } else if(!window._offlineMode){
    // Kein brauchbarer Datenstand geladen. WICHTIG: Der Client schreibt Default-User NIEMALS
    // automatisch in die Cloud. Ein leerer/fehlgeschlagener Read (auch fbData==null) darf echte
    // Cloud-User nicht mit Defaults überschreiben – genau das hat die Nutzerliste zweimal auf die
    // 3 Standard-User geplättet. Defaults gibt es nur lokal; der Realtime-Listener lädt gleich den
    // echten Stand nach und hebt die Sperre (window._cloudUnverified) wieder auf. Eine wirklich
    // leere DB wird bewusst manuell (Firebase-Konsole / Import) befüllt, nicht automatisch.
    const d=freshData();
    for(const u of d.users){ u.pw=await makePwRecord(u.pw); }
    setDataCache(d);
    window._cloudUnverified=true;
    console.warn('[Datenschutz] Kein Cloud-Stand geladen – Defaults NUR lokal, KEIN automatischer Cloud-Write. Warte auf echten Snapshot.');
  } else if(!getData()){
    // Offline und gar kein Stand → Defaults nur lokal; Cloud gilt als unbestätigt, damit ein
    // reiner Offline-Start beim Reconnect nie Defaults hochlädt.
    setDataCache(freshData());
    window._cloudUnverified=true;
  }

  _setupRealtimeSync();
}

function _applyFirebaseSnap(val){
  if(!val||!getData()) return;
  // Echter Cloud-Stand ist da → „unbestätigt"-Sperre aufheben (Writes dürfen wieder in die Cloud).
  if(Array.isArray(val.users)&&val.users.length>0) window._cloudUnverified=false;
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
    fbWriteMerge(migrated).catch(()=>{});
  }
  if(window.cu&&!(migrated.stamps&&migrated.stamps[window.cu.id])){
    try{ localStorage.removeItem(_STAMP_KEY); }catch(e){}
  }
  try{ window.updateZeitstempelBtn?.(); }catch(e){}
  try{ window._refreshStempelView?.(); }catch(e){}
  try{ window.updateAbBadge?.(); }catch(e){}
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

function _setupRealtimeSync(){
  if(window._offlineMode) return;
  window._fbRef.on('value', snap=>{ _applyFirebaseSnap(snap.val()); });
}

export async function _pollFirebase(){
  if(window._offlineMode||!getData()) return;
  try{
    const snap=await window._fbRef.once('value');
    _applyFirebaseSnap(snap.val());
  }catch(e){}
}

export function initFirebaseEvents(){
  setInterval(()=>{ if(!document.hidden) _pollFirebase(); },30000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) _pollFirebase(); });
  window.addEventListener('online',()=>{
    window._offlineMode=false;
    if(window._pendingSync&&getData()&&!window._cloudUnverified){
      fbWriteMerge(getData()).then(()=>{ window._pendingSync=false; window.toast?.('📶 Offline-Änderungen synchronisiert ✓','ok'); }).catch(()=>{});
    }
  });
  window.addEventListener('offline',()=>{
    window._offlineMode=true;
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
          if(req.status!=='approved') return;
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
        if(req.status!=='approved') return;
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
        if(req.status!=='approved') return;
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
