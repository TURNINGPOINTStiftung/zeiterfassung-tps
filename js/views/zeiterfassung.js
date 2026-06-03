import { MONTHS } from '../config.js';
import { getEntry, getUser, getData, setDay, setEntryField, mutate, entryKey } from '../data.js';
import { isManagerRole, isFreelancer, isBerater, getLeitungTeams, hasPermission } from '../roles.js';
import { diffMin, addMin, daysInMonth, dateStr, isWeekend, isToday, isoWeek, dayName, getHolidays, hFmt, minFmt, dayFmt, esc, toast } from '../utils.js';
import { catOptionsForUser, getCatsForTeam } from '../cats.js';
import { dailyMinutes, monthSOLL, monthSOLLdays, getEffectiveCarryH, vacDays, sickDays, totalVacUsed, vacUsedUpToMonth, zuordBreakdown, monthIST, autoPauseMin } from '../calc.js';
import { fmtTs } from '../utils.js';

// v2026-06-fix
export function renderZeiterfassung(){
  const uid=window.viewEmpId||window.cu.id;
  const user=getUser(uid);
  if(!user){ document.getElementById('zt-body').innerHTML='<tr><td colspan="18" style="padding:20px;text-align:center;color:var(--muted)">Kein Mitarbeiter ausgewählt.</td></tr>'; return; }

  const year=window.year, mon=window.mon, cu=window.cu;
  const entry=getEntry(uid,year,mon);
  const isLeiter=isManagerRole(cu);

  // Werkstudenten: 20h/Woche-Grenze prüfen
  const _wsLimit=20*60; // 1200 Minuten
  const isWerkstudent=(()=>{
    const crs=getData().customRoles||[];
    const ids=Array.isArray(user.customRoles)?user.customRoles:(user.customRole?[user.customRole]:[]);
    return ids.some(cid=>{const cr=crs.find(r=>r.id===cid);return cr&&cr.label.toLowerCase().includes('werkstudent');});
  })();

  // "An GF senden"-Button nur für Leitung sichtbar halten
  const _btnTeam=document.getElementById('btn-teamberichte');
  if(_btnTeam) _btnTeam.style.display=hasPermission('btn_teamberichte',cu.role)?'':'none';
  const isFree=isFreelancer(user);
  const canEdit=(cu.id===uid&&entry.status==='draft')||
                (isLeiter&&(entry.status==='submitted'||entry.status==='draft'));
  const readonly=!canEdit;

  const viewingOther=cu&&uid!==cu.id&&isManagerRole(cu);
  const banner=document.getElementById('viewing-other-banner');
  if(banner){
    banner.style.display=viewingOther?'inline-flex':'none';
    if(viewingOther){ const n=document.getElementById('viewing-other-name'); if(n) n.textContent=user.name; }
  }

  document.getElementById('month-title').innerHTML=`${MONTHS[mon-1]} <span onclick="openJahresübersicht('${uid}',${year})" title="Jahresübersicht ${year} öffnen" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${year}</span>`;
  document.getElementById('info-name').textContent=user.name;
  document.getElementById('info-team').textContent=user.role==='leitung'?(getLeitungTeams(user).join(', ')||'–'):(user.team||'–');
  document.getElementById('info-city').textContent=user.city||'–';
  document.getElementById('info-type').textContent=isFree?'Freiberuflich':'Festangestellt';
  document.getElementById('info-wh').textContent=isFree?'flexibel':`${user.wh} h`;
  document.getElementById('info-al').textContent=isFree?'–':`${user.al} Tage`;
  document.getElementById('info-apd').textContent=isFree?'–':hFmt(dailyMinutes(user));
  document.getElementById('info-al-wrap').style.display=isFree?'none':'';
  document.getElementById('info-apd-wrap').style.display=isFree?'none':'';

  const badges={draft:'Entwurf',submitted:'Eingereicht',approved:'Genehmigt',rejected:'Abgelehnt'};
  const bCls={draft:'s-draft',submitted:'s-submitted',approved:'s-approved',rejected:'s-rejected'};
  const badgeEl=document.getElementById('month-status-badge');
  badgeEl.textContent=badges[entry.status]||'Entwurf';
  badgeEl.className='status-badge '+(bCls[entry.status]||'s-draft');

  const tbody=document.getElementById('zt-body');
  tbody.innerHTML='';
  const dim=daysInMonth(year,mon);
  const hols=getHolidays(year,user.bundesland||'');
  let monthTotal=0, monthPause=0;

  // Werkstudenten: Wochensummen vorberechnen
  // weekMins = aktueller Monat (für Zeilenmarkierung)
  // weekMinsYTD = Januar bis aktueller Monat (für Jahres-Counter)
  const weekMins={};
  const weekMinsYTD={};
  if(isWerkstudent){
    const _addDay=(target,kw,dd)=>{
      const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
      const pause=autoPauseMin(dd,user);
      target[kw]=(target[kw]||0)+Math.min(Math.max(0,Math.round((gross-pause)/15)*15),600);
    };
    // Aktueller Monat
    for(let d=1;d<=dim;d++){
      const kw=isoWeek(new Date(year,mon-1,d));
      _addDay(weekMins,kw,(entry.days||{})[dateStr(year,mon,d)]||{});
    }
    // Jahr bis aktuellem Monat (für Counter)
    for(let m=1;m<=mon;m++){
      const e=m===mon?entry:getEntry(uid,year,m);
      const dim2=daysInMonth(year,m);
      for(let d=1;d<=dim2;d++){
        const kw=isoWeek(new Date(year,m-1,d));
        _addDay(weekMinsYTD,kw,(e.days||{})[dateStr(year,m,d)]||{});
      }
    }
  }
  const overWeeks=new Set(Object.entries(weekMins).filter(([,v])=>v>_wsLimit).map(([k])=>Number(k)));
  const overWeeksYTD=Object.values(weekMinsYTD).filter(v=>v>_wsLimit).length;

  for(let d=1;d<=dim;d++){
    const ds=dateStr(year,mon,d);
    const dd=(entry.days||{})[ds]||{};
    const we=isWeekend(year,mon,d);
    const hol=hols.has(ds);
    const tod=isToday(year,mon,d);
    const kw=isoWeek(new Date(year,mon-1,d));
    const dn=dayName(year,mon,d);
    const b1min=diffMin(dd.b1von||'',dd.b1bis||'');
    const b2min=diffMin(dd.b2von||'',dd.b2bis||'');
    const ktm=Number(dd.ktmin||0);
    const dayMinGross=b1min+b2min+ktm;
    const hasB2Work=!!(dd.b2von&&dd.b2bis);
    const isAbsDay=dd.b1zuord==='Urlaub'||dd.b1zuord==='AU/Krank'||dd.b1zuord==='Arbeitszeitausgleich'
      ||dd.b1bem==='Urlaub'||dd.b1bem==='AU/Krank'||dd.b1bem==='Arbeitszeitausgleich';
    // Pflicht-Pause minus bereits genommene Lücke (Freiberufler: keine Pause)
    const pauseMinAuto=(isAbsDay||isFree)?0:autoPauseMin(dd,user);
    const dayMin=Math.max(0,dayMinGross-pauseMinAuto);
    monthPause+=pauseMinAuto;
    const roundedDayMin=dayMin>0?(isAbsDay?dayMin:Math.round(dayMin/15)*15):0;
    const effDayMin=Math.min(roundedDayMin,600);
    monthTotal+=effDayMin;

    const tr=document.createElement('tr');
    if(we) tr.classList.add('weekend');
    if(hol) tr.classList.add('holiday');
    if(tod) tr.classList.add('today-row');
    if(readonly) tr.classList.add('readonly');
    if(isWerkstudent&&overWeeks.has(kw)) tr.classList.add('wstd-over');
    const dis=readonly;
    const dateFmt=`${String(d).padStart(2,'0')}.${String(mon).padStart(2,'0')}.${String(year).slice(2)}`;
    tr.innerHTML=`
      <td class="date-c">${dateFmt}${hol?'<span style="font-size:8px;display:block;color:var(--danger);font-weight:400">Feiertag</span>':''}</td>
      <td class="kw-c">${kw}</td>
      <td class="day-c${we?' we':''}">${dn}${we?'<span style="font-size:9px;display:block;color:var(--warn)">WE</span>':''}</td>
      <td><input type="text" id="ti_${ds}_b1von" class="t-inp zt-nav" maxlength="5" value="${dd.b1von||''}" ${dis?'disabled':''} oninput="fmtTimeIn(this)" onkeydown="ztNav(event,this)" onchange="td_tchange('${ds}','b1von',this.value)"></td>
      <td><input type="text" id="ti_${ds}_b1bis" class="t-inp zt-nav" maxlength="5" value="${dd.b1bis||''}" ${dis?'disabled':''} oninput="fmtTimeIn(this)" onkeydown="ztNav(event,this)" onchange="td_b1bis_change('${ds}',this.value)"></td>
      <td><select id="sel_${ds}_b1zuord" class="zuord zt-nav" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_zuord('${ds}','b1zuord',this.value,${user.wh||0},${user.dpw||5})">${catOptionsForUser(user,dd.b1zuord||'')}</select></td>
      <td class="bem-col"><input id="bem_${ds}_b1" class="bem zt-nav" type="text" value="${esc(dd.b1bem||'')}" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_change('${ds}','b1bem',this.value)" placeholder="–"></td>
      <td class="sum-c sum-col">${b1min>0?minFmt(b1min):''}</td>
      <td class="sep-c sep-col"></td>
      <td class="b2-col"><input type="text" id="ti_${ds}_b2von" class="t-inp zt-nav" maxlength="5" value="${dd.b2von||''}" ${dis?'disabled':''} oninput="fmtTimeIn(this)" onkeydown="ztNav(event,this)" onchange="td_tchange('${ds}','b2von',this.value)"></td>
      <td class="b2-col"><input type="text" id="ti_${ds}_b2bis" class="t-inp zt-nav" maxlength="5" value="${dd.b2bis||''}" ${dis?'disabled':''} oninput="fmtTimeIn(this)" onkeydown="ztNav(event,this)" onchange="td_tchange('${ds}','b2bis',this.value)"></td>
      <td class="b2-col"><select id="sel_${ds}_b2zuord" class="zuord zt-nav" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_change('${ds}','b2zuord',this.value)">${catOptionsForUser(user,dd.b2zuord||'')}</select></td>
      <td class="bem-col b2-col"><input id="bem_${ds}_b2" class="bem zt-nav" type="text" value="${esc(dd.b2bem||'')}" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_change('${ds}','b2bem',this.value)" placeholder="–"></td>
      <td class="sum-c b2-col sum-col">${b2min>0?minFmt(b2min):''}</td>
      <td class="kt-col"><input id="kt_${ds}" class="kt-min zt-nav" type="number" min="0" max="240" step="15" value="${dd.ktmin||''}" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_change('${ds}','ktmin',this.value)" placeholder="0"></td>
      <td class="sum-c kt-col">${ktm>0?minFmt(ktm):''}</td>
      <td class="pause-c pause-col">${pauseMinAuto>0?minFmt(pauseMinAuto):''}</td>
      <td class="total-c">${effDayMin>0?hFmt(effDayMin):''}</td>
    `;
    tbody.appendChild(tr);
  }

  const _tDays=dayFmt(monthTotal);
  document.getElementById('tfoot-total').innerHTML=hFmt(monthTotal)+(_tDays?`<br><small style="font-size:10px;font-weight:400;opacity:.75">${_tDays}</small>`:'');
  const _tp=document.getElementById('tfoot-pause');
  if(_tp) _tp.innerHTML=monthPause>0?minFmt(monthPause):'';
  document.getElementById('zt').classList.toggle('no-b2-kt',isFree);
  renderSummary(uid,user,entry,monthTotal,isWerkstudent?overWeeksYTD:0);
  renderZuordBreakdown(entry);
  renderActionBar(uid,user,entry,isLeiter);
  renderReviewPanel(uid,entry,isLeiter);
  renderSignature(user,entry);
}

