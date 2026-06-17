import { MONTHS } from '../config.js';
import { getEntry, getUser, getData, setDay, setEntryField, mutate, entryKey } from '../data.js';
import { isManagerRole, isFreelancer, isBerater, getLeitungTeams, hasPermission, getResponsibleLeitung, monthStartDate } from '../roles.js';
import { diffMin, addMin, daysInMonth, dateStr, isWeekend, isToday, isoWeek, dayName, getHolidays, hFmt, sFmt, minFmt, dayFmt, esc, toast } from '../utils.js';
import { catOptionsForUser, getCatsForTeam } from '../cats.js';
import { dailyMinutes, monthSOLL, monthSOLLdays, getEffectiveCarryH, vacDays, sickDays, totalVacUsed, vacUsedUpToMonth, zuordBreakdown, monthIST, autoPauseMin } from '../calc.js';
import { fmtTs } from '../utils.js';

// Uhrzeit "HH:MM" → Minuten seit Mitternacht
function _hhmmToMin(t){ const p=String(t||'').split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
// Gearbeitete Minuten eines Tages, die im Zeitfenster [lo,hi] (Minuten ab 0:00) liegen.
// Für die Werkstudent-20h-Grenze: nur Arbeitszeit zwischen 08:00 und 20:00 zählt.
// Kleinteilig (ktmin) hat keine Uhrzeit → wird als Tagesarbeit voll mitgezählt.
function _workMinInWindow(dd,lo,hi){
  const clamp=(von,bis)=>{
    if(!von||!bis) return 0;
    let a=_hhmmToMin(von), b=_hhmmToMin(bis);
    if(b<a) b+=1440; // über Mitternacht
    const s=Math.max(a,lo), e=Math.min(b,hi);
    return Math.max(0,e-s);
  };
  return clamp(dd.b1von,dd.b1bis)+clamp(dd.b2von,dd.b2bis)+Number(dd.ktmin||0);
}

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
  // Bearbeitbar: eigener Entwurf; Admin immer; Leitung/GF nur Entwürfe (NICHT
  // eingereichte/genehmigte Monate – die sind nach dem Einreichen gesperrt und
  // werden nur per Zurückweisen wieder zum Entwurf).
  const canEdit=(cu.id===uid&&entry.status==='draft')||
                (cu.role==='admin')||
                (isLeiter&&cu.role!=='admin'&&entry.status==='draft');
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

  // Leitung/GF dürfen fremde Monate erst NACH Abgabe einsehen. Entwürfe und
  // (leere) Zukunftsmonate bleiben verborgen – auch wenn man über die Pfeile
  // dorthin navigiert. Admin sieht weiterhin alles.
  if(viewingOther&&cu.role!=='admin'&&entry.status==='draft'){
    document.getElementById('zt-body').innerHTML='<tr><td colspan="18" style="padding:28px;text-align:center;color:var(--muted)">🔒 '+MONTHS[mon-1]+' '+year+' ist noch nicht eingereicht – als Leitung erst nach Abgabe einsehbar.</td></tr>';
    const _sc=document.getElementById('summary-cards'); if(_sc) _sc.innerHTML='';
    const _ab=document.getElementById('action-bar'); if(_ab) _ab.style.display='none';
    const _rp=document.getElementById('review-panel'); if(_rp) _rp.style.display='none';
    const _idw=document.getElementById('info-diff-wrap'); if(_idw) _idw.style.display='none';
    return;
  }

  const tbody=document.getElementById('zt-body');
  tbody.innerHTML='';
  const dim=daysInMonth(year,mon);
  const hols=getHolidays(year,user.bundesland||'');
  let monthTotal=0, monthPause=0;

  // Werkstudenten: Wochensummen vorberechnen
  // weekMins = aktueller Monat (für Zeilenmarkierung)
  // weekMinsYTD = Januar bis aktueller Monat (für Jahres-Counter)
  const weekMins={};      // aktueller Monat – nur Semester/Mo–Fr/8–20 Uhr → Rot-Markierung der Zeilen
  const weekMinsYTD={};    // ganzes Jahr bis Monat – gesamte Wochenarbeit → 26-Wochen-Zähler
  // Vorlesungszeiten (Semester) des Werkstudenten – nur darin greift die 20h-Zeilen-Markierung.
  const _lectPeriods=Array.isArray(user.lecturePeriods)?user.lecturePeriods.filter(p=>p&&p.von&&p.bis):[];
  const _inSemester=ds=>_lectPeriods.some(p=>ds>=p.von&&ds<=p.bis);
  if(isWerkstudent){
    // a) Rot-Markierung im Semester: nur Mo–Fr, nur Arbeitszeit 8–20 Uhr (aktueller Monat)
    const _addWin=(kw,dd,dObj,ds)=>{
      const wd=dObj.getDay();
      if(wd===0||wd===6) return;       // Wochenende ignorieren
      if(!_inSemester(ds)) return;     // außerhalb der Vorlesungszeit ignorieren
      const net=Math.max(0,_workMinInWindow(dd,480,1200)-autoPauseMin(dd,user));
      if(net>0) weekMins[kw]=(weekMins[kw]||0)+net;
    };
    for(let d=1;d<=dim;d++){
      const dObj=new Date(year,mon-1,d), ds2=dateStr(year,mon,d);
      _addWin(isoWeek(dObj),(entry.days||{})[ds2]||{},dObj,ds2);
    }
    // b) 26-Wochen-Zähler (Werkstudentenprivileg): alle Wochen Jan–aktueller Monat,
    //    gezählt wird die gesamte Nettoarbeit/Tag (max 10h) – unabhängig von Uhrzeit/Wochenende.
    const _addTot=(kw,dd)=>{
      const gross=diffMin(dd.b1von||'',dd.b1bis||'')+diffMin(dd.b2von||'',dd.b2bis||'')+Number(dd.ktmin||0);
      const net=Math.min(Math.max(0,Math.round((gross-autoPauseMin(dd,user))/15)*15),600);
      if(net>0) weekMinsYTD[kw]=(weekMinsYTD[kw]||0)+net;
    };
    for(let m=1;m<=mon;m++){
      const e=m===mon?entry:getEntry(uid,year,m);
      const dim2=daysInMonth(year,m);
      for(let d=1;d<=dim2;d++) _addTot(isoWeek(new Date(year,m-1,d)),(e.days||{})[dateStr(year,m,d)]||{});
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
    // Kein 10h-Übertrag mehr (rechtlich unzulässig): die echte Arbeitszeit zählt voll.
    const effDayMin=roundedDayMin;
    monthTotal+=effDayMin;
    // Reine Arbeitszeit über 10h/Tag → Zeile rot + Vermerk (ArbZG-Warnung).
    // Freiberufler/Selbstständige fallen nicht unter das ArbZG → ausgenommen.
    const over10h=!isAbsDay&&!isFree&&roundedDayMin>600;
    // Werkstudent: Woche über 20h → nur Mo–Fr-Tage im Semester rot markieren.
    const wsOver=isWerkstudent&&!we&&_inSemester(ds)&&overWeeks.has(kw);

    const tr=document.createElement('tr');
    if(we) tr.classList.add('weekend');
    if(hol) tr.classList.add('holiday');
    if(tod) tr.classList.add('today-row');
    if(readonly) tr.classList.add('readonly');
    if(over10h) tr.classList.add('over10h');
    if(wsOver) tr.classList.add('wstd-over');
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
      <td class="sep-c sep-col2"></td>
      <td class="kt-col"><input id="kt_${ds}" class="kt-min zt-nav" type="number" min="0" max="240" step="15" value="${dd.ktmin||''}" ${dis?'disabled':''} onkeydown="ztNav(event,this)" onchange="td_change('${ds}','ktmin',this.value)" placeholder="0"></td>
      <td class="sum-c kt-col">${ktm>0?minFmt(ktm):''}</td>
      <td class="pause-c pause-col">${pauseMinAuto>0?minFmt(pauseMinAuto):''}</td>
      <td class="total-c">${effDayMin>0?hFmt(effDayMin):''}${over10h?'<span class="zt-warn">&gt; 10 h/Tag</span>':''}${wsOver?'<span class="zt-warn">&gt; 20 h/Woche</span>':''}</td>
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
      const totalMin=istMin+Math.round(carryH*60);
      const billedMin=Math.min(totalMin,maxH*60);
      const overflowMin=Math.max(0,totalMin-maxH*60);
      const underMin=Math.max(0,maxH*60-totalMin);
      const maxDays=maxH/8;
      const billedDayStr=dayFmt(billedMin);
      const istDayStr=dayFmt(istMin);
      const overDayStr=overflowMin>0?dayFmt(overflowMin):'';
      cards=[
        {lbl:'Geleistete Stunden',big:hFmt(istMin),sub:istDayStr?('= '+istDayStr+' (8h=1T)'):'tatsächlich geleistet'},
        {lbl:'Stundenübertrag Vormonat',big:sFmt(carryH*60),sub:entry.carryoverManual?'manuell gesetzt':'automatisch berechnet'},
        {lbl:'Verfügbar gesamt',big:hFmt(totalMin),sub:'Leistung + Übertrag = '+dayFmt(totalMin)},
        {lbl:'Abgerechnet (Limit '+maxH+' h / '+maxDays+' T)',big:hFmt(billedMin),sub:billedDayStr?('= '+billedDayStr+' – max. Limit'):'max. Monatslimit',cls:billedMin>=maxH*60?'neg':'pos'},
        {lbl:'Übertrag → nächster Monat',big:overflowMin>0?('+'+hFmt(overflowMin)):'–',sub:overDayStr?('= +'+overDayStr+' werden vorgetragen'):overflowMin>0?'wird vorgetragen':underMin>0?'unter Limit – kein Minus':'exakt auf Limit',cls:overflowMin>0?'pos':''},
      ];
    } else {
      cards=[
        {lbl:'IST-Stunden Monat',big:hFmt(istMin),sub:'tatsächlich geleistet'},
        {lbl:'Stundenübertrag Vormonat',big:sFmt(carryH*60),sub:entry.carryoverManual?'manuell gesetzt':'automatisch'},
      ];
      const yearTotal=Array.from({length:12},(_,i)=>monthIST(getEntry(uid,year,i+1),user)).reduce((a,b)=>a+b,0);
      cards.push({lbl:`IST-Gesamt ${year}`,big:hFmt(yearTotal),sub:'alle Monate zusammen'});
    }
  } else {
    const soll=monthSOLL(user,year,mon);
    const diff=istMin-(soll-Math.round(carryH*60));
    const vd=vacDays(entry);
    const sk=sickDays(entry);
    const vacUpTo=vacUsedUpToMonth(uid,year,mon);   // bis einschl. aktuellem Monat
    const vacApproved=totalVacUsed(uid,year);       // ganzes Jahr (inkl. Zukunft)
    const vacLeft=user.al-vacUpTo;                  // Resturlaub bis hierher
    const vacFuture=Math.max(0,vacApproved-vacUpTo);// schon beantragt/genehmigt (später)
    const sollDays=monthSOLLdays(user,year,mon);
    const sollSub=sollDays>0?`${sollDays} AT × ${hFmt(dailyMinutes(user))}`:'4 × Wochenarbeitszeit';
    cards=[
      {lbl:'SOLL-Stunden',big:hFmt(soll),sub:sollSub},
      {lbl:'IST-Stunden',big:hFmt(istMin),sub:'tatsächlich geleistet'},
      {lbl:'Mehr / Minderstunden',big:sFmt(diff),sub:'Übertrag: '+sFmt(carryH*60),cls:diff>=0?'pos':'neg'},
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
    const _wsOk=wsOverWeeks<=26;
    cardsHtml+=`<div class="s-card" style="border:2px solid var(--${_wsOk?'warn':'danger'})">
      <div class="lbl">🎓 Werkstudent: Wochen über 20h</div>
      <div class="big${_wsOk?'':' neg'}">${wsOverWeeks} / 26</div>
      <div class="sub">Jan–${MONTHS[mon-1].slice(0,3)} · max. 26 Wochen/Jahr</div>
    </div>`;
  }
  document.getElementById('summary-cards').innerHTML=cardsHtml;
  document.getElementById('carryover-input').value=_fmtCarryInput(carryH);
  const _dw=document.getElementById('info-diff-wrap');
  const _de=document.getElementById('info-diff');
  if(_de&&!isFree){
    const _s=monthSOLL(user,year,mon);
    const _c=getEffectiveCarryH(uid,user,year,mon);
    const _d=istMin-(_s-Math.round(_c*60));
    _de.textContent=sFmt(_d);
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
    const lblText=isFree?'Stundenübertrag Vormonat (Std:Min):':'Übertrag Vormonat (Std:Min):';
    if(lbl) lbl.innerHTML=`${lblText} <span style="font-size:11px;font-weight:400;color:${isManual?'var(--warn)':'var(--ok)'}">${isManual?'manuell':'auto'}</span>`;
    // Eingereichte/genehmigte Monate: Übertrag sperren (ausgegraut, nicht editierbar).
    const _locked=entry.status==='submitted'||entry.status==='approved';
    const inp=document.getElementById('carryover-input');
    if(inp){
      inp.value=_fmtCarryInput(effCarry);
      inp.disabled=_locked;
      inp.style.opacity=_locked?'.45':'';
      inp.style.cursor=_locked?'not-allowed':'';
      inp.title=_locked?'Monat eingereicht – Übertrag gesperrt':'';
    }
    const rst=document.getElementById('carryover-reset');
    if(rst) rst.style.display=(isManual&&!_locked)?'inline-flex':'none';
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
  // "Zurück zu Entwurf" ist nur für den Admin. Die Leitung soll genehmigen
  // oder mit Begründung ablehnen – nicht still in den Entwurf zurücksetzen.
  const _rd=document.getElementById('btn-reset-draft');
  if(_rd) _rd.style.display=(cu.role==='admin')?'':'none';
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
    // In der Unterschriftenzeile immer einen echten Namen zeigen – nie nur die
    // Rolle „Leitung" (die steht bereits in der Spaltenüberschrift). Fehlt ein
    // hinterlegter Prüfer, wird die zuständige Leitung des Mitarbeiters genutzt.
    let rName=reviewer?reviewer.name:'';
    if(!rName){ const _rl=getResponsibleLeitung(user,monthStartDate(window.year,window.mon)); rName=_rl?_rl.name:'Leitung'; }
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

  setDay(uid,window.year,window.mon,ds,field,val);
  // Kleinteilig ändert die Brutto-Zeit → Pflichtpause zentral neu aufschlagen.
  if(field==='ktmin') _applyDayPause(uid,ds,null);
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

// ── Nachtschicht-Erkennung (über Mitternacht) ─────────────────────
// Erkennt Paare: Tag endet 23:59 + Folgetag beginnt 00:00 → ein Zeitraum.
// Pflichtpause (Summe beider Teile) wird dem schwereren Tag zugeschlagen
// (Gleichstand → Folgetag), vom Mitternachts-Rand weg verlängert.
// Idempotent: _npOrig speichert den Originalrand für sauberes Zurücksetzen.
export function rebuildNightShifts(uid){
  const r15=t=>{ if(!t||!t.includes(':'))return t; const[h,m]=t.split(':').map(Number); let tot=Math.round((h*60+m)/15)*15; if(tot<0)tot=0; if(tot>1439)tot=1439; return String(Math.floor(tot/60)).padStart(2,'0')+':'+String(tot%60).padStart(2,'0'); };
  const _tm=s=>{ if(!s||!s.includes(':'))return 0; const[h,m]=s.split(':').map(Number); return h*60+m; };
  const _m2t=x=>String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
  const _ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich','Veranstaltung','Veranstaltung Krank / AU']);
  try{
    mutate(d=>{
      const _mk=(y,m)=>`${uid}_${y}_${String(m).padStart(2,'0')}`;
      const ensureDay=dsx=>{
        const y=+dsx.slice(0,4), m=+dsx.slice(5,7); const k=_mk(y,m);
        if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
        if(!d.entries[k].days) d.entries[k].days={};
        if(!d.entries[k].days[dsx]) d.entries[k].days[dsx]={};
        return d.entries[k].days[dsx];
      };
      const byDate={};
      Object.keys(d.entries||{}).forEach(k=>{
        const parts=k.split('_'); parts.pop(); parts.pop(); const ku=parts.join('_');
        if(ku!==uid) return;
        const _st=d.entries[k].status; if(_st==='submitted'||_st==='approved') return; // genehmigte/eingereichte Monate nicht verändern
        const days=d.entries[k].days||{};
        Object.keys(days).forEach(ds=>{ byDate[ds]=days[ds]; });
      });
      // 1) bestehende Anpassungen zurücksetzen (nur wenn unverändert → Original)
      Object.values(byDate).forEach(day=>{
        if(!day) return;
        // Auto-Fortsetzung aus Pausen-Überlauf zuerst entfernen (sofern unverändert)
        if(day._npAuto){
          if(day.b1von==='00:00'&&day.b1bis===day._npApplied){ day.b1von=''; day.b1bis=''; day.b1zuord=''; }
          delete day._npAuto;
        }
        if(day._nightShift){
          if(day._npMin>0&&day._npOrig){
            if(day._npDir==='start'){ if(day.b1von===day._npApplied) day.b1von=day._npOrig; }
            else if(day._npDir==='overflow'){ if(day.b1bis===day._npApplied) day.b1bis=day._npOrig; }
            else if(day._npDir==='end'){
              if(day.b2von&&day.b2bis){ if(day.b2bis===day._npApplied) day.b2bis=day._npOrig; }
              else { if(day.b1bis===day._npApplied) day.b1bis=day._npOrig; }
            }
          }
          delete day._nightShift; delete day._npMin; delete day._npDir; delete day._npOrig; delete day._npApplied;
        }
      });
      // Freiberufler: keine Pausen-Logik → nach dem Zurücksetzen nichts anwenden
      const _u=(d.users||[]).find(x=>x.id===uid);
      if(_u&&_u.role==='freiberuflich') return;
      // 2) Paare erkennen
      Object.keys(byDate).sort().forEach(ds=>{
        const day=byDate[ds]; if(!day) return;
        if(_ABS.has(day.b1zuord)) return;
        const _mid=v=>v==='24:00'||v==='23:59';
        const endsMidnight=(day.b2von&&_mid(day.b2bis))||(!day.b2von&&_mid(day.b1bis));
        if(!endsMidnight||!day.b1von) return;
        const nd=new Date(ds+'T12:00:00'); nd.setDate(nd.getDate()+1);
        const nds=nd.toISOString().slice(0,10);
        const nday=byDate[nds];
        if(!nday||_ABS.has(nday.b1zuord)) return;
        if(nday.b1von!=='00:00'||!nday.b1bis) return;
        const workD=diffMin(day.b1von,'23:59')+1;   // Start bis Mitternacht
        const workN=diffMin('00:00',nday.b1bis);     // Mitternacht bis Ende
        const total=workD+workN;
        const pause=total>=540?45:total>=360?30:0;
        if(pause<=0) return;
        if(workD>workN){
          // Tag D schwerer → Start vorziehen
          day._npOrig=day.b1von;
          day.b1von=r15(addMin(day.b1von,-pause));
          day._npApplied=day.b1von;
          day._nightShift=true; day._npMin=pause; day._npDir='start';
          nday._nightShift=true; nday._npMin=0; nday._npDir='';
        } else {
          // Folgetag schwerer oder Gleichstand → Ende verlängern
          if(nday.b2von&&nday.b2bis){ nday._npOrig=nday.b2bis; nday.b2bis=r15(addMin(nday.b2bis,pause)); nday._npApplied=nday.b2bis; }
          else { nday._npOrig=nday.b1bis; nday.b1bis=r15(addMin(nday.b1bis,pause)); nday._npApplied=nday.b1bis; }
          nday._nightShift=true; nday._npMin=pause; nday._npDir='end';
          day._nightShift=true; day._npMin=0; day._npDir='';
        }
      });
      // 3) Pausen-Überlauf über Mitternacht: Einzelblock, dessen Abfahrt inkl.
      //    automatischer Pause über 24:00 reicht → Rest in den Folgetag (Nachtschicht).
      Object.keys(byDate).sort().forEach(ds=>{
        const day=byDate[ds]; if(!day) return;
        if(day._nightShift) return;                 // schon durch Paar-Erkennung behandelt
        if(_ABS.has(day.b1zuord)) return;
        if(day.b2von||!day.b1von||!day.b1bis) return; // nur Einzelblock
        const vonMin=_tm(day.b1von), bisMin=_tm(day.b1bis);
        if(bisMin<=1440) return;                    // passt in den Tag
        const overflow=bisMin-1440;
        if(overflow<=0||overflow>=1440) return;
        const gross=bisMin-vonMin;
        const pause=gross>=585?45:gross>=390?30:0;
        if(pause<=0) return;
        const nd=new Date(ds+'T12:00:00'); nd.setDate(nd.getDate()+1);
        const nds=nd.toISOString().slice(0,10);
        const nentry=d.entries[_mk(+nds.slice(0,4),+nds.slice(5,7))];
        if(nentry&&(nentry.status==='submitted'||nentry.status==='approved')) return;
        const ex=byDate[nds];
        const ndayEmpty=!ex||(!ex.b1von&&!ex.b1bis&&!ex.b2von&&!ex.ktmin&&!_ABS.has(ex.b1zuord)&&!ex.b1bem);
        if(!ndayEmpty) return;                      // Folgetag belegt → unverändert lassen
        // Quelltag auf Mitternacht kappen, Pause als Nachtschicht-Pause merken
        day._npOrig=day.b1bis; day.b1bis='24:00'; day._npApplied='24:00';
        day._nightShift=true; day._npMin=pause; day._npDir='overflow';
        // Fortsetzung am Folgetag anlegen (00:00 → Überlauf)
        const nday=ensureDay(nds);
        nday.b1von='00:00'; nday.b1bis=_m2t(overflow); nday.b1zuord=day.b1zuord||'';
        nday._nightShift=true; nday._npMin=0; nday._npDir=''; nday._npAuto=true; nday._npApplied=nday.b1bis;
        byDate[nds]=nday;
      });
    });
  }catch(e){ console.error('Nachtschicht-Erkennung Fehler (ignoriert):',e); }
}

// Baut die automatischen Abwesenheiten eines Users aus der Zeiterfassung neu auf.
// Zusammenhängende Urlaub-/AU-Tage (Lücke nur Wochenende) werden zu EINEM Zeitraum.
// Echte (manuell beantragte) Anträge bleiben unangetastet und werden nicht doppelt erzeugt.
export function rebuildAutoAbsences(uid,reviewerId){
  const AUTO='Automatisch aus Zeiterfassung';
  const ABS={Urlaub:1,'AU/Krank':1};
  mutate(d=>{
    const u=(d.users||[]).find(x=>x.id===uid); if(!u) return;
    if(!d.vacRequests) d.vacRequests={};
    // 1. alle Auto-Einträge dieses Users entfernen
    Object.keys(d.vacRequests).forEach(k=>{
      const r=d.vacRequests[k];
      if(r&&r.userId===uid&&r.reviewNote===AUTO) delete d.vacRequests[k];
    });
    // 2. Tage, die bereits durch echte (manuelle) Anträge abgedeckt sind, ausklammern
    const realCovered=new Set();
    Object.values(d.vacRequests).forEach(r=>{
      if(r&&r.userId===uid&&r.status==='approved'&&r.reviewNote!==AUTO){
        let c=new Date(r.startDate+'T12:00:00'); const e=new Date(r.endDate+'T12:00:00');
        while(c<=e){ realCovered.add(c.toISOString().slice(0,10)); c.setDate(c.getDate()+1); }
      }
    });
    // 3. alle Absence-Tage des Users aus der Zeiterfassung sammeln
    const list=[];
    Object.keys(d.entries||{}).forEach(k=>{
      const parts=k.split('_'); const mm=parts.pop(); const yy=parts.pop(); const ku=parts.join('_');
      if(ku!==uid) return;
      const days=d.entries[k].days||{};
      Object.keys(days).forEach(ds2=>{
        const day=days[ds2]; const t=day&&day.b1zuord;
        if(ABS[t]&&!realCovered.has(ds2)) list.push({ds:ds2,type:t,half:!!day.halfDay});
      });
    });
    if(!list.length) return;
    list.sort((a,b)=>a.ds<b.ds?-1:1);
    // 4. zusammenhängende Läufe gleichen Typs bilden (Lücke nur Wochenende)
    const onlyWeekendBetween=(d1,d2)=>{
      const a=new Date(d1+'T12:00:00'); a.setDate(a.getDate()+1);
      const b=new Date(d2+'T12:00:00');
      while(a<b){ const wd=a.getDay(); if(wd!==0&&wd!==6) return false; a.setDate(a.getDate()+1); }
      return true;
    };
    let i=0;
    while(i<list.length){
      let j=i;
      while(j+1<list.length && list[j+1].type===list[i].type && onlyWeekendBetween(list[j].ds,list[j+1].ds)) j++;
      const start=list[i].ds, end=list[j].ds, type=list[i].type;
      let wd=0; for(let q=i;q<=j;q++) wd+=list[q].half?0.5:1;
      const rk=`${uid}_${start}_${end}`;
      d.vacRequests[rk]={id:rk,userId:uid,userName:u.name,team:u.team||'',
        type,startDate:start,endDate:end,workDays:wd,halfDay:(start===end&&list[i].half),note:'',
        status:'approved',submittedAt:new Date().toISOString(),
        reviewedBy:reviewerId||uid,reviewedAt:new Date().toISOString(),reviewNote:AUTO};
      i=j+1;
    }
  });
}

// Zentrale, IDEMPOTENTE Pausen-Aufschlagung.
// Entfernt die zuvor aufgeschlagene Pflichtpause und schlägt die aktuelle Pause
// GENAU EINMAL auf die letzte Abfahrtszeit des Tages auf. Dadurch verschieben sich
// Zeiten beim Nachbearbeiten nicht mehr (keine Mehrfach-Aufschläge, kein Aufaddieren).
// editedField = gerade vom Nutzer eingegebenes Feld (enthält bereits den Netto-Wert,
// wird daher beim Entfernen der Alt-Pause ausgelassen).
function _applyDayPause(uid,ds,editedField){
  const user=getUser(uid); if(!user) return;
  mutate(d=>{
    const k=entryKey(uid,window.year,window.mon);
    const e=d.entries[k]; if(!e) return;
    // Eingereichte/genehmigte Monate darf NUR der Admin verändern (der darf sie auch
    // bearbeiten) – dann muss auch die Pausen-Logik laufen, sonst bleibt die Stunde
    // hängen. Für alle anderen bleiben gesperrte Monate unangetastet.
    if((e.status==='submitted'||e.status==='approved')&&!(window.cu&&window.cu.role==='admin')) return;
    const day=e.days?.[ds]; if(!day||day._nightShift) return;
    const hasB2=!!(day.b2von&&day.b2bis);
    // 1) Bisher aufgeschlagene Pause IMMER zuerst entfernen (Tracking, sonst Schätzung
    //    aus Altdaten). Frueher wurde bei erneuter Bearbeitung DESSELBEN Feldes nicht
    //    entfernt (prevF!==editedField) – dadurch wurde die in der Endzeit bereits
    //    enthaltene Pause als Netto missverstanden und ein zweites Mal aufgeschlagen
    //    (Bug: 20:00 → 20:45 → 21:30). Jetzt idempotent: Endzeit = Netto + genau eine Pause.
    const prevF=day._pausedF||(hasB2?'b2bis':'b1bis');
    const prevP=day._pInit?Number(day._paused||0):autoPauseMin(day,user);
    if(prevP>0&&day[prevF]) day[prevF]=addMin(day[prevF],-prevP);
    day._paused=0; day._pausedF=''; day._pInit=true;
    // 2) Pause neu berechnen – keine bei Freiberufler / Veranstaltung / Abwesenheit
    const z=day.b1zuord||'', bem=day.b1bem||'';
    if(isFreelancer(user)||z.startsWith('Veranstaltung')
       ||z==='Urlaub'||z==='AU/Krank'||z==='Arbeitszeitausgleich'
       ||bem==='Urlaub'||bem==='AU/Krank'||bem==='Arbeitszeitausgleich') return;
    const lastF=hasB2?'b2bis':(day.b1von&&day.b1bis?'b1bis':'');
    if(!lastF||day[lastF]==='23:59'||day[lastF]==='24:00') return;
    const gross=diffMin(day.b1von||'',day.b1bis||'')+diffMin(day.b2von||'',day.b2bis||'')+Number(day.ktmin||0);
    const required=gross>540?45:gross>360?30:0; // NETTO, strikt > (DE: >6h=30, >9h=45)
    // Selbst genommene Pause = Lücke zwischen Block 1 und 2. Die FEHLENDE Pflichtpause
    // (Soll minus Lücke) wird hinten aufgeschlagen; die Tagessumme bleibt = Nettoarbeit.
    const _gap=(day.b1bis&&day.b2von)?diffMin(day.b1bis,day.b2von):0;
    const pause=Math.max(0,required-_gap);
    if(pause>0){ day[lastF]=addMin(day[lastF],pause); day._paused=pause; day._pausedF=lastF; }
  });
}

export function td_zuord(ds,field,val,wh,dpw){
  const _fid=window._ztNextFocusId||document.activeElement?.id||null;
  window._ztNextFocusId=null;
  const uid=window.viewEmpId||window.cu.id;
  const cu=window.cu;
  const _oldZuord=((getEntry(uid,window.year,window.mon).days||{})[ds]||{}).b1zuord||'';
  setDay(uid,window.year,window.mon,ds,field,val);

  // „Sonstiges" → nur Bemerkung eintragen, keine Zeiteinträge
  if(val==='Sonstiges'){
    setDay(uid,window.year,window.mon,ds,'b1bem','Sonstiges');
    // Keine Zeitfelder setzen
  }

  // Urlaub / AU/Krank → Soll-Zeiten nur setzen, wenn der Tag NOCH KEINE Zeiten hat.
  // Verhindert, dass beim Durchblättern der Zuordnung mit der Tastatur bereits
  // eingetragene Start-/Endzeiten durch die festen Urlaubs-/AU-Zeiten überschrieben werden.
  const _dNow=(getEntry(uid,window.year,window.mon).days||{})[ds]||{};
  if((val==='Urlaub'||val==='AU/Krank')&&wh>0&&!_dNow.b1von&&!_dNow.b1bis&&!_dNow.b2von){
    const u=getUser(uid)||cu;
    const dailyMin=Math.round(wh*60/(dpw||5))||480;
    const dMin=val==='Urlaub'?((u?.vacHoursPerDay||Math.round(wh/(dpw||5))||8)*60):dailyMin;
    setDay(uid,window.year,window.mon,ds,'b1von','08:00');
    setDay(uid,window.year,window.mon,ds,'b1bis',addMin('08:00',dMin));
    setDay(uid,window.year,window.mon,ds,'b2von',''); setDay(uid,window.year,window.mon,ds,'b2bis','');
    setDay(uid,window.year,window.mon,ds,'ktmin','');
  }
  if(field==='b1zuord'){
    if(val==='Urlaub'||val==='AU/Krank'){
      // Die Soll-Stunden wurden oben frisch gesetzt (08:00–dMin). Das alte Pausen-Tracking
      // (_paused/_pausedF) stammt vom vorherigen Arbeitstag – würde _applyDayPause es jetzt
      // "entinflationieren", würden die frischen Abwesenheits-Stunden fälschlich verkürzt.
      // Daher Tracking zurücksetzen und keine Pausen-Logik auf Abwesenheitstage anwenden.
      mutate(d=>{ const dd=d.entries?.[entryKey(uid,window.year,window.mon)]?.days?.[ds]; if(dd){ dd._paused=0; dd._pausedF=''; dd._pInit=false; } });
    } else {
      // Pflichtpause an die (ggf. neue) Kategorie anpassen (Veranstaltung = keine Pause).
      _applyDayPause(uid,ds,null);
    }
    // Auto-Abwesenheiten komplett aus der Zeiterfassung neu aufbauen
    // (erkennt zusammenhängende Urlaub-/AU-Zeiträume, auch über Wochenenden)
    rebuildAutoAbsences(uid,cu.id);
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
  // Erneutes Auslösen mit dem bereits angezeigten (pausen-behafteten) Wert = keine echte
  // Änderung → NICHT erneut verarbeiten, sonst würde die Pause doppelt aufgeschlagen.
  if(normVal===(day.b1bis||'')){ if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0); return; }
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
    // Eingegebene (Netto-)Endzeit speichern; die Pflichtpause wird zentral
    // & idempotent aufgeschlagen (keine Mehrfach-Aufschläge beim Nachbearbeiten).
    setDay(uid,window.year,window.mon,ds,'b1bis',roundedNet);
  }
  // Frisch getippter Wert = Netto-Ende → altes Pausen-Tracking auf b1bis verwerfen,
  // damit _applyDayPause die nicht mehr enthaltene Pause nicht abzieht (sonst zu wenig).
  mutate(d=>{ const dd=d.entries?.[entryKey(uid,window.year,window.mon)]?.days?.[ds]; if(dd&&dd._pausedF==='b1bis'){ dd._paused=0; dd._pausedF=''; } });
  _applyDayPause(uid,ds,'b1bis');
  rebuildNightShifts(uid);
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
    // Nur formatieren wenn die ersten 2 Ziffern > 24 (also keine gültige Stunde mehr).
    // 24 bleibt gültig (24:00 = Mitternacht/Nachtschicht) → ">24" statt ">23", damit
    // man "2400" zu Ende tippen kann. 800: "80">24 → 08:00 ✓ | 240: "24"≤24 → warten.
    if(parseInt(digits.slice(0,2),10)>24)
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
  // Pausen-tragendes Endfeld (b2bis) erneut mit unverändertem Wert ausgelöst → nicht
  // neu verarbeiten (sonst Doppel-Aufschlag der Pause, analog b1bis).
  if(field==='b2bis'){
    const _cur=getEntry(uid,window.year,window.mon).days?.[ds]||{};
    if(normVal===(_cur.b2bis||'')){ if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0); return; }
  }
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
  }
  // Frisch getippter Wert in b2bis = Netto-Ende → altes Pausen-Tracking dieses Feldes
  // verwerfen, damit _applyDayPause die Pause nicht doppelt aufschlägt.
  if(field==='b2bis') mutate(d=>{ const dd=d.entries?.[entryKey(uid,window.year,window.mon)]?.days?.[ds]; if(dd&&dd._pausedF==='b2bis'){ dd._paused=0; dd._pausedF=''; } });
  _applyDayPause(uid,ds,field);
  rebuildNightShifts(uid);
  renderZeiterfassung();
  if(_fid) setTimeout(()=>{ const el=document.getElementById(_fid); if(el) el.focus(); },0);
}

