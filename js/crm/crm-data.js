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
const TREE_KEYS  = ['vereine','sozialakteure','fundraising'];

let _cache   = null;   // In-Memory-Cache des gesamten CRM
let _ref     = null;   // firebase.database().ref('crm')  – erst nach Init
let _ready   = null;   // Promise, einmalig (Lazy-Init)
let _onChange= null;   // Re-Render-Hook (von der UI gesetzt)

export function setCrmRenderHook(fn){ _onChange = fn; }

function freshCrm(){ return { vereine:{}, sozialakteure:{}, fundraising:{}, projekte:{} }; }

function _normalize(v){
  const out = freshCrm();
  if(v && typeof v === 'object'){
    TREE_KEYS.forEach(k=>{ if(v[k] && typeof v[k]==='object') out[k] = v[k]; });
    if(v.projekte && typeof v.projekte==='object') out.projekte = v.projekte;
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
        const val  = snap.val();
        if(val){ _cache = _normalize(val); _persistLocal(); }
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
  if(!TREE_KEYS.includes(tree) || !entity || !entity.id) return Promise.resolve();
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

// ── Projekte (Projektmanagement) ───────────────────────────────────
// Liegen im selben isolierten 'crm'-Ref unter crm/projekte/<id>, damit die
// Verknüpfung mit CRM-Einträgen direkt funktioniert. Granulare Writes.
export function saveProjekt(p){
  if(!p || !p.id) return Promise.resolve();
  p.updatedAt = Date.now();
  const d = getCrm();
  if(!d.projekte) d.projekte = {};
  d.projekte[p.id] = p;
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('projekte').child(p.id).set(p).catch(e=>{
      console.warn('CRM saveProjekt Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveProjekt:', e && e.message); }
  return Promise.resolve();
}
export function deleteProjekt(id){
  const d = getCrm();
  if(d.projekte) delete d.projekte[id];
  _cache = d;
  _persistLocal();
  try{
    if(_ref) return _ref.child('projekte').child(id).remove().catch(e=>{
      console.warn('CRM deleteProjekt Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteProjekt:', e && e.message); }
  return Promise.resolve();
}
export function getProjekt(id){
  const d = getCrm();
  return (d.projekte && d.projekte[id]) || null;
}
export function listProjekte(){
  const d = getCrm();
  return Object.values(d.projekte || {}).sort((a,b)=>
    String(a.titel||'').localeCompare(String(b.titel||''), 'de', {sensitivity:'base'})
  );
}
// Alle Projekte, die mit einem bestimmten CRM-Eintrag verknüpft sind.
export function listProjekteForEntity(tree, id){
  return listProjekte().filter(p =>
    Array.isArray(p.links) && p.links.some(l => l && l.tree===tree && l.id===id)
  );
}

// Kurze, kollisionsarme ID
export function newId(){
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
