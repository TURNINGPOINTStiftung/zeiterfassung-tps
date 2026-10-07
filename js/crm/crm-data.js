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

import { toast } from '../utils.js';

const CRM_LS_KEY = 'tps_crm_v1';
// Eingebaute Standard-Bäume (Erst-Befüllung). Weitere Bäume kann der Admin
// über crm/config anlegen – ihre Daten landen unter crm/<key>/<id> und werden
// generisch synchronisiert (siehe _normalize). 'config' & Co. sind reserviert.
const DEFAULT_TREE_KEYS = ['vereine','sozialakteure','fundraising','marketing'];
const RESERVED_KEYS     = ['vorlagen','teamprojekte','access','config','verteiler','veranstaltungen','workflows','pathAccess','shopItems','shopPlaces','shopOrders','shopLog','shopLoans','shopConfig'];
// Shop-Sammlungen (js/crm/shop.js): crm/<coll>/<id>, flach wie alle anderen Sammlungen.
export const SHOP_COLLS = ['shopItems','shopPlaces','shopOrders','shopLog','shopLoans','shopConfig'];

let _cache   = null;   // In-Memory-Cache des gesamten CRM
let _ref     = null;   // firebase.database().ref('crm')  – erst nach Init
let _histRef = null;   // firebase.database().ref('crm_history') – Backup-Verlauf
let _ready   = null;   // Promise, einmalig (Lazy-Init)
let _onChange= null;   // Re-Render-Hook (von der UI gesetzt)

const HISTORY_MS = 7*24*60*60*1000;  // Aufbewahrung: 7 Tage

export function setCrmRenderHook(fn){ _onChange = fn; }

// ── Schreib-Warteschlange (nur NOCH NICHT übertragene eigene Änderungen) ──
// Früher lud jedes Gerät beim Start ALLE lokal vorhandenen Datensätze hoch, die in der Cloud
// fehlten → ein Gerät mit altem Stand hat woanders gelöschte Einträge wiederbelebt. Jetzt merkt
// sich jedes Gerät nur die Pfade, deren Schreibvorgang noch nicht bestätigt ist, und spielt beim
// Start genau diese nach. Verweigert die Datenbank (fehlendes Recht), wird der Pfad verworfen.
const CRM_PENDING_KEY = 'tps_crm_pending_v1';
function _pendLoad(){ try{ const p=JSON.parse(localStorage.getItem(CRM_PENDING_KEY)||'{}'); return (p&&typeof p==='object')?p:{}; }catch(e){ return {}; } }
function _pendSave(p){ try{ localStorage.setItem(CRM_PENDING_KEY, JSON.stringify(p)); }catch(e){} }
function _isDenied(e){ const s=String((e&&(e.code||''))+' '+(e&&e.message||'')); return /permission/i.test(s); }
let _deniedToastTs = 0;
function _denied(path){
  console.warn('CRM: Schreiben verweigert (fehlendes Recht):', path);
  const now=Date.now(); if(now-_deniedToastTs<4000) return; _deniedToastTs=now;
  try{ toast('Keine Berechtigung – Änderung wurde nicht gespeichert.','err'); }catch(e){}
}
function _write(coll, id, val){
  const path = id==null ? coll : coll+'/'+id;
  const tok  = Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const p=_pendLoad(); p[path]={ op: val===null?'del':'set', t: tok }; _pendSave(p);
  if(!_ref) return Promise.resolve();
  const clear=()=>{ const q=_pendLoad(); if(q[path] && q[path].t===tok){ delete q[path]; _pendSave(q); } };
  let pr;
  try{ const r=_ref.child(path); pr = val===null ? r.remove() : r.set(val); }catch(e){ return Promise.resolve(); }
  return pr.then(clear).catch(e=>{
    if(_isDenied(e)){ clear(); _denied(path); }
    console.warn('CRM Firebase-Fehler ('+path+'):', e && e.message);
  });
}
// Beim Start: nur die eigenen, noch offenen Schreibvorgänge nachholen.
function _replayPending(local){
  const p=_pendLoad();
  Object.keys(p).forEach(path=>{
    const it=p[path]||{}; const parts=path.split('/');
    let val=null;
    if(it.op==='set'){
      val = parts.length>1 ? (local[parts[0]]&&local[parts[0]][parts[1]]) : local[parts[0]];
      if(val==null){ delete p[path]; return; }   // lokal nicht mehr vorhanden → nichts nachzuholen
    }
    delete p[path]; _pendSave(p);
    _write(parts[0], parts.length>1?parts[1]:null, val);
  });
  _pendSave(p);
}