function renderSummary(uid,user,entry,istMin,wsOverWeeks=0){
  const year=window.year, mon=window.mon;
  const isFree=isFreelancer(user);
  const carryH=getEffectiveCarryH(uid,user,year,mon);
  let cards=[];
  if(isFree){
    const maxH=user.maxHours||0;
    if(maxH>0){
      const totalMin=istMin+carryH*60;
      const billedMin=Math.min(totalMin,maxH*60);
      const overflowMin=Math.max(0,totalMin-maxH*60);
      const underMin=Math.max(0,maxH*60-totalMin);
      const maxDays=maxH/8;
      const billedDayStr=dayFmt(billedMin);
      const istDayStr=dayFmt(istMin);
      const overDayStr=overflowMin>0?dayFmt(overflowMin):'';
      cards=[
        {lbl:'Geleistete Stunden',big:hFmt(istMin),sub:istDayStr?('= '+istDayStr+' (8h=1T)'):'tatsächlich geleistet'},
        {lbl:'Stundenübertrag Vormonat',big:(carryH>0?'+':'')+hFmt(carryH*60),sub:entry.carryoverManual?'manuell gesetzt':'automatisch berechnet'},
        {lbl:'Verfügbar gesamt',big:hFmt(totalMin),sub:'Leistung + Übertrag = '+dayFmt(totalMin)},
        {lbl:'Abgerechnet (Limit '+maxH+' h / '+maxDays+' T)',big:hFmt(billedMin),sub:billedDayStr?('= '+billedDayStr+' – max. Limit'):'max. Monatslimit',cls:billedMin>=maxH*60?'neg':'pos'},
        {lbl:'Übertrag → nächster Monat',big:overflowMin>0?('+'+hFmt(overflowMin)):'–',sub:overDayStr?('= +'+overDayStr+' werden vorgetragen'):overflowMin>0?'wird vorgetragen':underMin>0?'unter Limit – kein Minus':'exakt auf Limit',cls:overflowMin>0?'pos':''},
      ];
    } else {
      cards=[
        {lbl:'IST-Stunden Monat',big:hFmt(istMin),sub:'tatsächlich geleistet'},
        {lbl:'Stundenübertrag Vormonat',big:(carryH>0?'+':'')+hFmt(carryH*60),sub:entry.carryoverManual?'manuell gesetzt':'automatisch'},
      ];
      const yearTotal=Array.from({length:12},(_,i)=>monthIST(getEntry(uid,year,i+1),user)).reduce((a,b)=>a+b,0);
      cards.push({lbl:`IST-Gesamt ${year}`,big:hFmt(yearTotal),sub:'alle Monate zusammen'});
    }
  } else {
    const soll=monthSOLL(user,year,mon);
    const diff=istMin-(soll-(carryH)*60);
    const vd=vacDays(entry);
    const sk=sickDays(entry);
    const vacUpTo=vacUsedUpToMonth(uid,year,mon);   // bis einschl. aktuellem Monat
    const vacApproved=totalVacUsed(uid,year);       // ganzes Jahr (inkl. Zukunft)
    const vacLeft=user.al-vacUpTo;                  // Resturlaub bis hierher
    const vacFuture=Math.max(0,vacApproved-vacUpTo);// schon beantragt/genehmigt (später)
    const sollDays=monthSOLLdays(user,year,mon);
    const sollSub=sollDays>0?`${sollDays} AT × ${hFmt(Math.round((user.wh||0)/5*60))}`:'4 × Wochenarbeitszeit';
    cards=[
      {lbl:'SOLL-Stunden',big:hFmt(soll),sub:sollSub},
      {lbl:'IST-Stunden',big:hFmt(istMin),sub:'tatsächlich geleistet'},
      {lbl:'Mehr / Minderstunden',big:(diff>=0?'+':'')+hFmt(Math.abs(diff)),sub:'Übertrag: '+(carryH>=0?'+':'')+carryH+' h',cls:diff>=0?'pos':'neg'},
      {lbl:'Urlaub genutzt',big:vd+' T',sub:`diesen Monat`},
      {lbl:'Resturlaub',big:vacLeft+' T',sub:`${vacUpTo} von ${user.al}`},
      {lbl:'AU / Krank',big:sk+' T',sub:hFmt(sk*dailyMinutes(user))+' h anteilig'},
    ];
  }
  let cardsHtml=cards.map(c=>`
    <div class="s-card">
      <div class="lbl">${c.lbl}</div>
      <div class="big${c.cls?' '+c.cls:''}">${c.big}</div>
      <div class="sub">${c.sub||''}</div>
    </div>`).join('');
  if(wsOverWeeks>0){
    cardsHtml+=`<div class="s-card" style="border:2px solid var(--danger)">
      <div class="lbl">⚠ Werkstudent 20h-Grenze</div>
      <div class="big neg">${wsOverWeeks} Woche${wsOverWeeks!==1?'n':''}</div>
      <div class="sub">Jan–${MONTHS[mon-1].slice(0,3)} über 20h/Woche</div>
    </div>`;
  }
  document.getElementById('summary-cards').innerHTML=cardsHtml;
  document.getElementById('carryover-input').value=carryH;
  const _dw=document.getElementById('info-diff-wrap');
  const _de=document.getElementById('info-diff');
  if(_de&&!isFree){
    const _s=monthSOLL(user,year,mon);
    const _c=getEffectiveCarryH(uid,user,year,mon);
    const _d=istMin-(_s-_c*60);
    _de.textContent=(_d>=0?'+':'')+hFmt(Math.abs(_d));
    _de.className='val '+(_d>=0?'pos':'neg');
    if(_dw) _dw.style.display='';
  } else {
    if(_dw) _dw.style.display='none';
  }
}

