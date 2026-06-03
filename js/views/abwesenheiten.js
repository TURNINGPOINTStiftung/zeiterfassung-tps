import { MONTHS } from '../config.js';
import { getData, getUser, mutate } from '../data.js';
import { canSeeEmployee, canSeeAbsence, getLeitungTeams, hasPermission, getTeamForDate } from '../roles.js';
import { esc, dateStr, daysInMonth, getHolidays, openModal, closeModal, toast } from '../utils.js';

export function countWorkDays(start,end,user){
  // user optional – falls übergeben, Feiertage je nach holidaysLikeSunday berücksichtigen
  const holFree=!user||user.holidaysLikeSunday!==false;
  const startY=parseInt(start.slice(0,4)), endY=parseInt(end.slice(0,4));
  const holCache={};
  if(holFree){
    for(let y=startY;y<=endY;y++) holCache[y]=getHolidays(y,user?.bundesland||'');
  }
  let count=0, cur=new Date(start+'T12:00:00');
  const endD=new Date(end+'T12:00:00');
  while(cur<=endD){
    const wd=cur.getDay();
    if(wd!==0&&wd!==6){
      const ds=cur.toISOString().slice(0,10);
      if(!holFree||!holCache[cur.getFullYear()]?.has(ds)) count++;
    }
    cur.setDate(cur.getDate()+1);
  }
  return count;
}

// Urlaubstage nach Profil: Werktage (Mo-Fr) pro Kalenderwoche auf dpw deckeln.
// Bsp Mateo dpw=2: 1 Werktag → 1 Tag, ganze Woche (5 Werktage) → 2 Tage.
export function countVacationDays(start,end,user){
  const holFree=!user||user.holidaysLikeSunday!==false;
  const dpw=Math.max(1,Math.min(7,user?.dpw||5));
  const bl=user?.bundesland||'';
  const holCache={};
  const _iso=d=>{ // ISO-Wochen-Schlüssel (Jahr+KW)
    const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    const day=(t.getUTCDay()+6)%7; t.setUTCDate(t.getUTCDate()-day+3);
    const firstThu=new Date(Date.UTC(t.getUTCFullYear(),0,4));
    const week=1+Math.round(((t-firstThu)/86400000-3+((firstThu.getUTCDay()+6)%7))/7);
    return t.getUTCFullYear()+'-'+week;
  };
  const perWeek={};
  let cur=new Date(start+'T12:00:00');
  const endD=new Date(end+'T12:00:00');
  while(cur<=endD){
    const wd=cur.getDay();
    if(wd!==0&&wd!==6){
      const y=cur.getFullYear();
      if(holFree&&!holCache[y]) holCache[y]=getHolidays(y,bl);
      const ds=cur.toISOString().slice(0,10);
      if(!holFree||!holCache[y].has(ds)){
        const wk=_iso(cur);
        perWeek[wk]=(perWeek[wk]||0)+1;
      }
    }
    cur.setDate(cur.getDate()+1);
  }
  // Pro Woche auf dpw deckeln
  return Object.values(perWeek).reduce((s,n)=>s+Math.min(n,dpw),0);
}

export function showVacRequestForm(){
  const cu=window.cu;
  const today=new Date().toISOString().slice(0,10);
  const isMgr=cu.role==='leitung'||cu.role==='admin'||cu.role==='geschaeftsfuehrer';
  const d=getData();
  const teamEmps=isMgr
    ? d.users.filter(u=>u.id!==cu.id&&canSeeEmployee(cu,u))
    : [];
  const empSelector=isMgr&&teamEmps.length
    ? `<div class="form-group"><label>Für wen?</label>
        <select id="vr-emp" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px" onchange="calcVrDays()">
          <option value="">– Mich selbst –</option>
          ${teamEmps.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}
        </select></div>`
    : '';
  openModal(`
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">Abwesenheit eintragen</h3>
    ${empSelector}
    <div class="form-group"><label>Art der Abwesenheit</label>
      <select id="vr-type" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px" onchange="onVrTypeChange()">
        <option value="Urlaub">Urlaub</option>
        <option value="AU/Krank">AU / Krank</option>
        <option value="Arbeitszeitausgleich">Arbeitszeitausgleich</option>
        <option value="Sonstiges">Sonstiges</option>
      </select></div>
    <div id="vr-krank-hint" style="display:none;margin:-4px 0 10px;padding:8px 12px;background:#fff5f5;border:1.5px solid var(--danger);border-radius:6px;font-size:12px;color:#721c24">
      🤒 Krankmeldung – wird sofort als aktiv eingetragen (kein Genehmigungsschritt).
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Von</label><input type="date" id="vr-from" value="${today}" oninput="calcVrDays()"></div>
      <div class="form-group"><label>Bis (inkl.)</label><input type="date" id="vr-to" value="${today}" oninput="calcVrDays()"></div>
    </div>
    <div id="vr-halfday-wrap" style="display:none;margin:-4px 0 10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="vr-halfday" onchange="calcVrDays()" style="width:16px;height:16px">
        <span>Halber Urlaubstag <span style="color:var(--muted);font-size:11px">(z.B. 4h bei 8h-Tag)</span></span>
      </label>
    </div>
    <div id="vr-count-mode-wrap" style="display:none;margin:-4px 0 12px;background:#f8f9fb;border:1.5px solid var(--border);border-radius:8px;padding:10px 12px">
      <div style="font-size:12px;font-weight:600;color:var(--primary);margin-bottom:8px">Urlaubstage berechnen:</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="radio" name="vr-mode" id="vr-mode-auto" value="auto" checked onchange="calcVrDays()">
          Automatisch nach Profil <span id="vr-mode-auto-hint" style="font-size:11px;color:var(--muted)"></span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="radio" name="vr-mode" id="vr-mode-manual" value="manual" onchange="calcVrDays()">
          Anzahl selbst eingeben:
          <input type="number" id="vr-manual-days" min="0.5" max="25" step="0.5" value="1"
            style="width:70px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px"
            oninput="calcVrDays()">
          <span style="font-size:11px;color:var(--muted)">(max 5/Woche)</span>
        </label>
      </div>
    </div>
    <div id="vr-days-info" style="margin:-6px 0 10px;font-size:13px;color:var(--primary);font-weight:600"></div>
    <div id="vr-week-hint" style="display:none;margin-bottom:12px;padding:8px 12px;background:#fffbf5;border:1.5px solid var(--warn);border-radius:6px;font-size:12px;color:#856404">
      ⚠ Für Abwesenheiten über einer Woche ist ein formloser Antrag erforderlich. Bitte füge eine kurze Begründung hinzu.
    </div>
    <div class="form-group"><label>Bemerkung / Begründung <span style="font-size:11px;color:var(--muted)">(bei &gt;1 Woche empfohlen)</span></label>
      <textarea id="vr-note" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;resize:vertical" placeholder="z.B. Sommerurlaub, familiäre Gründe…"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" onclick="saveVacRequest()">📨 Antrag einreichen</button>
    </div>
    <script>calcVrDays()<\/script>`);
}

