// js/messe.js — MESSEMODUS: PIN-gesperrter Vollbild-Erfassungsmodus für Tablets.
// Besucher sehen nur das eigene, leere Formular; Personal (PIN) sieht die Liste und überträgt ins CRM.
//
// GEMEINSAME ABLAGE (seit v439): Veranstaltungen und erfasste Kontakte liegen in der Datenbank unter
// messe/ (eigener Knoten, nur für Messe-Berechtigte lesbar – Regeln v7, grants/messe_nutzen):
//   messe/events/<ev>          { name, cats[], catLabels{}, pinHash, pinSalt, createdAt, createdBy }
//   messe/entries/<ev>/<id>    { vorname, nachname, org, email, tel, adresse, note, ts, by, dev }
//   messe/transferred/<ev>/<id>{ by, at, crmId }   ← Marker ohne Personendaten (Zähler + Doppelschutz)
// Alle Geräte sehen dieselben Veranstaltungen und Listen live.
//
// OFFLINE: Neue Kontakte (und Veranstaltungen) landen zuerst im Ausgang des Geräts (localStorage
// `tps_messe_v2`.outbox) und werden automatisch nachgeschickt, sobald wieder Netz da ist. Die
// Veranstaltungen (ohne Personendaten) sind lokal zwischengespeichert, damit der Messemodus auch
// ohne Netz startet. Die Besucherdaten anderer Geräte werden NICHT auf dem Gerät abgelegt.
//
// ÜBERTRAG ins CRM (online): je Kontakt zuerst den Marker anlegen („ich übertrage") → nur ein Gerät
// gewinnt → CRM-Kontakt anlegen → Besucherdaten unter messe/entries löschen (Datensparsamkeit).
//
// PIN: eine je Veranstaltung, für alle Geräte gleich; gespeichert wird nur SHA-256(Salz + PIN).

import { saveEntity, newId, ensureCrmReady } from './crm/crm-data.js';
import { getCategories, getTrees } from './crm/crm-config.js';
import { toast } from './utils.js';

const LS_OLD = 'tps_messe_v1';   // alter, rein lokaler Stand (wird einmalig in die Cloud übernommen)
const LS = 'tps_messe_v2';       // { activeId, events:{id:ev ohne Personendaten}, outbox:[…] }
const _esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const _jsq = s => _esc(JSON.stringify(String(s==null?'':s)));
function _newEid(){ return 'ev'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function _newMid(){ return 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function _me(){ return (window.cu&&window.cu.id)||''; }
function _dev(){ try{ let d=localStorage.getItem('tps_messe_dev'); if(!d){ d='d'+Math.random().toString(36).slice(2,8); localStorage.setItem('tps_messe_dev',d); } return d; }catch(e){ return 'd?'; } }

// ── Lokaler Zustand ──
function _load(){ try{ const s=JSON.parse(localStorage.getItem(LS)); if(s&&typeof s==='object') return { activeId:s.activeId||'', events:s.events||{}, outbox:Array.isArray(s.outbox)?s.outbox:[], kiosk:!!s.kiosk }; }catch(e){} return { activeId:'', events:{}, outbox:[] }; }
function _save(s){ try{ localStorage.setItem(LS, JSON.stringify(s)); }catch(e){} }
let L=_load();

// ── Cloud (Live) ──
let _ref=null, _live=null, _connCb=null, _conn=false, _srv={ events:null, entries:{}, transferred:{} }, _flushTimer=null;
function _fbOk(){ try{ return !!(window.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser); }catch(e){ return false; } }
function _online(){ return navigator.onLine && _conn; }
function _subscribe(){
  if(_live || !_fbOk()) return;
  try{
    _ref=firebase.database().ref('messe');
    _connCb=snap=>{ _conn=!!snap.val(); if(_conn) _flush(); _rerender(); };
    firebase.database().ref('.info/connected').on('value', _connCb);
    _live=_ref.on('value', snap=>{
      const v=snap.val()||{};
      _srv={ events:v.events||{}, entries:v.entries||{}, transferred:v.transferred||{} };
      // Veranstaltungen (ohne Personendaten) lokal merken → Offline-Start
      L.events=Object.assign({}, _srv.events); _save(L);
      _rerender();
    }, err=>{ console.warn('Messe: kein Lesezugriff', err&&err.code); _srv.events=null; _rerender(); });
  }catch(e){ console.warn('Messe-Abo:', e); }
  if(!_flushTimer) _flushTimer=setInterval(_flush, 20000);
}
function _unsubscribe(){
  try{ if(_ref&&_live) _ref.off('value', _live); if(_connCb) firebase.database().ref('.info/connected').off('value', _connCb); }catch(e){}
  _connCb=null;
  _live=null; _ref=null; if(_flushTimer){ clearInterval(_flushTimer); _flushTimer=null; }
}
window.addEventListener('online', ()=>{ _flush(); _rerender(); });
window.addEventListener('offline', ()=>_rerender());

// Ausgang nachschicken (Veranstaltungen zuerst, dann Kontakte)
let _flushing=false;
async function _flush(){
  if(_flushing || !L.outbox.length || !_fbOk() || !navigator.onLine) return;
  _flushing=true;
  try{
    const db=firebase.database();
    for(const it of L.outbox.slice()){
      const path = it.t==='ev' ? 'messe/events/'+it.ev : 'messe/entries/'+it.ev+'/'+it.id;
      try{
        await Promise.race([ db.ref(path).set(it.data), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),15000)) ]);
        L.outbox=L.outbox.filter(x=>!(x.t===it.t && x.ev===it.ev && x.id===it.id)); _save(L);
      }catch(e){
        const denied=/permission/i.test(String((e&&e.code)||'')+' '+String(e&&e.message||''));
        if(denied){ toast('Messe: keine Berechtigung zum Speichern in der gemeinsamen Ablage – bitte Administrator fragen.','err'); }
        break;   // später erneut versuchen (Reihenfolge erhalten)
      }
    }
  }finally{ _flushing=false; _rerender(); }
}
function _queue(item){ L.outbox=L.outbox.filter(x=>!(x.t===item.t && x.ev===item.ev && x.id===item.id)); L.outbox.push(item); _save(L); _flush(); }

