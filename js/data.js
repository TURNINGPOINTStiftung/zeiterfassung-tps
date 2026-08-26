import { STORAGE_KEY, _STAMP_KEY, DEFAULT_CATS, DEFAULT_TEAMS, DEFAULT_USERS } from './config.js';
import { addMin, diffMin, tMin, getHolidays } from './utils.js';

// Deckelt eine Uhrzeit auf 24:00 (Mitternacht) – verhindert ungültige Zeiten wie 25:30.
function _clamp24(t){ if(!t||!t.includes(':')) return t; const p=t.split(':'); const h=+p[0], m=+p[1]; return (h>24||(h===24&&m>0))?'24:00':t; }

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

  // Freiberufler-IDs (keine Pausen-Logik für sie)
  const _freeIds=new Set((d.users||[]).filter(u=>u.role==='freiberuflich').map(u=>u.id));
  const _uidOf=k=>k.split('_').slice(0,-2).join('_');

  // ── Pause-Migration (einmalig) ─────────────────────────────────
  // Historische b1bis-Einträge hatten die auto-Pause nicht eingerechnet.
  // Nach Einführung der Pause-Abziehung in der Formel würden sie zu wenig zeigen.
  // Pause-Migration: einmalig pro Tag (Idempotenz-Flag auf Tages-Ebene)
  try{
    const _ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
    Object.entries(d.entries||{}).forEach(([k,entry])=>{
      if(!entry||!entry.days) return; // null-Guard
      if(_freeIds.has(_uidOf(k))) return; // Freiberufler: keine Pause
      Object.values(entry.days).forEach(day=>{
        if(!day||!day.b1von||!day.b1bis) return;
        if(day._pInit) return; // von der Live-Pausenlogik verwaltet → Pause ist bereits korrekt aufgeschlagen, NICHT erneut migrieren (sonst Doppel-Aufschlag beim Reload)
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
          const add=Math.min(autoPause, Math.max(0, 1440 - tMin(day.b1bis))); // 24:00-Deckelung
          if(add>0) day.b1bis=addMin(day.b1bis,add);
          day._pauseMigratedV2=true;
        }
      });
    });
    d._fixes.pauseMigrationV1=true;
    d._fixes.pauseMigrationV2=true;
  }catch(e){ console.error('Pause-Migration Fehler (ignoriert):',e); }

  // ── Zwei-Block-Pausen-Migration (einmalig pro Tag) ──────────────
  // Historische Zwei-Block-Tage: b2bis um fehlende Pflichtpause anheben,
  // damit Netto = eingetragene Arbeitszeit (konsistent mit Einzelblock).
  try{
    const _ABS2=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
    Object.entries(d.entries||{}).forEach(([k,entry])=>{
      if(!entry||!entry.days) return;
      if(_freeIds.has(_uidOf(k))) return; // Freiberufler: keine Pause
      Object.values(entry.days).forEach(day=>{
        if(!day||day._b2PauseMig) return;
        if(day._pInit) return; // von der Live-Pausenlogik verwaltet → nicht erneut migrieren
        if(!day.b1von||!day.b1bis||!day.b2von||!day.b2bis) return; // nur echte Zwei-Block-Tage
        if(_ABS2.has(day.b1zuord)||_ABS2.has(day.b1bem)) return;
        const grossNet=diffMin(day.b1von,day.b1bis)+diffMin(day.b2von,day.b2bis)+Number(day.ktmin||0);
        const required=grossNet>=540?45:grossNet>=360?30:0;
        let gap=0; const g=diffMin(day.b1bis,day.b2von); if(g>0) gap=g;
        const missing=Math.max(0,required-gap);
        if(missing>0){ const add=Math.min(missing, Math.max(0, 1440 - tMin(day.b2bis))); if(add>0) day.b2bis=addMin(day.b2bis,add); } // 24:00-Deckelung
        day._b2PauseMig=true; // markieren (auch wenn 0, damit idempotent)
      });
    });
    d._fixes.b2PauseMigrationV1=true;
  }catch(e){ console.error('B2-Pause-Migration Fehler (ignoriert):',e); }

  // ── Sicherheits-Deckelung: keine Uhrzeit über 24:00 ─────────────
  // Fängt ungültige Endzeiten wie 25:30 ab (entstanden durch früheren, gestapelten
  // Pausen-Aufschlag). Läuft bei jedem Load, ist idempotent.
  try{
    Object.values(d.entries||{}).forEach(entry=>{
      if(!entry||!entry.days) return;
      Object.values(entry.days).forEach(day=>{
        if(!day) return;
        ['b1von','b1bis','b2von','b2bis'].forEach(f=>{ if(day[f]) day[f]=_clamp24(day[f]); });
      });
    });
  }catch(e){ console.error('24:00-Deckelung Fehler (ignoriert):',e); }

  // ── Freiberufler-Pause-Rücknahme (einmalig) ─────────────────────
  // Frühere Migrationen haben bei Freiberuflern Pause auf b1bis addiert.
  // Da Freiberufler keine Pause haben, wird das hier rückgängig gemacht.
  try{
    Object.entries(d.entries||{}).forEach(([k,entry])=>{
      if(!entry||!entry.days) return;
      if(!_freeIds.has(_uidOf(k))) return; // nur Freiberufler
      Object.values(entry.days).forEach(day=>{
        if(!day) return;
        if((day._pauseMigratedV2||day._pauseMigrated||day._b2PauseMig)&&day.b1bis&&!day.b2von){
          const g=diffMin(day.b1von||'',day.b1bis||'')+Number(day.ktmin||0);
          const p=g>=585?45:g>=390?30:0; // inverse Pausenschwelle
          if(p>0) day.b1bis=addMin(day.b1bis,-p);
        }
        delete day._pauseMigrated; delete day._pauseMigratedV2; delete day._b2PauseMig;
      });
    });
    d._fixes.freelancerPauseRollbackV1=true;
  }catch(e){ console.error('Freelancer-Pause-Rollback Fehler (ignoriert):',e); }

  // Abwesenheits-Migrationen werden in firebase.js nach dem Laden ausgeführt
  // (benötigen getHolidays aus utils.js – hier nicht verfügbar ohne Zirkularität)
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

  // Einmalige Korrektur von Simons Team-Verlauf: bis 31.05.2026 Akademie,
  // ab 01.06.2026 Marketing & Öffentlichkeitsarbeit. Läuft genau einmal (Flag),
  // danach frei über die Einstellungen editierbar.
  if(!d._fixes.simonTeamV2){
    const _si=(d.users||[]).find(u=>u.id==='simon'||/^simon\s+scheidt/i.test(u.name||''));
    if(_si){
      _si.teamHistory=[
        {team:'Akademie',fromDate:'2025-01-01'},
        {team:'Marketing & Öffentlichkeitsarbeit',fromDate:'2026-06-01'}
      ];
      _si.team='Marketing & Öffentlichkeitsarbeit';
      _si.teams=['Marketing & Öffentlichkeitsarbeit'];
      d._fixes.simonTeamV2=true;
    }
  }
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
  // Team-Felder der User (team / teams[] / teamHistory[].team) auf ALLE
  // historischen Schreibweisen prüfen, nicht nur das reine "Öffentlichkeitsarbeit"
  // von oben. Der Teamname durchlief mehrere Zwischenstufen (Slash- und
  // URL-encodierte Variante, siehe normZuord in calc.js für Kategorien) – blieb
  // z.B. bei einer Leitung eine alte Schreibweise im teams-Array stehen, matcht
  // teamHasLeitung() nicht mehr und der GF sieht deren Team-Mitglieder faelschlich
  // direkt (statt sie der Leitung zu reporten).
  const _MKT_RE=/^(Ö-Arbeit|Öffentlichkeitsarbeit|Marketing\s*[\/&]\s*Öffentlichkeitsarbeit|Marketing\s*%2F\s*Öffentlichkeitsarbeit)$/i;
  const _MKT='Marketing & Öffentlichkeitsarbeit';
  const _normÖ=t=>_MKT_RE.test(t||'')?_MKT:t;
  d.users.forEach(u=>{
    if(_MKT_RE.test(u.team||'')) u.team=_MKT;
    if(Array.isArray(u.teams)) u.teams=[...new Set(u.teams.map(_normÖ))];
    if(Array.isArray(u.teamHistory)) u.teamHistory.forEach(h=>{ if(h&&_MKT_RE.test(h.team||'')) h.team=_MKT; });
  });
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
  // Leitung-Buchhaltungsberichte: alten Fixnamen „Leitung (Buchhaltung)" auf das
  // Team der jeweiligen Leitung umstellen (z.B. „Leitung Akademie"). Idempotent.
  if(d.teamReports){
    Object.values(d.teamReports).forEach(r=>{
      if(!r||r.teamName!=='Leitung (Buchhaltung)') return;
      const lu=(d.users||[]).find(u=>u.id===r.leitungId);
      const lt=lu?((Array.isArray(lu.teams)&&lu.teams.length)?lu.teams:(lu.team?[lu.team]:[])):[];
      r.teamName='Leitung'+(lt.length?' '+lt.join(', '):'');
    });
  }
  const adminUser=d.users.find(u=>u.id==='admin');
  if(adminUser){ adminUser.role='admin'; }
  else{ d.users.unshift({id:'admin',name:'Administrator',role:'admin',pw:'admin123',city:'',wh:0,al:0,team:'',bundesland:'',teams:[]}); }
  if(!d.users.find(u=>u.id==='jens')) d.users.unshift({id:'jens',name:'Jens Kroker',role:'geschaeftsfuehrer',pw:'jens123',city:'',wh:40,al:30,team:'',bundesland:''});
  return d;
}

