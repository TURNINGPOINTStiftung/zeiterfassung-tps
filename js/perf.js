// ── Ladezeit-Messung + Verbindungstest (v526, Prio 2 „PWA Stabilität & Tempo“, Schritt 1) ──
// Misst bei jedem Start, wie lange die einzelnen Phasen dauern, OHNE etwas am Ablauf zu ändern:
//   0) Programm laden   – Seitenaufruf bis alle Programmteile geladen sind
//   a) Anmeldung        – Login-Klick bis Firebase-Anmeldung fertig (bzw. Wiederaufruf: bis Sitzung erkannt)
//   b) bis Ansicht      – Anmeldung fertig bis Startseite / erste Ansicht sichtbar (inkl. Datenladen, falls blockierend)
//   c) Kacheln          – Ansicht sichtbar bis alle Startseiten-Kacheln fertig (Was ansteht, Wetter, Zuletzt …)
// Dazu: Größe und Ladedauer der Datenblöcke (Zeiterfassung, CRM), Verbindungsart (WebSocket/Long-Polling),
// Anzahl/Rechenzeit der Live-Aktualisierungen. Gespeichert werden die letzten 10 Starts NUR auf diesem Gerät
// (keine Namen, keine Inhalte). Anzeige: Profil → „Ladezeit & Verbindung“.
// Andere Module rufen nur window.tpsPerf?.mark(…) – fehlt diese Datei (alter Gerätecache), passiert nichts.
import { openModal, esc } from './utils.js';
import { PW_FUNCTION_URL } from './config.js';

const LS='tps_perf_v1';
const _now=()=>Math.round(performance.now());
const run={ id:Date.now(), at:new Date().toISOString(), art:'', m:{}, i:{ zeSnaps:0, zeSnapMs:0, crmSnaps:0, crmSnapMs:0 } };

let _st=null;
function _save(){
  clearTimeout(_st);
  _st=setTimeout(()=>{ try{
    const all=(JSON.parse(localStorage.getItem(LS)||'[]')||[]).filter(r=>r&&r.id!==run.id);
    if(!run.art) return;   // nur echte Starts (Anmeldung / Wiederaufruf) speichern, nicht das bloße Öffnen der Login-Maske
    all.unshift(run); localStorage.setItem(LS, JSON.stringify(all.slice(0,10)));
  }catch(e){} }, 400);
}
// Zeitpunkt merken (nur der ERSTE zählt). info: Zusatzwerte (z. B. Größe in KB).
function mark(name, info){
  if(run.m[name]==null){ run.m[name]=_now(); if(name==='ansicht') setTimeout(_env, 8000); }
  if(info) Object.assign(run.i, info);
  _save();
}
function info(o){ Object.assign(run.i, o||{}); _save(); }
function art(a){ if(!run.art) run.art=a; _save(); }
// Dauer einer Live-Aktualisierung aufsummieren (kind = 'ze' | 'crm').
function snap(kind, ms){ run.i[kind+'Snaps']++; run.i[kind+'SnapMs']+=Math.round(ms); _save(); }
// Größe eines Datenblocks in KB (grob: JSON-Länge). Kostet bei großen Daten etwas Rechenzeit – die wird mitgemessen.
function kb(v){ const t=performance.now(); let n=0; try{ n=JSON.stringify(v||null).length; }catch(e){} return { kb:Math.round(n/1024), ms:Math.round(performance.now()-t) }; }

