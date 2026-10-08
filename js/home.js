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

// ── Styles ─────────────────────────────────────────────────────────
let _css=false;
function _styles(){
  if(_css) return; _css=true;
  const st=document.createElement('style'); st.textContent=`
  #home-root{flex:1;display:flex;min-width:0;max-width:100%}
  .home-wrap{position:relative;flex:1;min-width:0;padding:22px 24px 40px;overflow:hidden;min-height:calc(100vh - 70px)}
  .home-bgl{position:absolute;right:-60px;bottom:-10px;width:min(980px,92%);opacity:.075;pointer-events:none;user-select:none;z-index:0}
  .home-in{position:relative;z-index:1;max-width:1180px;margin:0 auto}
  .home-hi{font-size:24px;font-weight:700;color:var(--primary,#203869);margin:0}
  .home-date{font-size:14px;color:var(--muted);margin:2px 0 18px}
  .home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
  .home-card{background:var(--white,#fff);border:1px solid var(--border);border-radius:14px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .home-card.wide{grid-column:1/-1}
  .home-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin:0 0 10px;display:flex;align-items:center;gap:6px}
  .home-row{display:flex;align-items:center;gap:8px;font-size:14px;padding:7px 0;border-top:1px solid var(--border);cursor:pointer}
  .home-row:first-of-type{border-top:none}.home-row:hover{color:var(--primary,#203869)}
  .home-row .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .home-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;background:#e8eef8;color:#203869}
  .home-pill.red{background:#fde8e8;color:#b42318}.home-pill.amber{background:#fef3c7;color:#92400e}.home-pill.green{background:#e7f6e9;color:#1b5e20}
  .home-empty{font-size:13px;color:var(--muted);padding:4px 0}
  .home-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:10px;margin-top:14px}
  .home-tile{background:var(--white,#fff);border:1px solid var(--border);border-radius:14px;padding:14px 6px;text-align:center;cursor:pointer;font-size:13px;font-weight:600;color:var(--text);overflow-wrap:anywhere;hyphens:auto}
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
  body.mod-start #ze-notice-bar{display:none}
  @media(max-width:640px){ .home-wrap{padding:14px 12px 30px} .home-bgl{width:120%;right:-30%;bottom:0} .home-grid{grid-template-columns:minmax(0,1fr)} .home-tiles{grid-template-columns:repeat(2,minmax(0,1fr))} .home-hi{font-size:20px} }`;
  document.head.appendChild(st);
}

// ── Seite ──────────────────────────────────────────────────────────
let _tick=null;
export function renderHome(){
  try{
    _styles();
    const root=document.getElementById('home-root'); if(!root) return;
    const cu=window.cu; if(!cu){ root.innerHTML=''; return; }
    const h=new Date().getHours();
    const gruss=h<11?'Guten Morgen':(h<17?'Hallo':'Guten Abend');
    const first=String(cu.name||'').trim().split(/\s+/)[0]||'';
    const datum=new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const leitung=(cu.role==='leitung'||cu.role==='geschaeftsfuehrer');
    root.innerHTML=`<div class="home-wrap">
      <img class="home-bgl" src="icons/tps-logo-segel.svg" alt="" aria-hidden="true">
      <div class="home-in">
        <p class="home-hi">${esc(gruss)}${first?', '+esc(first):''}</p>
        <p class="home-date">${esc(datum)}</p>
        <div class="home-grid">
          <div class="home-card" id="home-wx"><p class="home-h">🌤️ Wetter &amp; Wind</p><div class="home-empty">Lädt …</div></div>
          ${_stampAllowed(cu)?'<div class="home-card" id="home-stamp"></div>':''}
          <div class="home-card" id="home-todo"><p class="home-h">📌 Was ansteht</p><div class="home-empty">Lädt …</div></div>
          <div class="home-card" id="home-notes"><p class="home-h">🔔 Mitteilungen</p><div class="home-notes"></div></div>
          ${leitung?'<div class="home-card" id="home-team"><p class="home-h">👥 Team</p></div>':''}
        </div>
        <div class="home-tiles" id="home-tiles"></div>
      </div></div>`;
    _fillStamp(); _fillNotes(); _fillTiles(); if(leitung) _fillTeam();
    _fillTodo(); _fillWeather();
    clearInterval(_tick);
    _tick=setInterval(()=>{ if(window._activeModule!=='start'){ clearInterval(_tick); _tick=null; return; } _fillStamp(); _fillNotes(); }, 5000);
  }catch(e){ console.error('renderHome:',e); }
}
const _el=id=>document.getElementById(id);

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
  const html=items.length?items.map(n=>n.outerHTML).join(''):'<div class="home-empty">Keine neuen Mitteilungen. ✓</div>';
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

// ── Kacheln: genau die Module, die im ☰-Menü sichtbar sind (= Rechte) ──
const TILE_IC={ zeiterfassung:'🕒', crm:'📇', kanban:'🗂️', verteiler:'✉️', kalender:'📅', shop:'🛒', verwaltung:'⚙️', auswertung:'📊', ki:'🧠', messe:'🎪', website:'🌐', forum:'💬' };
function _fillTiles(){
  const box=_el('home-tiles'); if(!box) return;
  const bs=[...document.querySelectorAll('#mb-dropdown .mb-mod')].filter(b=>b.dataset.mod!=='start' && b.style.display!=='none');
  box.innerHTML=bs.map(b=>`<div class="home-tile" onclick="homeTile(${jsq(b.dataset.mod)})"><span class="ic">${TILE_IC[b.dataset.mod]||'📁'}</span>${esc(b.textContent.trim())}</div>`).join('');
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

try{ Object.assign(window,{ renderHome, homeEnabled, homeGo, homeOpenVa, homeZe, homeTile }); }catch(e){}