export function getData(){ return _dataCache||freshData(); }
export function setDataCache(d){ _dataCache=d; }
export function getDataCache(){ return _dataCache; }

// ── Datenverlust-Schutz ("bulletproof") ───────────────────────────
// Merkt sich den höchsten je gesehenen vertrauenswürdigen Datenbestand
// (Nutzeranzahl + erfasste Tage). Ein Schreibvorgang, der diesen drastisch
// unterschreiten würde (z.B. versehentliches Überschreiben der ganzen DB mit
// Test-/Leerdaten), wird BLOCKIERT – nur mit explizitem Opt-in erlaubt.
let _lastGoodUsers=0, _lastGoodDayCount=0;
// Vertrauens-Baseline übersteht Reloads (localStorage). Ein Gerät, das schon einmal den
// vollen Bestand gesehen hat, blockiert danach AUCH NACH EINEM NEUSTART einen drastisch
// kleineren Schreibvorgang. (Vorher nur pro Sitzung gemerkt – genau die Lücke, durch die
// ein frisch geladenes Gerät die Nutzerliste auf 3 zusammenschrumpfen konnte.)
const _GUARD_KEY='tp_zt_guard';
try{ const _g=JSON.parse(localStorage.getItem(_GUARD_KEY)||'null'); if(_g){ _lastGoodUsers=Math.max(0,+_g.u||0); _lastGoodDayCount=Math.max(0,+_g.d||0); } }catch(e){}
function _dayCount(d){ let n=0; for(const e of Object.values(d?.entries||{})) n+=Object.keys((e&&e.days)||{}).length; return n; }
export function noteGoodData(d){
  if(!d||!Array.isArray(d.users)) return;
  _lastGoodUsers=Math.max(_lastGoodUsers, d.users.length);
  _lastGoodDayCount=Math.max(_lastGoodDayCount, _dayCount(d));
  try{ localStorage.setItem(_GUARD_KEY, JSON.stringify({u:_lastGoodUsers, d:_lastGoodDayCount})); }catch(e){}
}
// Schreibt den Datenstand per update() statt set() nach Firebase. Entscheidend:
// entries werden bis auf TAGES-Ebene als einzelne Pfade geschrieben (entries/<key>/days/<ds>),
// die übrigen Top-Level-Schlüssel als ganzer Wert. update() ersetzt NUR die aufgeführten
// Pfade und löscht NICHTS, was nicht dabei ist. Dadurch kann ein Gerät mit VERALTETEM Stand
// keine Tage/Einträge mehr löschen, die es (noch) nicht kennt – z.B. einen gerade am PC
// eingetragenen Tag. (set() hätte den ganzen Baum ersetzt und Unbekanntes gelöscht.)
export function fbWriteMerge(d){
  const ref=window._fbRef; if(!ref||!d) return Promise.resolve();
  // WICHTIG: Firebase .update() WIRFT synchron, sobald IRGENDWO ein undefined-Wert im Baum steht
  // (häufige Falle, z. B. teamHistory/paramHistory ohne Vorwert beim Bearbeiten). Das ließ das
  // ganze Speichern mit „Speichern fehlgeschlagen" scheitern. JSON-Roundtrip entfernt undefined
  // zuverlässig (undefined-Objektschlüssel fallen weg). Firebase kann undefined ohnehin nicht speichern.
  try{ d = JSON.parse(JSON.stringify(d)); }catch(e){}
  const upd={};
  for(const k of Object.keys(d)){
    if(k==='entries'){
      const es=d.entries||{};
      for(const ek of Object.keys(es)){
        const e=es[ek]; if(!e){ continue; }
        for(const f of Object.keys(e)){
          if(f==='days'){
            const days=e.days||{};
            // Leeres days-Objekt trotzdem anlegen, damit ein frischer Eintrag existiert.
            if(Object.keys(days).length===0){ upd['entries/'+ek+'/days']=e.days||{}; }
            else { for(const ds of Object.keys(days)) upd['entries/'+ek+'/days/'+ds]=days[ds]; }
          } else {
            upd['entries/'+ek+'/'+f]=e[f];
          }
        }
      }
    } else {
      upd[k]=d[k];
    }
  }
  return ref.update(upd);
}
export function saveRaw(d){
  // Sanity-Guard gegen Massen-Datenverlust. Greift nur bei DRASTISCHER Reduktion
  // (< Hälfte) gegenüber dem bisher bekannten guten Stand. Legitime Vollersetzungen
  // (Import/Wiederherstellung) setzen window._allowDataShrink=true.
  const nu=(d&&Array.isArray(d.users))?d.users.length:0;
  const nd=_dayCount(d);
  // Vergleich gegen den zuletzt PERSISTIERTEN Stand auf DIESEM Gerät (localStorage) – das ist
  // der echte "vorherige" Bestand. Ein In-Place-Edit (mutate) reduziert die Anzahl NICHT →
  // `nu < prevUsers` ist dann false → NIE Fehlalarm (behebt: jeder Edit wurde blockiert, sobald
  // die Baseline mal hoch stand). Ein Wipe (setDataCache(klein) + save) hat localStorage noch
  // GROSS (wird erst weiter unten überschrieben) → wird weiterhin zuverlässig blockiert.
  let prevUsers=0, prevDays=0;
  try{ const _p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); if(_p&&Array.isArray(_p.users)){ prevUsers=_p.users.length; prevDays=_dayCount(_p); } }catch(e){}
  const drasticUsers=_lastGoodUsers>=4 && nu < Math.ceil(_lastGoodUsers/2) && nu < prevUsers;
  const drasticDays =_lastGoodDayCount>=20 && nd < Math.floor(_lastGoodDayCount/2) && nd < prevDays;
  if((drasticUsers||drasticDays) && !window._allowDataShrink){
    const msg=`[Datenschutz] Schreibvorgang BLOCKIERT – würde den Bestand drastisch reduzieren `+
      `(Nutzer ${prevUsers}→${nu}, erfasste Tage ${prevDays}→${nd}). `+
      `Nichts gespeichert. Falls wirklich gewollt: window._allowDataShrink=true setzen.`;
    console.error(msg);
    try{ window.toast?.(`⛔ Nicht gespeichert – Schutz vor Datenverlust (Nutzer ${prevUsers}→${nu}). Bitte Seite neu laden.`,'err'); }catch(e){}
    return Promise.reject(new Error('data-shrink-guard'));
  }
  // Geräte-lokale 1-Schritt-Sicherung: den bisherigen guten Stand aufheben, BEVOR
  // überschrieben wird. Erlaubt lokales Zurückholen, falls doch mal etwas schiefgeht
  // (unabhängig von Firebase, ohne Regel-Änderung).
  try{ const prev=localStorage.getItem(STORAGE_KEY); if(prev) localStorage.setItem(STORAGE_KEY+'_prev', prev); }catch(e){}
  _dataCache=d;
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(d)); }catch(e){}
  // Cloud-Schutz: Solange der echte Cloud-Stand nicht bestätigt ist (dieses Gerät konnte beim
  // Start KEINE Cloud-User laden → window._cloudUnverified), NUR lokal speichern und NICHT in die
  // Cloud schreiben. Sonst könnten Default-/Teildaten den echten Bestand überschreiben. Der
  // Realtime-Listener löscht das Flag, sobald echte Daten ankommen. Explizites Restore/Import
  // (window._allowDataShrink) umgeht das bewusst.
  if(window._cloudUnverified && !window._allowDataShrink){ return Promise.resolve(); }
  noteGoodData(d);
  if(window._offlineMode){ window._pendingSync=true; return Promise.resolve(); }
  // Normale Bearbeitung: MERGEN via update() – löscht NICHTS, was dieses Gerät nicht kennt
  // (behebt: veraltetes Handy löscht am PC eingetragene Tage). Nur beim expliziten
  // Wiederherstellen/Import (window._allowDataShrink) wird der ganze Baum ersetzt (set()).
  // Cloud-Write im HINTERGRUND (best effort). Die Oberfläche wartet NICHT auf den Server-Roundtrip,
  // sonst bliebe ein „Speichern" bei langsamer/instabiler Verbindung sichtbar hängen (Dialog schließt
  // nie, Button bleibt ausgegraut). Der lokale Stand ist oben bereits gesichert; der Realtime-Listener
  // gleicht mit der Cloud ab. saveRaw meldet sich also fertig, sobald LOKAL gespeichert wurde.
  const _w = window._allowDataShrink ? (window._fbRef?.set(d)||Promise.resolve()) : fbWriteMerge(d);
  _w.catch(e=>{ console.warn('Firebase sync error:',e); window._pendingSync=true; });
  return Promise.resolve();
}
export function mutate(fn){ const d=getData(); fn(d); return saveRaw(d); }

