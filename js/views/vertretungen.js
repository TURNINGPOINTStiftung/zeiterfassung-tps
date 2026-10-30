import { getData, mutate } from '../data.js';
import { esc, toast, localISODate, jsArg as jsq } from '../utils.js';
import { hasPermission } from '../roles.js';

// Team → Schlüssel für die Server-Freigabe grants/vt_team/<schlüssel>/<uid> (Umlaute/Sonderzeichen sind in
// Datenbank-Schlüsseln heikel). GLEICH in js/views/vertretungen.js und js/admin-setup.js.
const _vtTeamKey = t => String(t||'').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue').replace(/ß/g,'ss').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80) || '_';
// Wer darf was? GF/Admin: alle Teams, auch löschen. Recht „Vertretungen verwalten“ (sonst): nur eigene Teams,
// anlegen + beenden (Löschen nicht – die Liste würde sonst fremde Einträge verschieben; Regel v13).
function _vtAll(cu){ return !!(cu && (cu.role==='geschaeftsfuehrer'||cu.role==='admin')); }
function _vtMayUse(cu){ return _vtAll(cu) || !!(cu && hasPermission('vertretung_verwalten', cu)); }
function _vtOwnTeams(cu){ return (cu && Array.isArray(cu.teams) && cu.teams.length) ? cu.teams.filter(Boolean) : (cu && cu.team ? [cu.team] : []); }

// Vertretungsregelung (eigener Reiter, nur GF/Admin): Fällt eine Team-Leitung aus, bestimmt die
// Geschäftsführung/Admin hier befristet eine Vertretung – auch sich selbst. Die Vertretung sieht/
// prüft/leitet die Zeiten des Teams in der Mitarbeiterübersicht weiter, bis von/bis abläuft oder
// manuell beendet wird. Technisch angebunden über canSeeEmployee()/activeVertretungTeams() in
// roles.js. Datenmodell: d.vertretungen[]={id,team,deputyId,deputyName,von,bis,ended,byId,byName,ts}.


function _vtVal(id){ const el=document.getElementById(id); return el?el.value.trim():''; }
// Vollständige Team-Auswahl: konfigurierte Teams (d.teams) PLUS alle Teams, die tatsächlich
// bei Nutzern hinterlegt sind (u.teams[]/u.team). So sind auch Teams wählbar, die nie explizit
// in der Verwaltung angelegt, aber Mitarbeitern zugeordnet wurden (z.B. Wendewirkung, Förderung).
// Konfig-Reihenfolge bleibt vorn, fehlende Teams werden alphabetisch hinten ergänzt.
function _allTeams(d){
  const base=(d.teams||[]).slice();
  const extra=new Set();
  (d.users||[]).forEach(u=>{
    const ts=(Array.isArray(u.teams)&&u.teams.length)?u.teams:(u.team?[u.team]:[]);
    ts.forEach(t=>{ if(t&&!base.includes(t)) extra.add(t); });
  });
  return base.concat([...extra].sort((a,b)=>a.localeCompare(b,'de')));
}

