// ══════════════════════════════════════════════════════════════════
//  🏠 Startseite – eigener ☰-Pfad „start" (Rahmen #mod-start / #home-root)
//  Pro Mitarbeiter in der Verwaltung schaltbar (perms.startseite); Standard: nur Admin.
//  Karten: Wetter & Wind (Wohnort aus dem Profil, Wind in Knoten) · Stempeln · Was ansteht
//  (CRM-Aufgaben/-Termine, Shop) · Mitteilungen · Team (Leitung/GF) · Kacheln zu allen Modulen.
//  Die Seite steht sofort; Karten mit nachzuladenden Daten füllen sich einzeln.
//  Alles best effort: ein Fehler in einer Karte darf nie die App stören.
//  Namespace-Importe (siehe Memory „neue Exporte → Namespace-Import") + Laufzeit-Checks.
// ══════════════════════════════════════════════════════════════════
import * as D from './data.js';
import * as CA from './calc.js';
import * as R from './roles.js';
import * as CD from './crm/crm-data.js';
import * as CC from './crm/crm-config.js';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsq=s=>esc(JSON.stringify(String(s==null?'':s)));
const pad=n=>String(n).padStart(2,'0');
const isoDay=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const fmtD=iso=>{ if(!iso) return ''; const p=String(iso).slice(0,10).split('-'); return +p[2]+'.'+ +p[1]+'.'; };
const hm=min=>{ const s=min<0?'−':''; min=Math.abs(Math.round(min)); return s+Math.floor(min/60)+':'+pad(min%60); };

// ── Wer bekommt die Startseite? ─────────────────────────────────────
export function homeEnabled(u){
  u=u||window.cu; if(!u) return false;
  const p=u.perms||{};
  return Object.prototype.hasOwnProperty.call(p,'startseite') ? !!p.startseite : (u.role==='admin');
}
function homeGo(){ if(homeEnabled() && window.switchModule) window.switchModule('start'); }

// ── Karten pro Rolle (Verwaltung → Organisation) ───────────────────
// Gespeichert im bestehenden Config-Knoten rolePermissions (nur der Admin-Account schreibt ihn):
//   rolePermissions['home_<karte>'] = [rollen…]   (fehlt → Standard unten)
//   rolePermissions['home__order']  = [karten…]   (Reihenfolge für alle)
// Kein echtes Recht – hasPermission() fragt diese Schlüssel nie ab; die Rechte-Matrix zeigt nur PERM_DEFS.
const CARDS=[
  { k:'wx',     l:'🌤️ Wetter & Wind' },
  { k:'stamp',  l:'⏱️ Stempeln', hint:'nur wer die Zeiterfassung nutzt und stempeln darf' },
  { k:'sys',    l:'🛠️ System', hint:'nur Admin bzw. System-Verwaltung' },
  { k:'todo',   l:'📌 Was ansteht' },
  { k:'notes',  l:'🔔 Mitteilungen' },
  { k:'team',   l:'👥 Team', hint:'zeigt die Mitarbeiter, die man sehen darf' },
  { k:'favs',   l:'⭐ Favoriten' },
  { k:'recent', l:'🕘 Zuletzt geöffnet', hint:'Standard aus – bei Bedarf pro Rolle einschalten' },
  { k:'tiles',  l:'🧩 Kacheln (Module, Website, Forum)' },
];
const HOME_ROLES=[['admin','Admin'],['mitarbeiter','Mitarbeiter'],['berater','Berater'],['freiberuflich','Freiberuflich'],['leitung','Leitung'],['geschaeftsfuehrer','GF']];
const ALL_R=HOME_ROLES.map(r=>r[0]);
const CARD_DEF={ wx:ALL_R, stamp:ALL_R.filter(r=>r!=='admin'), sys:['admin'], todo:ALL_R, notes:ALL_R, team:['leitung','geschaeftsfuehrer'], favs:ALL_R, recent:[], tiles:ALL_R };
function _rp(){ try{ return D.getData().rolePermissions||{}; }catch(e){ return {}; } }
function cardRoles(k){ const v=_rp()['home_'+k]; return Array.isArray(v)?v:(CARD_DEF[k]||ALL_R); }
function cardOn(k,u){
  u=u||window.cu||{}; const v=_rp()['home_'+k];
  if(Array.isArray(v)) return v.includes(u.role);
  if(k==='sys') return u.role==='admin' || !!(R.hasPermission && R.hasPermission('zugriff_verwaltung',u));   // Standard wie bisher
  return (CARD_DEF[k]||ALL_R).includes(u.role);
}
function cardOrder(){
  const keys=CARDS.map(c=>c.k); const o=_rp()['home__order'];
  const base=Array.isArray(o)?o.filter(k=>keys.includes(k)):[];
  return base.concat(keys.filter(k=>!base.includes(k)));   // neue Karten hinten anhängen
}
function _cfgSave(fn){
  if(!(window.cu && window.cu.role==='admin')){ try{ window.toast&&window.toast('Nur der Administrator-Account kann das ändern.','err'); }catch(e){} return; }
  try{ D.mutate(d=>{ if(!d.rolePermissions) d.rolePermissions={}; fn(d.rolePermissions); }); }catch(e){ console.error('Startseite-Karten speichern:',e); }
  const el=document.getElementById('home-cards-section'); if(el) renderHomeCardsConfig(el);
  if(window._activeModule==='start') renderHome();
}
function homeCfgSet(k,role,on){ _cfgSave(rp=>{ const cur=new Set(cardRoles(k)); if(on) cur.add(role); else cur.delete(role); rp['home_'+k]=ALL_R.filter(r=>cur.has(r)); }); }
function homeCfgMove(k,dir){ _cfgSave(rp=>{ const o=cardOrder(); const i=o.indexOf(k), j=i+dir; if(i<0||j<0||j>=o.length) return; [o[i],o[j]]=[o[j],o[i]]; rp['home__order']=o; }); }
function homeCfgReset(){ if(!confirm('Karten der Startseite auf den Standard zurücksetzen?')) return;
  _cfgSave(rp=>{ CARDS.forEach(c=>{ delete rp['home_'+c.k]; }); delete rp['home__order']; }); }
