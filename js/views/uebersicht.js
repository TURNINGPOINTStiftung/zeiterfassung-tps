import { MONTHS, EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_REMINDER_TEMPLATE_ID, APP_URL } from '../config.js';
import { getData, getEntry, entryKey, mutate, getUser } from '../data.js';
import { isFreelancer, isManagerRole, canSeeEmployee, getLeitungTeams, roleLabel, hasPermission, getTeamForDate, monthStartDate } from '../roles.js';
import { esc, hFmt, minFmt, openModal, closeModal, toast } from '../utils.js';
import { monthIST, monthSOLL, getEffectiveCarryH, vacDays, sickDays, totalVacUsed, vacUsedUpToMonth, zuordBreakdown, buildZuordPivot, normZuord } from '../calc.js';
import { getCatsForTeam } from '../cats.js';

export function populateUeberYear(){
  const sel=document.getElementById('ueber-year');
  sel.innerHTML='';
  for(let y=2024;y<=2028;y++){
    const o=document.createElement('option'); o.value=y; o.textContent=y;
    if(y===window.year) o.selected=true; sel.appendChild(o);
  }
}

export function populateUeberMon(){
  const sel=document.getElementById('ueber-mon');
  sel.innerHTML='';
  MONTHS.forEach((mn,i)=>{
    const o=document.createElement('option'); o.value=i+1; o.textContent=mn;
    if(i+1===window.mon) o.selected=true; sel.appendChild(o);
  });
}

export function populateUeberTeam(){
  const sel=document.getElementById('ueber-team');
  sel.innerHTML='<option value="">Alle Teams</option>';
  (window.getTeams?.()??[]).forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
}

