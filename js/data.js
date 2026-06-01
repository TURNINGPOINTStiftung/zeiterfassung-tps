import { STORAGE_KEY, _STAMP_KEY, DEFAULT_CATS, DEFAULT_TEAMS, DEFAULT_USERS } from './config.js';
import { addMin, diffMin } from './utils.js';

// ── Internal state ────────────────────────────────────────────────
let _dataCache = null;

export function freshData(){
  return {users:DEFAULT_USERS.map(u=>({...u})),entries:{},cats:[...DEFAULT_CATS],teams:[...DEFAULT_TEAMS],teamReports:{},vacRequests:{},teamCats:{},yearReports:{},_fixes:{}};
}

export function _migrate(d){
  if(!d.cats) d.cats=[...DEFAULT_CATS];
  if(!d.teams) d.teams=[...DEFAULT_TEAMS];
  if(!d.entries) d.entries={};
  if(!d.teamReports) d.teamReports={};
  if(!d.vacRequests) d.vacRequests={};
  if(!d.teamCats) d.teamCats={};
  if(!d.stamps) d.stamps={};
  if(!d.customRoles) d.customRoles=[];
  if(!d.yearReports) d.yearReports={};
  if(!d._fixes) d._fixes={};

  // ── Pause-Migration (einmalig) ─────────────────────────────────
  // Historische b1bis-Einträge hatten die auto-Pause nicht eingerechnet.
  // Nach Einführung der Pause-Abziehung in der Formel würden sie zu wenig zeigen.
  // Pause-Migration: einmalig pro Tag (Idempotenz-Flag auf Tages-Ebene)
  try{
    const _ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
    Object.values(d.entries||{}).forEach(entry=>{
      if(!entry||!entry.days) return; // null-Guard
      Object.values(entry.days).forEach(day=>{
        if(!day||!day.b1von||!day.b1bis) return;
        if(_ABS.has(day.b1zuord)||_ABS.has(day.b1bem)) return;
        if(day.b2von) return; // Zwei-Block: Pause liegt im Gap
        if(day._pauseMigratedV2) return; // Bereits korrekt migriert
        // Falls V1 bereits addiert hatte → zuerst zurückrollen
        if(day._pauseMigrated){
          const g0=diffMin(day.b1von,day.b1bis)+Number(day.ktmin||0);
          const p0=g0>=540?45:g0>=360?30:0;
          if(p0>0) day.b1bis=addMin(day.b1bis,-p0);
          delete day._pauseMigrated;
        }
        // Pause genau einmal addieren
        const gross=diffMin(day.b1von,day.b1bis)+Number(day.ktmin||0);
        const autoPause=gross>=540?45:gross>=360?30:0;
        if(autoPause>0){
          day.b1bis=addMin(day.b1bis,autoPause);
          day._pauseMigratedV2=true;
        }
      });
    });
    d._fixes.pauseMigrationV1=true;
    d._fixes.pauseMigrationV2=true;
  }catch(e){ console.error('Pause-Migration Fehler (ignoriert):',e); }
  // ── Alle Abwesenheiten: fehlende Bemerkungen + ggf. Zeiteinträge nachträglich anlegen
  // V2: mit Feiertags-Prüfung (V1 hatte diesen Check nicht → konnte Extra-Urlaubstage erzeugen)
  if(!d._fixes.allAbsBemerkungV2){
    // Einträge die V1 fälschlicherweise auf Feiertagen erstellt hat, rückgängig machen
    const userMap={}; (d.users||[]).forEach(u=>{ userMap[u.id]=u; });
    // Erst: fehlerhafte Feiertags-Einträge aus V1 löschen
    if(d._fixes.allAbsBemerkung){
      Object.values(d.vacRequests||{}).forEach(req=>{
        if(req.status!=='approved') return;
        const u=userMap[req.userId]; if(!u||u.role==='freiberuflich') return;
        const holFree=u.holidaysLikeSunday!==false;
        let cur=new Date(req.startDate+'T12:00:00');
        const endD=new Date(req.endDate+'T12:00:00');
        while(cur<=endD){
          const wd=cur.getDay();
          if(wd!==0&&wd!==6){
            const y=cur.getFullYear(),m=cur.getMonth()+1,dd2=cur.getDate();
            const ds=`${y}-${String(m).padStart(2,'0')}-${String(dd2).padStart(2,'0')}`;
            if(holFree){
              // Feiertags-Import rückgängig wenn b1zuord=req.type und kein b2 gesetzt
              const hols=getHolidays(y,u.bundesland||'');
              if(hols.has(ds)){
                const k=`${u.id}_${y}_${String(m).padStart(2,'0')}`;
                const day=d.entries?.[k]?.days?.[ds];
                if(day&&day.b1zuord===req.type&&!day.b2von){
                  day.b1von=''; day.b1bis=''; day.b1zuord=''; day.b1bem='';
                  if(!Object.values(day).some(v=>v)) delete d.entries[k].days[ds];
                }
              }
            }
          }
          cur.setDate(cur.getDate()+1);
        }
      });
    }
    // Jetzt sauber mit Feiertags-Prüfung neu eintragen
    Object.values(d.vacRequests||{}).forEach(req=>{
      if(req.status!=='approved') return;
      const u=userMap[req.userId]; if(!u) return;
      const isFree=u.role==='freiberuflich';
      const holFree=u.holidaysLikeSunday!==false;
      const wh=u.wh||0; const dpw=u.dpw||5;
      const vhpd=u.vacHoursPerDay||Math.round(wh/(dpw||5))||8;
      const fullMins=isFree?0:(req.type==='AU/Krank'
        ?(Math.round(wh*60/(dpw||5))||480):(vhpd*60)||480);
      let cur=new Date(req.startDate+'T12:00:00');
      const endD=new Date(req.endDate+'T12:00:00');
      while(cur<=endD){
        const wd=cur.getDay();
        if(wd!==0&&wd!==6){
          const y=cur.getFullYear(),m=cur.getMonth()+1,dd2=cur.getDate();
          const ds=`${y}-${String(m).padStart(2,'0')}-${String(dd2).padStart(2,'0')}`;
          const hols=getHolidays(y,u.bundesland||'');
          if(!holFree||!hols.has(ds)){
            const k=`${u.id}_${y}_${String(m).padStart(2,'0')}`;
            if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
            if(!d.entries[k].days) d.entries[k].days={};
            if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
            const day=d.entries[k].days[ds];
            if(isFree){
              if(!day.b1bem) day.b1bem=req.type||'Abwesenheit';
            } else {
              if(!day.b1von&&fullMins>0&&req.type!=='Arbeitszeitausgleich'){
                day.b1von='08:00'; day.b1bis=addMin('08:00',fullMins);
                day.b1zuord=req.type; day.b2von=''; day.b2bis='';
              }
              if(!day.b1bem&&req.type==='Arbeitszeitausgleich') day.b1bem='Arbeitszeitausgleich';
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
  // ── Freiberufler-Cleanup: durch Abwesenheitssync entstandene Zeiteinträge löschen
  if(!d._fixes.freelancerAbsCleanup){
    const freeIds=new Set((d.users||[]).filter(u=>u.role==='freiberuflich').map(u=>u.id));
    Object.keys(d.entries||{}).forEach(k=>{
      const uid2=k.split('_').slice(0,-2).join('_'); // entryKey = uid_year_month
      if(!freeIds.has(uid2)) return;
      const days=d.entries[k]?.days||{};
      Object.keys(days).forEach(ds=>{
        const day=days[ds];
        // Durch Abwesenheitssync erstellte Einträge: b1von=08:00, kein b1zuord, nur b1bem
        if(day&&day.b1von==='08:00'&&day.b1bis&&!day.b1zuord&&!day.b2von){
          day.b1von=''; day.b1bis=''; day.b1bem=''; day.ktmin='';
        }
      });
    });
    d._fixes.freelancerAbsCleanup=true;
  }
  // ──────────────────────────────────────────────────────────────
  if(!d._fixes.badCarryoverV2){
    Object.keys(d.entries||{}).forEach(k=>{
      const daysObj=d.entries[k]?.days;
      if(!daysObj) return;
      Object.keys(daysObj).forEach(ds=>{
        const day=daysObj[ds];
        const badTime=t=>t&&t.includes(':')&&parseInt(t.split(':')[0],10)>23;
        if(day.b1bem==='Übertrag 10h Korrektur'){ day.b1von='';day.b1bis='';day.b1zuord='';day.b1bem=''; }
        if(day.b2bem==='Übertrag 10h Korrektur'){ day.b2von='';day.b2bis='';day.b2zuord='';day.b2bem=''; }
        if(Number(day.ktmin||0)>600) day.ktmin=0;
        if(badTime(day.b1bis)){ day.b1von='';day.b1bis='';day.b1zuord='';day.b1bem=''; }
        if(badTime(day.b2bis)){ day.b2von='';day.b2bis='';day.b2zuord='';day.b2bem=''; }
        if(!day.b1von&&!day.b1bis&&!day.b2von&&!day.b2bis&&!Number(day.ktmin)&&!day.b1bem&&!day.b2bem)
          delete daysObj[ds];
      });
      if(d.entries[k].days&&Object.keys(d.entries[k].days).length===0)
        delete d.entries[k].days;
    });
    d._fixes.badCarryoverV2=true;
  }
  Object.values(d.entries).forEach(e=>{ if(e&&!e.days) e.days={}; });
  let adminSeen=false;
  d.users=d.users.filter(u=>{
    if(u.id==='admin'){ if(adminSeen) return false; adminSeen=true; }
    return true;
  });
  d.users.forEach(u=>{
    if(u.bundesland===undefined) u.bundesland='';
    if(!Array.isArray(u.teams)) u.teams=u.team?[u.team]:[];
    if(!Array.isArray(u.teamHistory)&&u.team){
      u.teamHistory=[{team:u.team,fromDate:'2025-01-01'}];
    } // alle Rollen bekommen teams-Array
    if(u.role==='admin'&&u.id!=='admin') u.role='mitarbeiter';
    if(u.role==='freiberuflich'&&u.maxHours===undefined) u.maxHours=0;
    if(u.id==='christian_bittner'||u.name==='Christian Bittner'){ u.role='freiberuflich'; if(!u.maxHours) u.maxHours=64; }
    if(!u.dpw||u.dpw<1) u.dpw=5;
  });
  if(!d.teams.includes('Vereinsentwicklung')) d.teams.push('Vereinsentwicklung');
  const _renameÖ=(arr,old,nw)=>{ const i=arr.indexOf(old); if(i>=0) arr[i]=nw; };
  _renameÖ(d.cats,'Öffentlichkeitsarbeit','Marketing & Öffentlichkeitsarbeit');
  _renameÖ(d.teams,'Öffentlichkeitsarbeit','Marketing & Öffentlichkeitsarbeit');
  if(d.teamCats){
    const _newKey='Marketing & Öffentlichkeitsarbeit';
    if(d.teamCats['Öffentlichkeitsarbeit']&&!d.teamCats[_newKey]){ d.teamCats[_newKey]=d.teamCats['Öffentlichkeitsarbeit']; }
    if(d.teamCats['Öffentlichkeitsarbeit']) delete d.teamCats['Öffentlichkeitsarbeit'];
    const _oldSlash='Marketing %2F Öffentlichkeitsarbeit';
    if(d.teamCats[_oldSlash]){ if(!d.teamCats[_newKey]) d.teamCats[_newKey]=d.teamCats[_oldSlash]; delete d.teamCats[_oldSlash]; }
    if(d.teamCats[_newKey]) _renameÖ(d.teamCats[_newKey],'Öffentlichkeitsarbeit','Marketing & Öffentlichkeitsarbeit');
  }
  d.users.forEach(u=>{ if(u.team==='Öffentlichkeitsarbeit') u.team='Marketing & Öffentlichkeitsarbeit'; });
  for(const [k,entry] of Object.entries(d.entries||{})){
    if(!entry||!entry.days) continue;
    const uid2=k.slice(0,k.length-8);
    const usr=d.users.find(u=>u.id===uid2);
    if(!usr||(usr.wh||0)<=0) continue;
    const dMin=Math.round((usr.wh/(usr.dpw||5))*60);
    for(const day of Object.values(entry.days)){
      if(!day) continue;
      const isVac=(day.b1zuord==='Urlaub'||day.b1zuord==='AU/Krank'||day.b1bem==='Urlaub'||day.b1bem==='AU/Krank');
      if(isVac&&!day.b1von&&!day.b1bis){
        day.b1von='08:00';
        day.b1bis=addMin('08:00',dMin);
        if(!day.b1zuord) day.b1zuord=(day.b1bem==='Urlaub')?'Urlaub':'AU/Krank';
      }
    }
  }
  const adminUser=d.users.find(u=>u.id==='admin');
  if(adminUser){ adminUser.role='admin'; }
  else{ d.users.unshift({id:'admin',name:'Administrator',role:'admin',pw:'admin123',city:'',wh:0,al:0,prevNeg:0,team:'',bundesland:'',teams:[]}); }
  if(!d.users.find(u=>u.id==='jens')) d.users.unshift({id:'jens',name:'Jens Kroker',role:'geschaeftsfuehrer',pw:'jens123',city:'',wh:40,al:30,prevNeg:0,team:'',bundesland:''});
  return d;
}

export function getData(){ return _dataCache||freshData(); }
export function setDataCache(d){ _dataCache=d; }
export function getDataCache(){ return _dataCache; }

export function saveRaw(d){
  _dataCache=d;
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(d)); }catch(e){}
  if(window._offlineMode){ window._pendingSync=true; return Promise.resolve(); }
  return window._fbRef?.set(d).catch(e=>{
    console.warn('Firebase sync error:',e);
    window._pendingSync=true;
  })||Promise.resolve();
}
export function mutate(fn){ const d=getData(); fn(d); return saveRaw(d); }

export function entryKey(uid,y,m){ return `${uid}_${y}_${String(m).padStart(2,'0')}`; }
export function getEntry(uid,y,m){
  const d=getData(); const k=entryKey(uid,y,m);
  if(!d.entries[k]){ d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}}; }
  if(!d.entries[k].days) d.entries[k].days={};
  return d.entries[entryKey(uid,y,m)];
}
export function setDay(uid,y,m,ds,field,val){
  mutate(d=>{
    const k=entryKey(uid,y,m);
    if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
    if(!d.entries[k].days) d.entries[k].days={};
    if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
    d.entries[k].days[ds][field]=val;
  });
}
export function setEntryField(uid,y,m,field,val){
  mutate(d=>{
    const k=entryKey(uid,y,m);
    if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
    d.entries[k][field]=val;
  });
}
export function getUser(id){ return getData().users.find(u=>u.id===id); }
export function getCustomRoles(){ return getData().customRoles||[]; }

export function _fk(s){ return String(s).replace(/[.#$\/\[\]]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()); }
export function _fd(s){ return String(s).replace(/%([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))); }
