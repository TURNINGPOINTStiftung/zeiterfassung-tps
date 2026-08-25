// ══════════════════════════════════════════════════════════════════
//  KI-Modul (eigener ☰-Pfad, isoliert – wie auswertung.js)
//  Bündelt die KI-gestützten Werkzeuge an EINEM Ort:
//   • KI-Server konfigurieren + testen (Endpoint in localStorage, geräte-lokal)
//   • „Notiz aufbereiten" als eigenständiges Werkzeug (Rohtext → saubere Notiz)
//  Endpoint-Vertrag (identisch zur CRM-Notizaufbereitung):
//   POST endpoint  { text, task }  →  JSON { note | result | summary | text }
//  Alles try/catch, self-registrierend (window.renderKI & co.); greift NIE auf
//  Zeiterfassungs- oder CRM-Daten zu (nur den localStorage-Endpoint).
// ══════════════════════════════════════════════════════════════════
import { getAiEndpoint, setAiEndpoint } from './crm-config.js';
import { toast } from '../utils.js';

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function _kiStyles(){
  if(document.getElementById('ki-styles')) return;
  const el=document.createElement('style'); el.id='ki-styles';
  el.textContent=`
  #ki-root{flex:1;min-height:0;overflow:auto;background:var(--bg);padding:24px 22px 60px}
  .ki-wrap{max-width:900px;margin:0 auto;width:100%}
  .ki-head{font-family:var(--ci-serif,Georgia,serif);font-size:1.55rem;font-weight:800;color:var(--text);margin:0 0 4px}
  .ki-sub{color:var(--muted);font-size:.95rem;margin:0 0 22px;max-width:62ch;line-height:1.5}
  .ki-card{background:var(--white,#fff);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(32,56,105,.06)}
  .ki-card h3{margin:0 0 4px;font-size:1.05rem;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ki-card .hint{color:var(--muted);font-size:.85rem;margin:0 0 14px;line-height:1.55}
  .ki-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .ki-inp{flex:1;min-width:220px;padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-size:14px;background:var(--white,#fff);color:var(--text)}
  .ki-inp:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .ki-ta{width:100%;min-height:120px;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;font-family:inherit;line-height:1.5;resize:vertical;background:var(--white,#fff);color:var(--text);box-sizing:border-box}
  .ki-ta:focus{outline:none;border-color:var(--primary-l);box-shadow:0 0 0 3px rgba(32,56,105,.12)}
  .ki-btn{padding:9px 16px;border:1.5px solid var(--primary);border-radius:9px;background:var(--primary);color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:filter .15s}
  .ki-btn:hover{filter:brightness(1.08)}
  .ki-btn:disabled{opacity:.55;cursor:default}
  .ki-btn.ghost{background:transparent;color:var(--primary);border-color:var(--border)}
  .ki-btn.ghost:hover{background:var(--row-alt,#eef2f7);filter:none}
  .ki-status{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;font-weight:600;padding:4px 11px;border-radius:999px}
  .ki-status.on{background:var(--ok,#12b347);color:#fff}
  .ki-status.off{background:var(--row-alt,#eef2f7);color:var(--muted)}
  .ki-out{white-space:pre-wrap;background:var(--row-alt,#f5f7fa);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-top:12px;font-size:14px;line-height:1.55;color:var(--text)}
  .ki-uselist{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:.88rem;line-height:1.7}
  .ki-soon{display:inline-block;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warn,#c67c00);background:rgba(198,124,0,.13);border-radius:6px;padding:2px 7px}
  `;
  document.head.appendChild(el);
}

