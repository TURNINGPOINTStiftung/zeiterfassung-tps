// ══════════════════════════════════════════════════════════════════
//  Zurück-Taste innerhalb der App (Browser-Zurück, Android-Zurück/Wischgeste)
//  Die App ist eine einzige Seite – ohne das hier verlässt „Zurück" sofort die ganze App.
//
//  • Nach jedem Klick wird der aktuelle ORT in der App festgehalten (Modul, Ansicht, Reiter,
//    geöffneter Eintrag). Hat er sich geändert, entsteht ein neuer Verlaufs-Schritt.
//    Filter/Suche gehören bewusst NICHT dazu (sonst müsste man sich durch jeden Filter zurückklicken).
//  • Offene Fenster (#modal-bg) bekommen einen eigenen Schritt: „Zurück" schließt das Fenster.
//  • Ganz am Anfang: Hinweis „Zum Verlassen nochmal Zurück" – erst das nächste Zurück verlässt die App.
//  • Module mit eigenem (nicht globalem) Zustand melden sich über
//      (window._navRegs = window._navRegs || {})[modul] = { get:()=>obj, set:(obj)=>{…} }
//    an (Shop, Kalender). set() setzt nur den Zustand – gezeichnet wird über switchModule().
//  Alles best effort: ein Fehler hier darf die App nie stören.
// ══════════════════════════════════════════════════════════════════

const CRM_KEYS=['_crmMode','_crmTree','_crmSelId','_crmDetailTab','_crmProjSel','_crmTeamProjSel','_crmTeamSel','_crmVaSel'];
const CRM_MODS=['crm','kanban','verteiler'];

let _started=false, _restoring=false, _modalShown=false, _closingByPop=false;
let _pendingBack=null, _awaitPop=0, _queue=[];

function _bg(){ return document.getElementById('modal-bg'); }
function _isModalOpen(){ const b=_bg(); return !!(b && b.classList.contains('show')); }

// Aktueller Ort in der App (ohne Modal-Kennzeichen)
function snap(){
  const mod=window._activeModule||'zeiterfassung';
  const s={ nav:1, mod };
  try{
    if(mod==='zeiterfassung'){ const t=document.querySelector('.nav-tab.active'); s.v=(t&&t.dataset.view)||''; }
    else if(CRM_MODS.includes(mod)){ s.c={}; CRM_KEYS.forEach(k=>{ const v=window[k]; s.c[k]=(v===undefined?null:v); }); }
    else if(mod==='verwaltung'){ const t=document.querySelector('#verw-root .verw-tab.active'); s.vt=(t&&t.getAttribute('data-vtab'))||''; }
    const r=(window._navRegs||{})[mod]; if(r && r.get) s.r=r.get();
  }catch(e){}
  return s;
}
const _key=s=>{ if(!s||!s.nav) return ''; const o=Object.assign({},s); delete o.modal; delete o.root; return JSON.stringify(o); };

// Verlaufs-Schritte nacheinander abarbeiten: während ein history.back() noch unterwegs ist,
// warten neue Schritte, sonst landen sie an der falschen Stelle.
function _do(fn){ if(_awaitPop) _queue.push(fn); else fn(); }
function _flush(){ while(!_awaitPop && _queue.length){ try{ _queue.shift()(); }catch(e){} } }
function _back(){ _awaitPop++; history.back(); }

function _pushView(){
  _do(()=>{
    if(_isModalOpen()) return;
    const s=snap(); const cur=history.state;
    if(cur && cur.modal) return;
    if(_key(s)!==_key(cur)) history.pushState(s,'');
  });
}
function _pushModal(){
  _do(()=>{ const cur=history.state; if(cur && cur.modal) return;
    history.pushState(Object.assign({}, (cur&&cur.nav)?cur:snap(), {modal:true}),''); });
}