// Zusammengeführte Sicht (Cloud + eigener Ausgang)
function _events(){
  const m=Object.assign({}, _srv.events||L.events||{});
  L.outbox.filter(x=>x.t==='ev').forEach(x=>{ m[x.ev]=Object.assign({}, x.data); });
  return Object.keys(m).map(id=>Object.assign({ id }, m[id])).filter(e=>e&&e.name).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
}
function _event(id){ return _events().find(e=>e.id===id)||null; }
function _active(){ const ev=_event(L.activeId); return ev||null; }
function _entries(evId){
  const out=[];
  const srv=(_srv.entries&&_srv.entries[evId])||{};
  Object.keys(srv).forEach(id=>out.push(Object.assign({ id, pending:false }, srv[id])));
  L.outbox.filter(x=>x.t==='en'&&x.ev===evId&&!srv[x.id]).forEach(x=>out.push(Object.assign({ id:x.id, pending:true }, x.data)));
  return out.sort((a,b)=>(a.ts||0)-(b.ts||0));
}
function _doneCount(evId){ return Object.keys((_srv.transferred&&_srv.transferred[evId])||{}).length; }

// PIN: nur SHA-256(Salz + PIN) speichern
async function _hash(salt, pin){
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt+'|'+pin));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Einmalige Übernahme des alten, rein lokalen Stands (tps_messe_v1) in die gemeinsame Ablage
async function _migrateOld(){
  let old=null; try{ old=JSON.parse(localStorage.getItem(LS_OLD)); }catch(e){}
  if(!old || !Array.isArray(old.events)) { try{ localStorage.removeItem(LS_OLD); }catch(e){} return; }
  for(const ev of old.events){
    if(!ev||!ev.id) continue;
    if(!_event(ev.id)){
      const data={ name:String(ev.name||'Messe').slice(0,100), cats:Array.isArray(ev.cats)?ev.cats:[], catLabels:ev.catLabels||{}, createdAt:Date.now(), createdBy:_me() };
      if(ev.pin){ data.pinSalt=Math.random().toString(36).slice(2,12); data.pinHash=await _hash(data.pinSalt, String(ev.pin)); }
      _queue({ t:'ev', ev:ev.id, id:'', data });
    }
    (ev.entries||[]).filter(e=>e&&!e.uploaded).forEach(e=>{
      _queue({ t:'en', ev:ev.id, id:e.id||_newMid(), data:_entryData(e) });
    });
  }
  if(!L.activeId && old.activeId) { L.activeId=old.activeId; _save(L); }
  try{ localStorage.removeItem(LS_OLD); }catch(e){}
}
// Ort (v505): wird ohne neue Datenbank-Regel in der Adresse als letzte Zeile „Ort: …" mitgespeichert
// und beim Übertrag ins CRM wieder herausgelöst (→ Sitz/Standort).
function _joinOrt(adr, ort){ adr=String(adr||'').trim(); ort=String(ort||'').trim(); return ort ? (adr?adr+'\n':'')+'Ort: '+ort : adr; }
function _splitOrt(adr){ const s=String(adr||''); const mm=s.match(/(?:^|\n)Ort: ([^\n]*)$/); return mm ? { adresse:s.slice(0,mm.index).trim(), ort:mm[1].trim() } : { adresse:s.trim(), ort:'' }; }
function _entryData(e){
  const c=(v,n)=>String(v==null?'':v).trim().slice(0,n);
  return { vorname:c(e.vorname,100), nachname:c(e.nachname,100), org:c(e.org,200), email:c(e.email,200), tel:c(e.tel,60),
    adresse:c(e.adresse,300), note:c(e.note,2000), ts:Number(e.ts)||Date.now(), by:c(_me(),64), dev:c(_dev(),64) };
}

