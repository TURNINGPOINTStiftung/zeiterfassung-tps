// ═════════════════════════════════════════════════════════════════
//  Shop-Modul (eigener ☰-Pfad, isoliert – wie kalender.js)
//  1) Lager: Artikel (Flaggen, Flyer, Branding, Bootsmaterial, Werkzeug …) mit Bestand
//     PRO ORT (Büro, Bus, Boot, Lager …), Mindestbestand, Foto, Umlagern, Buchungsverlauf.
//  2) Bestellungen: Mitarbeiter melden Bedarf (Katalog-Artikel oder freier Wunsch) mit
//     Menge, Anlass, Wunschtermin, Lieferort. Verwalter bearbeitet: In Bearbeitung →
//     Ausgeben (Bestand abziehen ODER an den Lieferort umlagern) / Erledigt / Abgelehnt.
//  Rechte (Verwaltung → Mitarbeiter → Zugriffe → Shop): Kein / Nutzen (sehen + bestellen)
//  / Verwaltend (zusätzlich Artikel, Orte, Buchungen, Bestellungen bearbeiten).
//  Standard = Kein → anfangs nur Admin.
//  Daten: crm/shopItems, crm/shopPlaces, crm/shopOrders, crm/shopLog (CRM-Ref, dort dürfen
//  allowlistete Nutzer schreiben). Mitteilungen über die gemeinsame Leiste (renderZeNotices).
// ═════════════════════════════════════════════════════════════════
//  Ausleihe (Leihmaterial = nicht verbraucht: Werkzeug, Beachflags, Aufsteller …):
//  crm/shopLoans/<id> = { itemId, itemName, qty, fromPlace, borrowerId|null, borrowerName,
//  due, anlass, note, ts, byId, byName, orderId, status:'aktiv'|'zurueck', returns:[…],
//  ackBorrower }. Während der Ausleihe ist die Menge an KEINEM Ort, sondern „verliehen";
//  der Gesamtbestand (total) zählt sie mit.
// Namespace-Import statt benannter Importe: Liefert ein Gerät nach einem Update kurz noch die
// ALTE crm-data.js aus dem Cache (ohne Shop-Funktionen), würde ein benannter Import die GANZE
// App beim Start abbrechen („does not provide an export named …"). So fehlt höchstens kurz der Shop.
import * as CD from './crm-data.js';
import * as U from '../utils.js';
import * as D from '../data.js';      // NUR Lesen (Personenliste fürs Verleihen)
import * as CC from './crm-config.js'; // NUR Lesen (CRM-Bereiche fürs Verleihen an Vereine)
const listShop =(c)=>CD.listShop?CD.listShop(c):[];
const getShop  =(c,id)=>CD.getShop?CD.getShop(c,id):null;
const saveShop =(c,r)=>CD.saveShop?CD.saveShop(c,r):_stale();
const deleteShop=(c,id)=>CD.deleteShop?CD.deleteShop(c,id):_stale();
const newId    =()=>CD.newId();
const openModal=(h,w)=>U.openModal(h,w), closeModal=()=>U.closeModal(), toast=(m,t)=>U.toast(m,t);
const getData  =()=>D.getData();
function _stale(){ try{ U.toast('Shop wird gerade aktualisiert – bitte die App neu laden.','err'); }catch(e){} return Promise.resolve(); }

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const jsq = s => esc(JSON.stringify(String(s==null?'':s)));   // JS-Argument in Inline-Handlern

const CATS_DEFAULT=['Flaggen','Flyer','Branding','Visitenkarten','Bootsmaterial','Werkzeug','Sonstiges'];
const PLACE_TYPES={ buero:{i:'🏢',l:'Büro'}, bus:{i:'🚐',l:'Bus / Fahrzeug'}, boot:{i:'⛵',l:'Boot'}, lager:{i:'📦',l:'Lager'}, sonst:{i:'📍',l:'Sonstiges'} };
const STATUS={
  offen:     {l:'Offen',          c:'#d97706'},
  inarbeit:  {l:'In Bearbeitung', c:'#2563eb'},
  ausgegeben:{l:'Ausgegeben',     c:'#16a34a'},
  erledigt:  {l:'Erledigt',       c:'#16a34a'},
  abgelehnt: {l:'Abgelehnt',      c:'#c0392b'},
};
const LOG_T={ zugang:'➕ Zugang', abgang:'➖ Abgang', korrektur:'✎ Korrektur', umlagern:'⇄ Umlagern', ausgabe:'📦 Ausgabe', verleih:'🔁 Verliehen', rueckgabe:'↩ Rückgabe', versand:'📤 Verschickt' };

let TAB='bestand', fCat='', fPlace='', fQ='', fOrd='aktiv', fLogItem='', fLoan='aktiv';

// ── Rechte ─────────────────────────────────────────────────────────
function _acc(){
  const cu=window.cu; if(!cu) return 'kein';
  if(cu.role==='admin') return 'verwaltend';
  let ma={}; try{ ma=(window.crmModuleAccess&&window.crmModuleAccess(cu))||{}; }catch(e){}
  return ma.shop||'kein';
}
const canManage=()=>_acc()==='verwaltend';
const canUse=()=>_acc()!=='kein';
const _me=()=>window.cu||{};

// ── Daten-Helfer ───────────────────────────────────────────────────
const _num=v=>{ const n=parseFloat(String(v==null?'':v).replace(',','.')); return isFinite(n)?n:0; };
function places(){ return listShop('shopPlaces').sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'})); }
function items(){ return listShop('shopItems').sort((a,b)=>String(a.kategorie||'').localeCompare(String(b.kategorie||''),'de')||String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'})); }
function orders(){ return listShop('shopOrders').sort((a,b)=>(b.ts||0)-(a.ts||0)); }
function placeOf(id){ return getShop('shopPlaces',id); }
function placeLabel(id){ const p=placeOf(id); if(!p) return id?'(Ort gelöscht)':'–'; return (PLACE_TYPES[p.typ]||PLACE_TYPES.sonst).i+' '+p.name; }
function inPlaces(it){ return Object.values((it&&it.stock)||{}).reduce((s,v)=>s+_num(v),0); }
function loans(){ return listShop('shopLoans').sort((a,b)=>(b.ts||0)-(a.ts||0)); }
function activeLoans(itemId){ return loans().filter(l=>l.status==='aktiv' && (!itemId || l.itemId===itemId)); }
function lent(it){ return it ? activeLoans(it.id).reduce((s,l)=>s+_num(l.qty),0) : 0; }
// Gesamtbestand = an Orten + gerade verliehen (Leihmaterial gehört weiter zum Bestand)
function total(it){ return inPlaces(it)+lent(it); }
const _overdue=l=>l.status==='aktiv' && l.due && l.due<_todayIso();   // ohne due = Dauerleihe → nie überfällig
// ── Ausleihende: Mitarbeiter (borrowerId) · CRM-Eintrag/Verein (borrowerRef {tree,eid}) · freier Name
function _crmEntities(){
  const out=[];
  try{ (CC.getTrees?CC.getTrees():[]).forEach(tr=>{ (CD.listEntities?CD.listEntities(tr.key):[]).forEach(e=>{
    out.push({tree:tr.key, treeLabel:tr.label||tr.key, icon:tr.icon||'🏛️', eid:e.id, name:(e.stamm&&e.stamm.name)||'(ohne Name)'}); }); }); }catch(e){}
  return out;
}
function bType(l){ return l.borrowerRef&&l.borrowerRef.eid ? 'crm' : (l.borrowerId ? 'user' : 'frei'); }
// borrowerRef {tree,eid,kid?}: kid = Kontakt/Mitglied innerhalb des Vereins/Verbands
function bKey(l){ const t=bType(l); return t==='crm' ? 'c:'+l.borrowerRef.tree+'/'+l.borrowerRef.eid+(l.borrowerRef.kid?'/'+l.borrowerRef.kid:'') : t==='user' ? 'u:'+l.borrowerId : 'f:'+String(l.borrowerName||'').trim().toLowerCase(); }
function _crmContact(ref){ try{ const e=CD.getEntity&&CD.getEntity(ref.tree,ref.eid); return {e, k:(e&&ref.kid)?(e.kontakte||[]).find(x=>x.id===ref.kid)||null:null}; }catch(err){ return {e:null,k:null}; } }
function bName(l){   // CRM-Name live (Umbenennung im CRM zieht nach); mit Kontakt: „Max Muster (TSV Kronshagen)"
  if(bType(l)==='crm'){ const {e,k}=_crmContact(l.borrowerRef); const en=(e&&e.stamm&&e.stamm.name)||'';
    if(k&&k.name) return k.name+(en?' ('+en+')':''); if(en&&!l.borrowerRef.kid) return en; }
  return l.borrowerName||'?';
}
function bIcon(l){ return bType(l)==='crm'&&l.borrowerRef.kid ? '👤' : ({crm:'🏛️',user:'👤',frei:'✏️'})[bType(l)]; }
// Kontakte eines CRM-Eintrags als <option>s (für das „An Person"-Feld)
function _contactOpts(tree,eid){
  const {e}=_crmContact({tree,eid}); const ks=(e&&e.kontakte)||[];
  return '<option value="">– an den Verein / Partner selbst –</option>'+ks.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'}))
    .map(k=>`<option value="${esc(k.id)}">${esc(k.name||'(ohne Name)')}${k.funktion?' ('+esc(k.funktion)+')':''}${k.adresse?' · 📮':''}</option>`).join('');
}
// Adresse für einen CRM-Empfänger: eigene Kontakt-Adresse, sonst die des Vereins
function _crmAddress(ref){ const {e,k}=_crmContact(ref); return String((k&&k.adresse)||(e&&e.stamm&&e.stamm.adresse)||'').trim(); }
function bLabel(l){ return bIcon(l)+' '+bName(l); }
function people(){
  try{ return (getData().users||[]).filter(u=>u&&u.id&&u.id!=='admin'&&!u.archived)
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'de',{sensitivity:'base'})); }catch(e){ return []; }
}
// ── Mitarbeiter-Adressen = CRM-Kontakte der EIGENEN Organisation (z. B. „TURNING POINT Stiftung") ──
// Eine einzige Quelle (User-Vorgabe „nicht doppelt und dreifach"): Profil, Verwaltung und Shop lesen/
// schreiben die Adresse des CRM-Kontakts. Zuordnung Mitarbeiter ↔ Kontakt per E-Mail, sonst per Name.
// Welche CRM-Organisation „die eigene" ist: crm/shopConfig/org = {tree,eid}; ohne Einstellung automatisch
// der Eintrag mit „Turning Point" im Namen.
function shopOrg(){
  const c=getShop('shopConfig','org');
  if(c&&c.tree&&c.eid&&CD.getEntity&&CD.getEntity(c.tree,c.eid)) return {tree:c.tree, eid:c.eid, auto:false};
  const hit=_crmEntities().find(x=>/turning\s*-?\s*point/i.test(x.name));
  return hit ? {tree:hit.tree, eid:hit.eid, auto:true} : null;
}
function _orgEntity(){ const o=shopOrg(); return o&&CD.getEntity ? CD.getEntity(o.tree,o.eid) : null; }
const _lc=s=>String(s||'').trim().toLowerCase();
function _kMails(k){ return (Array.isArray(k&&k.emails)?k.emails:(k&&k.email?[k.email]:[])).map(_lc).filter(Boolean); }
// CRM-Kontakt eines Mitarbeiters in der eigenen Organisation (oder null)
function staffContact(uid){
  const e=_orgEntity(); if(!e) return null;
  const u=people().find(x=>x.id===uid)||((window.cu&&window.cu.id===uid)?window.cu:null); if(!u) return null;
  const ks=e.kontakte||[]; const mail=_lc(u.email);
  return (mail && ks.find(k=>_kMails(k).includes(mail))) || ks.find(k=>_lc(k.name)===_lc(u.name)) || null;
}
function userAddress(uid){ const k=staffContact(uid); return String((k&&k.adresse)||'').trim(); }
function personByName(n){ const s=_lc(n); return s ? people().find(u=>_lc(u.name)===s)||null : null; }
function _peopleDatalist(id){ return `<datalist id="${id}">${people().map(u=>`<option value="${esc(u.name)}">`).join('')}</datalist>`; }
// Für Profil/Verwaltung (ZE-Seite) – nur über window, damit die Zeiterfassung nie hart vom CRM abhängt.
// → { adresse, orgName, ok } · ok=false: keine eigene Organisation im CRM gefunden
function shopGetAddr(uid){
  const e=_orgEntity(); if(!e) return { adresse:'', orgName:'', ok:false };
  return { adresse:userAddress(uid), orgName:(e.stamm&&e.stamm.name)||'', ok:true };
}
// Adresse am CRM-Kontakt speichern; fehlt der Kontakt, wird er in der eigenen Organisation angelegt
function shopSaveAddr(uid, adresse){
  const o=shopOrg(); const e=_orgEntity(); if(!o||!e||!uid) return Promise.resolve(false);
  const val=String(adresse||'').trim();
  const u=people().find(x=>x.id===uid)||((window.cu&&window.cu.id===uid)?window.cu:null); if(!u) return Promise.resolve(false);
  const ent=JSON.parse(JSON.stringify(e)); if(!Array.isArray(ent.kontakte)) ent.kontakte=[];
  const mail=_lc(u.email);
  let k=(mail && ent.kontakte.find(x=>_kMails(x).includes(mail))) || ent.kontakte.find(x=>_lc(x.name)===_lc(u.name));
  if(k){ if(String(k.adresse||'').trim()===val) return Promise.resolve(true); k.adresse=val; }   // unverändert → kein Write
  else { if(!val) return Promise.resolve(true);
    ent.kontakte.push({ id:newId(), name:u.name||uid, funktion:'', emails:u.email?[u.email]:[], tels:[], adresse:val, note:'automatisch angelegt (Mitarbeiter-Adresse)' }); }
  return Promise.resolve(CD.saveEntity ? CD.saveEntity(o.tree, ent) : null).then(()=>true);
}
// Verwalter: eigene Organisation im CRM festlegen
function shopSetOrg(v){
  if(!canManage()) return;
  if(!v){ deleteShop('shopConfig','org'); toast('Automatische Erkennung aktiv.','ok'); renderShop(); return; }
  const [tree,eid]=v.split('::'); saveShop('shopConfig',{id:'org',tree,eid}); toast('Eigene Organisation gespeichert ✓','ok'); renderShop();
}
function itemLabel(it){ return it ? (it.name+(it.variante?' · '+it.variante:'')) : ''; }
function cats(){ const s=new Set(CATS_DEFAULT); items().forEach(i=>{ if(i.kategorie) s.add(i.kategorie); }); return [...s]; }
const _fmtDate=iso=>{ if(!iso) return ''; const p=String(iso).split('-'); return p.length===3?(+p[2]+'.'+ +p[1]+'.'+p[0]):iso; };
const _fmtTs=ts=>{ if(!ts) return ''; const d=new Date(ts); return d.toLocaleDateString('de-DE')+' '+d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); };
const _todayIso=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