// Verbindungsart der Live-Datenbank: Long-Polling erzeugt sichtbare Netzanfragen „.lp?“, WebSocket nicht.
function _transport(){
  if(window._fbConnected===false) return 'nicht verbunden';
  try{ const lp=performance.getEntriesByType('resource').some(e=>/firebase(io|database)\.(com|app)\/\.lp\?/.test(e.name)||/\/\.lp\?/.test(e.name));
    return lp?'Long-Polling (Ausweichweg)':'WebSocket'; }catch(e){ return '?'; }
}
// Geladene Programmdateien: Anzahl, übertragene Menge, wie viel aus dem Zwischenspeicher kam.
function _resources(){
  try{
    const r=performance.getEntriesByType('resource').filter(e=>/\.(js|css)(\?|$)/.test(e.name));
    let tr=0, dec=0, cache=0;
    r.forEach(e=>{ tr+=e.transferSize||0; dec+=e.decodedBodySize||0; if(!e.transferSize) cache++; });
    const nav=performance.getEntriesByType('navigation')[0];
    return { dateien:r.length, uebertragenKB:Math.round(tr/1024), groesseKB:Math.round(dec/1024), ausCache:cache,
      htmlMs: nav?Math.round(nav.responseEnd):null, domMs: nav?Math.round(nav.domContentLoadedEventEnd):null };
  }catch(e){ return {}; }
}
// Kacheln fertig → Abschlusswerte festhalten.
function _env(){
  info({ transport:_transport(), res:_resources(),
    netz:(navigator.connection&&navigator.connection.effectiveType)||'', handy:/Mobi|Android|iPhone/i.test(navigator.userAgent) });
}
function done(){ mark('kacheln'); _env(); }

// ── Auswertung je Start ──────────────────────────────────────────────
// Woher kamen die Daten? (v527) – Gerätespeicher und/oder Server, und ob der Server überhaupt erreicht wurde.
function _quelle(r){
  const m=r.m||{}, i=r.i||{}, d=(a,b)=>(m[a]!=null&&m[b]!=null)?m[b]-m[a]:null;
  const ze=(i.schnellstart?'Gerätespeicher → ':'')+(m.zeFertig!=null?'Server nach '+_f(d('zeStart','zeFertig')):(i.zeTimeout?'Server NICHT erreicht':'Server ausstehend'));
  const crm=m.crmStart==null?'nicht geladen':((i.crmLokal?'Gerätespeicher → ':'')+(m.crmFertig!=null?'Server nach '+_f(d('crmStart','crmFertig')):'Server NICHT erreicht'));
  const kach=m.kacheln==null?'–':(i.kachelnAusCache?'Gerätespeicher':'Server');
  const db=m.verbunden!=null?'verbunden nach '+_f(m.verbunden):(m.offline!=null?'NICHT verbunden (offline nach 3 s)':'keine Verbindung');
  return { ze, crm, kach, db };
}
function _phases(r){
  const m=r.m||{}, d=(a,b)=>(m[a]!=null&&m[b]!=null&&m[b]>=m[a])?m[b]-m[a]:null;
  const login=r.art==='Anmeldung';
  const view=m.startseite!=null?'startseite':'ansicht';
  return {
    p0: m.js!=null?m.js:null,
    a: login?d('loginKlick','angemeldet'):d('js','authBereit'),
    b: login?d('angemeldet',view):d('authBereit',view),
    c: d(view,'kacheln'),
    ges: login?d('loginKlick',m.kacheln!=null?'kacheln':view):(m.kacheln!=null?m.kacheln:m[view]!=null?m[view]:null),
    dir: d('authBereit','loginDir'),
    ze: d('zeStart','zeFertig'), crm: d('crmStart','crmFertig'),
  };
}
const _f=v=>v==null?'–':(v>=1000?(v/1000).toFixed(1).replace('.',',')+' s':v+' ms');
function _runs(){ try{ return JSON.parse(localStorage.getItem(LS)||'[]')||[]; }catch(e){ return []; } }