function _ov(){ return document.getElementById('messe-overlay'); }
function _ensureOverlay(){
  let o=_ov();
  if(o) return o;
  o=document.createElement('div'); o.id='messe-overlay';
  o.setAttribute('style','position:fixed;inset:0;z-index:100000;background:#0e2a47;overflow:auto;-webkit-overflow-scrolling:touch');
  document.body.appendChild(o);
  if(!document.getElementById('messe-style')){
    const st=document.createElement('style'); st.id='messe-style';
    st.textContent=`
      #messe-overlay *{box-sizing:border-box;font-family:var(--font,Arial,Helvetica,sans-serif)}
      .me-wrap{max-width:580px;margin:0 auto;padding:22px 18px 60px}
      .me-card{background:var(--surface,#fff);border-radius:16px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
      .me-h{font-size:22px;font-weight:800;color:var(--primary,#1a3a5c);margin:0 0 4px}
      .me-sub{font-size:13px;color:var(--muted,#5b6b7d);margin:0 0 18px}
      .me-field{margin-bottom:13px}
      .me-field label{display:block;font-size:13px;font-weight:600;color:#33475b;margin-bottom:4px}
      /* Feld-Paare (Vorname/Nachname, Mail/Telefon): auf breiten Screens 2-spaltig → weniger Scrollen im Querformat */
      .me-row2{display:grid;grid-template-columns:1fr;gap:0}
      @media(min-width:560px){
        .me-wrap{max-width:640px}
        .me-row2{grid-template-columns:1fr 1fr;column-gap:13px}
      }
      @media (orientation:landscape) and (max-height:600px){
        .me-wrap{padding:10px 16px 44px}
        .me-card{padding:16px 18px}
        .me-h{font-size:19px}
        .me-sub{margin-bottom:12px}
        .me-btn{padding:12px}
      }
      .me-field input,.me-field textarea{width:100%;padding:12px 13px;border:1.5px solid var(--border,#cdd7e2);border-radius:10px;font-size:16px;background:var(--surface,#fff);color:var(--primary-d,#12283f)}
      .me-field textarea{min-height:66px;resize:vertical}
      .me-req{color:var(--danger,#c0392b)}
      .me-btn{display:block;width:100%;padding:15px;border:none;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer;background:var(--ok,#2d8a4e);color:var(--on-primary,#fff);margin-top:6px}
      .me-btn.sec{background:var(--surface-2,#eef2f7);color:var(--primary,#1a3a5c);font-weight:700;font-size:15px;padding:12px}
      .me-btn.warn{background:var(--danger,#c0392b)}
      .me-btn:active{transform:scale(.99)}
      .me-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;color:#fff;gap:10px}
      .me-top .cnt{font-size:13px;opacity:.9}
      .me-lock{background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
      .me-ok{margin-top:12px;text-align:center;color:var(--ok,#2d8a4e);font-weight:700;font-size:15px;min-height:20px}
      .me-catrow label{display:flex;align-items:center;gap:9px;padding:8px 4px;font-size:15px;color:var(--primary-d,#12283f);border-bottom:1px solid #eef2f7;cursor:pointer}
      .me-catrow input{width:auto;transform:scale(1.3);margin:0}
      .me-ev{display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface-2,#f6f8fb);border:1px solid #e3e9f0;border-radius:12px;padding:12px 14px;margin-bottom:10px}
      .me-ev .nm{font-weight:800;color:var(--primary-d,#12283f);font-size:16px}
      .me-ev .mt{font-size:12px;color:var(--muted,#5b6b7d)}
      .me-ev-btns{display:flex;gap:6px;flex-wrap:wrap}
      .me-mini{border:1.5px solid var(--border,#cdd7e2);background:var(--surface,#fff);color:var(--primary,#1a3a5c);border-radius:8px;padding:7px 11px;font-size:14px;font-weight:700;cursor:pointer}
      .me-mini.go{background:var(--ok,#2d8a4e);color:var(--on-primary,#fff);border-color:var(--ok,#2d8a4e)}
      .me-mini.del{border-color:var(--danger,#c0392b);color:var(--danger,#c0392b)}
      .me-list-item{background:var(--surface,#fff);border:1px solid #eef2f7;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
      .me-list-item .nm{font-weight:700;color:var(--primary-d,#12283f)}
      .me-list-item .dt{font-size:12px;color:var(--muted,#5b6b7d)}
      .me-x{background:var(--surface,#fff);border:1.5px solid var(--danger,#c0392b);color:var(--danger,#c0392b);border-radius:8px;padding:4px 9px;font-size:13px;cursor:pointer}
    `;
    document.head.appendChild(st);
  }
  return o;
}
function _close(){ const o=_ov(); if(o) o.remove(); _view=''; _unsubscribe(); }