function _log(it, type, qty, from, to, note, orderId){
  const cu=_me();
  return saveShop('shopLog',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'',
    itemId:it.id, itemName:itemLabel(it), type, qty, from:from||null, to:to||null, note:note||'', orderId:orderId||null });
}
// Bestand an einem Ort ändern (delta ±). Liefert false, wenn es unter 0 ginge.
function _applyDelta(it, placeId, delta){
  if(!it.stock || typeof it.stock!=='object') it.stock={};
  const cur=_num(it.stock[placeId]); const nv=cur+delta;
  if(nv<0) return false;
  if(nv===0) delete it.stock[placeId]; else it.stock[placeId]=nv;
  return true;
}

// ── Stile ──────────────────────────────────────────────────────────
let _css=false;
function _styles(){
  if(_css) return; _css=true;
  const st=document.createElement('style');
  st.textContent=`
  .shop-wrap{padding:16px 22px;width:100%;box-sizing:border-box}
  .shop-h{font-size:20px;font-weight:700;color:var(--primary);margin:0 0 4px}
  .shop-sub{font-size:13px;color:var(--muted);margin:0 0 12px}
  .shop-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;border-bottom:2px solid var(--border)}
  .shop-tabs button{border:none;background:none;padding:8px 14px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
  .shop-tabs button.on{color:var(--primary);border-bottom-color:var(--primary)}
  .shop-badge{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:#d97706;color:#fff;font-size:11px;line-height:18px;text-align:center;margin-left:4px}
  .shop-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  .shop-bar input,.shop-bar select{padding:6px 8px;font-size:13px;border:1.5px solid var(--border);border-radius:6px;background:var(--card,#fff);color:var(--text)}
  .shop-bar input[type=search]{flex:1;min-width:160px}
  .shop-sp{flex:1}
  .shop-btn{padding:6px 12px;font-size:13px;border-radius:6px;border:1.5px solid var(--border);background:var(--card,#fff);color:var(--text);cursor:pointer;font-weight:600;white-space:nowrap}
  .shop-btn.pri{background:var(--primary);border-color:var(--primary);color:#fff}
  .shop-btn.ok{background:#16a34a;border-color:#16a34a;color:#fff}
  .shop-btn.warn{border-color:#c0392b;color:#c0392b}
  .shop-btn.sm{padding:3px 8px;font-size:12px}
  .shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
  .shop-card{background:var(--card,#fff);border:1.5px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
  .shop-card.low{border-color:#e5484d}
  .shop-img{height:130px;background:#f1f4f8 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:42px;color:#b6c0cc}
  .shop-cb{padding:10px 12px;display:flex;flex-direction:column;gap:5px;flex:1}
  .shop-name{font-weight:700;font-size:15px;color:var(--text)}
  .shop-var{font-size:12px;color:var(--muted)}
  .shop-cat{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;background:#eef2f7;color:#4a5a6e;align-self:flex-start}
  .shop-tot{font-size:22px;font-weight:700;color:var(--primary)}
  .shop-tot small{font-size:12px;font-weight:600;color:var(--muted)}
  .shop-low{font-size:12px;font-weight:700;color:#e5484d}
  .shop-pl{display:flex;flex-wrap:wrap;gap:4px}
  .shop-pl span{font-size:12px;padding:2px 7px;border-radius:6px;background:#f1f4f8;color:#2c3e50}
  .shop-pl span.hl{background:#dbe6fb;font-weight:700}
  .shop-pl span.lent{background:#eef2ff;color:#1e40af}
  .shop-pl span.lent.late{background:#fdecea;color:#c0392b;font-weight:700}
  .shop-act{display:flex;gap:5px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
  .shop-empty{color:var(--muted);font-size:14px;padding:24px 0;text-align:center}
  .shop-list{display:flex;flex-direction:column;gap:8px}
  .shop-row{background:var(--card,#fff);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .shop-row .main{flex:1;min-width:220px}
  .shop-row .t{font-weight:700;font-size:14px;color:var(--text)}
  .shop-row .m{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.5}
  .shop-st{display:inline-block;font-size:11px;font-weight:700;color:#fff;padding:2px 8px;border-radius:9px}
  .shop-late{color:#c0392b;font-weight:700}
  .shop-seg{display:inline-flex;border:1.5px solid var(--border);border-radius:7px;overflow:hidden}
  .shop-seg button{border:none;background:var(--card,#fff);padding:5px 11px;font-size:12px;cursor:pointer;color:var(--text)}
  .shop-seg button.on{background:var(--primary);color:#fff}
  .shop-f{margin-bottom:10px}
  .shop-f label{display:block;font-size:12px;font-weight:600;margin-bottom:3px}
  .shop-f input,.shop-f select,.shop-f textarea{width:100%;box-sizing:border-box;padding:6px 8px;font-size:14px;border:1.5px solid var(--border);border-radius:6px}
  .shop-f2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .shop-ph{width:110px;height:110px;border-radius:8px;border:1.5px dashed var(--border);background:#f6f8fa center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;text-align:center}
  .shop-log td,.shop-log th{padding:5px 8px;font-size:12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
  .shop-log{width:100%;border-collapse:collapse;background:var(--card,#fff)}
  @media(max-width:640px){ .shop-wrap{padding:12px} .shop-f2{grid-template-columns:1fr} .shop-grid{grid-template-columns:1fr} }
  `;
  document.head.appendChild(st);
}

// ── Haupt-Render ───────────────────────────────────────────────────
export function renderShop(){
  try{
    _styles();
    const root=document.getElementById('shop-root'); if(!root) return;
    if(!canUse()){ root.innerHTML='<div class="shop-wrap"><div class="shop-empty">Für den Shop bist du noch nicht freigeschaltet.</div></div>'; return; }
    const mgr=canManage(); const me=_me();
    if(!mgr && (TAB==='orte'||TAB==='verlauf')) TAB='bestand';
    const os=orders();
    const nOpen = mgr ? os.filter(o=>o.status==='offen').length : os.filter(o=>o.byId===me.id && (o.status==='offen'||o.status==='inarbeit')).length;
    const myLoans=activeLoans().filter(l=>mgr||l.borrowerId===me.id);
    const nLate=myLoans.filter(_overdue).length;
    const tabs=[['bestand','📦 Bestand'],['bestellungen','🛒 Bestellungen'+(nOpen?`<span class="shop-badge">${nOpen}</span>`:'')],
      ['ausleihen','🔁 Ausleihen'+(myLoans.length?`<span class="shop-badge" style="background:${nLate?'#c0392b':'#2563eb'}">${myLoans.length}</span>`:'')]]
      .concat(mgr?[['orte','📍 Orte'],['verlauf','📜 Verlauf']]:[]);
    let body='';
    if(TAB==='bestand') body=_bestandHtml(mgr);
    else if(TAB==='bestellungen') body=_ordersHtml(mgr);
    else if(TAB==='ausleihen') body=_loansHtml(mgr);
    else if(TAB==='orte') body=_orteHtml();
    else body=_verlaufHtml();
    root.innerHTML=`<div class="shop-wrap">
      <div class="shop-h">🛒 Shop</div>
      <p class="shop-sub">Was liegt wo – und was wird gebraucht? ${mgr?'Du verwaltest den Shop.':'Bestelle hier Material, Werbemittel und Werkzeug.'}</p>
      <div class="shop-tabs">${tabs.map(t=>`<button class="${TAB===t[0]?'on':''}" onclick="shopTab(${jsq(t[0])})">${t[1]}</button>`).join('')}</div>
      ${body}
    </div>`;
  }catch(e){ console.error('renderShop Fehler:',e); }
}
function shopTab(t){ TAB=t; renderShop(); }

// ── Tab: Bestand ───────────────────────────────────────────────────
function _bestandHtml(mgr){
  const pls=places();
  const catOpts=['<option value="">Alle Kategorien</option>'].concat(cats().map(c=>`<option${fCat===c?' selected':''}>${esc(c)}</option>`)).join('');
  const bws=_borrowers();
  const plOpts=['<option value="">Alle Orte</option>'].concat(pls.map(p=>`<option value="${esc(p.id)}"${fPlace===p.id?' selected':''}>${esc(placeLabel(p.id))}</option>`)).join('')
    +(bws.length?`<optgroup label="🔁 Ausgeliehen an">${bws.map(b=>`<option value="${esc('loan:'+b.key)}"${fPlace==='loan:'+b.key?' selected':''}>${esc(b.label)}</option>`).join('')}</optgroup>`:'');
  const hint = (mgr && !pls.length) ? `<div class="shop-empty" style="text-align:left;padding:8px 0">👉 Lege zuerst unter <b>📍 Orte</b> an, wo Sachen liegen (Büro, Bus, Boot 1 …).</div>` : '';
  return `${hint}<div class="shop-bar">
      <input type="search" id="shop-q" placeholder="Suchen …" value="${esc(fQ)}" oninput="shopSetQ(this.value)">
      <select onchange="shopSetCat(this.value)">${catOpts}</select>
      <select onchange="shopSetPlace(this.value)">${plOpts}</select>
      <span class="shop-sp"></span>
      ${mgr?`<button class="shop-btn pri" onclick="shopItemEdit('')">＋ Artikel</button>`:''}
    </div>
    <div id="shop-items">${_itemsGrid(mgr)}</div>`;
}
function _itemsGrid(mgr){
  const q=fQ.trim().toLowerCase();
  const list=items().filter(it=>{
    if(fCat && it.kategorie!==fCat) return false;
    if(fPlace.startsWith('loan:')){ if(!activeLoans(it.id).some(l=>'loan:'+bKey(l)===fPlace)) return false; }
    else if(fPlace && !_num((it.stock||{})[fPlace])) return false;
    if(q && !(`${it.name} ${it.variante||''} ${it.kategorie||''} ${it.note||''}`.toLowerCase().includes(q))) return false;
    return true;
  });
  if(!list.length) return `<div class="shop-empty">${items().length?'Keine Artikel für diesen Filter.':(mgr?'Noch keine Artikel. Lege den ersten mit „＋ Artikel" an.':'Noch keine Artikel im Shop.')}</div>`;
  return `<div class="shop-grid">${list.map(it=>{
    const tot=total(it); const low=_num(it.min)>0 && tot<_num(it.min);
    const pl=Object.keys(it.stock||{}).filter(pid=>_num(it.stock[pid])>0)
      .sort((a,b)=>placeLabel(a).localeCompare(placeLabel(b),'de'))
      .map(pid=>`<span class="${fPlace===pid?'hl':''}">${esc(placeLabel(pid))}: <b>${_num(it.stock[pid])}</b></span>`).join('');
    const img=it.foto?`<div class="shop-img" style="background-image:url('${it.foto}')"></div>`:`<div class="shop-img">${_catIcon(it.kategorie)}</div>`;
    const ln=activeLoans(it.id);
    const lnHtml=ln.map(l=>`<span class="lent${_overdue(l)?' late':''}${fPlace==='loan:'+bKey(l)?' hl':''}" title="${esc(l.anlass||'')}">${esc(bLabel(l))}: <b>${_num(l.qty)}</b>${l.due?' bis '+_fmtDate(l.due):' (dauerhaft)'}</span>`).join('');
    const avail=inPlaces(it);
    return `<div class="shop-card${low?' low':''}">${img}<div class="shop-cb">
      <div style="display:flex;gap:4px;flex-wrap:wrap">${it.kategorie?`<span class="shop-cat">${esc(it.kategorie)}</span>`:''}${it.leihbar?'<span class="shop-cat" style="background:#dbe6fb;color:#1e40af">🔁 Leihmaterial</span>':''}</div>
      <div class="shop-name">${esc(it.name)}</div>
      ${it.variante?`<div class="shop-var">${esc(it.variante)}</div>`:''}
      <div class="shop-tot">${tot} <small>${esc(it.einheit||'Stück')} gesamt${ln.length?` · ${avail} verfügbar`:''}</small></div>
      ${low?`<div class="shop-low">⚠ Unter Mindestbestand (${_num(it.min)}) – nachbestellen</div>`:''}
      <div class="shop-pl">${pl||(ln.length?'':'<span style="color:var(--muted)">kein Bestand</span>')}${lnHtml}</div>
      ${it.note?`<div class="shop-var">${esc(it.note)}</div>`:''}
      ${mgr?`<div class="shop-act">
        <button class="shop-btn sm" onclick="shopBook(${jsq(it.id)})">± Buchen</button>
        <button class="shop-btn sm" onclick="shopMove(${jsq(it.id)})">⇄ Umlagern</button>
        <button class="shop-btn sm" onclick="shopItemEdit(${jsq(it.id)})">✎</button>
      </div>`:''}</div></div>`;
  }).join('')}</div>`;
}
function _catIcon(c){ return ({'Flaggen':'🚩','Flyer':'📄','Branding':'🎨','Visitenkarten':'🪪','Bootsmaterial':'⛵','Werkzeug':'🛠️'})[c]||'📦'; }
function shopSetQ(v){ fQ=v; const g=document.getElementById('shop-items'); if(g) g.innerHTML=_itemsGrid(canManage()); }
function shopSetCat(v){ fCat=v; renderShop(); }
function shopSetPlace(v){ fPlace=v; renderShop(); }