export function renderOverview(){
  const cu=window.cu;
  const oy=parseInt(document.getElementById('ueber-year').value)||window.year;
  const om=parseInt(document.getElementById('ueber-mon').value)||window.mon;
  const filterTeam=document.getElementById('ueber-team').value;
  const d=getData();
  const bCls={draft:'s-draft',submitted:'s-submitted',approved:'s-approved',rejected:'s-rejected'};
  // Senden an GF aus der Mitarbeiterübersicht: Leitung & Admin (unabhängig vom ZE-Header-Button)
  const canSend=cu.role==='leitung'||cu.role==='admin';

  const mDateFilter=monthStartDate(oy,om);
  let employees;
  if(cu.role==='geschaeftsfuehrer'){
    employees=d.users.filter(u=>canSeeEmployee(cu,u));
    if(filterTeam) employees=employees.filter(u=>{
      if(u.role==='leitung') return getLeitungTeams(u).includes(filterTeam)||getLeitungTeams(u).length===0;
      return getTeamForDate(u,mDateFilter)===filterTeam;
    });
  } else if(cu.role==='admin'){
    employees=d.users.filter(u=>u.role!=='admin');
    if(filterTeam) employees=employees.filter(u=>getTeamForDate(u,mDateFilter)===filterTeam);
  } else {
    employees=d.users.filter(u=>!isManagerRole(u)).filter(u=>canSeeEmployee(cu,u));
    if(filterTeam) employees=employees.filter(u=>u.team===filterTeam);
  }

  // Team für den gewählten Monat ermitteln (History-aware)
  const mDate=monthStartDate(oy,om);
  const teamMap={};
  employees.forEach(u=>{
    const t=isManagerRole(u)?'Leitungsteam':(getTeamForDate(u,mDate)||'(kein Team)');
    if(!teamMap[t]) teamMap[t]=[];
    teamMap[t].push(u);
  });

  const renderCard=(u)=>{
    const pills=MONTHS.map((mn,i)=>{
      const e=d.entries[entryKey(u.id,oy,i+1)];
      const st=e?e.status:'draft';
      return `<span class="m-pill ${bCls[st]}" title="${mn}: ${{draft:'Entwurf',submitted:'Eingereicht',approved:'Genehmigt',rejected:'Abgelehnt'}[st]||st}">${mn.slice(0,3)}</span>`;
    }).join('');
    const pending=MONTHS.filter((_,i)=>{ const e=d.entries[entryKey(u.id,oy,i+1)]; return e&&e.status==='submitted'; }).length;
    const roleChip=`<span class="chip chip-${u.role}">${roleLabel(u.role,u)}</span>`;
    const isFree=isFreelancer(u);
    const maxH=isFree?(u.maxHours||0):0;
    const curEntry=d.entries[entryKey(u.id,oy,om)]||{};
    const curIST=monthIST(curEntry,u);
    const curCarry=getEffectiveCarryH(u.id,u,oy,om);
    const canEditDpw=cu.role==='admin'||(cu.role==='leitung'&&canSeeEmployee(cu,u));
    const dpwBtn=canEditDpw&&!isFree?`<button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 7px;margin-top:6px" onclick="event.stopPropagation();showEditDpw('${u.id}')">✏ ${u.dpw||5} Tage/Wo</button>`:'';
    const curStatus=curEntry.status||'draft';
    const isClickable=curStatus==='submitted'||curStatus==='approved'||curStatus==='rejected';
    const cardClick=isClickable?`onclick="openEmpMonth('${u.id}')" title="Zeiterfassung öffnen"`:`style="cursor:default" title="Noch nicht eingereicht"`;
    const notSubmitted=!isClickable?`<div class="meta" style="margin-top:4px;font-size:11px;color:var(--muted)">📝 ${MONTHS[om-1]}: noch nicht eingereicht</div>`:'';
    if(isFree){
      const curTotal=curIST+Math.round(curCarry*60);
      const curOverflow=maxH>0?Math.max(0,curTotal-maxH*60):0;
      const freeMeta=maxH>0
        ?`Limit: <strong>${maxH} h/Monat</strong> · ${MONTHS[om-1]}: ${hFmt(curIST)} geleistet`
          +(curOverflow>0?` · <span style="color:var(--warn);font-weight:700">→ ${hFmt(curOverflow)} Übertrag</span>`:'')
        :'flexibel (kein Limit)';
      return `<div class="emp-card${isClickable?'':' emp-card-locked'}" ${cardClick}>
        <h3>${u.name} ${roleChip}</h3>
        <div class="meta">${u.city||'–'} · ${freeMeta}</div>
        ${pending>0?`<div class="meta" style="margin-top:4px"><span style="color:var(--warn);font-weight:700">${pending} Monat${pending>1?'e':''} offen</span></div>`:''}
        ${notSubmitted}
        <div class="months">${pills}</div>
        ${dpwBtn}
      </div>`;
    }
    const vacUpTo=vacUsedUpToMonth(u.id,oy,om);   // bis einschl. angezeigtem Monat
    const vacApproved=totalVacUsed(u.id,oy);       // ganzes Jahr (inkl. Zukunft)
    const vacLeft=(u.al||0)-vacUpTo;
    const vacFuture=Math.max(0,vacApproved-vacUpTo);
    const curSOLL=monthSOLL(u,oy,om);
    const curDiff=curIST-(curSOLL-Math.round(curCarry*60));
    const diffColor=curDiff>=0?'var(--ok)':'var(--danger)';
    const diffStr=(curDiff>=0?'+':'')+hFmt(Math.abs(curDiff));
    return `<div class="emp-card${isClickable?'':' emp-card-locked'}" ${cardClick}>
      <h3>${u.name} ${roleChip}</h3>
      <div class="meta">${u.city||'–'} · ${u.wh}h/Woche</div>
      <div class="meta" style="display:flex;gap:18px;flex-wrap:wrap;margin-top:5px">
        <span>🏖 Resturlaub: <strong>${vacLeft}&thinsp;T</strong> <span style="font-size:11px;color:var(--muted)">(${vacUpTo}/${u.al||0} bis ${MONTHS[om-1].slice(0,3)}${vacFuture>0?`, ${vacFuture} schon gebucht`:''})</span></span>
        <span>⏱ ${MONTHS[om-1]}: <strong style="color:${diffColor}">${diffStr}</strong></span>
      </div>
      ${pending>0?`<div class="meta" style="margin-top:4px"><span style="color:var(--warn);font-weight:700">${pending} Monat${pending>1?'e':''} offen</span></div>`:''}
      ${notSubmitted}
      <div class="months">${pills}</div>
      ${dpwBtn}
    </div>`;
  };

  const renderTeamSendBar=(team,users)=>{
    if(!canSend) return '';
    const total=users.length;
    if(total===0) return '';
    const approved=users.filter(u=>{
      const e=d.entries[entryKey(u.id,oy,om)];
      return e&&e.status==='approved';
    }).length;
    const allApproved=approved===total;
    const monthLabel=MONTHS[om-1]+' '+oy;
    const rKey='team_'+team.replace(/\W/g,'_')+'_'+oy+'_'+String(om).padStart(2,'0');
    const sent=d.teamReports&&d.teamReports[rKey];
    const sentInfo=sent?`<span style="color:var(--ok);font-size:12px;font-weight:600">✓ Gesendet ${new Date(sent.submittedAt).toLocaleDateString('de-DE')}</span>`:'';
    const empIds=JSON.stringify(users.map(u=>u.id));
    if(allApproved){
      return `<div class="team-send-bar">
        <span style="color:var(--ok);font-weight:600;font-size:13px">✓ Alle ${total} Zeiterfassungen für ${monthLabel} genehmigt</span>
        ${sentInfo}
        <button class="btn btn-ok btn-sm" onclick='sendTeamReportForTeam(${JSON.stringify(team)},${empIds},${oy},${om})'>
          📨 An GF weiterleiten
        </button>
      </div>`;
    } else {
      return `<div class="team-send-bar">
        <span style="color:var(--muted);font-size:13px">${monthLabel}: <strong>${approved}/${total}</strong> genehmigt – bitte zuerst alle freigeben</span>
        ${sentInfo}
        <button class="btn btn-outline btn-sm" disabled style="opacity:.4;cursor:not-allowed">📨 An GF weiterleiten</button>
      </div>`;
    }
  };

  // Erinnerungs-Button: nur für Leitung und Admin, nicht für GF
  const btnRem=document.getElementById('btn-reminders');
  if(btnRem) btnRem.style.display=hasPermission('btn_erinnerungen',cu.role)?'':'none';

  const content=document.getElementById('overview-content');
  if(Object.keys(teamMap).length===0){
    content.innerHTML='<p style="color:var(--muted)">Keine Mitarbeiter gefunden.</p>'; return;
  }

  content.innerHTML=Object.entries(teamMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([team,users])=>`
    <div class="team-section">
      <h3>${team}</h3>
      <div class="emp-grid">${users.map(renderCard).join('')}</div>
      ${renderTeamSendBar(team,users)}
    </div>`).join('');
  content.innerHTML+=buildZuordSummary(employees,oy,om,d);
}