// ── Änderungs-Verlauf (Backup) ─────────────────────────────────────
// Jede inhaltliche Änderung (Anlegen/Ändern/Löschen) wird mit Person +
// Zeitstempel als Voll-Schnappschuss nach crm_history/<autoId> geschrieben.
// Liegt bewusst in einem EIGENEN Ref (nicht crm/), damit der normale Sync
// klein bleibt. Alles best-effort und in try/catch – darf nie etwas brechen.
function _logHistory(coll, recId, action, data, name){
  try{
    if(!_histRef || !data) return;
    const cu = (typeof window!=='undefined' && window.cu) || {};
    _histRef.push({
      ts: Date.now(), action, coll, recId,
      byId: cu.id||'', byName: cu.name||'',
      byKuerzel: (data.updatedByKuerzel)||(data.createdByKuerzel)||'',
      name: name||'',
      data: JSON.parse(JSON.stringify(data))
    }).catch(()=>{});
  }catch(e){}
}
function pruneHistory(maxAgeMs){
  try{
    if(!_histRef) return;
    const cutoff = Date.now() - (maxAgeMs||HISTORY_MS);
    _histRef.orderByChild('ts').endAt(cutoff).once('value').then(snap=>{
      const updates={}; snap.forEach(ch=>{ updates[ch.key]=null; });
      if(Object.keys(updates).length) _histRef.update(updates).catch(()=>{});
    }).catch(()=>{});
  }catch(e){}
}
// Einträge der letzten maxAgeMs (neueste zuerst). Liefert immer ein Array.
export function listHistory(maxAgeMs){
  return new Promise(resolve=>{
    try{
      if(!_histRef){ resolve([]); return; }
      const cutoff = Date.now() - (maxAgeMs||HISTORY_MS);
      _histRef.orderByChild('ts').startAt(cutoff).once('value').then(snap=>{
        const out=[]; snap.forEach(ch=>{ const v=ch.val()||{}; v._key=ch.key; out.push(v); });
        out.sort((a,b)=>(b.ts||0)-(a.ts||0));
        resolve(out);
      }).catch(()=>resolve([]));
    }catch(e){ resolve([]); }
  });
}
// Einen Schnappschuss wieder einspielen (re-save in die passende Sammlung).
export function restoreHistory(entry){
  if(!entry || !entry.data) return Promise.resolve();
  const coll=entry.coll, data=entry.data;
  if(coll==='config')       return saveCrmConfig(data);
  if(coll==='teamprojekte') return saveTeamProjekt(data);
  if(coll==='veranstaltungen') return saveVeranstaltung(data);
  if(coll==='vorlagen')     return saveVorlage(data);
  if(coll==='verteiler')    return saveVerteiler(data);
  if(SHOP_COLLS.includes(coll)) return saveShop(coll, data);
  return saveEntity(coll, data);  // sonst: Baum-Eintrag
}