export function onVrTypeChange(){
  const t=document.getElementById('vr-type')?.value;
  const hint=document.getElementById('vr-krank-hint');
  if(hint) hint.style.display=t==='AU/Krank'?'block':'none';
  const modeWrap=document.getElementById('vr-count-mode-wrap');
  if(modeWrap) modeWrap.style.display=t==='Urlaub'?'block':'none';
  const hdWrap=document.getElementById('vr-halfday-wrap');
  if(hdWrap) hdWrap.style.display=t==='Urlaub'?'':'none';
  if(t!=='Urlaub'){ const cb=document.getElementById('vr-halfday'); if(cb) cb.checked=false; }
  calcVrDays();
}

export function calcVrDays(){
  const f=document.getElementById('vr-from')?.value;
  const t=document.getElementById('vr-to')?.value;
  const type=document.getElementById('vr-type')?.value||'Urlaub';
  const halfDay=!!(document.getElementById('vr-halfday')?.checked);
  const info=document.getElementById('vr-days-info');
  const hint=document.getElementById('vr-week-hint');
  const hdWrap=document.getElementById('vr-halfday-wrap');
  const modeWrap=document.getElementById('vr-count-mode-wrap');
  const singleDay=f&&t&&f===t;
  if(hdWrap) hdWrap.style.display=(type==='Urlaub')?'':'none';
  if(modeWrap) modeWrap.style.display=(type==='Urlaub')?'block':'none';
  const cb=document.getElementById('vr-halfday');
  if(cb&&!singleDay) cb.checked=false;
  if(!f||!t||f>t){ if(info) info.textContent=''; return; }
  const d2=getData();
  const empId=document.getElementById('vr-emp')?.value||'';
  const vrUser=empId?d2.users.find(u=>u.id===empId)||window.cu:window.cu;
  const weekdays=countWorkDays(f,t,vrUser); // Mo-Fr (mit Feiertagscheck)
  const dpw=Math.max(1,Math.min(7,vrUser?.dpw||5));
  const wh=vrUser?.wh||40;
  const hoursPerDay=Math.round((wh/dpw)*10)/10; // Stunden pro Urlaubstag
  const mode=document.querySelector('input[name="vr-mode"]:checked')?.value||'auto';
  // Auto-Wert nach Profil (Werktage pro Woche auf dpw gedeckelt)
  const autoDays=countVacationDays(f,t,vrUser);
  const autoHint=document.getElementById('vr-mode-auto-hint');
  if(autoHint) autoHint.textContent=`(${wh}h / ${dpw} Tage → ${hoursPerDay}h pro Urlaubstag)`;
  let effective;
  if(type==='Urlaub'&&mode==='manual'){
    effective=parseFloat(document.getElementById('vr-manual-days')?.value)||1;
    // Deckel: max 5 Urlaubstage pro Kalenderwoche (z.B. zum Minus-Ausgleich)
    const weeks=Math.max(1,Math.ceil(weekdays/5));
    effective=Math.min(effective,weeks*5);
  } else if(type==='Urlaub'){
    effective=halfDay&&singleDay?0.5:autoDays;
    const manualEl=document.getElementById('vr-manual-days');
    if(manualEl) manualEl.value=effective;
  } else {
    effective=halfDay&&singleDay?0.5:weekdays;
  }
  if(info) info.textContent=`→ ${effective} Urlaubstag${effective!==1?'e':''} à ${hoursPerDay}h`;
  if(hint) hint.style.display=weekdays>5?'block':'none';
}