export function buildZuordSummary(employees,oy,om,d){
  if(!employees||!employees.length) return '';
  const mMaps=employees.map(u=>({name:u.name,map:zuordBreakdown(d.entries[entryKey(u.id,oy,om)]||{})}));
  const yMaps=employees.map(u=>{
    const ymap={};
    for(let m=1;m<=12;m++){
      Object.entries(zuordBreakdown(d.entries[entryKey(u.id,oy,m)]||{})).forEach(([cat,min])=>{ymap[cat]=(ymap[cat]||0)+min;});
    }
    return {name:u.name,map:ymap};
  });
  const EXCL_CATS=new Set(['Urlaub','AU/Krank','Veranstaltung AU','Arbeitszeitausgleich']);
  const _teamCats=[...new Set(employees.flatMap(u=>getCatsForTeam(u.team||'').map(normZuord)))]
    .filter(c=>!EXCL_CATS.has(c));
  const _dataCats=[...new Set([...mMaps,...yMaps].flatMap(({map})=>Object.keys(map)))]
    .filter(c=>!EXCL_CATS.has(c));
  const allCats=[...new Set([..._teamCats,..._dataCats])]
    .sort((a,b)=>{
      const ta=yMaps.reduce((s,{map})=>s+(map[a]||0),0);
      const tb=yMaps.reduce((s,{map})=>s+(map[b]||0),0);
      return tb-ta;
    });
  const buildTable=(maps,cats,label)=>{
    const visCats=cats;
    if(!visCats.length) return '';
    const empRows=maps.map(({name,map})=>{
      const vals=visCats.map(cat=>map[cat]||0);
      if(!vals.some(v=>v>0)) return '';
      const rowTot=vals.reduce((s,v)=>s+v,0);
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 10px;font-size:12px;font-weight:600;white-space:nowrap">${name}</td>
        ${vals.map(v=>`<td style="padding:5px 8px;text-align:right;font-size:12px;color:${v?'inherit':'var(--border)'}">${v?hFmt(v):'–'}</td>`).join('')}
        <td style="padding:5px 8px;text-align:right;font-size:12px;font-weight:700;border-left:2px solid var(--border)">${rowTot?hFmt(rowTot):'–'}</td>
      </tr>`;
    }).filter(Boolean).join('');
    if(!empRows) return '';
    const catTots=visCats.map(cat=>maps.reduce((s,{map})=>s+(map[cat]||0),0));
    const grandTot=catTots.reduce((s,v)=>s+v,0);
    const gesamtRow=`<tr style="background:#1a3a5c;color:#fff;font-weight:700">
      <td style="padding:6px 10px;font-size:12px">Gesamt</td>
      ${catTots.map(t=>`<td style="padding:6px 8px;text-align:right;font-size:12px">${t?hFmt(t):'–'}</td>`).join('')}
      <td style="padding:6px 8px;text-align:right;font-size:12px;border-left:2px solid rgba(255,255,255,0.3)">${grandTot?hFmt(grandTot):'–'}</td>
    </tr>`;
    return `<div style="margin-top:20px">
      <div style="font-size:13px;font-weight:700;color:var(--primary);margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid var(--border)">${label}</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:350px">
          <thead><tr style="background:var(--primary);color:#fff">
            <th style="padding:6px 10px;text-align:left;font-size:11px;min-width:120px">Mitarbeiter</th>
            ${visCats.map(cat=>`<th style="padding:6px 8px;text-align:right;font-size:10px;white-space:nowrap">${cat}</th>`).join('')}
            <th style="padding:6px 8px;text-align:right;font-size:10px;white-space:nowrap;border-left:2px solid rgba(255,255,255,0.3)">Gesamt</th>
          </tr></thead>
          <tbody>${empRows}</tbody>
          <tfoot>${gesamtRow}</tfoot>
        </table>
      </div>
    </div>`;
  };
  const mTable=buildTable(mMaps,allCats,`${MONTHS[om-1]} ${oy}`);
  const yTable=buildTable(yMaps,allCats,`Gesamtjahr ${oy}`);
  if(!mTable&&!yTable) return '';
  return `<div style="margin-top:28px;background:var(--white);border-radius:8px;border:1px solid var(--border);padding:20px 24px">
    <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:2px">Stunden nach Zuordnung</h3>
    <p style="font-size:11px;color:var(--muted);margin-bottom:0">Alle sichtbaren Mitarbeiter · ${MONTHS[om-1]} ${oy}</p>
    ${mTable}
    ${yTable}
  </div>`;
}

export function openEmpMonth(uid){
  window.viewEmpId=uid;
  window.switchView?.('zeiterfassung');
}

export function openJahresübersicht(uid,y){
  const d=getData();
  const cu=window.cu;
  const user=getUser(uid);
  if(!user) return;
  const isFree=isFreelancer(user);
  const canSendGF=cu&&hasPermission('btn_jahresbericht',cu.role);

  const rows=MONTHS.map((mn,i)=>{
    const m=i+1;
    const entry=d.entries[entryKey(uid,y,m)]||{};
    const ist=monthIST(entry,user);
    const soll=isFree?0:monthSOLL(user,y,m);
    const carry=getEffectiveCarryH(uid,user,y,m);
    const diff=isFree?0:(ist-(soll-Math.round(carry*60)));
    const vac=vacDays(entry);
    const sick=sickDays(entry);
    const st=entry.status||'draft';
    const stLabel={draft:'Entwurf',submitted:'Eingereicht',approved:'Genehmigt',rejected:'Abgelehnt'}[st]||st;
    const stColor={draft:'var(--muted)',submitted:'var(--warn)',approved:'var(--ok)',rejected:'var(--danger)'}[st]||'var(--muted)';
    const diffColor=diff>=0?'var(--ok)':'var(--danger)';
    const diffStr=isFree?'–':((diff>=0?'+':'')+hFmt(Math.abs(diff)));
    return `<tr>
      <td style="font-weight:600;padding:8px 10px;border-bottom:1px solid var(--border)">${mn}</td>
      ${isFree?'':`<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right">${soll>0?hFmt(soll):'–'}</td>`}
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right">${ist>0?hFmt(ist):'–'}</td>
      ${isFree?'':`<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right;color:${diffColor};font-weight:700">${diffStr}</td>`}
      ${isFree?'':`<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right">${vac>0?vac+'&thinsp;T':'–'}</td>`}
      ${isFree?'':`<td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:right">${sick>0?sick+'&thinsp;T':'–'}</td>`}
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);text-align:center;color:${stColor};font-size:11px;font-weight:600">${stLabel}</td>
    </tr>`;
  }).join('');

  const totalIST=Array.from({length:12},(_,i)=>monthIST(d.entries[entryKey(uid,y,i+1)]||{},user)).reduce((a,b)=>a+b,0);
  const totalSOLL=isFree?0:Array.from({length:12},(_,i)=>monthSOLL(user,y,i+1)).reduce((a,b)=>a+b,0);
  const totalVac=Array.from({length:12},(_,i)=>vacDays(d.entries[entryKey(uid,y,i+1)]||{})).reduce((a,b)=>a+b,0);
  const totalSick=Array.from({length:12},(_,i)=>sickDays(d.entries[entryKey(uid,y,i+1)]||{})).reduce((a,b)=>a+b,0);
  const totalDiff=isFree?0:totalIST-totalSOLL;
  const totalDiffColor=totalDiff>=0?'var(--ok)':'var(--danger)';
  const totalDiffStr=isFree?'–':((totalDiff>=0?'+':'')+hFmt(Math.abs(totalDiff)));

  const headerCols=isFree
    ?`<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">IST</th>`
    :`<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">SOLL</th>
     <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">IST</th>
     <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">± Stunden</th>
     <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">Urlaub</th>
     <th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--primary)">Krank</th>`;

  const footerCols=isFree
    ?`<td style="padding:8px 10px;text-align:right;font-weight:700">${hFmt(totalIST)}</td>`
    :`<td style="padding:8px 10px;text-align:right;font-weight:700">${hFmt(totalSOLL)}</td>
     <td style="padding:8px 10px;text-align:right;font-weight:700">${hFmt(totalIST)}</td>
     <td style="padding:8px 10px;text-align:right;font-weight:700;color:${totalDiffColor}">${totalDiffStr}</td>
     <td style="padding:8px 10px;text-align:right;font-weight:700">${totalVac>0?totalVac+'&thinsp;T':'–'}</td>
     <td style="padding:8px 10px;text-align:right;font-weight:700">${totalSick>0?totalSick+'&thinsp;T':'–'}</td>`;

  const {yearMap,allCats}=buildZuordPivot(uid,y);
  const MO=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  let zuordSection='';
  if(allCats.length>0){
    const mHdr=MO.map(a=>`<th style="padding:5px 6px;text-align:right;font-size:10px;min-width:38px">${a}</th>`).join('');
    const catRows=allCats.map(cat=>{
      const rowTotal=Object.values(yearMap[cat]).reduce((a,v)=>a+v,0);
      const cells=Array.from({length:12},(_,i)=>{
        const min=yearMap[cat][i+1]||0;
        return `<td style="padding:5px 6px;text-align:right;font-size:11px;color:${min>0?'var(--text)':'var(--border)'}">${min>0?minFmt(min):'–'}</td>`;
      }).join('');
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:5px 8px;font-size:11px;font-weight:600;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(cat)}</td>
        ${cells}
        <td style="padding:5px 8px;text-align:right;font-size:11px;font-weight:700;color:var(--primary);white-space:nowrap">${minFmt(rowTotal)}</td>
      </tr>`;
    }).join('');
    const totalCells=Array.from({length:12},(_,i)=>{
      const s=allCats.reduce((a,cat)=>a+(yearMap[cat][i+1]||0),0);
      return `<td style="padding:5px 6px;text-align:right;font-size:11px;font-weight:700">${s>0?minFmt(s):'–'}</td>`;
    }).join('');
    const grand=allCats.reduce((a,cat)=>a+Object.values(yearMap[cat]).reduce((x,v)=>x+v,0),0);
    zuordSection=`
      <h4 style="margin:22px 0 10px;font-size:13px;font-weight:700;color:var(--primary);border-top:1px solid var(--border);padding-top:16px">Stunden nach Zuordnung</h4>
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:var(--primary);color:#fff">
          <th style="padding:5px 8px;text-align:left;font-size:10px;min-width:110px">Kategorie</th>
          ${mHdr}
          <th style="padding:5px 8px;text-align:right;font-size:10px">Gesamt</th>
        </tr></thead>
        <tbody>${catRows}</tbody>
        <tfoot><tr style="background:#1a3a5c;color:#fff">
          <td style="padding:5px 8px;font-size:11px;font-weight:700">Gesamt</td>
          ${totalCells}
          <td style="padding:5px 8px;text-align:right;font-size:11px;font-weight:700">${minFmt(grand)}</td>
        </tr></tfoot>
      </table>
      </div>`;
  }

  openModal(`
    <h3 style="margin-bottom:4px">Jahresübersicht ${y}</h3>
    <div style="font-size:13px;color:var(--muted);margin-bottom:18px">${esc(user.name)} · ${isFree?'Freiberuflich':(user.wh||0)+' h/Woche'}</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:var(--primary);color:#fff">
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid var(--primary)">Monat</th>
        ${headerCols}
        <th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--primary)">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="background:var(--row-alt);font-size:13px">
        <td style="padding:8px 10px;font-weight:700;border-top:2px solid var(--border)">Gesamt</td>
        ${footerCols}
        <td style="border-top:2px solid var(--border)"></td>
      </tr></tfoot>
    </table>
    </div>
    ${zuordSection}
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Schließen</button>
      ${canSendGF?`<button class="btn btn-ok" onclick="sendJahresbericht('${uid}',${y})" style="width:auto" title="Jahresmappe an Geschäftsführung senden">📨 An GF senden</button>`:''}
      <button class="btn btn-primary" onclick="printJahresübersicht('${uid}',${y})" style="width:auto">⬇ PDF herunterladen</button>
    </div>
  `,true);
}

export function printJahresübersicht(uid,y){
  const d=getData();
  const user=getUser(uid);
  if(!user) return;
  const isFree=isFreelancer(user);

  const rows=MONTHS.map((mn,i)=>{
    const m=i+1;
    const entry=d.entries[entryKey(uid,y,m)]||{};
    const ist=monthIST(entry,user);
    const soll=isFree?0:monthSOLL(user,y,m);
    const carry=getEffectiveCarryH(uid,user,y,m);
    const diff=isFree?0:(ist-(soll-Math.round(carry*60)));
    const vac=vacDays(entry);
    const sick=sickDays(entry);
    const st=entry.status||'draft';
    const stLabel={draft:'Entwurf',submitted:'Eingereicht',approved:'Genehmigt',rejected:'Abgelehnt'}[st]||st;
    const diffStr=isFree?'–':((diff>=0?'+':'')+hFmt(Math.abs(diff)));
    const diffColor=diff>=0?'#27ae60':'#c0392b';
    return `<tr>
      <td>${mn}</td>
      ${isFree?'':`<td class="r">${soll>0?hFmt(soll):'–'}</td>`}
      <td class="r">${ist>0?hFmt(ist):'–'}</td>
      ${isFree?'':`<td class="r" style="color:${diffColor};font-weight:700">${diffStr}</td><td class="r">${vac>0?vac+' T':'–'}</td><td class="r">${sick>0?sick+' T':'–'}</td>`}
      <td class="c">${stLabel}</td>
    </tr>`;
  }).join('');

  const totalIST=Array.from({length:12},(_,i)=>monthIST(d.entries[entryKey(uid,y,i+1)]||{},user)).reduce((a,b)=>a+b,0);
  const totalSOLL=isFree?0:Array.from({length:12},(_,i)=>monthSOLL(user,y,i+1)).reduce((a,b)=>a+b,0);
  const totalVac=Array.from({length:12},(_,i)=>vacDays(d.entries[entryKey(uid,y,i+1)]||{})).reduce((a,b)=>a+b,0);
  const totalSick=Array.from({length:12},(_,i)=>sickDays(d.entries[entryKey(uid,y,i+1)]||{})).reduce((a,b)=>a+b,0);
  const totalDiff=isFree?0:totalIST-totalSOLL;
  const totalDiffStr=isFree?'–':((totalDiff>=0?'+':'')+hFmt(Math.abs(totalDiff)));

  const hdr=isFree
    ?'<th class="r">IST</th>'
    :'<th class="r">SOLL</th><th class="r">IST</th><th class="r">± Std.</th><th class="r">Urlaub</th><th class="r">Krank</th>';
  const foot=isFree
    ?`<td class="r">${hFmt(totalIST)}</td>`
    :`<td class="r">${hFmt(totalSOLL)}</td><td class="r">${hFmt(totalIST)}</td><td class="r">${totalDiffStr}</td><td class="r">${totalVac>0?totalVac+' T':'–'}</td><td class="r">${totalSick>0?totalSick+' T':'–'}</td>`;

  const {yearMap:pYearMap,allCats:pAllCats}=buildZuordPivot(uid,y);
  const pMO=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  let pZuordTable='';
  if(pAllCats.length>0){
    const pMHdr=pMO.map(a=>`<th class="r" style="font-size:8px">${a}</th>`).join('');
    const pCatRows=pAllCats.map(cat=>{
      const rowTotal=Object.values(pYearMap[cat]).reduce((a,v)=>a+v,0);
      const cells=Array.from({length:12},(_,i)=>{
        const min=pYearMap[cat][i+1]||0;
        return `<td class="r" style="color:${min>0?'inherit':'#ccc'}">${min>0?minFmt(min):'–'}</td>`;
      }).join('');
      return `<tr><td class="l" style="font-weight:600;max-width:120px;overflow:hidden">${esc(cat)}</td>${cells}<td class="r" style="font-weight:700">${minFmt(rowTotal)}</td></tr>`;
    }).join('');
    const pTotalCells=Array.from({length:12},(_,i)=>{
      const s=pAllCats.reduce((a,cat)=>a+(pYearMap[cat][i+1]||0),0);
      return `<td class="r">${s>0?minFmt(s):'–'}</td>`;
    }).join('');
    const pGrand=pAllCats.reduce((a,cat)=>a+Object.values(pYearMap[cat]).reduce((x,v)=>x+v,0),0);
    pZuordTable=`
      <div class="cover-section-title">Stunden nach Zuordnung</div>
      <table>
        <thead><tr><th class="l">Kategorie</th>${pMHdr}<th class="r">Gesamt</th></tr></thead>
        <tbody>${pCatRows}</tbody>
        <tfoot><tr><td class="l">Gesamt</td>${pTotalCells}<td class="r">${minFmt(pGrand)}</td></tr></tfoot>
      </table>`;
  }

  const coverPage=`
    <div class="cover-page">
      <div class="cover-hdr">
        <div>
          <div class="org">TURNING POINT Stiftung</div>
          <div class="org-sub">Jahresübersicht Zeiterfassung</div>
        </div>
        <div class="cover-right">
          <div class="year-big">${y}</div>
        </div>
      </div>
      <div class="emp-info">
        <div class="emp-name">${esc(user.name)}</div>
        <div class="emp-meta">${isFree?'Freiberuflich':(user.wh||0)+' h/Woche'} · ${esc(user.team||'–')} · erstellt ${new Date().toLocaleDateString('de-DE')}</div>
      </div>
      <table>
        <thead><tr><th class="l">Monat</th>${hdr}<th class="c">Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td class="l">Gesamt ${y}</td>${foot}<td></td></tr></tfoot>
      </table>
      ${pZuordTable}
    </div>`;

  const monthPages=MONTHS.map((mn,i)=>{
    const m=i+1;
    const entry=getEntry(uid,y,m);
    return `<div class="month-page">${window.renderBuchhaltungHTML?.(user,entry,y,m)||''}</div>`;
  }).join('');

  const style=(window._teamReportStyle?.()??'')
    +'.cover-page{max-width:940px;margin:0 auto;padding:20px 0 40px}'
    +'.cover-hdr{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:4px solid #1a3a5c;margin-bottom:20px}'
    +'.org{font-size:22px;font-weight:700;color:#1a3a5c}'
    +'.org-sub{font-size:12px;color:#7f8c8d;margin-top:3px}'
    +'.cover-right .year-big{font-size:48px;font-weight:700;color:#1a3a5c;opacity:.15;line-height:1}'
    +'.emp-info{margin-bottom:24px;padding:14px 18px;background:#f4f7fb;border:1px solid #dde1e7;border-radius:6px}'
    +'.emp-name{font-size:18px;font-weight:700;color:#1a3a5c;margin-bottom:4px}'
    +'.emp-meta{font-size:11px;color:#7f8c8d}'
    +'th.l{text-align:left;padding-left:8px}td.l{text-align:left;padding-left:8px}'
    +'th.r,td.r{text-align:right}th.c,td.c{text-align:center}'
    +'th{padding:8px 10px;font-size:11px}td{padding:7px 10px;font-size:12px}'
    +'tfoot td{background:#1a3a5c;color:#fff;font-weight:700;padding:8px 10px;font-size:12px}'
    +'.cover-section-title{font-size:13px;font-weight:700;color:#1a3a5c;margin:20px 0 8px;padding-top:16px;border-top:2px solid #dde1e7}'
    +'.month-page{max-width:940px;margin:0 auto}'
    +'.month-page .bh-page{padding-bottom:0}'
    +'.month-page .bh-hdr{padding-bottom:6px;margin-bottom:6px}'
    +'.month-page .bh-hdr-left .org{font-size:13px}'
    +'.month-page .bh-hdr-right .ttl{font-size:11px}'
    +'.month-page .bh-hdr-right .per{font-size:9px}'
    +'.month-page .bh-info{padding:5px 10px;margin-bottom:6px;gap:2px 16px}'
    +'.month-page .bh-ir{font-size:8.5px}'
    +'.month-page table th{padding:3px 2px!important;font-size:7.5px!important}'
    +'.month-page table td{padding:2px 2.5px!important;font-size:8px!important}'
    +'.month-page table td.ps{font-size:7px!important;padding:2px 1px!important}'
    +'.month-page .bh-sum{margin-top:5px;gap:4px}'
    +'.month-page .bh-sc{padding:4px 7px;min-width:80px}'
    +'.month-page .bh-sc .val{font-size:12px;margin:1px 0}'
    +'.month-page .bh-sc .lbl{font-size:6.5px}'
    +'.month-page .bh-sc .sub{font-size:7px}'
    +'.month-page .bh-sig{margin-top:8px;padding-top:8px;gap:12px}'
    +'.month-page .bh-sig-col h4{font-size:7.5px;margin-bottom:4px}'
    +'.month-page .bh-sig-line{min-height:32px}'
    +'.month-page .bh-dig-sig{font-size:9px}'
    +'@media print{'
    +'  @page{margin:0.9cm;size:A4 portrait}'
    +'  body{padding:0}'
    +'  .cover-page{page-break-after:always;page-break-inside:avoid}'
    +'  .month-page{page-break-after:always;page-break-inside:avoid}'
    +'  .month-page:last-child{page-break-after:avoid}'
    +'}';

  const printWin=window.open('','_blank','width=900,height=1000');
  if(!printWin){ toast('Popup blockiert – bitte Popup-Blocker deaktivieren.','err'); return; }
  printWin.document.write(`<!DOCTYPE html><html lang="de"><head>
    <meta charset="UTF-8">
    <title>Jahresmappe ${y} – ${esc(user.name)}</title>
    <style>${style}</style>
  </head><body>
    ${coverPage}
    ${monthPages}
    <script>window.onload=function(){window.print()}<\/script>
  </body></html>`);
  printWin.document.close();
}

export function sendJahresbericht(uid,y){
  const cu=window.cu;
  const user=getUser(uid);
  if(!user){ toast('Mitarbeiter nicht gefunden.','err'); return; }
  const rKey=uid+'_'+y;
  const existing=getData().yearReports?.[rKey];
  const confirmMsg=existing
    ?`Jahresbericht ${y} für ${user.name} wurde bereits am ${new Date(existing.submittedAt).toLocaleDateString('de-DE')} gesendet.\nNochmals senden und überschreiben?`
    :`Jahresmappe ${y} (Deckblatt + 12 Zeiterfassungen) für ${user.name} an die Geschäftsführung senden?`;
  if(!confirm(confirmMsg)) return;
  const report={
    id:rKey,
    userId:uid,
    userName:user.name,
    team:user.team||'',
    year:y,
    submittedAt:new Date().toISOString(),
    sentBy:cu.id,
    sentByName:cu.name,
    seenAt:null
  };
  mutate(d=>{ if(!d.yearReports) d.yearReports={}; d.yearReports[rKey]=report; });
  closeModal();
  toast(`Jahresbericht ${y} für ${user.name} an GF gesendet ✓`,'ok');
}

// ── Zeiterfassungs-Erinnerungen ────────────────────────────────────
export function sendTimesheetReminders(){
  const cu=window.cu;
  if(!cu||(cu.role!=='admin'&&cu.role!=='leitung')) return;

  if(!EMAILJS_REMINDER_TEMPLATE_ID){
    openModal(`<h3>⚙ Template fehlt</h3>
      <p style="font-size:13px;color:var(--muted);margin:12px 0">
        Bitte zuerst in EmailJS ein Erinnerungs-Template erstellen und die ID in
        <code>js/config.js</code> bei <code>EMAILJS_REMINDER_TEMPLATE_ID</code> eintragen.
      </p>
      <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>`);
    return;
  }

  const d=getData();
  const now=new Date();

  // Letzte 6 Monate als Auswahl
  const months=[];
  for(let i=1;i<=6;i++){
    let m=now.getMonth()+1-i; // 1-indexed
    let y=now.getFullYear();
    if(m<=0){m+=12;y--;}
    months.push({y,m,label:MONTHS[m-1]+' '+y});
  }

  // Nur Mitarbeitende, für die der/die Eingeloggte verantwortlich ist:
  // Leitung → ausschließlich eigenes Team; Admin → alle (außer Admin/GF).
  const _isReminderTarget = (cu.role==='admin')
    ? (u=>u.role!=='admin'&&u.role!=='geschaeftsfuehrer')
    : (u=>!isManagerRole(u)&&canSeeEmployee(cu,u));
  const getPending=(y,m)=>{
    const withMail=[], noMail=[];
    d.users.forEach(u=>{
      if(!_isReminderTarget(u)) return;
      const st=(d.entries[entryKey(u.id,y,m)]||{}).status||'draft';
      if(st==='submitted'||st==='approved') return;
      if(u.email) withMail.push(u);
      else noMail.push(u);
    });
    return {withMail,noMail};
  };

  const buildPreview=(y,m)=>{
    const {withMail,noMail}=getPending(y,m);
    if(!withMail.length&&!noMail.length)
      return `<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:12px;font-size:13px;color:#155724">
        ✅ Alle Mitarbeiter haben für ${MONTHS[m-1]} ${y} bereits eingereicht.
      </div>`;
    const rows=withMail.map(u=>`
      <label style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" class="rem-pick" value="${esc(u.id)}" checked style="width:16px;height:16px;flex:0 0 auto">
        <span style="flex:1;font-size:13px;font-weight:600">${esc(u.name)}</span>
        <span style="font-size:12px;color:var(--muted)">${esc(u.email)}</span>
      </label>`).join('');
    const noMailNote=noMail.length
      ?`<div style="margin-top:8px;padding:8px 10px;background:#fff3cd;border-radius:6px;font-size:12px;color:#856404">
          ⚠ Keine E-Mail hinterlegt (werden übersprungen): ${noMail.map(u=>esc(u.name)).join(', ')}
        </div>`:'';
    const head=withMail.length
      ?`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:700;color:var(--primary)">Empfänger auswählen (${withMail.length})</span>
          <label style="font-size:12px;color:var(--muted);cursor:pointer"><input type="checkbox" id="rem-all" checked onchange="_remToggleAll(this.checked)" style="vertical-align:middle;margin-right:4px">Alle</label>
        </div>`:'';
    return `${head}
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:0 10px">
        ${rows||'<div style="padding:8px;font-size:13px;color:var(--muted)">Keine Empfänger mit hinterlegter E-Mail.</div>'}
      </div>${noMailNote}`;
  };

  // Funktionen auf window für inline onchange/onclick
  window._remMonths=months;
  window._remPreview=()=>{
    const idx=parseInt(document.getElementById('rem-mon-sel').value);
    const mo=months[idx];
    document.getElementById('rem-preview').innerHTML=buildPreview(mo.y,mo.m);
  };
  window._remToggleAll=(on)=>{ document.querySelectorAll('.rem-pick').forEach(cb=>{ cb.checked=on; }); };
  window._remSend=async()=>{
    const idx=parseInt(document.getElementById('rem-mon-sel').value);
    const mo=months[idx];
    const {withMail}=getPending(mo.y,mo.m);
    const picked=new Set(Array.from(document.querySelectorAll('.rem-pick:checked')).map(cb=>cb.value));
    const recipients=withMail.filter(u=>picked.has(u.id));
    if(!recipients.length){ toast('Bitte mindestens einen Mitarbeiter auswählen.','err'); return; }
    document.getElementById('rem-btns').innerHTML=
      '<div style="font-size:13px;color:var(--muted)">⏳ Wird gesendet…</div>';
    const moLabel=MONTHS[mo.m-1]+' '+mo.y;
    let sent=0,failed=0;
    for(const u of recipients){
      try{
        await emailjs.send(EMAILJS_SERVICE_ID,EMAILJS_REMINDER_TEMPLATE_ID,
          {to_email:u.email,to_name:u.name,email:u.email,monat:moLabel,app_url:APP_URL},
          {publicKey:EMAILJS_PUBLIC_KEY});
        sent++;
      }catch(e){ console.error('Reminder failed:',u.name,e); failed++; }
    }
    document.getElementById('rem-btns').innerHTML=
      `<div style="background:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:12px;font-size:13px;color:#155724;width:100%">
        ✅ ${sent} Erinnerung${sent!==1?'en':''} gesendet${failed?` · ⚠ ${failed} fehlgeschlagen`:''}
      </div>
      <div class="modal-btns" style="margin-top:12px">
        <button class="btn btn-primary" onclick="closeModal()">Schließen</button>
      </div>`;
  };

  const firstMo=months[0];
  const opts=months.map((mo,i)=>
    `<option value="${i}"${i===0?' selected':''}>${mo.label}</option>`).join('');

  openModal(`
    <h3>🔔 Erinnerungen senden</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      Mitarbeiter ohne Einreichung sind unten gelistet. Wähle aus, wer eine Erinnerungsmail erhalten soll.
    </p>
    <div class="form-group">
      <label>Monat</label>
      <select id="rem-mon-sel" onchange="_remPreview()"
              style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:14px">
        ${opts}
      </select>
    </div>
    <div id="rem-preview" style="margin:12px 0">${buildPreview(firstMo.y,firstMo.m)}</div>
    <div id="rem-btns" class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="_remSend()">🔔 Erinnerungen senden</button>
    </div>
  `);
}