// Ort wiederherstellen
function apply(s){
  if(!s || !s.nav) return;
  _restoring=true;
  try{
    if(CRM_MODS.includes(s.mod) && s.c) CRM_KEYS.forEach(k=>{ window[k]=s.c[k]; });
    const r=(window._navRegs||{})[s.mod]; if(r && r.set && s.r) r.set(s.r);
    if(window.switchModule) window.switchModule(s.mod);
    if(s.mod==='zeiterfassung' && s.v && window.switchView) window.switchView(s.v);
    if(s.mod==='verwaltung' && s.vt && window.verwShowTab) setTimeout(()=>{ try{ window.verwShowTab(s.vt); }catch(e){} }, 120);
  }catch(e){ console.warn('[Nav] Wiederherstellen fehlgeschlagen:', e); }
  setTimeout(()=>{ _restoring=false; }, 200);
}

function onPop(e){
  if(_awaitPop>0){ _awaitPop--; _flush(); return; }   // selbst ausgelöst (Fenster wurde per Knopf geschlossen)
  const st=e.state;
  // 1) Offenes Fenster → nur schließen
  if(_isModalOpen()){
    _closingByPop=true; const b=_bg(); if(b) b.classList.remove('show');
    try{ window._crmModalOpen=false; }catch(err){}
    if(st && st.modal) history.replaceState(Object.assign({},st,{modal:false}),'');
    return;
  }
  // 2) Ganz am Anfang angekommen → Hinweis; die App bleibt stehen. Das NÄCHSTE „Zurück" verlässt
  //    sie dann ganz normal (Browser bzw. Android schließt die App – das können wir nicht abfangen).
  //    Der Anfangs-Eintrag merkt sich die Start-Ansicht: ist man woanders, geht es erst dorthin zurück.
  if(st && st.root){
    if(st.nav && _key(st)!==_key(snap())){ apply(st); const s=Object.assign({},st); delete s.root; history.pushState(s,''); return; }
    try{ window.toast && window.toast('Zum Verlassen der App nochmal „Zurück"',''); }catch(err){}
    return;
  }
  if(!st || !st.nav) return;   // fremder Verlaufs-Eintrag (z. B. Link mit „#") – nichts tun
  // 3) Vorheriger Ort
  apply(st);
  if(st.modal) history.replaceState(Object.assign({},st,{modal:false}),'');
}

function _watchModal(){
  const b=_bg(); if(!b) return;
  _modalShown=_isModalOpen();
  new MutationObserver(()=>{
    const shown=_isModalOpen();
    if(shown===_modalShown) return;
    _modalShown=shown;
    if(shown){
      if(_pendingBack){ clearTimeout(_pendingBack); _pendingBack=null; return; }   // gleich wieder geöffnet → Schritt weiterverwenden
      _pushModal();
    } else {
      if(_closingByPop){ _closingByPop=false; return; }
      // Per Knopf/Hintergrund geschlossen → den Fenster-Schritt still entfernen
      _pendingBack=setTimeout(()=>{ _pendingBack=null;
        if(!_isModalOpen() && history.state && history.state.modal) _back(); }, 0);
    }
  }).observe(b,{attributes:true, attributeFilter:['class']});
}

function start(){
  if(_started) return; _started=true;
  try{
    history.replaceState(Object.assign(snap(),{root:1}),'');
    history.pushState(snap(),'');
    if(_isModalOpen()) _pushModal();
    window.addEventListener('popstate', onPop);
    _watchModal();
    const after=()=>{ if(_restoring) return; setTimeout(()=>{ if(!_restoring) _pushView(); }, 80); };
    document.addEventListener('click', after, true);
    document.addEventListener('change', after, true);
  }catch(e){ console.warn('[Nav] Start fehlgeschlagen:', e); }
}

// Erst nach dem Login loslegen (vorher gibt es keinen „Ort")
(function wait(){
  try{ if(window.cu && document.getElementById('modal-bg')){ start(); return; } }catch(e){}
  setTimeout(wait, 400);
})();

try{ window.navSnapshot=snap; }catch(e){}