export function renderKI(){
  try{
    _kiStyles();
    const root=document.getElementById('ki-root'); if(!root) return;
    const ep=getAiEndpoint();
    root.innerHTML = `<div class="ki-wrap">
      <div class="ki-head">🧠 KI</div>
      <p class="ki-sub">Werkzeuge rund um die KI-gestützte Textaufbereitung. Grundlage ist ein selbst gehosteter KI-Server – so bleiben alle Inhalte im eigenen Haus.</p>

      <div class="ki-card">
        <h3>🔌 KI-Server</h3>
        <p class="hint">Adresse des eigenen KI-Servers, der Text entgegennimmt und aufbereitet zurückgibt. Wird nur auf diesem Gerät gespeichert (nicht synchronisiert).</p>
        <div class="ki-row">
          <input id="ki-endpoint" class="ki-inp" placeholder="https://…/kontaktnotiz" value="${esc(ep)}">
          <button class="ki-btn" onclick="kiSaveEndpoint()">Speichern</button>
          <button class="ki-btn ghost" onclick="kiTestEndpoint(this)">Testen</button>
        </div>
        <div style="margin-top:12px">${ep?`<span class="ki-status on">● Server hinterlegt</span>`:`<span class="ki-status off">● kein Server hinterlegt</span>`}</div>
      </div>

      <div class="ki-card">
        <h3>📝 Notiz aufbereiten</h3>
        <p class="hint">Rohtext oder Stichpunkte einfügen und in eine saubere, strukturierte Fassung umwandeln lassen. Es wird nichts automatisch gespeichert – das Ergebnis kannst du kopieren.</p>
        <textarea id="ki-in" class="ki-ta" placeholder="Rohtext / Stichpunkte hier einfügen …"></textarea>
        <div class="ki-row" style="margin-top:10px">
          <button class="ki-btn" onclick="kiProcess('kontaktnotiz',this)">🧠 Aufbereiten</button>
          <button class="ki-btn ghost" onclick="kiProcess('zusammenfassung',this)">📄 Zusammenfassen</button>
          <button class="ki-btn ghost" onclick="kiCopyOut()">⧉ Ergebnis kopieren</button>
        </div>
        <div id="ki-out" class="ki-out" style="display:none"></div>
      </div>

      <div class="ki-card">
        <h3>ℹ️ Wo KI schon hilft <span class="ki-soon">im Aufbau</span></h3>
        <ul class="ki-uselist">
          <li><b>CRM – Kontaktnotizen:</b> Button „🧠 Aufbereiten" direkt beim Erfassen einer Notiz.</li>
          <li>Geplant: Zusammenfassungen, Aufgaben-Vorschläge und weitere Textbausteine.</li>
        </ul>
        <p class="hint" style="margin:12px 0 0">Zum Einrichten eines eigenen KI-Servers (lokaler Server / Ollama) gibt es eine separate Anleitung.</p>
      </div>
    </div>`;
  }catch(e){ console.error('renderKI Fehler:',e); }
}

function kiSaveEndpoint(){
  const v=(document.getElementById('ki-endpoint')?.value||'').trim();
  setAiEndpoint(v);
  toast(v?'KI-Server gespeichert ✓':'KI-Server entfernt.','ok');
  renderKI();
}

async function _kiCall(text, task){
  const ep=getAiEndpoint();
  if(!ep) throw new Error('kein KI-Server hinterlegt');
  const res=await fetch(ep,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text, task }) });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const data=await res.json();
  const out=String((data&&(data.note||data.result||data.summary||data.text))||'').trim();
  if(!out) throw new Error('leere Antwort vom Server');
  return out;
}

async function kiTestEndpoint(btn){
  const typed=(document.getElementById('ki-endpoint')?.value||'').trim();
  if(typed && typed!==getAiEndpoint()) setAiEndpoint(typed);   // erst speichern, dann testen
  if(!getAiEndpoint()){ toast('Bitte zuerst eine Server-Adresse eintragen.','err'); return; }
  const orig=btn?btn.textContent:''; if(btn){ btn.disabled=true; btn.textContent='⏳ …'; }
  try{
    await _kiCall('Testnachricht: bitte kurz bestätigen.', 'kontaktnotiz');
    toast('KI-Server erreichbar ✓','ok');
  }catch(e){ toast('Test fehlgeschlagen: '+((e&&e.message)||e),'err'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=orig; } }
}

async function kiProcess(task, btn){
  const ta=document.getElementById('ki-in'); const outEl=document.getElementById('ki-out');
  const text=((ta&&ta.value)||'').trim();
  if(!text){ toast('Bitte zuerst Text einfügen.','err'); return; }
  if(!getAiEndpoint()){ toast('Kein KI-Server hinterlegt – oben eintragen und speichern.','err'); return; }
  const orig=btn?btn.textContent:''; if(btn){ btn.disabled=true; btn.textContent='⏳ …'; }
  try{
    const out=await _kiCall(text, task);
    if(outEl){ outEl.textContent=out; outEl.style.display=''; }
    toast('Fertig – Ergebnis unten.','ok');
  }catch(e){ toast('KI-Aufbereitung fehlgeschlagen: '+((e&&e.message)||e),'err'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=orig; } }
}

function kiCopyOut(){
  const outEl=document.getElementById('ki-out');
  const txt=outEl?outEl.textContent:'';
  if(!txt){ toast('Noch kein Ergebnis zum Kopieren.','err'); return; }
  const done=()=>toast('Kopiert ✓','ok');
  try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done,()=>{ _kiCopyFallback(txt,done); }); return; } }catch(e){}
  _kiCopyFallback(txt,done);
}
function _kiCopyFallback(txt,done){ try{ const t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); }catch(e){ toast('Kopieren nicht möglich.','err'); } }

Object.assign(window, { renderKI, kiSaveEndpoint, kiTestEndpoint, kiProcess, kiCopyOut });
