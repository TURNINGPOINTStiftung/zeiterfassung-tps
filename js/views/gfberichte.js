import { MONTHS, EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_GF_REPORT_TEMPLATE_ID, APP_URL } from '../config.js';
import { getData, mutate } from '../data.js';
import { esc, toast } from '../utils.js';
import { isManagerRole, canSeeEmployee, getLeitungTeams, getTeamForDate, monthStartDate } from '../roles.js';
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

// Bereichs-Label einer Leitung, z.B. „Leitung Marketing & Öffentlichkeitsarbeit".
function _leitungLabel(u){
  const lt=getLeitungTeams(u);
  const t=lt.length?lt:(u&&u.team?[u.team]:[]);
  return 'Leitung'+(t.length?' '+t.join(', '):'');
}

// Report-Schlüssel, unter dem eine vom GF genehmigte ZE in der Buchhaltungsversion landet:
// Leitung → eigener LEIT_-Bericht (eine Karte pro Leitung), sonst der Team-Bericht des Monats.
function _gfReportTarget(u,y,m){
  if(u.role==='leitung') return {key:'LEIT_'+u.id+'_'+y+'_'+String(m).padStart(2,'0'), teamName:_leitungLabel(u)};
  const team=getTeamForDate(u,monthStartDate(y,m))||u.team||'(kein Team)';
  return {key:'team_'+team.replace(/\W/g,'_')+'_'+y+'_'+String(m).padStart(2,'0'), teamName:team};
}

// Vom GF genehmigte (gegengezeichnete) ZE direkt als eingereichten Bericht in die
// Buchhaltungsversion legen – der Zwischenschritt „Bericht einreichen" entfällt.
// Idempotent: erneutes Ablegen ergänzt/aktualisiert nur, dupliziert nichts.
export function fileGfApproval(uid,y,m){
  const cu=window.cu; const d=getData();
  const u=(d.users||[]).find(x=>x.id===uid);
  if(!u||!cu) return;
  const tg=_gfReportTarget(u,y,m);
  const now=new Date().toISOString();
  mutate(function(dd){
    if(!dd.teamReports) dd.teamReports={};
    // Person aus anderen Berichten desselben Monats lösen (z.B. alter Teamname / „Leitungsteam").
    Object.keys(dd.teamReports).forEach(function(k){
      const r=dd.teamReports[k];
      if(k===tg.key||!r||r.year!==y||r.month!==m||!Array.isArray(r.employeeIds)||!r.employeeIds.includes(uid)) return;
      r.employeeIds=r.employeeIds.filter(function(id){ return id!==uid; });
      if(!r.employeeIds.length) delete dd.teamReports[k];
    });
    const r=dd.teamReports[tg.key];
    if(r){
      if(!Array.isArray(r.employeeIds)) r.employeeIds=[];
      if(!r.employeeIds.includes(uid)) r.employeeIds.push(uid);
      r.teamName=tg.teamName;
      if(u.role==='leitung'){ r.countersignedAt=now; r.countersignedBy=cu.id; r.countersignedByName=cu.name; }
      else { r.submittedAt=now; r.seenAt=null; }
    } else {
      dd.teamReports[tg.key]={
        id:tg.key, teamName:tg.teamName, managedTeams:[tg.teamName],
        leitungId:u.role==='leitung'?u.id:cu.id, leitungName:u.role==='leitung'?u.name:cu.name,
        year:y, month:m, submittedAt:now, seenAt:null, employeeIds:[uid],
        ...(u.role==='leitung'?{countersignedAt:now,countersignedBy:cu.id,countersignedByName:cu.name}:{})
      };
    }
  });
}

// Gegenstück: Person wieder aus den Berichten des Monats nehmen (z.B. Admin setzt auf Entwurf).
export function unfileGfReport(uid,y,m){
  mutate(function(dd){
    if(!dd.teamReports) return;
    Object.keys(dd.teamReports).forEach(function(k){
      const r=dd.teamReports[k];
      if(!r||r.year!==y||r.month!==m||!Array.isArray(r.employeeIds)||!r.employeeIds.includes(uid)) return;
      r.employeeIds=r.employeeIds.filter(function(id){ return id!==uid; });
      if(!r.employeeIds.length) delete dd.teamReports[k];
    });
  });
}