// ── Verbindungstest: jede Adresse, die die App braucht (nur lesend, ohne Anmeldedaten) ──
const DB_HOST='zeiterfassung-tps-default-rtdb.europe-west1.firebasedatabase.app';
const TESTS=[
  ['Programmbibliothek (gstatic)', 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js'],
  ['Anmeldedienst',               'https://identitytoolkit.googleapis.com/'],
  ['Anmelde-Token',               'https://securetoken.googleapis.com/'],
  ['Datenbank (HTTPS)',           'https://'+DB_HOST+'/.json?shallow=true'],
  ['Datenbank (WebSocket)',       'ws'],
  ['Dateispeicher (Backups)',     'https://firebasestorage.googleapis.com/'],
  ['Server-Funktion (1. Aufruf)', PW_FUNCTION_URL+'/ping'],
  ['Server-Funktion (2. Aufruf)', PW_FUNCTION_URL+'/ping'],
  ['Wetterdienst',                'https://api.open-meteo.com/v1/forecast?latitude=53.55&longitude=9.99&current=temperature_2m'],
];
// v527: unterscheidet Zeitüberschreitung, Gerät offline, Adresse nicht auffindbar, Verbindung abgewiesen/gesperrt
// und Fehlerantwort des Servers. Der Browser verrät bei einem Netzwerkfehler nicht, WARUM er scheiterte – deshalb
// fragt der Test zusätzlich einen öffentlichen Namensdienst (Cloudflare), ob die Adresse grundsätzlich existiert.
function _fetchT(url, opt, ms){
  const ac=('AbortController' in window)?new AbortController():null;
  const to=setTimeout(()=>{ try{ ac&&ac.abort(); }catch(e){} }, ms);
  return fetch(url, Object.assign({ cache:'no-store', credentials:'omit', signal:ac?ac.signal:undefined }, opt||{})).finally(()=>clearTimeout(to));
}
const _dnsCache={};
function _dns(host){
  if(_dnsCache[host]) return _dnsCache[host];
  return _dnsCache[host]=_fetchT('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type=A', { headers:{accept:'application/dns-json'} }, 5000)
    .then(r=>r.json()).then(j=>(j && j.Status===0 && (j.Answer||[]).length)?'ok':'nx').catch(()=>'?');
}
async function _why(host, t0, timedOut){
  const ms=Math.round(performance.now()-t0);
  if(timedOut) return { ok:false, kind:'timeout', ms, why:'Zeitüberschreitung (keine Antwort in 10 s)' };
  if(navigator.onLine===false) return { ok:false, kind:'offline', ms, why:'Gerät meldet: kein Netz' };
  const d=await _dns(host);
  if(d==='nx') return { ok:false, kind:'dns', ms, why:'Adresse nicht auffindbar (Namensauflösung)' };
  if(d==='ok') return { ok:false, kind:'blocked', ms, why:'Verbindung abgewiesen – Adresse existiert, Netz/VPN/Filter sperrt vermutlich' };
  return { ok:false, kind:'net', ms, why:'Netzwerkfehler (Ursache nicht feststellbar)' };
}
async function _probe(url, ms){
  const t=performance.now();
  if(url==='ws') return new Promise(res=>{
    let ws, fin=false;
    const end=(ok,timedOut)=>{ if(fin) return; fin=true; try{ ws&&ws.close(); }catch(e){}
      if(ok) res({ ok:true, kind:'ok', ms:Math.round(performance.now()-t) }); else _why(DB_HOST, t, timedOut).then(res); };
    try{ ws=new WebSocket('wss://'+DB_HOST+'/.ws?v=5&ns=zeiterfassung-tps-default-rtdb'); ws.onopen=()=>end(true); ws.onerror=()=>end(false,false); }catch(e){ end(false,false); }
    setTimeout(()=>end(false,true), ms);
  });
  const host=new URL(url).host;
  // 1) mit Antwort-Details (geht bei Diensten, die das erlauben) → Statuscode lesbar
  try{
    const r=await _fetchT(url, { mode:'cors' }, ms);
    const m=Math.round(performance.now()-t);
    if(r.status>=500) return { ok:false, kind:'srv', ms:m, why:'Server antwortet mit Fehler '+r.status };
    return { ok:true, kind:'ok', ms:m, note:r.status>=400?'Antwort '+r.status+' – Dienst erreichbar':'' };
  }catch(e){
    if(e && e.name==='AbortError') return _why(host, t, true);
  }
  // 2) ohne Antwort-Details (Dienst erlaubt keine Details) → nur „erreichbar ja/nein“
  try{ await _fetchT(url, { mode:'no-cors' }, Math.max(1000, ms-(performance.now()-t))); return { ok:true, kind:'ok', ms:Math.round(performance.now()-t) }; }
  catch(e){ return _why(host, t, !!(e && e.name==='AbortError')); }
}
let _lastTest=null;
async function runTest(){
  const box=document.getElementById('perf-test'); if(!box) return;
  box.innerHTML='<div class="small">Teste … (bis zu 10 s je Adresse)</div>';
  const out=[];
  for(const [name,url] of TESTS){ out.push([name, await _probe(url, 10000)]); }
  _lastTest={ at:new Date().toISOString(), online:navigator.onLine, transport:_transport(), out };
  box.innerHTML=_testHtml(_lastTest);
}
function _testHtml(t){
  return `<table class="perf-t"><tbody>${t.out.map(([n,r])=>`<tr><td>${esc(n)}</td><td style="color:${r.ok?'var(--success)':'var(--danger)'};font-weight:700">${r.ok?'✓ erreichbar'+(r.note?' <span class="small" style="color:var(--muted);font-weight:400">'+esc(r.note)+'</span>':''):'✗ '+esc(r.why||'Fehler')}</td><td class="num">${_f(r.ms)}</td></tr>`).join('')}</tbody></table>
    <div class="small" style="margin-top:6px">Live-Verbindung dieser Sitzung: <b>${esc(t.transport)}</b></div>`;
}

// ── Bericht als Text (zum Kopieren und Weitergeben) ──────────────────
function report(){
  const L=[];
  L.push('TPS Ladezeit-Bericht – '+new Date().toLocaleString('de-DE')+' – '+((document.getElementById('hdr-version')||{}).textContent||''));
  L.push('Gerät: '+(/Mobi|Android|iPhone/i.test(navigator.userAgent)?'Handy/Tablet':'PC')+' · '+(navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/)||[''])[0]+' · Netz: '+((navigator.connection&&navigator.connection.effectiveType)||'?'));
  L.push(''); L.push('Art | Zeit | 0 Programm | a Anmeldung | b bis Ansicht | c Kacheln | Gesamt | ZE-Daten | CRM-Daten | Verbindung | Live-Updates ZE/CRM');
  _runs().forEach(r=>{ const p=_phases(r), i=r.i||{};
    L.push([r.art||'?', new Date(r.at).toLocaleString('de-DE'), _f(p.p0), _f(p.a), _f(p.b), _f(p.c), _f(p.ges),
      _f(p.ze)+' / '+(i.zeKB??'?')+' KB'+(i.zeJsonMs!=null?' (+'+i.zeJsonMs+' ms Rechnen)':''), _f(p.crm)+' / '+(i.crmKB??'?')+' KB',
      i.transport||'?', (i.zeSnaps||0)+'× '+(i.zeSnapMs||0)+' ms / '+(i.crmSnaps||0)+'× '+(i.crmSnapMs||0)+' ms'].join(' | '));
    { const q=_quelle(r); L.push('   Datenquelle: ZE '+q.ze+' · CRM '+q.crm+' · Kacheln aus '+q.kach+' · Datenbank '+q.db); }
    if(i.res) L.push('   Programmdateien: '+i.res.dateien+' Stück, '+i.res.groesseKB+' KB, davon übertragen '+i.res.uebertragenKB+' KB, '+i.res.ausCache+' aus Zwischenspeicher; HTML '+_f(i.res.htmlMs)+', Seite bereit '+_f(i.res.domMs)+(i.schnellstart?' · Schnellstart aus Gerätespeicher':'')+(p.dir!=null?' · Namensliste geladen nach: '+_f(p.dir):''));
  });
  if(_lastTest){ L.push(''); L.push('Verbindungstest ('+new Date(_lastTest.at).toLocaleTimeString('de-DE')+', Live-Verbindung: '+_lastTest.transport+')');
    L.push('  Gerät meldet Netz: '+(_lastTest.online?'ja':'NEIN'));
    _lastTest.out.forEach(([n,r])=>L.push('  '+n+': '+(r.ok?'OK'+(r.note?' ('+r.note+')':''):'FEHLER – '+(r.why||''))+' '+_f(r.ms))); }
  return L.join('\n');
}
function copyReport(){
  const t=report();
  const ok=()=>window.toast&&window.toast('Bericht kopiert – bitte an Moritz/Claude weitergeben.','ok');
  try{ navigator.clipboard.writeText(t).then(ok, ()=>{ prompt('Bericht kopieren:', t); }); }catch(e){ prompt('Bericht kopieren:', t); }
}
function clearRuns(){ try{ localStorage.removeItem(LS); }catch(e){} open(); }