function renderHomeCardsConfig(el){
  try{
    const adm=!!(window.cu && window.cu.role==='admin');
    const order=cardOrder();
    const rows=order.map((k,i)=>{ const c=CARDS.find(x=>x.k===k); if(!c) return ''; const rs=cardRoles(k);
      return `<tr><td style="padding:5px 8px;white-space:nowrap">
          <button class="btn btn-outline btn-sm" style="padding:1px 6px" ${adm&&i>0?'':'disabled'} onclick="homeCfgMove('${k}',-1)" title="nach oben">↑</button>
          <button class="btn btn-outline btn-sm" style="padding:1px 6px" ${adm&&i<order.length-1?'':'disabled'} onclick="homeCfgMove('${k}',1)" title="nach unten">↓</button></td>
        <td style="padding:5px 8px"><b>${esc(c.l)}</b>${c.hint?`<div style="font-size:11px;color:var(--muted)">${esc(c.hint)}</div>`:''}</td>
        ${HOME_ROLES.map(([r])=>`<td style="text-align:center;padding:5px"><input type="checkbox" style="width:16px;height:16px;cursor:pointer" ${rs.includes(r)?'checked':''} ${adm?'':'disabled'} onchange="homeCfgSet('${k}','${r}',this.checked)"></td>`).join('')}</tr>`; }).join('');
    el.innerHTML=`<div style="margin-top:22px">
      <h3 style="margin:0 0 4px;color:var(--primary)">🏠 Startseite – Karten pro Rolle</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 10px">Welche Karten jede Rolle auf der Startseite sieht und in welcher Reihenfolge (gilt für alle mit eingeschalteter Startseite).${adm?'':' Ändern kann nur der Administrator-Account.'}</p>
      <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;min-width:620px">
        <thead><tr><th></th><th style="text-align:left;padding:6px 8px">Karte</th>${HOME_ROLES.map(([,l])=>`<th style="font-size:11px;padding:6px 8px;text-align:center">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${adm?'<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="homeCfgReset()">↺ Standard wiederherstellen</button>':''}</div>`;
  }catch(e){ console.error('renderHomeCardsConfig:',e); }
}

// ── Styles ─────────────────────────────────────────────────────────
let _css=false;
function _styles(){
  if(_css) return; _css=true;
  const st=document.createElement('style'); st.textContent=`
  #home-root{flex:1;display:flex;min-width:0;max-width:100%}
  .home-wrap{position:relative;flex:1;min-width:0;padding:22px 24px 40px;overflow:hidden;min-height:calc(100vh - 70px)}
  .home-bgl{position:fixed;left:50%;top:55%;transform:translate(-50%,-50%);width:96vw;max-width:none;height:auto;opacity:.10;pointer-events:none;user-select:none;z-index:0}   /* immer mittig, volle Bildbreite (User-Vorgabe) */
  .home-in{position:relative;z-index:1;max-width:none;margin:0}
  .home-hi{font-size:24px;font-weight:700;color:var(--primary,#203869);margin:0}
  .home-date{font-size:14px;color:var(--muted);margin:2px 0 18px}
  /* Spalten wie ein Kanban-Board: Karten unterschiedlich hoch, Anordnung frei per Ziehen (✥ Anordnen) */
  .home-top{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:18px}
  .home-top .home-date{margin-bottom:0}
  .home-arr-btn{margin-left:auto;border:1px solid var(--border);background:rgba(255,255,255,.85);border-radius:20px;padding:5px 14px;font-size:13px;cursor:pointer;color:var(--muted)}
  .home-arr-btn:hover{color:var(--primary,#203869);border-color:var(--primary,#203869)}
  .home-cols{display:flex;gap:14px;align-items:flex-start}
  .home-col{flex:1;min-width:0;min-height:30px;display:flex;flex-direction:column}
  .home-slot{position:relative}
  .home-slot > .home-card{margin-bottom:14px}
  .home-card{background:rgba(255,255,255,.80);backdrop-filter:blur(1px);border:1px solid var(--border);border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .home-tiles-wrap{margin-top:4px}
  /* Anordnen-Modus */
  .home-arrange .home-col{outline:2px dashed #c9d3e3;outline-offset:4px;border-radius:14px;min-height:120px;padding-bottom:6px}
  .home-arrange .home-slot{cursor:grab;touch-action:none;user-select:none}
  .home-arrange .home-slot > .home-card{display:block !important;min-height:56px}
  .home-arrange .home-slot > .home-card *{pointer-events:none}
  .home-arrange .home-slot > .home-card:hover{border-color:var(--primary,#203869)}
  .home-slot .home-x{display:none;position:absolute;top:6px;right:8px;z-index:2;border:none;background:#fff;border-radius:50%;width:26px;height:26px;cursor:pointer;color:#b42318;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
  .home-arrange .home-slot .home-x{display:block}
  .home-ph{border:2px dashed var(--primary,#203869);border-radius:14px;margin-bottom:14px;background:rgba(32,56,105,.05)}
  .home-ghost{position:fixed;z-index:9999;pointer-events:none;opacity:.9;transform:rotate(1.5deg);box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .home-tray{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.85);border:1px solid var(--border);font-size:13px}
  .home-tray button{border:1px solid var(--border);background:#fff;border-radius:16px;padding:3px 10px;cursor:pointer;font-size:13px}
  .home-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin:0 0 10px;display:flex;align-items:center;gap:6px}
  .home-row{display:flex;align-items:center;gap:8px;font-size:14px;padding:7px 0;border-top:1px solid var(--border);cursor:pointer}
  .home-row:first-of-type{border-top:none}.home-row:hover{color:var(--primary,#203869)}
  .home-row .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .home-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;background:#e8eef8;color:#203869}
  .home-pill.red{background:#fde8e8;color:#b42318}.home-pill.amber{background:#fef3c7;color:#92400e}.home-pill.green{background:#e7f6e9;color:#1b5e20}
  .home-empty{font-size:13px;color:var(--muted);padding:4px 0}
  .home-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:10px;margin-top:14px}
  .home-tile{background:rgba(255,255,255,.80);border:1px solid var(--border);border-radius:14px;padding:14px 6px;text-align:center;cursor:pointer;font-size:13px;font-weight:600;color:var(--text);overflow-wrap:anywhere;hyphens:auto}
  .home-tile:hover{border-color:var(--primary,#203869);color:var(--primary,#203869)}
  .home-tile .ic{font-size:26px;display:block;margin-bottom:4px}
  .home-stamp{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .home-dot{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}
  .home-big{font-size:16px;font-weight:700;color:var(--text)}
  .home-sub{font-size:13px;color:var(--muted)}
  .home-wx{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .home-wx .ic{font-size:40px;line-height:1}
  .home-wx .t{font-size:30px;font-weight:700;color:var(--text)}
  .home-wind{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:var(--primary,#203869)}
  .home-arrow{display:inline-block;font-size:20px;line-height:1}
  .home-days{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
  .home-day{flex:1;min-width:90px;background:var(--bg,#f0f2f5);border-radius:10px;padding:6px 8px;font-size:12px;text-align:center}
  .home-notes .ze-notice{margin:0 0 6px;border-radius:10px;background:#fff4e5;padding:8px 10px}
  .home-chips{display:flex;gap:8px;flex-wrap:wrap}
  .home-chip{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:20px;background:var(--white,#fff);font-size:13.5px;max-width:100%}
  .home-chip .lbl{padding:6px 4px 6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
  .home-chip .lbl:hover{color:var(--primary,#203869)}
  .home-chip .star{border:none;background:none;cursor:pointer;font-size:16px;padding:4px 10px 4px 4px;color:#b8bec7;line-height:1}
  .home-chip .star.on{color:#f5a623}
  body.mod-start #ze-notice-bar{display:none}
  body.mod-start #mb-menu-btn{display:none !important}   /* auf der Startseite übernehmen die Kacheln das ☰-Menü */
  a.home-tile{display:block}
  @media(max-width:640px){ .home-wrap{padding:14px 12px 30px} .home-tiles{grid-template-columns:repeat(2,minmax(0,1fr))} .home-hi{font-size:20px} }`;
  document.head.appendChild(st);
}

// ── Seite ──────────────────────────────────────────────────────────
let _tick=null, _renderedHidden='';
export function renderHome(){
  try{
    _styles();
    const root=document.getElementById('home-root'); if(!root) return;
    const cu=window.cu; if(!cu){ root.innerHTML=''; return; }
    const h=new Date().getHours();
    const gruss=h<11?'Guten Morgen':(h<17?'Hallo':'Guten Abend');
    const first=String(cu.name||'').trim().split(/\s+/)[0]||'';
    const datum=new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    // Welche Karten in welcher Reihenfolge: Verwaltung → Organisation → „Startseite – Karten pro Rolle"
    // (cardOn) – UND die Karte muss für die Person überhaupt Sinn ergeben (Stempeln nur mit ZE, System nur Verwaltung).
    const BOX={
      wx:   ()=>'<div class="home-card" id="home-wx"><p class="home-h">🌤️ Wetter &amp; Wind</p><div class="home-empty">Lädt …</div></div>',
      stamp:()=>_stampAllowed(cu)?'<div class="home-card" id="home-stamp"></div>':'',
      sys:  ()=>_sysAllowed(cu)?'<div class="home-card" id="home-sys"><p class="home-h">🛠️ System</p><div class="home-empty">Lädt …</div></div>':'',
      todo: ()=>'<div class="home-card" id="home-todo"><p class="home-h">📌 Was ansteht</p><div class="home-empty">Lädt …</div></div>',
      notes:()=>'<div class="home-card" id="home-notes"><p class="home-h">🔔 Mitteilungen</p><div class="home-notes"></div></div>',
      team: ()=>'<div class="home-card" id="home-team"><p class="home-h">👥 Team</p></div>',
      favs:  ()=>'<div class="home-card" id="home-favs" style="display:none"></div>',
      recent:()=>'<div class="home-card" id="home-recent" style="display:none"></div>',
    };
    const hid=_hiddenCards();
    const avail=cardOrder().filter(k=>k!=='tiles' && cardOn(k,cu) && BOX[k] && BOX[k]());   // für die Person sinnvolle Karten
    const vis=avail.filter(k=>!hid.includes(k));
    const n=_colCount(); _renderedN=n;
    const cols=_layoutFor(n, vis);
    _renderedHidden=JSON.stringify([hid, _prefs()&&_prefs().layouts||null]);
    // Persönliche Einstellungen kommen aus den CRM-Daten – sind die beim ersten Zeichnen noch nicht da,
    // einmal nachzeichnen, sobald geladen (nur wenn sich etwas geändert hat).
    try{ if(CD.ensureCrmReady) CD.ensureCrmReady().then(()=>{ if(window._activeModule==='start' && !_arranging && JSON.stringify([_hiddenCards(), _prefs()&&_prefs().layouts||null])!==_renderedHidden) renderHome(); }); }catch(e){}
    const slot=k=>`<div class="home-slot" data-k="${k}"><button class="home-x" title="Karte ausblenden" onpointerdown="event.stopPropagation()" onclick="homeHideCard('${k}',true)">✕</button>${BOX[k]()}</div>`;
    const hiddenAvail=avail.filter(k=>hid.includes(k));
    root.innerHTML=`<div class="home-wrap${_arranging?' home-arrange':''}">
      <img class="home-bgl" src="icons/tps-logo-segel.svg" alt="" aria-hidden="true">
      <div class="home-in">
        <div class="home-top"><div><p class="home-hi">${esc(gruss)}${first?', '+esc(first):''}</p>
          <p class="home-date">${esc(datum)}</p></div>
          ${_arranging?`<button class="home-arr-btn" onclick="homeArrangeReset()">↺ Standard</button><button class="home-arr-btn" style="margin-left:0;background:var(--primary,#203869);color:#fff;border-color:var(--primary,#203869)" onclick="homeArrange(false)">✓ Fertig</button>`
            :`<button class="home-arr-btn" onclick="homeArrange(true)" title="Karten verschieben und ausblenden">✥ Anordnen</button>`}</div>
        ${_arranging?`<div class="home-tray"><b>Karten ziehen</b> – zwischen Spalten und nach oben/unten. ✕ blendet aus.${hiddenAvail.length?' &nbsp;Ausgeblendet: '+hiddenAvail.map(k=>{ const c=CARDS.find(x=>x.k===k); return `<button onclick="homeHideCard('${k}',false)">＋ ${esc(c?c.l:k)}</button>`; }).join(''):''}</div>`:''}
        <div class="home-cols" id="home-cols">${cols.map((c,i)=>`<div class="home-col" data-col="${i}">${c.map(slot).join('')}</div>`).join('')}</div>
        ${cardOn('tiles',cu) && !hid.includes('tiles')?'<div class="home-tiles-wrap"><div class="home-tiles" id="home-tiles"></div></div>':''}
      </div></div>`;
    if(_arranging) _armDrag();
    _fillStamp(); _fillNotes(); _fillTiles(); _fillTeam(); _fillRecent(); _fillSys();
    _fillTodo(); _fillWeather();
    clearInterval(_tick);
    _tick=setInterval(()=>{ if(window._activeModule!=='start'){ clearInterval(_tick); _tick=null; _arranging=false; return; } _fillStamp(); _fillNotes(); }, 5000);
  }catch(e){ console.error('renderHome:',e); }
}
const _el=id=>document.getElementById(id);

// ── Spalten-Layout & ✥ Anordnen (wie ein Kanban-Board) ─────────────
// Anordnung PRO PERSON, geräteübergreifend in crm/userPrefs: layouts = { "<Spaltenzahl>": [[karten…],…] }.
// Je Spaltenzahl gemerkt (Handy 1, Tablet 2, PC 3–4), weil eine 4-Spalten-Anordnung am Handy anders aussieht.
// Fehlt sie für die aktuelle Breite → aus einer anderen ableiten bzw. Standard (Rollen-Reihenfolge, zeilenweise).
let _arranging=false, _renderedN=0;
function _colCount(){ const w=(document.getElementById('home-root')||document.body).clientWidth||window.innerWidth; return Math.max(1, Math.min(4, Math.floor((w-40)/330))); }
function _layoutFor(n, vis){
  const ls=(_prefs()&&_prefs().layouts)||{};
  let src=Array.isArray(ls[n])?ls[n]:null;
  let cols=Array.from({length:n},()=>[]);
  if(src){ src.forEach((c,i)=>(c||[]).forEach(k=>{ if(vis.includes(k)) cols[i%n].push(k); })); }
  else {   // aus der größten gespeicherten Anordnung ableiten (Spalte j → j mod n), sonst zeilenweise verteilen
    const other=Object.keys(ls).map(Number).filter(x=>Array.isArray(ls[x])).sort((a,b)=>b-a)[0];
    if(other) ls[other].forEach((c,j)=>(c||[]).forEach(k=>{ if(vis.includes(k)) cols[j%n].push(k); }));
  }
  const placed=new Set(cols.flat());
  // Neue/nicht platzierte Karten: Standard zeilenweise (Leserichtung links→rechts), sonst in die kürzeste Spalte
  vis.filter(k=>!placed.has(k)).forEach((k,i)=>{ const tgt=(src||Object.keys(ls).length)?cols.reduce((a,c,ci)=>c.length<cols[a].length?ci:a,0):(i%n); cols[tgt].push(k); });
  return cols;
}
function homeArrange(on){ _arranging=!!on; renderHome(); }
function homeArrangeReset(){ if(!confirm('Anordnung der Startseite auf den Standard zurücksetzen?')) return; _savePrefs({ layouts:{} }); renderHome(); }
function _saveLayout(){
  const cols=[...document.querySelectorAll('#home-cols .home-col')].map(c=>[...c.querySelectorAll(':scope > .home-slot')].map(s=>s.dataset.k));
  const ls=Object.assign({}, (_prefs()&&_prefs().layouts)||{}); ls[cols.length]=cols;
  _savePrefs({ layouts:ls });
}
// Ziehen mit Maus UND Finger (Pointer-Events; HTML5-Drag&Drop geht auf dem Handy nicht)
function _armDrag(){
  document.querySelectorAll('#home-cols .home-slot').forEach(sl=>{
    sl.onpointerdown=ev=>{
      if(ev.button>0) return; ev.preventDefault();
      const r=sl.getBoundingClientRect(), offX=ev.clientX-r.left, offY=ev.clientY-r.top;
      const ghost=sl.cloneNode(true); ghost.classList.add('home-ghost'); ghost.style.width=r.width+'px'; ghost.style.left=r.left+'px'; ghost.style.top=r.top+'px';
      document.body.appendChild(ghost);
      const ph=document.createElement('div'); ph.className='home-ph'; ph.style.height=Math.max(50,r.height-14)+'px';
      sl.parentNode.insertBefore(ph, sl); sl.style.display='none';
      const move=e=>{
        ghost.style.left=(e.clientX-offX)+'px'; ghost.style.top=(e.clientY-offY)+'px';
        const cols=[...document.querySelectorAll('#home-cols .home-col')]; if(!cols.length) return;
        let col=cols.find(c=>{ const b=c.getBoundingClientRect(); return e.clientX>=b.left-7 && e.clientX<=b.right+7; })
          || cols.reduce((a,c)=>Math.abs(c.getBoundingClientRect().left-e.clientX)<Math.abs(a.getBoundingClientRect().left-e.clientX)?c:a, cols[0]);
        const sibs=[...col.querySelectorAll(':scope > .home-slot')].filter(x=>x!==sl);
        const before=sibs.find(x=>{ const b=x.getBoundingClientRect(); return e.clientY < b.top+b.height/2; });
        if(before) col.insertBefore(ph, before); else col.appendChild(ph);
        // am Rand automatisch scrollen
        if(e.clientY<60) window.scrollBy(0,-12); else if(e.clientY>window.innerHeight-60) window.scrollBy(0,12);
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up);
        ph.parentNode.insertBefore(sl, ph); ph.remove(); ghost.remove(); sl.style.display='';
        _saveLayout();
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
    };
  });
}
// Breite geändert (Fenster, Handy gedreht) → andere Spaltenzahl → neu zeichnen
let _rsT=null;
window.addEventListener('resize',()=>{ clearTimeout(_rsT); _rsT=setTimeout(()=>{ if(window._activeModule==='start' && _colCount()!==_renderedN) renderHome(); },250); });

// ── Stempeln ───────────────────────────────────────────────────────
function _stampAllowed(cu){
  try{
    if(cu.role==='admin') return false;
    const zeBtn=document.querySelector('.mb-mod[data-mod="zeiterfassung"]');
    if(zeBtn && zeBtn.style.display==='none') return false;
    return !(R.hasPermission && !R.hasPermission('stempel',cu));
  }catch(e){ return false; }
}
function _fillStamp(){
  const box=_el('home-stamp'); if(!box) return;
  try{
    const cu=window.cu; const st=window.getStamp?window.getStamp():null;
    const on=!!(st && (!st.uid || st.uid===cu.id));
    let dur=''; if(on && st.startTime){ dur=hm((Date.now()-Date.parse(st.startTime))/60000); }
    let extra='';
    try{
      const u=(D.getUser&&D.getUser(cu.id))||cu;
      if(!(R.isFreelancer&&R.isFreelancer(u))){
        const n=new Date(), y=n.getFullYear(), m=n.getMonth()+1;
        const e=D.getEntry(cu.id,y,m);
        const ist=CA.monthIST(e,u), carry=CA.getEffectiveCarryH(cu.id,u,y,m);
        const open=!(e.status==='submitted'||e.status==='approved');
        const soll=open?CA.monthSOLLToDate(u,y,m):CA.monthSOLL(u,y,m);
        const saldo=ist-(soll-Math.round(carry*60));
        const vs=CA.vacStatus(cu.id,u,y,m);
        extra=`Stundenkonto <b style="color:${saldo<0?'var(--danger)':'var(--ok)'}">${saldo>=0?'+':''}${hm(saldo)} h</b> · Resturlaub <b>${(vs.left||0)+(vs.carryLeft||0)} Tage</b>`;
      }
    }catch(e){}
    box.innerHTML=`<p class="home-h">⏱️ Stempeln</p><div class="home-stamp">
      <div class="home-dot" style="background:${on?'#e7f6e9':'#eef1f5'}">${on?'🟢':'⏸️'}</div>
      <div style="flex:1;min-width:160px"><div class="home-big">${on?`Eingestempelt seit ${esc(st.von||'')}`:'Nicht eingestempelt'}</div>
        <div class="home-sub">${on&&dur?'läuft '+dur+' h · ':''}${extra}</div></div>
      <button class="btn ${on?'btn-outline':'btn-primary'}" onclick="window.openZeitstempel&&openZeitstempel()">${on?'Ausstempeln':'Einstempeln'}</button></div>`;
  }catch(e){ box.innerHTML='<p class="home-h">⏱️ Stempeln</p><div class="home-empty">Gerade nicht verfügbar.</div>'; }
}

// ── Mitteilungen (gleiche Einträge wie die Leiste oben – die ist auf der Startseite ausgeblendet) ──
function _fillNotes(){
  const box=document.querySelector('#home-notes .home-notes'); if(!box) return;
  const items=[...document.querySelectorAll('#ze-notice-bar .ze-notice')];
  // Alles gelesen → Karte ganz ausblenden (User: „im Grunde ein leeres Feld"); kommt bei neuen Mitteilungen wieder
  const card=document.getElementById('home-notes'); if(card) card.style.display=items.length?'':'none';
  const html=items.map(n=>n.outerHTML).join('');
  if(box.innerHTML!==html) box.innerHTML=html;
  box.onclick=()=>setTimeout(_fillNotes,250);   // nach „✓ Gelesen" sofort aktualisieren
}

// ── Was ansteht: CRM-Aufgaben (mir zugewiesen) + meine Termine (7 Tage) + Shop ──
function _flat(arr,out){ (arr||[]).forEach(t=>{ if(!t) return; out.push(t); _flat(t.children,out); }); return out; }
async function _fillTodo(){
  const box=_el('home-todo'); if(!box) return;
  const rows=[]; const today=isoDay(new Date()); const in7=isoDay(new Date(Date.now()+7*864e5));
  // Shop (sofort verfügbar)
  try{ const s=window.shopHomeItems?window.shopHomeItems():null;
    if(s){ s.due.slice(0,4).forEach(d=>rows.push({ sort:d.datum, html:`<div class="home-row" onclick="shopDueNoticeOpen()"><span>🔧</span><span class="tx">${esc(d.title)} – ${esc(d.label)}</span><span class="home-pill ${d.over?'red':'amber'}">${d.over?'überfällig':fmtD(d.datum)}</span></div>` }));
      if(s.orders) rows.push({ sort:'0', html:`<div class="home-row" onclick="shopOpenTab('bestellungen')"><span>🛒</span><span class="tx">${s.orders} ${s.mgr?'neue Bestellung':'offene Bestellung'}${s.orders===1?'':'en'}</span><span class="home-pill">Shop</span></div>` }); }
  }catch(e){}
  // CRM (Daten ggf. erst laden)
  try{
    if(CD.ensureCrmReady) await CD.ensureCrmReady();
    const me=(window.cu&&window.cu.id)||'';
    const tasks=[];
    const scan=(kind,o,name)=>{ if(!o||o.closed) return; _flat(o.todos,[]).forEach(t=>{ if(t.assigneeId===me && t.status!=='erledigt') tasks.push({kind,id:o.id,name,t}); }); };
    (CD.listVeranstaltungen?CD.listVeranstaltungen():[]).forEach(v=>scan('veranstaltung',v,v.titel||'Veranstaltung'));
    (CD.listTeamProjekte?CD.listTeamProjekte():[]).forEach(p=>scan('teamprojekt',p,p.name||'Projekt'));
    tasks.forEach(a=>{ const due=a.t.due||''; const over=due&&due<today;
      rows.push({ sort:due||'9999', html:`<div class="home-row" onclick="crmMeineOpen(${jsq(a.kind)},'',${jsq(a.id)},${jsq(a.t.id)})"><span>☑️</span><span class="tx">${esc(a.t.text||'Aufgabe')} <span class="home-sub">· ${esc(a.name)}</span></span>${due?`<span class="home-pill ${over?'red':''}">${over?'überfällig':fmtD(due)}</span>`:''}</div>` }); });
    (CD.listVeranstaltungen?CD.listVeranstaltungen():[]).forEach(v=>{
      if(v.closed||!v.start) return; const s=String(v.start).slice(0,10), e=String(v.ende||v.start).slice(0,10);
      if(e<today||s>in7) return;
      if(!(Array.isArray(v.mitarbeiter)&&v.mitarbeiter.includes(me))) return;
      rows.push({ sort:s, html:`<div class="home-row" onclick="homeOpenVa(${jsq(v.id)})"><span>📅</span><span class="tx">${esc(v.titel||'Veranstaltung')}</span><span class="home-pill green">${s<=today?'heute':fmtD(s)}</span></div>` });
    });
  }catch(e){}
  rows.sort((a,b)=>String(a.sort).localeCompare(String(b.sort)));
  const more=rows.length>8?`<div class="home-sub" style="padding-top:6px">… und ${rows.length-8} weitere</div>`:'';
  box.innerHTML='<p class="home-h">📌 Was ansteht</p>'+(rows.length?rows.slice(0,8).map(r=>r.html).join('')+more:'<div class="home-empty">Gerade steht nichts an. ✓</div>');
}
function homeOpenVa(id){ try{ window._crmMode='veranstaltungen'; window._crmVaSel=id; window.switchModule&&window.switchModule('crm'); }catch(e){} }

// ── ⭐ Favoriten & zuletzt geöffnet ─────────────────────────────────
// Erfasst werden geöffnete CRM-Einträge (Vereine, Kontakte …), Veranstaltungen und Projekte – gemeldet
// von js/nav.js (renderCrumbs → homeTrack). Gespeichert PRO GERÄT im Browser (localStorage), je Nutzer.
// Schlüssel: 'e|<tree>|<id>' · 'va|<id>' · 'tp|<id>'.
const _rk=()=>'tps_home_recent_'+((window.cu&&window.cu.id)||'');
const _fk=()=>'tps_home_favs_'+((window.cu&&window.cu.id)||'');
const _arr=k=>{ const a=_lsGet(k); return Array.isArray(a)?a:[]; };
function _itemOf(s){   // nav-Snapshot → Eintrag oder null
  if(!s||!s.c) return null; const c=s.c, mode=c._crmMode||'kontakte';
  if(mode==='kontakte' && c._crmTree && c._crmSelId) return { key:'e|'+c._crmTree+'|'+c._crmSelId };
  if(mode==='veranstaltungen' && c._crmVaSel) return { key:'va|'+c._crmVaSel };
  if((mode==='teams'||mode==='meine') && c._crmTeamProjSel) return { key:'tp|'+c._crmTeamProjSel };
  return null;
}
function _info(key){   // → {label, icon} oder null (gelöscht / keine Daten)
  const [k,a,b]=String(key).split('|');
  try{
    if(k==='e'){ const e=CD.getEntity&&CD.getEntity(a,b); if(!e) return null;
      let ic='📇'; try{ const tr=(CC.getTrees?CC.getTrees():[]).find(t=>t.key===a); if(tr&&tr.icon) ic=tr.icon; }catch(err){}
      return { label:(e.stamm&&e.stamm.name)||'Eintrag', icon:ic }; }
    if(k==='va'){ const v=CD.getVeranstaltung&&CD.getVeranstaltung(a); return v?{ label:v.titel||'Veranstaltung', icon:'📅' }:null; }
    if(k==='tp'){ const p=CD.getTeamProjekt&&CD.getTeamProjekt(a); return p?{ label:p.name||'Projekt', icon:'📂' }:null; }
  }catch(e){}
  return null;
}
function homeTrack(s){
  try{ const it=_itemOf(s); if(!it) return;
    const inf=_info(it.key); if(!inf) return;
    const a=_arr(_rk()).filter(x=>x.key!==it.key); a.unshift({ key:it.key, label:inf.label, ts:Date.now() });
    _lsSet(_rk(), a.slice(0,15));
  }catch(e){}
}
// ── Geräteübergreifend: crm/userPrefs/<uid> (Favoriten + ausgeblendete Karten) ──
// Favoriten liegen zusätzlich lokal (Cache/Altbestand); „Zuletzt geöffnet" bleibt bewusst pro Gerät.
function _prefs(){ try{ const uid=(window.cu&&window.cu.id)||''; return (CD.getUserPrefs&&CD.getUserPrefs(uid))||null; }catch(e){ return null; } }
function _savePrefs(patch){
  try{ const uid=(window.cu&&window.cu.id)||''; if(!uid||!CD.saveUserPrefs) return;
    CD.saveUserPrefs(uid, Object.assign({}, _prefs()||{}, patch)); }catch(e){ console.warn('userPrefs speichern:',e&&e.message); }
}
function _favList(){ const p=_prefs(); return (p && Array.isArray(p.favs)) ? p.favs : _arr(_fk()); }
function _hiddenCards(){ const p=_prefs(); return (p && Array.isArray(p.hiddenCards)) ? p.hiddenCards : []; }
// Einmalig: vorhandene lokale Favoriten (v417, pro Gerät) in die geräteübergreifende Liste übernehmen
function _migrateFavs(){
  try{ const p=_prefs(); const loc=_arr(_fk()); if(!loc.length || !CD.saveUserPrefs) return;
    const srv=(p&&Array.isArray(p.favs))?p.favs:[]; const keys=new Set(srv.map(x=>x.key));
    const add=loc.filter(x=>!keys.has(x.key)); if(!add.length && p && Array.isArray(p.favs)) return;
    _savePrefs({ favs:srv.concat(add) }); }catch(e){}
}
function homeFavHas(key){ return _favList().some(x=>x.key===key); }
function homeFavToggle(key){
  if(!key) return false;
  let a=_favList().slice(); const on=a.some(x=>x.key===key);
  if(on) a=a.filter(x=>x.key!==key); else { const inf=_info(key); a.push({ key, label:inf?inf.label:'' }); }
  _lsSet(_fk(), a); _savePrefs({ favs:a });
  try{ window.toast && window.toast(on?'Aus den Favoriten entfernt':'⭐ Zu den Favoriten hinzugefügt – erscheint auf der Startseite', on?'':'ok'); }catch(e){}
  if(window._activeModule==='start') _fillRecent();
  return !on;
}
function homeCurrentKey(s){ const it=_itemOf(s||(window.navSnapshot&&window.navSnapshot())); return it?it.key:''; }

// ── Profil: Karten der eigenen Startseite ausblenden (geräteübergreifend) ──
// Angeboten werden nur Karten, die die Rolle laut Verwaltung überhaupt hat.
function homeProfileHtml(){
  try{
    const cu=window.cu; if(!cu || !homeEnabled(cu)) return '';
    const hid=_hiddenCards();
    const ks=cardOrder().filter(k=>cardOn(k,cu) && !(k==='stamp' && !_stampAllowed(cu)) && !(k==='sys' && !_sysAllowed(cu)));
    if(!ks.length) return '';
    return `<hr style="margin:18px 0;border:none;border-top:1.5px solid var(--border)">
      <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:4px">🏠 Meine Startseite</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Welche Karten du sehen möchtest – gilt auf allen deinen Geräten, wird sofort gespeichert.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 12px">${ks.map(k=>{ const c=CARDS.find(x=>x.k===k);
        return `<label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;font-weight:400"><input type="checkbox" style="width:auto" ${hid.includes(k)?'':'checked'} onchange="homeHideCard('${k}',!this.checked)"> ${esc(c?c.l:k)}</label>`; }).join('')}</div>`;
  }catch(e){ return ''; }
}
function homeHideCard(k,hide){
  const s=new Set(_hiddenCards()); if(hide) s.add(k); else s.delete(k);
  _savePrefs({ hiddenCards:[...s] });
  try{ window.toast && window.toast(hide?'Karte ausgeblendet':'Karte wird wieder angezeigt','ok'); }catch(e){}
  if(window._activeModule==='start') renderHome();
}
function homeOpenItem(key){
  const [k,a,b]=String(key).split('|');
  const vis=m=>{ const x=document.querySelector('.mb-mod[data-mod="'+m+'"]'); return !!(x && x.style.display!=='none'); };
  try{
    if(k==='e'){ window._crmSearch=''; window._crmMode='kontakte'; window._crmTree=a; window._crmSelId=b; window._crmDetailTab='allgemeines'; window._crmProjSel=''; window.switchModule('crm'); }
    else if(k==='va'){ window._crmMode='veranstaltungen'; window._crmVaSel=a; window.switchModule('crm'); }
    else if(k==='tp'){ window._crmMode='teams'; window._crmTeamProjSel=a; window.switchModule(vis('kanban')?'kanban':'crm'); }
  }catch(e){}
}
// ⭐ Favoriten und 🕘 Zuletzt geöffnet sind getrennte Karten (v425, User: „Zuletzt" eher nervig →
// eigene Karte, Standard aus, per Rolle/Profil schaltbar). Leere Karten bleiben unsichtbar.
const _chip=(x,fav)=>{ const inf=_info(x.key); if(!inf) return '';
  return `<span class="home-chip"><span class="lbl" onclick="homeOpenItem(${jsq(x.key)})" title="Öffnen">${inf.icon} ${esc(inf.label)}</span><button class="star${fav?' on':''}" onclick="homeFavToggle(${jsq(x.key)})" title="${fav?'Aus den Favoriten entfernen':'Als Favorit merken'}" aria-label="Favorit">${fav?'★':'☆'}</button></span>`; };
async function _fillRecent(){
  try{ if(CD.ensureCrmReady) await CD.ensureCrmReady(); }catch(e){}
  _migrateFavs();
  const favs=_favList(); const fKeys=new Set(favs.map(x=>x.key));
  const fb=_el('home-favs');
  if(fb){ const h=favs.map(x=>_chip(x,true)).filter(Boolean).join('');
    fb.style.display=h?'':'none'; fb.innerHTML=`<p class="home-h">⭐ Favoriten</p>`+(h?`<div class="home-chips">${h}</div>`:'<div class="home-empty">Noch keine – ☆ hinter einem Namen im CRM antippen.</div>'); }
  const rb=_el('home-recent');
  if(rb){ const h=_arr(_rk()).filter(x=>!fKeys.has(x.key)).map(x=>_chip(x,false)).filter(Boolean).slice(0,8).join('');
    rb.style.display=h?'':'none'; rb.innerHTML=`<p class="home-h">🕘 Zuletzt geöffnet</p>`+(h?`<div class="home-chips">${h}</div>`:'<div class="home-empty">Noch nichts geöffnet.</div>'); }
}

// ── Team (Leitung / Geschäftsführung) ─────────────────────────────
function _fillTeam(){
  const box=_el('home-team'); if(!box) return;
  try{
    const cu=window.cu, d=D.getData(); const today=isoDay(new Date());
    const vis=u=>u && u.id!==cu.id && (!R.canSeeEmployee || R.canSeeEmployee(cu,u));
    const reqs=Object.values(d.vacRequests||{});
    const pend=reqs.filter(r=>r.status==='pending' && vis(D.getUser(r.userId)));
    const n=new Date(); const months=[[n.getFullYear(),n.getMonth()+1]]; const pm=new Date(n.getFullYear(),n.getMonth()-1,1); months.push([pm.getFullYear(),pm.getMonth()+1]);
    let sub=0; (d.users||[]).filter(vis).forEach(u=>months.forEach(([y,m])=>{ const e=d.entries&&d.entries[D.entryKey(u.id,y,m)]; if(e&&e.status==='submitted') sub++; }));
    const away=reqs.filter(r=>r.status==='approved' && r.startDate<=today && (r.endDate||r.startDate)>=today && vis(D.getUser(r.userId)))
      .map(r=>{ const u=D.getUser(r.userId); return esc((u&&u.name)||'?')+' <span class="home-sub">('+esc(r.type||'abwesend')+')</span>'; });
    box.innerHTML=`<p class="home-h">👥 Team</p>
      <div class="home-row" onclick="homeZe('abwesenheiten')"><span>📝</span><span class="tx">Offene Urlaubs-/Abwesenheitsanträge</span><span class="home-pill ${pend.length?'amber':'green'}">${pend.length}</span></div>
      <div class="home-row" onclick="homeZe('uebersicht')"><span>📤</span><span class="tx">Eingereichte Monate zum Genehmigen</span><span class="home-pill ${sub?'amber':'green'}">${sub}</span></div>
      <div class="home-row" onclick="homeZe('abwesenheiten')" style="cursor:pointer"><span>🏖️</span><span class="tx">Heute abwesend: ${away.length?away.join(', '):'niemand'}</span></div>`;
  }catch(e){ box.innerHTML='<p class="home-h">👥 Team</p><div class="home-empty">Gerade nicht verfügbar.</div>'; }
}
function homeZe(view){ try{ window.switchModule&&window.switchModule('zeiterfassung'); window.switchView&&window.switchView(view); }catch(e){} }

// ── 🛠️ System (Admin / System-Verwaltung) ─────────────────────────
function _sysAllowed(cu){ try{ return cu.role==='admin' || !!(R.hasPermission && R.hasPermission('zugriff_verwaltung',cu)); }catch(e){ return false; } }
function _verClient(){ const t=(document.getElementById('hdr-version')||{}).textContent||''; return (t.match(/v\d+/)||[''])[0]; }
let _verServer=null, _verTs=0;
async function _checkServerVer(){
  if(_verServer && Date.now()-_verTs<10*60000) return _verServer;
  try{ const r=await fetch('service-worker.js?check='+Date.now(),{cache:'no-store'}); const t=await r.text();
    const m=t.match(/tps-ze-(v\d+)/); _verServer=m?m[1]:null; _verTs=Date.now(); }catch(e){ _verServer=null; }
  return _verServer;
}
async function _fillSys(){
  const box=_el('home-sys'); if(!box) return;
  const cu=window.cu||{}; const isAdm=cu.role==='admin';
  const d=(()=>{ try{ return D.getData(); }catch(e){ return {}; } })();
  const rows=[];
  // Passwort-Anfragen
  try{ const req=d.pwResetRequests||{}; const ids=Object.keys(req);
    const names=ids.map(id=>{ const u=D.getUser&&D.getUser(id); return (u&&u.name)||id; });
    rows.push(`<div class="home-row" onclick="homeVerw('users')"><span>🔑</span><span class="tx">Passwort-Anfragen${names.length?': '+esc(names.slice(0,3).join(', '))+(names.length>3?' …':''):''}</span><span class="home-pill ${ids.length?'red':'green'}">${ids.length||'keine'}</span></div>`);
  }catch(e){}
  // Letztes automatisches Tages-Backup (frisch vom Server, sonst aus dem Cache)
  let last=''; try{ last=(d._fixes&&d._fixes.lastAppBackup)||''; }catch(e){}
  try{ if(window.firebase && firebase.database){ const v=(await firebase.database().ref('zeiterfassung/_fixes/lastAppBackup').once('value')).val(); if(v) last=v; } }catch(e){}
  const today=isoDay(new Date()), yest=isoDay(new Date(Date.now()-864e5));
  const bState=!last?['amber','unbekannt']:(last===today?['green','heute ✓']:(last===yest?['green','gestern']:['red',fmtD(last)+String(last).slice(0,4)]));
  rows.push(`<div class="home-row" ${isAdm?'onclick="window.showAppBackups&&showAppBackups()"':''}><span>☁️</span><span class="tx">Letztes automatisches Backup${last&&last!==today?' <span class="home-sub">· läuft beim ersten Gerät des Tages</span>':''}</span><span class="home-pill ${bState[0]}">${esc(bState[1])}</span></div>`);
  // Verbindung
  const off=!!window._offlineMode, unv=!!window._cloudUnverified;
  rows.push(`<div class="home-row" style="cursor:default"><span>🌐</span><span class="tx">Verbindung zur Datenbank</span><span class="home-pill ${off?'red':(unv?'amber':'green')}">${off?'offline':(unv?'nicht bestätigt':'verbunden')}</span></div>`);
  // Mitarbeiter
  try{ const act=(d.users||[]).filter(u=>u && u.id!=='admin' && u.role!=='admin').length; const arc=(d.archivedUsers||[]).length;
    rows.push(`<div class="home-row" onclick="homeVerw('users')"><span>👥</span><span class="tx">Mitarbeiter aktiv${arc?` <span class="home-sub">· ${arc} archiviert</span>`:''}</span><span class="home-pill">${act}</span></div>`); }catch(e){}
  // Version (dieses Gerät vs. Server)
  let vc=_verClient();
  if(!vc){ try{ const ks=await caches.keys(); const k=ks.filter(x=>/^tps-ze-v\d+$/.test(x)).sort((a,b)=>parseInt(b.slice(8))-parseInt(a.slice(8)))[0]; if(k) vc=k.slice(7); }catch(e){} }
  rows.push(`<div class="home-row" id="home-sys-ver" style="cursor:default"><span>📦</span><span class="tx">App-Version ${esc(vc||'')}</span><span class="home-pill">prüfe …</span></div>`);
  box.innerHTML='<p class="home-h">🛠️ System</p>'+rows.join('');
  const vs=await _checkServerVer(); const el=_el('home-sys-ver'); if(!el) return;
  if(!vs||!vc){ el.querySelector('.home-pill').textContent='–'; return; }
  const n=s=>parseInt(String(s).slice(1),10)||0;
  if(n(vs)>n(vc)){ el.style.cursor='pointer'; el.setAttribute('onclick','location.reload()');
    el.querySelector('.tx').innerHTML=`App-Version ${esc(vc)} <span class="home-sub">· ${esc(vs)} ist online – tippen zum Neuladen</span>`;
    const p=el.querySelector('.home-pill'); p.className='home-pill amber'; p.textContent='Update'; }
  else { const p=el.querySelector('.home-pill'); p.className='home-pill green'; p.textContent='aktuell'; }
}
function homeVerw(tab){ try{ window.switchModule&&window.switchModule('verwaltung'); [150,900,2500].forEach(ms=>setTimeout(()=>{ try{ window.verwShowTab&&window.verwShowTab(tab); }catch(e){} },ms)); }catch(e){} }

// ── Kacheln: genau die Module, die im ☰-Menü sichtbar sind (= Rechte) ──
const TILE_IC={ zeiterfassung:'🕒', crm:'📇', kanban:'🗂️', verteiler:'✉️', kalender:'📅', shop:'🛒', verwaltung:'⚙️', auswertung:'📊', ki:'🧠', messe:'🎪', website:'🌐', forum:'💬' };
// Externe Links als Kacheln (für ALLE, öffnen in neuem Tab) – ersetzen die Platzhalter-Module Website/Forum.
// Forum erscheint, sobald eine Adresse eingetragen ist.
const LINKS=[
  { l:'Website', ic:'🌐', url:'https://www.turningpoint-stiftung.com/' },
  { l:'Forum', ic:'💬', url:'https://forum.turningpoint-stiftung.com/' },
];
let _tileObs=null;
function _fillTiles(){
  const box=_el('home-tiles'); if(!box) return;
  const bs=[...document.querySelectorAll('#mb-dropdown .mb-mod')].filter(b=>!['start','website','forum'].includes(b.dataset.mod) && b.style.display!=='none');
  const html=bs.map(b=>`<div class="home-tile" onclick="homeTile(${jsq(b.dataset.mod)})"><span class="ic">${TILE_IC[b.dataset.mod]||'📁'}</span>${esc(b.textContent.trim())}</div>`).join('')
    +LINKS.filter(x=>x.url).map(x=>`<a class="home-tile" href="${esc(x.url)}" target="_blank" rel="noopener" style="text-decoration:none"><span class="ic">${x.ic}</span>${esc(x.l)} <span style="font-size:11px;color:var(--muted)">↗</span></a>`).join('');
  if(box.innerHTML!==html) box.innerHTML=html;
  // Das ☰-Menü bekommt seine Rechte erst NACH dem Laden der CRM-Daten (crmSetupModuleBar, asynchron) –
  // beim App-Start ist die Startseite schneller. Darum Kacheln nachziehen, sobald sich das Menü ändert.
  if(!_tileObs){ const dd=document.getElementById('mb-dropdown');
    if(dd){ _tileObs=new MutationObserver(()=>{ if(window._activeModule==='start') _fillTiles(); });
      _tileObs.observe(dd,{ subtree:true, attributes:true, attributeFilter:['style'] }); } }
}
function homeTile(mod){ const b=document.querySelector('#mb-dropdown .mb-mod[data-mod="'+mod+'"]'); if(b) b.click(); }

// ── Wetter & Wind (Open-Meteo, ohne Schlüssel; Wohnort aus dem Profil) ──
// Datenschutz: an Open-Meteo geht nur der Ortsname (für die Koordinaten) bzw. die Koordinaten.
const WX={0:['☀️','klar'],1:['🌤️','überwiegend klar'],2:['⛅','teils bewölkt'],3:['☁️','bewölkt'],45:['🌫️','Nebel'],48:['🌫️','Nebel'],
  51:['🌦️','Nieselregen'],53:['🌦️','Nieselregen'],55:['🌦️','Nieselregen'],56:['🌧️','gefrierender Niesel'],57:['🌧️','gefrierender Niesel'],
  61:['🌧️','leichter Regen'],63:['🌧️','Regen'],65:['🌧️','starker Regen'],66:['🌧️','gefrierender Regen'],67:['🌧️','gefrierender Regen'],
  71:['🌨️','leichter Schnee'],73:['🌨️','Schnee'],75:['🌨️','starker Schnee'],77:['🌨️','Schneegriesel'],80:['🌦️','Schauer'],81:['🌦️','Schauer'],82:['⛈️','heftige Schauer'],
  85:['🌨️','Schneeschauer'],86:['🌨️','Schneeschauer'],95:['⛈️','Gewitter'],96:['⛈️','Gewitter mit Hagel'],99:['⛈️','Gewitter mit Hagel']};
const wx=c=>WX[c]||['🌡️',''];
const DIRS=['N','NO','O','SO','S','SW','W','NW'];
const dirName=deg=>DIRS[Math.round(((deg%360)+360)%360/45)%8];
function bft(kn){ const t=[1,4,7,11,17,22,28,34,41,48,56,64]; let b=0; while(b<t.length && kn>=t[b]) b++; return b; }
function _lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
function _lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
async function _coords(city, land){
  const key='tps_home_geo_'+city.toLowerCase()+'|'+(land||'').toLowerCase();
  const c=_lsGet(key); if(c && c.lat) return c;
  const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=10&language=de&countryCode=DE&name='+encodeURIComponent(city));
  const j=await r.json(); const res=(j&&j.results)||[]; if(!res.length) return null;
  const hit=(land && res.find(x=>String(x.admin1||'').toLowerCase()===String(land).toLowerCase())) || res[0];
  const o={ lat:hit.latitude, lon:hit.longitude, name:hit.name }; _lsSet(key,o); return o;
}
async function _fillWeather(){
  const box=_el('home-wx'); if(!box) return;
  const head='<p class="home-h">🌤️ Wetter &amp; Wind</p>';
  const cu=window.cu||{}; const u=(D.getUser&&D.getUser(cu.id))||cu;
  const city=String(u.city||'').trim();
  if(!city){ box.innerHTML=head+`<div class="home-empty">Trag im <a href="#" onclick="openProfileModal();return false">Profil</a> deinen Wohnort ein, dann siehst du hier Wetter und Wind.</div>`; return; }
  try{
    const geo=await _coords(city, u.bundesland||''); if(!geo){ box.innerHTML=head+`<div class="home-empty">Ort „${esc(city)}" nicht gefunden – bitte im Profil prüfen.</div>`; return; }
    const ck='tps_home_wx_'+geo.lat.toFixed(2)+'_'+geo.lon.toFixed(2);
    let w=_lsGet(ck);
    if(!w || Date.now()-w.ts>30*60000){
      const url='https://api.open-meteo.com/v1/forecast?latitude='+geo.lat+'&longitude='+geo.lon
        +'&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
        +'&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
        +'&wind_speed_unit=kn&timezone=Europe%2FBerlin&forecast_days=3';
      const r=await fetch(url); const j=await r.json(); if(!j||!j.current) throw new Error('keine Daten');
      w={ ts:Date.now(), c:j.current, d:j.daily }; _lsSet(ck,w);
    }
    const c=w.c, kn=Math.round(c.wind_speed_10m), g=Math.round(c.wind_gusts_10m), dir=c.wind_direction_10m;
    const days=(w.d&&w.d.time||[]).slice(1,3).map((t,i)=>{ const k=i+1;
      const dn=new Date(t+'T12:00').toLocaleDateString('de-DE',{weekday:'short'});
      return `<div class="home-day"><b>${esc(dn)}</b> ${wx(w.d.weather_code[k])[0]}<br>${Math.round(w.d.temperature_2m_min[k])}–${Math.round(w.d.temperature_2m_max[k])}°<br>💨 ${Math.round(w.d.wind_speed_10m_max[k])} kn ${dirName(w.d.wind_direction_10m_dominant[k])}</div>`; }).join('');
    box.innerHTML=head+`<div class="home-wx">
        <span class="ic">${wx(c.weather_code)[0]}</span>
        <div><div class="t">${Math.round(c.temperature_2m)}°</div><div class="home-sub">${esc(wx(c.weather_code)[1])} · ${esc(geo.name||city)}</div></div>
        <div style="margin-left:auto"><div class="home-wind"><span class="home-arrow" style="transform:rotate(${(dir+180)%360}deg)" title="Wind aus ${dirName(dir)}">↑</span>${kn} kn aus ${dirName(dir)}</div>
          <div class="home-sub">${bft(kn)} Bft · Böen ${g} kn</div></div></div>
      ${days?`<div class="home-days">${days}</div>`:''}`;
  }catch(e){ box.innerHTML=head+'<div class="home-empty">Wetter gerade nicht verfügbar (offline?).</div>'; }
}

// ── Menüpunkt „🏠 Start" zeigen, sobald angemeldet und freigeschaltet ──
(function wait(){
  try{ const b=document.querySelector('.mb-mod[data-mod="start"]'); const mb=document.getElementById('module-bar');
    if(window.cu && b && mb && mb.style.display!=='none'){ b.style.display=homeEnabled()?'':'none';
      const lg=document.getElementById('mb-logo'); if(lg) lg.style.cursor=homeEnabled()?'pointer':''; return; } }catch(e){}
  setTimeout(wait, 500);
})();

try{ Object.assign(window,{ renderHome, homeArrange, homeArrangeReset, homeProfileHtml, homeHideCard, renderHomeCardsConfig, homeCfgSet, homeCfgMove, homeCfgReset, homeEnabled, homeGo, homeOpenVa, homeZe, homeVerw, homeTile, homeTrack, homeFavHas, homeFavToggle, homeCurrentKey, homeOpenItem }); }catch(e){}