export async function saveVacRequest(){
  const cu=window.cu;
  const type=document.getElementById('vr-type').value;
  const from=document.getElementById('vr-from').value;
  const to=document.getElementById('vr-to').value;
  const note=document.getElementById('vr-note')?.value.trim()||'';
  const halfDay=!!(type==='Urlaub'&&from===to&&document.getElementById('vr-halfday')?.checked);
  if(!from||!to){ toast('Bitte Zeitraum auswählen.','err'); return; }
  if(from>to){ toast('Startdatum muss vor dem Enddatum liegen.','err'); return; }
  const empSelVal=document.getElementById('vr-emp')?.value||'';
  const d=getData();
  const targetUser=empSelVal?d.users.find(u=>u.id===empSelVal)||cu:cu;
  const forOther=targetUser.id!==cu.id;
  const isSick=type==='AU/Krank';
  const isLeiter=cu.role==='leitung';
  const autoApprove=isSick||forOther||isLeiter||targetUser.role==='freiberuflich';
  const weekdays=countWorkDays(from,to,targetUser);
  const dpw=Math.max(1,Math.min(7,targetUser?.dpw||5));
  const mode=document.querySelector('input[name="vr-mode"]:checked')?.value||'auto';
  let wd;
  if(halfDay){ wd=0.5; }
  else if(type==='Urlaub'&&mode==='manual'){
    const weeks=Math.max(1,Math.ceil(weekdays/5));
    wd=Math.min(parseFloat(document.getElementById('vr-manual-days')?.value)||1,weeks*5);
  } else if(type==='Urlaub'){
    wd=countVacationDays(from,to,targetUser); // nach Profil (Werktage/Woche gedeckelt auf dpw)
  } else {
    wd=weekdays;
  }
  const key=`${targetUser.id}_${from}_${to}`;
  const now=new Date().toISOString();
  const req={
    id:key, userId:targetUser.id, userName:targetUser.name,
    team:getTeamForDate(targetUser,from)||(getLeitungTeams(targetUser)[0]||''),
    type, startDate:from, endDate:to, workDays:wd, halfDay:halfDay||false, note,
    status:autoApprove?'approved':'pending',
    submittedAt:now,
    reviewedBy:autoApprove?cu.id:null,
    reviewedAt:autoApprove?now:null,
    reviewNote:autoApprove&&forOther?`Eingetragen durch ${cu.name}`:''
  };
  await mutate(d=>{ if(!d.vacRequests) d.vacRequests={}; d.vacRequests[key]=req; });
  if(autoApprove) window.syncAbsenceToTimesheets?.(targetUser.id,targetUser,type,from,to,halfDay);
  closeModal(); renderAbwesenheiten();
  if(autoApprove) toast(`${isSick?'Krankmeldung':'Abwesenheit'} für ${targetUser.name} eingetragen. ✓`,'ok');
  else toast('Antrag eingereicht – wartet auf Genehmigung. ✓','ok');
}

export function showRejectModal(id){
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const fmtD=ds=>{ const[y,m,d]=ds.split('-'); return `${d}.${m}.${y}`; };
  openModal(`
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">Antrag ablehnen</h3>
    <p style="font-size:13px;margin-bottom:14px;color:var(--muted)">${esc(r.userName)}: ${r.type}, ${fmtD(r.startDate)} – ${fmtD(r.endDate)} (${r.workDays} AT)</p>
    <div class="form-group"><label>Ablehnungsgrund <span style="color:var(--danger)">*</span></label>
      <textarea id="reject-note" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;resize:vertical" placeholder="z.B. Veranstaltung kollidiert mit dem Termin am…"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-danger" onclick="confirmRejectVac('${id}')">✗ Ablehnen</button>
    </div>`);
}

export function approveVacRequest(id){
  const cu=window.cu;
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const fmtD=ds=>{ const[y,m,d]=ds.split('-'); return `${d}.${m}.${y}`; };
  if(!confirm(`Antrag von ${r.userName}\n${r.type}: ${fmtD(r.startDate)} – ${fmtD(r.endDate)}\n\nGenehmigen?\n\nDie Zeiterfassung für diese Tage wird automatisch befüllt.`)) return;
  mutate(d=>{ if(d.vacRequests?.[id]){ d.vacRequests[id].status='approved'; d.vacRequests[id].reviewedBy=cu.id; d.vacRequests[id].reviewedAt=new Date().toISOString(); } });
  const absUser=getUser(r.userId);
  if(absUser) window.syncAbsenceToTimesheets?.(r.userId,absUser,r.type,r.startDate,r.endDate,r.halfDay||false);
  renderAbwesenheiten(); toast('Antrag genehmigt – Zeiterfassung wurde befüllt. ✓','ok');
}

