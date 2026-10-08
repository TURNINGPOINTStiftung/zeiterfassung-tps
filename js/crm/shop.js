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
const PLACE_TYPES={ buero:{i:'🏢',l:'Büro'}, bus:{i:'🚐',l:'Bus / Fahrzeug'}, boot:{i:'⛵',l:'Boot'}, lager:{i:'📦',l:'Lager'}, anhaenger:{i:'🚛',l:'Anhänger / Trailer'}, sonst:{i:'📍',l:'Sonstiges'} };
const STATUS={
  offen:     {l:'Offen',          c:'#d97706'},
  inarbeit:  {l:'In Bearbeitung', c:'#2563eb'},
  ausgegeben:{l:'Ausgegeben',     c:'#16a34a'},
  erledigt:  {l:'Erledigt',       c:'#16a34a'},
  abgelehnt: {l:'Abgelehnt',      c:'#c0392b'},
};
const LOG_T={ zugang:'➕ Zugang', abgang:'➖ Abgang', korrektur:'✎ Korrektur', umlagern:'⇄ Umlagern', ausgabe:'📦 Ausgabe', verleih:'🔁 Verliehen', rueckgabe:'↩ Rückgabe', versand:'📤 Verschickt', verbrauch:'🔻 Verbrauch gemeldet', termin:'✅ Termin erledigt', zuordnung:'👤 Zuordnung' };

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
// Zuordnen/Ausleihen gibt es für: Artikel-Mengen (itemId+qty) · ein einzelnes Stück (itemId+unitId, qty 1,
// Stück liegt dann an keinem Ort) · einen beweglichen ORT selbst (placeId; Bus, Boot, Anhänger – der Inhalt
// fährt mit und bleibt am Ort gebucht). Ohne Rückgabedatum = Dauerzuordnung.
const MOVABLE=['bus','boot','anhaenger'];
function isMovable(p){ return !!(p && MOVABLE.includes(p.typ)); }
// Zwei Arten (User-Vorgabe): ZUORDNUNG = dauerhaft einem Mitarbeiter (verantwortlich, „gehört zu"),
// AUSLEIHE = zeitweise (mit Datum oder Dauerleihe) an wen auch immer. Ein Boot kann Jörg zugeordnet UND
// gleichzeitig an einen Verein ausgeliehen sein. Ältere Einträge: dauerhaft an Mitarbeiter = Zuordnung.
function isZuord(l){ return !!l && (l.zuord===true || (l.zuord===undefined && !l.due && !!l.borrowerId)); }
function placeZuord(pid){ return pid ? loans().find(l=>l.status==='aktiv' && l.placeId===pid && isZuord(l))||null : null; }
function placeLeihe(pid){ return pid ? loans().find(l=>l.status==='aktiv' && l.placeId===pid && !isZuord(l))||null : null; }
function placeLoan(pid){ return placeLeihe(pid)||placeZuord(pid); }   // „wo ist es gerade" – Ausleihe vor Zuordnung
function unitLoan(uid){ return uid ? loans().find(l=>l.status==='aktiv' && l.unitId===uid)||null : null; }
function loanIcon(l){ return l.placeId ? '🚩' : (l.unitId ? '🏷️' : (isZuord(l)?'👤':'🔁')); }
const _ZUORD_C='#7c3aed';
// Was ist mir (als Ausleiher/Zugeordneter) gerade zugeordnet? → bekomme die Mitteilungen dazu (User-Vorgabe)
function myHeld(){ const me=_me(); const ls=activeLoans().filter(l=>me.id && l.borrowerId===me.id);
  return { places:new Set(ls.filter(l=>l.placeId).map(l=>l.placeId)), units:new Set(ls.filter(l=>l.unitId).map(l=>l.unitId)) }; }
function dueHeld(d, h){ h=h||myHeld(); return (d.placeId && h.places.has(d.placeId)) || (d.kind==='unit' && h.units.has(d.unitId)); }
function _logPlace(p, type, note){ const cu=_me();
  return saveShop('shopLog',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:null, itemName:placeLabel(p.id), type, qty:1, from:p.id, to:null, note:note||'', orderId:null }); }
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
// ── Artikelarten + Soll-Bestand je Ort (Paket 2) ──
// verbrauch = bestellbar, wird verbraucht · leihe = wird verliehen, kommt zurück ·
// ausstattung = gehört fest an einen Ort (Boots-Equipment, Erste-Hilfe …), wird nur verbraucht + nachgefüllt
const ARTEN={
  verbrauch:  {i:"📦", l:"Verbrauchsmaterial", d:"wird verbraucht und bestellt (Flyer, Visitenkarten, Erste Hilfe …) – mit Soll an einem Ort ist es dort zusätzlich fester Bestand"},
  leihe:      {i:"🔁", l:"Leihmaterial", d:"wird verliehen und kommt zurück (Werkzeug, Beachflags, Aufsteller …)"},
  ausstattung:{i:"🧰", l:"Ausstattung (fest am Ort)", d:"gehört NUR an einen Ort, wird nie bestellt oder verliehen, nur verbraucht und nachgefüllt (Anker, Paddel, Boots-Equipment …)"},
};
function itemArt(it){ return it && ARTEN[it.art] ? it.art : (it && it.leihbar ? "leihe" : "verbrauch"); }
function sollAt(it,pid){ return _num(((it&&it.soll)||{})[pid]); }
// Orte, an denen der Ist-Bestand unter dem Soll liegt → [{pid, ist, soll, fehlt}]
function shortages(it){
  return Object.keys((it&&it.soll)||{}).filter(pid=>placeOf(pid) && sollAt(it,pid)>0 && _num((it.stock||{})[pid])<sollAt(it,pid))
    .map(pid=>{ const ist=_num((it.stock||{})[pid]), soll=sollAt(it,pid); return {pid, ist, soll, fehlt:soll-ist}; });
}
// Fester Bestand: Ein Ort mit Soll-Bestand gilt für diesen Artikel als „fest ausgestattet" (z. B. Erste Hilfe
// auf Boot Rot). Dort kann jeder Verbrauch melden; beim Ausgeben/Verschicken wird nur der Überschuss über
// dem Soll angeboten, Orte ohne Soll (Büro) zuerst. So bleibt derselbe Artikel im Büro normal bestellbar.
function freeAt(it,pid){ return Math.max(0, _num(((it&&it.stock)||{})[pid])-sollAt(it,pid)); }
function freeTotal(it){ return Object.keys((it&&it.stock)||{}).reduce((s,p)=>s+freeAt(it,p),0); }
function srcPlaces(it, excl){ return Object.keys((it&&it.stock)||{}).filter(p=>p!==excl && freeAt(it,p)>0)
  .sort((a,b)=>((sollAt(it,a)>0)-(sollAt(it,b)>0)) || (freeAt(it,b)-freeAt(it,a))); }
function srcLabel(it,p){ const s=sollAt(it,p); return placeLabel(p)+(s?` (${freeAt(it,p)} frei · Soll ${s})`:` (${_num(it.stock[p])})`); }
// Wo darf „➖ Verbrauch" gemeldet werden? Ausstattung: überall · sonst: Orte mit Soll
function usePlaces(it){ const all=itemArt(it)==='ausstattung'; return Object.keys((it&&it.stock)||{}).filter(p=>_num(it.stock[p])>0 && (all || sollAt(it,p)>0)); }
// ── Teams (aus der Zeiterfassung: Akademie, Verwaltung …) ──
// Artikel und Orte können einem Team gehören. Angezeigt wird weiter alles für alle; Mitteilungen
// und Zähler an den Reitern gelten aber nur für Mitglieder dieses Teams (User-Vorgabe, gilt auch für
// Verwalter). Ohne Team = für alle. Wer selbst keinem Team angehört, bekommt weiter alles.
function teamList(){ let t=[]; try{ t=(getData().teams||[]).slice(); }catch(e){}
  items().forEach(i=>{ if(i.team && !t.includes(i.team)) t.push(i.team); }); places().forEach(p=>{ if(p.team && !t.includes(p.team)) t.push(p.team); });
  return t.filter(Boolean); }
function myTeams(){ const cu=_me(); const t=Array.isArray(cu.teams)&&cu.teams.length?cu.teams:(cu.team?[cu.team]:[]); return t.filter(Boolean); }
function placeTeam(pid){ const p=pid&&placeOf(pid); return (p&&p.team)||''; }
function _teamOfItemAt(it,pid){ return (it&&it.team)||placeTeam(pid); }
// Teams einer Sache: [] bzw. '' darin = betrifft alle
function dueTeams(d){ if(d.kind==='place') return [placeTeam(d.placeId)]; return [_teamOfItemAt(getShop('shopItems',d.itemId), d.placeId)]; }
function orderTeams(o){ return _pos(o).map(p=>_teamOfItemAt(p.itemId?getShop('shopItems',p.itemId):null, o.ortId)); }
// Artikel: eigenes Team, sonst Teams der Orte, wo er liegt oder ein Soll hat ('' = für alle)
function itemTeams(it){ if(it.team) return [it.team];
  const pids=[...new Set([...Object.keys(it.stock||{}).filter(pid=>_num(it.stock[pid])>0), ...Object.keys(it.soll||{}).filter(pid=>sollAt(it,pid)>0)])];
  const ts=pids.map(placeTeam); return ts.length?ts:['']; }
function loanTeams(l){ if(l.placeId) return [placeTeam(l.placeId)]; return [_teamOfItemAt(getShop('shopItems',l.itemId), l.fromPlace)]; }
function forMe(teams){ const mine=myTeams(); if(!mine.length) return true; const ts=(teams||[]); if(!ts.length||ts.some(t=>!t)) return true; return ts.some(t=>mine.includes(t)); }
// Anzeige-Filter (Bestand, Bestellungen, Fällig): '' = alle, 'mine' = mein Team, sonst Teamname
let fTeam='';
function _teamMatch(teams){ if(!fTeam) return true; if(fTeam==='mine') return forMe(teams); return (teams||[]).includes(fTeam); }
function _teamFilterHtml(){ const ts=teamList(); if(!ts.length) return '';
  return `<select onchange="shopSetTeam(this.value)" title="Nach Team filtern"><option value="">Alle Teams</option>${myTeams().length?`<option value="mine"${fTeam==='mine'?' selected':''}>👥 Mein Team</option>`:''}${ts.map(t=>`<option${fTeam===t?' selected':''}>${esc(t)}</option>`).join('')}</select>`; }
