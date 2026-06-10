import { MONTHS, EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_GF_REPORT_TEMPLATE_ID, APP_URL } from '../config.js';
import { getData, mutate } from '../data.js';
import { esc, toast } from '../utils.js';
import { isManagerRole, canSeeEmployee, getLeitungTeams } from '../roles.js';
import { _openPerEmpPrint } from '../print.js';

// Benachrichtigt alle GF-Nutzer mit hinterlegter E-Mail über einen neuen Bericht.
// Sendet still (kein Toast bei Fehler – E-Mail ist Best-Effort, nicht kritisch).
// params: { art, von, details } – art = z.B. "Teambericht", "Jahresbericht"
// TEMPORÄR DEAKTIVIERT: EmailJS-Freikontingent aufgebraucht. Sobald ein
// (kostenloser) E-Mail-Dienst wieder verfügbar ist, diese Zeile entfernen.
const GF_NOTIFY_DISABLED = true;

export async function notifyGF(params){
  if(GF_NOTIFY_DISABLED) return;
  if(!EMAILJS_GF_REPORT_TEMPLATE_ID||!EMAILJS_PUBLIC_KEY||!EMAILJS_SERVICE_ID) return;
  const d=getData();
  const gfUsers=(d.users||[]).filter(u=>u.role==='geschaeftsfuehrer'&&u.email);
  if(!gfUsers.length) return;
  for(const gf of gfUsers){
    try{
      await window.emailjs?.send(EMAILJS_SERVICE_ID, EMAILJS_GF_REPORT_TEMPLATE_ID, {
        to_email:  gf.email,
        to_name:   gf.name||'Geschäftsführung',
        art:       params.art||'Bericht',
        von:       params.von||'Leitung',
        details:   params.details||'',
        app_url:   APP_URL,
      }, {publicKey: EMAILJS_PUBLIC_KEY});
    }catch(e){ console.warn('GF-Benachrichtigung fehlgeschlagen:',e); }
  }
}