// ── Artikel anlegen / bearbeiten ───────────────────────────────────
function shopItemEdit(id){
  if(!canManage()) return;
  const it=id?getShop('shopItems',id):null;
  const v=it||{name:'',kategorie:'',variante:'',einheit:'Stück',min:'',note:'',foto:''};
  window._shopPhoto=v.foto||'';
  const pls=places();
  const initStock = it ? '' : (pls.length ? `<div class="shop-f"><label>Anfangsbestand je Ort</label>
      <div class="shop-f2">${pls.map(p=>`<div><span style="font-size:12px">${esc(placeLabel(p.id))}</span><input type="number" min="0" step="1" class="shop-init" data-pl="${esc(p.id)}" placeholder="0"></div>`).join('')}</div></div>`
      : `<div class="shop-f" style="font-size:12px;color:var(--muted)">Tipp: Lege unter „📍 Orte" Orte an, dann kannst du hier gleich den Bestand eintragen.</div>`);
  openModal(`<h3>${it?'✎ Artikel bearbeiten':'＋ Neuer Artikel'}</h3>
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div><div id="shop-ph" class="shop-ph" style="${v.foto?`background-image:url('${v.foto}')`:''}">${v.foto?'':'kein Foto'}</div>
        <label class="shop-btn sm" style="display:inline-block;margin-top:6px;cursor:pointer">📷 Foto<input type="file" accept="image/*" style="display:none" onchange="shopPhotoPick(this)"></label>
        <button type="button" class="shop-btn sm" style="margin-top:6px" onclick="shopPhotoClear()">✕</button></div>
      <div style="flex:1;min-width:220px">
        <div class="shop-f"><label>Name *</label><input id="si-name" value="${esc(v.name)}" placeholder="z. B. Beachflag"></div>
        <div class="shop-f2">
          <div class="shop-f"><label>Kategorie</label><input id="si-cat" list="si-cats" value="${esc(v.kategorie)}" placeholder="z. B. Flaggen"><datalist id="si-cats">${cats().map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="shop-f"><label>Größe / Variante</label><input id="si-var" value="${esc(v.variante)}" placeholder="z. B. 2 × 5 m"></div>
        </div>
      </div>
    </div>
    <div class="shop-f2">
      <div class="shop-f"><label>Einheit</label><input id="si-unit" value="${esc(v.einheit||'Stück')}" placeholder="Stück, Packung, Rolle …"></div>
      <div class="shop-f"><label>Mindestbestand <span style="font-weight:400;color:var(--muted)">(Warnung darunter)</span></label><input id="si-min" type="number" min="0" step="1" value="${esc(v.min)}"></div>
    </div>
    <div class="shop-f"><label>Notiz</label><input id="si-note" value="${esc(v.note)}" placeholder="z. B. Druckerei, Bestellnummer, Hinweise"></div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:0 0 10px;cursor:pointer"><input type="checkbox" id="si-leih" ${v.leihbar?'checked':''} style="width:auto;margin-top:2px">
      <span><b>🔁 Leihmaterial</b> – wird nicht verbraucht, sondern ausgeliehen und zurückgegeben (Werkzeug, Beachflags, Aufsteller …)</span></label>
    ${initStock}
    <div class="modal-btns">
      ${it?`<button class="btn btn-outline" style="margin-right:auto;color:var(--danger);border-color:var(--danger)" onclick="shopItemDelete(${jsq(it.id)})">🗑 Löschen</button>`:''}
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="shopItemSave(${jsq(id||'')})">Speichern</button></div>`);
}
// Foto verkleinern (max. 480 px, JPEG) → klein genug für die Datenbank
function shopPhotoPick(inp){
  const f=inp&&inp.files&&inp.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{ const img=new Image(); img.onload=()=>{
      const max=480, sc=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas'); c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      window._shopPhoto=c.toDataURL('image/jpeg',0.72);
      const ph=document.getElementById('shop-ph'); if(ph){ ph.style.backgroundImage=`url('${window._shopPhoto}')`; ph.textContent=''; }
    }; img.onerror=()=>toast('Bild konnte nicht gelesen werden.','err'); img.src=rd.result; };
  rd.readAsDataURL(f);
}
function shopPhotoClear(){ window._shopPhoto=''; const ph=document.getElementById('shop-ph'); if(ph){ ph.style.backgroundImage=''; ph.textContent='kein Foto'; } }
function _val(id){ const el=document.getElementById(id); return el?String(el.value||'').trim():''; }
function shopItemSave(id){
  const name=_val('si-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const ex=id?getShop('shopItems',id):null; const cu=_me();
  const it=Object.assign({}, ex||{ id:newId(), stock:{}, createdAt:Date.now(), createdById:cu.id||'', createdByName:cu.name||'' }, {
    name, kategorie:_val('si-cat'), variante:_val('si-var'), einheit:_val('si-unit')||'Stück',
    min:_val('si-min')===''?'':_num(_val('si-min')), note:_val('si-note'), foto:window._shopPhoto||'',
    leihbar:!!(document.getElementById('si-leih')||{}).checked });
  const inits=[];
  if(!ex) document.querySelectorAll('.shop-init').forEach(inp=>{ const q=Math.round(_num(inp.value)); if(q>0){ _applyDelta(it, inp.dataset.pl, q); inits.push([inp.dataset.pl,q]); } });
  saveShop('shopItems', it);
  inits.forEach(([pl,q])=>_log(it,'zugang',q,null,pl,'Anfangsbestand'));
  closeModal(); toast(ex?'Artikel gespeichert ✓':'Artikel angelegt ✓','ok'); renderShop();
}
function shopItemDelete(id){
  const it=getShop('shopItems',id); if(!it) return;
  const tot=total(it);
  if(activeLoans(id).length){ toast('Dieser Artikel ist noch verliehen – erst zurückgeben lassen.','err'); return; }
  if(!confirm(`Artikel „${itemLabel(it)}" löschen?`+(tot?`\n\nAchtung: Es sind noch ${tot} ${it.einheit||'Stück'} im Bestand.`:''))) return;
  deleteShop('shopItems', id); closeModal(); toast('Artikel gelöscht.','ok'); renderShop();
}

// ── Buchen (Zugang / Abgang / Korrektur) ───────────────────────────
function _placeSelect(id, sel, withQty, it){
  return `<select id="${id}">${places().map(p=>`<option value="${esc(p.id)}"${sel===p.id?' selected':''}>${esc(placeLabel(p.id))}${withQty&&it?` (${_num((it.stock||{})[p.id])})`:''}</option>`).join('')}</select>`;
}
function shopBook(id){
  if(!canManage()) return;
  const it=getShop('shopItems',id); if(!it) return;
  if(!places().length){ toast('Bitte zuerst unter „📍 Orte" einen Ort anlegen.','err'); return; }
  openModal(`<h3>± Bestand buchen</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b> · gesamt ${total(it)} ${esc(it.einheit||'Stück')}</p>
    <div class="shop-f"><label>Art</label><select id="sb-type">
      <option value="zugang">➕ Zugang (geliefert, gedruckt, gekauft)</option>
      <option value="abgang">➖ Abgang (verbraucht, verteilt, kaputt)</option>
      <option value="korrektur">✎ Korrektur (gezählt – Bestand genau setzen)</option></select></div>
    <div class="shop-f2"><div class="shop-f"><label>Ort</label>${_placeSelect('sb-pl', fPlace, true, it)}</div>
      <div class="shop-f"><label>Menge</label><input id="sb-qty" type="number" min="0" step="1" placeholder="0"></div></div>
    <div class="shop-f"><label>Notiz</label><input id="sb-note" placeholder="z. B. Lieferung Druckerei, Messe Kiel"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopBookSave(${jsq(id)})">Buchen</button></div>`);
}
function shopBookSave(id){
  const it=getShop('shopItems',id); if(!it) return;
  const type=_val('sb-type'), pl=_val('sb-pl'), note=_val('sb-note');
  const qRaw=_val('sb-qty'); if(qRaw===''){ toast('Bitte eine Menge eingeben.','err'); return; }
  const q=Math.round(_num(qRaw)); if(q<0){ toast('Menge darf nicht negativ sein.','err'); return; }
  const cur=_num((it.stock||{})[pl]);
  let delta = type==='zugang' ? q : type==='abgang' ? -q : (q-cur);
  if(type!=='korrektur' && q===0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, pl, delta)){ toast(`Am Ort sind nur ${cur} vorhanden.`,'err'); return; }
  saveShop('shopItems', it);
  if(type==='korrektur') _log(it,'korrektur',delta,pl,pl,(note?note+' · ':'')+`${cur} → ${q}`);
  else _log(it,type,q,type==='abgang'?pl:null,type==='zugang'?pl:null,note);
  closeModal(); toast('Gebucht ✓','ok'); renderShop();
}