function renderZuordBreakdown(entry){
  const map=zuordBreakdown(entry);
  const total=Object.values(map).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const tbody=document.querySelector('#zuord-table tbody');
  if(sorted.length===0){ tbody.innerHTML='<tr><td colspan="3" style="color:var(--muted);text-align:center">Noch keine Einträge</td></tr>'; return; }
  tbody.innerHTML=sorted.map(([cat,min])=>{
    const pct=Math.round(min/total*100);
    return `<tr><td>${cat}</td><td style="text-align:right;font-weight:600">${hFmt(min)}</td><td style="padding:5px 8px"><div class="zuord-bar" style="width:${pct}%"></div></td></tr>`;
  }).join('');
}

function renderActionBar(uid,user,entry,isLeiter){
  const year=window.year, mon=window.mon, cu=window.cu;
  const bar=document.getElementById('action-bar');
  const info=document.getElementById('action-info');
  const btns=document.getElementById('action-btns');
  const cw=document.getElementById('carryover-wrap');
  bar.style.display='flex'; info.textContent=''; btns.innerHTML='';
  const isFree=isFreelancer(user);
  const showCarry=!isFree||(user.maxHours||0)>0;
  cw.style.display=showCarry?'flex':'none';
  if(showCarry){
    const effCarry=getEffectiveCarryH(uid,user,year,mon);
    const isManual=!!entry.carryoverManual;
    const lbl=document.getElementById('carryover-label');
    const lblText=isFree?'Stundenübertrag Vormonat (h):':'Übertrag Vormonat (h):';
    if(lbl) lbl.innerHTML=`${lblText} <span style="font-size:11px;font-weight:400;color:${isManual?'var(--warn)':'var(--ok)'}">${isManual?'manuell':'auto'}</span>`;
    const inp=document.getElementById('carryover-input');
    if(inp){ inp.value=effCarry; inp.min=isFree?0:-99; }
    const rst=document.getElementById('carryover-reset');
    if(rst) rst.style.display=isManual?'inline-flex':'none';
  }
  let extraBtns='';
  if(cu.role==='admin'&&cu.id!==uid){
    const un=user.name.toLowerCase();
    const hasHist=typeof window.HIST_IMPORT!=='undefined'&&window.HIST_IMPORT.some(rec=>{
      const rn=rec.n.toLowerCase();
      return rn===un||rn.split(' ').every(p=>un.includes(p))||un.split(' ').every(p=>rn.includes(p));
    });
    if(hasHist) extraBtns=`<button class="btn btn-outline btn-sm" onclick="importHistForUser('${uid}')" style="font-size:12px">📋 Hist. Daten laden (Jan–Apr 2026)</button>`;
  }
  if(isLeiter&&cu.role!=='admin'&&cu.id!==uid){ btns.innerHTML=extraBtns; return; }
  if(cu.id===uid||cu.role==='admin'){
    const isNoReport=cu.id===uid&&!!getUser(uid)?.noReport;
    if(entry.status==='draft'){
      info.textContent=cu.id===uid
        ?(isNoReport?'Zeiten erfassen – keine Einreichung erforderlich.':'Bitte alle Zeiten erfassen und den Monat am Monatsende einreichen.')
        :'Entwurf – Monat kann für diesen Mitarbeiter eingereicht werden.';
      btns.innerHTML=extraBtns+(isNoReport?'': `<button class="btn btn-warn" onclick="doSubmit()">📨 Monat einreichen</button>`);
    } else if(entry.status==='submitted'){
      info.textContent='Monat eingereicht – wartet auf Prüfung durch die Leitung.';
      btns.innerHTML=extraBtns+`<button class="btn btn-outline" onclick="doRecall()">↩ Zurückziehen</button>`;
    } else if(entry.status==='approved'){
      info.textContent='✓ Dieser Monat wurde genehmigt.';
      btns.innerHTML=extraBtns;
    } else if(entry.status==='rejected'){
      info.textContent='✗ Abgelehnt – bitte korrigieren und erneut einreichen.'+(entry.managerNote?` Anmerkung: „${entry.managerNote}"`:'');
      btns.innerHTML=extraBtns+`<button class="btn btn-warn" onclick="doRecall()">Bearbeiten &amp; erneut einreichen</button>`;
    }
  } else {
    btns.innerHTML=extraBtns;
  }
}

