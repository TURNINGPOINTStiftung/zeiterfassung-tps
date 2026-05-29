import { STORAGE_KEY, _STAMP_KEY } from './config.js';
import { freshData, _migrate, getData, setDataCache } from './data.js';
import { hashPw, isHashed } from './auth.js';

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

  let fbData=null;
  const _timeout=ms=>new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')),ms));
  try{
    await Promise.race([firebase.auth().signInAnonymously(),_timeout(5000)]);
    const snap=await Promise.race([_fbRef.once('value'),_timeout(6000)]);
    fbData=snap.val();
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
    let needsSave=needsCleanup;
    let migrated=_migrate(data);
    for(const u of migrated.users){
      if(!isHashed(u.pw)){ u.pw=await hashPw(u.pw); needsSave=true; }
    }
    setDataCache(migrated);
    if(needsSave){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));}catch(e){} if(!window._offlineMode) await _fbRef.set(migrated).catch(()=>{}); }
  } else if(!window._offlineMode){
    const d=freshData();
    for(const u of d.users){ u.pw=await hashPw(u.pw); }
    setDataCache(d);
    await _fbRef.set(d).catch(()=>{});
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch(e){}
  } else if(!getData()){
    setDataCache(freshData());
  }

  _setupRealtimeSync();
}

function _applyFirebaseSnap(val){
  if(!val||!getData()) return;
  const migrated=_migrate(val);
  setDataCache(migrated);
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated)); }catch(e){}
  if(window.cu&&!(migrated.stamps&&migrated.stamps[window.cu.id])){
    try{ localStorage.removeItem(_STAMP_KEY); }catch(e){}
  }
  try{ window.updateZeitstempelBtn?.(); }catch(e){}
  try{ window._refreshStempelView?.(); }catch(e){}
  try{ window.updateAbBadge?.(); }catch(e){}
  try{
    const vze=document.getElementById('view-zeiterfassung');
    if(vze&&vze.classList.contains('active')) window.renderZeiterfassung?.();
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
    if(window._pendingSync&&getData()){
      window._fbRef.set(getData()).then(()=>{ window._pendingSync=false; window.toast?.('📶 Offline-Änderungen synchronisiert ✓','ok'); }).catch(()=>{});
    }
  });
  window.addEventListener('offline',()=>{
    window._offlineMode=true;
    window.toast?.('📵 Offline – Änderungen werden lokal gespeichert.','');
  });
}