function freshCrm(){
  const out = { vorlagen:{}, teamprojekte:{}, access:{}, verteiler:{}, veranstaltungen:{}, workflows:{}, config:null, pathAccess:null,
                shopItems:{}, shopPlaces:{}, shopOrders:{}, shopLog:{}, shopLoans:{}, shopConfig:{} };
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
        // Änderungs-Verlauf (Backup) liegt in einem SEPARATEN Ref, damit er den
        // normalen CRM-Sync nicht aufbläht. Wird nur bei Bedarf (Admin) gelesen.
        try{ _histRef = firebase.database().ref('crm_history'); pruneHistory(HISTORY_MS); }catch(e){ _histRef=null; }
        const snap = await _ref.once('value');
        // ── Cloud ist Quelle der Wahrheit ──────────────────────────────
        // Nur die EIGENEN, noch nicht bestätigten Änderungen dieses Geräts (Warteschlange)
        // werden über den Cloud-Stand gelegt und nachgeholt – nichts sonst. So kann ein Gerät
        // mit altem Cache keine woanders gelöschten Datensätze mehr wiederbeleben.
        const fb    = _normalize(snap.val() || {});
        const local = _cache || freshCrm();
        const pend  = _pendLoad();
        Object.keys(pend).forEach(path=>{
          const it=pend[path]||{}; const parts=path.split('/'); const c=parts[0], id=parts[1];
          if(id==null){ if(it.op==='set' && local[c]!=null) fb[c]=local[c]; return; }
          if(!fb[c] || typeof fb[c]!=='object') fb[c]={};
          if(it.op==='del') delete fb[c][id];
          else if(local[c] && local[c][id]) fb[c][id]=local[c][id];
        });
        _cache = fb;
        _persistLocal();
        _replayPending(local);
        // Realtime: nur den CRM-Teilbaum beobachten
        _ref.on('value', s => {
          try{
            const v = s.val();
            _cache = _normalize(v);
            _persistLocal();
            // Re-Render nur, wenn CRM/Kanban aktiv ist und kein Formular offen ist
            // (Kanban teilt sich die Engine mit dem CRM → beide Pfade müssen live nachziehen)
            if((window._activeModule === 'crm' || window._activeModule === 'kanban') && !window._crmModalOpen && _onChange){
              _onChange();
            }
            // Shop: eigenes Modul – live nachziehen (nicht während ein Dialog offen ist)
            if(window._activeModule === 'shop' && window.renderShop){
              const mb=document.getElementById('modal-bg');
              if(!(mb && mb.classList.contains('show'))) window.renderShop();
            }
            // Mitteilungsleiste (Shop-Bestellungen) auffrischen
            try{ window.renderZeNotices && window.renderZeNotices(); }catch(e){}
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
  _logHistory(tree, entity.id, 'save', entity, (entity.stamm&&entity.stamm.name)||entity.name||'');
  try{
    return _write(tree, entity.id, entity).catch(e=>{
      console.warn('CRM saveEntity Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveEntity:', e && e.message); }
  return Promise.resolve();
}

export function deleteEntity(tree, id){
  const d = getCrm();
  const prev = d[tree] && d[tree][id];
  if(prev) _logHistory(tree, id, 'delete', prev, (prev.stamm&&prev.stamm.name)||prev.name||'');
  if(d[tree]) delete d[tree][id];
  _cache = d;
  _persistLocal();
  try{
    return _write(tree, id, null).catch(e=>{
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
  _logHistory('vorlagen', v.id, 'save', v, v.name||'');
  try{
    return _write('vorlagen', v.id, v).catch(e=>{
      console.warn('CRM saveVorlage Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveVorlage:', e && e.message); }
  return Promise.resolve();
}
export function deleteVorlage(id){
  const d = getCrm();
  const prev = d.vorlagen && d.vorlagen[id];
  if(prev) _logHistory('vorlagen', id, 'delete', prev, prev.name||'');
  if(d.vorlagen) delete d.vorlagen[id];
  _cache = d;
  _persistLocal();
  try{
    return _write('vorlagen', id, null).catch(e=>{
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
  _logHistory('teamprojekte', p.id, 'save', p, p.name||'');
  try{
    return _write('teamprojekte', p.id, p).catch(e=>{
      console.warn('CRM saveTeamProjekt Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveTeamProjekt:', e && e.message); }
  return Promise.resolve();
}
export function deleteTeamProjekt(id){
  const d = getCrm();
  const prev = d.teamprojekte && d.teamprojekte[id];
  if(prev) _logHistory('teamprojekte', id, 'delete', prev, prev.name||'');
  if(d.teamprojekte) delete d.teamprojekte[id];
  _cache = d;
  _persistLocal();
  try{
    return _write('teamprojekte', id, null).catch(e=>{
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

// ── Shop (Lager + Bestellungen) ────────────────────────────────────
// Generisch für alle SHOP_COLLS: crm/<coll>/<id>. Verlauf (crm_history) nur für Artikel/Orte/
// Bestellungen – das Buchungs-Log (shopLog) IST selbst der Verlauf.
export function saveShop(coll, rec){
  if(!SHOP_COLLS.includes(coll) || !rec || !rec.id) return Promise.resolve();
  rec.updatedAt = Date.now();
  const d = getCrm();
  if(!d[coll] || typeof d[coll]!=='object') d[coll] = {};
  d[coll][rec.id] = rec;
  _cache = d;
  _persistLocal();
  if(coll!=='shopLog') _logHistory(coll, rec.id, 'save', rec, rec.name||rec.itemName||rec.freitext||'');
  try{ return _write(coll, rec.id, rec); }catch(e){ console.warn('CRM saveShop:', e && e.message); }
  return Promise.resolve();
}
export function deleteShop(coll, id){
  if(!SHOP_COLLS.includes(coll) || !id) return Promise.resolve();
  const d = getCrm();
  const prev = d[coll] && d[coll][id];
  if(prev && coll!=='shopLog') _logHistory(coll, id, 'delete', prev, prev.name||prev.itemName||prev.freitext||'');
  if(d[coll]) delete d[coll][id];
  _cache = d;
  _persistLocal();
  try{ return _write(coll, id, null); }catch(e){ console.warn('CRM deleteShop:', e && e.message); }
  return Promise.resolve();
}
export function listShop(coll){ const d=getCrm(); return Object.values((d && d[coll]) || {}); }
export function getShop(coll, id){ const d=getCrm(); return (d && d[coll] && d[coll][id]) || null; }

// ── E-Mail-Verteiler (gespeicherte Adresslisten) ──────────────────
// Liegen unter crm/verteiler/<id> = { id, name, emails:[], note?, … }.
export function saveVerteiler(v){
  if(!v || !v.id) return Promise.resolve();
  // Keine Adresse doppelt (Groß/Klein egal) – greift für JEDEN Speicherweg (Modal, Kontakt-Häkchen, Import).
  if(Array.isArray(v.emails)){
    const seen = new Set();
    v.emails = v.emails.map(e=>String(e||'').trim().replace(/^mailto:/i,'').replace(/^[<>"'()\[\]]+|[<>"'()\[\].:]+$/g,'').trim()).filter(e=>{ const k=e.toLowerCase(); if(!e || seen.has(k)) return false; seen.add(k); return true; });
  }
  v.updatedAt = Date.now();
  const d = getCrm();
  if(!d.verteiler) d.verteiler = {};
  d.verteiler[v.id] = v;
  _cache = d;
  _persistLocal();
  _logHistory('verteiler', v.id, 'save', v, v.name||'');
  try{
    return _write('verteiler', v.id, v).catch(e=>{
      console.warn('CRM saveVerteiler Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveVerteiler:', e && e.message); }
  return Promise.resolve();
}
export function deleteVerteiler(id){
  const d = getCrm();
  const prev = d.verteiler && d.verteiler[id];
  if(prev) _logHistory('verteiler', id, 'delete', prev, prev.name||'');
  if(d.verteiler) delete d.verteiler[id];
  _cache = d;
  _persistLocal();
  try{
    return _write('verteiler', id, null).catch(e=>{
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

// ── Veranstaltungen (übergreifend, referenzieren 0..n Einträge) ────
// Liegen unter crm/veranstaltungen/<id> = { id, titel, start, ende, online,
// ortOderLink, teilnehmer:[{tree,eid}], team, beschreibung, todos:[], closed }.
export function saveVeranstaltung(v){
  if(!v || !v.id) return Promise.resolve();
  v.updatedAt = Date.now();
  const d = getCrm();
  if(!d.veranstaltungen) d.veranstaltungen = {};
  d.veranstaltungen[v.id] = v;
  _cache = d;
  _persistLocal();
  _logHistory('veranstaltungen', v.id, 'save', v, v.titel||'');
  try{
    return _write('veranstaltungen', v.id, v).catch(e=>{
      console.warn('CRM saveVeranstaltung Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveVeranstaltung:', e && e.message); }
  return Promise.resolve();
}
export function deleteVeranstaltung(id){
  const d = getCrm();
  const prev = d.veranstaltungen && d.veranstaltungen[id];
  if(prev) _logHistory('veranstaltungen', id, 'delete', prev, prev.titel||'');
  if(d.veranstaltungen) delete d.veranstaltungen[id];
  _cache = d;
  _persistLocal();
  try{
    return _write('veranstaltungen', id, null).catch(e=>{
      console.warn('CRM deleteVeranstaltung Firebase-Fehler:', e && e.message);
    });
  }catch(e){ console.warn('CRM deleteVeranstaltung:', e && e.message); }
  return Promise.resolve();
}
export function getVeranstaltung(id){ const d=getCrm(); return (d.veranstaltungen && d.veranstaltungen[id]) || null; }
export function listVeranstaltungen(){
  const d = getCrm();
  return Object.values(d.veranstaltungen || {}).sort((a,b)=>
    String(a.start||'').localeCompare(String(b.start||''))
  );
}

// ── CRM-Zugriffsrechte (pro ZE-Nutzer, isoliert unter crm/access) ──
// { level:'none'|'verein'|'full', vereinId? }  – steuert die CRM-Sicht.
export function saveAccess(uid, obj){
  if(!uid) return Promise.resolve();
  const d=getCrm(); if(!d.access) d.access={};
  if(obj===null) delete d.access[uid]; else d.access[uid]=obj;
  _cache=d; _persistLocal();
  return _write('access', uid, obj===null?null:obj);
}
export function getAccess(uid){ const d=getCrm(); return (d.access && d.access[uid]) || null; }

// ── Zugriffs-Matrix (welche Rolle sieht welches Modul) ─────────────
// Liegt seit v365 in einem EIGENEN Knoten crm/pathAccess (nur Admin darf schreiben), nicht in
// crm/config (das dürfen CRM-Verwalter ändern). Marker _v:1 = migriert; bis dahin gilt der alte
// Stand aus config.pathAccess.
export function getPathAccess(){
  const d=getCrm();
  // Kein Rückgriff mehr auf config.pathAccess (war in der Produktion leer; CRM-Verwalter dürfen config
  // schreiben → ein Rückgriff wäre eine Hintertür).
  if(d.pathAccess && typeof d.pathAccess==='object'){ const o=Object.assign({}, d.pathAccess); delete o._v; return o; }
  return {};
}
export function isPathAccessMigrated(){ const d=getCrm(); return !!(d.pathAccess && d.pathAccess._v); }
export function savePathAccess(pa){
  const val=Object.assign({}, (pa&&typeof pa==='object')?pa:{}, { _v:1 });
  const d=getCrm(); d.pathAccess=val; _cache=d; _persistLocal();
  return _write('pathAccess', null, val);
}

// ── Vollbackup: gesamten CRM-Blob exportieren / wiederherstellen ───
// exportCrmBlob liefert eine tiefe Kopie aller CRM-Daten (Bäume, config, access, vorlagen,
// teamprojekte, veranstaltungen, verteiler). restoreCrmBlob ersetzt ALLES (ein Backup-Restore)
// – Cache + localStorage + ein einziger _ref.set(). Nur über die Verwaltung mit Bestätigung.
export function exportCrmBlob(){ try{ return JSON.parse(JSON.stringify(getCrm())); }catch(e){ return getCrm(); } }
export function restoreCrmBlob(obj){
  if(!obj || typeof obj!=='object' || Array.isArray(obj)) return Promise.resolve();
  _cache = obj; _persistLocal();
  try{ if(_ref) return _ref.set(obj).catch(e=>console.warn('CRM restoreCrmBlob Firebase-Fehler:', e && e.message)); }
  catch(e){ console.warn('CRM restoreCrmBlob:', e && e.message); }
  return Promise.resolve();
}

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
  _logHistory('config', 'config', 'save', cfg, 'CRM-Konfiguration');
  try{
    return _write('config', null, cfg).catch(e=>{
      console.warn('CRM saveCrmConfig Firebase-Fehler (lokal gespeichert):', e && e.message);
    });
  }catch(e){ console.warn('CRM saveCrmConfig:', e && e.message); }
  return Promise.resolve();
}

// Kurze, kollisionsarme ID
export function newId(){
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