// ── Umlagern ───────────────────────────────────────────────────────
function shopMove(id){
  if(!canManage()) return;
  const it=getShop('shopItems',id); if(!it) return;
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0);
  if(!from.length){ toast('Kein Bestand zum Umlagern.','err'); return; }
  if(places().length<2){ toast('Zum Umlagern braucht es mindestens zwei Orte.','err'); return; }
  openModal(`<h3>⇄ Umlagern</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b></p>
    <div class="shop-f2"><div class="shop-f"><label>Von</label><select id="sm-from">${from.map(p=>`<option value="${esc(p)}"${fPlace===p?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Nach</label>${_placeSelect('sm-to','',true,it)}</div></div>
    <div class="shop-f2"><div class="shop-f"><label>Menge</label><input id="sm-qty" type="number" min="1" step="1" value="1"></div>
      <div class="shop-f"><label>Notiz</label><input id="sm-note" placeholder="z. B. für Regatta am Wochenende"></div></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopMoveSave(${jsq(id)})">Umlagern</button></div>`);
}
function shopMoveSave(id){
  const it=getShop('shopItems',id); if(!it) return;
  const from=_val('sm-from'), to=_val('sm-to'), q=Math.round(_num(_val('sm-qty'))), note=_val('sm-note');
  if(from===to){ toast('Von und Nach sind gleich.','err'); return; }
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, from, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[from])} vorhanden.`,'err'); return; }
  _applyDelta(it, to, q);
  saveShop('shopItems', it); _log(it,'umlagern',q,from,to,note);
  closeModal(); toast(`${q} umgelagert: ${placeLabel(from)} → ${placeLabel(to)} ✓`,'ok'); renderShop();
}

// ── Bestellen ──────────────────────────────────────────────────────
function shopOrderNew(itemId){
  if(!canUse()) return;
  const its=items(); const pls=places();
  const itOpts=['<option value="">– Freier Wunsch (nicht im Katalog) –</option>']
    .concat(its.map(i=>`<option value="${esc(i.id)}"${i.id===itemId?' selected':''}>${esc(itemLabel(i))}${i.kategorie?' – '+esc(i.kategorie):''}</option>`)).join('');
  const plOpts=pls.map(p=>`<option value="${esc(p.id)}">${esc(placeLabel(p.id))}</option>`).join('');
  const ents=_crmEntities(); const byTree={};
  ents.forEach(x=>{ (byTree[x.tree]=byTree[x.tree]||{label:x.treeLabel,icon:x.icon,list:[]}).list.push(x); });
  const vOpts='<option value="">– bitte wählen –</option>'+Object.keys(byTree).map(k=>{ const g=byTree[k];
    return `<optgroup label="${esc(g.icon+' '+g.label)}">${g.list.sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'})).map(x=>`<option value="${esc(x.tree)}::${esc(x.eid)}">${esc(x.name)}</option>`).join('')}</optgroup>`; }).join('');
  openModal(`<h3>🛒 Bestellen / Bedarf melden</h3>
    <div class="shop-f"><label>Was?</label><select id="so-item" onchange="shopOrderItemChg()">${itOpts}</select></div>
    <div class="shop-f" id="so-free-w" style="display:${itemId?'none':''}"><label>Was wird gebraucht? *</label><textarea id="so-free" rows="2" placeholder="z. B. 200 Visitenkarten für mich, Roll-up „Wassersport", 2 Schäkel M10"></textarea></div>
    <div class="shop-f2"><div class="shop-f"><label>Menge *</label><input id="so-qty" type="number" min="1" step="1" value="1"></div>
      <div class="shop-f"><label id="so-date-l">${(itemId&&(getShop('shopItems',itemId)||{}).leihbar)?'Gebraucht ab':'Bis wann?'}</label><input id="so-date" type="date" min="${_todayIso()}"></div></div>
    <div class="shop-f" id="so-ret-w" style="display:${(itemId&&(getShop('shopItems',itemId)||{}).leihbar)?'':'none'}"><label>🔁 Rückgabe bis *</label><input id="so-ret" type="date" min="${_todayIso()}"></div>
    <div class="shop-f"><label>Wofür / Anlass</label><input id="so-anlass" placeholder="z. B. Messe Kiel, Regatta, Schulbesuch"></div>
    <div class="shop-f"><label>Wohin / für wen? *</label><select id="so-ziel" onchange="shopOrderZielChg()">
      <option value="">– bitte wählen –</option>
      <option value="home">🏠 Zu mir nach Hause</option>
      ${ents.length?'<option value="crm">🏛️ Für einen Verein / Partner</option>':''}
      ${pls.length?'<option value="place">🏢 Ins Büro / an einen Ort</option>':''}
      <option value="other">✏️ Andere Adresse / Person</option></select></div>
    <div class="shop-f2" id="so-crm-w" style="display:none"><div class="shop-f"><label>Welcher Verein / Partner? *</label><select id="so-crm" onchange="shopOrderCrmChg()">${vOpts}</select></div>
      <div class="shop-f" id="so-k-w" style="display:none"><label>An Person <span style="font-weight:400;color:var(--muted)">(Mitglied / Kontakt, optional)</span></label><select id="so-k" onchange="shopOrderZielChg(true)"></select></div></div>
    <div class="shop-f" id="so-place-w" style="display:none"><label>Welcher Ort? *</label><select id="so-place">${plOpts}</select></div>
    <div class="shop-f" id="so-name-w" style="display:none"><label>Empfänger * <span style="font-weight:400;color:var(--muted)">(Mitarbeiter werden vorgeschlagen)</span></label>
      <input id="so-name" list="so-people" autocomplete="off" placeholder="Name eingeben … z. B. Kollege, Schule XY" oninput="shopOrderNameChg()">${_peopleDatalist('so-people')}</div>
    <div class="shop-f" id="so-adr-w" style="display:none"><label>Lieferadresse <span id="so-adr-h" style="font-weight:400;color:var(--muted)"></span></label>
      <textarea id="so-adr" rows="3" placeholder="Straße Nr.&#10;PLZ Ort"></textarea></div>
    <div class="shop-f"><label>Notiz</label><input id="so-note" placeholder="Optional"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopOrderSave()">Bestellen</button></div>`);
}
function shopOrderItemChg(){
  const v=_val('so-item'); const w=document.getElementById('so-free-w'); if(w) w.style.display=v?'none':'';
  const leih=!!(v && (getShop('shopItems',v)||{}).leihbar);
  const r=document.getElementById('so-ret-w'); if(r) r.style.display=leih?'':'none';
  const l=document.getElementById('so-date-l'); if(l) l.textContent=leih?'Gebraucht ab':'Bis wann?';
}
// Ziel umschalten: passende Felder zeigen + Lieferadresse vorbelegen
// (Verein → Adresse aus dem CRM; Zuhause → Adresse der letzten eigenen „Nach Hause"-Bestellung)
function shopOrderZielChg(onlyAdr){
  const z=_val('so-ziel'); const show=(id,on)=>{ const e=document.getElementById(id); if(e) e.style.display=on?'':'none'; };
  if(!onlyAdr){ show('so-crm-w',z==='crm'); show('so-place-w',z==='place'); show('so-name-w',z==='other'); show('so-adr-w',z==='home'||z==='crm'||z==='other'); }
  const adr=document.getElementById('so-adr'), h=document.getElementById('so-adr-h'); if(!adr) return;
  let pre='', hint='';
  if(z==='home'){
    const prof=userAddress(_me().id);
    const last=orders().find(o=>o.byId===_me().id && o.ziel==='home' && o.adresse);
    if(prof){ pre=prof; hint='(aus deinem Profil)'; }
    else if(last){ pre=last.adresse; hint='(von deiner letzten Bestellung – Tipp: im Profil hinterlegen)'; }
    else hint='(Tipp: Adresse im Profil hinterlegen, dann ist sie immer vorausgefüllt)';
  } else if(z==='other'){
    if(!onlyAdr){ adr.value=''; adr.dataset.auto=''; }   // Adresse vom vorherigen Ziel nicht übernehmen
    shopOrderNameChg(); return;
  } else if(z==='crm'){
    const v=_val('so-crm'); if(v){ const [t,e]=v.split('::'); const kid=_val('so-k')||null;
      const {k}=_crmContact({tree:t,eid:e,kid}); pre=_crmAddress({tree:t,eid:e,kid});
      hint=pre?((k&&k.adresse)?'(Adresse des Kontakts aus dem CRM)':'(Vereinsadresse aus dem CRM)'):'(im CRM ist keine Adresse hinterlegt)'; }
  }
  adr.value=pre; if(h) h.textContent=hint;
}
// „Andere Person": Mitarbeiter erkannt → Profiladresse eintragen (nur wenn das Feld leer ist
// oder zuvor automatisch befüllt wurde – eigene Eingaben werden nie überschrieben)
function shopOrderNameChg(){
  const adr=document.getElementById('so-adr'), h=document.getElementById('so-adr-h'); if(!adr) return;
  const p=personByName(_val('so-name'));
  const auto=adr.dataset.auto==='1' || !adr.value.trim();
  if(p){
    const a=userAddress(p.id);
    if(auto){ adr.value=a; adr.dataset.auto=a?'1':''; }
    if(h) h.textContent=a?`(aus dem Profil von ${p.name})`:`(${p.name} hat keine Adresse im Profil hinterlegt)`;
  } else {
    if(adr.dataset.auto==='1'){ adr.value=''; adr.dataset.auto=''; }
    if(h) h.textContent='';
  }
}
function shopOrderCrmChg(){
  const v=_val('so-crm'); const w=document.getElementById('so-k-w'), s=document.getElementById('so-k');
  if(v && s){ const [t,e]=v.split('::'); s.innerHTML=_contactOpts(t,e); if(w) w.style.display=''; }
  else if(w) w.style.display='none';
  shopOrderZielChg(true);
}
function shopOrderSave(){
  const itemId=_val('so-item'), free=_val('so-free');
  const it=itemId?getShop('shopItems',itemId):null;
  if(!it && !free){ toast('Bitte beschreiben, was gebraucht wird.','err'); return; }
  const q=Math.round(_num(_val('so-qty'))); if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  const ziel=_val('so-ziel'); let zielRef=null, zielName='', ort='', ortText='';
  const adresse=_val('so-adr');
  if(!ziel){ toast('Bitte angeben, wohin bzw. für wen.','err'); return; }
  if(ziel==='home'){ zielName=_me().name||''; ortText='🏠 zu '+zielName+' nach Hause'; }
  else if(ziel==='crm'){ const v=_val('so-crm'); if(!v){ toast('Bitte den Verein / Partner auswählen.','err'); return; }
    const [t,e]=v.split('::'); const kid=_val('so-k')||null; zielRef=kid?{tree:t,eid:e,kid}:{tree:t,eid:e};
    zielName=bName({borrowerRef:zielRef}); ortText=(kid?'👤 ':'🏛️ ')+zielName; }
  else if(ziel==='place'){ ort=_val('so-place'); if(!ort){ toast('Bitte den Ort auswählen.','err'); return; } }
  let zielUserId=null;
  if(ziel==='other'){ zielName=_val('so-name'); if(!zielName){ toast('Bitte den Empfänger angeben.','err'); return; }
    const p=personByName(zielName); if(p){ zielUserId=p.id; zielName=p.name; ortText='👤 '+zielName; } else ortText='✏️ '+zielName; }
  if((ziel==='home'||ziel==='other') && !adresse){ toast('Bitte die Lieferadresse angeben.','err'); return; }
  const leih=!!(it&&it.leihbar); const ret=leih?_val('so-ret'):'';
  if(leih && !ret){ toast('Bitte angeben, bis wann es zurückkommt.','err'); return; }
  if(leih && _val('so-date') && ret<_val('so-date')){ toast('Die Rückgabe liegt vor dem Startdatum.','err'); return; }
  const cu=_me();
  saveShop('shopOrders',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'',
    itemId:it?it.id:null, itemName:it?itemLabel(it):'', freitext:it?'':free, menge:q, einheit:it?(it.einheit||'Stück'):'',
    termin:_val('so-date'), anlass:_val('so-anlass'), ortId:ort||null, ortText, note:_val('so-note'),
    ziel, zielRef, zielName, zielUserId, adresse,
    leihe:leih, rueckgabe:ret, status:'offen', seenBy:{}, ackOrderer:false });
  closeModal(); toast('Bestellung abgeschickt ✓ – der Shop-Verwalter bekommt eine Mitteilung.','ok');
  TAB='bestellungen'; renderShop();
}