function renderReviewPanel(uid,entry,isLeiter){
  const cu=window.cu;
  const panel=document.getElementById('review-panel');
  if(!isLeiter||cu.id===uid){ panel.style.display='none'; return; }
  const viewedUser=getUser(uid);
  if(isBerater(viewedUser)&&cu.role==='leitung'){ panel.style.display='none'; return; }
  if(entry.status==='draft'){ panel.style.display='none'; return; }
  panel.style.display='block';
  document.getElementById('review-note').value=entry.managerNote||'';
}

export function renderSignature(user,entry){
  const area=document.getElementById('sig-area');
  const city=user.city||'';
  const today=new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const ortDat=entry.submittedAt?`${city}${city?', ':''}${fmtTs(entry.submittedAt).split(' ')[0]}`:`${city}${city?', ':''}${today}`;
  let empSig='';
  if(entry.status==='submitted'||entry.status==='approved'||entry.status==='rejected'){
    empSig=`<div class="dig-sig">✍ Digital eingereicht<br>${user.name}<span class="ts">${fmtTs(entry.submittedAt)}</span></div>`;
  } else {
    empSig=`<span class="dig-sig"><span class="pending">Noch nicht eingereicht</span></span>`;
  }
  let mgSig='';
  if(entry.status==='approved'||entry.status==='rejected'){
    const reviewer=entry.reviewedBy?getUser(entry.reviewedBy):null;
    const rName=reviewer?reviewer.name:'Leitung';
    const action=entry.status==='approved'?'✓ Genehmigt':'✗ Abgelehnt';
    mgSig=`<div class="dig-sig">${action}<br>${rName}<span class="ts">${fmtTs(entry.reviewedAt)}</span>${entry.managerNote?`<span class="ts" style="color:var(--danger)">${entry.managerNote}</span>`:''}</div>`;
  } else {
    mgSig=`<span class="dig-sig"><span class="pending">Ausstehend</span></span>`;
  }
  area.innerHTML=`
    <div class="sig-block"><div class="lbl">Ort / Datum</div><div class="sig-line"><span style="font-size:12px;font-weight:600">${ortDat}</span></div></div>
    <div class="sig-block"><div class="lbl">Unterschrift Mitarbeiter/in</div><div class="sig-line">${empSig}</div></div>
    <div class="sig-block"><div class="lbl">Geprüft – Unterschrift Leitung</div><div class="sig-line">${mgSig}</div></div>`;
}