export function deleteVacRequest(id){
  const cu=window.cu;
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const mayManage=r.userId===cu.id||hasPermission('genehmigung_abwesenheit',cu.role);
  if(!mayManage) return;
  const isAuto=r.reviewNote==='Automatisch aus Zeiterfassung';
  const isLeiterSelf=r.status==='approved'&&getUser(r.userId)?.role==='leitung'&&r.userId===cu.id;
  // Stornierbar: offene Anträge, oder genehmigte die auto-erzeugt / AU / Leitung-eigen sind
  const cancellable=r.status==='pending'||(r.status==='approved'&&(r.type==='AU/Krank'||isLeiterSelf||isAuto));
  if(!cancellable) return;
  const clearsTimesheet=r.status==='approved'&&(r.type==='AU/Krank'||isLeiterSelf||isAuto);
  const fmtD=ds=>{ const[y,m,d]=ds.split('-'); return `${d}.${m}.${y}`; };
  const label=r.status==='pending'?'Antrag zurückziehen':'Abwesenheit stornieren';
  const extra=clearsTimesheet?'\n\nDie Zeiteinträge für diese Tage werden ebenfalls entfernt.':'';
  if(!confirm(`${label}?\n${r.type}: ${fmtD(r.startDate)} – ${fmtD(r.endDate)}${extra}`)) return;
  mutate(d=>{ if(d.vacRequests?.[id]) delete d.vacRequests[id]; });
  if(clearsTimesheet){
    const absUser=getUser(r.userId);
    if(absUser) window.clearAbsenceFromTimesheets?.(r.userId,absUser,r.type,r.startDate,r.endDate);
  }
  renderAbwesenheiten();
  toast(r.status==='pending'?'Antrag zurückgezogen.':'Abwesenheit storniert – Zeiteinträge entfernt.','');
}

export function confirmRejectVac(id){
  const cu=window.cu;
  const note=document.getElementById('reject-note').value.trim();
  if(!note){ toast('Bitte einen Ablehnungsgrund angeben.','err'); return; }
  mutate(d=>{ if(d.vacRequests?.[id]){ d.vacRequests[id].status='rejected'; d.vacRequests[id].reviewedBy=cu.id; d.vacRequests[id].reviewedAt=new Date().toISOString(); d.vacRequests[id].reviewNote=note; } });
  closeModal(); renderAbwesenheiten(); toast('Antrag abgelehnt.','err');
}

export function updateAbBadge(){
  const cu=window.cu;
  if(!cu) return;
  const reqs=Object.values(getData().vacRequests||{});
  let n=0;
  if(cu.role==='admin'){
    n=reqs.filter(r=>r.status==='pending').length;
  } else if(cu.role==='leitung'||cu.role==='geschaeftsfuehrer'){
    n=reqs.filter(r=>r.status==='pending'&&r.userId!==cu.id&&canSeeEmployee(cu,getUser(r.userId))).length;
  }
  const badge=document.getElementById('tab-ab-badge');
  if(badge){ badge.textContent=n; badge.style.display=n>0?'inline-block':'none'; }
}

function _syncAbViewButtons(){
  const mode=window.abViewMode||'list';
  const sub=window.abCalSubView||'month';
  const _btn=(id,active)=>{ const b=document.getElementById(id); if(!b) return; b.style.background=active?'var(--primary)':''; b.style.color=active?'#fff':''; b.style.borderColor=active?'var(--primary)':''; };
  _btn('btn-ab-list',mode==='list');
  _btn('btn-ab-cal',mode==='calendar');
  _btn('btn-ab-week',mode==='calendar'&&sub==='week');
  _btn('btn-ab-month',mode==='calendar'&&sub==='month');
  _btn('btn-ab-year2',mode==='calendar'&&sub==='year');
  const nav=document.getElementById('ab-cal-nav');
  if(nav) nav.style.display=mode==='calendar'?'flex':'none';
}

export function setAbView(mode){
  window.abViewMode=mode;
  _syncAbViewButtons();
  renderAbwesenheiten();
}

export function setAbSubView(sub){
  window.abCalSubView=sub;
  _syncAbViewButtons();
  renderAbwesenheiten();
}

// Einheitliche Navigation für Woche/Monat/Jahr
export function changeAbNav(delta){
  const sub=window.abCalSubView||'month';
  if(sub==='week'){
    const ms=new Date((window.abCalWeekStart||_thisMonday())+'T12:00:00');
    ms.setDate(ms.getDate()+delta*7);
    window.abCalWeekStart=ms.toISOString().slice(0,10);
  } else if(sub==='year'){
    window.abCalYear=(window.abCalYear||new Date().getFullYear())+delta;
  } else {
    window.abCalMon+=delta;
    if(window.abCalMon<1){window.abCalMon=12;window.abCalYear--;} if(window.abCalMon>12){window.abCalMon=1;window.abCalYear++;}
  }
  renderAbwesenheiten();
}

// Rückwärtskompatibilität
export function changeAbMonth(delta){ changeAbNav(delta); }

function _thisMonday(){
  const d=new Date(); const wd=d.getDay();
  d.setDate(d.getDate()-(wd===0?6:wd-1));
  return d.toISOString().slice(0,10);
}

