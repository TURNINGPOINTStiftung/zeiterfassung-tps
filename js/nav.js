// ══════════════════════════════════════════════════════════════════
//  Zurück-Taste + sprechende Adressen innerhalb der App
//  Die App ist eine einzige Seite – ohne das hier verlässt „Zurück" sofort die ganze App,
//  und nach dem Neuladen landet man immer am Anfang.
//
//  • Nach jedem Klick wird der aktuelle ORT in der App festgehalten (Modul, Ansicht, Reiter,
//    geöffneter Eintrag). Hat er sich geändert, entsteht ein neuer Verlaufs-Schritt.
//    Filter/Suche gehören bewusst NICHT dazu (sonst müsste man sich durch jeden Filter zurückklicken).
//  • Jeder Ort hat eine lesbare Adresse, z. B. #/crm/kontakte/vereine/tsv-kronshagen~c1ab2cd
//    oder #/shop/ausleihen. Neu laden behält den Ort, Links lassen sich teilen (🔗 in der Kopfzeile).
//    Maßgeblich ist die ID hinter „~"; der Name davor ist nur zum Lesen (Umbenennen schadet nicht).
//    Rechte gelten weiter: Ein Link in ein Modul ohne Zugriff landet in der normalen Startansicht.
//  • Offene Fenster (#modal-bg) bekommen einen eigenen Schritt: „Zurück" schließt das Fenster.
//  • Ganz am Anfang: Hinweis „Zum Verlassen nochmal Zurück" – erst das nächste Zurück verlässt die App.
//  • Module mit eigenem (nicht globalem) Zustand melden sich über
//      (window._navRegs = window._navRegs || {})[modul] = { get:()=>obj, set:(obj)=>{…}, path:obj=>'teil', parse:'teil'=>obj }
//    an (Shop, Kalender). set() setzt nur den Zustand – gezeichnet wird über switchModule().
//  Alles best effort: ein Fehler hier darf die App nie stören.
// ══════════════════════════════════════════════════════════════════
import * as CD from './crm/crm-data.js';

const CRM_KEYS=['_crmMode','_crmTree','_crmSelId','_crmDetailTab','_crmProjSel','_crmTeamProjSel','_crmTeamSel','_crmVaSel'];
const CRM_MODS=['crm','kanban','verteiler'];
// Extra-Auswahl im CRM als ?-Parameter (kurze, lesbare Namen)
const CRM_Q={ _crmProjSel:'projekt', _crmTeamProjSel:'teamprojekt', _crmTeamSel:'team', _crmVaSel:'veranstaltung' };

let _initHash=(()=>{ try{ return location.hash||''; }catch(e){ return ''; } })();   // vor allem anderen merken
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
    else if(CRM_MODS.includes(mod)){ s.c={}; CRM_KEYS.forEach(k=>{ const v=window[k]; s.c[k]=(v===undefined||v===''?null:v); }); }
    else if(mod==='verwaltung'){ const t=document.querySelector('#verw-root .verw-tab.active'); s.vt=(t&&t.getAttribute('data-vtab'))||''; }
    const r=(window._navRegs||{})[mod]; if(r && r.get) s.r=r.get();
  }catch(e){}
  return s;
}
const _key=s=>{ if(!s||!s.nav) return ''; const o=Object.assign({},s); delete o.modal; delete o.root; return JSON.stringify(o); };