export function entryKey(uid,y,m){ return `${uid}_${y}_${String(m).padStart(2,'0')}`; }
export function getEntry(uid,y,m){
  const d=getData(); const k=entryKey(uid,y,m);
  if(!d.entries[k]){ d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}}; }
  if(!d.entries[k].days) d.entries[k].days={};
  return d.entries[entryKey(uid,y,m)];
}
// ── Gezieltes Speichern (Mehrgeräte-sicher) ───────────────────────
// Frühere Ursache für „eingetragen → kurz danach weg": JEDES Speichern schrieb den GESAMTEN
// Bestand (alle Tage) zurück (mutate→saveRaw→fbWriteMerge). Ein zweites Gerät mit einem
// veralteten Tag im Speicher überschrieb damit den frisch eingetragenen Tag des anderen Geräts.
// Jetzt schreiben Tages-/Feld-Edits NUR den betroffenen Pfad – ein Gerät kann so nur noch den
// Tag/das Feld ändern, das die Person bewusst bearbeitet hat, niemals fremde (veraltete) Tage.
function _localPersist(d){
  _dataCache=d;
  try{ const prev=localStorage.getItem(STORAGE_KEY); if(prev) localStorage.setItem(STORAGE_KEY+'_prev', prev); }catch(e){}
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }catch(e){}
  noteGoodData(d);
}
function _cloudUpdate(upd){
  // Cloud-Schutz wie in saveRaw: unbestätigt/offline → nur lokal, Rest per Listener/Reconnect.
  if(window._cloudUnverified && !window._allowDataShrink) return Promise.resolve();
  if(window._offlineMode){ window._pendingSync=true; return Promise.resolve(); }
  const ref=window._fbRef; if(!ref) return Promise.resolve();
  try{ upd=JSON.parse(JSON.stringify(upd)); }catch(e){}   // undefined entfernen (Firebase wirft sonst)
  let p; try{ p=ref.update(upd); }catch(e){ window._pendingSync=true; return Promise.resolve(); }
  return (p||Promise.resolve()).catch(e=>{ console.warn('Firebase scoped-sync error:',e); window._pendingSync=true; });
}
// Pfade eines KOMPLETTEN Entry (nur nötig, wenn der Entry neu ist – analog fbWriteMerge, aber nur DIESER Entry).
function _entryPaths(k, entry){
  const e=JSON.parse(JSON.stringify(entry)); const upd={};
  for(const f of Object.keys(e)){
    if(f==='days'){ const days=e.days||{}; if(!Object.keys(days).length){ upd['entries/'+k+'/days']={}; } else { for(const dd of Object.keys(days)) upd['entries/'+k+'/days/'+dd]=days[dd]; } }
    else { upd['entries/'+k+'/'+f]=e[f]; }
  }
  return upd;
}
export function setDay(uid,y,m,ds,field,val){
  const d=getData(); const k=entryKey(uid,y,m);
  const wasNew=!d.entries[k];
  if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
  if(!d.entries[k].days) d.entries[k].days={};
  if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
  d.entries[k].days[ds][field]=val;
  _localPersist(d);
  const entry=d.entries[k];
  // Neuer Entry → einmal komplett; sonst NUR der geänderte Tag.
  const upd = wasNew ? _entryPaths(k, entry) : { ['entries/'+k+'/days/'+ds]: entry.days[ds] };
  return _cloudUpdate(upd);
}
export function setEntryField(uid,y,m,field,val){
  const d=getData(); const k=entryKey(uid,y,m);
  const wasNew=!d.entries[k];
  if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
  d.entries[k][field]=val;
  _localPersist(d);
  const entry=d.entries[k];
  // Neuer Entry → einmal komplett; sonst NUR dieses Feld.
  const upd = wasNew ? _entryPaths(k, entry) : { ['entries/'+k+'/'+field]: entry[field] };
  return _cloudUpdate(upd);
}
export function getUser(id){ return getData().users.find(u=>u.id===id); }
export function getCustomRoles(){ return getData().customRoles||[]; }

export function _fk(s){ return String(s).replace(/[.#$\/\[\]]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()); }
export function _fd(s){ return String(s).replace(/%([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))); }