export function renderAbCalendar(){
  const cu=window.cu;
  const d=getData();
  const y=window.abCalYear,m=window.abCalMon;
  const t=document.getElementById('ab-cal-title'); if(t) t.textContent=MONTHS[m-1]+' '+y;
  const reqs=Object.values(d.vacRequests||{});
  const visible=reqs.filter(r=>{ if(r.status!=='approved') return false; const u=getUser(r.userId); return u&&canSeeAbsence(cu,u); });
  const dayMap={};
  visible.forEach(r=>{
    let cur=new Date(r.startDate+'T12:00:00');
    const end=new Date(r.endDate+'T12:00:00');
    while(cur<=end){
      const dsX=dateStr(cur.getFullYear(),cur.getMonth()+1,cur.getDate());
      if(dsX.startsWith(`${y}-${String(m).padStart(2,'0')}`)){
        if(!dayMap[dsX]) dayMap[dsX]=[];
        dayMap[dsX].push({name:r.userName,type:r.type,userId:r.userId});
      }
      cur.setDate(cur.getDate()+1);
    }
  });
  const hols=getHolidays(y,cu.bundesland||'');
  const dim=daysInMonth(y,m);
  const today2=new Date(); const todayStr2=dateStr(today2.getFullYear(),today2.getMonth()+1,today2.getDate());
  const COLORS=['#dbeafe','#fee2e2','#d1fae5','#fef3c7','#ede9fe','#fce7f3','#ffedd5','#e0f2fe','#fef9c3','#f0fdf4'];
  const personMap=new Map();
  Object.values(dayMap).flat().forEach(a=>{ if(!personMap.has(a.userId)) personMap.set(a.userId,a.name); });
  const personList=[...personMap.entries()];
  const colorFor=uid=>COLORS[personList.findIndex(([id])=>id===uid)%COLORS.length]||'#e8f0fe';
  let cal='<div class="ab-cal-wrap">';
  if(personList.length>0){
    cal+='<div class="ab-cal-legend">';
    personList.forEach(([uid,name])=>{
      cal+=`<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${colorFor(uid)};border:1px solid rgba(0,0,0,.1)"></span>${esc(name)}</span>`;
    });
    cal+='</div>';
  }
  cal+='<div class="ab-cal-grid">';
  const GER_DAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
  GER_DAYS.forEach((dn,i)=>{ cal+=`<div class="ab-cal-dow${i>=5?' we':''}">${dn}</div>`; });
  const firstGer=(new Date(y,m-1,1).getDay()+6)%7;
  for(let i=0;i<firstGer;i++) cal+='<div class="ab-cal-day empty"></div>';
  for(let dd=1;dd<=dim;dd++){
    const ds=dateStr(y,m,dd);
    const dw=new Date(y,m-1,dd).getDay();
    const isWE=dw===0||dw===6;
    let cls='ab-cal-day'+(isWE?' weekend':'')+(hols.has(ds)?' holiday-cell':'')+(ds===todayStr2?' today-cell':'');
    const abs=dayMap[ds]||[];
    const badges=abs.map(a=>{
      const icon=a.type==='AU/Krank'?'🤒':a.type==='Urlaub'?'🏖':a.type==='Arbeitszeitausgleich'?'📋':'📌';
      const firstName=a.name.split(' ')[0];
      return `<span class="ab-cal-badge" style="background:${colorFor(a.userId)};color:#1a1a2e" title="${esc(a.name)}: ${esc(a.type)}">${icon} ${esc(firstName)}</span>`;
    }).join('');
    const holNote=hols.has(ds)?'<span style="font-size:9px;color:var(--danger);display:block">Feiertag</span>':'';
    cal+=`<div class="${cls}"><span class="ab-cal-dn${isWE?' we':''}">${dd}</span>${holNote}${badges}</div>`;
  }
  const total=firstGer+dim;
  const fill=(7-total%7)%7;
  for(let i=0;i<fill;i++) cal+='<div class="ab-cal-day empty"></div>';
  cal+='</div></div>';
  return cal;
}

