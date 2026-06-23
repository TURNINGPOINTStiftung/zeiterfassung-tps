// ══════════════════════════════════════════════════════════════════
//  CRM-Datenmodul  –  KOMPLETT ISOLIERT von der Zeiterfassung
// ══════════════════════════════════════════════════════════════════
//  Design-Grundsatz (Vorgabe): Die Zeiterfassung darf von hier NIE
//  betroffen sein.  Deshalb:
//   • eigener Firebase-Ref  'crm'  (nicht der 'zeiterfassung'-Blob)
//   • eigener Cache + eigenes localStorage
//   • Lazy-Init: Verbindung entsteht erst beim ersten Öffnen des CRM
//   • granulare Writes pro Datensatz  (crm/<baum>/<id>) – kein Whole-
//     Blob-Set, daher kein Sync-Risiko wie in der Zeiterfassung
//   • es wird NIEMALS  window._fbRef  oder der zeiterfassung-Ref berührt
//   • alles in try/catch – ein CRM-Fehler kann die ZE nicht erschlagen
// ══════════════════════════════════════════════════════════════════

const CRM_LS_KEY = 'tps_crm_v1';
// Eingebaute Standard-Bäume (Erst-Befüllung). Weitere Bäume kann der Admin
// über crm/config anlegen – ihre Daten landen unter crm/<key>/<id> und werden
// generisch synchronisiert (siehe _normalize). 'config' & Co. sind reserviert.
const DEFAULT_TREE_KEYS = ['vereine','sozialakteure','fundraising','marketing'];
const RESERVED_KEYS     = ['vorlagen','teamprojekte','access','config','verteiler'];

let _cache   = null;   // In-Memory-Cache des gesamten CRM
let _ref     = null;   // firebase.database().ref('crm')  – erst nach Init
let _ready   = null;   // Promise, einmalig (Lazy-Init)
let _onChange= null;   // Re-Render-Hook (von der UI gesetzt)

export function setCrmRenderHook(fn){ _onChange = fn; }

function freshCrm(){
  const out = { vorlagen:{}, teamprojekte:{}, access:{}, verteiler:{}, config:null };
  DEFAULT_TREE_KEYS.forEach(k=>{ out[k]={}; });
  return out;
}

// Generisch: ALLE objekt-wertigen Top-Level-Knoten übernehmen. So werden
// admin-konfigurierte Bäume (crm/<neuerKey>) automatisch mitgeführt, ohne
// die Datenschicht anzufassen. 'config' wird als Objekt durchgereicht.
function _normalize(v){
  const out = freshCrm();
  if(v && typeof v === 'object'){
    Object.keys(v).forEach(k=>{ if(v[k] && typeof v[k]==='object') out[k] = v[k]; });
  }
  return out;
}

function _persistLocal(){
  try{ localStorage.setItem(CRM_LS_KEY, JSON.stringify(_cache)); }catch(e){}
}

// Synchroner Zugriff auf den Cache (für die UI). Liefert immer ein Objekt.
export function getCrm(){ return _cache || freshCrm(); }