// ── Tab: Bestellungen ──────────────────────────────────────────────
function _orderWhat(o){ const it=o.itemId?getShop('shopItems',o.itemId):null; return `${o.menge}× ${esc(it?itemLabel(it):(o.itemName||o.freitext||'?'))}`; }
function _orderWhere(o){
  if(o.ziel==='crm'&&o.zielRef) return esc(bLabel({borrowerRef:o.zielRef,borrowerName:o.zielName}));
  return o.ortId?esc(placeLabel(o.ortId)):(o.ortText?esc(o.ortText):'');
}
// Empfänger einer Bestellung (für Verschicken/Verleihen beim Ausgeben)
function _orderRecipient(o){
  if(o.ziel==='crm'&&o.zielRef) return {bId:null, bRef:o.zielRef, bName:bName({borrowerRef:o.zielRef,borrowerName:o.zielName})};
  if(o.ziel==='other') return o.zielUserId ? {bId:o.zielUserId, bRef:null, bName:o.zielName||'?'} : {bId:null, bRef:null, bName:o.zielName||'?'};
  return {bId:o.byId||null, bRef:null, bName:o.byName||'?'};   // home + alte Bestellungen → Besteller
}
function _ordersHtml(mgr){
  const me=_me();
  if(mgr) _backfillDirectOrders();   // frühere Direkt-Versendungen einmalig nachtragen
  let os=orders(); if(!mgr) os=os.filter(o=>o.byId===me.id);
  const act=o=>o.status==='offen'||o.status==='inarbeit';
  if(fOrd==='aktiv') os=os.filter(act); else if(fOrd==='fertig') os=os.filter(o=>!act(o));
  const seg=[['aktiv','Offen & in Arbeit'],['fertig','Abgeschlossen'],['alle','Alle']];
  const rows=os.map(o=>{
    const st0=STATUS[o.status]||STATUS.offen; const st=(o.status==='ausgegeben'&&o.issueMode==='versand')?{l:'Verschickt',c:st0.c}:st0;
    const late=o.termin && act(o) && o.termin<_todayIso();
    const where=_orderWhere(o);
    const btns=[];
    if(mgr && act(o)){
      if(o.status==='offen') btns.push(`<button class="shop-btn sm" onclick="shopOrderStatus(${jsq(o.id)},'inarbeit')">▶ In Bearbeitung</button>`);
      if(o.itemId) btns.push(`<button class="shop-btn sm ok" onclick="shopOrderIssue(${jsq(o.id)})">📦 Ausgeben</button>`);
      btns.push(`<button class="shop-btn sm${o.itemId?'':' ok'}" onclick="shopOrderDone(${jsq(o.id)},'erledigt')">✓ Erledigt</button>`);
      btns.push(`<button class="shop-btn sm warn" onclick="shopOrderDone(${jsq(o.id)},'abgelehnt')">✕ Ablehnen</button>`);
    }
    if(o.byId===me.id && o.status==='offen') btns.push(`<button class="shop-btn sm warn" onclick="shopOrderCancel(${jsq(o.id)})">Zurückziehen</button>`);
    return `<div class="shop-row"><div class="main">
      <div class="t">${_orderWhat(o)} <span class="shop-st" style="background:${st.c}">${st.l}</span>${o.direkt?' <span class="shop-st" style="background:#6b7280" title="Ohne Bestellung direkt verschickt">📤 direkt</span>':''}</div>
      <div class="m">${mgr?`von <b>${esc(o.byName||'?')}</b> · `:''}${_fmtTs(o.ts)}${o.anlass?` · Anlass: ${esc(o.anlass)}`:''}
        ${o.termin?` · <span class="${late?'shop-late':''}">${o.leihe?'ab':'bis'} ${_fmtDate(o.termin)}${late?' (überfällig)':''}</span>`:''}${o.rueckgabe?` · 🔁 Rückgabe bis ${_fmtDate(o.rueckgabe)}`:''}${where?` · nach: ${where}`:''}
        ${o.adresse?`<br>📮 ${esc(o.adresse).replace(/\n/g,', ')}`:''}
        ${o.note?`<br>📝 ${esc(o.note)}`:''}
        ${o.handledByName?`<br>Bearbeitet von ${esc(o.handledByName)} · ${_fmtTs(o.handledTs)}${o.fromPlace?` · aus ${esc(placeLabel(o.fromPlace))}`:''}`:''}
        ${o.answer?`<br>💬 ${esc(o.answer)}`:''}</div></div>
      ${btns.length?`<div style="display:flex;gap:5px;flex-wrap:wrap">${btns.join('')}</div>`:''}</div>`;
  }).join('');
  return `<div class="shop-bar"><span class="shop-seg">${seg.map(s=>`<button class="${fOrd===s[0]?'on':''}" onclick="shopSetOrd(${jsq(s[0])})">${s[1]}</button>`).join('')}</span>
      <span class="shop-sp"></span>
      ${mgr?`<button class="shop-btn" onclick="shopPickItem('send')" title="Ohne Bestellung direkt an Mitarbeiter, Verein oder andere schicken">📤 Direkt verschicken</button>`:''}
      <button class="shop-btn pri" onclick="shopOrderNew('')">＋ Bestellen</button></div>
    <div class="shop-list">${rows||`<div class="shop-empty">${mgr?'Keine Bestellungen in dieser Ansicht.':'Du hast hier keine Bestellungen.'}</div>`}</div>`;
}
function shopSetOrd(v){ fOrd=v; renderShop(); }
function _handled(o,status,extra){
  const cu=_me();
  Object.assign(o,{status, handledById:cu.id||'', handledByName:cu.name||'', handledTs:Date.now(), ackOrderer:false}, extra||{});
  if(!o.seenBy||typeof o.seenBy!=='object') o.seenBy={};
  o.seenBy[cu.id]=Date.now();
  saveShop('shopOrders', o);
}
function shopOrderStatus(id,status){
  const o=getShop('shopOrders',id); if(!o||!canManage()) return;
  _handled(o,status); toast('Status: '+STATUS[status].l,'ok'); renderShop();
}
function shopOrderDone(id,status){
  const o=getShop('shopOrders',id); if(!o||!canManage()) return;
  const isRej=status==='abgelehnt';
  openModal(`<h3>${isRej?'✕ Bestellung ablehnen':'✓ Als erledigt markieren'}</h3>
    <p style="font-size:13px;margin:0 0 10px">${_orderWhat(o)} · von <b>${esc(o.byName||'')}</b></p>
    <div class="shop-f"><label>${isRej?'Begründung *':'Nachricht an '+esc(o.byName||'Besteller')+' (optional)'}</label>
      <textarea id="sd-ans" rows="3" placeholder="${isRej?'z. B. nicht mehr lieferbar, bitte Alternative …':'z. B. liegt im Büro im Regal, bei der Druckerei bestellt …'}"></textarea></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopOrderDoneSave(${jsq(id)},${jsq(status)})">${isRej?'Ablehnen':'Erledigt'}</button></div>`);
}
function shopOrderDoneSave(id,status){
  const o=getShop('shopOrders',id); if(!o) return;
  const ans=_val('sd-ans');
  if(status==='abgelehnt' && !ans){ toast('Bitte eine Begründung angeben.','err'); return; }
  _handled(o,status,{answer:ans});
  closeModal(); toast(status==='abgelehnt'?'Bestellung abgelehnt – Besteller wird benachrichtigt.':'Erledigt ✓ – Besteller wird benachrichtigt.','ok'); renderShop();
}
// Ausgeben: Bestand am Quell-Ort abziehen ODER an den Lieferort umlagern (z. B. Werkzeug aufs Boot)
function shopOrderIssue(id){
  const o=getShop('shopOrders',id); if(!o||!canManage()) return;
  const it=o.itemId?getShop('shopItems',o.itemId):null;
  if(!it){ toast('Der Artikel existiert nicht mehr – bitte „Erledigt" nutzen.','err'); return; }
  const leih=!!it.leihbar;
  const canMoveTo=!!(o.ortId && placeOf(o.ortId));
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0 && (!canMoveTo || p!==o.ortId));
  if(!from.length){ toast('Kein Bestand vorhanden – erst „± Buchen" (Zugang) oder „Erledigt".','err'); return; }
  const rc=_orderRecipient(o);
  // Vorwahl nach Ziel: Ort → umlagern · Person/Verein → Leihmaterial verleihen, sonst verschicken
  const def = canMoveTo ? 'move' : (leih ? 'leihe' : 'versand');
  const opt=(v,l)=>`<option value="${v}"${def===v?' selected':''}>${l}</option>`;
  openModal(`<h3>📦 Ausgeben / Verschicken</h3><p style="font-size:13px;margin:0 0 6px">${_orderWhat(o)} · bestellt von <b>${esc(o.byName||'')}</b></p>
    <div style="font-size:13px;background:#f1f4f8;border-radius:8px;padding:8px 10px;margin:0 0 10px">Ziel: <b>${_orderWhere(o)||'–'}</b>${o.adresse?`<div style="white-space:pre-line;margin-top:3px">📮 ${esc(o.adresse)}</div>`:''}</div>
    <div class="shop-f2"><div class="shop-f"><label>Aus Ort</label><select id="si-from">${from.map(p=>`<option value="${esc(p)}">${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Menge</label><input id="si-qty" type="number" min="1" step="1" value="${o.menge||1}"></div></div>
    <div class="shop-f"><label>Was passiert?</label><select id="si-mode" onchange="document.getElementById('si-due-w').style.display=this.value==='leihe'?'':'none'">
      ${canMoveTo?opt('move',`⇄ Umlagern nach ${esc(placeLabel(o.ortId))} (bleibt im Bestand)`):''}
      ${leih?opt('leihe',`🔁 Verleihen an ${esc(rc.bName)} (kommt zurück)`):''}
      ${opt('versand',`📤 Verschicken an ${esc(rc.bName)} (bleibt dort, wird abgezogen)`)}
      ${opt('out','➖ Nur vom Bestand abziehen (ohne Empfänger)')}</select></div>
    <div class="shop-f" id="si-due-w" style="display:${def==='leihe'?'':'none'}"><label>Rückgabe bis <span style="font-weight:400;color:var(--muted)">(leer = Dauerleihe)</span></label><input id="si-due" type="date" value="${esc(o.rueckgabe||'')}"></div>
    <div class="shop-f"><label>Nachricht an ${esc(o.byName||'Besteller')} (optional)</label><input id="si-ans" placeholder="z. B. liegt im Bus, Fach links"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopOrderIssueSave(${jsq(id)})">Ausgeben</button></div>`);
}
function shopOrderIssueSave(id){
  const o=getShop('shopOrders',id); if(!o) return;
  const it=getShop('shopItems',o.itemId); if(!it) return;
  const from=_val('si-from'), mode=_val('si-mode'), q=Math.round(_num(_val('si-qty'))), ans=_val('si-ans');
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, from, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[from])} vorhanden.`,'err'); return; }
  const note='Bestellung von '+(o.byName||'?')+(o.anlass?' · '+o.anlass:'');
  const rc=_orderRecipient(o);
  if(mode==='leihe'){
    saveShop('shopItems', it);
    const due=_val('si-due');
    // viaOrder=true nur, wenn der Besteller selbst der Ausleiher ist (er bekommt ja schon die Bestell-Mitteilung)
    _createLoan(it, from, q, rc.bId, rc.bName, due, o.anlass||'', o.note||'', o.id, rc.bId===o.byId, rc.bRef);
    _handled(o,'ausgegeben',{answer:ans, fromPlace:from, issuedQty:q, issueMode:'leihe', rueckgabe:due});
    closeModal(); toast('Verliehen an '+rc.bName+' ✓ – '+(o.byName||'Besteller')+' wird benachrichtigt.','ok'); renderShop(); return;
  }
  if(mode==='versand'){
    saveShop('shopItems', it);
    const cu=_me();
    saveShop('shopLog',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:it.id, itemName:itemLabel(it),
      type:'versand', qty:q, from, to:null, note:note+(o.adresse?' · '+o.adresse.replace(/\n/g,', '):''),
      recipientName:rc.bName, recipientId:rc.bId||null, recipientRef:rc.bRef||null, orderId:o.id });
    _handled(o,'ausgegeben',{answer:ans, fromPlace:from, issuedQty:q, issueMode:'versand'});
    closeModal(); toast('Verschickt an '+rc.bName+' ✓ – '+(o.byName||'Besteller')+' wird benachrichtigt.','ok'); renderShop(); return;
  }
  if(mode==='move' && o.ortId){ _applyDelta(it, o.ortId, q); saveShop('shopItems', it); _log(it,'umlagern',q,from,o.ortId,note,o.id); }
  else { saveShop('shopItems', it); _log(it,'ausgabe',q,from,null,note,o.id); }
  _handled(o,'ausgegeben',{answer:ans, fromPlace:from, issuedQty:q, issueMode:mode});
  closeModal(); toast('Ausgegeben ✓ – Besteller wird benachrichtigt.','ok'); renderShop();
}
function shopOrderCancel(id){
  const o=getShop('shopOrders',id); if(!o) return;
  if(o.byId!==_me().id||o.status!=='offen') return;
  if(!confirm('Bestellung zurückziehen?')) return;
  deleteShop('shopOrders', id); toast('Bestellung zurückgezogen.','ok'); renderShop();
}

// ── Ausleihe ───────────────────────────────────────────────────────
// Bestand wurde vom Aufrufer bereits am Quell-Ort abgezogen (it gespeichert).
function _createLoan(it, fromPlace, qty, borrowerId, borrowerName, due, anlass, note, orderId, viaOrder, borrowerRef){
  const cu=_me();
  const l={ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:it.id, itemName:itemLabel(it),
    qty, fromPlace, borrowerId:borrowerId||null, borrowerRef:borrowerRef||null, borrowerName:borrowerName||'?', due:due||'', anlass:anlass||'', note:note||'',
    orderId:orderId||null, status:'aktiv', returns:[],
    // Über eine Bestellung → Besteller bekommt schon die Bestell-Mitteilung; direkt verliehen → eigene Mitteilung
    ackBorrower: !!viaOrder || !borrowerId || borrowerId===cu.id };
  saveShop('shopLoans', l);
  _log(it,'verleih',qty,fromPlace,null,'an '+(borrowerName||'?')+(due?' bis '+_fmtDate(due):' (Dauerleihe)')+(anlass?' · '+anlass:''),orderId);
  return l;
}
// Gemeinsame Empfänger-Auswahl (Verleihen + Verschicken): Mitarbeiter · CRM-Einträge je Bereich · freier Name
function _whoPickerHtml(px){
  const ppl=people();
  const ents=_crmEntities(); const byTree={};
  ents.forEach(x=>{ (byTree[x.tree]=byTree[x.tree]||{label:x.treeLabel,icon:x.icon,list:[]}).list.push(x); });
  const crmGroups=Object.keys(byTree).map(k=>{ const g=byTree[k];
    return `<optgroup label="${esc(g.icon+' '+g.label)}">${g.list.sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'})).map(x=>`<option value="c:${esc(x.tree)}::${esc(x.eid)}">${esc(x.name)}</option>`).join('')}</optgroup>`; }).join('');
  return `<div class="shop-f2"><div class="shop-f"><label>An wen? *</label><select id="${px}-who" onchange="shopWhoChg('${px}')">
        <option value="">– bitte wählen –</option>
        ${ppl.length?`<optgroup label="👤 Mitarbeiter">${ppl.map(u=>`<option value="u:${esc(u.id)}">${esc(u.name)}</option>`).join('')}</optgroup>`:''}
        ${crmGroups}
        <option value="__other">✏️ Andere Person / Organisation …</option></select></div>
      <div class="shop-f" id="${px}-other-w" style="display:none"><label>Name <span style="font-weight:400;color:var(--muted)">(Mitarbeiter werden vorgeschlagen)</span></label><input id="${px}-other" list="${px}-people" autocomplete="off" placeholder="z. B. Max Muster, Schule XY" oninput="shopWhoChg('${px}',true)">${_peopleDatalist(px+'-people')}</div>
      <div class="shop-f" id="${px}-k-w" style="display:none"><label>An Person <span style="font-weight:400;color:var(--muted)">(Mitglied / Kontakt, optional)</span></label><select id="${px}-k" onchange="shopWhoChg('${px}',true)"></select></div></div>
      <div class="shop-f" id="${px}-adr-w" style="display:none;font-size:12px;color:var(--muted);margin-top:-4px"></div>`;
}
// Empfänger gewechselt: freies Namensfeld bzw. Kontaktliste des Vereins zeigen + Adresse anzeigen
function shopWhoChg(px, onlyAdr){
  const who=_val(px+'-who'); const g=id=>document.getElementById(px+id);
  if(!onlyAdr){
    if(g('-other-w')) g('-other-w').style.display=who==='__other'?'':'none';
    const isC=who.startsWith('c:');
    if(g('-k-w')) g('-k-w').style.display=isC?'':'none';
    if(isC && g('-k')){ const [tree,eid]=who.slice(2).split('::'); g('-k').innerHTML=_contactOpts(tree,eid); }
  }
  const aw=g('-adr-w'); if(!aw) return;
  const showAdr=(adr,missing)=>{ aw.style.display=''; aw.innerHTML=adr?'📮 '+esc(adr).replace(/\n/g,', '):'📮 '+missing; };
  if(who.startsWith('c:')){ const [tree,eid]=who.slice(2).split('::'); showAdr(_crmAddress({tree,eid,kid:_val(px+'-k')||null}),'Im CRM ist keine Adresse hinterlegt.'); }
  else if(who.startsWith('u:')){ showAdr(userAddress(who.slice(2)),'Keine Adresse im Profil hinterlegt.'); }
  else if(who==='__other'){ const p=personByName(_val(px+'-other'));
    if(p) showAdr(userAddress(p.id),'Keine Adresse im Profil hinterlegt.'); else aw.style.display='none'; }
  else aw.style.display='none';
}
// → {bId, bRef, bName} oder null (mit Hinweis)
function _whoRead(px){
  const who=_val(px+'-who');
  if(who==='__other'){ const n=_val(px+'-other'); if(!n){ toast('Bitte einen Namen eingeben.','err'); return null; }
    const p=personByName(n); if(p) return {bId:p.id,bRef:null,bName:p.name};   // getippter Mitarbeitername → als Mitarbeiter zuordnen
    return {bId:null,bRef:null,bName:n}; }
  if(who.startsWith('u:')){ const id=who.slice(2); const u=people().find(x=>x.id===id); return {bId:id,bRef:null,bName:u?u.name:id}; }
  if(who.startsWith('c:')){ const [tree,eid]=who.slice(2).split('::'); const kid=_val(px+'-k')||null;
    const ref=kid?{tree,eid,kid}:{tree,eid}; return {bId:null,bRef:ref,bName:bName({borrowerRef:ref})}; }
  toast('Bitte auswählen, wer es bekommt.','err'); return null;
}
function shopLend(itemId){
  if(!canManage()) return;
  const it=getShop('shopItems',itemId); if(!it) return;
  if(!it.leihbar){ toast('Verbrauchsmaterial wird nicht verliehen – bitte „📤 Verschicken" nutzen (oder den Artikel als Leihmaterial markieren).','err'); return; }
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0);
  if(!from.length){ toast('Gerade nichts verfügbar – alles verliehen oder kein Bestand.','err'); return; }
  openModal(`<h3>🔁 Verleihen</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b> · ${inPlaces(it)} verfügbar · kommt zurück</p>
    ${_whoPickerHtml('sl')}
    <div class="shop-f2"><div class="shop-f"><label>Aus Ort</label><select id="sl-from">${from.map(p=>`<option value="${esc(p)}"${fPlace===p?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Menge</label><input id="sl-qty" type="number" min="1" step="1" value="1"></div></div>
    <div class="shop-f2"><div class="shop-f"><label>Rückgabe bis <span id="sl-due-req">*</span></label><input id="sl-due" type="date" min="${_todayIso()}">
        <label style="display:flex;gap:6px;align-items:center;font-weight:400;margin-top:5px;cursor:pointer"><input type="checkbox" id="sl-perm" style="width:auto" onchange="const d=document.getElementById('sl-due');d.disabled=this.checked;if(this.checked)d.value='';document.getElementById('sl-due-req').style.display=this.checked?'none':''"> Dauerleihe (ohne Rückgabedatum)</label></div>
      <div class="shop-f"><label>Wofür / Anlass</label><input id="sl-anlass" placeholder="z. B. Regatta, Messe, fester Standort"></div></div>
    <div class="shop-f"><label>Notiz</label><input id="sl-note" placeholder="z. B. Zustand bei Ausgabe, Zubehör"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopLendSave(${jsq(itemId)})">Verleihen</button></div>`);
}
function shopLendSave(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const w=_whoRead('sl'); if(!w) return; const {bId,bRef,bName}=w;
  const perm=!!(document.getElementById('sl-perm')||{}).checked;
  const from=_val('sl-from'), q=Math.round(_num(_val('sl-qty'))), due=perm?'':_val('sl-due');
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!due && !perm){ toast('Bitte ein Rückgabedatum angeben – oder „Dauerleihe" anhaken.','err'); return; }
  if(!_applyDelta(it, from, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[from])} vorhanden.`,'err'); return; }
  saveShop('shopItems', it);
  _createLoan(it, from, q, bId, bName, due, _val('sl-anlass'), _val('sl-note'), null, false, bRef);
  closeModal(); toast(`${q}× verliehen an ${bName} ✓`,'ok'); renderShop();
}
// Verwalter: erst Artikel wählen, dann Verschicken bzw. Verleihen (ohne vorherige Bestellung)
function shopPickItem(mode){
  if(!canManage()) return;
  const lend=mode==='lend';
  const list=items().filter(i=>inPlaces(i)>0 && (!lend || i.leihbar));
  if(!list.length){ toast(lend?'Kein Leihmaterial mit verfügbarem Bestand.':'Kein Artikel mit Bestand.','err'); return; }
  openModal(`<h3>${lend?'🔁 Verleihen':'📤 Direkt verschicken'} – welcher Artikel?</h3>
    <div class="shop-f"><label>Artikel</label><select id="spi-item">${list.map(i=>`<option value="${esc(i.id)}">${esc(itemLabel(i))}${i.kategorie?' – '+esc(i.kategorie):''} (${inPlaces(i)} verfügbar)</option>`).join('')}</select></div>
    ${lend?'':'<p style="font-size:12px;color:var(--muted);margin:0">Leihmaterial, das zurückkommen soll, besser über „🔁 Ausleihen" → „Verleihen".</p>'}
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="${lend?'shopLend':'shopSend'}(document.getElementById('spi-item').value)">Weiter</button></div>`);
}
// ── Verschicken / abgeben (Verbrauch MIT Empfänger: Flyer an Verein, Visitenkarten an Mitarbeiter …)
function shopSend(itemId){
  if(!canManage()) return;
  const it=getShop('shopItems',itemId); if(!it) return;
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0);
  if(!from.length){ toast('Kein Bestand zum Verschicken.','err'); return; }
  openModal(`<h3>📤 Verschicken / abgeben</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b> · ${inPlaces(it)} verfügbar · bleibt beim Empfänger (wird vom Bestand abgezogen)</p>
    ${_whoPickerHtml('ss')}
    <div class="shop-f2"><div class="shop-f"><label>Aus Ort</label><select id="ss-from">${from.map(p=>`<option value="${esc(p)}"${fPlace===p?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Menge</label><input id="ss-qty" type="number" min="1" step="1" value="1"></div></div>
    <div class="shop-f2"><div class="shop-f"><label>Wie?</label><select id="ss-how"><option>Post / Versand</option><option>Persönlich übergeben</option><option>Abgeholt</option></select></div>
      <div class="shop-f"><label>Wofür / Anlass</label><input id="ss-anlass" placeholder="z. B. Vereinsfest, Messe"></div></div>
    <div class="shop-f"><label>Notiz</label><input id="ss-note" placeholder="z. B. Sendungsnummer"></div>
    ${it.leihbar?'<p style="font-size:12px;color:var(--muted);margin:0">Soll es zurückkommen? Dann besser „🔁 Verleihen".</p>':''}
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopSendSave(${jsq(itemId)})">Verschicken</button></div>`);
}
function shopSendSave(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const w=_whoRead('ss'); if(!w) return;
  const from=_val('ss-from'), q=Math.round(_num(_val('ss-qty')));
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, from, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[from])} vorhanden.`,'err'); return; }
  saveShop('shopItems', it);
  const cu=_me(), anlass=_val('ss-anlass'), note=_val('ss-note'), how=_val('ss-how');
  const adr=w.bRef?_crmAddress(w.bRef):(w.bId?userAddress(w.bId):'');
  const log={ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:it.id, itemName:itemLabel(it),
    type:'versand', qty:q, from, to:null, note:[how,anlass,note,adr.split('\n').join(', ')].filter(Boolean).join(' · '),
    recipientName:w.bName, recipientId:w.bId||null, recipientRef:w.bRef||null, orderId:null };
  // Direkter Versand erscheint auch in „Bestellungen" (gleich als ausgegeben) – eine Liste für „was ging an wen"
  const o=_directOrder(log, it, how, anlass, note, adr);
  log.orderId=o.id;
  saveShop('shopOrders', o);
  saveShop('shopLog', log);
  if(TAB==='bestellungen') fOrd='alle';   // sonst wäre der (schon abgeschlossene) Eintrag in „Offen & in Arbeit" unsichtbar
  closeModal(); toast(`${q}× an ${w.bName} verschickt ✓`,'ok'); renderShop();
}
// Bestell-Eintrag für einen Versand ohne vorherige Bestellung (status 'ausgegeben', direkt:true)
function _directOrder(log, it, how, anlass, note, adr){
  const ref=log.recipientRef, uid=log.recipientId;
  return { id:newId(), ts:log.ts, byId:log.byId, byName:log.byName, direkt:true,
    itemId:it?it.id:(log.itemId||null), itemName:log.itemName||'', freitext:'', menge:log.qty, einheit:it?(it.einheit||'Stück'):'',
    termin:'', anlass:anlass||'', note:[how,note].filter(Boolean).join(' · '),
    ziel: ref?'crm':'other', zielRef:ref||null, zielUserId:uid||null, zielName:log.recipientName||'', ortId:null,
    ortText:(ref?(ref.kid?'👤 ':'🏛️ '):(uid?'👤 ':'✏️ '))+(log.recipientName||''), adresse:adr||'',
    status:'ausgegeben', issueMode:'versand', fromPlace:log.from||null, issuedQty:log.qty,
    handledById:log.byId, handledByName:log.byName, handledTs:log.ts,
    seenBy:{[log.byId||'x']:log.ts}, ackOrderer:true, leihe:false, rueckgabe:'' };
}
// Einmalig nachtragen: frühere Direkt-Versendungen (Log ohne orderId) als Bestell-Eintrag anlegen
function _backfillDirectOrders(){
  if(!canManage()) return;
  listShop('shopLog').filter(l=>l.type==='versand' && !l.orderId).forEach(l=>{
    const it=getShop('shopItems',l.itemId);
    const o=_directOrder(l, it, '', '', l.note||'', '');
    saveShop('shopOrders', o);
    saveShop('shopLog', Object.assign({}, l, {orderId:o.id}));
  });
}
function _recipLabel(l){ if(!l.recipientName) return ''; return bLabel({borrowerRef:l.recipientRef,borrowerId:l.recipientId,borrowerName:l.recipientName}); }
function shopReturn(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv') return;
  const me=_me(); if(!canManage() && l.borrowerId!==me.id) return;
  const pls=places(); if(!pls.length){ toast('Es gibt keinen Ort für die Rückgabe.','err'); return; }
  const def=placeOf(l.fromPlace)?l.fromPlace:pls[0].id;
  openModal(`<h3>↩ Zurückgeben</h3><p style="font-size:13px;margin:0 0 10px"><b>${_num(l.qty)}× ${esc(l.itemName||'')}</b> · ausgeliehen von ${esc(bLabel(l))}${l.due?' · bis '+_fmtDate(l.due):''}</p>
    <div class="shop-f2"><div class="shop-f"><label>Zurück nach</label>${_placeSelect('sr-to', def, false)}</div>
      <div class="shop-f"><label>Menge</label><input id="sr-qty" type="number" min="1" max="${_num(l.qty)}" step="1" value="${_num(l.qty)}"></div></div>
    <div class="shop-f"><label>Zustand / Notiz</label><input id="sr-note" placeholder="z. B. alles ok, Stange verbogen, Akku fehlt"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopReturnSave(${jsq(loanId)})">Zurückgeben</button></div>`);
}
function shopReturnSave(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv') return;
  const to=_val('sr-to'), q=Math.round(_num(_val('sr-qty'))), note=_val('sr-note'), open=_num(l.qty);
  if(q<=0||q>open){ toast(`Bitte eine Menge zwischen 1 und ${open} eingeben.`,'err'); return; }
  const it=getShop('shopItems',l.itemId);
  if(it){ _applyDelta(it, to, q); saveShop('shopItems', it); _log(it,'rueckgabe',q,null,to,'von '+bName(l)+(note?' · '+note:'')); }
  const cu=_me();
  if(!Array.isArray(l.returns)) l.returns=[];
  l.returns.push({ ts:Date.now(), qty:q, to, note, byId:cu.id||'', byName:cu.name||'' });
  l.qty=open-q;
  if(l.qty<=0){ l.status='zurueck'; l.returnedTs=Date.now(); }
  saveShop('shopLoans', l);
  closeModal(); toast(l.status==='zurueck'?'Zurückgegeben ✓':`${q} zurück – ${l.qty} noch ausgeliehen.`,'ok'); renderShop();
}
function shopLoanDue(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv'||!canManage()) return;
  openModal(`<h3>📅 Rückgabedatum</h3><p style="font-size:13px;margin:0 0 10px">${_num(l.qty)}× ${esc(l.itemName||'')} · ${esc(bLabel(l))}</p>
    <div class="shop-f"><label>Rückgabe bis <span style="font-weight:400;color:var(--muted)">(leer = Dauerleihe)</span></label><input id="sld-due" type="date" value="${esc(l.due||'')}"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopLoanDueSave(${jsq(loanId)})">Speichern</button></div>`);
}
function shopLoanDueSave(loanId){
  const l=getShop('shopLoans',loanId); if(!l) return;
  const d=_val('sld-due');
  l.due=d; l.ackOverdue=''; saveShop('shopLoans', l); closeModal(); toast(d?'Rückgabe bis '+_fmtDate(d)+' ✓':'Jetzt Dauerleihe ✓','ok'); renderShop();
}
function _loansHtml(mgr){
  const me=_me();
  let ls=loans(); if(!mgr) ls=ls.filter(l=>l.borrowerId===me.id);
  if(fLoan==='aktiv') ls=ls.filter(l=>l.status==='aktiv').sort((a,b)=>String(a.due||'9').localeCompare(String(b.due||'9')));
  else ls=ls.filter(l=>l.status!=='aktiv');
  const rows=ls.map(l=>{
    const late=_overdue(l); const ret=Array.isArray(l.returns)?l.returns:[];
    const canRet=l.status==='aktiv' && (mgr || l.borrowerId===me.id);
    return `<div class="shop-row"${late?' style="border-color:#e5484d"':''}><div class="main">
      <div class="t">🔁 ${_num(l.qty)||ret.reduce((s,r)=>s+_num(r.qty),0)}× ${esc(l.itemName||'?')}
        ${l.status==='aktiv'?(late?'<span class="shop-st" style="background:#c0392b">Überfällig</span>':'<span class="shop-st" style="background:#2563eb">Ausgeliehen</span>'):'<span class="shop-st" style="background:#16a34a">Zurück</span>'}</div>
      <div class="m">${mgr?`an <b>${esc(bLabel(l))}</b> · `:''}seit ${_fmtTs(l.ts)} aus ${esc(placeLabel(l.fromPlace))}
        ${l.due?` · <span class="${late?'shop-late':''}">zurück bis ${_fmtDate(l.due)}</span>`:(l.status==='aktiv'?' · Dauerleihe':'')}${l.anlass?` · ${esc(l.anlass)}`:''}
        ${l.note?`<br>📝 ${esc(l.note)}`:''}
        ${ret.map(r=>`<br>↩ ${_num(r.qty)} zurück nach ${esc(placeLabel(r.to))} · ${_fmtTs(r.ts)} (${esc(r.byName||'')})${r.note?' – '+esc(r.note):''}`).join('')}</div></div>
      ${canRet?`<div style="display:flex;gap:5px;flex-wrap:wrap"><button class="shop-btn sm ok" onclick="shopReturn(${jsq(l.id)})">↩ Zurückgeben</button>
        ${mgr?`<button class="shop-btn sm" onclick="shopLoanDue(${jsq(l.id)})">📅 ${l.due?'Verlängern':'Datum setzen'}</button>`:''}</div>`:''}</div>`;
  }).join('');
  const seg=[['aktiv','Ausgeliehen'],['zurueck','Zurückgegeben']];
  return `<div class="shop-bar"><span class="shop-seg">${seg.map(s=>`<button class="${fLoan===s[0]?'on':''}" onclick="shopSetLoan(${jsq(s[0])})">${s[1]}</button>`).join('')}</span>
      <span class="shop-sp"></span>${mgr?`<button class="shop-btn pri" onclick="shopPickItem('lend')">🔁 Verleihen</button>`
        :`<button class="shop-btn pri" onclick="shopOrderNew('')" title="Leihmaterial anfragen – mit Rückgabedatum">🔁 Ausleihen anfragen</button>`}</div>
    <div class="shop-list">${rows||`<div class="shop-empty">${fLoan==='aktiv'?(mgr?'Gerade ist nichts verliehen.':'Du hast gerade nichts ausgeliehen.'):'Noch keine Rückgaben.'}</div>`}</div>`;
}
function shopSetLoan(v){ fLoan=v; renderShop(); }