export function renderAbwesenheiten(){
  const cu=window.cu;
  const abViewMode=window.abViewMode||'list';
  _syncAbViewButtons();
  if(abViewMode==='calendar'){
    const sub=window.abCalSubView||'month';
    let calHtml='';
    if(sub==='year') calHtml=renderAbCalendarYear();
    else if(sub==='week') calHtml=renderAbCalendarWeek();
    else calHtml=renderAbCalendar();
    let pendingHtml='';
    const d2=getData();
    const reqs2=Object.values(d2.vacRequests||{});
    const pending2=reqs2.filter(r=>{
      if(r.status!=='pending') return false;
      if(cu.role==='admin') return true;
      if((cu.role==='leitung'||cu.role==='geschaeftsfuehrer')&&r.userId!==cu.id){ const u=getUser(r.userId); return u&&canSeeEmployee(cu,u); }
      return false;
    });
    if(pending2.length){
      const fmtD2=ds=>{ const[yz,mz,dz]=ds.split('-'); return `${dz}.${mz}.`; };
      calHtml+=`<section style="margin-top:20px"><h3 style="font-size:14px;font-weight:700;color:var(--warn);margin-bottom:8px">⏳ Offene Anträge (${pending2.length})</h3>`
        +pending2.map(r=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--white);border:1.5px solid var(--warn);border-radius:8px;margin-bottom:6px;flex-wrap:wrap"><strong style="font-size:13px">${esc(r.userName)}</strong><span style="font-size:13px;color:var(--primary)">${esc(r.type)}: ${fmtD2(r.startDate)}–${fmtD2(r.endDate)}</span><div style="margin-left:auto;display:flex;gap:6px"><button class="btn btn-ok btn-sm" onclick="approveVacRequest('${r.id}')">✓</button><button class="btn btn-danger btn-sm" onclick="showRejectModal('${r.id}')">✗</button></div></div>`).join('')
        +'</section>';
    }
    document.getElementById('ab-content').innerHTML=calHtml;
    updateAbBadge();
    return;
  }
  const d=getData();
  const isAdmin=cu.role==='admin';
  const isLeitung=cu.role==='leitung';
  const isGF=cu.role==='geschaeftsfuehrer';
  const isMgr=isAdmin||isLeitung||isGF;
  const reqs=Object.values(d.vacRequests||{});
  const fmtD=ds=>{ if(!ds) return '–'; const[y,m,dd]=ds.split('-'); return `${dd}.${m}.${y}`; };
  const statusBadge=s=>({
    pending:'<span class="ab-status pending">⏳ Ausstehend</span>',
    approved:'<span class="ab-status approved">✓ Genehmigt</span>',
    rejected:'<span class="ab-status rejected">✗ Abgelehnt</span>'
  }[s]||'');
  const canReview=r=>{
    if(r.status!=='pending') return false;
    if(!hasPermission('genehmigung_abwesenheit',cu.role)) return false;
    if(isAdmin) return true;
    if(r.userId!==cu.id){ const u=getUser(r.userId); return u&&canSeeEmployee(cu,u); }
    return false;
  };
  const card=r=>{
    const showName=r.userId!==cu.id;
    const rnBtns=canReview(r)?`<div style="display:flex;gap:6px;margin-top:10px">
      <button class="btn btn-ok btn-sm" onclick="approveVacRequest('${r.id}')">✓ Genehmigen</button>
      <button class="btn btn-danger btn-sm" onclick="showRejectModal('${r.id}')">✗ Ablehnen</button>
    </div>`:'';
    const _isAuto=r.reviewNote==='Automatisch aus Zeiterfassung';
    const canDelete=(r.userId===cu.id||hasPermission('genehmigung_abwesenheit',cu.role))&&(r.status==='pending'||(r.status==='approved'&&(r.type==='AU/Krank'||cu.role==='leitung'||_isAuto)));
    const delLabel=r.status==='pending'?'🗑 Antrag zurückziehen':r.type==='AU/Krank'?'🗑 Krankmeldung stornieren':'🗑 Abwesenheit stornieren';
    const delBtn=canDelete
      ?`<div style="margin-top:8px"><button class="btn btn-sm" style="background:#fff;border:1.5px solid var(--danger);color:var(--danger);padding:6px 12px;font-size:12px" onclick="deleteVacRequest('${r.id}')">${delLabel}</button></div>`
      :'';
    const extra=r.status==='rejected'&&r.reviewNote?`<div style="font-size:11px;color:var(--danger);margin-top:4px">↩ Grund: ${esc(r.reviewNote)}</div>`:
                r.status==='approved'&&r.reviewNote?`<div style="font-size:11px;color:var(--ok);margin-top:4px">✓ ${esc(r.reviewNote)}</div>`:'';
    return `<div class="ab-card ab-${r.status}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
            ${showName?`<strong style="font-size:14px">${esc(r.userName)}</strong>`:''}
            <span style="font-size:13px;font-weight:600;color:var(--primary)">${esc(r.type)}</span>
            ${statusBadge(r.status)}
          </div>
          <div style="font-size:13px;margin-bottom:2px">📅 ${fmtD(r.startDate)} – ${fmtD(r.endDate)} · <strong>${r.workDays} Arbeitstag${r.workDays!==1?'e':''}</strong>${r.halfDay?` <span style="background:#e8f4fd;color:#1a5276;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:700">½ Tag</span>`:''}${r.team?` · ${esc(r.team)}`:''}</div>
          ${r.note?`<div style="font-size:12px;color:var(--muted);margin-top:2px">💬 ${esc(r.note)}</div>`:''}
          ${extra}${rnBtns}${delBtn}
        </div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap">${new Date(r.submittedAt).toLocaleDateString('de-DE')}</div>
      </div>
    </div>`;
  };
  const today=new Date(); today.setHours(0,0,0,0);
  const todayStr=today.toISOString().slice(0,10);
  const upcoming=reqs.filter(r=>{
    if(r.status!=='approved') return false;
    if(r.endDate<todayStr) return false;
    const u=r.userId===cu.id?cu:getUser(r.userId);
    return u&&canSeeAbsence(cu,u);
  }).sort((a,b)=>a.startDate.localeCompare(b.startDate));

  let upcomingHtml='';
  if(upcoming.length){
    const rows=upcoming.map(r=>{
      const start=new Date(r.startDate+'T12:00:00');
      const end=new Date(r.endDate+'T12:00:00');
      const daysUntil=Math.round((start-today)/86400000);
      const isActive=start<=today&&end>=today;
      const isSoon=!isActive&&daysUntil<=14;
      let badgeCls,badgeTxt;
      if(isActive){
        const remaining=Math.round((end-today)/86400000)+1;
        badgeCls='active'; badgeTxt=`Läuft · noch ${remaining} Tag${remaining!==1?'e':''}`;
      } else if(isSoon){
        badgeCls='soon'; badgeTxt=`in ${daysUntil} Tag${daysUntil!==1?'en':''}`;
      } else {
        badgeCls='later'; badgeTxt=`in ${daysUntil} Tagen`;
      }
      const showName=r.userId!==cu.id;
      const fmtShort=ds=>{ const[y,m,d]=ds.split('-'); return `${d}.${m}.`; };
      const typeIcon=r.type==='AU/Krank'?'🤒 ':r.type==='Urlaub'?'🏖 ':r.type==='Arbeitszeitausgleich'?'📋 ':'📌 ';
      return `<div class="upcoming-row${isActive?' today':isSoon?' soon':''}">
        ${showName?`<span class="upc-name">${esc(r.userName)}</span>`:'<span class="upc-name">Ich</span>'}
        <span class="upc-type">${typeIcon}${esc(r.type)}</span>
        <span class="upc-dates">📅 ${fmtShort(r.startDate)}–${fmtShort(r.endDate)}${new Date(r.startDate).getFullYear()!==today.getFullYear()?new Date(r.startDate).getFullYear():''} · ${r.workDays} AT${r.halfDay?' ½':''}${r.team?` · ${esc(r.team)}`:''}</span>
        <span class="upc-badge ${badgeCls}">${badgeTxt}</span>
      </div>`;
    }).join('');
    upcomingHtml=`<div class="upcoming-section">
      <h3>📅 Anstehende &amp; laufende Abwesenheiten <span style="font-size:12px;font-weight:400;color:var(--muted)">(${upcoming.length})</span></h3>
      <div class="upcoming-list">${rows}</div>
    </div>`;
  }

  let html=upcomingHtml;
  if(isMgr){
    const pending=reqs.filter(canReview).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    if(pending.length) html+=`<section style="margin-bottom:28px">
      <h3 style="font-size:15px;font-weight:700;color:var(--warn);margin-bottom:10px">⏳ Offene Anträge (${pending.length})</h3>
      ${pending.map(card).join('')}</section>`;
    const teamDone=reqs.filter(r=>{
      if(r.status==='pending'||r.userId===cu.id) return false;
      if(r.endDate<todayStr) return false;
      if(isAdmin) return true;
      const u=getUser(r.userId); return u&&canSeeAbsence(cu,u);
    }).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    if(teamDone.length) html+=`<section style="margin-bottom:28px">
      <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:10px">Team-Übersicht</h3>
      ${teamDone.map(card).join('')}</section>`;
  } else {
    const teamAbs=reqs.filter(r=>{
      if(r.userId===cu.id) return false;
      if(r.status!=='approved') return false;
      if(r.endDate<todayStr) return false;
      return true;
    }).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    if(teamAbs.length) html+=`<section style="margin-bottom:28px">
      <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:10px">Abwesenheiten im Unternehmen</h3>
      ${teamAbs.map(card).join('')}</section>`;
  }
  const myReqs=reqs.filter(r=>r.userId===cu.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const myActive=myReqs.filter(r=>r.endDate>=todayStr||r.status==='pending');
  const myPast=myReqs.filter(r=>r.endDate<todayStr&&r.status!=='pending');
  const pastToggle=myPast.length?`
    <details style="margin-top:10px">
      <summary style="cursor:pointer;font-size:13px;color:var(--muted);padding:6px 0;user-select:none">
        🕓 Vergangene Abwesenheiten (${myPast.length})
      </summary>
      <div style="margin-top:8px;opacity:.8">${myPast.map(card).join('')}</div>
    </details>`:'';
  html+=`<section>
    <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:10px">Meine Anträge</h3>
    ${myActive.length?myActive.map(card).join(''):'<p style="color:var(--muted);font-size:13px">Keine aktiven oder geplanten Abwesenheiten.</p>'}
    ${pastToggle}
  </section>`;
  document.getElementById('ab-content').innerHTML=html;
  updateAbBadge();
}

// ── Hilfsfunktionen für Kalender ──────────────────────────────────
function _buildDayMap(reqs,cu,filterFn){
  const COLORS=['#dbeafe','#fee2e2','#d1fae5','#fef3c7','#ede9fe','#fce7f3','#ffedd5','#e0f2fe','#fef9c3','#f0fdf4'];
  const visible=reqs.filter(r=>{
    if(r.status!=='approved') return false;
    const u=getUser(r.userId); return u&&canSeeAbsence(cu,u)&&(!filterFn||filterFn(r));
  });
  const dayMap={};
  visible.forEach(r=>{
    let cur=new Date(r.startDate+'T12:00:00');
    const end=new Date(r.endDate+'T12:00:00');
    while(cur<=end){
      const ds=dateStr(cur.getFullYear(),cur.getMonth()+1,cur.getDate());
      if(!dayMap[ds]) dayMap[ds]=[];
      dayMap[ds].push({name:r.userName,type:r.type,userId:r.userId});
      cur.setDate(cur.getDate()+1);
    }
  });
  const personMap=new Map();
  Object.values(dayMap).flat().forEach(a=>{ if(!personMap.has(a.userId)) personMap.set(a.userId,a.name); });
  const personList=[...personMap.entries()];
  const colorFor=uid=>COLORS[personList.findIndex(([id])=>id===uid)%COLORS.length]||'#e8f0fe';
  return {dayMap,personList,colorFor};
}

function _legend(personList,colorFor){
  if(!personList.length) return '';
  return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;font-size:12px">'
    +personList.map(([uid,name])=>`<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorFor(uid)};border:1px solid rgba(0,0,0,.1)"></span>${esc(name)}</span>`).join('')
    +'</div>';
}

// ── Wochenansicht ─────────────────────────────────────────────────
export function renderAbCalendarWeek(){
  const cu=window.cu;
  if(!window.abCalWeekStart) window.abCalWeekStart=_thisMonday();
  const monday=new Date(window.abCalWeekStart+'T12:00:00');
  const sunday=new Date(monday); sunday.setDate(sunday.getDate()+6);
  const d=getData();
  const reqs=Object.values(d.vacRequests||{});
  const{dayMap,personList,colorFor}=_buildDayMap(reqs,cu);
  const today=new Date(); const todayStr=dateStr(today.getFullYear(),today.getMonth()+1,today.getDate());
  const fmtShort=ds=>{ const[,m2,d2]=ds.split('-'); return `${d2}.${m2}.`; };
  const mondayStr=monday.toISOString().slice(0,10);
  const sundayStr=sunday.toISOString().slice(0,10);
  const GER=['Mo','Di','Mi','Do','Fr','Sa','So'];
  // Update title
  const t=document.getElementById('ab-cal-title');
  if(t) t.textContent=fmtShort(mondayStr)+' – '+fmtShort(sundayStr)+sunday.getFullYear();
  let html=_legend(personList,colorFor);
  html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
  for(let i=0;i<7;i++){
    const day=new Date(monday); day.setDate(day.getDate()+i);
    const ds=day.toISOString().slice(0,10);
    const dw=day.getDay(); // 0=Sun
    const isWE=dw===0||dw===6;
    const hols=getHolidays(day.getFullYear(),cu.bundesland||'');
    const isHol=hols.has(ds);
    const abs=dayMap[ds]||[];
    const isToday=ds===todayStr;
    html+=`<div style="background:#fff;border:${isToday?'2px solid var(--primary)':'1.5px solid var(--border)'};border-radius:8px;overflow:hidden">
      <div style="background:${isWE||isHol?'#f3f4f6':'var(--primary)'};color:${isWE||isHol?'var(--muted)':'#fff'};font-size:12px;font-weight:700;padding:5px 8px;text-align:center">
        ${GER[i]}<br><span style="font-size:11px;font-weight:400">${fmtShort(ds)}</span>${isHol?'<br><span style="font-size:9px;color:var(--danger)">Feiertag</span>':''}
      </div>
      <div style="padding:6px;min-height:60px">
        ${abs.length?abs.map(a=>{
          const icon=a.type==='AU/Krank'?'🤒':a.type==='Urlaub'?'🏖':a.type==='Arbeitszeitausgleich'?'📋':'📌';
          return `<div style="font-size:11px;padding:2px 4px;border-radius:4px;background:${colorFor(a.userId)};margin-bottom:2px">${icon} ${esc(a.name)}</div>`;
        }).join(''):'<span style="font-size:11px;color:var(--border)">–</span>'}
      </div>
    </div>`;
  }
  html+='</div>';
  return html;
}

// ── Jahresansicht ─────────────────────────────────────────────────
export function renderAbCalendarYear(){
  const cu=window.cu;
  const y=window.abCalYear||new Date().getFullYear();
  const d=getData();
  const reqs=Object.values(d.vacRequests||{});
  const{dayMap,personList,colorFor}=_buildDayMap(reqs,cu,r=>r.startDate.startsWith(y)||r.endDate.startsWith(y)||r.startDate.slice(0,4)===String(y)||r.endDate.slice(0,4)===String(y));
  const today=new Date(); const todayStr=dateStr(today.getFullYear(),today.getMonth()+1,today.getDate());
  // Update title
  const t=document.getElementById('ab-cal-title'); if(t) t.textContent=String(y);
  let html=_legend(personList,colorFor);
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">';
  for(let m=1;m<=12;m++){
    const hols=getHolidays(y,cu.bundesland||'');
    const dim=daysInMonth(y,m);
    const firstGer=(new Date(y,m-1,1).getDay()+6)%7;
    const GER_SHORT=['Mo','Di','Mi','Do','Fr','Sa','So'];
    const dowHeaders=GER_SHORT.map((dn,i)=>{
      const we=i>=5;
      return '<div style="text-align:center;font-weight:600;font-size:9px;color:'+(we?'var(--warn)':'var(--muted)')+'">'+dn+'</div>';
    }).join('');
    const empties=Array(firstGer).fill('<div></div>').join('');
    const days=Array.from({length:dim},(_,idx)=>{
      const dd=idx+1;
      const ds=dateStr(y,m,dd);
      const dw=new Date(y,m-1,dd).getDay();
      const isWE=dw===0||dw===6;
      const isHol=hols.has(ds);
      const abs=dayMap[ds]||[];
      const isToday=ds===todayStr;
      const bg=abs.length?colorFor(abs[0].userId):(isWE||isHol?'#f0f0f0':'');
      const bdr=isToday?'2px solid var(--primary)':'1px solid transparent';
      const tip=abs.map(a=>a.name+': '+a.type).join('\n')+(isHol?'\nFeiertag':'');
      const dot=abs.length>1?'<span style="position:absolute;top:0;right:0;width:4px;height:4px;border-radius:50%;background:var(--danger)"></span>':'';
      return '<div title="'+esc(tip)+'" style="position:relative;text-align:center;font-size:9px;padding:2px 0;border-radius:2px;background:'+bg+';border:'+bdr+'">'+dd+dot+'</div>';
    }).join('');
    html+='<div style="background:#fff;border:1.5px solid var(--border);border-radius:8px;overflow:hidden">'
      +'<div style="background:var(--primary);color:#fff;font-size:12px;font-weight:700;padding:5px 8px">'+MONTHS[m-1]+'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:4px;font-size:9px">'
      +dowHeaders+empties+days
      +'</div></div>';
  }
  html+='</div>';
  return html;
}