// ── Lesbare Adresse ↔ Ort ──────────────────────────────────────────
function slug(t){
  return String(t||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
}
const _enc=s=>encodeURIComponent(String(s));
function _named(name,id){ const sl=slug(name); return (sl?sl+'~':'')+_enc(id); }
function _idOf(part){ const p=decodeURIComponent(String(part||'')); const i=p.lastIndexOf('~'); return i>=0?p.slice(i+1):p; }
function _entName(tree,id){ try{ const e=CD.getEntity&&CD.getEntity(tree,id); return e&&e.stamm&&e.stamm.name||''; }catch(e){ return ''; } }
function _qName(k,id){ try{
    if(k==='_crmVaSel'){ const v=CD.getVeranstaltung&&CD.getVeranstaltung(id); return v&&v.titel||''; }
    if(k==='_crmTeamProjSel'){ const p=CD.getTeamProjekt&&CD.getTeamProjekt(id); return p&&(p.name||p.titel)||''; }
  }catch(e){} return ''; }

function toHash(s){
  if(!s||!s.nav) return '';
  const parts=[s.mod]; const q=[];
  try{
    if(s.mod==='zeiterfassung'){ if(s.v) parts.push(s.v); }
    else if(CRM_MODS.includes(s.mod) && s.c){
      const c=s.c;
      if(c._crmMode) parts.push(c._crmMode);
      if(c._crmTree) parts.push(c._crmTree);
      if(c._crmSelId){ parts.push(_named(_entName(c._crmTree,c._crmSelId), c._crmSelId)); if(c._crmDetailTab) parts.push(c._crmDetailTab); }
      Object.keys(CRM_Q).forEach(k=>{ if(c[k]) q.push(CRM_Q[k]+'='+_named(_qName(k,c[k]),c[k])); });
    }
    else if(s.mod==='verwaltung'){ if(s.vt) parts.push(s.vt); }
    const r=(window._navRegs||{})[s.mod];
    if(s.r && r && r.path){ const p=r.path(s.r); if(p) parts.push(p); }
  }catch(e){}
  return '#/'+parts.map(p=>String(p).split('/').map(x=>x.includes('~')?x:_enc(x)).join('/')).join('/')+(q.length?'?'+q.join('&'):'');
}
function fromHash(h){
  try{
    h=String(h||''); if(!h.startsWith('#/')) return null;
    const [path,query]=h.slice(2).split('?');
    const parts=path.split('/').filter(Boolean); if(!parts.length) return null;
    const mod=decodeURIComponent(parts[0]); const s={ nav:1, mod }; const rest=parts.slice(1);
    if(mod==='zeiterfassung'){ if(rest[0]) s.v=decodeURIComponent(rest[0]); }
    else if(CRM_MODS.includes(mod)){
      const c={}; CRM_KEYS.forEach(k=>c[k]=null);
      if(rest[0]) c._crmMode=decodeURIComponent(rest[0]);
      if(rest[1]) c._crmTree=decodeURIComponent(rest[1]);
      if(rest[2]) c._crmSelId=_idOf(rest[2]);
      if(rest[3]) c._crmDetailTab=decodeURIComponent(rest[3]);
      (query||'').split('&').filter(Boolean).forEach(kv=>{ const [k,v]=kv.split('='); const key=Object.keys(CRM_Q).find(x=>CRM_Q[x]===k); if(key&&v) c[key]=_idOf(v); });
      s.c=c;
    }
    else if(mod==='verwaltung'){ if(rest[0]) s.vt=decodeURIComponent(rest[0]); }
    const r=(window._navRegs||{})[mod];
    if(r && r.parse && rest.length) s.r=r.parse(rest.map(decodeURIComponent).join('/'));
    return s;
  }catch(e){ return null; }
}
// Darf der Nutzer dorthin? (Rechte stecken in der Oberfläche: sichtbare Menüpunkte/Reiter)
function _allowed(s){
  try{
    if(s.mod!=='zeiterfassung'){ const b=document.querySelector('.mb-mod[data-mod="'+s.mod+'"]'); if(!b || b.style.display==='none') return false; }
    // ZE-Reiter ohne Recht (ausgeblendet) → nur das Modul öffnen, Reiter wie üblich
    if(s.mod==='zeiterfassung' && s.v && ![...document.querySelectorAll('.nav-tab[data-view="'+s.v+'"]')].some(t=>t.style.display!=='none')) s.v='';
    return true;
  }catch(e){ return false; }
}
function _url(s){ const h=toHash(s); return h?location.pathname+location.search+h:location.pathname+location.search; }

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
    if(_key(s)!==_key(cur)) history.pushState(s,'',_url(s));
    else if(location.hash!==toHash(s)) history.replaceState(cur,'',_url(s));   // Name nachgeladen → Adresse auffrischen
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
    if(CRM_MODS.includes(s.mod) && s.c) CRM_KEYS.forEach(k=>{ window[k]=s.c[k]===null?'':s.c[k]; });
    const r=(window._navRegs||{})[s.mod]; if(r && r.set && s.r) r.set(s.r);
    if(window.switchModule) window.switchModule(s.mod);
    if(s.mod==='zeiterfassung' && s.v && window.switchView) window.switchView(s.v);
    // Verwaltung baut sich erst nach dem Laden der CRM-Daten auf → Reiter ein paarmal nachsetzen
    if(s.mod==='verwaltung' && s.vt) [120,900,2500].forEach(ms=>setTimeout(()=>{ try{
      const on=document.querySelector('#verw-root .verw-tab.active'); if(window.verwShowTab && (!on || on.getAttribute('data-vtab')!==s.vt)) window.verwShowTab(s.vt); }catch(e){} }, ms));
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
    if(st && st.modal) history.replaceState(Object.assign({},st,{modal:false}),'',_url(st));
    return;
  }
  // 2) Ganz am Anfang angekommen → Hinweis; die App bleibt stehen. Das NÄCHSTE „Zurück" verlässt
  //    sie dann ganz normal (Browser bzw. Android schließt die App – das können wir nicht abfangen).
  //    Der Anfangs-Eintrag merkt sich die Start-Ansicht: ist man woanders, geht es erst dorthin zurück.
  if(st && st.root){
    if(st.nav && _key(st)!==_key(snap())){ apply(st); const s=Object.assign({},st); delete s.root; history.pushState(s,'',_url(s)); return; }
    try{ window.toast && window.toast('Zum Verlassen der App nochmal „Zurück"',''); }catch(err){}
    return;
  }
  if(!st || !st.nav){   // von Hand eingegebene/eingefügte Adresse (#/…) → dorthin
    const s=fromHash(location.hash);
    if(s && _allowed(s)){ apply(s); history.replaceState(s,'',_url(s)); }
    else { const cur=snap(); history.replaceState(cur,'',_url(cur));
      if(s) try{ window.toast && window.toast('Für diesen Link fehlt dir der Zugriff.','err'); }catch(err){} }
    return;
  }
  // 3) Vorheriger Ort
  apply(st);
  if(st.modal) history.replaceState(Object.assign({},st,{modal:false}),'',_url(st));
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
    const home=snap();
    history.replaceState(Object.assign({},home,{root:1}),'',_url(home));
    // Mit Adresse geöffnet (Link, Lesezeichen, Neu laden) → direkt dorthin; „Zurück" führt dann zur Startansicht
    const target=fromHash(_initHash);
    if(target && _allowed(target) && _key(target)!==_key(home)){ apply(target); history.pushState(target,'',_url(target)); }
    else { history.pushState(home,'',_url(home));
      if(target && !_allowed(target)) setTimeout(()=>{ try{ window.toast && window.toast('Für diesen Link fehlt dir der Zugriff.','err'); }catch(e){} }, 800); }
    if(_isModalOpen()) _pushModal();
    window.addEventListener('popstate', onPop);
    _watchModal(); _watchCrumbs(); renderCrumbs();
    const after=()=>{ if(_restoring) return; setTimeout(()=>{ if(!_restoring) _pushView(); }, 80); };
    document.addEventListener('click', after, true);
    document.addEventListener('change', after, true);
    // Namen (CRM) laden evtl. erst später → Adresse einmal nachziehen
    setTimeout(()=>{ try{ const cur=history.state; if(cur&&cur.nav&&!cur.modal) history.replaceState(cur,'',_url(cur)); }catch(e){} }, 3000);
  }catch(e){ console.warn('[Nav] Start fehlgeschlagen:', e); }
}