// Aktuell in der GF-Berichte-Ansicht gezeigter Monat (year*100+month). null = neuester mit Berichten.
let _gfMon=null;
export function gfSetMonth(mk){ if(mk==null||isNaN(mk)) return; _gfMon=mk; renderGFBerichte(); }

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
  // Nach Monat gruppieren; oben umschaltbar – wie in der Zeiterfassung wird EIN Monat gezeigt,
  // wählbar über ‹ älter / neuer › und ein Dropdown. (Jahresberichte bleiben oben stehen.)
  const monMap={};
  reports.forEach(function(r){
    const mk=r.year*100+r.month;
    if(!monMap[mk]) monMap[mk]=[];
    monMap[mk].push(r);
  });
  const monKeys=Object.keys(monMap).map(Number).sort(function(a,b){ return b-a; }); // neueste zuerst
  let cur=_gfMon; if(cur==null||monKeys.indexOf(cur)<0) cur=monKeys[0];
  _gfMon=cur;
  const idx=monKeys.indexOf(cur);
  const curY=Math.floor(cur/100), curM=cur%100;
  const olderKey=(idx<monKeys.length-1)?monKeys[idx+1]:null; // weiter in die Vergangenheit
  const newerKey=(idx>0)?monKeys[idx-1]:null;
  html+='<div class="gf-mon-switch">';
  html+='<button class="btn btn-outline btn-sm gf-mon-arrow"'+(olderKey==null?' disabled':' onclick="gfSetMonth('+olderKey+')"')+'>‹ älter</button>';
  html+='<select class="gf-mon-select" onchange="gfSetMonth(parseInt(this.value,10))">';
  monKeys.forEach(function(k){
    const yy=Math.floor(k/100), mm=k%100;
    const nc=monMap[k].filter(function(r){ return !r.seenAt; }).length;
    html+='<option value="'+k+'"'+(k===cur?' selected':'')+'>'+MONTHS[mm-1]+' '+yy+' &middot; '+monMap[k].length+' Bericht'+(monMap[k].length!==1?'e':'')+(nc?' &middot; '+nc+' neu':'')+'</option>';
  });
  html+='</select>';
  html+='<button class="btn btn-outline btn-sm gf-mon-arrow"'+(newerKey==null?' disabled':' onclick="gfSetMonth('+newerKey+')"')+'>neuer ›</button>';
  html+='</div>';
  const list=monMap[cur].slice().sort(function(a,b){
    const ta=a.teamName||(a.managedTeams&&a.managedTeams[0])||'';
    const tb=b.teamName||(b.managedTeams&&b.managedTeams[0])||'';
    if(ta!==tb) return ta.localeCompare(tb,'de');
    return (a.leitungName||'').localeCompare(b.leitungName||'','de');
  });
  const newCount=list.filter(function(r){ return !r.seenAt; }).length;
  html+='<div class="gf-team-group">';
  html+='<div class="gf-team-header"><span class="gf-team-name">📅 '+MONTHS[curM-1]+' '+curY+'</span>'
    +(newCount?'<span class="gf-new-badge">'+newCount+' NEU</span>':'')
    +'<span style="margin-left:auto;font-size:12px;color:var(--muted)">'+list.length+' Bericht'+(list.length!==1?'e':'')+'</span>'
    +'</div>';
  html+='<div>';
  list.forEach(function(r){
    let team=r.teamName||(r.managedTeams&&r.managedTeams[0])||'–';
    const _emps=(r.employeeIds||[]).map(function(id){ return (d.users||[]).find(function(u){ return u.id===id; }); }).filter(Boolean);
    // Leitungs-Karten nach Fachbereich benennen (Moritz→Akademie, Rebecca→Vereinsentwicklung,
    // Isabel→Marketing & ÖA) – immer aus den AKTUELLEN Teams der Leitung, damit auch alte
    // Berichte („Leitung", „Leitungsteam", veraltete Teamnamen) richtig zugeordnet werden.
    // Reine Anzeige – keine Änderung an den Berichtsdaten.
    if(/^LEIT_/.test(r.id||'') || /^Leitung/.test(team)){
      const _ls=_emps.filter(function(u){ return u.role==='leitung'; });
      if(_ls.length) team=_ls.map(_leitungLabel).join(' · ');
    }
    const dt=new Date(r.submittedAt);
    const dtStr=dt.toLocaleDateString('de-DE')+' '+dt.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    const isNew=!r.seenAt;
    html+='<div class="gf-report-card'+(isNew?' gf-report-new':'')+'">'
      +'<div>'
      +'<div class="gf-report-title">🏢 '+esc(team)+(isNew?'<span class="gf-new-badge">NEU</span>':'')+'</div>'
      +'<div class="gf-report-meta">Eingereicht von <strong>'+esc(r.leitungName)+'</strong> &middot; '+dtStr+'</div>'
      +'<div class="gf-report-meta">'+r.employeeIds.length+' Mitarbeiter'
        +(_emps.length?': '+_emps.map(function(u){ return esc(u.name); }).join(', '):'')
        +(r.countersignedAt?' &middot; <span style="color:var(--ok)">✍ Gegengezeichnet '+new Date(r.countersignedAt).toLocaleDateString('de-DE')+'</span>':'')
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
  // GF sendet nicht "an sich selbst" – für seine eigenen Teams heißt es Einreichen
  // in die Buchhaltungsversion, nicht Weiterleiten.
  const isGfSelf=cu.role==='geschaeftsfuehrer';
  const _n=emps.length, _ze=_n===1?'Zeiterfassung':'Zeiterfassungen';
  const confirmMsg=isGfSelf
    ? `${_n} ${_ze} für ${MONTHS[m-1]} ${y} (Team: ${teamName}) als Bericht einreichen (Buchhaltungsversion)?\nFehlende können später nachgereicht werden.`
    : `${_n} ${_ze} für ${MONTHS[m-1]} ${y} (Team: ${teamName}) an die Geschäftsführung senden?\nFehlende können später nachgereicht werden.`;
  if(!confirm(confirmMsg)) return;
  // GF: gleiche Ablage wie beim automatischen Einreichen nach dem Genehmigen
  // (Leitungen je eigene Karte, sonst Team-Bericht) – kein Sammelbericht „Leitungsteam".
  if(isGfSelf){
    emps.forEach(function(u){ fileGfApproval(u.id,y,m); });
    toast('Bericht „'+teamName+'" für '+MONTHS[m-1]+' '+y+' eingereicht ✓','ok');
    window.renderOverview?.();
    _openPerEmpPrint(emps,y,m);
    return;
  }
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
  mutate(function(d){
    if(!d.teamReports) d.teamReports={};
    // Ein neu eingereichter Bericht ÜBERSCHREIBT alte für denselben Monat: gleiches Team
    // ODER überlappende Mitarbeiter. Mitarbeiter-IDs sind stabil – so werden auch alte
    // Berichte unter dem früheren Teamnamen (z.B. „Öffentlichkeitsarbeit") ersetzt.
    var newSet={}; empIds.forEach(function(id){ newSet[id]=1; });
    Object.keys(d.teamReports).forEach(function(k){
      var r=d.teamReports[k]; if(!r||r.year!==y||r.month!==m) return;
      var sameTeam = r.teamName===teamName || (Array.isArray(r.managedTeams)&&r.managedTeams.includes(teamName));
      var overlap = Array.isArray(r.employeeIds)&&r.employeeIds.some(function(id){ return newSet[id]; });
      if(sameTeam||overlap) delete d.teamReports[k];
    });
    d.teamReports[rKey]=report;
  });
  toast(isGfSelf
    ? 'Bericht „'+teamName+'" für '+MONTHS[m-1]+' '+y+' eingereicht ✓'
    : 'Teambericht „'+teamName+'" für '+MONTHS[m-1]+' '+y+' an GF gesendet ✓','ok');
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
