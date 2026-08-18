import { getData, mutate } from '../data.js';
import { esc, toast } from '../utils.js';

// Vertretungsregelung (eigener Reiter, nur GF/Admin): Fällt eine Team-Leitung aus, bestimmt die
// Geschäftsführung/Admin hier befristet eine Vertretung – auch sich selbst. Die Vertretung sieht/
// prüft/leitet die Zeiten des Teams in der Mitarbeiterübersicht weiter, bis von/bis abläuft oder
// manuell beendet wird. Technisch angebunden über canSeeEmployee()/activeVertretungTeams() in
// roles.js. Datenmodell: d.vertretungen[]={id,team,deputyId,deputyName,von,bis,ended,byId,byName,ts}.
function _vtActive(v){
  if(!v||v.ended) return false;
  const c=s=>{ s=String(s||'').trim(); const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0'):s; };
  const today=c(new Date().toISOString().slice(0,10));
  return c(v.von)<=today && (!v.bis || today<=c(v.bis));
}
function _vtDate(s){ if(!s) return ''; try{ return new Date(s).toLocaleDateString('de-DE'); }catch(e){ return String(s); } }
function _vtVal(id){ const el=document.getElementById(id); return el?el.value.trim():''; }

export function renderVertretungen(){
  const content=document.getElementById('vertretungen-content');
  if(!content) return;
  const cu=window.cu;
  if(!(cu&&(cu.role==='geschaeftsfuehrer'||cu.role==='admin'))){
    content.innerHTML='<p style="color:var(--muted);padding:20px 0">Diese Ansicht ist nur für die Geschäftsführung und Administratoren.</p>';
    return;
  }
  const d=getData();
  const teams=(d.teams||[]).slice();
  const deputies=(d.users||[]).filter(u=>u.role==='geschaeftsfuehrer'||u.role==='leitung'||u.role==='admin');
  const vs=(d.vertretungen||[]).slice().sort((a,b)=>String(b.von||'').localeCompare(String(a.von||'')));

  const rows=vs.length?vs.map(v=>{
    const act=_vtActive(v);
    const state=v.ended?'<span style="color:var(--muted)">beendet</span>':(act?'<span style="color:var(--ok);font-weight:700">aktiv</span>':'<span style="color:var(--warn)">geplant / abgelaufen</span>');
    const zeit=_vtDate(v.von)+(v.bis?' – '+_vtDate(v.bis):' – offen');
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;flex-wrap:wrap">
      <span>🔄 <strong>${esc(v.team)}</strong> → ${esc(v.deputyName||'')} <span style="color:var(--muted);font-size:12px">(${esc(zeit)})</span> · ${state}</span>
      <span style="display:flex;gap:6px">${(!v.ended&&act)?`<button class="btn btn-outline btn-sm" onclick="endVertretung('${v.id}')">Beenden</button>`:''}<button class="btn btn-sm" style="background:#fff;border:1.5px solid var(--danger);color:var(--danger)" title="Löschen" onclick="deleteVertretung('${v.id}')">🗑</button></span>
    </div>`;
  }).join(''):'<div style="color:var(--muted);font-size:13px;padding:6px 0">Noch keine Vertretungen angelegt.</div>';

  const teamOpts=teams.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const depOpts=deputies.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}${u.role==='geschaeftsfuehrer'?' (GF)':(u.role==='admin'?' (Admin)':'')}</option>`).join('');
  const today=new Date().toISOString().slice(0,10);

  content.innerHTML=`
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px;max-width:760px">Fällt eine Team-Leitung aus, kann sie hier zeitweise vertreten werden – auch durch die Geschäftsführung selbst. Die Vertretung sieht, prüft und leitet die Zeiten des Teams in der Mitarbeiterübersicht weiter, bis der Zeitraum endet oder du sie beendest. Die eigentliche Leitung behält ihr Team dabei.</div>
    <div style="background:var(--card,#fff);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:22px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:var(--muted)">Team<br><select id="vt-team" style="min-width:160px">${teamOpts}</select></label>
        <label style="font-size:12px;color:var(--muted)">Vertreter:in<br><select id="vt-deputy" style="min-width:180px">${depOpts}</select></label>
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
  mutate(dd=>{ if(!Array.isArray(dd.vertretungen)) dd.vertretungen=[];
    dd.vertretungen.push({ id:'vt_'+Date.now()+'_'+Math.floor(Math.random()*1e6), team, deputyId, deputyName:(dep&&dep.name)||'', von:von||new Date().toISOString().slice(0,10), bis:bis||'', ended:false, byId:cu&&cu.id, byName:cu&&cu.name, ts:Date.now() }); });
  toast('Vertretung angelegt ✓','ok'); renderVertretungen();
}
export function endVertretung(id){
  mutate(d=>{ const v=(d.vertretungen||[]).find(x=>x.id===id); if(v) v.ended=true; });
  toast('Vertretung beendet.','ok'); renderVertretungen();
}
export function deleteVertretung(id){
  if(!confirm('Diese Vertretung wirklich löschen?')) return;
  mutate(d=>{ d.vertretungen=(d.vertretungen||[]).filter(x=>x.id!==id); });
  renderVertretungen();
}