// ── ⭐ Favorit-Knopf im CRM-Rahmen + „Zuletzt geöffnet" erfassen ──
// (Die Brotkrumen-Leisten v415/v424 sind auf User-Wunsch wieder entfernt – „stört eher".)
// Geblieben ist nur der ⭐: direkt HINTER dem Namen (erste <h2> der Detailansicht – Verein/Eintrag,
// Veranstaltung, Projekt; User-Wunsch), nur mit Startseite. Wird bei jedem Neuzeichnen von #crm-root
// (MutationObserver) wieder angehängt, weil paint() die Überschrift neu baut.
function renderCrumbs(){
  try{
    const root=document.getElementById('crm-root'); if(!root) return;
    const old=document.getElementById('nav-crumbs'); if(old) old.remove();   // Leiste aus v415–v424
    // Geöffneten Eintrag für „Zuletzt geöffnet" auf der Startseite merken (js/home.js)
    const _s=snap(); try{ window.homeTrack && window.homeTrack(_s); }catch(e){}
    let home=false; try{ home=!!(window.homeEnabled && window.homeEnabled()); }catch(e){}
    const fk=home && window.homeCurrentKey ? window.homeCurrentKey(_s) : '';
    const h=root.querySelector('h2');
    const cur=document.getElementById('nav-fav');
    if(!fk || !h){ if(cur) cur.remove(); return; }
    const on=window.homeFavHas(fk);
    const btn=cur && h.contains(cur) ? cur : document.createElement('button');
    btn.id='nav-fav'; btn.type='button'; btn.setAttribute('onclick','event.stopPropagation();navFav()');
    btn.title=on?'Aus den Favoriten entfernen':'Als Favorit merken (erscheint auf der Startseite)';
    btn.setAttribute('aria-label', btn.title);
    btn.style.cssText='border:none;background:none;cursor:pointer;font-size:.9em;line-height:1;padding:0 4px;margin-left:6px;vertical-align:middle;color:'+(on?'#f5a623':'#b8bec7');
    btn.textContent=on?'★':'☆';
    if(btn!==cur){ if(cur) cur.remove(); h.appendChild(btn); }
  }catch(e){}
}
function navFav(){ try{ const k=window.homeCurrentKey&&window.homeCurrentKey(snap()); if(k){ window.homeFavToggle(k); renderCrumbs(); } }catch(e){} }
let _crumbT=null;
function _watchCrumbs(){
  const root=document.getElementById('crm-root'); if(!root) return;
  new MutationObserver(()=>{ clearTimeout(_crumbT); _crumbT=setTimeout(renderCrumbs, 60); }).observe(root,{childList:true});
}