export function td_change(ds,field,val){
  const _fid=window._ztNextFocusId||document.activeElement?.id||null;
  window._ztNextFocusId=null;
  const uid=window.viewEmpId||window.cu.id;

  // Bemerkungsfelder beeinflussen keine Berechnung → nur speichern, KEIN Re-Render.
  // (Verhindert iOS-Cursor-Sprung/Datenverlust beim Tippen längerer Texte.)
  if(field==='b1bem'||field==='b2bem'){
    setDay(uid,window.year,window.mon,ds,field,val);
    return;
  }

  if(field==='ktmin'){
    // Wenn Kleinteilig geändert wird, b1bis-Abfahrtszeit neu berechnen
    // (Kleinteilig ändert Brutto → ändert auto-Pause → ändert Abfahrtszeit)
    const entry=getEntry(uid,window.year,window.mon);
    const day=(entry.days||{})[ds]||{};
    const b1von=day.b1von||''; const b1bis=day.b1bis||'';
    const hasB2=!!(day.b2von&&day.b2bis);
    if(b1von&&b1bis&&!hasB2&&!isFreelancer(getUser(uid))){
      const oldKtm=Number(day.ktmin||0);
      const newKtm=Number(val||0);
      const b2min=diffMin(day.b2von||'',day.b2bis||'');
      // Altes Netto = b1bis_departure − old_autoPause
      const oldGross=diffMin(b1von,b1bis)+b2min+oldKtm;
      const oldPause=oldGross>=540?45:oldGross>=360?30:0;
      const netB1=addMin(b1bis,-oldPause);
      // Neue Abfahrt basierend auf neuem Kleinteilig
      const netMin=diffMin(b1von,netB1);
      const tryGross=netMin+b2min+newKtm+30;
      const newPause=tryGross>=540?45:tryGross>=360?30:0;
      const newDep=addMin(netB1,newPause);
      setDay(uid,window.year,window.mon,ds,'b1bis',newDep);
    }
  }
  setDay(uid,window.year,window.mon,ds,field,val);
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

export function td_zuord(ds,field,val,wh,dpw){
  const _fid=window._ztNextFocusId||document.activeElement?.id||null;
  window._ztNextFocusId=null;
  const uid=window.viewEmpId||window.cu.id;
  const cu=window.cu;
  setDay(uid,window.year,window.mon,ds,field,val);

  // „Sonstiges" → nur Bemerkung eintragen, keine Zeiteinträge
  if(val==='Sonstiges'){
    setDay(uid,window.year,window.mon,ds,'b1bem','Sonstiges');
    // Keine Zeitfelder setzen
  }

  // Urlaub / AU/Krank → Zeiteinträge nur für Festangestellte (nicht Freiberufler)
  if((val==='Urlaub'||val==='AU/Krank')&&wh>0){
    const u=getUser(uid)||cu;
    const dailyMin=Math.round(wh*60/(dpw||5))||480;
    const dMin=val==='Urlaub'?((u?.vacHoursPerDay||Math.round(wh/(dpw||5))||8)*60):dailyMin;
    setDay(uid,window.year,window.mon,ds,'b1von','08:00');
    setDay(uid,window.year,window.mon,ds,'b1bis',addMin('08:00',dMin));
    setDay(uid,window.year,window.mon,ds,'b2von',''); setDay(uid,window.year,window.mon,ds,'b2bis','');
    setDay(uid,window.year,window.mon,ds,'ktmin','');
  }
  if(field==='b1zuord'){
    const u=getUser(uid)||cu;
    if(val==='AU/Krank'){
      mutate(d=>{
        if(!d.vacRequests) d.vacRequests={};
        const rk=`${uid}_${ds}_${ds}`;
        if(!d.vacRequests[rk])
          d.vacRequests[rk]={id:rk,userId:uid,userName:u.name,team:u.team||'',
            type:'AU/Krank',startDate:ds,endDate:ds,workDays:1,note:'',
            status:'approved',submittedAt:new Date().toISOString(),
            reviewedBy:cu.id,reviewedAt:new Date().toISOString(),
            reviewNote:'Automatisch aus Zeiterfassung'};
      });
    } else {
      mutate(d=>{
        const rk=`${uid}_${ds}_${ds}`;
        if(d.vacRequests&&d.vacRequests[rk]&&d.vacRequests[rk].type==='AU/Krank')
          delete d.vacRequests[rk];
      });
    }
  }
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

export function td_b1bis_change(ds,val){
  const _fid=window._ztNextFocusId||document.activeElement?.id||null;
  window._ztNextFocusId=null;
  const uid=window.viewEmpId||window.cu.id;

  // Wenn Endzeit heute manuell eingetragen → laufenden Stempel mit DIESER Zeit stoppen
  if(uid===window.cu?.id){
    const today=new Date().toISOString().slice(0,10);
    if(ds===today){
      const stamp=window.getStamp?.();
      if(stamp&&stamp.uid===uid&&stamp.startDate===today){
        clearTimeout(window._ztAutoStampTimer);
        const _normBis=_normTime(val); // eingegebene Endzeit als bis übergeben
        window.stopZeitstempel?.(_normBis);
        return; // stopZeitstempel übernimmt das Re-Render
      }
    }
  }

  const entry=getEntry(uid,window.year,window.mon);
  const day=(entry.days||{})[ds]||{};
  const normVal=_normTime(val);
  if(!normVal){
    setDay(uid,window.year,window.mon,ds,'b1bis','');
  } else {
    const von=day.b1von||'';
    const zuord=day.b1zuord||'';
    const isAbsence=zuord==='Urlaub'||zuord==='AU/Krank'||zuord==='Arbeitszeitausgleich';
    const hasB2=!!(day.b2von&&day.b2bis);
    // Eingabe = Netto-Ende → auf 15-Min. runden
    let roundedNet=normVal;
    if(von&&!isAbsence){
      const rawMin=diffMin(von,normVal);
      if(rawMin>0){ const r=Math.round(rawMin/15)*15; if(r!==rawMin&&r>0) roundedNet=addMin(von,r); }
    }
    // Auto-Pause nur addieren wenn kein B2-Block (Freiberufler: nie)
    let departure=roundedNet;
    if(!hasB2&&von&&!isAbsence&&!isFreelancer(getUser(uid))){
      const netMin=diffMin(von,roundedNet);
      const b2min=diffMin(day.b2von||'',day.b2bis||'');
      const ktm=Number(day.ktmin||0);
      const totalNet=netMin+b2min+ktm;
      const tryGross=totalNet+30;
      const autoPause=tryGross>=540?45:tryGross>=360?30:0;
      if(autoPause>0) departure=addMin(roundedNet,autoPause);
    }
    setDay(uid,window.year,window.mon,ds,'b1bis',departure);
  }
  check10hCarryover(uid,window.year,window.mon,ds);
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

function _normTime(val){
  if(!val) return '';
  const v=val.trim();
  let h,m;
  if(!v.includes(':')){
    // Numerische Kurzform: 8→08:00, 16→16:00, 800→08:00, 830→08:30, 1430→14:30
    const digits=v.replace(/[^0-9]/g,'');
    if(!digits) return '';
    if(digits.length<=2){ h=parseInt(digits,10); m=0; }
    else if(digits.length===3){ h=parseInt(digits[0],10); m=parseInt(digits.slice(1),10); }
    else { h=parseInt(digits.slice(0,2),10); m=parseInt(digits.slice(2,4),10); }
  } else {
    const[hs,ms]=v.split(':');
    h=parseInt(hs,10); m=parseInt(ms,10);
  }
  if(isNaN(h)||isNaN(m)||m<0||m>59||h<0||h>24) return '';
  if(h===24&&m>0) return '';
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

export function fmtTimeIn(el){
  const cur=el.value;
  if(cur.includes(':')) return;
  const digits=cur.replace(/[^0-9]/g,'');
  if(digits.length===4){
    el.value=digits.slice(0,2)+':'+digits.slice(2,4);        // 1430 → 14:30
  } else if(digits.length===3){
    // Nur formatieren wenn die ersten 2 Ziffern > 23 (also keine gültige Stunde mehr)
    // → 800: "80" > 23 → 08:00 ✓  |  143 (als Prefix von 1430): "14" ≤ 23 → warten
    if(parseInt(digits.slice(0,2),10)>23)
      el.value='0'+digits[0]+':'+digits.slice(1,3);
  }
}

// Einheitliche Tastatur-Navigation in der Zeiterfassung.
// Enter/Tab → nächstes Feld, Shift+Tab → vorheriges. Pfeiltasten in
// Selects laufen nativ (Wert ändern); der Fokus wird nach dem Re-Render
// über _ztNextFocusId bzw. die Feld-ID wiederhergestellt.
export function ztNav(e,el){
  const k=e.key;
  if(k!=='Enter'&&k!=='Tab') return; // Pfeiltasten etc. nativ lassen
  const all=Array.from(document.querySelectorAll('#zt .zt-nav:not([disabled])'));
  const idx=all.indexOf(el);
  if(idx<0) return;
  const nextIdx=e.shiftKey?idx-1:idx+1;
  if(nextIdx<0||nextIdx>=all.length) return; // am Rand: Standardverhalten
  e.preventDefault();
  const next=all[nextIdx];
  window._ztNextFocusId=next.id||null; // vor evtl. Re-Render merken
  next.focus();
  try{ if(next.select) next.select(); }catch(_){}
}
// Rückwärtskompatibilität (alte Aufrufe)
export function focusNextTInp(el){ ztNav({key:'Tab',shiftKey:false,preventDefault(){}}, el); }

export function td_tchange(ds,field,val){
  const _fid=window._ztNextFocusId||document.activeElement?.id||null;
  window._ztNextFocusId=null;
  const uid=window.viewEmpId||window.cu.id;

  // ── Stempel-Synchronisation ────────────────────────────────────
  // Nur für den eingeloggten User, nur heute, nur beim Block-1-Start
  if(field==='b1von'&&uid===window.cu?.id){
    const today=new Date().toISOString().slice(0,10);
    if(ds===today){
      const normV=_normTime(val);
      const stamp=window.getStamp?.();
      // Laufender Stempel → Startzeit synchronisieren (immer sinnvoll)
      if(normV&&stamp&&stamp.uid===window.cu.id&&stamp.startDate===today){
        window.syncStempelVon?.(normV);
      } else if(normV&&!stamp){
        // Auto-Stempel NUR wenn: gerade jetzt angefangen (Zeit ≈ jetzt, ±15 Min)
        // UND der Tag noch keine Endzeit / 2. Block / Abwesenheit hat
        const entry0=getEntry(uid,window.year,window.mon);
        const day0=(entry0.days||{})[ds]||{};
        const _ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
        const istLeer=!day0.b1bis&&!day0.b2von&&!_ABS.has(day0.b1zuord)&&!_ABS.has(day0.b1bem);
        const now=new Date();
        const [h,mi]=normV.split(':').map(Number);
        const diffMinNow=Math.abs((now.getHours()*60+now.getMinutes())-(h*60+mi));
        if(istLeer&&diffMinNow<=15){
          clearTimeout(window._ztAutoStampTimer);
          window._ztAutoStampTimer=setTimeout(()=>{
            // Beim Auslösen erneut prüfen dass kein Stempel läuft und Tag noch leer ist
            const e=getEntry(uid,window.year,window.mon);
            const dd0=(e.days||{})[ds]||{};
            if(!window.getStamp?.()&&!dd0.b1bis) window.startZeitstempelAt?.(normV);
          },30000);
        }
      } else if(!normV){
        clearTimeout(window._ztAutoStampTimer);
      }
    }
  }
  // ────────────────────────────────────────────────────────────────
  const normVal=_normTime(val);
  setDay(uid,window.year,window.mon,ds,field,normVal);
  const block=field.startsWith('b2')?'2':'1';
  const vonF=`b${block}von`, bisF=`b${block}bis`, zuordF=`b${block}zuord`;
  const entry=getEntry(uid,window.year,window.mon);
  const day=(entry.days||{})[ds]||{};
  const zuord=day[zuordF]||'';
  const isAbsence=zuord==='Urlaub'||zuord==='AU/Krank'||zuord==='Arbeitszeitausgleich';
  if(!isAbsence){
    const von=field===vonF?normVal:(day[vonF]||'');
    const bis=field===bisF?normVal:(day[bisF]||'');
    if(von&&bis){
      const rawMin=diffMin(von,bis);
      if(rawMin>0){
        const rounded=Math.round(rawMin/15)*15;
        if(rounded!==rawMin&&rounded>0) setDay(uid,window.year,window.mon,ds,bisF,addMin(von,rounded));
      }
    }
    // Letzte Abfahrtszeit (b2bis) um fehlende Pflichtpause aufblähen,
    // damit Netto = eingetragene Arbeitszeit (Freiberufler: keine Pause).
    if(field==='b2bis'&&!isFreelancer(getUser(uid))){
      const e2=getEntry(uid,window.year,window.mon);
      const dd2=(e2.days||{})[ds]||{};
      const b1=diffMin(dd2.b1von||'',dd2.b1bis||'');
      const b2net=diffMin(dd2.b2von||'',dd2.b2bis||'');
      const kt=Number(dd2.ktmin||0);
      const grossNet=b1+b2net+kt;
      const required=grossNet>=540?45:grossNet>=360?30:0;
      let gap=0;
      if(dd2.b1bis&&dd2.b2von){ const g=diffMin(dd2.b1bis,dd2.b2von); if(g>0) gap=g; }
      const missing=Math.max(0,required-gap);
      if(missing>0&&dd2.b2von&&dd2.b2bis){
        setDay(uid,window.year,window.mon,ds,'b2bis',addMin(dd2.b2bis,missing));
      }
    }
  }
  check10hCarryover(uid,window.year,window.mon,ds);
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

export function check10hCarryover(uid,y,m,ds,depth){
  if((depth||0)>31) return;
  const entry=getEntry(uid,y,m);
  const day=(entry.days||{})[ds]||{};
  const rawGross=diffMin(day.b1von||'',day.b1bis||'')+diffMin(day.b2von||'',day.b2bis||'')+Number(day.ktmin||0);
  const raw=Math.max(0,rawGross-autoPauseMin(day,getUser(uid)));
  const rounded=raw>0?Math.round(raw/15)*15:0;
  const overflow=Math.max(0,rounded-600);
  const date=new Date(ds+'T12:00:00');
  date.setDate(date.getDate()+1);
  const nY=date.getFullYear(),nM=date.getMonth()+1,nD=date.getDate();
  const nDs=dateStr(nY,nM,nD);
  let hadCarryover=false;
  mutate(d=>{
    const nK=entryKey(uid,nY,nM);
    const nd=d.entries?.[nK]?.days?.[nDs];
    if(nd){
      if(nd.b1bem==='Übertrag 10h Korrektur'){ nd.b1von=''; nd.b1bis=''; nd.b1zuord=''; nd.b1bem=''; hadCarryover=true; }
      if(nd.b2bem==='Übertrag 10h Korrektur'){ nd.b2von=''; nd.b2bis=''; nd.b2zuord=''; nd.b2bem=''; hadCarryover=true; }
    }
    if(overflow>0){
      const startStr='08:00', bisStr=addMin(startStr,overflow);
      if(!d.entries[nK]) d.entries[nK]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
      if(!d.entries[nK].days) d.entries[nK].days={};
      if(!d.entries[nK].days[nDs]) d.entries[nK].days[nDs]={};
      const nd2=d.entries[nK].days[nDs];
      if(!nd2.b1von){ nd2.b1von=startStr; nd2.b1bis=bisStr; nd2.b1bem='Übertrag 10h Korrektur'; }
      else if(!nd2.b2von){ nd2.b2von=startStr; nd2.b2bis=bisStr; nd2.b2bem='Übertrag 10h Korrektur'; }
      else { nd2.ktmin=(Number(nd2.ktmin||0)+overflow); }
      if(!depth){
        const ok=entryKey(uid,y,m);
        const od=d.entries[ok]?.days?.[ds];
        if(od){
          let toRemove=overflow;
          if(toRemove>0&&Number(od.ktmin||0)>0){ const cut=Math.min(toRemove,Number(od.ktmin)); od.ktmin=Number(od.ktmin)-cut; toRemove-=cut; }
          if(toRemove>0&&od.b2von&&od.b2bis){ const b2m=diffMin(od.b2von,od.b2bis); const cut=Math.min(toRemove,b2m); od.b2bis=addMin(od.b2von,b2m-cut); toRemove-=cut; }
          if(toRemove>0&&od.b1von&&od.b1bis){ const b1m=diffMin(od.b1von,od.b1bis); od.b1bis=addMin(od.b1von,Math.max(0,b1m-toRemove)); }
        }
      }
    }
    const nd3=d.entries?.[nK]?.days?.[nDs];
    if(nd3&&!nd3.b1von&&!nd3.b1bis&&!nd3.b2von&&!nd3.b2bis&&!Number(nd3.ktmin)&&!nd3.b1bem&&!nd3.b2bem){
      delete d.entries[nK].days[nDs];
    }
  });
  if(overflow>0||hadCarryover) check10hCarryover(uid,nY,nM,nDs,(depth||0)+1);
  if(!depth&&overflow>0) toast('⚠ Tageslimit 10h überschritten – '+minFmt(overflow)+' auf Folgetag übertragen.','warn');
}

export function saveCarryover(){
  const uid=window.viewEmpId||window.cu.id;
  const v=parseFloat(document.getElementById('carryover-input').value)||0;
  mutate(d=>{
    const k=entryKey(uid,window.year,window.mon);
    if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
    d.entries[k].carryover=v;
    d.entries[k].carryoverManual=true;
  });
  renderZeiterfassung();
}

export function resetCarryover(){
  const uid=window.viewEmpId||window.cu.id;
  mutate(d=>{
    const k=entryKey(uid,window.year,window.mon);
    if(d.entries[k]){ d.entries[k].carryover=0; d.entries[k].carryoverManual=false; }
  });
  renderZeiterfassung();
}

// ISO-Wochenschlüssel (Jahr+KW) für Pro-Woche-Deckelung
function _isoWeekKey(d){
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3);
  const firstThu=new Date(Date.UTC(t.getUTCFullYear(),0,4));
  const week=1+Math.round(((t-firstThu)/86400000-3+((firstThu.getUTCDay()+6)%7))/7);
  return t.getUTCFullYear()+'-'+week;
}

export function syncAbsenceToTimesheets(uid,user,type,from,to,halfDay=false){
  const isFree=isFreelancer(user);
  const holFree=user.holidaysLikeSunday!==false;
  const dpw=Math.max(1,Math.min(7,user.dpw||5));
  // Nur Urlaub & AU/Krank bei Festangestellten erzeugen Stunden + Zuordnung.
  // Freiberufler (alles), Sonstiges, Arbeitszeitausgleich → nur Bemerkung.
  const hoursType=!isFree&&(type==='Urlaub'||type==='AU/Krank');
  const dailyMin=dailyMinutes(user)||480;
  mutate(d=>{
    const perWeek={}; // KW → bereits eingetragene Tage (Deckel dpw)
    let cur=new Date(from+'T12:00:00');
    const endD=new Date(to+'T12:00:00');
    while(cur<=endD){
      const wd=cur.getDay();
      if(wd!==0&&wd!==6){
        const y=cur.getFullYear(),m=cur.getMonth()+1,day=cur.getDate();
        const ds=dateStr(y,m,day);
        const hols=getHolidays(y,user.bundesland||'');
        if(!holFree||!hols.has(ds)){
          const k=entryKey(uid,y,m);
          if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
          if(!d.entries[k].days) d.entries[k].days={};
          if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
          const dayObj=d.entries[k].days[ds];
          if(hoursType){
            const wk=_isoWeekKey(cur);
            const used=perWeek[wk]||0;
            if(used<dpw){
              const mins=halfDay&&type==='Urlaub'?Math.round(dailyMin/2):dailyMin;
              // Stunden + Zuordnung = der Abwesenheitstyp (Urlaub / AU/Krank)
              Object.assign(dayObj,{b1von:'08:00',b1bis:addMin('08:00',mins),b1zuord:type,b1bem:'',b2von:'',b2bis:'',b2zuord:'',b2bem:'',halfDay:!!(halfDay&&type==='Urlaub')});
              perWeek[wk]=used+(halfDay&&type==='Urlaub'?0.5:1);
            } else {
              dayObj.b1bem=type; // über dpw hinaus → nur Bemerkung
            }
          } else {
            // Freiberufler / Sonstiges / Arbeitszeitausgleich → nur Bemerkung
            dayObj.b1bem=type;
          }
        }
      }
      cur.setDate(cur.getDate()+1);
    }
  });
}

export function clearAbsenceFromTimesheets(uid,user,type,from,to){
  const isAZA=type==='Arbeitszeitausgleich';
  const cats=getCatsForTeam(user.team||'');
  const zuord=cats.includes(type)?type:(cats.includes('Sonstiges')?'Sonstiges':'');
  mutate(d=>{
    let cur=new Date(from+'T12:00:00');
    const endD=new Date(to+'T12:00:00');
    while(cur<=endD){
      const wd=cur.getDay();
      if(wd!==0&&wd!==6){
        const y=cur.getFullYear(),m=cur.getMonth()+1,day=cur.getDate();
        const ds=dateStr(y,m,day);
        const hols=getHolidays(y,user.bundesland||'');
        if(!hols.has(ds)){
          const k=entryKey(uid,y,m);
          const dd=d.entries?.[k]?.days?.[ds];
          if(dd){
            if(isAZA){ if(dd.b1bem==='Arbeitszeitausgleich') dd.b1bem=''; }
            else if(dd.b1zuord===zuord||dd.b1bem===type||dd.b1zuord===type){
              Object.assign(dd,{b1von:'',b1bis:'',b1zuord:'',b1bem:''});
            }
          }
        }
      }
      cur.setDate(cur.getDate()+1);
    }
  });
}

export function syncSickToTimesheets(uid,user,from,to){ syncAbsenceToTimesheets(uid,user,'AU/Krank',from,to); }

export function doSubmit(){
  const year=window.year, mon=window.mon, cu=window.cu;
  const tuid=(cu.role==='admin'&&window.viewEmpId&&window.viewEmpId!==cu.id)?window.viewEmpId:cu.id;
  if(!confirm('Monat einreichen? Danach keine Änderungen bis zur Freigabe.')) return;
  setEntryField(tuid,year,mon,'status','submitted');
  setEntryField(tuid,year,mon,'submittedAt',new Date().toISOString());
  toast('Monat erfolgreich eingereicht.');
  renderZeiterfassung();
}

export function doRecall(){
  const year=window.year, mon=window.mon, cu=window.cu;
  const tuid=(cu.role==='admin'&&window.viewEmpId&&window.viewEmpId!==cu.id)?window.viewEmpId:cu.id;
  setEntryField(tuid,year,mon,'status','draft');
  toast('Monatserfassung zurückgezogen.');
  renderZeiterfassung();
}

export function doApprove(){
  const year=window.year, mon=window.mon, cu=window.cu;
  const uid=window.viewEmpId;
  const note=document.getElementById('review-note').value;
  if(getEntry(uid,year,mon).status!=='submitted'){ toast('Nur eingereichte Zeiterfassungen können genehmigt werden.','err'); return; }
  setEntryField(uid,year,mon,'status','approved');
  setEntryField(uid,year,mon,'managerNote',note);
  setEntryField(uid,year,mon,'reviewedAt',new Date().toISOString());
  setEntryField(uid,year,mon,'reviewedBy',cu.id);
  toast('Zeiterfassung genehmigt.','ok'); renderZeiterfassung(); window.renderOverview?.();
}

export function doReject(){
  const year=window.year, mon=window.mon, cu=window.cu;
  const uid=window.viewEmpId;
  const note=document.getElementById('review-note').value;
  if(getEntry(uid,year,mon).status!=='submitted'){ toast('Nur eingereichte Zeiterfassungen können abgelehnt werden.','err'); return; }
  if(!note.trim()){ toast('Bitte einen Ablehnungsgrund eingeben.','err'); return; }
  setEntryField(uid,year,mon,'status','rejected');
  setEntryField(uid,year,mon,'managerNote',note);
  setEntryField(uid,year,mon,'reviewedAt',new Date().toISOString());
  setEntryField(uid,year,mon,'reviewedBy',cu.id);
  toast('Zeiterfassung abgelehnt.','err'); renderZeiterfassung(); window.renderOverview?.();
}

export function doResetToDraft(){
  const year=window.year, mon=window.mon;
  setEntryField(window.viewEmpId,year,mon,'status','draft');
  setEntryField(window.viewEmpId,year,mon,'managerNote','');
  toast('Zurück auf Entwurf gesetzt.');
  renderZeiterfassung();
}