export function renderGFBerichte(){
  const content=document.getElementById('gf-berichte-content');
  if(!content) return;
  const d=getData();
  const cu=window.cu;

  const yearReports=Object.values(d.yearReports||{}).sort((a,b)=>b.year-a.year||a.userName.localeCompare(b.userName,'de'));
  let html='';
  if(yearReports.length){
    const newYR=yearReports.filter(r=>!r.seenAt).length;
    html+='<div class="gf-team-group" style="margin-bottom:28px">';
    html+='<div class="gf-team-header"><span class="gf-team-name">📅 Jahresberichte</span>'
      +(newYR?'<span class="gf-new-badge">'+newYR+' NEU</span>':'')
      +'<span style="margin-left:auto;font-size:12px;color:var(--muted)">'+yearReports.length+' Bericht'+(yearReports.length!==1?'e':'')+'</span>'
      +'</div><div>';
    yearReports.forEach(r=>{
      const dt=new Date(r.submittedAt);
      const dtStr=dt.toLocaleDateString('de-DE')+' '+dt.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
      const isNew=!r.seenAt;
      html+='<div class="gf-report-card'+(isNew?' gf-report-new':'')+'">'
        +'<div>'
        +'<div class="gf-report-title">'+r.year+' – '+esc(r.userName)+(isNew?'<span class="gf-new-badge">NEU</span>':'')+'</div>'
        +'<div class="gf-report-meta">'+esc(r.team||'–')+' · Gesendet von <strong>'+esc(r.sentByName||r.sentBy)+'</strong> · '+dtStr+'</div>'
        +(r.seenAt?'<div class="gf-report-meta" style="color:var(--ok)">✓ Gesehen '+new Date(r.seenAt).toLocaleDateString('de-DE')+'</div>':'<div class="gf-report-meta" style="color:var(--warn);font-weight:700">Noch nicht geöffnet</div>')
        +'</div>'
        +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
        +'<button class="btn btn-ok btn-sm" onclick="viewYearReport(\''+r.userId+'\','+r.year+',\''+r.id+'\')">📄 PDF / Drucken</button>'
        +(isNew?'<button class="btn btn-outline btn-sm" onclick="markYearReportSeen(\''+r.id+'\')">✓ Als gesehen markieren</button>':'')
        +((cu&&(cu.role==='admin'||r.sentBy===cu.id))?'<button class="btn btn-sm" style="background:#fff;border:1.5px solid var(--danger);color:var(--danger)" onclick="deleteGfReport(\'year\',\''+r.id+'\')">🗑 Entfernen</button>':'')
        +'</div>'
        +'</div>';
    });
    html+='</div></div>';
  }

  const reports=Object.values(d.teamReports||{});
  if(!reports.length&&!yearReports.length){
    content.innerHTML='<p style="color:var(--muted);padding:20px 0">Noch keine Berichte eingegangen.</p>';
    return;
  }
  if(!reports.length){ content.innerHTML=html; return; }
  const teamMap={};
  reports.forEach(function(r){
    const team=r.teamName||(r.managedTeams&&r.managedTeams[0])||'–';
    if(!teamMap[team]) teamMap[team]=[];
    teamMap[team].push(r);
  });
  const teams=Object.keys(teamMap).sort(function(a,b){ return a.localeCompare(b,'de'); });
  teams.forEach(function(team){
    const teamReports=teamMap[team].slice().sort(function(a,b){
      if(b.year!==a.year) return b.year-a.year;
      return b.month-a.month;
    });
    const newCount=teamReports.filter(function(r){ return !r.seenAt; }).length;
    html+='<div class="gf-team-group">';
    html+='<div class="gf-team-header"><span class="gf-team-name">🏢 '+esc(team)+'</span>'
      +(newCount?'<span class="gf-new-badge">'+newCount+' NEU</span>':'')
      +'<span style="margin-left:auto;font-size:12px;color:var(--muted)">'+teamReports.length+' Bericht'+(teamReports.length!==1?'e':'')+'</span>'
      +'</div>';
    html+='<div>';
    teamReports.forEach(function(r){
      const dt=new Date(r.submittedAt);
      const dtStr=dt.toLocaleDateString('de-DE')+' '+dt.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
      const isNew=!r.seenAt;
      html+='<div class="gf-report-card'+(isNew?' gf-report-new':'')+'">'
        +'<div>'
        +'<div class="gf-report-title">'+MONTHS[r.month-1]+' '+r.year+(isNew?'<span class="gf-new-badge">NEU</span>':'')+'</div>'
        +'<div class="gf-report-meta">Eingereicht von <strong>'+esc(r.leitungName)+'</strong> &middot; '+dtStr+'</div>'
        +'<div class="gf-report-meta">'+r.employeeIds.length+' Mitarbeiter'
          +(r.seenAt?' &middot; <span style="color:var(--ok)">✓ Gesehen '+new Date(r.seenAt).toLocaleDateString('de-DE')+'</span>':' &middot; <span style="color:var(--warn);font-weight:700">Noch nicht geöffnet</span>')
        +'</div>'
        +'</div>'
        +'<div style="display:flex;gap:8px;flex-wrap:wrap">'
        +'<button class="btn btn-ok btn-sm" onclick="viewTeamReport(\''+r.id+'\')">📄 PDF / Drucken</button>'
        +(isNew?'<button class="btn btn-outline btn-sm" onclick="markReportSeen(\''+r.id+'\')">✓ Als gesehen markieren</button>':'')
        +((cu&&(cu.role==='admin'||r.leitungId===cu.id))?'<button class="btn btn-sm" style="background:#fff;border:1.5px solid var(--danger);color:var(--danger)" onclick="deleteGfReport(\'team\',\''+r.id+'\')">🗑 Entfernen</button>':'')
        +'</div>'
        +'</div>';
    });
    html+='</div></div>';
  });
  content.innerHTML=html;
}

// Einen beim GF eingegangenen Bericht entfernen (Admin oder absendende Leitung).
export function deleteGfReport(kind,id){
  const cu=window.cu; const d=getData();
  const store=kind==='year'?(d.yearReports||{}):(d.teamReports||{});
  const r=store[id];
  if(!r){ toast('Bericht nicht gefunden.','err'); return; }
  const isAdmin=cu&&cu.role==='admin';
  const isSender=cu&&(r.leitungId===cu.id||r.sentBy===cu.id);
  if(!isAdmin&&!isSender){ toast('Keine Berechtigung zum Entfernen.','err'); return; }
  const label=kind==='year'
    ? ('Jahresbericht '+r.year+' – '+(r.userName||''))
    : ('Teambericht '+(r.teamName||(r.managedTeams&&r.managedTeams[0])||'')+' · '+(r.month?MONTHS[r.month-1]+' ':'')+r.year);
  if(!confirm('Diesen Bericht beim GF entfernen?\n'+label)) return;
  mutate(function(dd){ const s=kind==='year'?dd.yearReports:dd.teamReports; if(s&&s[id]) delete s[id]; });
  toast('Bericht entfernt.','');
  renderGFBerichte();
}