// ── Neuzeichnen bei Live-Änderungen (nicht das Besucherformular – dort wird gerade getippt) ──
let _view='';
function _rerender(){
  if(!_ov()) return;
  if(_view==='picker') _renderPicker();
  else if(_view==='staff') _renderStaff();
  else if(_view==='form') _updateFormTop();
}
function _statusLine(){
  const pend=L.outbox.length;
  if(_online()) return pend?`<span style="color:#ffd27a">⏳ ${pend} wird gesendet …</span>`:'<span>🟢 verbunden</span>';
  return `<span style="color:#ffd27a">📴 offline${pend?` · ${pend} wartet auf Netz`:''}</span>`;
}

// ── Einstiegspunkt (Personal, aus dem ☰-Modulmenü) ──
// Feine Rechte (v510, js/rechte.js). Ohne Anmeldung (Offline-Fortsetzen am Stand) nicht sperren –
// der Server prüft beim Nachsenden ohnehin.
function _mr(k){ try{ if(!window.cu) return true; return window.tpsRecht ? !!window.tpsRecht(k, window.cu) : true; }catch(e){ return true; } }
function _noR(t){ toast('Dafür fehlt das Recht „'+t+'“.','err'); }
function messeStart(){ _ensureOverlay(); _subscribe(); _migrateOld().catch(e=>console.warn('Messe-Übernahme:',e)); _renderPicker(); _prepareOffline(); }
// Offline-fest (v503): beim Start (mit Netz) alle bisher geladenen App-Dateien einmal abrufen, damit der Service
// Worker sie sicher im Gerätespeicher hat – auf der Messe fehlt dann ohne Netz nichts.
function _prepareOffline(){
  try{ if(!navigator.onLine || !('serviceWorker' in navigator)) return;
    const urls=new Set([location.href.split('#')[0]]);
    (performance.getEntriesByType('resource')||[]).forEach(e=>{ try{ const u=new URL(e.name); if(u.origin===location.origin || /gstatic\.com\/firebasejs/.test(e.name)) urls.add(e.name); }catch(_){} });
    ['js/messe.js','css/styles.css','manifest.json'].forEach(p=>{ try{ urls.add(new URL(p, location.href).href); }catch(_){} });
    urls.forEach(u=>{ fetch(u,{credentials:'same-origin'}).catch(()=>{}); });
  }catch(e){}
}
// Nach Neuladen/Neustart: war das Gerät im Messemodus, sofort wieder das gesperrte Formular zeigen –
// auch ohne Netz und noch bevor die Anmeldung wiederhergestellt ist (Erfassung läuft in den Ausgang).
function _resumeKiosk(){
  try{
    if(!L.kiosk || !L.activeId || !(L.events&&L.events[L.activeId])) return;
    _ensureOverlay(); _renderForm();
    try{ firebase.auth().onAuthStateChanged(u=>{ if(u && _ov()){ _subscribe(); _flush(); } }); }catch(e){}
  }catch(e){ console.warn('Messe fortsetzen:', e); }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', _resumeKiosk); else setTimeout(_resumeKiosk, 0);

// ── Event-Auswahl / -Verwaltung (Personal) ──
function _renderPicker(){
  _view='picker';
  const o=_ensureOverlay(); const evs=_events();
  const rows = evs.length ? evs.map(ev=>{
    const list=_entries(ev.id); const pend=list.filter(e=>e.pending).length;
    return `<div class="me-ev">
      <div><div class="nm">${_esc(ev.name||'(ohne Name)')}</div>
        <div class="mt">${list.length} offen · ${_doneCount(ev.id)} übertragen${pend?` · ${pend} wartet auf Netz`:''} · ${_esc((ev.cats||[]).map(k=>(ev.catLabels||{})[k]||k).join(', ')||'keine Kategorie')}</div></div>
      <div class="me-ev-btns">
        <button class="me-mini go" onclick="messeOpenEvent(${_jsq(ev.id)})">Öffnen</button>
        ${_mr('me_va')?`<button class="me-mini" onclick="messeEditEvent(${_jsq(ev.id)})" aria-label="Bearbeiten">✎</button>`:''}
        ${_mr('me_va_loeschen')?`<button class="me-mini del" onclick="messeDeleteEvent(${_jsq(ev.id)})" aria-label="Löschen">🗑</button>`:''}
      </div></div>`;
  }).join('') : '<div style="color:var(--muted,#5b6b7d);font-size:14px;padding:6px 0 14px">Noch keine Veranstaltung. Lege eine an (z. B. „Messe 26").</div>';
  const noAccess = _srv.events===null && _online();
  o.innerHTML=`<div class="me-wrap">
    <div class="me-top"><span class="cnt">${_statusLine()}</span></div>
    <div class="me-card">
    <div class="me-h">Veranstaltungen</div>
    <div class="me-sub">Gilt für alle Messe-Geräte gemeinsam. Wähle eine Veranstaltung zum Erfassen – oder lege eine neue an.</div>
    ${noAccess?'<div style="background:var(--warn-bg,#fff4e0);color:var(--warn-text,#7a4a00);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px">Kein Zugriff auf die gemeinsame Messe-Ablage. Bitte den Administrator, „Messemodus: Nutzen" freizuschalten.</div>':''}
    ${rows}
    ${_mr('me_va')?`<button class="me-btn" onclick="messeEditEvent('')">＋ Neue Veranstaltung</button>`:''}
    <button class="me-btn warn" onclick="messeEnd()">Messemodus beenden</button>
  </div></div>`;
}
// Event anlegen/bearbeiten
function messeEditEvent(id){
  if(!_mr('me_va')){ _noR('Messe-Veranstaltungen anlegen/ändern'); return; }
  _view='edit';
  const o=_ensureOverlay();
  const ev = id ? _event(id) : null;
  let cats=[]; try{ cats=getCategories()||[]; }catch(e){ cats=[]; }
  const sel = ev ? (ev.cats||[]) : [];
  const rows = cats.length
    ? cats.map(c=>`<label><input type="checkbox" class="me-cat" value="${_esc(c.key)}" data-label="${_esc(c.label)}" ${sel.includes(c.key)?'checked':''}> ${_esc(c.label)}</label>`).join('')
    : '<div style="color:var(--muted,#5b6b7d);font-size:14px">Keine Kategorien gefunden. Bitte (online) vorher in der Verwaltung anlegen – z. B. „Messe 26", „Erstkontakt".</div>';
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">${ev?'Veranstaltung bearbeiten':'Neue Veranstaltung'}</div>
    <div class="me-sub">Name + Kategorien, die jeder erfasste Kontakt automatisch bekommt. Gilt auf allen Geräten.</div>
    <div class="me-field"><label for="me-evname">Name der Veranstaltung <span class="me-req">*</span></label><input id="me-evname" maxlength="100" placeholder="z. B. Messe 26" value="${_esc(ev?ev.name:'')}"></div>
    <div class="me-field"><label for="me-evpin">PIN fürs Personal ${ev&&ev.pinHash?'<span style="font-weight:400;color:var(--muted,#5b6b7d)">(leer lassen = unverändert)</span>':'<span class="me-req">*</span>'} <span style="font-weight:400;color:var(--muted,#5b6b7d)">(gilt auf allen Geräten)</span></label><input id="me-evpin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="mind. 4 Zeichen"></div>
    <div class="me-field"><label>Kategorien</label><div class="me-catrow" style="max-height:210px;overflow:auto;border:1.5px solid var(--border,#cdd7e2);border-radius:10px;padding:2px 10px">${rows}</div></div>
    <button class="me-btn" onclick="messeSaveEvent(${_jsq(ev?ev.id:'')})">Speichern</button>
    <button class="me-btn sec" onclick="messeManage()">Abbrechen</button>
  </div></div>`;
}
async function messeSaveEvent(id){
  if(!_mr('me_va')){ _noR('Messe-Veranstaltungen anlegen/ändern'); return; }
  const name=(document.getElementById('me-evname')?.value||'').trim().slice(0,100);
  if(!name){ toast('Bitte einen Namen für die Veranstaltung eingeben.','err'); return; }
  const pin=(document.getElementById('me-evpin')?.value||'').trim();
  const ev = id ? _event(id) : null;
  if(!(ev&&ev.pinHash) && pin.length<4){ toast('Bitte eine PIN mit mindestens 4 Zeichen setzen.','err'); return; }
  if(pin && pin.length<4){ toast('Die PIN muss mindestens 4 Zeichen haben.','err'); return; }
  const boxes=[...document.querySelectorAll('.me-cat:checked')];
  const cats=boxes.map(b=>b.value); const catLabels={}; boxes.forEach(b=>{ catLabels[b.value]=b.getAttribute('data-label')||b.value; });
  const evId=id||_newEid();
  const data=Object.assign({}, ev?{ name:ev.name, cats:ev.cats||[], catLabels:ev.catLabels||{}, pinHash:ev.pinHash||'', pinSalt:ev.pinSalt||'', createdAt:ev.createdAt||Date.now(), createdBy:ev.createdBy||_me() }:{ createdAt:Date.now(), createdBy:_me() },
    { name, cats, catLabels, updatedAt:Date.now() });
  if(pin){ data.pinSalt=Math.random().toString(36).slice(2,12); data.pinHash=await _hash(data.pinSalt, pin); }
  delete data.id;
  _queue({ t:'ev', ev:evId, id:'', data });
  if(!id){ L.activeId=evId; _save(L); }
  _renderPicker();
}
async function messeDeleteEvent(id){
  if(!_mr('me_va_loeschen')){ _noR('Messe-Veranstaltungen löschen'); return; }
  const ev=_event(id); if(!ev) return;
  const n=_entries(id).length;
  if(!window.confirm(`Veranstaltung „${ev.name}" auf ALLEN Geräten löschen?`+(n?`\n\nAchtung: ${n} noch nicht übertragene(r) Kontakt(e) gehen dabei verloren.`:''))) return;
  L.outbox=L.outbox.filter(x=>x.ev!==id); if(L.activeId===id) L.activeId=''; _save(L);
  if(_fbOk()){
    try{ await firebase.database().ref('messe').update({ ['events/'+id]:null, ['entries/'+id]:null, ['transferred/'+id]:null }); }
    catch(e){ toast('Löschen fehlgeschlagen: '+((e&&e.code)||e),'err'); }
  }
  _renderPicker();
}
function messeOpenEvent(id){ if(_event(id)){ L.activeId=id; _save(L); } _renderForm(); }

// ── Erfassungs-Formular (das sehen Besucher – nur das) ──
function _updateFormTop(){ const el=document.getElementById('me-formtop'); if(el){ const ev=_active(); if(ev) el.innerHTML=_formTop(ev); } }
function _formTop(ev){ return `${_esc(ev.name)} · ${_statusLine()}`; }
function _renderForm(msg){
  _view='form';
  const o=_ensureOverlay(); const ev=_active();
  if(!ev){ _renderPicker(); return; }
  if(!L.kiosk){ L.kiosk=true; _save(L); }   // Gerät ist jetzt im Messemodus → nach Neuladen/Neustart direkt wieder hier (v503)
  o.innerHTML=`<div class="me-wrap">
    <div class="me-top">
      <span class="cnt" id="me-formtop">${_formTop(ev)}</span>
      <button class="me-lock" onclick="messeStaff()">🔒 Personal</button>
    </div>
    <div class="me-card">
      <div class="me-h">Kontakt aufnehmen</div>
      <div class="me-sub">Vielen Dank für Ihr Interesse! Bitte tragen Sie Ihre Daten ein. <span class="me-req">*</span> = Pflichtfeld.</div>
      <div class="me-row2">
        <div class="me-field"><label for="me-vorname">Vorname <span class="me-req">*</span></label><input id="me-vorname" maxlength="100" autocomplete="off"></div>
        <div class="me-field"><label for="me-nachname">Nachname <span class="me-req">*</span></label><input id="me-nachname" maxlength="100" autocomplete="off"></div>
      </div>
      <div class="me-field"><label for="me-org">Organisation / Verein</label><input id="me-org" maxlength="200" autocomplete="off" placeholder="optional, z. B. Segelclub Pitz"></div>
      <div class="me-row2">
        <div class="me-field"><label for="me-email">E-Mail <span class="me-req">*</span> <span style="font-weight:400;color:var(--muted,#5b6b7d)">(oder Telefon)</span></label><input id="me-email" type="email" maxlength="200" autocomplete="off"></div>
        <div class="me-field"><label for="me-tel">Telefon <span class="me-req">*</span> <span style="font-weight:400;color:var(--muted,#5b6b7d)">(oder E-Mail)</span></label><input id="me-tel" type="tel" maxlength="60" autocomplete="off"></div>
      </div>
      <div class="me-row2">
        <div class="me-field"><label for="me-ort">Ort</label><input id="me-ort" maxlength="100" autocomplete="off" placeholder="optional, z. B. Kiel"></div>
        <div class="me-field"><label for="me-adresse">Adresse</label><input id="me-adresse" maxlength="190" autocomplete="off" placeholder="optional, Straße / PLZ"></div>
      </div>
      <div class="me-field"><label for="me-note">Notiz / Interesse</label><textarea id="me-note" maxlength="2000" placeholder="Worum ging es? Woran besteht Interesse?"></textarea></div>
      <button class="me-btn" onclick="messeSaveEntry(this)">✓ Speichern</button>
      <div class="me-ok" id="me-ok" role="status">${msg?_esc(msg):''}</div>
    </div>
  </div>`;
}
function messeSaveEntry(btn){
  const g=id=>(document.getElementById(id)?.value||'').trim();
  const vorname=g('me-vorname'), nachname=g('me-nachname'), email=g('me-email'), tel=g('me-tel');
  if(!vorname || !nachname){ toast('Bitte Vor- und Nachnamen eingeben.','err'); return; }
  if(!email && !tel){ toast('Bitte E-Mail ODER Telefon angeben.','err'); return; }
  const ev=_active(); if(!ev){ _renderPicker(); return; }
  if(btn){ btn.disabled=true; }
  _queue({ t:'en', ev:ev.id, id:_newMid(), data:_entryData({ vorname, nachname, org:g('me-org'), email, tel, adresse:_joinOrt(g('me-adresse'), g('me-ort')), note:g('me-note'), ts:Date.now() }) });
  _renderForm('✓ Gespeichert – danke!');
}

// ── Personal-Bereich (per PIN): Liste, Übertragen, Events, Beenden ──
function messeStaff(){ if(!_mr('me_liste')){ _noR('Erfasste Liste ansehen'); return; } const ev=_active(); if(!ev || !ev.pinHash){ _renderStaff(); return; } _renderPinCheck(); }
function _renderPinCheck(){
  _view='pin';
  const o=_ensureOverlay();
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🔒 Personal</div>
    <div class="me-sub">Bitte PIN eingeben.</div>
    <div class="me-field"><label for="me-pincheck">PIN</label><input id="me-pincheck" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"></div>
    <button class="me-btn" onclick="messeStaffCheck()">Weiter →</button>
    <button class="me-btn sec" onclick="messeBackToForm()">Abbrechen</button>
  </div></div>`;
  setTimeout(()=>{ const el=document.getElementById('me-pincheck'); if(el){ el.focus(); el.addEventListener('keydown',e=>{ if(e.key==='Enter') messeStaffCheck(); }); } },40);
}
async function messeStaffCheck(){
  const ev=_active();
  const pin=(document.getElementById('me-pincheck')?.value||'').trim();
  let ok=false; try{ ok=!!(ev && ev.pinHash && pin && (await _hash(ev.pinSalt||'', pin))===ev.pinHash); }catch(e){ ok=false; }
  if(!ok){ toast('Falsche PIN.','err'); const el=document.getElementById('me-pincheck'); if(el){ el.value=''; el.focus(); } return; }
  _renderStaff();
}
function _pName(e){ return ((e.vorname||'')+' '+(e.nachname||'')).trim() || '(ohne Name)'; }
function _renderStaff(){
  _view='staff';
  const o=_ensureOverlay(); const ev=_active();
  if(!ev){ _renderPicker(); return; }
  const list=_entries(ev.id); const pend=list.filter(e=>e.pending).length; const ready=list.length-pend;
  const items = list.length
    ? list.slice().reverse().map(e=>`<div class="me-list-item">
        <div><div class="nm">${_esc(_pName(e))}${e.org?` · ${_esc(e.org)}`:''}${_splitOrt(e.adresse).ort?` · ${_esc(_splitOrt(e.adresse).ort)}`:''}</div>
          <div class="dt">${_esc(new Date(e.ts||0).toLocaleString('de-DE'))}${e.pending?' · ⏳ wartet auf Netz':''}${e.email?' · '+_esc(e.email):(e.tel?' · '+_esc(e.tel):'')}</div></div>
        ${_mr('me_eintrag_loeschen')?`<button class="me-x" onclick="messeDeleteEntry(${_jsq(e.id)})">Löschen</button>`:''}</div>`).join('')
    : '<div style="color:var(--muted,#5b6b7d);font-size:14px;padding:8px 0">Keine offenen Kontakte.</div>';
  o.innerHTML=`<div class="me-wrap">
    <div class="me-top"><span class="cnt">${_statusLine()}</span></div>
    <div class="me-card">
    <div class="me-h">🔒 ${_esc(ev.name)}</div>
    <div class="me-sub">${list.length} offen (alle Geräte) · ${_doneCount(ev.id)} bereits ins CRM übertragen · Kategorien: ${_esc((ev.cats||[]).map(k=>(ev.catLabels||{})[k]||k).join(', ')||'–')}</div>
    ${ev.pinHash?'':'<div style="background:var(--warn-bg,#fff4e0);color:var(--warn-text,#7a4a00);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:10px">Diese Veranstaltung hat noch keine PIN – bitte unter „Veranstaltungen verwalten" → ✎ eine PIN setzen.</div>'}
    <button class="me-btn" onclick="messeTransfer(this)" ${_mr('me_uebertragen')?'':'hidden'} ${(!_online()||!ready)?'disabled style="opacity:.55"':''}>⬆ ${ready} Kontakt(e) ins CRM übertragen${_online()?'':' (nur online)'}</button>
    <div style="font-size:12px;color:var(--muted,#5b6b7d);margin-top:6px">Nach dem Übertragen werden die Besucherdaten hier gelöscht – sie stehen dann nur noch im CRM.</div>
    <div style="max-height:44vh;overflow:auto;margin:14px 0">${items}</div>
    <button class="me-btn sec" onclick="messeBackToForm()">← Zurück zum Formular</button>
    <button class="me-btn sec" onclick="messeManage()">Veranstaltungen verwalten</button>
    <button class="me-btn warn" onclick="messeEnd()">Messemodus beenden</button>
  </div></div>`;
}
async function messeDeleteEntry(id){
  if(!_mr('me_eintrag_loeschen')){ _noR('Erfasste Einträge löschen'); return; }
  if(!window.confirm('Diesen Kontakt löschen?')) return;
  const ev=_active(); if(!ev) return;
  const inBox=L.outbox.some(x=>x.t==='en'&&x.id===id);
  if(inBox){ L.outbox=L.outbox.filter(x=>!(x.t==='en'&&x.id===id)); _save(L); }
  if(_fbOk()){ try{ await firebase.database().ref('messe/entries/'+ev.id+'/'+id).remove(); }catch(e){ if(!inBox) toast('Löschen fehlgeschlagen (offline?).','err'); } }
  _renderStaff();
}
function messeBackToForm(){ _renderForm(); }
function messeManage(){ _renderPicker(); }

// ── Übertragung ins CRM ──
function _toEntity(m, cats){
  let treeKeys=[]; try{ treeKeys=getTrees().map(t=>t.key); }catch(e){}
  const tree = (cats||[]).find(k=>treeKeys.includes(k)) || treeKeys[0] || 'vereine';
  const person = _pName(m);
  const org=(m.org||'').trim();
  const name = org || person || '(Messe-Kontakt)';
  const sp=_splitOrt(m.adresse);
  const stamm={ name }; if(sp.ort) stamm.sitz=sp.ort;
  const ent={ id:newId(), tree, createdAt:m.ts||Date.now(), createdByKuerzel:'Messe', createdByName:'Messemodus',
    stamm, categories:(cats||[]).slice(), status:[], statusLog:[],
    kontakte:[], termine:[], angebote:[], kontaktnotizen:[], todos:[], log:[] };
  ent.kontakte.push({ id:newId(), name:person, funktion:'', emails:m.email?[m.email]:[], tels:m.tel?[m.tel]:[], adresse:[sp.adresse, sp.ort].filter(Boolean).join('\n'), note:'' });
  if((m.note||'').trim()) ent.kontaktnotizen.push({ id:newId(), ts:m.ts||Date.now(), text:m.note.trim(), byKuerzel:'Messe', byName:'Messemodus' });
  return { tree, ent };
}
async function messeTransfer(btn){
  if(!_mr('me_uebertragen')){ _noR('Ins CRM übertragen'); return; }
  if(!_online()){ toast('Zum Übertragen bitte online gehen (WLAN/Daten).','err'); return; }
  const ev=_active(); if(!ev) return;
  await _flush();
  const todo=_entries(ev.id).filter(e=>!e.pending);
  if(!todo.length){ toast('Keine Kontakte zum Übertragen.',''); return; }
  if(btn){ btn.disabled=true; btn.textContent='⏳ Übertrage …'; }
  try{ await ensureCrmReady(); }catch(e){}
  const db=firebase.database(); let n=0, skip=0, fail=0;
  for(const m of todo){
    const mark=db.ref('messe/transferred/'+ev.id+'/'+m.id);
    try{
      // 1) Marker anlegen – nur EIN Gerät gewinnt (Transaktion bricht ab, wenn schon vorhanden)
      const tr=await mark.transaction(cur=> cur ? undefined : { by:_me(), at:Date.now() });
      if(!tr.committed){ skip++; continue; }
      // 2) CRM-Kontakt anlegen
      const { tree, ent }=_toEntity(m, ev.cats);
      await saveEntity(tree, ent);
      await mark.update({ crmId:ent.id });
      // 3) Besucherdaten aus der Messe-Ablage löschen (Datensparsamkeit)
      await db.ref('messe/entries/'+ev.id+'/'+m.id).remove();
      n++;
    }catch(e){
      fail++; console.warn('Messe-Übertrag:', e);
      try{ await mark.remove(); }catch(_){}   // eigenen Marker zurücknehmen → später erneut versuchen
    }
  }
  toast(`${n} Kontakt(e) ins CRM übertragen ✓`+(skip?` · ${skip} lief(en) schon auf einem anderen Gerät`:'')+(fail?` · ${fail} fehlgeschlagen`:''), fail?'err':'ok');
  _renderStaff();
}
function messeEnd(){
  const pend=L.outbox.length;
  if(!window.confirm('Messemodus beenden? Die App kehrt zur normalen Ansicht zurück.'+(pend?`\n\n${pend} Eintrag/Einträge warten noch auf Netz und werden beim nächsten Öffnen des Messemodus mit Netz gesendet.`:''))) return;
  L.kiosk=false; _save(L);
  _close();
}
function messeClose(){ L.kiosk=false; _save(L); _close(); }

export { messeStart };
// Ausgang auch ohne geöffneten Messemodus nachschicken (nach der Anmeldung, siehe main.js)
function messeFlush(){ return _flush(); }
Object.assign(window, {
  messeFlush, messeStart, messeClose, messeEditEvent, messeSaveEvent, messeDeleteEvent, messeOpenEvent,
  messeSaveEntry, messeStaff, messeStaffCheck, messeDeleteEntry, messeBackToForm, messeManage, messeTransfer, messeEnd
});