export function renderVertretungen(){
  const content=document.getElementById('vertretungen-content');
  if(!content) return;
  const cu=window.cu;
  if(!_vtMayUse(cu)){
    content.innerHTML='<p style="color:var(--muted);padding:20px 0">Für Vertretungen fehlt das Recht „Vertretungen verwalten“.</p>';
    return;
  }
  const d=getData();
  const all=_vtAll(cu), own=_vtOwnTeams(cu);
  const teams=all ? _allTeams(d) : own;
  if(!teams.length){ content.innerHTML='<p style="color:var(--muted);padding:20px 0">Dir ist kein Team zugeordnet – Vertretungen legt dann die Geschäftsführung an.</p>'; return; }
  const deputies=(d.users||[]).filter(u=>u.role==='geschaeftsfuehrer'||u.role==='leitung'||u.role==='admin');
  const vs=(d.vertretungen||[]).filter(v=>v&&(all||own.includes(v.team)));
  // Neues Layout (v521, User 30.10.2026): links „Neue Vertretung“, rechts Aktiv / Geplant, Vergangene eingeklappt –
  // gleiche Bausteine wie die Abwesenheiten (ab-box, ab-card2).
  const c=s=>{ s=String(s||'').trim(); const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0'):s; };
  const todayC=c(localISODate());
  const state=v=>v.ended?'ended':(c(v.von)>todayC?'planned':((v.bis&&c(v.bis)<todayC)?'expired':'active'));
  const WD=['So','Mo','Di','Mi','Do','Fr','Sa'];
  const fmtW=ds=>{ if(!ds) return ''; const x=new Date(String(ds).slice(0,10)+'T12:00:00'); if(isNaN(x)) return esc(ds); return esc(WD[x.getDay()]+' '+String(x.getDate()).padStart(2,'0')+'.'+String(x.getMonth()+1).padStart(2,'0')+'.'+(x.getFullYear()!==new Date().getFullYear()?x.getFullYear():'')); };
  const days=(a,b)=>Math.round((new Date(String(b).slice(0,10)+'T12:00:00')-new Date(String(a).slice(0,10)+'T12:00:00'))/86400000);
  const today=localISODate();
  const STY={ active:['#1D9E75','ok','aktiv'], planned:['#378ADD','info','geplant'], expired:['#888780','','abgelaufen'], ended:['#888780','','beendet'] };
  const card=v=>{
    const st=state(v), [bar,cls,lbl]=STY[st];
    let hint='';
    if(st==='active') hint=v.bis?(()=>{ const n=days(today,v.bis)+1; return n<=1?'endet heute':`noch ${n} Tage`; })():'ohne Enddatum';
    if(st==='planned'){ const n=days(today,v.von); hint=n===1?'ab morgen':`in ${n} Tagen`; }
    const chip=cls?`<span class="ab-type" style="background:var(--${cls}-bg);color:var(--${cls}-text)">${lbl}</span>`:`<span class="ab-type" style="background:var(--bg);color:var(--muted)">${lbl}</span>`;
    const acts=[(st==='active'||st==='planned')?`<button class="btn btn-outline btn-sm ab-mini" onclick="endVertretung(${jsq(v.id)})">${st==='planned'?'Absagen':'Beenden'}</button>`:'',
      all?`<button class="btn btn-sm ab-mini ab-del" onclick="deleteVertretung(${jsq(v.id)})">🗑 Löschen</button>`:''].filter(Boolean).join('');
    return `<div class="ab-card2" style="border-left-color:${bar}">
      <div class="ab-c2-top"><strong>${esc(v.team)}</strong>${chip}${hint?`<span class="ab-c2-sub">${esc(hint)}</span>`:''}</div>
      <div class="ab-c2-date">🔄 vertreten durch <strong>${esc(v.deputyName||'')}</strong></div>
      <div class="ab-c2-sub">📅 ${fmtW(v.von)} – ${v.bis?fmtW(v.bis):'offen'}${v.byName?` · angelegt von ${esc(v.byName)}`:''}</div>
      ${acts?`<div class="ab-c2-acts">${acts}</div>`:''}
    </div>`;
  };
  const sortVon=(a,b)=>String(a.von||'').localeCompare(String(b.von||''));
  const aktiv=vs.filter(v=>state(v)==='active').sort(sortVon);
  const geplant=vs.filter(v=>state(v)==='planned').sort(sortVon);
  const vorbei=vs.filter(v=>state(v)==='ended'||state(v)==='expired').sort((a,b)=>-sortVon(a,b));
  const sec=(t,list,leer)=>`<section style="margin-bottom:18px"><h3 class="ab-h3">${t} <span class="ab-c2-sub">(${list.length})</span></h3>${list.length?list.map(card).join(''):`<div class="ab-c2-sub">${leer}</div>`}</section>`;

  const teamOpts=teams.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const depOpts=deputies.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}${u.role==='geschaeftsfuehrer'?' (GF)':(u.role==='admin'?' (Admin)':'')}</option>`).join('');

  content.innerHTML=`
    <div class="ab-c2-sub" style="margin:-4px 0 14px;max-width:900px;font-size:13px">Fällt eine Team-Leitung aus, übernimmt die Vertretung für den gewählten Zeitraum: Sie sieht, prüft und leitet die Zeiten des Teams in der Mitarbeiterübersicht weiter. Die eigentliche Leitung behält ihr Team.${all?'':' Du kannst Vertretungen für deine eigenen Teams anlegen und beenden.'}</div>
    <div class="vt-grid">
      <div class="ab-box vt-new">
        <div class="ab-box-h">＋ Neue Vertretung</div>
        <label class="vt-f">Team<select id="vt-team">${teamOpts}</select></label>
        <label class="vt-f">Vertreten durch<select id="vt-deputy">${depOpts}</select></label>
        <div class="vt-2">
          <label class="vt-f">ab<input type="date" id="vt-von" value="${today}"></label>
          <label class="vt-f">bis <span class="ab-c2-sub">(optional)</span><input type="date" id="vt-bis"></label>
        </div>
        <button class="btn btn-ok" style="width:100%;margin-top:6px" onclick="addVertretung()">Vertretung anlegen</button>
      </div>
      <div>
        ${sec('Aktiv',aktiv,'Gerade keine aktive Vertretung.')}
        ${sec('Geplant',geplant,'Keine geplanten Vertretungen.')}
        ${vorbei.length?`<details><summary class="ab-sum">🕓 Beendet und abgelaufen (${vorbei.length})</summary><div style="margin-top:8px">${vorbei.map(card).join('')}</div></details>`:''}
      </div>
    </div>`;
}

export function addVertretung(){
  const team=_vtVal('vt-team'), deputyId=_vtVal('vt-deputy'), von=_vtVal('vt-von'), bis=_vtVal('vt-bis');
  if(!team||!deputyId){ toast('Bitte Team und Vertreter:in wählen.','err'); return; }
  if(bis&&von&&bis<von){ toast('Das Bis-Datum liegt vor dem Ab-Datum.','err'); return; }
  const d=getData(); const dep=(d.users||[]).find(u=>u.id===deputyId); const cu=window.cu;
  if(!_vtMayUse(cu) || (!_vtAll(cu) && !_vtOwnTeams(cu).includes(team))){ toast('Vertretungen nur für das eigene Team.','err'); return; }
  mutate(dd=>{ if(!Array.isArray(dd.vertretungen)) dd.vertretungen=[];
    dd.vertretungen.push({ id:'vt_'+Date.now()+'_'+Math.floor(Math.random()*1e6), team, teamKey:_vtTeamKey(team), deputyId, deputyName:(dep&&dep.name)||'', von:von||localISODate(), bis:bis||'', ended:false, byId:cu&&cu.id, byName:cu&&cu.name, ts:Date.now() }); });
  toast('Vertretung angelegt ✓','ok'); renderVertretungen();
}
export function endVertretung(id){
  const cu=window.cu; const x=(getData().vertretungen||[]).find(v=>v.id===id);
  if(!x || !_vtMayUse(cu) || (!_vtAll(cu) && !_vtOwnTeams(cu).includes(x.team))){ toast('Vertretungen nur für das eigene Team.','err'); return; }
  mutate(d=>{ const v=(d.vertretungen||[]).find(x=>x.id===id); if(v){ v.ended=true; if(!v.teamKey) v.teamKey=_vtTeamKey(v.team); } });
  toast('Vertretung beendet.','ok'); renderVertretungen();
}
export function deleteVertretung(id){
  if(!_vtAll(window.cu)){ toast('Löschen nur durch Geschäftsführung/Administrator – bitte „Beenden“ nutzen.','err'); return; }
  if(!confirm('Diese Vertretung wirklich löschen?')) return;
  mutate(d=>{ d.vertretungen=(d.vertretungen||[]).filter(x=>x.id!==id); });
  renderVertretungen();
}