// ── Anzeige (Profil → „Ladezeit & Verbindung“) ───────────────────────
function open(){
  const rs=_runs();
  const rows=rs.map(r=>{ const p=_phases(r), i=r.i||{};
    return `<tr><td>${esc(r.art||'?')}${i.schnellstart?' <span class="small">(Gerätespeicher)</span>':''}<div class="small">${esc(new Date(r.at).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}</div></td>
      <td class="num">${_f(p.p0)}</td><td class="num">${_f(p.a)}</td><td class="num">${_f(p.b)}</td><td class="num">${_f(p.c)}</td><td class="num"><b>${_f(p.ges)}</b></td>
      <td class="num">${_f(p.ze)}<div class="small">${i.zeKB??'?'} KB</div></td><td class="num">${_f(p.crm)}<div class="small">${i.crmKB??'?'} KB</div></td></tr>
      ${(()=>{ const q=_quelle(r); return `<tr><td colspan="8" class="small" style="color:var(--muted)">Daten: ZE ${esc(q.ze)} · CRM ${esc(q.crm)} · Kacheln aus ${esc(q.kach)} · Datenbank ${esc(q.db)}</td></tr>`; })()}`; }).join('');
  openModal(`<h3>⏱️ Ladezeit &amp; Verbindung</h3>
    <style>.perf-t{width:100%;border-collapse:collapse;font-size:13px}.perf-t td,.perf-t th{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.perf-t th{font-size:12px;color:var(--muted);font-weight:600}.perf-t .num{text-align:right;white-space:nowrap}.perf-wrap{overflow-x:auto}</style>
    <p class="small" style="margin:0 0 10px">Die letzten Starts auf <b>diesem Gerät</b>. 0 = Programm laden · a = Anmeldung · b = bis die erste Ansicht steht · c = bis alle Startseiten-Kacheln fertig sind. Rechts: wie lange das Laden der Daten dauerte und wie groß sie sind.</p>
    <div class="perf-wrap"><table class="perf-t"><thead><tr><th>Start</th><th class="num">0</th><th class="num">a</th><th class="num">b</th><th class="num">c</th><th class="num">Gesamt</th><th class="num">ZE-Daten</th><th class="num">CRM-Daten</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="8" class="small">Noch keine Messung – bitte einmal abmelden und neu anmelden bzw. die App neu laden.</td></tr>'}</tbody></table></div>
    <h4 style="margin:18px 0 6px">Verbindungstest</h4>
    <p class="small" style="margin:0 0 8px">Prüft jede Adresse, die die App braucht (z. B. im VPN). Es werden keine Daten gesendet.</p>
    <div id="perf-test">${_lastTest?_testHtml(_lastTest):''}</div>
    <div class="modal-btns" style="flex-wrap:wrap">
      <button class="btn btn-outline" onclick="tpsPerf.clear()">Messungen löschen</button>
      <button class="btn btn-outline" onclick="tpsPerf.test()">🔌 Verbindung testen</button>
      <button class="btn btn-ok" onclick="tpsPerf.copy()">📋 Bericht kopieren</button>
    </div>`);
}

window.tpsPerf={ mark, info, art, snap, kb, done, open, test:runTest, copy:copyReport, clear:clearRuns, report };