export function viewTeamReport(key){
  const d=getData();
  const r=d.teamReports&&d.teamReports[key];
  if(!r){ toast('Bericht nicht gefunden.','err'); return; }
  const emps=r.employeeIds.map(function(id){ return d.users.find(function(u){ return u.id===id; }); }).filter(Boolean);
  if(!emps.length){ toast('Keine Mitarbeiterdaten vorhanden.','err'); return; }
  _openPerEmpPrint(emps,r.year,r.month);
  if(!r.seenAt) markReportSeen(key);
}

export function markReportSeen(key){
  mutate(function(d){ if(d.teamReports&&d.teamReports[key]) d.teamReports[key].seenAt=new Date().toISOString(); });
  renderGFBerichte();
}

export function viewYearReport(uid,y,key){
  if(key) markYearReportSeen(key);
  window.printJahresübersicht?.(uid,y);
}

export function markYearReportSeen(key){
  mutate(d=>{ if(d.yearReports&&d.yearReports[key]) d.yearReports[key].seenAt=new Date().toISOString(); });
  renderGFBerichte();
}

export function sendTeamReport(){
  const cu=window.cu;
  const d=getData();
  const emps=d.users.filter(u=>!isManagerRole(u)).filter(u=>canSeeEmployee(cu,u));
  if(!emps.length){ toast('Keine Mitarbeiter im Team vorhanden.','err'); return; }
  const key=cu.id+'_'+window.year+'_'+String(window.mon).padStart(2,'0');
  const report={
    id:key, leitungId:cu.id, leitungName:cu.name,
    managedTeams:getLeitungTeams(cu),
    year:window.year, month:window.mon,
    submittedAt:new Date().toISOString(),
    seenAt:null,
    employeeIds:emps.map(u=>u.id)
  };
  mutate(function(d){ if(!d.teamReports) d.teamReports={}; d.teamReports[key]=report; });
  toast('Teambericht an Geschäftsführung gesendet. ✓','ok');
  notifyGF({
    art: 'Teambericht',
    von: cu.name,
    details: MONTHS[window.mon-1]+' '+window.year+(report.managedTeams&&report.managedTeams.length?' – '+report.managedTeams.join(', '):''),
  });
  _openPerEmpPrint(emps,window.year,window.mon);
}

export function sendTeamReportForTeam(teamName,empIds,y,m){
  const cu=window.cu;
  const d=getData();
  const emps=empIds.map(id=>d.users.find(u=>u.id===id)).filter(Boolean);
  if(!emps.length){ toast('Keine Mitarbeiterdaten vorhanden.','err'); return; }
  if(!confirm(`Alle ${emps.length} Zeiterfassungen für ${MONTHS[m-1]} ${y} (Team: ${teamName}) an die Geschäftsführung senden?`)) return;
  const rKey='team_'+teamName.replace(/\W/g,'_')+'_'+y+'_'+String(m).padStart(2,'0');
  const report={
    id:rKey, leitungId:cu.id, leitungName:cu.name,
    teamName:teamName,
    managedTeams:[teamName],
    year:y, month:m,
    submittedAt:new Date().toISOString(),
    seenAt:null,
    employeeIds:empIds
  };
  mutate(function(d){ if(!d.teamReports) d.teamReports={}; d.teamReports[rKey]=report; });
  toast('Teambericht „'+teamName+'" für '+MONTHS[m-1]+' '+y+' an GF gesendet ✓','ok');
  notifyGF({
    art: 'Teambericht',
    von: cu.name,
    details: MONTHS[m-1]+' '+y+' – '+teamName,
  });
  window.renderOverview?.();
  _openPerEmpPrint(emps,y,m);
}

// Einen an die GF gesendeten Teambericht (Buchhaltungsversion) wieder zurückziehen.
export function recallTeamReport(teamName,y,m){
  const rKey='team_'+teamName.replace(/\W/g,'_')+'_'+y+'_'+String(m).padStart(2,'0');
  const d=getData();
  const rep=d.teamReports&&d.teamReports[rKey];
  if(!rep){ toast('Kein gesendeter Bericht gefunden.','err'); return; }
  const seen=rep.seenAt?'\n\nHinweis: Die Geschäftsführung hat den Bericht bereits geöffnet.':'';
  if(!confirm('Teambericht „'+teamName+'" für '+MONTHS[m-1]+' '+y+' an die GF zurückziehen?'+seen)) return;
  mutate(function(d){ if(d.teamReports&&d.teamReports[rKey]) delete d.teamReports[rKey]; });
  toast('Teambericht zurückgezogen – nicht mehr bei der GF sichtbar.','');
  window.renderOverview?.();
}
