// js/messe.js — MESSEMODUS: PIN-gesperrter Vollbild-Erfassungsmodus für Tablets.
// Ziel: auf der Messe Kontakte OFFLINE erfassen, datenschutzkonform (Besucher sehen nur das
// eigene, leere Formular – nichts anderes), danach per Knopf ins normale CRM übertragen.
//
// ISOLATION: eigener localStorage `tps_messe_v1` (Kontakte + PIN + gewählte Kategorien).
// Der Modus lädt/zeigt KEINE anderen CRM-Daten. Das Overlay liegt über der ganzen App und ist
// nur per PIN verlassbar → eine Aushilfe/ein Besucher kommt an nichts anderes.
//
// ÜBERTRAGUNG (online, nach der Messe): jeder Eintrag wird zu einem ECHTEN CRM-Kontakt
// (stamm.name = Organisation/Name) mit einer Kontakt-Person (Ansprechpartner + Mail/Tel/Adresse)
// und der Notiz als erster Kontaktnotiz — exakt wie „＋ Kontakt anlegen". Idempotent (uploaded-Flag).

import { saveEntity, newId, ensureCrmReady } from './crm/crm-data.js';
import { getCategories, getTrees } from './crm/crm-config.js';
import { toast } from './utils.js';

const LS = 'tps_messe_v1';
function _load(){ try{ return JSON.parse(localStorage.getItem(LS)) || null; }catch(e){ return null; } }
function _persist(s){ try{ localStorage.setItem(LS, JSON.stringify(s)); }catch(e){} }
function _state(){ const s=_load(); return s && typeof s==='object' ? s : { pin:'', cats:[], catLabels:{}, entries:[] }; }
const _esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function _ov(){ return document.getElementById('messe-overlay'); }
function _ensureOverlay(){
  let o=_ov();
  if(!o){
    o=document.createElement('div'); o.id='messe-overlay';
    o.setAttribute('style','position:fixed;inset:0;z-index:100000;background:#0e2a47;color:#0e2a47;overflow:auto;-webkit-overflow-scrolling:touch');
    document.body.appendChild(o);
    if(!document.getElementById('messe-style')){
      const st=document.createElement('style'); st.id='messe-style';
      st.textContent=`
        #messe-overlay *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .me-wrap{max-width:560px;margin:0 auto;padding:22px 18px 60px}
        .me-card{background:#fff;border-radius:16px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
        .me-h{font-size:22px;font-weight:800;color:#1a3a5c;margin:0 0 4px}
        .me-sub{font-size:13px;color:#5b6b7d;margin:0 0 18px}
        .me-field{margin-bottom:13px}
        .me-field label{display:block;font-size:13px;font-weight:600;color:#33475b;margin-bottom:4px}
        .me-field input,.me-field textarea{width:100%;padding:12px 13px;border:1.5px solid #cdd7e2;border-radius:10px;font-size:16px;background:#fff;color:#12283f}
        .me-field textarea{min-height:70px;resize:vertical}
        .me-btn{display:block;width:100%;padding:15px;border:none;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer;background:#2d8a4e;color:#fff;margin-top:6px}
        .me-btn.sec{background:#eef2f7;color:#1a3a5c;font-weight:700;font-size:15px;padding:12px}
        .me-btn.warn{background:#c0392b}
        .me-btn:active{transform:scale(.99)}
        .me-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;color:#fff}
        .me-top .cnt{font-size:13px;opacity:.85}
        .me-lock{background:rgba(255,255,255,.16);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer}
        .me-ok{margin-top:12px;text-align:center;color:#2d8a4e;font-weight:700;font-size:15px;min-height:20px}
        .me-catrow label{display:flex;align-items:center;gap:9px;padding:8px 4px;font-size:15px;color:#12283f;border-bottom:1px solid #eef2f7;cursor:pointer}
        .me-catrow input{width:auto;transform:scale(1.3);margin:0}
        .me-list-item{background:#fff;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
        .me-list-item .nm{font-weight:700;color:#12283f}
        .me-list-item .dt{font-size:12px;color:#5b6b7d}
        .me-x{background:#fff;border:1.5px solid #c0392b;color:#c0392b;border-radius:8px;padding:4px 9px;font-size:13px;cursor:pointer}
      `;
      document.head.appendChild(st);
    }
  }
  return o;
}

// ── Einstiegspunkt (vom Personal, meist aus dem CRM/Modulmenü) ──
function messeStart(){
  _ensureOverlay();
  const s=_state();
  if(!s.pin || !Array.isArray(s.cats) || !s.cats.length) _renderSetup();
  else _renderForm();
}