// 🔗 Link zur aktuellen Ansicht teilen/kopieren
async function navCopyLink(){
  const url=location.origin+_url(snap());
  try{
    if(navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)){ await navigator.share({ title:document.title||'TPS', url }); return; }
  }catch(e){ if(e && e.name==='AbortError') return; }
  try{ await navigator.clipboard.writeText(url); window.toast && window.toast('🔗 Link kopiert – führt direkt zu dieser Ansicht','ok'); }
  catch(e){ try{ window.prompt('Link zu dieser Ansicht:', url); }catch(err){} }
}

// Erst nach dem Login loslegen (vorher gibt es keinen „Ort"): Modulleiste sichtbar = App ist aufgebaut
(function wait(){
  try{ const mb=document.getElementById('module-bar');
    if(window.cu && document.getElementById('modal-bg') && mb && mb.style.display!=='none'){ setTimeout(start, 300); return; } }catch(e){}
  setTimeout(wait, 400);
})();

try{ window.navSnapshot=snap; window.navCopyLink=navCopyLink; window.navToHash=toHash; window.navFromHash=fromHash; window.navFav=navFav;
  window.navResetInitial=()=>{ _initHash=''; };   // frischer Login (auth.js doLogin): gemerkte Ansicht verwerfen
}catch(e){}