function shopSetTeam(v){ fTeam=v; renderShop(); }
function _teamChip(t){ return t?`<span class="shop-cat" style="background:#ede9fe;color:#5b21b6">👥 ${esc(t)}</span>`:''; }
function _teamSelectHtml(id, cur, hint){ return `<div class="shop-f"><label>Team <span style="font-weight:400;color:var(--muted)">(${hint})</span></label>
  <select id="${id}"><option value="">– für alle –</option>${teamList().map(t=>`<option${cur===t?' selected':''}>${esc(t)}</option>`).join('')}</select></div>`; }
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
  .shop-h{font-size:20px;font-weight:700;color:var(--primary,#203869);margin:0 0 4px}
  .shop-sub{font-size:13px;color:var(--muted);margin:0 0 12px}
  .shop-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;border-bottom:2px solid var(--border)}
  .shop-tabs button{border:none;background:none;padding:8px 14px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
  .shop-tabs button.on{color:var(--primary,#203869);border-bottom-color:var(--primary,#203869)}
  .shop-badge{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:#d97706;color:#fff;font-size:11px;line-height:18px;text-align:center;margin-left:4px}
  .shop-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  .shop-bar input,.shop-bar select{padding:6px 8px;font-size:13px;border:1.5px solid var(--border);border-radius:6px;background:var(--card,#fff);color:var(--text)}
  .shop-bar input[type=search]{flex:1;min-width:160px}
  .shop-sp{flex:1}
  .shop-btn{padding:6px 12px;font-size:13px;border-radius:6px;border:1.5px solid var(--border);background:var(--card,#fff);color:var(--text);cursor:pointer;font-weight:600;white-space:nowrap}
  .shop-btn.pri{background:var(--primary,#203869);border-color:var(--primary,#203869);color:#fff}
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
  .shop-tot{font-size:22px;font-weight:700;color:var(--primary,#203869)}
  .shop-tot small{font-size:12px;font-weight:600;color:var(--muted)}
  .shop-low{font-size:12px;font-weight:700;color:#e5484d}
  .shop-pl{display:flex;flex-wrap:wrap;gap:4px}
  .shop-pl span{font-size:12px;padding:2px 7px;border-radius:6px;background:#f1f4f8;color:#2c3e50}
  .shop-pl span.hl{background:#dbe6fb;font-weight:700}
  .shop-pl span.short{background:#fdecea;color:#c0392b}
  .shop-pl span.lent{background:#eef2ff;color:#1e40af}
  .shop-pl span.lent.late{background:#fdecea;color:#c0392b;font-weight:700}
  .shop-act{display:flex;gap:5px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
  .shop-empty{color:var(--muted);font-size:14px;padding:24px 0;text-align:center}
  .shop-list{display:flex;flex-direction:column;gap:8px}
  .shop-row{background:var(--card,#fff);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .shop-row .main{flex:1;min-width:220px}
  .shop-row .t{font-weight:700;font-size:14px;color:var(--text)}
  .shop-row .m{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.5}
  .shop-row-done{padding:7px 12px;opacity:.92}
  .shop-det summary{cursor:pointer;font-size:12px;color:var(--primary,#203869);margin-top:3px}
  .shop-det[open] summary{margin-bottom:2px}
  .shop-st{display:inline-block;font-size:11px;font-weight:700;color:#fff;padding:2px 8px;border-radius:9px}
  .shop-late{color:#c0392b;font-weight:700}
  .shop-seg{display:inline-flex;border:1.5px solid var(--border);border-radius:7px;overflow:hidden}
  .shop-seg button{border:none;background:var(--card,#fff);padding:5px 11px;font-size:12px;cursor:pointer;color:var(--text)}
  .shop-seg button.on{background:var(--primary,#203869);color:#fff}
  .shop-f{margin-bottom:10px}
  .shop-f label{display:block;font-size:12px;font-weight:600;margin-bottom:3px}
  .shop-f input,.shop-f select,.shop-f textarea{width:100%;box-sizing:border-box;padding:6px 8px;font-size:14px;border:1.5px solid var(--border);border-radius:6px}
  .shop-f2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .shop-ph{width:110px;height:110px;border-radius:8px;border:1.5px dashed var(--border);background:#f6f8fa center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;text-align:center}
  .shop-log td,.shop-log th{padding:5px 8px;font-size:12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
  .shop-log{width:100%;border-collapse:collapse;background:var(--card,#fff)}
  .shop-pos{display:flex;flex-direction:column;gap:4px;border:1.5px solid var(--border);border-radius:8px;padding:6px;margin-bottom:6px;max-height:40vh;overflow-y:auto}
  .shop-pos-row,.shop-cart-row{display:flex;gap:6px;align-items:center}
  .shop-pos-row .nm,.shop-cart-row .nm{flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere}
  .shop-pos-row input[type=number],.shop-cart-row input{width:64px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px}
  .shop-pos-row select{max-width:170px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:12px}
  .shop-posadd{display:flex;gap:6px;align-items:center;margin-top:4px}
  .shop-posadd select,.shop-posadd input:not([type=number]){flex:1;min-width:0;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px}
  .shop-posadd input[type=number]{padding:6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px}
  .shop-cart{position:fixed;left:18px;bottom:18px;width:340px;max-width:calc(100vw - 24px);max-height:70vh;display:flex;flex-direction:column;background:var(--card,#fff);border:1.5px solid var(--border);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);z-index:55}
  .shop-cart.min{width:auto;background:none;border:none;box-shadow:none}
  .shop-cart-pill{background:var(--primary,#203869);color:#fff;border:none;border-radius:22px;padding:10px 16px;font-size:14px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.2)}
  .shop-cart-h{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border)}
  .shop-cart-list{overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
  .shop-cart-free{padding:0 12px 8px}
  .shop-cart-free input{width:100%;box-sizing:border-box;padding:6px 8px;border:1.5px dashed var(--border);border-radius:6px;font-size:13px}
  .shop-cart-act{display:flex;gap:6px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid var(--border)}
  .shop-cart-act .shop-btn{flex:1}
  @media(max-width:640px){ .shop-wrap{padding:12px 12px 90px} .shop-f2{grid-template-columns:1fr} .shop-grid{grid-template-columns:1fr}
    .shop-cart{right:8px;left:8px;bottom:8px;width:auto;max-height:65vh} .shop-cart.min{right:auto}
    .shop-pos-row{flex-wrap:wrap} .shop-pos-row select{max-width:none;flex:1} }
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
    if(!mgr && (TAB==='orte'||TAB==='verlauf'||TAB==='nachfuellen')) TAB='bestand';
    const held=myHeld();
    const myDue = allDue().filter(d=>forMe(dueTeams(d)) || dueHeld(d,held));   // Zähler nur fürs eigene Team + was mir zugeordnet ist
    const nDue = myDue.filter(d=>d.t.datum<=_soonIso(30)).length;
    const nOverDue = myDue.filter(d=>d.t.datum<_todayIso()).length;
    _autoReorder();   // Orte unter Soll → automatische Bestellung (statt Nachfüll-Liste)
    if(TAB==='nachfuellen') TAB='bestellungen';
    const os=orders();
    const nOpen = mgr ? os.filter(o=>o.status==='offen' && (forMe(orderTeams(o)) || held.places.has(o.ortId))).length
      : os.filter(o=>(o.byId===me.id || held.places.has(o.ortId)) && (o.status==='offen'||o.status==='inarbeit')).length;
    const myLoans=activeLoans().filter(l=>!isZuord(l) && (mgr ? (l.borrowerId===me.id || forMe(loanTeams(l))) : l.borrowerId===me.id));   // Zuordnungen zählen nicht als offene Ausleihe
    const nLate=myLoans.filter(_overdue).length;
    const tabs=[['bestand','📦 Bestand'],['bestellungen','🛒 Bestellungen'+(nOpen?`<span class="shop-badge">${nOpen}</span>`:'')],
      ['ausleihen','🔁 Ausleihen'+(myLoans.length?`<span class="shop-badge" style="background:${nLate?'#c0392b':'#2563eb'}">${myLoans.length}</span>`:'')]]
      .concat([['faellig','⏰ Fällig'+(nDue?`<span class="shop-badge" style="background:${nOverDue?'#c0392b':'#d97706'}">${nDue}</span>`:'')]])
      .concat(mgr?[['orte','📍 Orte'],['verlauf','📜 Verlauf']]:[]);
    let body='';
    if(TAB==='bestand') body=_bestandHtml(mgr);
    else if(TAB==='bestellungen') body=_ordersHtml(mgr);
    else if(TAB==='ausleihen') body=_loansHtml(mgr);
    else if(TAB==='faellig') body=_dueHtml(mgr);
    else if(TAB==='orte') body=_orteHtml();
    else body=_verlaufHtml();
    root.innerHTML=`<div class="shop-wrap">
      <div class="shop-h">🛒 Shop</div>
      <p class="shop-sub">Was liegt wo – und was wird gebraucht? ${mgr?'Du verwaltest den Shop.':'Bestelle hier Material, Werbemittel und Werkzeug.'}</p>
      <div class="shop-tabs">${tabs.map(t=>`<button class="${TAB===t[0]?'on':''}" onclick="shopTab(${jsq(t[0])})">${t[1]}</button>`).join('')}</div>
      ${body}
    </div><div id="shop-cart"></div>`;
    _cartPaint();
  }catch(e){ console.error('renderShop Fehler:',e); }
}
function shopTab(t){ TAB=t; renderShop(); }
// Zurück-Taste (js/nav.js): Reiter gehört zum „Ort" in der App
try{ (window._navRegs=window._navRegs||{}).shop={ get:()=>({t:TAB}), set:s=>{ if(s&&s.t) TAB=s.t; }, path:s=>s.t, parse:p=>({t:String(p).split('/')[0]}) }; }catch(e){}

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
      ${_teamFilterHtml()}
      <span class="shop-sp"></span>
      <button class="shop-btn pri" onclick="shopItemEdit('')">＋ Artikel</button>
    </div>
    <div id="shop-items">${_itemsGrid(mgr)}</div>`;
}
function _itemsGrid(mgr){
  const q=fQ.trim().toLowerCase();
  const list=items().filter(it=>{
    if(fCat && it.kategorie!==fCat) return false;
    if(fTeam && !_teamMatch(itemTeams(it))) return false;
    if(fPlace.startsWith('loan:')){ if(!activeLoans(it.id).some(l=>'loan:'+bKey(l)===fPlace)) return false; }
    else if(fPlace && !_num((it.stock||{})[fPlace]) && !sollAt(it,fPlace)) return false;   // auch Orte mit Soll, wo gerade 0 liegt
    if(q && !(`${it.name} ${it.variante||''} ${it.kategorie||''} ${it.note||''}`.toLowerCase().includes(q))) return false;
    return true;
  });
  if(!list.length) return `<div class="shop-empty">${items().length?'Keine Artikel für diesen Filter.':(mgr?'Noch keine Artikel. Lege den ersten mit „＋ Artikel" an.':'Noch keine Artikel im Shop.')}</div>`;
  return `<div class="shop-grid">${list.map(it=>{
    const tot=total(it); const low=_num(it.min)>0 && tot<_num(it.min);
    const art=itemArt(it); const short=shortages(it);
    // Orte mit Bestand ODER Soll-Bestand; „ist / soll" + ⚠, wenn darunter
    const pids=[...new Set([...Object.keys(it.stock||{}).filter(pid=>_num(it.stock[pid])>0), ...Object.keys(it.soll||{}).filter(pid=>placeOf(pid)&&sollAt(it,pid)>0)])];
    const pl=pids.sort((a,b)=>placeLabel(a).localeCompare(placeLabel(b),'de'))
      .map(pid=>{ const ist=_num((it.stock||{})[pid]), s=sollAt(it,pid), under=s>0&&ist<s;
        return `<span class="${fPlace===pid?'hl':''}${under?' short':''}" ${under?`title="Soll ${s} – es fehlen ${s-ist}"`:''}>${esc(placeLabel(pid))}: <b>${ist}</b>${s?` / ${s}`:''}${under?' ⚠':''}</span>`; }).join('');
    const img=it.foto?`<div class="shop-img" style="background-image:url('${it.foto}')"></div>`:`<div class="shop-img">${_catIcon(it.kategorie)}</div>`;
    const ln=activeLoans(it.id);
    const lnHtml=ln.map(l=>`<span class="lent${_overdue(l)?' late':''}${fPlace==='loan:'+bKey(l)?' hl':''}" title="${esc(l.anlass||'')}">${esc(bLabel(l))}: <b>${_num(l.qty)}</b>${l.due?' bis '+_fmtDate(l.due):' (dauerhaft)'}</span>`).join('');
    const avail=inPlaces(it);
    return `<div class="shop-card${(low||short.length)?' low':''}">${img}<div class="shop-cb">
      <div style="display:flex;gap:4px;flex-wrap:wrap">${it.kategorie?`<span class="shop-cat">${esc(it.kategorie)}</span>`:''}${art==='leihe'?'<span class="shop-cat" style="background:#dbe6fb;color:#1e40af">🔁 Leihmaterial</span>':''}${art==='ausstattung'?'<span class="shop-cat" style="background:#e8f5e9;color:#1b5e20">🧰 Ausstattung</span>':''}${_teamChip(it.team)}</div>
      <div class="shop-name">${esc(it.name)}</div>
      ${it.variante?`<div class="shop-var">${esc(it.variante)}</div>`:''}
      <div class="shop-tot">${tot} <small>${esc(it.einheit||'Stück')} gesamt${ln.length?` · ${avail} verfügbar`:''}</small></div>
      ${low?`<div class="shop-low">⚠ Unter Mindestbestand (${_num(it.min)}) – nachbestellen</div>`:''}
      ${short.length?`<div class="shop-low">⚠ Unter Soll: ${short.map(s=>`${esc(placeLabel(s.pid))} (${s.ist}/${s.soll})`).join(', ')} · 🤖 automatisch bestellt</div>`:''}
      <div class="shop-pl">${pl||(ln.length?'':'<span style="color:var(--muted)">kein Bestand</span>')}${lnHtml}</div>
      ${it.note?`<div class="shop-var">${esc(it.note)}</div>`:''}
      ${isEinzeln(it)?(()=>{ const ts=unitsOf(it).flatMap(u=>(u.termine||[]).map(t=>t)); const nt=nextTermin(ts);
        const nOver=ts.filter(t=>t.datum&&t.datum<_todayIso()).length;
        return `<div class="shop-var">🏷️ ${unitsOf(it).length} Stück${unitsOf(it).length===1?'':'e'} einzeln erfasst${nt?' · nächster Termin ':''}${nt?dueBadge(nt):''}${nOver>1?` <b style="color:#c0392b">(${nOver} überfällig)</b>`:''}</div>`; })():''}
      <div class="shop-act">
        ${art!=='ausstattung'&&!isEinzeln(it)?`<button class="shop-btn sm pri" onclick="shopCartAdd(${jsq(it.id)})" title="In den Korb legen">${art==='leihe'?'🔁':'🛒'} ＋</button>`:''}
        ${!isEinzeln(it)&&usePlaces(it).length||isEinzeln(it)&&art==='ausstattung'&&inPlaces(it)>0?`<button class="shop-btn sm" onclick="shopUse(${jsq(it.id)})" title="Etwas wurde verbraucht (z. B. Erste-Hilfe-Päckchen benutzt)">➖ Verbrauch</button>`:''}
        ${mgr&&art==='ausstattung'&&!isEinzeln(it)&&inPlaces(it)>0?`<button class="shop-btn sm" onclick="shopLend(${jsq(it.id)})" title="Einem Mitarbeiter / Verein zuordnen">🔁 Zuordnen</button>`:''}
        ${mgr&&isEinzeln(it)?`<button class="shop-btn sm" onclick="shopUnits(${jsq(it.id)})">🏷️ Stücke (${unitsOf(it).length})</button>`:''}
        ${mgr&&!isEinzeln(it)?`<button class="shop-btn sm" onclick="shopBook(${jsq(it.id)})">± Buchen</button>
        <button class="shop-btn sm" onclick="shopMove(${jsq(it.id)})">⇄ Umlagern</button>`:''}
        ${mgr?`<button class="shop-btn sm" onclick="shopItemEdit(${jsq(it.id)})">✎</button>`:''}
      </div></div></div>`;
  }).join('')}</div>`;
}
function _catIcon(c){ return ({'Flaggen':'🚩','Flyer':'📄','Branding':'🎨','Visitenkarten':'🪪','Bootsmaterial':'⛵','Werkzeug':'🛠️'})[c]||'📦'; }
function shopSetQ(v){ fQ=v; const g=document.getElementById('shop-items'); if(g) g.innerHTML=_itemsGrid(canManage()); }
function shopSetCat(v){ fCat=v; renderShop(); }
function shopSetPlace(v){ fPlace=v; renderShop(); }

// ── Artikel anlegen / bearbeiten ───────────────────────────────────
function shopItemEdit(id){
  // Neu anlegen dürfen alle mit Shop-Zugang, Bearbeiten/Löschen nur Verwalter
  if(id ? !canManage() : !canUse()) return;
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
    ${_teamSelectHtml('si-team', v.team||'', 'nur dieses Team bekommt Mitteilungen & Zähler – leer = Team des Orts bzw. alle')}
    <div class="shop-f"><label>Artikelart</label>
      ${Object.keys(ARTEN).map(k=>`<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:3px 0;cursor:pointer;font-weight:400">
        <input type="radio" name="si-art" value="${k}" ${itemArt(v)===k?'checked':''} style="width:auto;margin-top:2px"><span><b>${ARTEN[k].i} ${ARTEN[k].l}</b> – ${ARTEN[k].d}</span></label>`).join('')}</div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:0 0 10px;cursor:pointer"><input type="checkbox" id="si-einzeln" ${v.einzeln?'checked':''} style="width:auto;margin-top:2px">
      <span><b>🏷️ Einzeln erfassen</b> – jedes Stück mit eigener Bezeichnung, Ort und eigenen Terminen (Ablaufdatum, Prüfung …), z. B. Rettungswesten, Erste-Hilfe-Päckchen. Vorhandener Bestand wird dabei automatisch in Stücke umgewandelt.</span></label>
    ${pls.length?`<div class="shop-f"><label>Soll-Bestand je Ort <span style="font-weight:400;color:var(--muted)">(optional – fester Bestand dort: jeder kann Verbrauch melden, darunter wird automatisch nachbestellt; ausgegeben wird nur, was darüber liegt)</span></label>
      <div class="shop-f2">${pls.map(p=>`<div><span style="font-size:12px">${esc(placeLabel(p.id))}</span><input type="number" min="0" step="1" class="shop-soll" data-pl="${esc(p.id)}" placeholder="–" value="${_num((v.soll||{})[p.id])||''}"></div>`).join('')}</div></div>`:''}
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
  if(id ? !canManage() : !canUse()) return;
  const name=_val('si-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const ex=id?getShop('shopItems',id):null; const cu=_me();
  const it=Object.assign({}, ex||{ id:newId(), stock:{}, createdAt:Date.now(), createdById:cu.id||'', createdByName:cu.name||'' }, {
    name, kategorie:_val('si-cat'), variante:_val('si-var'), einheit:_val('si-unit')||'Stück',
    min:_val('si-min')===''?'':_num(_val('si-min')), note:_val('si-note'), team:_val('si-team'), foto:window._shopPhoto||'' });
  // Artikelart (leihbar bleibt als abgeleitetes Feld für ältere Stellen erhalten) + Soll-Bestand je Ort
  const artEl=document.querySelector('input[name="si-art"]:checked'); it.art=artEl?artEl.value:itemArt(it); it.leihbar=(it.art==='leihe');
  const soll={}; document.querySelectorAll('.shop-soll').forEach(inp=>{ const n=Math.round(_num(inp.value)); if(n>0) soll[inp.dataset.pl]=n; });
  it.soll=soll;
  const inits=[];
  if(!ex) document.querySelectorAll('.shop-init').forEach(inp=>{ const q=Math.round(_num(inp.value)); if(q>0){ _applyDelta(it, inp.dataset.pl, q); inits.push([inp.dataset.pl,q]); } });
  // Einzeln erfassen: beim Einschalten den vorhandenen Bestand in Stücke umwandeln (Bestand bleibt gleich)
  const wantEinzeln=!!(document.getElementById('si-einzeln')||{}).checked;
  let made=0;
  if(wantEinzeln){
    if(!it.units||typeof it.units!=='object') it.units={};
    const have={}; Object.values(it.units).forEach(u=>{ have[u.placeId]=(have[u.placeId]||0)+1; });
    let nr=Object.keys(it.units).length;
    Object.keys(it.stock||{}).forEach(pid=>{ const miss=_num(it.stock[pid])-(have[pid]||0);
      for(let i=0;i<miss;i++){ const id=newId(); nr++; it.units[id]={ id, nr:it.name+' '+String(nr).padStart(2,'0'), serial:'', placeId:pid, note:'', termine:[] }; made++; } });
    it.einzeln=true; _syncStock(it);
  } else it.einzeln=false;
  saveShop('shopItems', it);
  inits.forEach(([pl,q])=>_log(it,'zugang',q,null,pl,'Anfangsbestand'));
  closeModal(); toast((ex?'Artikel gespeichert ✓':'Artikel angelegt ✓')+(made?` – ${made} Stück${made===1?'':'e'} angelegt, Termine unter „🏷️ Stücke"`:''),'ok');
  if(wantEinzeln && made) shopUnits(it.id); else renderShop();
}
function shopItemDelete(id){
  if(!canManage()) return;
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
function shopBook(id, preType, prePl, preQty){
{ const _it=getShop('shopItems',id); if(isEinzeln(_it)){ toast('Einzeln erfasster Artikel – Bestand über „🏷️ Stücke" (anlegen / ausmustern).','ok'); shopUnits(id); return; } }
  if(!canManage()) return;
  const it=getShop('shopItems',id); if(!it) return;
  if(!places().length){ toast('Bitte zuerst unter „📍 Orte" einen Ort anlegen.','err'); return; }
  openModal(`<h3>± Bestand buchen</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b> · gesamt ${total(it)} ${esc(it.einheit||'Stück')}</p>
    <div class="shop-f"><label>Art</label><select id="sb-type">
      <option value="zugang"${preType==='zugang'?' selected':''}>➕ Zugang (geliefert, gedruckt, gekauft)</option>
      <option value="abgang"${preType==='abgang'?' selected':''}>➖ Abgang (verbraucht, verteilt, kaputt)</option>
      <option value="korrektur"${preType==='korrektur'?' selected':''}>✎ Korrektur (gezählt – Bestand genau setzen)</option></select></div>
    <div class="shop-f2"><div class="shop-f"><label>Ort</label>${_placeSelect('sb-pl', prePl||fPlace, true, it)}</div>
      <div class="shop-f"><label>Menge</label><input id="sb-qty" type="number" min="0" step="1" placeholder="0" value="${preQty?esc(preQty):''}"></div></div>
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
function shopMove(id, preFrom, preTo, preQty){
{ const _it=getShop('shopItems',id); if(isEinzeln(_it)){ toast('Einzeln erfasster Artikel – Stücke unter „🏷️ Stücke" verschieben.','ok'); shopUnits(id); return; } }
  if(!canManage()) return;
  const it=getShop('shopItems',id); if(!it) return;
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0);
  if(!from.length){ toast('Kein Bestand zum Umlagern.','err'); return; }
  if(places().length<2){ toast('Zum Umlagern braucht es mindestens zwei Orte.','err'); return; }
  openModal(`<h3>⇄ Umlagern</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b></p>
    <div class="shop-f2"><div class="shop-f"><label>Von</label><select id="sm-from">${from.map(p=>`<option value="${esc(p)}"${(preFrom||fPlace)===p?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Nach</label>${_placeSelect('sm-to',preTo||'',true,it)}</div></div>
    <div class="shop-f2"><div class="shop-f"><label>Menge</label><input id="sm-qty" type="number" min="1" step="1" value="${preQty?esc(preQty):1}"></div>
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

// ── Verbrauch melden (ALLE mit Shop-Zugang – User-Entscheid) ───────
// z. B. „1 Erste-Hilfe-Päckchen auf Boot 1 benutzt" → Bestand am Ort sinkt, Verlauf + ggf. Nachfüllen
function shopUse(id){
{ const _it=getShop('shopItems',id); if(isEinzeln(_it)) return _unitUse(_it); }
  if(!canUse()) return;
  const it=getShop('shopItems',id); if(!it) return;
  const from=usePlaces(it);
  if(!from.length){ toast('Kein fester Bestand an einem Ort vorhanden.','err'); return; }
  const def=from.includes(fPlace)?fPlace:from[0];
  openModal(`<h3>➖ Verbrauch melden</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(itemLabel(it))}</b></p>
    <div class="shop-f2"><div class="shop-f"><label>Wo?</label><select id="su-pl">${from.map(p=>`<option value="${esc(p)}"${p===def?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Menge</label><input id="su-qty" type="number" min="1" step="1" value="1"></div></div>
    <div class="shop-f"><label>Notiz <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input id="su-note" placeholder="z. B. bei Kenterung benutzt, Training 12.10."></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopUseSave(${jsq(id)})">Verbrauch melden</button></div>`);
}
function shopUseSave(id){
  const it=getShop('shopItems',id); if(!it) return;
  const pl=_val('su-pl'), q=Math.round(_num(_val('su-qty'))), note=_val('su-note');
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, pl, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[pl])} vorhanden.`,'err'); return; }
  saveShop('shopItems', it); _log(it,'verbrauch',q,pl,null,note);
  const s=sollAt(it,pl), ist=_num((it.stock||{})[pl]);
  closeModal();
  toast(s&&ist<s?`Gemeldet ✓ – ${placeLabel(pl)} liegt jetzt unter Soll (${ist}/${s}) – Nachschub wurde automatisch bestellt.`:'Verbrauch gemeldet ✓', 'ok');
  renderShop();
}

// ── Automatische Bestellung bei Unterschreitung des Soll-Bestands (User-Vorgabe) ──
// Statt einer Nachfüll-Liste: Ort unter Soll → EINE Bestellung „🤖 Automatisch" JE ORT (User-Vorgabe:
// gebündelt), Lieferort = Ort, Positionen = alle dort fehlenden Artikel mit Fehlmenge.
// Deterministische ID je Ort+Laufnummer → mehrere Geräte erzeugen keine Dubletten.
// Offene Auto-Bestellung zieht mit (offen: exakt der aktuelle Fehlbestand; in Bearbeitung: nur ergänzen/
// erhöhen, nie wegnehmen); ist der Ort wieder voll, schließt sie sich selbst.
// Hat ein Verwalter sie von Hand erledigt/abgelehnt, kommt erst bei GRÖSSERER Gesamt-Fehlmenge eine neue.
let _autoBusy=false;
function _autoReorder(){
  if(_autoBusy || !canUse()) return; _autoBusy=true;
  try{
    const isOpen=o=>o.status==='offen'||o.status==='inarbeit';
    const byKey={}; orders().filter(o=>o.auto&&o.autoKey).forEach(o=>{ (byKey[o.autoKey]=byKey[o.autoKey]||[]).push(o); });
    const want={};   // placeId → [{it,s}]
    items().forEach(it=>shortages(it).forEach(s=>{ (want[s.pid]=want[s.pid]||[]).push({it,s}); }));
    const now=Date.now();
    const posOf=({it,s})=>({ itemId:it.id, itemName:itemLabel(it), freitext:'', menge:s.fehlt, einheit:it.einheit||'Stück', leihe:false });
    const sumF=list=>list.reduce((a,x)=>a+x.s.fehlt,0);
    const anlassOf=(pid,list)=>`Unter Soll-Bestand: ${placeLabel(pid)} – `+list.map(x=>`${x.it.name} ${x.s.ist}/${x.s.soll}`).join(', ');
    const sameP=(a,b)=>JSON.stringify(a.map(p=>[p.itemId,p.menge]))===JSON.stringify(b.map(p=>[p.itemId,p.menge]));
    const setPos=(o,pos)=>{ o.positionen=pos; const one=pos.length===1?pos[0]:null;
      o.itemId=one?one.itemId:null; o.itemName=one?one.itemName:''; o.menge=pos.reduce((a,p)=>a+_num(p.menge),0); o.einheit=one?one.einheit:''; };
    // 1) anlegen / nachziehen – je Ort
    Object.keys(want).forEach(pid=>{
      const need=want[pid]; const list=(byKey[pid]||[]).sort((a,b)=>(b.ts||0)-(a.ts||0));
      const open=list.find(isOpen);
      if(open){
        let pos;
        if(open.status==='offen') pos=need.map(posOf);
        else { pos=_pos(open).map(p=>Object.assign({},p));   // in Bearbeitung: nur ergänzen / erhöhen
          need.forEach(x=>{ const p=pos.find(q=>q.itemId===x.it.id); if(!p) pos.push(posOf(x)); else if(_num(p.menge)<x.s.fehlt) p.menge=x.s.fehlt; }); }
        if(!sameP(_pos(open),pos)){ setPos(open,pos); open.autoFehlt=sumF(need); open.anlass=anlassOf(pid,need); saveShop('shopOrders', open); }
        return;
      }
      const last=list[0];   // zuletzt geschlossene
      // von Hand erledigt/abgelehnt (und Ort seitdem nicht wieder voll gewesen) → erst bei größerer Fehlmenge neu
      if(last && last.closedBy!=='auto' && !last.resolved && sumF(need)<=_num(last.autoFehlt)) return;
      const id='auto_'+pid+'_'+list.length;
      if(getShop('shopOrders',id)) return;
      const o={ id, ts:now, byId:'auto', byName:'🤖 Automatisch', auto:true, autoKey:pid, autoFehlt:sumF(need),
        freitext:'', termin:'', anlass:anlassOf(pid,need), ortId:pid, ortText:'', note:'', ziel:'place', zielRef:null, zielName:'', zielUserId:null, adresse:'',
        leihe:false, rueckgabe:'', status:'offen', seenBy:{}, ackOrderer:true };
      setPos(o, need.map(posOf));
      saveShop('shopOrders', o);
    });
    // 2) wieder aufgefüllt → offene Auto-Bestellung schließen
    Object.keys(byKey).forEach(key=>{ if(want[key]) return;
      byKey[key].filter(isOpen).forEach(o=>{ Object.assign(o,{ status:'erledigt', closedBy:'auto', answer:'Soll-Bestand wieder erreicht – automatisch erledigt',
        handledById:'auto', handledByName:'🤖 Automatisch', handledTs:now }); saveShop('shopOrders', o); });
      // Ort war wieder voll → Sperre der zuletzt von Hand geschlossenen Auto-Bestellung aufheben
      const last=byKey[key].filter(o=>!isOpen(o)).sort((a,b)=>(b.ts||0)-(a.ts||0))[0];
      if(last && last.closedBy!=='auto' && !last.resolved){ last.resolved=true; saveShop('shopOrders', last); } });
  }catch(e){ console.warn('Auto-Bestellung:', e && e.message); }
  finally{ _autoBusy=false; }
}

// ── Nachfüllen-Daten (Gesamt-Mindestbestand für den Hinweis in „Bestellungen") ──
function _refillData(){
  const byPlace={}; let n=0;
  items().forEach(it=>shortages(it).forEach(s=>{ (byPlace[s.pid]=byPlace[s.pid]||[]).push(Object.assign({it},s)); n++; }));
  const lowTotal=items().filter(it=>_num(it.min)>0 && total(it)<_num(it.min));
  return { byPlace, n, lowTotal };
}

// ── Warenkorb (pro Person, im Browser) ─────────────────────────────
// Positionen: [{key, itemId|null, freitext, menge, from?}] – from = gewählter Quell-Ort beim Direktversand.
// Der Korb ist zugleich die Positionsliste in „Bestellen" und „Direkt verschicken" (eine Quelle).
let cartOpen=false;
function _cartKey(){ return 'tps_shop_cart_'+(_me().id||''); }
function cartGet(){ try{ const a=JSON.parse(localStorage.getItem(_cartKey())||'[]'); return Array.isArray(a)?a.filter(p=>p&&(p.itemId?getShop('shopItems',p.itemId):p.freitext)):[]; }catch(e){ return []; } }
function cartSet(a){ try{ localStorage.setItem(_cartKey(), JSON.stringify(a)); }catch(e){} _cartPaint(); _posPaint(); }
function _posLabel(p){ const it=p.itemId?getShop('shopItems',p.itemId):null; return it?itemLabel(it):(p.freitext||'?'); }
function shopCartAdd(itemId, qty){
  if(!canUse()) return;
  const it=getShop('shopItems',itemId); if(!it) return;
  if(isEinzeln(it)){ toast('Einzeln erfasste Artikel laufen über „🏷️ Stücke", nicht über den Korb.','err'); return; }
  if(itemArt(it)==='ausstattung'){ toast('Ausstattung ist fest am Ort und nicht bestellbar – fehlt etwas, bitte „➖ Verbrauch" melden.','err'); return; }
  const a=cartGet(); const p=a.find(x=>x.itemId===itemId);
  if(p) p.menge=_num(p.menge)+(qty||1); else a.push({key:newId(), itemId, menge:qty||1});
  cartOpen=true; cartSet(a); toast(`${itemLabel(it)} im Korb ✓`,'ok');
}
function shopCartAddFree(inpId){
  const t=_val(inpId||'pos-free'); if(!t){ toast('Bitte beschreiben, was gebraucht wird.','err'); return; }
  const a=cartGet(); a.push({key:newId(), itemId:null, freitext:t, menge:1}); cartSet(a);
  const el=document.getElementById(inpId||'pos-free'); if(el) el.value='';
}
function shopPosAddSel(){
  const id=_val('pos-item'), q=Math.max(1,Math.round(_num(_val('pos-qty'))||1)); if(!id) return;
  const a=cartGet(); const p=a.find(x=>x.itemId===id);
  if(p) p.menge=_num(p.menge)+q; else a.push({key:newId(), itemId:id, menge:q});
  cartSet(a); const s=document.getElementById('pos-item'); if(s) s.value=''; const n=document.getElementById('pos-qty'); if(n) n.value='1';
}
function shopCartQty(key,v){ const a=cartGet(); const p=a.find(x=>x.key===key); if(!p) return; p.menge=Math.max(1,Math.round(_num(v))||1); cartSet(a); }
function shopCartFrom(key,v){ const a=cartGet(); const p=a.find(x=>x.key===key); if(!p) return; p.from=v; try{ localStorage.setItem(_cartKey(), JSON.stringify(a)); }catch(e){} }
function shopCartDel(key){ cartSet(cartGet().filter(x=>x.key!==key)); }
function shopCartClear(){ if(cartGet().length && !confirm('Korb leeren?')) return; cartSet([]); }
function shopCartToggle(){ cartOpen=!cartOpen; _cartPaint(); }
// Schwebende Korb-Leiste (nur im Shop sichtbar, liegt im #shop-root)
function _cartPaint(){
  const box=document.getElementById('shop-cart'); if(!box) return;
  const a=cartGet(); const mgr=canManage();
  if(!a.length){ box.innerHTML=''; box.className=''; return; }
  const n=a.reduce((s,p)=>s+_num(p.menge),0);
  if(!cartOpen){ box.className='shop-cart min'; box.innerHTML=`<button class="shop-cart-pill" onclick="shopCartToggle()">🛒 Korb <b>${a.length}</b>${a.length!==n?` <span style="opacity:.8">(${n} Stück)</span>`:''}</button>`; return; }
  box.className='shop-cart';
  box.innerHTML=`<div class="shop-cart-h"><b>🛒 Korb</b> <span style="color:var(--muted);font-size:12px">${a.length} Position${a.length===1?'':'en'}</span><span class="shop-sp"></span>
      <button class="shop-btn sm" onclick="shopCartClear()" title="Korb leeren">🗑</button><button class="shop-btn sm" onclick="shopCartToggle()" title="Einklappen">▾</button></div>
    <div class="shop-cart-list">${a.map(p=>{ const it=p.itemId?getShop('shopItems',p.itemId):null;
      return `<div class="shop-cart-row"><span class="nm">${it&&it.leihbar?'🔁 ':''}${p.itemId?'':'✏️ '}${esc(_posLabel(p))}</span>
        <input type="number" min="1" step="1" value="${_num(p.menge)}" onchange="shopCartQty(${jsq(p.key)},this.value)">
        <button class="crm-x" style="border:none;background:none;color:#c0392b;cursor:pointer" onclick="shopCartDel(${jsq(p.key)})" title="Entfernen">✕</button></div>`; }).join('')}</div>
    <div class="shop-cart-free"><input id="cart-free" placeholder="＋ Freier Wunsch (nicht im Katalog) …" onkeydown="if(event.key==='Enter'){event.preventDefault();shopCartAddFree('cart-free');}"></div>
    <div class="shop-cart-act"><button class="shop-btn pri" onclick="shopOrderNew()">🛒 Bestellen …</button>
      ${mgr?`<button class="shop-btn" onclick="shopCartSend()" title="Ohne Bestellung direkt an Mitarbeiter, Verein oder andere schicken">📤 Direkt verschicken …</button>`:''}</div>`;
}
// Positionsliste im offenen Fenster (Bestellen: Menge · Direkt verschicken: zusätzlich Quell-Ort)
let _posMode='';
function _posEditorHtml(mode){
  _posMode=mode;
  const its=items().filter(i=>itemArt(i)!=='ausstattung' && !isEinzeln(i) && (mode!=='send'||freeTotal(i)>0));
  return `<div class="shop-f"><label>Positionen *</label><div id="shop-pos" class="shop-pos"></div>
    <div class="shop-posadd"><select id="pos-item"><option value="">＋ Artikel hinzufügen …</option>${its.map(i=>`<option value="${esc(i.id)}">${i.leihbar?'🔁 ':''}${esc(itemLabel(i))}${i.kategorie?' – '+esc(i.kategorie):''}${mode==='send'?` (${freeTotal(i)} verfügbar)`:''}</option>`).join('')}</select>
      <input id="pos-qty" type="number" min="1" step="1" value="1" style="width:70px"><button type="button" class="shop-btn sm" onclick="shopPosAddSel()">＋</button></div>
    ${mode==='order'?`<div class="shop-posadd"><input id="pos-free" placeholder="Freier Wunsch (nicht im Katalog), z. B. 200 Visitenkarten für mich" onkeydown="if(event.key==='Enter'){event.preventDefault();shopCartAddFree('pos-free');}"><button type="button" class="shop-btn sm" onclick="shopCartAddFree('pos-free')">＋</button></div>`:''}</div>`;
}
function _posPaint(){
  const box=document.getElementById('shop-pos'); if(!box) return;
  const a=cartGet().filter(p=>_posMode!=='send'||p.itemId);
  if(!a.length){ box.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">Noch keine Position – unten hinzufügen.</div>'; }
  else box.innerHTML=a.map(p=>{ const it=p.itemId?getShop('shopItems',p.itemId):null;
    let src='';
    if(_posMode==='send' && it){ const fr=srcPlaces(it);
      if(!p.from||!fr.includes(p.from)) p.from=fr[0]||'';
      src=fr.length?`<select onchange="shopCartFrom(${jsq(p.key)},this.value)" title="Aus Ort">${fr.map(x=>`<option value="${esc(x)}"${x===p.from?' selected':''}>${esc(srcLabel(it,x))}</option>`).join('')}</select>`
        :`<span style="font-size:12px;color:#c0392b">kein freier Bestand</span>`; }
    return `<div class="shop-pos-row"><span class="nm">${it&&it.leihbar?'🔁 ':''}${p.itemId?'':'✏️ '}${esc(_posLabel(p))}</span>${src}
      <input type="number" min="1" step="1" value="${_num(p.menge)}" onchange="shopCartQty(${jsq(p.key)},this.value)">
      <button type="button" class="crm-x" style="border:none;background:none;color:#c0392b;cursor:pointer" onclick="shopCartDel(${jsq(p.key)})">✕</button></div>`; }).join('');
  if(_posMode==='send'){ try{ localStorage.setItem(_cartKey(), JSON.stringify(cartGet().map(p=>{ const q=a.find(x=>x.key===p.key); return q?Object.assign(p,{from:q.from}):p; }))); }catch(e){} }
  // Bestellen: Leihmaterial im Korb → „Rückgabe bis" einblenden
  const leih=a.some(p=>{ const it=p.itemId?getShop('shopItems',p.itemId):null; return it&&it.leihbar; });
  const r=document.getElementById('so-ret-w'); if(r) r.style.display=leih?'':'none';
  const l=document.getElementById('so-date-l'); if(l) l.textContent=leih?'Gebraucht ab':'Bis wann?';
}

// ── Bestellen (mehrere Positionen aus dem Korb, EIN Ziel) ──────────
function shopOrderNew(itemId){
  if(!canUse()) return;
  if(itemId) { const a=cartGet(); if(!a.some(p=>p.itemId===itemId)) { a.push({key:newId(), itemId, menge:1}); try{ localStorage.setItem(_cartKey(), JSON.stringify(a)); }catch(e){} } }
  const pls=places();
  const plOpts=pls.map(p=>`<option value="${esc(p.id)}">${esc(placeLabel(p.id))}</option>`).join('');
  const ents=_crmEntities(); const byTree={};
  ents.forEach(x=>{ (byTree[x.tree]=byTree[x.tree]||{label:x.treeLabel,icon:x.icon,list:[]}).list.push(x); });
  const vOpts='<option value="">– bitte wählen –</option>'+Object.keys(byTree).map(k=>{ const g=byTree[k];
    return `<optgroup label="${esc(g.icon+' '+g.label)}">${g.list.sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'})).map(x=>`<option value="${esc(x.tree)}::${esc(x.eid)}">${esc(x.name)}</option>`).join('')}</optgroup>`; }).join('');
  openModal(`<h3>🛒 Bestellen / Bedarf melden</h3>
    ${_posEditorHtml('order')}
    <div class="shop-f2"><div class="shop-f"><label id="so-date-l">Bis wann?</label><input id="so-date" type="date" min="${_todayIso()}"></div>
      <div class="shop-f" id="so-ret-w" style="display:none"><label>🔁 Rückgabe bis * <span style="font-weight:400;color:var(--muted)">(für Leihmaterial)</span></label><input id="so-ret" type="date" min="${_todayIso()}"></div></div>
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
  _posPaint();
}
function shopOrderItemChg(){ _posPaint(); }   // (alt, bleibt für evtl. noch offene Fenster)
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
  const cart=cartGet();
  if(!cart.length){ toast('Bitte mindestens eine Position hinzufügen.','err'); return; }
  const positionen=cart.map(p=>{ const it=p.itemId?getShop('shopItems',p.itemId):null;
    return { itemId:it?it.id:null, itemName:it?itemLabel(it):'', freitext:it?'':(p.freitext||''), menge:Math.max(1,Math.round(_num(p.menge))||1), einheit:it?(it.einheit||'Stück'):'', leihe:!!(it&&it.leihbar) }; });
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
  const leih=positionen.some(p=>p.leihe); const ret=leih?_val('so-ret'):'';
  if(leih && !ret){ toast('Bitte angeben, bis wann das Leihmaterial zurückkommt.','err'); return; }
  if(leih && _val('so-date') && ret<_val('so-date')){ toast('Die Rückgabe liegt vor dem Startdatum.','err'); return; }
  const cu=_me(); const one=positionen.length===1?positionen[0]:null;
  saveShop('shopOrders',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'',
    positionen,
    // Einzel-Felder nur bei EINER Position (Abwärtskompatibilität mit älteren Ansichten)
    itemId:one?one.itemId:null, itemName:one?one.itemName:'', freitext:one?one.freitext:'', menge:one?one.menge:positionen.reduce((s,p)=>s+p.menge,0), einheit:one?one.einheit:'',
    termin:_val('so-date'), anlass:_val('so-anlass'), ortId:ort||null, ortText, note:_val('so-note'),
    ziel, zielRef, zielName, zielUserId, adresse,
    leihe:leih, rueckgabe:ret, status:'offen', seenBy:{}, ackOrderer:false });
  cartOpen=false; cartSet([]);
  closeModal(); toast('Bestellung abgeschickt ✓ – der Shop-Verwalter bekommt eine Mitteilung.','ok');
  TAB='bestellungen'; renderShop();
}

// ── Tab: Bestellungen ──────────────────────────────────────────────
// Positionen einer Bestellung – ältere Bestellungen (ein Artikel) als eine Position
function _pos(o){
  if(Array.isArray(o.positionen) && o.positionen.length) return o.positionen;
  return [{ itemId:o.itemId||null, itemName:o.itemName||'', freitext:o.freitext||'', menge:o.menge||1, einheit:o.einheit||'', leihe:!!o.leihe }];
}
function _posTxt(p){ const it=p.itemId?getShop('shopItems',p.itemId):null; return `${_num(p.menge)}× ${esc(it?itemLabel(it):(p.itemName||p.freitext||'?'))}`; }
function _orderWhat(o){
  const ps=_pos(o);
  if(ps.length===1) return _posTxt(ps[0]);
  return `${ps.length} Positionen: `+ps.slice(0,3).map(_posTxt).join(', ')+(ps.length>3?' …':'');
}
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
  let os=orders(); if(!mgr){ const hp=myHeld().places; os=os.filter(o=>o.byId===me.id || (o.ortId && hp.has(o.ortId))); }   // + Bestellungen für den Ort, der mir zugeordnet ist
  if(mgr && fTeam) os=os.filter(o=>_teamMatch(orderTeams(o)));
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
      const hasItem=_pos(o).some(p=>p.itemId);
      if(hasItem) btns.push(`<button class="shop-btn sm ok" onclick="shopOrderIssue(${jsq(o.id)})">📦 Ausgeben</button>`);
      btns.push(`<button class="shop-btn sm${hasItem?'':' ok'}" onclick="shopOrderDone(${jsq(o.id)},'erledigt')">✓ Erledigt</button>`);
      btns.push(`<button class="shop-btn sm warn" onclick="shopOrderDone(${jsq(o.id)},'abgelehnt')">✕ Ablehnen</button>`);
    }
    if(o.byId===me.id && o.status==='offen') btns.push(`<button class="shop-btn sm warn" onclick="shopOrderCancel(${jsq(o.id)})">Zurückziehen</button>`);
    const ps=_pos(o);
    const head = ps.length===1 ? _orderWhat(o) : `🧾 ${ps.length} Positionen`;
    const posList = ps.length>1 ? `<div class="m" style="margin:2px 0 3px">${ps.map(p=>`• ${_posTxt(p)}${p.leihe?' 🔁':''}`).join('<br>')}</div>` : '';
    const oTeams=[...new Set(orderTeams(o).filter(Boolean))]; const tChips=oTeams.map(_teamChip).join(' ');
    const badges=`${tChips} <span class="shop-st" style="background:${st.c}">${st.l}</span>${o.direkt?' <span class="shop-st" style="background:#6b7280">📤 direkt</span>':''}${o.auto?' <span class="shop-st" style="background:#6b21a8">🤖 automatisch</span>':''}`;
    // Abgeschlossen → kompakt: EINE Zeile je Bestellung, Positionen + Details zum Aufklappen
    if(!act(o)){
      const det=[o.anlass?`Anlass: ${esc(o.anlass)}`:'', o.adresse?`📮 ${esc(o.adresse).replace(/\n/g,', ')}`:'', o.note?`📝 ${esc(o.note)}`:'',
        o.handledByName?`Bearbeitet von ${esc(o.handledByName)} · ${_fmtTs(o.handledTs)}${o.fromPlace?` · aus ${esc(placeLabel(o.fromPlace))}`:''}`:'',
        o.answer?`💬 ${esc(o.answer)}`:''].filter(Boolean).join('<br>');
      return `<div class="shop-row shop-row-done"><div class="main">
        <div class="t" style="font-weight:600">${head} ${badges}</div>
        <div class="m">${mgr?`${esc(o.byName||'?')} · `:''}${_fmtTs(o.ts)}${where?` · nach: ${where}`:''}</div>
        <details class="shop-det"><summary>${ps.length>1?`Positionen (${ps.length}) & Details`:'Details'}</summary>
          ${ps.length>1?`<div class="m" style="margin:4px 0">${ps.map(p=>`• ${_posTxt(p)}${p.leihe?' 🔁':''}`).join('<br>')}</div>`:''}
          ${det?`<div class="m">${det}</div>`:''}</details></div>
        ${btns.length?`<div style="display:flex;gap:5px;flex-wrap:wrap">${btns.join('')}</div>`:''}</div>`;
    }
    return `<div class="shop-row"><div class="main">
      <div class="t">${head} ${tChips} <span class="shop-st" style="background:${st.c}">${st.l}</span>${o.direkt?' <span class="shop-st" style="background:#6b7280" title="Ohne Bestellung direkt verschickt">📤 direkt</span>':''}${o.auto?' <span class="shop-st" style="background:#6b21a8" title="Automatisch, weil der Ort unter seinen Soll-Bestand gefallen ist">🤖 automatisch</span>':''}</div>${posList}
      <div class="m">${mgr?`von <b>${esc(o.byName||'?')}</b> · `:''}${_fmtTs(o.ts)}${o.anlass?` · Anlass: ${esc(o.anlass)}`:''}
        ${o.termin?` · <span class="${late?'shop-late':''}">${o.leihe?'ab':'bis'} ${_fmtDate(o.termin)}${late?' (überfällig)':''}</span>`:''}${o.rueckgabe?` · 🔁 Rückgabe bis ${_fmtDate(o.rueckgabe)}`:''}${where?` · nach: ${where}`:''}
        ${o.adresse?`<br>📮 ${esc(o.adresse).replace(/\n/g,', ')}`:''}
        ${o.note?`<br>📝 ${esc(o.note)}`:''}
        ${o.handledByName?`<br>Bearbeitet von ${esc(o.handledByName)} · ${_fmtTs(o.handledTs)}${o.fromPlace?` · aus ${esc(placeLabel(o.fromPlace))}`:''}`:''}
        ${o.answer?`<br>💬 ${esc(o.answer)}`:''}</div></div>
      ${btns.length?`<div style="display:flex;gap:5px;flex-wrap:wrap">${btns.join('')}</div>`:''}</div>`;
  }).join('');
  return `<div class="shop-bar"><span class="shop-seg">${seg.map(s=>`<button class="${fOrd===s[0]?'on':''}" onclick="shopSetOrd(${jsq(s[0])})">${s[1]}</button>`).join('')}</span>
      ${mgr?_teamFilterHtml():''}
      <span class="shop-sp"></span>
      ${mgr?`<button class="shop-btn" onclick="shopCartSend()" title="Ohne Bestellung direkt an Mitarbeiter, Verein oder andere schicken – mehrere Artikel möglich">📤 Direkt verschicken</button>`:''}
      <button class="shop-btn pri" onclick="shopOrderNew()">＋ Bestellen</button></div>
    ${mgr?(()=>{ const low=_refillData().lowTotal; return low.length?`<div class="shop-row" style="border-color:#d97706;background:#fff8e1;margin-bottom:8px"><div class="main"><div class="t">🛍️ Nachkaufen – insgesamt unter Mindestbestand</div>
      <div class="m">${low.map(it=>`${esc(itemLabel(it))}: <b>${total(it)} / ${_num(it.min)}</b> <button class="shop-btn sm" style="margin:2px 4px" onclick="shopBook(${jsq(it.id)},'zugang','',${_num(it.min)-total(it)})">➕ Zugang buchen</button>`).join('<br>')}</div></div></div>`:''; })():''}
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
  closeModal(); toast(o.auto?(status==='abgelehnt'?'Auto-Bestellung abgelehnt – neue erst, wenn noch mehr fehlt.':'Erledigt ✓'):(status==='abgelehnt'?'Bestellung abgelehnt – Besteller wird benachrichtigt.':'Erledigt ✓ – Besteller wird benachrichtigt.'),'ok'); renderShop();
}
// Ausgeben: Bestand am Quell-Ort abziehen ODER an den Lieferort umlagern (z. B. Werkzeug aufs Boot)
// Ausgeben – PRO POSITION: Quell-Ort, Menge, Art (umlagern / verleihen / verschicken / abziehen / nicht)
function shopOrderIssue(id){
  const o=getShop('shopOrders',id); if(!o||!canManage()) return;
  const canMoveTo=!!(o.ortId && placeOf(o.ortId));
  const rc=_orderRecipient(o);
  const ps=_pos(o);
  let anyRow=false;
  const rows=ps.map((p,i)=>{
    const it=p.itemId?getShop('shopItems',p.itemId):null;
    if(it && isEinzeln(it)) return `<div class="shop-pos-row"><span class="nm">${_posTxt(p)}</span><span style="font-size:12px;color:var(--muted)">einzeln erfasst – über „🏷️ Stücke" ausgeben</span></div>`;
    if(!it) return `<div class="shop-pos-row"><span class="nm">✏️ ${esc(p.itemName||p.freitext||'?')} · ${_num(p.menge)}</span><span style="font-size:12px;color:var(--muted)">${p.itemId?'Artikel gelöscht':'freier Wunsch – manuell erledigen'}</span></div>`;
    const from=srcPlaces(it, canMoveTo?o.ortId:null);
    if(!from.length) return `<div class="shop-pos-row"><span class="nm">${_posTxt(p)}</span><span style="font-size:12px;color:#c0392b">${inPlaces(it)?'kein freier Bestand (nur fester Bestand an Orten)':'kein Bestand'}</span></div>`;
    anyRow=true;
    // Vorwahl nach Ziel: Ort → umlagern · Person/Verein → Leihmaterial verleihen, sonst verschicken
    const def = canMoveTo ? 'move' : (it.leihbar ? 'leihe' : 'versand');
    const opt=(v,l)=>`<option value="${v}"${def===v?' selected':''}>${l}</option>`;
    return `<div class="shop-pos-row" data-i="${i}"><span class="nm">${it.leihbar?'🔁 ':''}${esc(itemLabel(it))}</span>
      <select class="si-from" title="Aus Ort">${from.map(x=>`<option value="${esc(x)}">${esc(srcLabel(it,x))}</option>`).join('')}</select>
      <input class="si-qty" type="number" min="1" step="1" value="${_num(p.menge)||1}" title="Menge">
      <select class="si-mode" onchange="shopIssueModeChg()" title="Was passiert?">
        ${canMoveTo?opt('move',`⇄ nach ${esc(placeLabel(o.ortId))}`):''}
        ${it.leihbar?opt('leihe','🔁 verleihen'):''}
        ${opt('versand','📤 verschicken')}
        ${opt('out','➖ nur abziehen')}
        ${opt('skip','– nicht ausgeben')}</select></div>`;
  }).join('');
  if(!anyRow){ toast('Für keine Position ist Bestand vorhanden – erst „± Buchen" (Zugang) oder „Erledigt".','err'); return; }
  openModal(`<h3>📦 Ausgeben / Verschicken</h3><p style="font-size:13px;margin:0 0 6px">bestellt von <b>${esc(o.byName||'')}</b> · ${_fmtTs(o.ts)}</p>
    <div style="font-size:13px;background:#f1f4f8;border-radius:8px;padding:8px 10px;margin:0 0 10px">Ziel: <b>${_orderWhere(o)||'–'}</b>${o.ziel!=='place'?` · Empfänger: <b>${esc(rc.bName)}</b>`:''}${o.adresse?`<div style="white-space:pre-line;margin-top:3px">📮 ${esc(o.adresse)}</div>`:''}</div>
    <div class="shop-f"><label>Positionen <span style="font-weight:400;color:var(--muted)">(Aus Ort · Menge · was passiert)</span></label><div class="shop-pos" id="si-rows">${rows}</div></div>
    <div class="shop-f" id="si-due-w" style="display:none"><label>🔁 Rückgabe bis <span style="font-weight:400;color:var(--muted)">(leer = Dauerleihe)</span></label><input id="si-due" type="date" value="${esc(o.rueckgabe||'')}"></div>
    <div class="shop-f"><label>Nachricht an ${esc(o.byName||'Besteller')} (optional)</label><input id="si-ans" placeholder="z. B. liegt im Bus, Fach links"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopOrderIssueSave(${jsq(id)})">Ausgeben</button></div>`);
  shopIssueModeChg();
}
function shopIssueModeChg(){
  const any=[...document.querySelectorAll('#si-rows .si-mode')].some(s=>s.value==='leihe');
  const w=document.getElementById('si-due-w'); if(w) w.style.display=any?'':'none';
}
function shopOrderIssueSave(id){
  const o=getShop('shopOrders',id); if(!o) return;
  const ps=_pos(o); const ans=_val('si-ans'), due=_val('si-due');
  const rows=[...document.querySelectorAll('#si-rows .shop-pos-row[data-i]')].map(r=>({
    i:+r.dataset.i, from:r.querySelector('.si-from').value, q:Math.round(_num(r.querySelector('.si-qty').value)), mode:r.querySelector('.si-mode').value }))
    .filter(r=>r.mode!=='skip');
  if(!rows.length){ toast('Keine Position zum Ausgeben ausgewählt.','err'); return; }
  if(rows.some(r=>r.q<=0)){ toast('Bitte überall eine Menge größer 0 eingeben.','err'); return; }
  // Erst ALLES prüfen (auch mehrfach derselbe Artikel/Ort), dann buchen – nie halb ausgeben
  const need={};
  for(const r of rows){ const it=getShop('shopItems',ps[r.i].itemId); if(!it){ toast('Ein Artikel existiert nicht mehr.','err'); return; }
    const k=it.id+'|'+r.from; need[k]=(need[k]||0)+r.q;
    if(need[k]>freeAt(it,r.from)){ toast(`${itemLabel(it)}: am Ort ${placeLabel(r.from)} sind nur ${freeAt(it,r.from)} frei${sollAt(it,r.from)?' (Rest ist fester Bestand)':''}.`,'err'); return; } }
  const note='Bestellung von '+(o.byName||'?')+(o.anlass?' · '+o.anlass:'');
  const rc=_orderRecipient(o); const cu=_me(); const issued=[];
  rows.forEach(r=>{
    const it=getShop('shopItems',ps[r.i].itemId);
    _applyDelta(it, r.from, -r.q);
    if(r.mode==='move' && o.ortId){ _applyDelta(it, o.ortId, r.q); saveShop('shopItems', it); _log(it,'umlagern',r.q,r.from,o.ortId,note,o.id); }
    else if(r.mode==='leihe'){ saveShop('shopItems', it);
      // viaOrder=true nur, wenn der Besteller selbst der Ausleiher ist (er bekommt ja schon die Bestell-Mitteilung)
      _createLoan(it, r.from, r.q, rc.bId, rc.bName, due, o.anlass||'', o.note||'', o.id, rc.bId===o.byId, rc.bRef); }
    else if(r.mode==='versand'){ saveShop('shopItems', it);
      saveShop('shopLog',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:it.id, itemName:itemLabel(it),
        type:'versand', qty:r.q, from:r.from, to:null, note:note+(o.adresse?' · '+o.adresse.split('\n').join(', '):''),
        recipientName:rc.bName, recipientId:rc.bId||null, recipientRef:rc.bRef||null, orderId:o.id }); }
    else { saveShop('shopItems', it); _log(it,'ausgabe',r.q,r.from,null,note,o.id); }
    issued.push({ itemId:it.id, itemName:itemLabel(it), qty:r.q, from:r.from, mode:r.mode });
  });
  const modes=[...new Set(issued.map(x=>x.mode))];
  _handled(o,'ausgegeben',{answer:ans, fromPlace:issued[0].from, issuedQty:issued.reduce((s,x)=>s+x.qty,0),
    issueMode: modes.length===1?modes[0]:'mixed', issued, rueckgabe: modes.includes('leihe')?due:(o.rueckgabe||'')});
  closeModal(); toast(`Ausgegeben ✓ (${issued.length} Position${issued.length===1?'':'en'})`+(o.auto?'':` – ${o.byName||'Besteller'} wird benachrichtigt.`),'ok'); renderShop();
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
    zuord:false, orderId:orderId||null, status:'aktiv', returns:[],
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
  if(isEinzeln(it)){ shopUnits(itemId); toast('Einzelne Stücke über „🔁" in der Stückliste zuordnen.','ok'); return; }
  if(!it.leihbar && itemArt(it)!=='ausstattung'){ toast('Verbrauchsmaterial wird nicht verliehen – bitte „📤 Verschicken" nutzen (oder den Artikel als Leihmaterial markieren).','err'); return; }
  const from=Object.keys(it.stock||{}).filter(p=>_num(it.stock[p])>0);
  if(!from.length){ toast('Gerade nichts verfügbar – alles verliehen oder kein Bestand.','err'); return; }
  const aus=itemArt(it)==='ausstattung';
  openModal(_lendModalHtml(aus?'Ausstattung zuordnen / ausleihen':'🔁 Verleihen', `<b>${esc(itemLabel(it))}</b> · ${inPlaces(it)} verfügbar`,
    `<div class="shop-f2"><div class="shop-f"><label>Aus Ort</label><select id="sl-from">${from.map(p=>`<option value="${esc(p)}"${fPlace===p?' selected':''}>${esc(placeLabel(p))} (${_num(it.stock[p])})</option>`).join('')}</select></div>
      <div class="shop-f"><label>Menge</label><input id="sl-qty" type="number" min="1" step="1" value="1"></div></div>`,
    `shopLendSave(${jsq(itemId)})`, {zuord:true, leihe:true, def:aus?'zuord':'leihe'}));
}
// Gemeinsames Fenster für Zuordnen / Ausleihen (Artikel, Stück, beweglicher Ort).
// opt = {zuord, leihe, def} – welche Arten erlaubt sind und was vorgewählt ist.
function _lendModalHtml(title, sub, middle, saveCall, opt){
  opt=opt||{zuord:true,leihe:true,def:'leihe'}; const def=opt[opt.def]?opt.def:(opt.zuord?'zuord':'leihe');
  const radio=(v,l,d)=>opt[v]?`<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:3px 0;cursor:pointer;font-weight:400"><input type="radio" name="sl-art" value="${v}"${def===v?' checked':''} style="width:auto;margin-top:2px" onchange="shopLendArtChg()"><span><b>${l}</b> – ${d}</span></label>`:'';
  return `<h3>${title}</h3><p style="font-size:13px;margin:0 0 10px">${sub}</p>
    <div class="shop-f"><label>Art</label>
      ${radio('zuord','👤 Dauerhaft zuordnen','einem Mitarbeiter, der dafür zuständig ist (bekommt Termine &amp; Bestellungen dazu)')}
      ${radio('leihe','🔁 Ausleihen','zeitweise an Mitarbeiter, Verein oder andere – mit Rückgabedatum oder als Dauerleihe')}</div>
    ${_whoPickerHtml('sl')}
    ${middle||''}
    <div id="sl-leihe-w"${def==='zuord'?' style="display:none"':''}><div class="shop-f2"><div class="shop-f"><label>Rückgabe bis <span id="sl-due-req">*</span></label><input id="sl-due" type="date" min="${_todayIso()}">
        <label style="display:flex;gap:6px;align-items:center;font-weight:400;margin-top:5px;cursor:pointer"><input type="checkbox" id="sl-perm" style="width:auto" onchange="const d=document.getElementById('sl-due');d.disabled=this.checked;if(this.checked)d.value='';document.getElementById('sl-due-req').style.display=this.checked?'none':''"> Dauerleihe (ohne Rückgabedatum)</label></div>
      <div class="shop-f"><label>Wofür / Anlass</label><input id="sl-anlass" placeholder="z. B. Regatta, Messe, Wochenende"></div></div></div>
    <div class="shop-f"><label>Notiz</label><input id="sl-note" placeholder="z. B. Zustand bei Ausgabe, Zubehör, Kilometerstand"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="${saveCall}">Speichern</button></div>`;
}
function _lendArt(){ const r=document.querySelector('input[name="sl-art"]:checked'); return r?r.value:'leihe'; }
function shopLendArtChg(){ const w=document.getElementById('sl-leihe-w'); if(w) w.style.display=_lendArt()==='zuord'?'none':''; }
function _lendCommon(){
  const w=_whoRead('sl'); if(!w) return null;
  if(_lendArt()==='zuord'){
    if(!w.bId){ toast('Dauerhaft zuordnen geht nur an einen Mitarbeiter – für Vereine/andere bitte „Ausleihen" (Dauerleihe).','err'); return null; }
    return Object.assign(w,{ zuord:true, due:'', anlass:'', note:_val('sl-note') });
  }
  const perm=!!(document.getElementById('sl-perm')||{}).checked, due=perm?'':_val('sl-due');
  if(!due && !perm){ toast('Bitte ein Rückgabedatum angeben – oder „Dauerleihe" anhaken.','err'); return null; }
  return Object.assign(w,{ zuord:false, due, anlass:_val('sl-anlass'), note:_val('sl-note') });
}
function _newLoan(extra, c){
  const cu=_me();
  const l=Object.assign({ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', qty:1, fromPlace:null,
    borrowerId:c.bId||null, borrowerRef:c.bRef||null, borrowerName:c.bName||'?', due:c.due||'', anlass:c.anlass||'', note:c.note||'',
    zuord:!!c.zuord, orderId:null, status:'aktiv', returns:[], ackBorrower: !c.bId || c.bId===cu.id }, extra);
  saveShop('shopLoans', l); return l;
}
const _lendTxt=c=>(c.zuord?'zugeordnet an ':'an ')+c.bName+(c.zuord?'':(c.due?' bis '+_fmtDate(c.due):' (Dauerleihe)'))+(c.anlass?' · '+c.anlass:'');
// Beweglicher Ort (Bus, Boot, Anhänger): EINE Zuordnung + daneben EINE Ausleihe möglich – Inhalt fährt mit
function shopLendPlace(pid, art){
  if(!canManage()) return;
  const p=placeOf(pid); if(!p) return;
  const z=placeZuord(pid), le=placeLeihe(pid);
  if(z && le){ toast(`${p.name} ist zugeordnet und gerade ausgeliehen – erst zurückgeben.`,'err'); return; }
  const n=items().reduce((s,i)=>s+_num((i.stock||{})[pid]),0);
  openModal(_lendModalHtml(`🚩 ${esc(placeLabel(pid))}`, `Der Inhalt (${n} Teile) fährt mit und bleibt am Ort gebucht.${z?` Zugeordnet: <b>${esc(bName(z))}</b>.`:''}`, '', `shopLendPlaceSave(${jsq(pid)})`,
    {zuord:!z, leihe:!le, def:art||(z?'leihe':'zuord')}));
}
function shopLendPlaceSave(pid){
  const p=placeOf(pid); if(!p||!canManage()) return; const c=_lendCommon(); if(!c) return;
  if(c.zuord?placeZuord(pid):placeLeihe(pid)){ toast('Ist schon '+(c.zuord?'zugeordnet':'ausgeliehen')+'.','err'); return; }
  _newLoan({ placeId:pid, itemId:null, itemName:placeLabel(pid) }, c); _logPlace(p,c.zuord?'zuordnung':'verleih',_lendTxt(c));
  closeModal(); toast(`${p.name} ${c.zuord?'zugeordnet an':'ausgeliehen an'} ${c.bName} ✓`,'ok'); renderShop();
}
// Einzelnes Stück (z. B. Rettungsweste „Anna") – liegt dann an keinem Ort, behält seine Termine
function shopLendUnit(itemId, unitId){
  if(!canManage()) return;
  const it=getShop('shopItems',itemId); const u=it&&it.units&&it.units[unitId]; if(!u) return;
  if(unitLoan(unitId)){ toast('Dieses Stück ist schon vergeben – erst zurückgeben bzw. „Übergeben".','err'); return; }
  openModal(_lendModalHtml('🏷️ Stück zuordnen / ausleihen', `<b>${esc(_unitTitle(it,u))}</b> · liegt ${esc(placeLabel(u.placeId))}`, '', `shopLendUnitSave(${jsq(itemId)},${jsq(unitId)})`, {zuord:true,leihe:true,def:'zuord'}));
}
function shopLendUnitSave(itemId, unitId){
  const it=getShop('shopItems',itemId); const u=it&&it.units&&it.units[unitId]; if(!u||!canManage()) return;
  const c=_lendCommon(); if(!c) return;
  const from=u.placeId||null; u.placeId=''; _syncStock(it); saveShop('shopItems', it);
  _newLoan({ itemId, unitId, itemName:_unitTitle(it,u), fromPlace:from }, c); _log(it,c.zuord?'zuordnung':'verleih',1,from,null,u.nr+' '+_lendTxt(c));
  closeModal(); toast(`${u.nr} → ${c.bName} ✓`,'ok'); renderShop();
}
function shopLendSave(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const c=_lendCommon(); if(!c) return;
  const from=_val('sl-from'), q=Math.round(_num(_val('sl-qty')));
  if(q<=0){ toast('Bitte eine Menge größer 0 eingeben.','err'); return; }
  if(!_applyDelta(it, from, -q)){ toast(`Am Ort sind nur ${_num((it.stock||{})[from])} vorhanden.`,'err'); return; }
  saveShop('shopItems', it);
  _newLoan({ itemId:it.id, itemName:itemLabel(it), qty:q, fromPlace:from }, c); _log(it,c.zuord?'zuordnung':'verleih',q,from,null,_lendTxt(c));
  closeModal(); toast(`${q}× ${c.zuord?'zugeordnet an':'verliehen an'} ${c.bName} ✓`,'ok'); renderShop();
}
// Zuordnung an einen anderen Mitarbeiter übergeben (alte endet, neue beginnt – Verlauf bleibt erhalten)
function shopReassign(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv'||!canManage()) return;
  const ppl=people().filter(u=>u.id!==l.borrowerId);
  openModal(`<h3>👤 Zuordnung übergeben</h3><p style="font-size:13px;margin:0 0 10px">${loanIcon(l)} <b>${esc(l.placeId?placeLabel(l.placeId):(l.itemName||''))}</b>${l.unitId||l.placeId?'':' · '+_num(l.qty)+'×'} · bisher bei <b>${esc(bName(l))}</b></p>
    <div class="shop-f"><label>Neu zuständig *</label><select id="sra-who"><option value="">– bitte wählen –</option>${ppl.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></div>
    <div class="shop-f"><label>Notiz</label><input id="sra-note" placeholder="z. B. Übergabe beim Saisonstart"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopReassignSave(${jsq(loanId)})">Übergeben</button></div>`);
}
function shopReassignSave(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv'||!canManage()) return;
  const id=_val('sra-who'); const u=people().find(x=>x.id===id); if(!u){ toast('Bitte einen Mitarbeiter wählen.','err'); return; }
  const note=_val('sra-note'), cu=_me();
  if(!Array.isArray(l.returns)) l.returns=[];
  l.returns.push({ ts:Date.now(), qty:_num(l.qty), to:null, note:'übergeben an '+u.name+(note?' · '+note:''), byId:cu.id||'', byName:cu.name||'' });
  l.status='zurueck'; l.returnedTs=Date.now(); l.qty=0; saveShop('shopLoans', l);
  const nl=_newLoan({ placeId:l.placeId||null, unitId:l.unitId||null, itemId:l.itemId||null, itemName:l.itemName, qty:_num(l.returns[l.returns.length-1].qty)||1, fromPlace:l.fromPlace||null },
    { bId:u.id, bRef:null, bName:u.name, zuord:true, due:'', anlass:'', note });
  const txt=`übergeben: ${bName(l)} → ${u.name}${note?' · '+note:''}`;
  if(l.placeId){ const p=placeOf(l.placeId); if(p) _logPlace(p,'zuordnung',txt); }
  else { const it=getShop('shopItems',l.itemId); if(it) _log(it,'zuordnung',_num(nl.qty),null,null,txt); }
  closeModal(); toast(`Jetzt bei ${u.name} ✓`,'ok'); renderShop();
}
// Verwalter: erst Artikel wählen, dann Verschicken bzw. Verleihen (ohne vorherige Bestellung)
function shopPickItem(mode){
  if(!canManage()) return;
  const lend=mode==='lend';
  if(lend){
    // Zuordnen/Verleihen: Leihmaterial + Ausstattung (Mengen) · bewegliche Orte · einzelne Stücke
    const its=items().filter(i=>!isEinzeln(i) && inPlaces(i)>0 && (i.leihbar || itemArt(i)==='ausstattung'));
    const pls=places().filter(p=>isMovable(p) && !(placeZuord(p.id)&&placeLeihe(p.id)));
    const us=items().filter(isEinzeln).flatMap(it=>unitsOf(it).filter(u=>u.placeId && !unitLoan(u.id)).map(u=>({it,u})));
    if(!its.length && !pls.length && !us.length){ toast('Nichts zum Zuordnen verfügbar.','err'); return; }
    openModal(`<h3>🔁 Zuordnen / Verleihen – was?</h3>
      <div class="shop-f"><label>Was?</label><select id="spi-item">
        ${pls.length?`<optgroup label="🚩 Fahrzeuge, Boote, Anhänger (mit Inhalt)">${pls.map(p=>`<option value="${esc('p|'+p.id)}">${esc(placeLabel(p.id))}</option>`).join('')}</optgroup>`:''}
        ${its.length?`<optgroup label="🔁 Leihmaterial & 🧰 Ausstattung">${its.map(i=>`<option value="${esc('i|'+i.id)}">${esc(itemLabel(i))} (${inPlaces(i)} verfügbar)</option>`).join('')}</optgroup>`:''}
        ${us.length?`<optgroup label="🏷️ Einzelne Stücke">${us.map(x=>`<option value="${esc('u|'+x.it.id+'|'+x.u.id)}">${esc(_unitTitle(x.it,x.u))} – ${esc(placeLabel(x.u.placeId))}</option>`).join('')}</optgroup>`:''}
      </select></div>
      <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="shopPickLendGo(document.getElementById('spi-item').value)">Weiter</button></div>`);
    return;
  }
  const list=items().filter(i=>inPlaces(i)>0);
  if(!list.length){ toast('Kein Artikel mit Bestand.','err'); return; }
  openModal(`<h3>📤 Direkt verschicken – welcher Artikel?</h3>
    <div class="shop-f"><label>Artikel</label><select id="spi-item">${list.map(i=>`<option value="${esc(i.id)}">${esc(itemLabel(i))}${i.kategorie?' – '+esc(i.kategorie):''} (${inPlaces(i)} verfügbar)</option>`).join('')}</select></div>
    <p style="font-size:12px;color:var(--muted);margin:0">Leihmaterial, das zurückkommen soll, besser über „🔁 Ausleihen" → „Verleihen".</p>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopSend(document.getElementById('spi-item').value)">Weiter</button></div>`);
}
function shopPickLendGo(v){ const [k,a,b]=String(v||'').split('|');
  if(k==='p') shopLendPlace(a); else if(k==='u') shopLendUnit(a,b); else if(k==='i') shopLend(a); }
// ── Direkt verschicken – MEHRERE Artikel aus dem Korb an EIN Ziel (Verwalter) ──
function shopCartSend(){
  if(!canManage()) return;
  openModal(`<h3>📤 Direkt verschicken</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Ohne Bestellung – die Sachen bleiben beim Empfänger (werden vom Bestand abgezogen). Erscheint danach auch unter „Bestellungen".</p>
    ${_whoPickerHtml('ss')}
    ${_posEditorHtml('send')}
    <div class="shop-f2"><div class="shop-f"><label>Wie?</label><select id="ss-how"><option>Post / Versand</option><option>Persönlich übergeben</option><option>Abgeholt</option></select></div>
      <div class="shop-f"><label>Wofür / Anlass</label><input id="ss-anlass" placeholder="z. B. Vereinsfest, Messe"></div></div>
    <div class="shop-f"><label>Notiz</label><input id="ss-note" placeholder="z. B. Sendungsnummer"></div>
    <p style="font-size:12px;color:var(--muted);margin:0">Soll Leihmaterial zurückkommen? Dann besser über „🔁 Ausleihen" → „Verleihen".</p>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopCartSendSave()">Verschicken</button></div>`);
  _posPaint();
}
function shopCartSendSave(){
  const w=_whoRead('ss'); if(!w) return;
  const pos=cartGet().filter(p=>p.itemId && !isEinzeln(getShop('shopItems',p.itemId)));
  if(!pos.length){ toast('Bitte mindestens einen Artikel hinzufügen.','err'); return; }
  // Quell-Orte aus dem Fenster übernehmen + alles prüfen, bevor gebucht wird
  const rows=pos.map(p=>{ const it=getShop('shopItems',p.itemId); const fr=it?srcPlaces(it):[];
    return { it, from:(p.from&&fr.includes(p.from))?p.from:fr[0], q:Math.max(1,Math.round(_num(p.menge))||1) }; });
  const need={};
  for(const r of rows){ if(!r.it||!r.from){ toast(`${r.it?itemLabel(r.it):'Artikel'}: kein freier Bestand.`,'err'); return; }
    const k=r.it.id+'|'+r.from; need[k]=(need[k]||0)+r.q;
    if(need[k]>freeAt(r.it,r.from)){ toast(`${itemLabel(r.it)}: am Ort ${placeLabel(r.from)} sind nur ${freeAt(r.it,r.from)} frei${sollAt(r.it,r.from)?' (Rest ist fester Bestand)':''}.`,'err'); return; } }
  const cu=_me(), anlass=_val('ss-anlass'), note=_val('ss-note'), how=_val('ss-how');
  const adr=w.bRef?_crmAddress(w.bRef):(w.bId?userAddress(w.bId):'');
  const ts=Date.now(); const oid=newId();
  rows.forEach(r=>{ _applyDelta(r.it, r.from, -r.q); saveShop('shopItems', r.it);
    saveShop('shopLog',{ id:newId(), ts, byId:cu.id||'', byName:cu.name||'', itemId:r.it.id, itemName:itemLabel(r.it),
      type:'versand', qty:r.q, from:r.from, to:null, note:[how,anlass,note,adr.split('\n').join(', ')].filter(Boolean).join(' · '),
      recipientName:w.bName, recipientId:w.bId||null, recipientRef:w.bRef||null, orderId:oid }); });
  const positionen=rows.map(r=>({ itemId:r.it.id, itemName:itemLabel(r.it), freitext:'', menge:r.q, einheit:r.it.einheit||'Stück', leihe:false }));
  const base=_directOrder({ ts, byId:cu.id||'', byName:cu.name||'', recipientRef:w.bRef||null, recipientId:w.bId||null, recipientName:w.bName,
    from:rows[0].from, qty:rows.reduce((s,r)=>s+r.q,0), itemId:rows.length===1?rows[0].it.id:null, itemName:rows.length===1?itemLabel(rows[0].it):'' },
    rows.length===1?rows[0].it:null, how, anlass, note, adr);
  saveShop('shopOrders', Object.assign(base, { id:oid, positionen,
    issued:rows.map(r=>({ itemId:r.it.id, itemName:itemLabel(r.it), qty:r.q, from:r.from, mode:'versand' })) }));
  cartOpen=false; cartSet(cartGet().filter(p=>!p.itemId));   // freie Wünsche bleiben im Korb
  if(TAB==='bestellungen') fOrd='alle';
  closeModal(); toast(`${rows.length} Position${rows.length===1?'':'en'} an ${w.bName} verschickt ✓`,'ok'); renderShop();
}
// ── Verschicken / abgeben (Verbrauch MIT Empfänger: Flyer an Verein, Visitenkarten an Mitarbeiter …)
// Einzelner Artikel: legt ihn in den Korb und öffnet „Direkt verschicken" (eine Bedienung für alles)
function shopSend(itemId){
  if(!canManage()) return;
  if(itemId && getShop('shopItems',itemId)){ const a=cartGet(); if(!a.some(p=>p.itemId===itemId)){ a.push({key:newId(), itemId, menge:1}); try{ localStorage.setItem(_cartKey(), JSON.stringify(a)); }catch(e){} } shopCartSend(); return; }
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
  if(l.placeId){   // beweglicher Ort: einfach zurück (Inhalt war ja die ganze Zeit am Ort gebucht)
    openModal(`<h3>${isZuord(l)?"👤 Zuordnung aufheben":"↩ Zurückgeben"}</h3><p style="font-size:13px;margin:0 0 10px"><b>${esc(placeLabel(l.placeId))}</b> · bei ${esc(bLabel(l))}${l.due?' · bis '+_fmtDate(l.due):''}</p>
      <div class="shop-f"><label>Zustand / Notiz</label><input id="sr-note" placeholder="z. B. alles ok, Kilometerstand, Schaden am Rücklicht"></div>
      <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="shopReturnSave(${jsq(loanId)})">${isZuord(l)?"Aufheben":"Zurückgeben"}</button></div>`);
    return;
  }
  const pls=places(); if(!pls.length){ toast('Es gibt keinen Ort für die Rückgabe.','err'); return; }
  const def=placeOf(l.fromPlace)?l.fromPlace:pls[0].id;
  openModal(`<h3>${isZuord(l)?"👤 Zuordnung aufheben":"↩ Zurückgeben"}</h3><p style="font-size:13px;margin:0 0 10px"><b>${_num(l.qty)}× ${esc(l.itemName||'')}</b> · ausgeliehen von ${esc(bLabel(l))}${l.due?' · bis '+_fmtDate(l.due):''}</p>
    <div class="shop-f2"><div class="shop-f"><label>Zurück nach</label>${_placeSelect('sr-to', def, false)}</div>
      <div class="shop-f"><label>Menge</label><input id="sr-qty" type="number" min="1" max="${_num(l.qty)}" step="1" value="${_num(l.qty)}"></div></div>
    <div class="shop-f"><label>Zustand / Notiz</label><input id="sr-note" placeholder="z. B. alles ok, Stange verbogen, Akku fehlt"></div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopReturnSave(${jsq(loanId)})">${isZuord(l)?"Aufheben":"Zurückgeben"}</button></div>`);
}
function shopReturnSave(loanId){
  const l=getShop('shopLoans',loanId); if(!l||l.status!=='aktiv') return;
  const cu=_me();
  if(l.placeId){ const note=_val('sr-note'); const p=placeOf(l.placeId);
    if(p) _logPlace(p,'rueckgabe','von '+bName(l)+(note?' · '+note:''));
    if(!Array.isArray(l.returns)) l.returns=[];
    l.returns.push({ ts:Date.now(), qty:1, to:l.placeId, note, byId:cu.id||'', byName:cu.name||'' });
    l.qty=0; l.status='zurueck'; l.returnedTs=Date.now(); saveShop('shopLoans', l);
    closeModal(); toast('Zurückgegeben ✓','ok'); renderShop(); return; }
  const to=_val('sr-to'), q=Math.round(_num(_val('sr-qty'))), note=_val('sr-note'), open=_num(l.qty);
  if(q<=0||q>open){ toast(`Bitte eine Menge zwischen 1 und ${open} eingeben.`,'err'); return; }
  const it=getShop('shopItems',l.itemId);
  if(it && l.unitId){ const u=it.units&&it.units[l.unitId];
    if(u){ u.placeId=to; _syncStock(it); saveShop('shopItems', it); _log(it,'rueckgabe',1,null,to,u.nr+' von '+bName(l)+(note?' · '+note:'')); } }
  else if(it){ _applyDelta(it, to, q); saveShop('shopItems', it); _log(it,'rueckgabe',q,null,to,'von '+bName(l)+(note?' · '+note:'')); }
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
  // „Gerade ausgeliehen" sehen ALLE (nur ansehen – zurückgeben nur die eigenen); „Meine" = eigene laufende;
  // „Zurückgegeben": Verwalter alle, Mitarbeiter nur eigene
  // „Zugeordnet" (dauerhaft, Mitarbeiter verantwortlich) ist getrennt von „Ausgeliehen" (User-Vorgabe)
  if(fLoan==='meine' && mgr) fLoan='aktiv';
  let ls=loans();
  if(fLoan==='aktiv') ls=ls.filter(l=>l.status==='aktiv' && !isZuord(l));
  else if(fLoan==='zuord') ls=ls.filter(l=>l.status==='aktiv' && isZuord(l));
  else if(fLoan==='meine') ls=ls.filter(l=>l.status==='aktiv' && l.borrowerId===me.id);
  else ls=ls.filter(l=>l.status!=='aktiv' && (mgr || l.borrowerId===me.id));
  if(fLoan==='zuord') ls.sort((a,b)=>bName(a).localeCompare(bName(b),'de',{sensitivity:'base'}));
  else if(fLoan!=='zurueck') ls.sort((a,b)=>String(a.due||'9').localeCompare(String(b.due||'9')));
  const rows=ls.map(l=>{
    const late=_overdue(l); const ret=Array.isArray(l.returns)?l.returns:[]; const zu=isZuord(l);
    const canRet=l.status==='aktiv' && (mgr || (l.borrowerId===me.id && !zu));
    const st=l.status!=='aktiv'?`<span class="shop-st" style="background:#16a34a">${zu?'Beendet':'Zurück'}</span>`
      : zu?`<span class="shop-st" style="background:${_ZUORD_C}">Zugeordnet</span>`
      : late?'<span class="shop-st" style="background:#c0392b">Überfällig</span>':`<span class="shop-st" style="background:#2563eb">${l.due?'Ausgeliehen':'Dauerleihe'}</span>`;
    return `<div class="shop-row"${late?' style="border-color:#e5484d"':''}><div class="main">
      <div class="t">${loanIcon(l)} ${(l.placeId||l.unitId)?'':(_num(l.qty)||ret.reduce((s,r)=>s+_num(r.qty),0))+'× '}${esc(l.placeId?placeLabel(l.placeId):(l.itemName||'?'))}${l.placeId?' <span style="font-weight:400;font-size:12px;color:var(--muted)">mit Inhalt</span>':''} ${st}</div>
      <div class="m">${(mgr||l.borrowerId!==me.id)?`${zu?'bei':'an'} <b>${esc(bLabel(l))}</b> · `:`${zu?'bei':'an'} <b>dir</b> · `}seit ${_fmtTs(l.ts)}${l.fromPlace&&placeOf(l.fromPlace)?' aus '+esc(placeLabel(l.fromPlace)):''}
        ${l.due?` · <span class="${late?'shop-late':''}">zurück bis ${_fmtDate(l.due)}</span>`:''}${l.anlass?` · ${esc(l.anlass)}`:''}
        ${l.note?`<br>📝 ${esc(l.note)}`:''}
        ${ret.map(r=>`<br>↩ ${(l.placeId||!r.to)?'':`${_num(r.qty)} zurück nach ${esc(placeLabel(r.to))} · `}${_fmtTs(r.ts)} (${esc(r.byName||'')})${r.note?' – '+esc(r.note):''}`).join('')}</div></div>
      ${canRet?`<div style="display:flex;gap:5px;flex-wrap:wrap">
        ${zu&&mgr?`<button class="shop-btn sm" onclick="shopReassign(${jsq(l.id)})" title="An anderen Mitarbeiter übergeben">👤 Übergeben</button>`:''}
        ${zu&&mgr&&l.placeId&&!placeLeihe(l.placeId)?`<button class="shop-btn sm" onclick="shopLendPlace(${jsq(l.placeId)},'leihe')">🔁 Ausleihen</button>`:''}
        <button class="shop-btn sm ok" onclick="shopReturn(${jsq(l.id)})">${zu?'Aufheben':'↩ Zurückgeben'}</button>
        ${mgr&&!zu?`<button class="shop-btn sm" onclick="shopLoanDue(${jsq(l.id)})">📅 ${l.due?'Verlängern':'Datum setzen'}</button>`:''}</div>`:''}</div>`;
  }).join('');
  const nMine=loans().filter(l=>l.status==='aktiv'&&l.borrowerId===me.id).length;
  const nZu=loans().filter(l=>l.status==='aktiv'&&isZuord(l)).length;
  const seg=[['aktiv','Gerade ausgeliehen'],['zuord','👤 Zugeordnet'+(nZu?` (${nZu})`:'')]].concat(mgr?[]:[['meine','Meine'+(nMine?` (${nMine})`:'')]]).concat([['zurueck','Zurückgegeben']]);
  return `<div class="shop-bar"><span class="shop-seg">${seg.map(s=>`<button class="${fLoan===s[0]?'on':''}" onclick="shopSetLoan(${jsq(s[0])})">${s[1]}</button>`).join('')}</span>
      <span class="shop-sp"></span>${mgr?`<button class="shop-btn pri" onclick="shopPickItem('lend')" title="Leihmaterial, Ausstattung, einzelne Stücke oder Fahrzeuge/Boote/Anhänger">🔁 Zuordnen / Verleihen</button>`
        :`<button class="shop-btn pri" onclick="shopOrderNew('')" title="Leihmaterial anfragen – mit Rückgabedatum">🔁 Ausleihen anfragen</button>`}</div>
    <div class="shop-list">${rows||`<div class="shop-empty">${fLoan==='aktiv'?'Gerade ist nichts ausgeliehen.':fLoan==='zuord'?'Noch nichts dauerhaft zugeordnet.':fLoan==='meine'?'Du hast gerade nichts ausgeliehen.':'Noch keine Rückgaben.'}</div>`}</div>`;
}
function shopSetLoan(v){ fLoan=v; renderShop(); }

// ══════════════════════════════════════════════════════════════════
//  PAKET 3 – Einzelstücke (Exemplare) + Termine (Ablauf / Prüfung / TÜV)
//  item.einzeln=true → item.units = { <unitId>: { id, nr, serial, placeId, note, termine:[…] } }
//  item.stock wird dann IMMER aus den Stücken abgeleitet (_syncStock) – Soll/Nachfüllen laufen weiter.
//  Termin = { id, art:'ablauf'|'pruefung', label, datum:'YYYY-MM-DD', intervall:<Monate|''>, verlauf:[…] }
//  Orte haben optional place.termine (TÜV, HU, Wartung … – z. B. Bus, Trailer).
//  Einzeln erfasste Artikel laufen bewusst NICHT über Korb/Verleihen/Verschicken (nur „Stücke").
// ══════════════════════════════════════════════════════════════════
const TERMIN_ART={ ablauf:{i:'⌛',l:'Ablaufdatum'}, pruefung:{i:'🔧',l:'Prüfung / Wartung'} };
function isEinzeln(it){ return !!(it && it.einzeln); }
function unitsOf(it){ return Object.values((it&&it.units)||{}).sort((a,b)=>placeLabel(a.placeId).localeCompare(placeLabel(b.placeId),'de')||String(a.nr||'').localeCompare(String(b.nr||''),'de',{numeric:true})); }
function _syncStock(it){
  if(!isEinzeln(it)) return;
  const st={}; Object.values(it.units||{}).forEach(u=>{ if(u.placeId) st[u.placeId]=(st[u.placeId]||0)+1; });
  it.stock=st;
}
function _addMonths(iso, m){
  const [y,mo,d]=String(iso||_todayIso()).split('-').map(Number); const dt=new Date(y,(mo||1)-1+_num(m),d||1,12);
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
}
function _soonIso(days){ const d=new Date(); d.setDate(d.getDate()+days); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function dueState(datum){ if(!datum) return ''; if(datum<_todayIso()) return 'over'; if(datum<=_soonIso(30)) return 'soon'; return 'ok'; }
function dueBadge(t){
  if(!t||!t.datum) return '';
  const s=dueState(t.datum), c=s==='over'?'#c0392b':s==='soon'?'#d97706':'#16a34a';
  return `<span class="shop-st" style="background:${c}" title="${esc((TERMIN_ART[t.art]||TERMIN_ART.pruefung).l)}${t.intervall?' · alle '+_num(t.intervall)+' Monate':''}">${(TERMIN_ART[t.art]||TERMIN_ART.pruefung).i} ${esc(t.label||'')}${t.label?' ':''}${_fmtDate(t.datum)}${s==='over'?' · überfällig':''}</span>`;
}
// „Rettungsweste 04" statt „Rettungsweste · Rettungsweste 04", wenn die Bezeichnung den Namen schon enthält
function _unitTitle(it,u){ const nr=String(u.nr||"?"); return nr.toLowerCase().startsWith(String(it.name||"").toLowerCase()) ? nr+(it.variante?" · "+it.variante:"") : itemLabel(it)+" · "+nr; }
function nextTermin(termine){ return (termine||[]).filter(t=>t&&t.datum).sort((a,b)=>a.datum.localeCompare(b.datum))[0]||null; }
// Alle Termine (Stücke + Orte) → [{key, kind, itemId, unitId, placeId, t, title, where}]
function allDue(){
  const out=[];
  items().filter(isEinzeln).forEach(it=>unitsOf(it).forEach(u=>(u.termine||[]).forEach(t=>{ if(t&&t.datum) out.push({ key:'u|'+it.id+'|'+u.id+'|'+t.id, kind:'unit', itemId:it.id, unitId:u.id, placeId:u.placeId, t,
    title:_unitTitle(it,u), where:(u.placeId?placeLabel(u.placeId):(()=>{ const ul=unitLoan(u.id); return ul?'🏷️ bei '+bName(ul):'–'; })())+(u.marke?' · '+u.marke:'') }); })));
  places().forEach(p=>(p.termine||[]).forEach(t=>{ if(t&&t.datum){ const z=placeZuord(p.id), le=placeLeihe(p.id); out.push({ key:'p|'+p.id+'|'+t.id, kind:'place', placeId:p.id, t, title:placeLabel(p.id), where:[z?'👤 '+bName(z):'', le?'🔁 an '+bName(le):''].filter(Boolean).join(' · ') }); } }));
  return out.sort((a,b)=>a.t.datum.localeCompare(b.t.datum));
}

// ── Termin-Editor (gemeinsam für Stücke und Orte) ──
function _termRowHtml(px,t){
  t=t||{id:newId(),art:'pruefung',label:'',datum:'',intervall:''};
  return `<div class="shop-pos-row ${px}-term" data-id="${esc(t.id)}">
    <select class="tr-art" style="max-width:150px">${Object.keys(TERMIN_ART).map(k=>`<option value="${k}"${t.art===k?' selected':''}>${TERMIN_ART[k].i} ${TERMIN_ART[k].l}</option>`).join('')}</select>
    <input class="tr-label" placeholder="z. B. TÜV, Prüfung" value="${esc(t.label||'')}" style="flex:1;min-width:90px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px">
    <input class="tr-datum" type="date" value="${esc(t.datum||'')}" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px">
    <input class="tr-int" type="number" min="0" step="1" placeholder="alle … Mon." title="Intervall in Monaten (leer = einmalig)" value="${t.intervall?_num(t.intervall):''}" style="width:92px">
    <button type="button" class="crm-x" style="border:none;background:none;color:#c0392b;cursor:pointer" onclick="this.closest('.shop-pos-row').remove()">✕</button></div>`;
}
function _termEditorHtml(px, termine){
  return `<div class="shop-f"><label>⏰ Termine <span style="font-weight:400;color:var(--muted)">(Ablauf, Prüfung, TÜV … · Intervall in Monaten → „Erledigt" setzt den nächsten Termin)</span></label>
    <div class="shop-pos" id="${px}-terms">${(termine||[]).map(t=>_termRowHtml(px,t)).join('')}</div>
    <button type="button" class="shop-btn sm" onclick="shopTermAdd('${px}')">＋ Termin</button></div>`;
}
function shopTermAdd(px){ const box=document.getElementById(px+'-terms'); if(box) box.insertAdjacentHTML('beforeend', _termRowHtml(px)); }
function _termRead(px, old){
  const prev={}; (old||[]).forEach(t=>{ if(t&&t.id) prev[t.id]=t; });
  return [...document.querySelectorAll('.'+px+'-term')].map(r=>({ id:r.dataset.id, art:r.querySelector('.tr-art').value, label:r.querySelector('.tr-label').value.trim(),
    datum:r.querySelector('.tr-datum').value, intervall:r.querySelector('.tr-int').value?Math.max(0,Math.round(_num(r.querySelector('.tr-int').value))):'',
    verlauf:(prev[r.dataset.id]&&prev[r.dataset.id].verlauf)||[] })).filter(t=>t.datum);
}

// ── Stücke verwalten (Verwalter) ──
let _unitSel=new Set();
let _unitBrand={};   // Filter je Artikel: '' = alle Marken, '—' = ohne Marke, sonst Markenname
// Alle bekannten Marken/Modelle (für Vorschläge beim Eintippen) – über alle Artikel hinweg
function _allBrands(){ const s=new Set(); items().forEach(it=>Object.values(it.units||{}).forEach(u=>{ if(u.marke) s.add(u.marke); })); return [...s].sort((a,b)=>a.localeCompare(b,'de',{sensitivity:'base'})); }
function _brandDatalist(id){ return `<datalist id="${id}">${_allBrands().map(b=>`<option value="${esc(b)}">`).join('')}</datalist>`; }
function _brandChip(u){ return u.marke?` <span class="shop-cat" style="background:#f3e8ff;color:#6b21a8">${esc(u.marke)}</span>`:''; }
function shopUnitBrand(itemId,v){ _unitBrand[itemId]=v; _unitSel.clear(); shopUnits(itemId); }
function shopUnitSelAll(itemId,on){
  const it=getShop('shopItems',itemId); if(!it) return;
  const f=_unitBrand[itemId]||'';
  unitsOf(it).filter(u=>!f||(f==='—'?!u.marke:u.marke===f)).forEach(u=>{ if(on) _unitSel.add(u.id); else _unitSel.delete(u.id); });
  shopUnits(itemId);
}
function shopUnits(itemId){
  if(!canManage()) return;
  const it=getShop('shopItems',itemId); if(!it) return;
  if(!isEinzeln(it)){ toast('Dieser Artikel wird nicht einzeln erfasst (✎ → „Einzeln erfassen").','err'); return; }
  const all=unitsOf(it);
  // Marken-Filter (nur anzeigen, wenn es überhaupt Marken gibt)
  const brands=[...new Set(all.map(u=>u.marke).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de',{sensitivity:'base'}));
  let f=_unitBrand[itemId]||''; if(f && f!=='—' && !brands.includes(f)) f=_unitBrand[itemId]='';
  const us=all.filter(u=>!f||(f==='—'?!u.marke:u.marke===f));
  _unitSel=new Set([..._unitSel].filter(id=>(it.units||{})[id]));
  const brandBar=brands.length?`<div class="shop-posadd" style="margin:0 0 6px"><span style="font-size:12px">Marke / Modell:</span>
      <select onchange="shopUnitBrand(${jsq(it.id)},this.value)"><option value="">Alle (${all.length})</option>${brands.map(b=>`<option value="${esc(b)}"${f===b?' selected':''}>${esc(b)} (${all.filter(u=>u.marke===b).length})</option>`).join('')}${all.some(u=>!u.marke)?`<option value="—"${f==='—'?' selected':''}>ohne Angabe (${all.filter(u=>!u.marke).length})</option>`:''}</select>
      <label style="font-size:12px;display:flex;gap:4px;align-items:center;white-space:nowrap;cursor:pointer"><input type="checkbox" style="width:auto" ${us.length&&us.every(u=>_unitSel.has(u.id))?'checked':''} onchange="shopUnitSelAll(${jsq(it.id)},this.checked)"> alle angezeigten markieren</label></div>`:'';
  const rows=us.map(u=>{ const nt=nextTermin(u.termine); const ul=unitLoan(u.id);
    return `<div class="shop-pos-row"><input type="checkbox" style="width:auto" ${_unitSel.has(u.id)?'checked':''} ${ul?'disabled title="zugeordnet – erst zurückgeben"':''} onchange="shopUnitSel(${jsq(u.id)},this.checked)">
      <span class="nm"><b>${esc(u.nr||'?')}</b>${_brandChip(u)}${u.serial?` <span style="color:var(--muted);font-size:11px">#${esc(u.serial)}</span>`:''}${u.note?` <span style="color:var(--muted);font-size:11px">· ${esc(u.note)}</span>`:''}</span>
      <span style="font-size:12px;white-space:nowrap">${ul?`<b style="color:${isZuord(ul)?_ZUORD_C:(_overdue(ul)?'#c0392b':'#2563eb')}">${isZuord(ul)?'👤':'🔁'} ${esc(bName(ul))}</b>`:esc(placeLabel(u.placeId))}</span>
      ${nt?dueBadge(nt):'<span style="font-size:11px;color:var(--muted)">kein Termin</span>'}
      ${ul?`${isZuord(ul)?`<button type="button" class="shop-btn sm" title="An anderen Mitarbeiter übergeben" onclick="shopReassign(${jsq(ul.id)})">👤</button>`:''}<button type="button" class="shop-btn sm ok" title="${isZuord(ul)?'Zuordnung aufheben':'Zurückgeben'}" onclick="shopReturn(${jsq(ul.id)})">↩</button>`:`<button type="button" class="shop-btn sm" title="Zuordnen / ausleihen" onclick="shopLendUnit(${jsq(it.id)},${jsq(u.id)})">🔁</button>`}
      <button type="button" class="shop-btn sm" onclick="shopUnitEdit(${jsq(it.id)},${jsq(u.id)})">✎</button>
      <button type="button" class="crm-x" style="border:none;background:none;color:#c0392b;cursor:pointer" title="Ausmustern / verbraucht" onclick="shopUnitRetire(${jsq(it.id)},${jsq(u.id)})">🗑</button></div>`; }).join('');
  openModal(`<h3>🏷️ Stücke – ${esc(itemLabel(it))}</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">${all.length} Stück${all.length===1?'':'e'}${f?` · angezeigt: ${us.length}`:''} · jedes mit eigenem Ort und eigenen Terminen. Die Menge je Ort ergibt sich daraus.</p>
    ${brandBar}
    <div class="shop-pos" style="max-height:48vh">${rows||`<div style="font-size:12px;color:var(--muted);padding:6px">${all.length?'Keine Stücke für diesen Filter.':'Noch keine Stücke – unten anlegen.'}</div>`}</div>
    ${us.length?`<div class="shop-posadd"><span id="su-selcount" style="font-size:12px">Markierte (${_unitSel.size}) verschieben nach</span>${_placeSelect('su-moveto','',false)}<button type="button" class="shop-btn sm" onclick="shopUnitsMove(${jsq(it.id)})">⇄ Verschieben</button></div>`:''}
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal();renderShop()">Schließen</button>
      <button class="btn btn-primary" onclick="shopUnitsAdd(${jsq(it.id)})">＋ Stücke anlegen</button></div>`, true);
}
function shopUnitSel(uid,on){ if(on) _unitSel.add(uid); else _unitSel.delete(uid); const s=document.getElementById('su-selcount'); if(s) s.textContent=`Markierte (${_unitSel.size}) verschieben nach`; }
function shopUnitsMove(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const to=_val('su-moveto'); const ids=[..._unitSel].filter(id=>(it.units||{})[id] && it.units[id].placeId!==to && !unitLoan(id));
  if(!ids.length){ toast('Bitte Stücke anhaken (die nicht schon dort liegen).','err'); return; }
  const byFrom={}; ids.forEach(id=>{ const u=it.units[id]; (byFrom[u.placeId]=byFrom[u.placeId]||[]).push(u.nr); u.placeId=to; });
  _syncStock(it); saveShop('shopItems', it);
  Object.keys(byFrom).forEach(from=>_log(it,'umlagern',byFrom[from].length,from,to,'Stücke: '+byFrom[from].join(', ')));
  _unitSel.clear(); toast(`${ids.length} Stück${ids.length===1?'':'e'} → ${placeLabel(to)} ✓`,'ok'); shopUnits(itemId);
}
function shopUnitsAdd(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const n0=unitsOf(it).length;
  openModal(`<h3>＋ Stücke anlegen – ${esc(itemLabel(it))}</h3>
    <div class="shop-f2"><div class="shop-f"><label>Anzahl</label><input id="ua-n" type="number" min="1" max="200" step="1" value="1"></div>
      <div class="shop-f"><label>Ort</label>${_placeSelect('ua-pl', fPlace, false)}</div></div>
    <div class="shop-f2"><div class="shop-f"><label>Bezeichnung</label><input id="ua-pre" value="${esc(it.name)} " placeholder="z. B. Weste "></div>
      <div class="shop-f"><label>Nummern ab</label><input id="ua-start" type="number" min="0" step="1" value="${n0+1}"></div></div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 8px">Ergibt z. B. „${esc(it.name)} ${String(n0+1).padStart(2,'0')}", „${esc(it.name)} ${String(n0+2).padStart(2,'0')}" … (später einzeln änderbar, z. B. auf den eingestickten Namen)</p>
    <div class="shop-f"><label>Marke / Modell <span style="font-weight:400;color:var(--muted)">(optional, für alle neuen Stücke)</span></label><input id="ua-marke" list="ua-brands" placeholder="z. B. Secumar 275" autocomplete="off">${_brandDatalist('ua-brands')}</div>
    ${_termEditorHtml('ua',[])}
    <div class="modal-btns"><button class="btn btn-outline" onclick="shopUnits(${jsq(itemId)})">Zurück</button>
      <button class="btn btn-primary" onclick="shopUnitsAddSave(${jsq(itemId)})">Anlegen</button></div>`);
}
function shopUnitsAddSave(itemId){
  const it=getShop('shopItems',itemId); if(!it) return;
  const n=Math.round(_num(_val('ua-n'))); if(n<1||n>200){ toast('Anzahl zwischen 1 und 200.','err'); return; }
  const pl=_val('ua-pl'); if(!pl){ toast('Bitte einen Ort wählen.','err'); return; }
  const pre=(document.getElementById('ua-pre')||{}).value||''; const start=Math.round(_num(_val('ua-start')));
  const termTpl=_termRead('ua',[]); const width=Math.max(2,String(start+n-1).length); const marke=_val('ua-marke');
  if(!it.units||typeof it.units!=='object') it.units={};
  for(let i=0;i<n;i++){ const id=newId();
    it.units[id]={ id, nr:(pre+String(start+i).padStart(width,'0')).trim(), marke, serial:'', placeId:pl, note:'', termine:termTpl.map(t=>Object.assign({},t,{id:newId(),verlauf:[]})) }; }
  _syncStock(it); saveShop('shopItems', it); _log(it,'zugang',n,null,pl,'Stücke angelegt');
  toast(`${n} Stück${n===1?'':'e'} angelegt ✓`,'ok'); shopUnits(itemId);
}
function shopUnitEdit(itemId, unitId){
  const it=getShop('shopItems',itemId); const u=it&&it.units&&it.units[unitId]; if(!u) return;
  openModal(`<h3>✎ ${esc(itemLabel(it))} · ${esc(u.nr||'')}</h3>
    <div class="shop-f2"><div class="shop-f"><label>Bezeichnung * <span style="font-weight:400;color:var(--muted)">(z. B. eingestickter Name)</span></label><input id="ue-nr" value="${esc(u.nr||'')}"></div>
      <div class="shop-f"><label>Marke / Modell</label><input id="ue-marke" list="ue-brands" value="${esc(u.marke||'')}" placeholder="z. B. Secumar 275" autocomplete="off">${_brandDatalist('ue-brands')}</div></div>
    <div class="shop-f"><label>Seriennummer</label><input id="ue-serial" value="${esc(u.serial||'')}" placeholder="optional"></div>
    <div class="shop-f2"><div class="shop-f"><label>Ort</label>${unitLoan(u.id)?`<div style="font-size:13px;padding:6px 0">🏷️ bei <b>${esc(bName(unitLoan(u.id)))}</b> – Rückgabe über „↩"</div>`:_placeSelect('ue-pl', u.placeId, false)}</div>
      <div class="shop-f"><label>Notiz</label><input id="ue-note" value="${esc(u.note||'')}" placeholder="z. B. Größe L, Farbe"></div></div>
    ${_termEditorHtml('ue', u.termine)}
    <div class="modal-btns"><button class="btn btn-outline" onclick="shopUnits(${jsq(itemId)})">Zurück</button>
      <button class="btn btn-primary" onclick="shopUnitSave(${jsq(itemId)},${jsq(unitId)})">Speichern</button></div>`);
}
function shopUnitSave(itemId, unitId){
  const it=getShop('shopItems',itemId); const u=it&&it.units&&it.units[unitId]; if(!u) return;
  const nr=_val('ue-nr'); if(!nr){ toast('Bitte eine Bezeichnung eingeben.','err'); return; }
  const from=u.placeId, to=unitLoan(unitId)?from:_val('ue-pl');   // zugeordnet → Ort bleibt leer bis zur Rückgabe
  Object.assign(u,{ nr, marke:_val('ue-marke'), serial:_val('ue-serial'), note:_val('ue-note'), placeId:to, termine:_termRead('ue', u.termine) });
  _syncStock(it); saveShop('shopItems', it);
  if(to!==from) _log(it,'umlagern',1,from,to,'Stück: '+nr);
  toast('Gespeichert ✓','ok'); shopUnits(itemId);
}
// Ausmustern / verbraucht – Verwalter aus „Stücke", alle über „➖ Verbrauch"
function shopUnitRetire(itemId, unitId, fromUse){
  const it=getShop('shopItems',itemId); const u=it&&it.units&&it.units[unitId]; if(!u) return;
  const why=prompt(`„${u.nr}" ausmustern / als verbraucht melden?\nGrund (optional):`, fromUse?'verbraucht':''); if(why===null) return;
  const ul=unitLoan(unitId);   // war zugeordnet → Zuordnung mit beenden
  if(ul){ ul.status='zurueck'; ul.qty=0; ul.returnedTs=Date.now(); ul.note=(ul.note?ul.note+' · ':'')+'ausgemustert'; saveShop('shopLoans', ul); }
  const pl=u.placeId||(ul&&ul.fromPlace)||''; delete it.units[unitId]; _syncStock(it); saveShop('shopItems', it);
  _log(it,'verbrauch',1,pl,null,'Stück: '+u.nr+(why?' · '+why:''));
  const s=sollAt(it,pl), ist=_num((it.stock||{})[pl]);
  toast(s&&ist<s?`${u.nr} ausgebucht ✓ – ${placeLabel(pl)} jetzt unter Soll (${ist}/${s}), Nachschub automatisch bestellt.`:`${u.nr} ausgebucht ✓`,'ok');
  if(fromUse){ closeModal(); renderShop(); } else shopUnits(itemId);
}
// „➖ Verbrauch" bei Einzelstücken: konkretes Stück wählen (für alle Nutzer)
function _unitUse(it){
  const us=unitsOf(it); if(!us.length){ toast('Keine Stücke vorhanden.','err'); return; }
  openModal(`<h3>➖ Verbrauch melden – ${esc(itemLabel(it))}</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Welches Stück wurde benutzt / ist kaputt?</p>
    <div class="shop-pos" style="max-height:50vh">${us.map(u=>{ const nt=nextTermin(u.termine);
      return `<div class="shop-pos-row"><span class="nm"><b>${esc(u.nr||'?')}</b>${_brandChip(u)} · ${esc(placeLabel(u.placeId))}</span>${nt?dueBadge(nt):''}
        <button type="button" class="shop-btn sm" onclick="shopUnitRetire(${jsq(it.id)},${jsq(u.id)},true)">➖ Verbraucht</button></div>`; }).join('')}</div>
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button></div>`);
}

// ── Tab „⏰ Fällig" (alle sehen; Erledigt/✎ nur Verwalter) ──
let fDue='soon';
function _dueHtml(mgr){
  const all=allDue().filter(d=>_teamMatch(dueTeams(d)));
  const lim={ over:_todayIso(), soon:_soonIso(30), q:_soonIso(90), all:'9999' }[fDue]||_soonIso(30);
  const list=all.filter(d=>fDue==='over' ? d.t.datum<_todayIso() : d.t.datum<=lim);
  const seg=[['over','Überfällig'],['soon','≤ 30 Tage'],['q','≤ 90 Tage'],['all','Alle']];
  const rows=list.map(d=>`<div class="shop-row"${dueState(d.t.datum)==='over'?' style="border-color:#e5484d"':''}><div class="main">
      <div class="t">${d.kind==='place'?'📍 ':'🏷️ '}${esc(d.title)} ${dueBadge(d.t)} ${_teamChip(dueTeams(d)[0])}</div>
      <div class="m">${esc((TERMIN_ART[d.t.art]||TERMIN_ART.pruefung).l)}${d.t.intervall?` · alle ${_num(d.t.intervall)} Monate`:' · einmalig'}${d.where?' · '+esc(d.where):''}${(d.t.verlauf||[]).length?` · zuletzt erledigt ${_fmtDate(d.t.verlauf[d.t.verlauf.length-1].am)}`:''}</div></div>
      ${mgr?`<div style="display:flex;gap:5px;flex-wrap:wrap"><button class="shop-btn sm ok" onclick="shopDueDone(${jsq(d.key)})">✓ Erledigt</button>
        ${d.kind==='unit'?`<button class="shop-btn sm" onclick="shopUnitEdit(${jsq(d.itemId)},${jsq(d.unitId)})">✎</button>`:`<button class="shop-btn sm" onclick="shopPlaceEdit(${jsq(d.placeId)})">✎</button>`}</div>`:''}</div>`).join('');
  const nOver=all.filter(d=>d.t.datum<_todayIso()).length;
  return `<div class="shop-bar"><span class="shop-seg">${seg.map(s=>`<button class="${fDue===s[0]?'on':''}" onclick="shopSetDue(${jsq(s[0])})">${s[1]}${s[0]==='over'&&nOver?` (${nOver})`:''}</button>`).join('')}</span>
      ${_teamFilterHtml()}
      <span class="shop-sp"></span><span style="font-size:12px;color:var(--muted)">${mgr?'Termine an Stücken (✎ Artikel → „Einzeln erfassen") und an Orten (📍 Orte → ✎)':'Nur Ansicht – erledigt melden die Verwalter.'}</span></div>
    <div class="shop-list">${rows||`<div class="shop-empty">${all.length?'Nichts fällig in diesem Zeitraum. ✓':'Noch keine Termine erfasst.'}</div>`}</div>`;
}
function shopSetDue(v){ fDue=v; renderShop(); }
function _dueFind(key){
  const [k,a,b,c]=String(key).split('|');
  if(k==='u'){ const it=getShop('shopItems',a); const u=it&&it.units&&it.units[b]; const t=u&&(u.termine||[]).find(x=>x.id===c); return t?{kind:'unit',it,u,t}:null; }
  const p=getShop('shopPlaces',a); const t=p&&(p.termine||[]).find(x=>x.id===b); return t?{kind:'place',p,t}:null;
}
function shopDueDone(key){
  if(!canManage()) return;
  const f=_dueFind(key); if(!f){ toast('Termin nicht gefunden.','err'); return; }
  const t=f.t, title=f.kind==='unit'?_unitTitle(f.it,f.u):placeLabel(f.p.id);
  const iv=_num(t.intervall);
  openModal(`<h3>✓ Erledigt – ${esc(title)}</h3>
    <p style="font-size:13px;margin:0 0 10px">${esc((TERMIN_ART[t.art]||TERMIN_ART.pruefung).l)}${t.label?' · '+esc(t.label):''} · fällig ${_fmtDate(t.datum)}</p>
    <div class="shop-f2"><div class="shop-f"><label>Erledigt am</label><input id="dd-am" type="date" value="${_todayIso()}" onchange="${iv?`document.getElementById('dd-next').value=shopAddMonths(this.value,${iv})`:''}"></div>
      <div class="shop-f"><label>${t.art==='ablauf'?'Neues Ablaufdatum (nach Austausch)':'Nächster Termin'}${iv?` <span style="font-weight:400;color:var(--muted)">(+${iv} Mon.)</span>`:''}</label><input id="dd-next" type="date" value="${iv?_addMonths(_todayIso(),iv):''}"></div></div>
    <div class="shop-f"><label>Notiz</label><input id="dd-note" placeholder="z. B. Prüfer, Ergebnis, neue Charge"></div>
    ${f.kind==='unit'?'<p style="font-size:12px;color:var(--muted);margin:0">Ohne neues Datum? Dann das Stück lieber unter „🏷️ Stücke" ausmustern.</p>':''}
    <div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="shopDueDoneSave(${jsq(key)})">Speichern</button></div>`);
}
function shopDueDoneSave(key){
  const f=_dueFind(key); if(!f) return;
  const am=_val('dd-am')||_todayIso(), next=_val('dd-next'), note=_val('dd-note'), cu=_me();
  if(!next){ toast('Bitte das nächste Datum angeben.','err'); return; }
  if(!Array.isArray(f.t.verlauf)) f.t.verlauf=[];
  f.t.verlauf.push({ am, faellig:f.t.datum, by:cu.name||'', note }); f.t.datum=next;
  const lbl=(f.t.label||(TERMIN_ART[f.t.art]||TERMIN_ART.pruefung).l);
  if(f.kind==='unit'){ saveShop('shopItems', f.it); _log(f.it,'termin',1,f.u.placeId,null,`${f.u.nr}: ${lbl} erledigt ${_fmtDate(am)} → nächster ${_fmtDate(next)}${note?' · '+note:''}`); }
  else { saveShop('shopPlaces', f.p);
    saveShop('shopLog',{ id:newId(), ts:Date.now(), byId:cu.id||'', byName:cu.name||'', itemId:null, itemName:'📍 '+f.p.name, type:'termin', qty:1, from:f.p.id, to:null,
      note:`${lbl} erledigt ${_fmtDate(am)} → nächster ${_fmtDate(next)}${note?' · '+note:''}`, orderId:null }); }
  closeModal(); toast('Erledigt ✓ – nächster Termin '+_fmtDate(next),'ok'); renderShop();
}
function shopAddMonths(iso,m){ return _addMonths(iso,m); }
function shopDueNoticeOpen(){ TAB='faellig'; fDue='soon'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
function shopDueAck(){ try{ localStorage.setItem('tps_shop_due_ack_'+(_me().id||''), _todayIso()); }catch(e){} _noticesRefresh(); }

// ── Tab: Orte ──────────────────────────────────────────────────────
function _orteHtml(){
  const its=items();
  const rows=places().map(p=>{
    const here=its.filter(i=>_num((i.stock||{})[p.id])>0);
    const n=here.reduce((s,i)=>s+_num(i.stock[p.id]),0);
    const z=placeZuord(p.id), le=placeLeihe(p.id);
    return `<div class="shop-row"${le&&_overdue(le)?' style="border-color:#e5484d"':''}><div class="main"><div class="t">${esc(placeLabel(p.id))} ${_teamChip(p.team)} ${(()=>{ const nt=nextTermin(p.termine); return nt?dueBadge(nt):""; })()}
        ${z?`<span class="shop-st" style="background:${_ZUORD_C}">👤 ${esc(bName(z))}</span>`:''}
        ${le?`<span class="shop-st" style="background:${_overdue(le)?'#c0392b':'#2563eb'}">🔁 ausgeliehen an ${esc(bName(le))}${le.due?' bis '+_fmtDate(le.due):' (Dauerleihe)'}</span>`:''}</div>
      <div class="m">${here.length?`${here.length} Artikel · ${n} Teile: `+here.slice(0,6).map(i=>esc(i.name)+' ('+_num(i.stock[p.id])+')').join(', ')+(here.length>6?' …':''):'leer'}${p.note?'<br>📝 '+esc(p.note):''}</div></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${isMovable(p)?`
        ${z?`<button class="shop-btn sm" onclick="shopReassign(${jsq(z.id)})" title="An anderen Mitarbeiter übergeben">👤 Übergeben</button>`:`<button class="shop-btn sm" onclick="shopLendPlace(${jsq(p.id)},'zuord')">👤 Zuordnen</button>`}
        ${le?`<button class="shop-btn sm ok" onclick="shopReturn(${jsq(le.id)})">↩ Zurück</button>`:`<button class="shop-btn sm" onclick="shopLendPlace(${jsq(p.id)},'leihe')">🔁 Ausleihen</button>`}`:''}
      <button class="shop-btn sm" onclick="shopSetPlace(${jsq(p.id)});shopTab('bestand')">Ansehen</button>
      <button class="shop-btn sm" onclick="shopPlaceEdit(${jsq(p.id)})">✎</button></div></div>`;
  }).join('');
  const bws=_borrowers();
  const bRows=bws.map(b=>`<div class="shop-row"><div class="main"><div class="t">${esc(b.label)}</div>
      <div class="m">${b.loans.length} Leihe${b.loans.length===1?'':'n'} · `+b.loans.map(l=>`${_num(l.qty)}× ${esc(l.itemName||'')}${l.due?` (bis <span class="${_overdue(l)?'shop-late':''}">${_fmtDate(l.due)}</span>)`:' (dauerhaft)'}`).join(', ')+`</div></div>
      <div style="display:flex;gap:5px"><button class="shop-btn sm" onclick="shopSetPlace(${jsq('loan:'+b.key)});shopTab('bestand')">Ansehen</button></div></div>`).join('');
  return `<div class="shop-bar"><span style="font-size:13px;color:var(--muted)">Wo liegen Sachen? Büro, Bus, Boote, Lager …</span><span class="shop-sp"></span>
    <button class="shop-btn pri" onclick="shopPlaceEdit('')">＋ Ort</button></div>
    <div class="shop-list">${rows||'<div class="shop-empty">Noch keine Orte angelegt.</div>'}</div>
    ${bRows?`<h4 style="margin:18px 0 8px;color:var(--primary,#203869)">🔁 Unterwegs bei (ausgeliehen)</h4><div class="shop-list">${bRows}</div>`:''}
    ${_orgSettingHtml()}`;
}
function _orgSettingHtml(){
  const o=shopOrg(); const e=_orgEntity(); const cur=o?o.tree+'::'+o.eid:'';
  const opts=_crmEntities().sort((a,b)=>a.name.localeCompare(b.name,'de',{sensitivity:'base'}))
    .map(x=>`<option value="${esc(x.tree)}::${esc(x.eid)}"${(o&&!o.auto&&cur===x.tree+'::'+x.eid)?' selected':''}>${esc(x.name)}</option>`).join('');
  const n=e?(e.kontakte||[]).length:0;
  return `<h4 style="margin:18px 0 8px;color:var(--primary,#203869)">🏢 Eigene Organisation im CRM</h4>
    <div class="shop-row"><div class="main"><div class="m" style="font-size:13px;color:var(--text)">Die Adressen der Mitarbeiter kommen aus den <b>CRM-Kontakten</b> dieses Eintrags (Zuordnung per E-Mail oder Name) – im Profil gepflegt, nichts doppelt.
      <br>Aktuell: <b>${e?esc((e.stamm&&e.stamm.name)||''):'– nicht gefunden –'}</b>${o&&o.auto?' (automatisch erkannt)':''}${e?` · ${n} Kontakt${n===1?'':'e'}`:''}</div></div>
      <select onchange="shopSetOrg(this.value)" style="padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;max-width:280px"><option value="">🔍 Automatisch („Turning Point")</option>${opts}</select></div>`;
}
// Alle, die gerade etwas ausgeliehen haben – gruppiert (Mitarbeiter, CRM-Einträge, freie Namen)
function _borrowers(){
  const m={};
  activeLoans().filter(l=>!l.placeId).forEach(l=>{ const k=bKey(l); (m[k]=m[k]||{key:k, label:bLabel(l), loans:[]}).loans.push(l); });
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
    ${_teamSelectHtml('sp-team', v.team||'', 'z. B. Trailer → Akademie: TÜV & Nachbestellungen melden sich nur dort')}
    ${_termEditorHtml('sp', v.termine)}
    <div class="modal-btns">${p?`<button class="btn btn-outline" style="margin-right:auto;color:var(--danger);border-color:var(--danger)" onclick="shopPlaceDelete(${jsq(p.id)})">🗑 Löschen</button>`:''}
    <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
    <button class="btn btn-primary" onclick="shopPlaceSave(${jsq(id||'')})">Speichern</button></div>`);
}
function shopPlaceSave(id){
  const name=_val('sp-name'); if(!name){ toast('Bitte einen Namen eingeben.','err'); return; }
  const ex=id?getShop('shopPlaces',id):null;
  if(places().some(p=>p.id!==id && String(p.name).toLowerCase()===name.toLowerCase())){ toast('Einen Ort mit diesem Namen gibt es schon.','err'); return; }
  saveShop('shopPlaces', Object.assign({}, ex||{id:newId(), createdAt:Date.now()}, {name, typ:_val('sp-typ')||'sonst', note:_val('sp-note'), team:_val('sp-team'), termine:_termRead('sp', ex&&ex.termine)}));
  closeModal(); toast('Ort gespeichert ✓','ok'); renderShop();
}
function shopPlaceDelete(id){
  const p=getShop('shopPlaces',id); if(!p) return;
  if(placeLoan(id)){ toast(`„${p.name}" ist gerade zugeordnet – erst zurückgeben.`,'err'); return; }
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
  _autoReorder();   // auch ohne geöffneten Shop: Unterschreitungen sofort als Bestellung anlegen (idempotent)
  const mgr=canManage(); const out=[]; const held=myHeld();
  orders().forEach(o=>{
    const heldPl=!!(o.ortId && held.places.has(o.ortId));   // für „meinen" Ort (Bus/Boot/Anhänger mir zugeordnet)
    if(o.status==='offen' && o.byId!==cu.id && !(o.seenBy&&o.seenBy[cu.id]) && ((mgr && forMe(orderTeams(o))) || heldPl)){
      out.push({ ts:o.ts, html:`🛒 Neue Bestellung von <b>${esc(o.byName||'?')}</b>${heldPl?` für ${esc(placeLabel(o.ortId))} (dir zugeordnet)`:''}: ${_orderWhat(o)}${o.termin?` (bis ${_fmtDate(o.termin)})`:''}${o.anlass?' – '+esc(o.anlass):''}`,
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
    const what=(l.placeId||l.unitId)?`${loanIcon(l)} <b>${esc(l.placeId?placeLabel(l.placeId):(l.itemName||''))}</b>`:`${_num(l.qty)}× ${esc(l.itemName||'')}`;
    if(!l.ackBorrower) out.push({ ts:l.ts, html:`🔁 <b>${esc(l.byName||'Der Shop')}</b> hat dir ${what} ${isZuord(l)?'dauerhaft zugeordnet':(l.due?'ausgeliehen – bitte zurückgeben bis <b>'+_fmtDate(l.due)+'</b>':'als Dauerleihe ausgeliehen')}${l.placeId?' (mit Inhalt – du bekommst jetzt auch dessen Termine &amp; Bestellungen)':''}.`,
      open:'shopLoanNoticeOpen()', ack:`shopLoanAck(${JSON.stringify(l.id)})` });
    else if(_overdue(l) && l.ackOverdue!==today) out.push({ ts:Date.now(), html:`⏰ Bitte zurückgeben: ${what} – war bis <b>${_fmtDate(l.due)}</b> ausgeliehen.`,
      open:'shopLoanNoticeOpen()', ack:`shopLoanSnooze(${JSON.stringify(l.id)})` });
  });
  if(mgr){
    const late=activeLoans().filter(l=>_overdue(l) && l.borrowerId!==cu.id && forMe(loanTeams(l)));
    let acked=''; try{ acked=localStorage.getItem('tps_shop_od_ack_'+cu.id)||''; }catch(e){}
    if(late.length && acked!==today) out.push({ ts:Date.now(), html:`⏰ ${late.length} Ausleihe${late.length===1?'':'n'} überfällig: `+late.slice(0,3).map(l=>`${_num(l.qty)}× ${esc(l.itemName||'')} (${esc(bName(l))}, seit ${_fmtDate(l.due)})`).join(', ')+(late.length>3?' …':''),
      open:'shopLoanNoticeOpen()', ack:'shopLoanMgrAck()' });
    // (Orte unter Soll-Bestand melden sich jetzt als automatische Bestellung → „Neue Bestellung"-Mitteilung oben)
  }
  // Termine (Ablauf / Prüfung / TÜV): überfällig oder in ≤ 14 Tagen – Sammelmeldung, 1× pro Tag.
  // Verwalter: fürs eigene Team · ALLE zusätzlich für das, was ihnen zugeordnet ist (Trailer, Weste …)
  const due=allDue().filter(d=>d.t.datum<=_soonIso(14) && ((mgr && forMe(dueTeams(d))) || dueHeld(d,held)));
  let ackD=''; try{ ackD=localStorage.getItem('tps_shop_due_ack_'+cu.id)||''; }catch(e){}
  if(due.length && ackD!==today){ const over=due.filter(d=>d.t.datum<_todayIso()).length;
    out.push({ ts:Date.now(), html:`⏰ ${due.length} Termin${due.length===1?'':'e'} fällig${over?` (${over} überfällig)`:''}: `+due.slice(0,3).map(d=>`${esc(d.title)} – ${esc(d.t.label||(TERMIN_ART[d.t.art]||TERMIN_ART.pruefung).l)} ${_fmtDate(d.t.datum)}`).join(' · ')+(due.length>3?' …':''),
      open:'shopDueNoticeOpen()', ack:'shopDueAck()' }); }
  return out.sort((a,b)=>(b.ts||0)-(a.ts||0));
}
function shopRefillNoticeOpen(){ TAB='nachfuellen'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
// Für die Startseite (js/home.js): was im Shop für MICH ansteht – gleiche Regeln wie Mitteilungen/Zähler
// (Team bzw. mir zugeordnet). → { due:[{title,label,datum,over}], orders:n }
function shopHomeItems(){
  try{
    if(!window.cu || !canUse()) return { due:[], orders:0 };
    const mgr=canManage(), me=_me(), held=myHeld();
    const due=allDue().filter(d=>d.t.datum<=_soonIso(14) && (forMe(dueTeams(d)) || dueHeld(d,held)))
      .map(d=>({ title:d.title, label:d.t.label||(TERMIN_ART[d.t.art]||TERMIN_ART.pruefung).l, datum:d.t.datum, over:d.t.datum<_todayIso() }));
    const os=orders().filter(o=>mgr ? (o.status==='offen' && (forMe(orderTeams(o)) || held.places.has(o.ortId)))
      : ((o.byId===me.id || held.places.has(o.ortId)) && (o.status==='offen'||o.status==='inarbeit')));
    return { due, orders:os.length, mgr };
  }catch(e){ return { due:[], orders:0 }; }
}
function shopOpenTab(t){ TAB=t||'bestand'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
try{ window.shopHomeItems=shopHomeItems; window.shopOpenTab=shopOpenTab; }catch(e){}
function shopRefillAck(){ try{ localStorage.setItem('tps_shop_soll_ack_'+(_me().id||''), _todayIso()); }catch(e){} _noticesRefresh(); }
function shopLoanNoticeOpen(){ TAB='ausleihen'; fLoan='aktiv'; try{ window.switchModule && window.switchModule('shop'); }catch(e){} }
function _noticesRefresh(){ try{ window.renderZeNotices&&window.renderZeNotices(); }catch(e){} }
function shopLoanAck(id){ const l=getShop('shopLoans',id); if(!l) return; l.ackBorrower=true; saveShop('shopLoans', l); _noticesRefresh(); }
function shopLoanSnooze(id){ const l=getShop('shopLoans',id); if(!l) return; l.ackOverdue=_todayIso(); saveShop('shopLoans', l); _noticesRefresh(); }
function shopLoanMgrAck(){ try{ localStorage.setItem('tps_shop_od_ack_'+(_me().id||''), _todayIso()); }catch(e){} _noticesRefresh(); }
function shopNoticeOpen(id){
  const o=getShop('shopOrders',id);
  if(o){ const cu=_me(); if(o.byId===cu.id && o.status!=='offen' && o.status!=='inarbeit') shopNoticeAck(id); else if(o.byId!==cu.id) shopNoticeSeen(id); }
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
  shopLoansForEntity, shopOpenBorrower, shopSend, shopSendSave, shopGetAddr, shopSaveAddr, shopOrderNameChg, shopSetOrg, shopPickItem, shopCartAdd, shopCartAddFree, shopPosAddSel, shopCartQty, shopCartFrom, shopCartDel, shopCartClear, shopCartToggle, shopCartSend, shopCartSendSave, shopIssueModeChg, shopUse, shopUseSave, shopRefillNoticeOpen, shopRefillAck, shopTermAdd, shopUnits, shopUnitSel, shopUnitBrand, shopUnitSelAll, shopUnitsMove, shopUnitsAdd, shopUnitsAddSave, shopUnitEdit, shopUnitSave, shopUnitRetire, shopSetDue, shopDueDone, shopDueDoneSave, shopAddMonths, shopDueNoticeOpen, shopDueAck,
  shopLend, shopLendSave, shopLendPlace, shopLendPlaceSave, shopLendUnit, shopLendUnitSave, shopPickLendGo, shopLendArtChg, shopReassign, shopReassignSave, shopReturn, shopReturnSave, shopLoanDue, shopLoanDueSave, shopSetLoan,
  shopNotices, shopNoticeOpen, shopNoticeSeen, shopNoticeAck, shopSetTeam,
  shopLoanNoticeOpen, shopLoanAck, shopLoanSnooze, shopLoanMgrAck });

// ── Backup-Anbindung (Verwaltung → Daten & Backup) – über window, Laufzeit-Prüfung statt
//    benannter Importe (siehe Kopf: Namespace-Import gegen Cache-Mischzustände) ──
window.shopExportBlob   = ()=> CD.exportShopBlob ? CD.exportShopBlob() : null;
window.shopRestoreBlob  = (o)=> CD.restoreShopBlob ? CD.restoreShopBlob(o) : Promise.resolve();
window.crmSplitShop     = (o)=> CD.splitShopFromCrm ? CD.splitShopFromCrm(o) : { crm:o, shop:null };
// true nur, wenn die NEUE (CRM/Shop trennende) Datenschicht geladen ist – der Import prüft das,
// damit ein Gerät mit altem Cache beim CRM-Restore nie versehentlich den Shop mit ersetzt.
window.crmBackupSplitReady = !!(CD.splitShopFromCrm && CD.restoreShopBlob);
