import { STORAGE_KEY, _STAMP_KEY, DEFAULT_CATS, DEFAULT_TEAMS, DEFAULT_USERS } from './config.js';
import { addMin } from './utils.js';

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
    if(!Array.isArray(u.teams)) u.teams=u.team?[u.team]:[]; // alle Rollen bekommen teams-Array
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