// Lazy-Init – wird beim ersten Öffnen des CRM aufgerufen.
// Nutzt die BEREITS von der Zeiterfassung initialisierte Firebase-App,
// hängt sich aber nur an einen ANDEREN Ref ('crm'). Fällt sauber auf
// reinen localStorage-/Memory-Betrieb zurück, wenn Firebase fehlt.
export function ensureCrmReady(){
  if(_ready) return _ready;
  _ready = (async () => {
    // 1) Sofort lokalen Stand laden, damit etwas da ist
    try{
      const ls = localStorage.getItem(CRM_LS_KEY);
      if(ls) _cache = _normalize(JSON.parse(ls));
    }catch(e){}
    if(!_cache) _cache = freshCrm();

    // 2) Firebase (best effort, isoliert)
    try{
      if(window.firebase && firebase.apps && firebase.apps.length){
        _ref = firebase.database().ref('crm');
        const snap = await _ref.once('value');
        // ── Merge lokal ⇄ Cloud (Auto-Upload) ────────────────────────
        // Firebase ist Quelle der Wahrheit; ABER lokal vorhandene Datensätze,
        // die in der Cloud fehlen ODER lokal neuer sind (updatedAt), werden
        // hochgeladen. So gehen offline/regel-blockiert angelegte Einträge
        // nicht verloren und erscheinen nach Regel-Fix auch auf Mobil.
        const fb    = _normalize(snap.val() || {});
        const local = _cache || freshCrm();
        // Datensatz-Sammlungen (alle objekt-wertigen Knoten außer 'config')
        const COLLS = Object.keys(local).filter(k=> k!=='config' && local[k] && typeof local[k]==='object');
        COLLS.forEach(coll=>{
          const lobj = local[coll] || {};
          if(!fb[coll]) fb[coll] = {};
          Object.keys(lobj).forEach(id=>{
            const lrec = lobj[id]; if(!lrec || typeof lrec!=='object') return;
            const frec = fb[coll][id];
            if(!frec || (lrec.updatedAt||0) > (frec.updatedAt||0)){
              fb[coll][id] = lrec;
              try{ if(_ref) _ref.child(coll).child(id).set(lrec).catch(()=>{}); }catch(e){}
            }
          });
        });
        // Konfiguration: lokal neuere Version hochladen (sonst gewinnt die Cloud)
        if(local.config && (!fb.config || (local.config.updatedAt||0) > (fb.config.updatedAt||0))){
          fb.config = local.config;
          try{ if(_ref) _ref.child('config').set(local.config).catch(()=>{}); }catch(e){}
        }
        _cache = fb;
        _persistLocal();
        // Realtime: nur den CRM-Teilbaum beobachten
        _ref.on('value', s => {
          try{
            const v = s.val();
            _cache = _normalize(v);
            _persistLocal();
            // Re-Render nur, wenn CRM aktiv ist und kein Formular offen ist
            if(window._activeModule === 'crm' && !window._crmModalOpen && _onChange){
              _onChange();
            }
          }catch(e){ console.warn('CRM Snapshot Fehler (ignoriert):', e); }
        });
      }
    }catch(e){
      console.warn('CRM Firebase nicht erreichbar – lokaler Modus:', e && e.message);
    }
    return _cache;
  })();
  return _ready;
}