// ── Einrichtung (online, einmalig vor der Messe): Kategorien + PIN ──
function _renderSetup(){
  const o=_ensureOverlay();
  let cats=[];
  try{ cats=getCategories()||[]; }catch(e){ cats=[]; }
  const s=_state();
  const rows = cats.length
    ? cats.map(c=>`<label><input type="checkbox" class="me-cat" value="${_esc(c.key)}" data-label="${_esc(c.label)}" ${s.cats.includes(c.key)?'checked':''}> ${_esc(c.label)}</label>`).join('')
    : '<div style="color:#5b6b7d;font-size:14px">Keine Kategorien gefunden. Bitte vorher in der Verwaltung anlegen (z. B. „Messe 26", „Erstkontakt") und dann online einrichten.</div>';
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🎪 Messemodus einrichten</div>
    <div class="me-sub">Einmalig vor der Messe (online). Danach läuft alles offline.</div>
    <div class="me-field"><label>Kategorien, die jeder erfasste Kontakt automatisch bekommt</label>
      <div class="me-catrow" style="max-height:220px;overflow:auto;border:1.5px solid #cdd7e2;border-radius:10px;padding:2px 10px">${rows}</div>
    </div>
    <div class="me-field"><label>PIN fürs Personal (zum Verlassen &amp; für die Liste)</label>
      <input id="me-pin" type="tel" inputmode="numeric" placeholder="z. B. 4-stellig" value="${_esc(s.pin||'')}">
    </div>
    <button class="me-btn" onclick="messeSaveSetup()">Messemodus starten →</button>
    <button class="me-btn sec" onclick="messeExitSetup()">Abbrechen</button>
  </div></div>`;
}
function messeSaveSetup(){
  const pin=(document.getElementById('me-pin')?.value||'').trim();
  if(pin.length<3){ toast('Bitte eine PIN mit mindestens 3 Zeichen setzen.','err'); return; }
  const boxes=[...document.querySelectorAll('.me-cat:checked')];
  if(!boxes.length){ toast('Bitte mindestens eine Kategorie wählen.','err'); return; }
  const s=_state();
  s.pin=pin;
  s.cats=boxes.map(b=>b.value);
  s.catLabels={}; boxes.forEach(b=>{ s.catLabels[b.value]=b.getAttribute('data-label')||b.value; });
  _persist(s);
  _renderForm();
}
function messeExitSetup(){ const o=_ov(); if(o) o.remove(); }

// ── Erfassungs-Formular (das sehen die Besucher — nur das) ──
function _renderForm(msg){
  const o=_ensureOverlay(); const s=_state();
  const n=s.entries.length, pend=s.entries.filter(e=>!e.uploaded).length;
  o.innerHTML=`<div class="me-wrap">
    <div class="me-top">
      <span class="cnt">📇 ${n} erfasst${pend?` · ${pend} noch nicht übertragen`:''}</span>
      <button class="me-lock" onclick="messeStaff()">🔒 Personal</button>
    </div>
    <div class="me-card">
      <div class="me-h">Kontakt aufnehmen</div>
      <div class="me-sub">Vielen Dank für Ihr Interesse! Bitte tragen Sie Ihre Daten ein.</div>
      <div class="me-field"><label>Organisation / Verein</label><input id="me-org" autocomplete="off" placeholder="z. B. Segelclub Pitz"></div>
      <div class="me-field"><label>Ansprechpartner:in</label><input id="me-person" autocomplete="off" placeholder="Vor- und Nachname"></div>
      <div class="me-field"><label>E-Mail</label><input id="me-email" type="email" autocomplete="off" placeholder="name@beispiel.de"></div>
      <div class="me-field"><label>Telefon</label><input id="me-tel" type="tel" autocomplete="off"></div>
      <div class="me-field"><label>Adresse</label><input id="me-adresse" autocomplete="off"></div>
      <div class="me-field"><label>Notiz / Interesse</label><textarea id="me-note" placeholder="Worum ging es? Woran besteht Interesse?"></textarea></div>
      <button class="me-btn" onclick="messeSaveEntry(this)">✓ Speichern</button>
      <div class="me-ok" id="me-ok">${msg?_esc(msg):''}</div>
    </div>
  </div>`;
}
function messeSaveEntry(btn){
  const g=id=>(document.getElementById(id)?.value||'').trim();
  const rec={ id:'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    org:g('me-org'), person:g('me-person'), email:g('me-email'), tel:g('me-tel'),
    adresse:g('me-adresse'), note:g('me-note'), ts:Date.now(), uploaded:false };
  if(!rec.org && !rec.person){ toast('Bitte mindestens Organisation oder Name eingeben.','err'); return; }
  const s=_state(); s.entries.push(rec); _persist(s);
  if(btn){ btn.disabled=true; }
  _renderForm('✓ Gespeichert – danke!');    // Formular geleert, kurze Bestätigung
}

// ── Personal-Bereich (per PIN): Liste, Übertragen, Beenden ──
function messeStaff(){
  const s=_state();
  const pin=window.prompt('PIN eingeben:');
  if(pin===null) return;
  if((pin||'').trim()!==s.pin){ toast('Falsche PIN.','err'); return; }
  _renderStaff();
}
function _renderStaff(){
  const o=_ensureOverlay(); const s=_state();
  const pend=s.entries.filter(e=>!e.uploaded).length;
  const items = s.entries.length
    ? s.entries.slice().reverse().map(e=>`<div class="me-list-item">
        <div><div class="nm">${_esc(e.org||e.person||'(ohne Name)')}${e.org&&e.person?` · ${_esc(e.person)}`:''}</div>
          <div class="dt">${new Date(e.ts).toLocaleString('de-DE')}${e.uploaded?' · ✓ übertragen':''}${e.email?' · '+_esc(e.email):''}</div></div>
        <button class="me-x" onclick="messeDeleteEntry('${e.id}')">Löschen</button>
      </div>`).join('')
    : '<div style="color:#5b6b7d;font-size:14px;padding:8px 0">Noch keine Kontakte erfasst.</div>';
  const catNames = s.cats.map(k=>s.catLabels[k]||k).join(', ');
  o.innerHTML=`<div class="me-wrap"><div class="me-card">
    <div class="me-h">🔒 Personal</div>
    <div class="me-sub">Kategorien: ${_esc(catNames||'–')} · ${s.entries.length} Kontakt(e), ${pend} noch nicht übertragen.</div>
    <button class="me-btn" onclick="messeTransfer(this)">⬆ ${pend} Kontakt(e) ins CRM übertragen (online)</button>
    <div style="max-height:46vh;overflow:auto;margin:14px 0">${items}</div>
    <button class="me-btn sec" onclick="_renderFormPublic()">← Zurück zum Formular</button>
    <button class="me-btn warn" onclick="messeEnd()">Messemodus beenden</button>
  </div></div>`;
}
function messeDeleteEntry(id){
  if(!window.confirm('Diesen Kontakt löschen?')) return;
  const s=_state(); s.entries=s.entries.filter(e=>e.id!==id); _persist(s); _renderStaff();
}

// ── Kontakte ins CRM übertragen (echte CRM-Einträge) ──
function _toEntity(m, cats){
  let treeKeys=[]; try{ treeKeys=getTrees().map(t=>t.key); }catch(e){}
  const tree = cats.find(k=>treeKeys.includes(k)) || treeKeys[0] || 'vereine';
  const org=(m.org||'').trim(), person=(m.person||'').trim();
  const name = org || person || '(Messe-Kontakt)';
  const ent={ id:newId(), tree, createdAt:m.ts||Date.now(),
    createdByKuerzel:'Messe', createdByName:'Messemodus',
    stamm:{ name }, categories:cats.slice(), status:[], statusLog:[],
    kontakte:[], termine:[], angebote:[], kontaktnotizen:[], todos:[], log:[] };
  if(person || m.email || m.tel || m.adresse){
    ent.kontakte.push({ id:newId(), name:person||name, funktion:'',
      emails:m.email?[m.email]:[], tels:m.tel?[m.tel]:[], adresse:m.adresse||'', note:'' });
  }
  if((m.note||'').trim()){
    ent.kontaktnotizen.push({ id:newId(), ts:m.ts||Date.now(), text:m.note.trim(), byKuerzel:'Messe', byName:'Messemodus' });
  }
  return { tree, ent };
}
async function messeTransfer(btn){
  if(!navigator.onLine){ toast('Zum Übertragen bitte online gehen (WLAN/Daten).','err'); return; }
  const s=_state(); const pend=s.entries.filter(e=>!e.uploaded);
  if(!pend.length){ toast('Keine neuen Kontakte zum Übertragen.',''); return; }
  if(btn){ btn.disabled=true; btn.textContent='⏳ Übertrage …'; }
  try{ await ensureCrmReady(); }catch(e){}
  let n=0;
  for(const m of pend){
    try{ const {tree,ent}=_toEntity(m, s.cats); await saveEntity(tree, ent); m.uploaded=true; m.crmId=ent.id; n++; }
    catch(e){ console.warn('Messe-Transfer:',e); }
  }
  _persist(s);
  toast(n+' Kontakt(e) ins CRM übertragen ✓', n?'ok':'err');
  _renderStaff();
}
function messeEnd(){
  if(!window.confirm('Messemodus beenden? Die App kehrt zur normalen Ansicht zurück.\n(Noch nicht übertragene Kontakte bleiben gespeichert.)')) return;
  const o=_ov(); if(o) o.remove();
}
// Zurück zum Formular ohne PIN (aus dem Personal-Bereich)
function _renderFormPublic(){ _renderForm(); }

export { messeStart };
// window-Registrierung (inline onclick im Overlay + Einstieg)
Object.assign(window, {
  messeStart, messeSaveSetup, messeExitSetup, messeSaveEntry, messeStaff,
  messeDeleteEntry, messeTransfer, messeEnd, _renderFormPublic
});
