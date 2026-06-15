import { STORAGE_KEY, _STAMP_KEY } from './config.js';
import { freshData, _migrate, getData, setDataCache, mutate, entryKey, hasPendingSync, setPendingSync } from './data.js';
import { makePwRecord, isPwHashed } from './auth.js';
import { addMin, diffMin, getHolidays } from './utils.js';

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
  // Wird von saveRaw() nach jedem erfolgreichen Firebase-Write aufgerufen –
  // falls _offlineMode irrtümlich hängen geblieben war, hier zurücksetzen
  // und den Realtime-Listener (nach)aktivieren.
  window._fbOnlineRecover=function(){
    if(window._offlineMode){
      window._offlineMode=false;
      _setupRealtimeSync();
      window.toast?.('📶 Verbindung wiederhergestellt – Änderungen synchronisiert ✓','ok');
    }
  };

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

  // Lokale Änderungen, die wegen eines hängenden Offline-Zustands nie nach
  // Firebase geschrieben wurden, additiv übernehmen (z.B. eine Stempelung
  // oder ein Abwesenheitsantrag, die nur lokal in localStorage standen).
  let pendingMerge=false;
  if(hasPendingSync()&&lsOk&&data){
    for(const coll of ['stamps','vacRequests','entries','teamReports','yearReports']){
      if(!data[coll]) data[coll]={};
      for(const [k,v] of Object.entries(lsData[coll]||{})){
        if(data[coll][k]===undefined){ data[coll][k]=v; pendingMerge=true; }
      }
    }
  }

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
    let needsSave=needsCleanup||pendingMerge;
    let migrated=_migrate(data);
    // Wenn eine Pausen-Migration gerade gelaufen ist → unbedingt nach Firebase speichern
    if(!hadPauseMig&&migrated._fixes&&migrated._fixes.pauseMigrationV1) needsSave=true;
    if(!hadB2Mig&&migrated._fixes&&migrated._fixes.b2PauseMigrationV1) needsSave=true;
    if(!hadFreeRb&&migrated._fixes&&migrated._fixes.freelancerPauseRollbackV1) needsSave=true;
    for(const u of migrated.users){
      if(!isPwHashed(u.pw)){ u.pw=await makePwRecord(u.pw); needsSave=true; }
    }
    setDataCache(migrated);
    _runAbsMigrations(migrated); // Abwesenheits-Migrationen hier ausführen
    if(!hadAbsV3&&migrated._fixes&&migrated._fixes.absSpecV3) needsSave=true;
    if(!hadVANoPause&&migrated._fixes&&migrated._fixes.veranstaltungNoPauseV1) needsSave=true;
    if(needsSave){
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));}catch(e){}
      // Auch im (evtl. fälschlich gesetzten) Offline-Modus versuchen – das
      // Firebase-SDK queued den Write und schreibt ihn bei Verbindung nach.
      await _fbRef.set(migrated).then(()=>{ if(pendingMerge) setPendingSync(false); }).catch(()=>{});
    }
  } else if(!window._offlineMode){
    const d=freshData();
    for(const u of d.users){ u.pw=await makePwRecord(u.pw); }
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
  const hadPauseMig=!!(val._fixes&&val._fixes.pauseMigrationV2);
  const hadB2Mig=!!(val._fixes&&val._fixes.b2PauseMigrationV1);
  const migrated=_migrate(val);
  setDataCache(migrated);
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated)); }catch(e){}
  // Migration-Flags nach Firebase schreiben damit sie nicht wiederholt laufen
  if((!hadPauseMig&&migrated._fixes&&migrated._fixes.pauseMigrationV1)||
     (!hadB2Mig&&migrated._fixes&&migrated._fixes.b2PauseMigrationV1)){
    _fbRef.set(migrated).catch(()=>{});
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
  if(window._offlineMode||window._fbRealtimeAttached) return;
  window._fbRealtimeAttached=true;
  window._fbRef.on('value', snap=>{ _applyFirebaseSnap(snap.val()); });
}

export async function _pollFirebase(){
  if(!getData()) return;
  if(window._offlineMode){
    // Verbindung war evtl. nur beim App-Start kurz zu langsam (Timeout) und der
    // Offline-Modus blieb hängen, obwohl das Gerät online ist – das 'online'-Event
    // feuert dann nie, also hier aktiv einen Reconnect-Versuch unternehmen.
    try{
      if(hasPendingSync()){
        await window._fbRef.set(getData());
        setPendingSync(false);
        window._offlineMode=false;
        window.toast?.('📶 Verbindung wiederhergestellt – Änderungen synchronisiert ✓','ok');
        _setupRealtimeSync();
      }else{
        const snap=await window._fbRef.once('value');
        window._offlineMode=false;
        _applyFirebaseSnap(snap.val());
        _setupRealtimeSync();
      }
    }catch(e){}
    return;
  }
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
    if(hasPendingSync()&&getData()){
      window._fbRef.set(getData()).then(()=>{ setPendingSync(false); window.toast?.('📶 Offline-Änderungen synchronisiert ✓','ok'); }).catch(()=>{});
    }
    _setupRealtimeSync();
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
