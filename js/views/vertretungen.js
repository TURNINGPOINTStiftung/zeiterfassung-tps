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
function _vtActive(v){
  if(!v||v.ended) return false;
  const c=s=>{ s=String(s||'').trim(); const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0'):s; };
  const today=c(localISODate());
  return c(v.von)<=today && (!v.bis || today<=c(v.bis));
}
function _vtDate(s){ if(!s) return ''; try{ return new Date(s).toLocaleDateString('de-DE'); }catch(e){ return String(s); } }
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
  const vs=(d.vertretungen||[]).filter(v=>all||own.includes(v.team)).slice().sort((a,b)=>String(b.von||'').localeCompare(String(a.von||'')));

  const rows=vs.length?vs.map(v=>{
    const act=_vtActive(v);
    const state=v.ended?'<span style="color:var(--muted)">beendet</span>':(act?'<span style="color:var(--ok);font-weight:700">aktiv</span>':'<span style="color:var(--warn)">geplant / abgelaufen</span>');
    const zeit=_vtDate(v.von)+(v.bis?' – '+_vtDate(v.bis):' – offen');
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;flex-wrap:wrap">
      <span>🔄 <strong>${esc(v.team)}</strong> → ${esc(v.deputyName||'')} <span style="color:var(--muted);font-size:12px">(${esc(zeit)})</span> · ${state}</span>
      <span style="display:flex;gap:6px">${(!v.ended&&act)?`<button class="btn btn-outline btn-sm" onclick="endVertretung(${jsq(v.id)})">Beenden</button>`:''}${all?`<button class="btn btn-sm" style="background:var(--surface,#fff);border:1.5px solid var(--danger);color:var(--danger)" title="Löschen" onclick="deleteVertretung(${jsq(v.id)})">🗑</button>`:''}</span>
    </div>`;
  }).join(''):'<div style="color:var(--muted);font-size:13px;padding:6px 0">Noch keine Vertretungen angelegt.</div>';

  const teamOpts=teams.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const depOpts=deputies.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}${u.role==='geschaeftsfuehrer'?' (GF)':(u.role==='admin'?' (Admin)':'')}</option>`).join('');
  const today=localISODate();

  content.innerHTML=`
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px;max-width:760px">Fällt eine Team-Leitung aus, kann sie hier zeitweise vertreten werden – auch durch die Geschäftsführung selbst. Die Vertretung sieht, prüft und leitet die Zeiten des Teams in der Mitarbeiterübersicht weiter, bis der Zeitraum endet oder du sie beendest. Die eigentliche Leitung behält ihr Team dabei.</div>
    <div style="background:var(--surface,#fff);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:22px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:var(--muted)">Team<br><select id="vt-team" style="min-width:160px">${teamOpts}</select></label>
        <label style="font-size:12px;color:var(--muted)">Vertreter:in<br><select id="vt-deputy" class="crm-ss" style="min-width:180px">${depOpts}</select></label>
        <label style="font-size:12px;color:var(--muted)">ab<br><input type="date" id="vt-von" value="${today}"></label>
        <label style="font-size:12px;color:var(--muted)">bis (optional)<br><input type="date" id="vt-bis"></label>
        <button class="btn btn-ok btn-sm" onclick="addVertretung()">＋ Vertretung anlegen</button>
      </div>
    </div>
    <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin:0 0 10px">Angelegte Vertretungen</h3>
    ${rows}`;
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