// ── Granulare Writes (pro Datensatz) ───────────────────────────────
// Schreibt NUR  crm/<tree>/<id>  – belastet nichts anderes.
export function saveEntity(tree, entity){
  if(!tree || typeof tree!=='string' || RESERVED_KEYS.includes(tree) || !entity || !entity.id) return Promise.resolve();
  entity.updatedAt = Date.now();
  const d = getCrm();
  if(!d[tree]) d[tree] = {};
  d[tree][entity.id] = entity;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child(tree).child(entity.id).set(entity).catch(e=>{
      console.warn('CRM saveEntity Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveEntity:', e && e.message); }
  return Promise.resolve();
}

export function deleteEntity(tree, id){
  const d = getCrm();
  if(d[tree]) delete d[tree][id];
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child(tree).child(id).remove().catch(e=>{
      console.warn('CRM deleteEntity Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteEntity:', e && e.message); }
  return Promise.resolve();
}

export function getEntity(tree, id){
  const d = getCrm();
  return (d[tree] && d[tree][id]) || null;
}

export function listEntities(tree){
  const d = getCrm();
  const obj = d[tree] || {};
  return Object.values(obj).sort((a,b)=>
    String((a.stamm&&a.stamm.name)||'').localeCompare(String((b.stamm&&b.stamm.name)||''), 'de', {sensitivity:'base'})
  );
}

// ── Aufgaben-Vorlagen ──────────────────────────────────────────────
// Wiederverwendbare ToDo-Sets (z. B. je Veranstaltung). Liegen unter
// crm/vorlagen/<id>. Granulare Writes, isoliert wie alles Übrige.
export function saveVorlage(v){
  if(!v || !v.id) return Promise.resolve();
  v.updatedAt = Date.now();
  const d = getCrm();
  if(!d.vorlagen) d.vorlagen = {};
  d.vorlagen[v.id] = v;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('vorlagen').child(v.id).set(v).catch(e=>{
      console.warn('CRM saveVorlage Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveVorlage:', e && e.message); }
  return Promise.resolve();
}
export function deleteVorlage(id){
  const d = getCrm();
  if(d.vorlagen) delete d.vorlagen[id];
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('vorlagen').child(id).remove().catch(e=>{
      console.warn('CRM deleteVorlage Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteVorlage:', e && e.message); }
  return Promise.resolve();
}
export function getVorlage(id){
  const d = getCrm();
  return (d.vorlagen && d.vorlagen[id]) || null;
}
export function listVorlagen(){
  const d = getCrm();
  return Object.values(d.vorlagen || {}).sort((a,b)=>
    String(a.name||'').localeCompare(String(b.name||''), 'de', {sensitivity:'base'})
  );
}

// ── Team-Projekte (eigenständig, unabhängig von Einträgen) ─────────
// Liegen unter crm/teamprojekte/<id>. Enthalten eigene Aufgaben (todos)
// in derselben hierarchischen Struktur wie die Einträge.
export function saveTeamProjekt(p){
  if(!p || !p.id) return Promise.resolve();
  p.updatedAt = Date.now();
  const d = getCrm();
  if(!d.teamprojekte) d.teamprojekte = {};
  d.teamprojekte[p.id] = p;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('teamprojekte').child(p.id).set(p).catch(e=>{
      console.warn('CRM saveTeamProjekt Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveTeamProjekt:', e && e.message); }
  return Promise.resolve();
}
export function deleteTeamProjekt(id){
  const d = getCrm();
  if(d.teamprojekte) delete d.teamprojekte[id];
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('teamprojekte').child(id).remove().catch(e=>{
      console.warn('CRM deleteTeamProjekt Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteTeamProjekt:', e && e.message); }
  return Promise.resolve();
}
export function getTeamProjekt(id){
  const d = getCrm();
  return (d.teamprojekte && d.teamprojekte[id]) || null;
}
export function listTeamProjekte(team){
  const d = getCrm();
  let arr = Object.values(d.teamprojekte || {});
  if(team!=null) arr = arr.filter(p => (p.team||'') === (team||''));
  return arr.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'de', {sensitivity:'base'}));
}

// ── E-Mail-Verteiler (gespeicherte Adresslisten) ──────────────────
// Liegen unter crm/verteiler/<id> = { id, name, emails:[], note?, … }.
export function saveVerteiler(v){
  if(!v || !v.id) return Promise.resolve();
  v.updatedAt = Date.now();
  const d = getCrm();
  if(!d.verteiler) d.verteiler = {};
  d.verteiler[v.id] = v;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('verteiler').child(v.id).set(v).catch(e=>{
      console.warn('CRM saveVerteiler Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveVerteiler:', e && e.message); }
  return Promise.resolve();
}
export function deleteVerteiler(id){
  const d = getCrm();
  if(d.verteiler) delete d.verteiler[id];
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('verteiler').child(id).remove().catch(e=>{
      console.warn('CRM deleteVerteiler Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteVerteiler:', e && e.message); }
  return Promise.resolve();
}
export function getVerteiler(id){ const d=getCrm(); return (d.verteiler && d.verteiler[id]) || null; }
export function listVerteiler(){
  const d = getCrm();
  return Object.values(d.verteiler || {}).sort((a,b)=>
    String(a.name||'').localeCompare(String(b.name||''), 'de', {sensitivity:'base'})
  );
}

// ── CRM-Zugriffsrechte (pro ZE-Nutzer, isoliert unter crm/access) ──
// { level:'none'|'verein'|'full', vereinId? }  – steuert die CRM-Sicht.
export function saveAccess(uid, obj){
  if(!uid) return Promise.resolve();
  const d=getCrm(); if(!d.access) d.access={};
  if(obj===null) delete d.access[uid]; else d.access[uid]=obj;
  _cache=d; _persistLocal();
  try{
    if(_ref){
      const ref=_ref.child('access').child(uid);
      return (obj===null?ref.remove():ref.set(obj)).catch(e=>console.warn('CRM saveAccess:', e && e.message));
    }
  }catch(e){ console.warn('CRM saveAccess:', e && e.message); }
  return Promise.resolve();
}
export function getAccess(uid){ const d=getCrm(); return (d.access && d.access[uid]) || null; }

// ── CRM-Konfiguration (admin-editierbare Bäume & Felder) ───────────
// Liegt unter crm/config (ein einzelnes Objekt, kein Datensatz-Map).
// null = noch nie konfiguriert → die UI fällt auf die Code-Defaults zurück.
export function getCrmConfig(){ const d=getCrm(); return d.config || null; }
export function saveCrmConfig(cfg){
  if(!cfg || typeof cfg!=='object') return Promise.resolve();
  cfg.updatedAt = Date.now();
  const d = getCrm();
  d.config = cfg;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('config').set(cfg).catch(e=>{
      console.warn('CRM saveCrmConfig Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveCrmConfig:', e && e.message); }
  return Promise.resolve();
}

// Kurze, kollisionsarme ID
export function newId(){
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