// Übertrag-Eingabe robust lesen: 'H:MM' / '-H:MM' ODER Dezimalstunden ('14,25').
// Verhindert den Fehler, dass die H:MM-Anzeige (z. B. 22:21) als Dezimal (22,21=22:13) getippt wird.
function _parseCarryInput(raw){
  const s=String(raw==null?'':raw).trim();
  if(!s) return 0;
  if(s.includes(':')){
    const neg=s.startsWith('-');
    const p=s.replace('-','').split(':');
    const h=parseInt(p[0],10)||0, m=parseInt(p[1],10)||0;
    const v=h+m/60;
    return neg?-v:v;
  }
  return parseFloat(s.replace(',','.'))||0;
}
// Stunden (Dezimal) als 'H:MM' / '-H:MM' fürs Eingabefeld.
function _fmtCarryInput(h){
  const min=Math.round((h||0)*60), neg=min<0, a=Math.abs(min);
  return (neg?'-':'')+Math.floor(a/60)+':'+String(a%60).padStart(2,'0');
}

export function saveCarryover(){
  const uid=window.viewEmpId||window.cu.id;
  const v=_parseCarryInput(document.getElementById('carryover-input').value);
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

export function syncAbsenceToTimesheets(uid,user,type,from,to,halfDay=false,hoursPerDay=null){
  const isFree=isFreelancer(user);
  const holFree=user.holidaysLikeSunday!==false;
  const dpw=Math.max(1,Math.min(7,user.dpw||5));
  // Nur Urlaub & AU/Krank bei Festangestellten erzeugen Stunden + Zuordnung.
  // Freiberufler (alles), Sonstiges, Arbeitszeitausgleich → nur Bemerkung.
  const hoursType=!isFree&&(type==='Urlaub'||type==='AU/Krank');
  // Urlaub: Stunden/Tag aus der gewählten Berechnung (Einstellung oder Stunden/Woche), sonst Profil-Default.
  const dailyMin=(type==='Urlaub'&&hoursPerDay)?Math.round(hoursPerDay*60):(dailyMinutes(user)||480);
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
          // Gesperrte (eingereichte/genehmigte) Monate nicht überschreiben – außer Admin.
          if(d.entries[k]&&(d.entries[k].status==='submitted'||d.entries[k].status==='approved')&&!(window.cu&&window.cu.role==='admin')){ cur.setDate(cur.getDate()+1); continue; }
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
  if(type==='Veranstaltung'){
    mutate(d=>{
      let cur=new Date(from+'T12:00:00'); const endD=new Date(to+'T12:00:00');
      while(cur<=endD){
        const y=cur.getFullYear(),m=cur.getMonth()+1,day=cur.getDate();
        const dd=d.entries?.[entryKey(uid,y,m)]?.days?.[dateStr(y,m,day)];
        if(dd&&String(dd.b1zuord||'').startsWith('Veranstaltung')) Object.assign(dd,{b1von:'',b1bis:'',b1zuord:'',b1bem:''});
        cur.setDate(cur.getDate()+1);
      }
    });
    return;
  }
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

// Veranstaltung mit eigenen Uhrzeiten pro Tag in die Zeiterfassung schreiben (keine Pause).
export function syncVeranstaltungToTimesheets(uid,dayTimes,note){
  const bem=(note&&note.trim())?note.trim():'Veranstaltung Krank / AU';
  let written=0, skipped=0;
  mutate(d=>{
    Object.keys(dayTimes||{}).forEach(ds=>{
      const t=dayTimes[ds]; if(!t||!t.von||!t.bis) return;
      const y=+ds.slice(0,4), m=+ds.slice(5,7);
      const k=entryKey(uid,y,m);
      // genehmigte/eingereichte Monate nicht verändern – außer der Admin trägt ein (darf das).
      if(d.entries[k]&&(d.entries[k].status==='submitted'||d.entries[k].status==='approved')&&!(window.cu&&window.cu.role==='admin')){ skipped++; return; }
      if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
      if(!d.entries[k].days) d.entries[k].days={};
      if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
      Object.assign(d.entries[k].days[ds],{b1von:t.von,b1bis:t.bis,b1zuord:'Veranstaltung Krank / AU',b1bem:bem,b2von:'',b2bis:'',b2zuord:'',b2bem:'',ktmin:''});
      written++;
    });
  });
  return {written,skipped};
}

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
  // Nur der Admin darf eine eingereichte ZE direkt zurück in den Entwurf setzen.
  // Die Leitung genehmigt oder lehnt (mit Begründung) ab.
  if(!window.cu||window.cu.role!=='admin'){ toast('Nur der Admin kann zurück auf Entwurf setzen. Bitte ablehnen mit Begründung.'); return; }
  const year=window.year, mon=window.mon;
  setEntryField(window.viewEmpId,year,mon,'status','draft');
  setEntryField(window.viewEmpId,year,mon,'managerNote','');
  toast('Zurück auf Entwurf gesetzt.');
  renderZeiterfassung();
}
