// js/messe.js — MESSEMODUS: PIN-gesperrter Vollbild-Erfassungsmodus für Tablets.
// Auf der Messe Kontakte OFFLINE erfassen, datenschutzkonform (Besucher sehen nur das eigene,
// leere Formular), danach per Knopf ins normale CRM übertragen.
//
// EVENT-MODELL (v263): mehrere Veranstaltungen ("Messe 26" …) lokal auf dem Tablet — anlegen,
// umbenennen, Kategorien ändern, löschen; mehrere parallel. Jedes Event hat seine eigene
// Kontaktliste. Alles im eigenen localStorage `tps_messe_v1` (geräte-lokal, NICHT an den Login
// gebunden) → beim Personalwechsel (A meldet sich ab, B am SELBEN Tablet an) ist alles noch da.
//
// ÜBERTRAGUNG (online, nach der Messe): jeder Eintrag → ECHTER CRM-Kontakt (stamm.name =
// Organisation ODER Person) mit Kontakt-Person (Vorname Nachname + Mail/Tel/Adresse) und der
// Notiz als erster Kontaktnotiz — exakt wie „＋ Kontakt anlegen". Idempotent (uploaded-Flag).

import { saveEntity, newId, ensureCrmReady } from './crm/crm-data.js';
import { getCategories, getTrees } from './crm/crm-config.js';
import { toast } from './utils.js';