// ── Tab: Orte ──────────────────────────────────────────────────────
function _orteHtml(){
  const its=items();
  const rows=places().map(p=>{
    const here=its.filter(i=>_num((i.stock||{})[p.id])>0);
    const n=here.reduce((s,i)=>s+_num(i.stock[p.id]),0);
    return `<div class="shop-row"><div class="main"><div class="t">${esc(placeLabel(p.id))}</div>
      <div class="m">${here.length?`${here.length} Artikel · ${n} Teile: `+here.slice(0,6).map(i=>esc(i.name)+' ('+_num(i.stock[p.id])+')').join(', ')+(here.length>6?' …':''):'leer'}${p.note?'<br>📝 '+esc(p.note):''}</div></div>
      <div style="display:flex;gap:5px"><button class="shop-btn sm" onclick="shopSetPlace(${jsq(p.id)});shopTab('bestand')">Ansehen</button>
      <button class="shop-btn sm" onclick="shopPlaceEdit(${jsq(p.id)})">✎</button></div></div>`;
  }).join('');
  const bws=_borrowers();
  const bRows=bws.map(b=>`<div class="shop-row"><div class="main"><div class="t">${esc(b.label)}</div>
      <div class="m">${b.loans.length} Leihe${b.loans.length===1?'':'n'} · `+b.loans.map(l=>`${_num(l.qty)}× ${esc(l.itemName||'')}${l.due?` (bis <span class="${_overdue(l)?'shop-late':''}">${_fmtDate(l.due)}</span>)`:' (dauerhaft)'}`).join(', ')+`</div></div>
      <div style="display:flex;gap:5px"><button class="shop-btn sm" onclick="shopSetPlace(${jsq('loan:'+b.key)});shopTab('bestand')">Ansehen</button></div></div>`).join('');
  return `<div class="shop-bar"><span style="font-size:13px;color:var(--muted)">Wo liegen Sachen? Büro, Bus, Boote, Lager …</span><span class="shop-sp"></span>
    <button class="shop-btn pri" onclick="shopPlaceEdit('')">＋ Ort</button></div>
    <div class="shop-list">${rows||'<div class="shop-empty">Noch keine Orte angelegt.</div>'}</div>
    ${bRows?`<h4 style="margin:18px 0 8px;color:var(--primary)">🔁 Unterwegs bei (ausgeliehen)</h4><div class="shop-list">${bRows}</div>`:''}
    ${_orgSettingHtml()}`;
}
function _orgSettingHtml(){
  const o=shopOrg(); const e=_orgEntity(); const cur=o?o.tree+'::'+o.eid:'';
  const opts=_crmEntities().sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'}))
    .map(x=>`<option value="${esc(x.tree)}::${esc(x.eid)}"${(o&&!o.auto&&cur===x.tree+'::'+x.eid)?' selected':''}>${esc(x.name)}</option>`).join('');
  const n=e?(e.kontakte||[]).length:0;
  return `<h4 style="margin:18px 0 8px;color:var(--primary)">🏢 Eigene Organisation im CRM</h4>
    <div class="shop-row"><div class="main"><div class="m" style="font-size:13px;color:var(--text)">Die Adressen der Mitarbeiter kommen aus den <b>CRM-Kontakten</b> dieses Eintrags (Zuordnung per E-Mail oder Name) – im Profil gepflegt, nichts doppelt.
      <br>Aktuell: <b>${e?esc((e.stamm&&e.stamm.name)||''):'– nicht gefunden –'}</b>${o&&o.auto?' (automatisch erkannt)':''}${e?` · ${n} Kontakt${n===1?'':'e'}`:''}</div></div>
      <select onchange="shopSetOrg(this.value)" style="padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;max-width:280px"><option value="">🔍 Automatisch („Turning Point")</option>${opts}</select></div>`;
}
// Alle, die gerade etwas ausgeliehen haben – gruppiert (Mitarbeiter, CRM-Einträge, freie Namen)
function _borrowers(){
  const m={};
  activeLoans().forEach(l=>{ const k=bKey(l); (m[k]=m[k]||{key:k, label:bLabel(l), loans:[]}).loans.push(l); });
  return Object.values(m).sort((a,b)=>a.label.localeCompare(b.label,'de',{sensitivity:'base'}));
}
// Für die CRM-Detailseite eines Vereins/Eintrags: laufende Leihgaben (HTML, leer wenn keine)
function shopLoansForEntity(tree, eid){
  try{
    // NUR ANZEIGE (Vorgabe): Bestellen/Verleihen/Verschicken passiert ausschließlich im Shop.
    const ls=activeLoans().filter(l=>l.borrowerRef&&l.borrowerRef.tree===tree&&l.borrowerRef.eid===eid);
    const sent=listShop('shopLog').filter(l=>l.type==='versand'&&l.recipientRef&&l.recipientRef.tree===tree&&l.recipientRef.eid===eid)
      .sort((a,b)=>(b.ts||0)-(a.ts||0));
    if(!ls.length && !sent.length) return '';
    const can=canUse();
    const d=ts=>_fmtDate(new Date(ts).toISOString().slice(0,10));
    // Ging es an einen bestimmten Kontakt/Mitglied? → „ → Max Muster"
    const pers=ref=>{ if(!ref||!ref.kid) return ''; const {k}=_crmContact(ref); return k&&k.name?' → 👤 '+esc(k.name):''; };
    return `<div class="crm-sec"><h4><span class="ttl">🛒 Aus dem Shop</span>${can&&ls.length?`<span class="hbtns"><button class="btn-sm-crm" onclick="shopOpenBorrower(${jsq('loan:c:'+tree+'/'+eid)})">Im Shop ansehen</button></span>`:''}</h4>
      ${ls.length?`<div class="small" style="font-weight:700;margin:2px 0 4px">🔁 Gerade ausgeliehen</div>`+ls.map(l=>`<div class="crm-row"><div class="grow"><span class="name">${_num(l.qty)}× ${esc(l.itemName||'')}${pers(l.borrowerRef)}</span>
        <div class="small">seit ${d(l.ts)}${l.due?` · <span style="${_overdue(l)?'color:#c0392b;font-weight:700':''}">zurück bis ${_fmtDate(l.due)}${_overdue(l)?' (überfällig)':''}</span>`:' · Dauerleihe'}${l.anlass?' · '+esc(l.anlass):''}</div></div></div>`).join(''):''}
      ${sent.length?`<div class="small" style="font-weight:700;margin:8px 0 4px">📤 Erhalten</div>`+sent.slice(0,15).map(l=>`<div class="crm-row"><div class="grow"><span class="name">${_num(l.qty)}× ${esc(l.itemName||'')}${pers(l.recipientRef)}</span>
        <div class="small">${d(l.ts)}${l.note?' · '+esc(l.note):''}</div></div></div>`).join('')+(sent.length>15?`<div class="small" style="color:var(--muted)">… und ${sent.length-15} weitere</div>`:''):''}
    </div>`;
  }catch(e){ return ''; }
}
function shopOpenBorrower(key){ fPlace=key; TAB='bestand'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
function shopPlaceEdit(id){
  if(!canManage()) return;
  const p=id?getShop('shopPlaces',id):null; const v=p||{name:'',typ:'buero',note:''};
  openModal(`<h3>${p?'✎ Ort bearbeiten':'＋ Neuer Ort'}</h3>
    <div class="shop-f2"><div class="shop-f"><label>Name *</label><input id="sp-name" value="${esc(v.name)}" placeholder="z. B. Boot 1, Bus, Büro Kiel"></div>
      <div class="shop-f"><label>Art</label><select id="sp-typ">${Object.keys(PLACE_TYPES).map(k=>`<option value="${k}"${v.typ===k?' selected':''}>${PLACE_TYPES[k].i} ${PLACE_TYPES[k].l}</option>`).join('')}</select></div></div>
    <div class="shop-f"><label>Notiz</label><input id="sp-note" value="${esc(v.note||'')}" placeholder="z. B. Liegeplatz, Schlüssel bei …"></div>
    <div class="modal-btns">${p?`<button class="btn btn-outline" style="margin-right:auto;color:var(--danger);border-color:var(--danger)" onclick="shopPlaceDelete(${jsq(p.id)})">🗑 Löschen</button>`:''}
    <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopPlaceSave(${jsq(id||'')})">Speichern</button></div>`);
}
function shopPlaceSave(id){
  const name=_val('sp-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const ex=id?getShop('shopPlaces',id):null;
  if(places().some(p=>p.id!==id && String(p.name).toLowerCase()===name.toLowerCase())){ toast('Einen Ort mit diesem Namen gibt es schon.','err'); return; }
  saveShop('shopPlaces', Object.assign({}, ex||{id:newId(), createdAt:Date.now()}, {name, typ:_val('sp-typ')||'sonst', note:_val('sp-note')}));
  closeModal(); toast('Ort gespeichert ✓','ok'); renderShop();
}
function shopPlaceDelete(id){
  const p=getShop('shopPlaces',id); if(!p) return;
  const used=items().filter(i=>_num((i.stock||{})[id])>0);
  if(used.length){ toast(`An „${p.name}" liegt noch Bestand (${used.length} Artikel) – erst umlagern.`,'err'); return; }
  if(!confirm(`Ort „${p.name}" löschen?`)) return;
  deleteShop('shopPlaces', id); if(fPlace===id) fPlace=''; closeModal(); toast('Ort gelöscht.','ok'); renderShop();
}

// ── Tab: Verlauf ───────────────────────────────────────────────────
function _verlaufHtml(){
  const its=items();
  let logs=listShop('shopLog').sort((a,b)=>(b.ts||0)-(a.ts||0));
  if(fLogItem) logs=logs.filter(l=>l.itemId===fLogItem);
  const shown=logs.slice(0,300);
  const opts=['<option value="">Alle Artikel</option>'].concat(its.map(i=>`<option value="${esc(i.id)}"${fLogItem===i.id?' selected':''}>${esc(itemLabel(i))}</option>`)).join('');
  const rows=shown.map(l=>`<tr><td style="white-space:nowrap">${_fmtTs(l.ts)}</td><td>${esc(l.byName||'')}</td><td style="white-space:nowrap">${LOG_T[l.type]||esc(l.type)}</td>
    <td style="text-align:right;font-weight:700">${l.type==='korrektur'?(l.qty>0?'+':'')+l.qty:l.qty}</td><td>${esc(l.itemName||'')}</td>
    <td>${l.from?esc(placeLabel(l.from)):''}${l.from&&l.to&&l.from!==l.to?' → ':''}${l.to&&l.to!==l.from?esc(placeLabel(l.to)):''}${l.recipientName?' → '+esc(_recipLabel(l)):''}</td><td>${esc(l.note||'')}</td></tr>`).join('');
  return `<div class="shop-bar"><select onchange="shopSetLogItem(this.value)">${opts}</select><span class="shop-sp"></span>
    <span style="font-size:12px;color:var(--muted)">${logs.length} Buchung${logs.length===1?'':'en'}${logs.length>300?' (neueste 300)':''}</span></div>
    ${rows?`<div style="overflow-x:auto"><table class="shop-log"><thead><tr><th>Wann</th><th>Wer</th><th>Art</th><th>Menge</th><th>Artikel</th><th>Ort</th><th>Notiz</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="shop-empty">Noch keine Buchungen.</div>'}`;
}
function shopSetLogItem(v){ fLogItem=v; renderShop(); }

// ── Mitteilungen (für die gemeinsame Leiste in gfberichte.js) ──────
// Verwalter: neue (offene) Bestellungen, die er noch nicht gesehen hat.
// Besteller: Bestellung ausgegeben / erledigt / abgelehnt, noch nicht quittiert.
function shopNotices(){
  const cu=window.cu; if(!cu||!canUse()) return [];
  const mgr=canManage(); const out=[];
  orders().forEach(o=>{
    if(mgr && o.status==='offen' && o.byId!==cu.id && !(o.seenBy&&o.seenBy[cu.id])){
      out.push({ ts:o.ts, html:`🛒 Neue Bestellung von <b>${esc(o.byName||'?')}</b>: ${_orderWhat(o)}${o.termin?` (bis ${_fmtDate(o.termin)})`:''}${o.anlass?' – '+esc(o.anlass):''}`,
        open:`shopNoticeOpen(${JSON.stringify(o.id)})`, ack:`shopNoticeSeen(${JSON.stringify(o.id)})` });
    }
    if(o.byId===cu.id && !o.ackOrderer && (o.status==='ausgegeben'||o.status==='erledigt'||o.status==='abgelehnt')){
      const st=STATUS[o.status];
      out.push({ ts:o.handledTs||o.ts, html:`🛒 Deine Bestellung ${_orderWhat(o)} ist <b>${st.l.toLowerCase()}</b>${o.handledByName?' ('+esc(o.handledByName)+')':''}${o.answer?': „'+esc(o.answer)+'“':''}${o.status==='ausgegeben'&&o.issueMode==='move'&&o.ortId?' – liegt jetzt: '+esc(placeLabel(o.ortId)):''}${o.issueMode==='leihe'?' – 🔁 verliehen an '+esc(_orderRecipient(o).bName)+(o.rueckgabe?', zurück bis '+_fmtDate(o.rueckgabe):' (Dauerleihe)'):''}${o.issueMode==='versand'?' – 📤 verschickt an '+esc(_orderRecipient(o).bName):''}`,
        open:`shopNoticeOpen(${JSON.stringify(o.id)})`, ack:`shopNoticeAck(${JSON.stringify(o.id)})` });
    }
  });
  // Ausleihe: direkt verliehen (Ausleiher) · überfällig (Ausleiher, 1× pro Tag) · Sammelmeldung für Verwalter
  const today=_todayIso();
  activeLoans().forEach(l=>{
    if(l.borrowerId!==cu.id) return;
    if(!l.ackBorrower) out.push({ ts:l.ts, html:`🔁 <b>${esc(l.byName||'Der Shop')}</b> hat dir ${_num(l.qty)}× ${esc(l.itemName||'')} ausgeliehen${l.due?' – bitte zurückgeben bis <b>'+_fmtDate(l.due)+'</b>':''}.`,
      open:'shopLoanNoticeOpen()', ack:`shopLoanAck(${JSON.stringify(l.id)})` });
    else if(_overdue(l) && l.ackOverdue!==today) out.push({ ts:Date.now(), html:`⏰ Bitte zurückgeben: ${_num(l.qty)}× ${esc(l.itemName||'')} – war bis <b>${_fmtDate(l.due)}</b> ausgeliehen.`,
      open:'shopLoanNoticeOpen()', ack:`shopLoanSnooze(${JSON.stringify(l.id)})` });
  });
  if(mgr){
    const late=activeLoans().filter(l=>_overdue(l) && l.borrowerId!==cu.id);
    let acked=''; try{ acked=localStorage.getItem('tps_shop_od_ack_'+cu.id)||''; }catch(e){}
    if(late.length && acked!==today) out.push({ ts:Date.now(), html:`⏰ ${late.length} Ausleihe${late.length===1?'':'n'} überfällig: `+late.slice(0,3).map(l=>`${_num(l.qty)}× ${esc(l.itemName||'')} (${esc(bName(l))}, seit ${_fmtDate(l.due)})`).join(', ')+(late.length>3?' …':''),
      open:'shopLoanNoticeOpen()', ack:'shopLoanMgrAck()' });
  }
  return out.sort((a,b)=>(b.ts||0)-(a.ts||0));
}
function shopLoanNoticeOpen(){ TAB='ausleihen'; fLoan='aktiv'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
function _noticesRefresh(){ try{ window.renderZeNotices&&window.renderZeNotices(); }catch(e){} }
function shopLoanAck(id){ const l=getShop('shopLoans',id); if(!l) return; l.ackBorrower=true; saveShop('shopLoans', l); _noticesRefresh(); }
function shopLoanSnooze(id){ const l=getShop('shopLoans',id); if(!l) return; l.ackOverdue=_todayIso(); saveShop('shopLoans', l); _noticesRefresh(); }
function shopLoanMgrAck(){ try{ localStorage.setItem('tps_shop_od_ack_'+(_me().id||''), _todayIso()); }catch(e){} _noticesRefresh(); }
function shopNoticeOpen(id){
  const o=getShop('shopOrders',id);
  if(o){ const cu=_me(); if(o.byId===cu.id && o.status!=='offen' && o.status!=='inarbeit') shopNoticeAck(id); else if(canManage()) shopNoticeSeen(id); }
  TAB='bestellungen'; fOrd='alle';
  try{ window.switchModule && window.switchModule('shop'); }catch(e){}
}
function shopNoticeSeen(id){
  const o=getShop('shopOrders',id); const cu=_me(); if(!o||!cu.id) return;
  if(!o.seenBy||typeof o.seenBy!=='object') o.seenBy={};
  o.seenBy[cu.id]=Date.now(); saveShop('shopOrders', o);
  try{ window.renderZeNotices&&window.renderZeNotices(); }catch(e){}
}
function shopNoticeAck(id){
  const o=getShop('shopOrders',id); if(!o) return;
  o.ackOrderer=true; saveShop('shopOrders', o);
  try{ window.renderZeNotices&&window.renderZeNotices(); }catch(e){}
}

Object.assign(window, { renderShop, shopTab, shopSetQ, shopSetCat, shopSetPlace, shopSetOrd, shopSetLogItem,
  shopItemEdit, shopItemSave, shopItemDelete, shopPhotoPick, shopPhotoClear,
  shopBook, shopBookSave, shopMove, shopMoveSave,
  shopOrderNew, shopOrderItemChg, shopOrderZielChg, shopOrderCrmChg, shopWhoChg, shopOrderSave, shopOrderStatus, shopOrderDone, shopOrderDoneSave,
  shopOrderIssue, shopOrderIssueSave, shopOrderCancel,
  shopPlaceEdit, shopPlaceSave, shopPlaceDelete,
  shopLoansForEntity, shopOpenBorrower, shopSend, shopSendSave, shopGetAddr, shopSaveAddr, shopOrderNameChg, shopSetOrg, shopPickItem,
  shopLend, shopLendSave, shopReturn, shopReturnSave, shopLoanDue, shopLoanDueSave, shopSetLoan,
  shopNotices, shopNoticeOpen, shopNoticeSeen, shopNoticeAck,
  shopLoanNoticeOpen, shopLoanAck, shopLoanSnooze, shopLoanMgrAck });