const LS = 'tps_messe_v1';
const _esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function _loadRaw(){ try{ return JSON.parse(localStorage.getItem(LS)); }catch(e){ return null; } }
function _persist(s){ try{ localStorage.setItem(LS, JSON.stringify(s)); }catch(e){} }
function _newEid(){ return 'ev'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
// Zustand laden + einmalige Migration vom alten flachen v262-Format {cats,catLabels,entries}.
function _state(){
  let s=_loadRaw();
  if(!s || typeof s!=='object') return { events:[], activeId:'' };
  if(!Array.isArray(s.events)){
    const ev={ id:_newEid(), name:'Messe', cats:Array.isArray(s.cats)?s.cats:[], catLabels:s.catLabels||{}, entries:Array.isArray(s.entries)?s.entries:[] };
    s={ events:[ev], activeId:ev.id };
    _persist(s);
    return s;
  }
  if('pin' in s){ delete s.pin; _persist(s); }   // früher gespeicherte PIN entfernen (PIN wird pro Sitzung neu vergeben)
  return s;
}
function _active(s){ return (s.events||[]).find(e=>e.id===s.activeId) || null; }

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
      #messe-overlay *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      .me-wrap{max-width:580px;margin:0 auto;padding:22px 18px 60px}
      .me-card{background:#fff;border-radius:16px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
      .me-h{font-size:22px;font-weight:800;color:#1a3a5c;margin:0 0 4px}
      .me-sub{font-size:13px;color:#5b6b7d;margin:0 0 18px}
      .me-field{margin-bottom:13px}
      .me-field label{display:block;font-size:13px;font-weight:600;color:#33475b;margin-bottom:4px}
      .me-field input,.me-field textarea{width:100%;padding:12px 13px;border:1.5px solid #cdd7e2;border-radius:10px;font-size:16px;background:#fff;color:#12283f}
      .me-field textarea{min-height:66px;resize:vertical}
      .me-req{color:#c0392b}
      .me-btn{display:block;width:100%;padding:15px;border:none;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer;background:#2d8a4e;color:#fff;margin-top:6px}
      .me-btn.sec{background:#eef2f7;color:#1a3a5c;font-weight:700;font-size:15px;padding:12px}
      .me-btn.warn{background:#c0392b}
      .me-btn:active{transform:scale(.99)}
      .me-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;color:#fff;gap:10px}
      .me-top .cnt{font-size:13px;opacity:.9}
      .me-lock{background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
      .me-ok{margin-top:12px;text-align:center;color:#2d8a4e;font-weight:700;font-size:15px;min-height:20px}
      .me-catrow label{display:flex;align-items:center;gap:9px;padding:8px 4px;font-size:15px;color:#12283f;border-bottom:1px solid #eef2f7;cursor:pointer}
      .me-catrow input{width:auto;transform:scale(1.3);margin:0}
      .me-ev{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#f6f8fb;border:1px solid #e3e9f0;border-radius:12px;padding:12px 14px;margin-bottom:10px}
      .me-ev .nm{font-weight:800;color:#12283f;font-size:16px}
      .me-ev .mt{font-size:12px;color:#5b6b7d}
      .me-ev-btns{display:flex;gap:6px;flex-wrap:wrap}
      .me-mini{border:1.5px solid #cdd7e2;background:#fff;color:#1a3a5c;border-radius:8px;padding:7px 11px;font-size:14px;font-weight:700;cursor:pointer}
      .me-mini.go{background:#2d8a4e;color:#fff;border-color:#2d8a4e}
      .me-mini.del{border-color:#c0392b;color:#c0392b}
      .me-list-item{background:#fff;border:1px solid #eef2f7;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
      .me-list-item .nm{font-weight:700;color:#12283f}
      .me-list-item .dt{font-size:12px;color:#5b6b7d}
      .me-x{background:#fff;border:1.5px solid #c0392b;color:#c0392b;border-radius:8px;padding:4px 9px;font-size:13px;cursor:pointer}
    `;
    document.head.appendChild(st);
  }
  return o;
}
function _close(){ const o=_ov(); if(o) o.remove(); }

// ── Einstiegspunkt (Personal, aus dem ☰-Modulmenü) ──
function messeStart(){ _ensureOverlay(); _renderPicker(); }   // Personal-Hub; PIN ist PRO Veranstaltung

// ── Event-Auswahl / -Verwaltung (Personal) ──
function _renderPicker(){
  const o=_ensureOverlay(); const s=_state();
  const rows = s.events.length ? s.events.map(ev=>{
    const pend=ev.entries.filter(e=>!e.uploaded).length;
    return `<div class="me-ev">
      <div><div class="nm">${_esc(ev.name||'(ohne Name)')}</div>
        <div class="mt">${ev.entries.length} Kontakt(e)${pend?` · ${pend} offen`:''} · ${_esc((ev.cats||[]).map(k=>ev.catLabels[k]||k).join(', ')||'keine Kategorie')}</div></div>
      <div class="me-ev-btns">
        <button class="me-mini go" onclick="messeOpenEvent('${ev.id}')">Öffnen</button>
        <button class="me-mini" onclick="messeEditEvent('${ev.id}')">✎</button>
        <button class="me-mini del" onclick="messeDeleteEvent('${ev.id}')">🗑</button>
      </div></div>`;
  }).join('') : '<div style="color:#5b6b7d;font-size:14px;padding:6px 0 14px">Noch keine Veranstaltung. Lege eine an (z. B. „Messe 26").</div>';
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🎪 Veranstaltungen</div>
    <div class="me-sub">Wähle eine Veranstaltung zum Erfassen – oder lege eine neue an. Mehrere parallel möglich.</div>
    ${rows}
    <button class="me-btn" onclick="messeEditEvent('')">＋ Neue Veranstaltung</button>
    <button class="me-btn warn" onclick="messeEnd()">Messemodus beenden</button>
  </div></div>`;
}
// Event anlegen/bearbeiten
function messeEditEvent(id){
  const o=_ensureOverlay(); const s=_state();
  const ev = id ? s.events.find(e=>e.id===id) : null;
  let cats=[]; try{ cats=getCategories()||[]; }catch(e){ cats=[]; }
  const sel = ev ? (ev.cats||[]) : [];
  const rows = cats.length
    ? cats.map(c=>`<label><input type="checkbox" class="me-cat" value="${_esc(c.key)}" data-label="${_esc(c.label)}" ${sel.includes(c.key)?'checked':''}> ${_esc(c.label)}</label>`).join('')
    : '<div style="color:#5b6b7d;font-size:14px">Keine Kategorien gefunden. Bitte (online) vorher in der Verwaltung anlegen – z. B. „Messe 26", „Erstkontakt".</div>';
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">${ev?'Veranstaltung bearbeiten':'Neue Veranstaltung'}</div>
    <div class="me-sub">Name + Kategorien, die jeder erfasste Kontakt automatisch bekommt.</div>
    <div class="me-field"><label>Name der Veranstaltung <span class="me-req">*</span></label><input id="me-evname" placeholder="z. B. Messe 26" value="${_esc(ev?ev.name:'')}"></div>
    <div class="me-field"><label>PIN fürs Personal <span class="me-req">*</span> <span style="font-weight:400;color:#5b6b7d">(schützt Liste &amp; Übertragen dieser Veranstaltung)</span></label><input id="me-evpin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="mind. 3 Zeichen" value="${_esc(ev?(ev.pin||''):'')}"></div>
    <div class="me-field"><label>Kategorien</label><div class="me-catrow" style="max-height:210px;overflow:auto;border:1.5px solid #cdd7e2;border-radius:10px;padding:2px 10px">${rows}</div></div>
    <button class="me-btn" onclick="messeSaveEvent('${ev?ev.id:''}')">Speichern</button>
    <button class="me-btn sec" onclick="messeManage()">Abbrechen</button>
  </div></div>`;
}
function messeSaveEvent(id){
  const name=(document.getElementById('me-evname')?.value||'').trim();
  if(!name){ toast('Bitte einen Namen für die Veranstaltung eingeben.','err'); return; }
  const pin=(document.getElementById('me-evpin')?.value||'').trim();
  if(pin.length<3){ toast('Bitte eine PIN mit mindestens 3 Zeichen für diese Veranstaltung setzen.','err'); return; }
  const boxes=[...document.querySelectorAll('.me-cat:checked')];
  const cats=boxes.map(b=>b.value); const catLabels={}; boxes.forEach(b=>{ catLabels[b.value]=b.getAttribute('data-label')||b.value; });
  const s=_state();
  if(id){ const ev=s.events.find(e=>e.id===id); if(ev){ ev.name=name; ev.pin=pin; ev.cats=cats; ev.catLabels=catLabels; } }
  else { const ev={ id:_newEid(), name, pin, cats, catLabels, entries:[] }; s.events.push(ev); s.activeId=ev.id; }
  _persist(s);
  _renderPicker();
}
function messeDeleteEvent(id){
  const s=_state(); const ev=s.events.find(e=>e.id===id); if(!ev) return;
  const n=ev.entries.length;
  if(!window.confirm(`Veranstaltung „${ev.name}" löschen?`+(n?`\n\nAchtung: ${n} erfasste(r) Kontakt(e) gehen dabei verloren.`:''))) return;
  s.events=s.events.filter(e=>e.id!==id);
  if(s.activeId===id) s.activeId = s.events[0] ? s.events[0].id : '';
  _persist(s); _renderPicker();
}
function messeOpenEvent(id){ const s=_state(); if(s.events.some(e=>e.id===id)){ s.activeId=id; _persist(s); } _renderForm(); }

// ── Erfassungs-Formular (das sehen Besucher – nur das) ──
function _renderForm(msg){
  const o=_ensureOverlay(); const s=_state(); const ev=_active(s);
  if(!ev){ _renderPicker(); return; }
  const pend=ev.entries.filter(e=>!e.uploaded).length;
  o.innerHTML=`<div class="me-wrap">
    <div class="me-top">
      <span class="cnt">🎪 ${_esc(ev.name)} · ${ev.entries.length} erfasst${pend?` · ${pend} offen`:''}</span>
      <button class="me-lock" onclick="messeStaff()">🔒 Personal</button>
    </div>
    <div class="me-card">
      <div class="me-h">Kontakt aufnehmen</div>
      <div class="me-sub">Vielen Dank für Ihr Interesse! Bitte tragen Sie Ihre Daten ein. <span class="me-req">*</span> = Pflichtfeld.</div>
      <div class="me-field"><label>Vorname <span class="me-req">*</span></label><input id="me-vorname" autocomplete="off"></div>
      <div class="me-field"><label>Nachname <span class="me-req">*</span></label><input id="me-nachname" autocomplete="off"></div>
      <div class="me-field"><label>Organisation / Verein</label><input id="me-org" autocomplete="off" placeholder="optional, z. B. Segelclub Pitz"></div>
      <div class="me-field"><label>E-Mail <span class="me-req">*</span> <span style="font-weight:400;color:#5b6b7d">(oder Telefon)</span></label><input id="me-email" type="email" autocomplete="off"></div>
      <div class="me-field"><label>Telefon <span class="me-req">*</span> <span style="font-weight:400;color:#5b6b7d">(oder E-Mail)</span></label><input id="me-tel" type="tel" autocomplete="off"></div>
      <div class="me-field"><label>Adresse</label><input id="me-adresse" autocomplete="off"></div>
      <div class="me-field"><label>Notiz / Interesse</label><textarea id="me-note" placeholder="Worum ging es? Woran besteht Interesse?"></textarea></div>
      <button class="me-btn" onclick="messeSaveEntry(this)">✓ Speichern</button>
      <div class="me-ok" id="me-ok">${msg?_esc(msg):''}</div>
    </div>
  </div>`;
}
function messeSaveEntry(btn){
  const g=id=>(document.getElementById(id)?.value||'').trim();
  const vorname=g('me-vorname'), nachname=g('me-nachname'), email=g('me-email'), tel=g('me-tel');
  if(!vorname || !nachname){ toast('Bitte Vor- und Nachnamen eingeben.','err'); return; }
  if(!email && !tel){ toast('Bitte E-Mail ODER Telefon angeben.','err'); return; }
  const s=_state(); const ev=_active(s); if(!ev){ _renderPicker(); return; }
  ev.entries.push({ id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    vorname, nachname, org:g('me-org'), email, tel, adresse:g('me-adresse'), note:g('me-note'),
    ts:Date.now(), uploaded:false });
  _persist(s);
  if(btn){ btn.disabled=true; }
  _renderForm('✓ Gespeichert – danke!');
}

// ── Personal-Bereich (per PIN): Liste, Übertragen, Events, Beenden ──
function messeStaff(){ const ev=_active(_state()); if(!ev || !ev.pin){ _renderStaff(); return; } _renderPinCheck(); }
function _renderPinCheck(){
  const o=_ensureOverlay();
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🔒 Personal</div>
    <div class="me-sub">Bitte PIN eingeben.</div>
    <div class="me-field"><label>PIN</label><input id="me-pincheck" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"></div>
    <button class="me-btn" onclick="messeStaffCheck()">Weiter →</button>
    <button class="me-btn sec" onclick="messeBackToForm()">Abbrechen</button>
  </div></div>`;
  setTimeout(()=>{ const el=document.getElementById('me-pincheck'); if(el){ el.focus(); el.addEventListener('keydown',e=>{ if(e.key==='Enter') messeStaffCheck(); }); } },40);
}
function messeStaffCheck(){
  const ev=_active(_state());
  const pin=(document.getElementById('me-pincheck')?.value||'').trim();
  if(!ev || !ev.pin || pin!==ev.pin){ toast('Falsche PIN.','err'); const el=document.getElementById('me-pincheck'); if(el){ el.value=''; el.focus(); } return; }
  _renderStaff();
}
function _pName(e){ return ((e.vorname||'')+' '+(e.nachname||'')).trim() || e.person || '(ohne Name)'; }
function _renderStaff(){
  const o=_ensureOverlay(); const s=_state(); const ev=_active(s);
  if(!ev){ _renderPicker(); return; }
  const pend=ev.entries.filter(e=>!e.uploaded).length;
  const items = ev.entries.length
    ? ev.entries.slice().reverse().map(e=>`<div class="me-list-item">
        <div><div class="nm">${_esc(_pName(e))}${e.org?` · ${_esc(e.org)}`:''}</div>
          <div class="dt">${new Date(e.ts).toLocaleString('de-DE')}${e.uploaded?' · ✓ übertragen':''}${e.email?' · '+_esc(e.email):(e.tel?' · '+_esc(e.tel):'')}</div></div>
        <button class="me-x" onclick="messeDeleteEntry('${e.id}')">Löschen</button></div>`).join('')
    : '<div style="color:#5b6b7d;font-size:14px;padding:8px 0">Noch keine Kontakte erfasst.</div>';
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🔒 ${_esc(ev.name)}</div>
    <div class="me-sub">${ev.entries.length} Kontakt(e), ${pend} noch nicht übertragen · Kategorien: ${_esc((ev.cats||[]).map(k=>ev.catLabels[k]||k).join(', ')||'–')}</div>
    <button class="me-btn" onclick="messeTransfer(this)">⬆ ${pend} Kontakt(e) ins CRM übertragen (online)</button>
    <div style="max-height:44vh;overflow:auto;margin:14px 0">${items}</div>
    <button class="me-btn sec" onclick="messeBackToForm()">← Zurück zum Formular</button>
    <button class="me-btn sec" onclick="messeManage()">Veranstaltungen verwalten</button>
    <button class="me-btn warn" onclick="messeEnd()">Messemodus beenden</button>
  </div></div>`;
}
function messeDeleteEntry(id){
  if(!window.confirm('Diesen Kontakt löschen?')) return;
  const s=_state(); const ev=_active(s); if(!ev) return;
  ev.entries=ev.entries.filter(e=>e.id!==id); _persist(s); _renderStaff();
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
  const ent={ id:newId(), tree, createdAt:m.ts||Date.now(), createdByKuerzel:'Messe', createdByName:'Messemodus',
    stamm:{ name }, categories:(cats||[]).slice(), status:[], statusLog:[],
    kontakte:[], termine:[], angebote:[], kontaktnotizen:[], todos:[], log:[] };
  ent.kontakte.push({ id:newId(), name:person, funktion:'', emails:m.email?[m.email]:[], tels:m.tel?[m.tel]:[], adresse:m.adresse||'', note:'' });
  if((m.note||'').trim()) ent.kontaktnotizen.push({ id:newId(), ts:m.ts||Date.now(), text:m.note.trim(), byKuerzel:'Messe', byName:'Messemodus' });
  return { tree, ent };
}
async function messeTransfer(btn){
  if(!navigator.onLine){ toast('Zum Übertragen bitte online gehen (WLAN/Daten).','err'); return; }
  const s=_state(); const ev=_active(s); if(!ev) return;
  const pend=ev.entries.filter(e=>!e.uploaded);
  if(!pend.length){ toast('Keine neuen Kontakte zum Übertragen.',''); return; }
  if(btn){ btn.disabled=true; btn.textContent='⏳ Übertrage …'; }
  try{ await ensureCrmReady(); }catch(e){}
  let n=0;
  for(const m of pend){
    try{ const {tree,ent}=_toEntity(m, ev.cats); await saveEntity(tree, ent); m.uploaded=true; m.crmId=ent.id; n++; }
    catch(e){ console.warn('Messe-Transfer:',e); }
  }
  _persist(s);
  toast(n+' Kontakt(e) ins CRM übertragen ✓', n?'ok':'err');
  _renderStaff();
}
function messeEnd(){
  if(!window.confirm('Messemodus beenden? Die App kehrt zur normalen Ansicht zurück.\n(Noch nicht übertragene Kontakte bleiben auf diesem Tablet gespeichert.)')) return;
  _close();
}
function messeClose(){ _close(); }

export { messeStart };
Object.assign(window, {
  messeStart, messeClose, messeEditEvent, messeSaveEvent, messeDeleteEvent, messeOpenEvent,
  messeSaveEntry, messeStaff, messeStaffCheck, messeDeleteEntry, messeBackToForm, messeManage, messeTransfer, messeEnd
});
