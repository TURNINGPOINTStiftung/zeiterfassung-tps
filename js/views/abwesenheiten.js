import { MONTHS } from '../config.js';
import { getData, getUser, mutate, entryKey } from '../data.js';
import { canSeeEmployee, canSeeAbsence, getLeitungTeams, hasPermission, getTeamForDate } from '../roles.js';
import { esc, dateStr, daysInMonth, getHolidays, openModal, closeModal, toast, localISODate, jsArg as jsq } from '../utils.js';
import { vacDailyMin, dailyMinutes, vacStatus } from '../calc.js';

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
      const ds=localISODate(cur);
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
      const ds=localISODate(cur);
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

export function showVacRequestForm(editId){
  const cu=window.cu;
  const today=localISODate();
  const isMgr=cu.role==='leitung'||cu.role==='admin'||cu.role==='geschaeftsfuehrer';
  const d=getData();
  const editing=editId?d.vacRequests?.[editId]:null;
  window._vrEditId=editing?editId:null;
  window._vrEditDayTimes=editing?.dayTimes?{...editing.dayTimes}:{};
  const teamEmps=isMgr
    ? d.users.filter(u=>u.id!==cu.id&&canSeeEmployee(cu,u)&&!(u.exitDate&&u.exitDate<localISODate())) // Ausgetretene nicht mehr anbieten
    : [];
  const empSelector=isMgr&&teamEmps.length
    ? `<div class="form-group"><label>Für wen?</label>
        <select id="vr-emp" class="crm-ss" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px" onchange="calcVrDays()">
          <option value=""${(!editing||editing.userId===cu.id)?' selected':''}>– Mich selbst –</option>
          ${teamEmps.map(u=>`<option value="${esc(u.id)}"${editing&&editing.userId===u.id?' selected':''}>${esc(u.name)}</option>`).join('')}
        </select></div>`
    : '';
  const from=editing?editing.startDate:today;
  const to=editing?editing.endDate:today;
  const type=editing?editing.type:'Urlaub';
  const note=editing?.note||'';
  window._vrManualTouched=!!editing;
  openModal(`
    <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">${editing?'Abwesenheit bearbeiten':'Abwesenheit eintragen'}</h3>
    ${empSelector}
    <div class="form-group"><label>Art der Abwesenheit</label>
      <select id="vr-type" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px" onchange="onVrTypeChange()">
        <option value="Urlaub"${type==='Urlaub'?' selected':''}>Urlaub</option>
        <option value="AU/Krank"${type==='AU/Krank'?' selected':''}>AU / Krank</option>
        <option value="Arbeitszeitausgleich"${type==='Arbeitszeitausgleich'?' selected':''}>Arbeitszeitausgleich</option>
        <option value="Veranstaltung"${type==='Veranstaltung'?' selected':''}>Veranstaltung Krank / AU (mit Uhrzeiten)</option>
        <option value="Sonstiges"${type==='Sonstiges'?' selected':''}>Sonstiges</option>
      </select></div>
    <div id="vr-krank-hint" style="display:none;margin:-4px 0 10px;padding:8px 12px;background:var(--danger-bg,#fff5f5);border:1.5px solid var(--danger);border-radius:6px;font-size:12px;color:var(--danger-text,#721c24)">
      🤒 Krankmeldung – wird sofort als aktiv eingetragen (kein Genehmigungsschritt).
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Von</label><input type="date" id="vr-from" value="${esc(from)}" oninput="calcVrDays()"></div>
      <div class="form-group"><label>Bis (inkl.)</label><input type="date" id="vr-to" value="${esc(to)}" oninput="calcVrDays()"></div>
    </div>
    <div id="vr-va-wrap" style="display:none">
      <div style="background:var(--surface-2,#f8f9fb);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:600;color:var(--primary);margin-bottom:8px">Uhrzeiten pro Tag</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;margin-bottom:8px">
          <span style="color:var(--muted)">Für alle Tage:</span>
          <input type="time" id="va-all-von" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:6px">
          <span>–</span>
          <input type="time" id="va-all-bis" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:6px">
          <button type="button" class="btn btn-outline btn-sm" style="font-size:12px;padding:4px 10px" onclick="fillVADays()">Übernehmen</button>
        </div>
        <div id="vr-va-days" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto"></div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Tage ohne Uhrzeit werden nicht eingetragen · keine automatische Pause.</div>
      </div>
    </div>
    <div id="vr-halfday-wrap" style="display:none;margin:-4px 0 10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="vr-halfday" ${editing?.halfDay?'checked':''} onchange="calcVrDays()" style="width:16px;height:16px">
        <span>Halber Urlaubstag <span style="color:var(--muted);font-size:11px">(z.B. 4h bei 8h-Tag)</span></span>
      </label>
    </div>
    <div id="vr-sonstiges-wrap" style="display:none;margin:-4px 0 10px;background:var(--surface-2,#f8f9fb);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="vr-credit-work" ${editing?.creditWork?'checked':''} onchange="calcVrDays()" style="width:16px;height:16px">
        <span>Arbeitszeit gutschreiben <span style="color:var(--muted);font-size:11px">(nach Wochenarbeitszeit – z.B. Bildungsurlaub)</span></span>
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Wird als Arbeitszeit eingetragen und <b>muss</b> von Leitung/GF freigegeben werden.</div>
    </div>
    <div id="vr-count-mode-wrap" style="display:none;margin:-4px 0 12px;background:var(--surface-2,#f8f9fb);border:1.5px solid var(--border);border-radius:8px;padding:10px 12px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;flex-wrap:wrap">
        <span style="font-weight:600;color:var(--primary)">Urlaubstage:</span>
        <input type="number" id="vr-manual-days" min="0.5" max="60" step="0.5" value="${esc(editing?editing.workDays:1)}"
          style="width:80px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px"
          oninput="onVrManualDaysInput()">
        <span id="vr-mode-manual-hint" style="font-size:11px;color:var(--muted)"></span>
      </label>
    </div>
    <div id="vr-days-info" style="margin:-6px 0 10px;font-size:13px;color:var(--primary);font-weight:600"></div>
    <div id="vr-week-hint" style="display:none;margin-bottom:12px;padding:8px 12px;background:var(--warn-bg,#fffbf5);border:1.5px solid var(--warn);border-radius:6px;font-size:12px;color:var(--warn-text,#856404)">
      ⚠ Für Abwesenheiten über einer Woche ist ein formloser Antrag erforderlich. Bitte füge eine kurze Begründung hinzu.
    </div>
    <div class="form-group"><label>Bemerkung / Begründung <span style="font-size:11px;color:var(--muted)">(bei &gt;1 Woche empfohlen)</span></label>
      <textarea id="vr-note" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;resize:vertical" placeholder="z.B. Sommerurlaub, familiäre Gründe…">${esc(note)}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" id="vr-submit-btn" onclick="saveVacRequest()">${editing?'💾 Änderungen speichern':'📨 Antrag einreichen'}</button>
    </div>
    <script>onVrTypeChange()<\/script>`);
}

export function onVrTypeChange(){
  const t=document.getElementById('vr-type')?.value;
  const isVA=t==='Veranstaltung';
  const hint=document.getElementById('vr-krank-hint');
  if(hint) hint.style.display=t==='AU/Krank'?'block':'none';
  const modeWrap=document.getElementById('vr-count-mode-wrap');
  if(modeWrap) modeWrap.style.display=t==='Urlaub'?'block':'none';
  const hdWrap=document.getElementById('vr-halfday-wrap');
  if(hdWrap) hdWrap.style.display=t==='Urlaub'?'':'none';
  if(t!=='Urlaub'){ const cb=document.getElementById('vr-halfday'); if(cb) cb.checked=false; }
  const soWrap=document.getElementById('vr-sonstiges-wrap');
  if(soWrap) soWrap.style.display=t==='Sonstiges'?'':'none';
  if(t!=='Sonstiges'){ const cw=document.getElementById('vr-credit-work'); if(cw) cw.checked=false; }
  const vaWrap=document.getElementById('vr-va-wrap');
  if(vaWrap) vaWrap.style.display=isVA?'block':'none';
  const info=document.getElementById('vr-days-info'); if(info) info.style.display=isVA?'none':'';
  const btn=document.getElementById('vr-submit-btn'); if(btn) btn.textContent=window._vrEditId?'💾 Änderungen speichern':(isVA?'📅 Veranstaltung eintragen':'📨 Antrag einreichen');
  if(isVA) renderVADays();
  calcVrDays();
}

// Pro Tag im Zeitraum eine Zeile mit Von/Bis-Uhrzeit (Veranstaltung).
export function renderVADays(){
  const wrap=document.getElementById('vr-va-days'); if(!wrap) return;
  const f=document.getElementById('vr-from')?.value, t=document.getElementById('vr-to')?.value;
  if(!f||!t||f>t){ wrap.innerHTML='<div style="font-size:12px;color:var(--muted)">Bitte Zeitraum wählen.</div>'; return; }
  const prev={};
  wrap.querySelectorAll('.va-day').forEach(r=>{ prev[r.dataset.ds]={von:r.querySelector('.va-von')?.value||'',bis:r.querySelector('.va-bis')?.value||''}; });
  const editTimes=window._vrEditDayTimes||{};
  const DAYS=['So','Mo','Di','Mi','Do','Fr','Sa'];
  let html='', cur=new Date(f+'T12:00:00'); const end=new Date(t+'T12:00:00'); let n=0;
  while(cur<=end&&n<92){
    const y=cur.getFullYear(),m=cur.getMonth()+1,dd=cur.getDate();
    const ds=`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    const we=cur.getDay()===0||cur.getDay()===6;
    const p=prev[ds]||editTimes[ds]||{von:'',bis:''};
    html+=`<div class="va-day" data-ds="${ds}" style="display:flex;align-items:center;gap:8px">
      <span style="width:120px;font-size:12px;${we?'color:var(--warn)':''}">${DAYS[cur.getDay()]}, ${String(dd).padStart(2,'0')}.${String(m).padStart(2,'0')}.</span>
      <input type="time" class="va-von" value="${esc(p.von)}" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px">
      <span>–</span>
      <input type="time" class="va-bis" value="${esc(p.bis)}" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px">
    </div>`;
    cur.setDate(cur.getDate()+1); n++;
  }
  wrap.innerHTML=html;
}
export function fillVADays(){
  const von=document.getElementById('va-all-von')?.value||'';
  const bis=document.getElementById('va-all-bis')?.value||'';
  document.querySelectorAll('#vr-va-days .va-day').forEach(r=>{
    const v=r.querySelector('.va-von'), b=r.querySelector('.va-bis');
    if(v) v.value=von; if(b) b.value=bis;
  });
}

// Markiert "Anzahl selbst eingeben" als manuell angepasst, damit Datums-
// änderungen den Wert nicht mehr mit dem Profil-Vorschlag überschreiben.
export function onVrManualDaysInput(){
  window._vrManualTouched=true;
  calcVrDays();
}

export function calcVrDays(){
  const f=document.getElementById('vr-from')?.value;
  const t=document.getElementById('vr-to')?.value;
  const type=document.getElementById('vr-type')?.value||'Urlaub';
  if(type==='Veranstaltung'){ renderVADays(); const _i=document.getElementById('vr-days-info'); if(_i) _i.textContent=''; const _h=document.getElementById('vr-week-hint'); if(_h) _h.style.display='none'; return; }
  const halfDay=!!(document.getElementById('vr-halfday')?.checked);
  const info=document.getElementById('vr-days-info');
  const hint=document.getElementById('vr-week-hint');
  const hdWrap=document.getElementById('vr-halfday-wrap');
  const modeWrap=document.getElementById('vr-count-mode-wrap');
  const singleDay=f&&t&&f===t;
  // Halbe Urlaubstage nur, wenn beim betreffenden Mitarbeiter erlaubt (allowHalfVac).
  const _vrEmpId0=document.getElementById('vr-emp')?.value||'';
  const _vrU0=(_vrEmpId0?getData().users.find(u=>u.id===_vrEmpId0):null)||window.cu;
  const _halfAllowed=!!(_vrU0&&_vrU0.allowHalfVac!==false);
  if(hdWrap) hdWrap.style.display=(type==='Urlaub'&&_halfAllowed)?'':'none';
  if(modeWrap) modeWrap.style.display=(type==='Urlaub')?'block':'none';
  const cb=document.getElementById('vr-halfday');
  if(cb&&(!singleDay||!_halfAllowed)) cb.checked=false;
  if(!f||!t||f>t){ if(info) info.textContent=''; return; }
  const d2=getData();
  const empId=document.getElementById('vr-emp')?.value||'';
  const vrUser=empId?d2.users.find(u=>u.id===empId)||window.cu:window.cu;
  const weekdays=countWorkDays(f,t,vrUser); // Mo-Fr (mit Feiertagscheck)
  // Stunden pro Urlaubstag: Teilzeit=8h, Vollzeit/Leitung=Tagessoll (zentral in vacDailyMin).
  const hoursPerDay=Math.round(vacDailyMin(vrUser)/60*10)/10;
  // Vorschlag nach Profil (Werktage/Woche, ggf. dpw-gedeckelt) – frei überschreibbar.
  const autoDays=countVacationDays(f,t,vrUser);
  const manualHint=document.getElementById('vr-mode-manual-hint');
  if(manualHint) manualHint.textContent=`à ${hoursPerDay}h · frei änderbar`;
  let effective;
  if(type==='Urlaub'){
    const manualEl=document.getElementById('vr-manual-days');
    // Solange nicht selbst angepasst: bei Datumswechsel den Vorschlag übernehmen.
    if(manualEl&&!window._vrManualTouched) manualEl.value=(halfDay&&singleDay?0.5:autoDays);
    effective=parseFloat(manualEl?.value)||(halfDay&&singleDay?0.5:autoDays);
  } else {
    effective=halfDay&&singleDay?0.5:weekdays;
  }
  if(info){
    if(type==='Sonstiges'){
      // „Sonstiges" ist kein Urlaub: standardmäßig nur Vermerk (Datum von/bis genügt → keine
      // irreführende „X Urlaubstage à 8h"-Zeile). Mit Häkchen wird Arbeitszeit gutgeschrieben.
      const credit=!!document.getElementById('vr-credit-work')?.checked;
      if(credit){
        const dH=Math.round(dailyMinutes(vrUser)/60*10)/10;
        info.textContent=`→ ${weekdays} Tag${weekdays!==1?'e':''} à ${dH}h werden als Arbeitszeit gutgeschrieben · Freigabe durch Leitung/GF nötig`;
      } else {
        info.textContent='';
      }
    } else {
      let txt=`→ ${effective} Urlaubstag${effective!==1?'e':''} à ${hoursPerDay}h`;
      if(type==='Urlaub'&&(weekdays-effective)>=1){
        const rest=weekdays-effective;
        txt+=` · übrige ${rest} Tag${rest!==1?'e':''} im Zeitraum nur als Vermerk „Urlaub" (ohne Stunden)`;
      }
      info.textContent=txt;
    }
  }
  if(hint) hint.style.display=weekdays>5?'block':'none';
}

export async function saveVacRequest(){
  const cu=window.cu;
  const editId=window._vrEditId||null;
  window._vrEditId=null;
  const type=document.getElementById('vr-type').value;
  const from=document.getElementById('vr-from').value;
  const to=document.getElementById('vr-to').value;
  const note=document.getElementById('vr-note')?.value.trim()||'';
  const halfDay=!!(type==='Urlaub'&&from===to&&document.getElementById('vr-halfday')?.checked);
  if(!from||!to){ toast('Bitte Zeitraum auswählen.','err'); return; }
  if(from>to){ toast('Startdatum muss vor dem Enddatum liegen.','err'); return; }
  const empSelVal=document.getElementById('vr-emp')?.value||'';
  const d=getData();
  const old=editId?d.vacRequests?.[editId]:null;
  const targetUser=empSelVal?d.users.find(u=>u.id===empSelVal)||cu:(old?getUser(old.userId)||cu:cu);
  const forOther=targetUser.id!==cu.id;
  // Abwesenheiten in bereits eingereichte/genehmigte Monate sind gesperrt (außer Admin) –
  // sonst landet der Eintrag nicht in der Zeiterfassung bzw. würde abgegebene Daten
  // überschreiben. Klare Fehlermeldung statt stillem Durchlaufen.
  if(cu.role!=='admin'){
    const _locked=[];
    let _c=new Date(from+'T12:00:00'); const _e=new Date(to+'T12:00:00');
    while(_c<=_e){
      const _st=d.entries?.[entryKey(targetUser.id,_c.getFullYear(),_c.getMonth()+1)]?.status;
      const _lbl=MONTHS[_c.getMonth()]+' '+_c.getFullYear();
      if((_st==='submitted'||_st==='approved')&&!_locked.includes(_lbl)) _locked.push(_lbl);
      _c.setDate(_c.getDate()+1);
    }
    if(_locked.length){
      toast(`Nicht möglich: ${_locked.join(', ')} wurde bereits eingereicht/genehmigt. Bitte den Monat erst zurückziehen lassen.`,'err');
      return;
    }
  }
  // ── Veranstaltung: pro Tag eigene Uhrzeiten → direkt in die Zeiterfassung (keine Pause) ──
  if(type==='Veranstaltung'){
    const dayTimes={};
    document.querySelectorAll('#vr-va-days .va-day').forEach(r=>{
      const ds=r.dataset.ds;
      const von=r.querySelector('.va-von')?.value||'';
      const bis=r.querySelector('.va-bis')?.value||'';
      if(von&&bis&&von<bis) dayTimes[ds]={von,bis};
    });
    const dsKeys=Object.keys(dayTimes);
    if(!dsKeys.length){ toast('Bitte für mindestens einen Tag Von- und Bis-Uhrzeit angeben.','err'); return; }
    const key=`${targetUser.id}_VA_${from}_${to}`;
    const now=new Date().toISOString();
    const req={ id:key, userId:targetUser.id, userName:targetUser.name,
      team:getTeamForDate(targetUser,from)||(getLeitungTeams(targetUser)[0]||''),
      type:'Veranstaltung', startDate:from, endDate:to, workDays:dsKeys.length, halfDay:false, note,
      dayTimes, status:'approved', submittedAt:old?old.submittedAt:now, reviewedBy:cu.id, reviewedAt:now,
      reviewNote:forOther?`Eingetragen durch ${cu.name}`:'' };
    if(old){
      const oldUser=getUser(old.userId)||targetUser;
      window.clearAbsenceFromTimesheets?.(old.userId,oldUser,'Veranstaltung',old.startDate,old.endDate);
      if(editId!==key) await mutate(d=>{ if(d.vacRequests?.[editId]) delete d.vacRequests[editId]; });
    }
    await mutate(d=>{ if(!d.vacRequests) d.vacRequests={}; d.vacRequests[key]=req; });
    const _vr=window.syncVeranstaltungToTimesheets?.(targetUser.id,dayTimes,note)||{};
    closeModal(); renderAbwesenheiten();
    if(_vr.skipped>0) toast(`Veranstaltung gespeichert – aber ${_vr.skipped} Tag(e) liegen in bereits eingereichten/genehmigten Monaten und wurden NICHT in die Zeiterfassung geschrieben.`,'err');
    else toast(`Veranstaltung für ${targetUser.name} ${old?'aktualisiert':'eingetragen'} (${dsKeys.length} Tag${dsKeys.length!==1?'e':''}). ✓`,'ok');
    return;
  }
  const isSick=type==='AU/Krank';
  const isLeiter=cu.role==='leitung';
  const weekdays=countWorkDays(from,to,targetUser);
  // „Sonstiges" mit Arbeitszeit-Gutschrift (z.B. Bildungsurlaub): optional, pro Gerät am Häkchen.
  const creditWork=type==='Sonstiges'&&!!document.getElementById('vr-credit-work')?.checked;
  let wd;
  if(halfDay){ wd=0.5; }
  else if(type==='Urlaub'){
    // Frei eingegebene Anzahl Urlaubstage (Vorschlag war countVacationDays).
    wd=parseFloat(document.getElementById('vr-manual-days')?.value)||countVacationDays(from,to,targetUser);
  } else {
    wd=weekdays;
  }
  // Stunden pro Tag: Urlaub=Urlaubswert (Teilzeit 8h/Vollzeit Tagessoll); Sonstiges mit
  // Gutschrift=Tagesarbeitszeit (wh/dpw); sonst keine Stunden.
  const hoursPerDay=type==='Urlaub'?Math.round(vacDailyMin(targetUser)/60*10)/10
    :(creditWork?Math.round(dailyMinutes(targetUser)/60*10)/10:null);
  // Genehmigung durch die Leitung nur ab 5 Arbeitstagen Abwesenheit nötig –
  // alles darunter läuft automatisch durch (zusätzlich zu den bisherigen
  // Auto-Genehmigungs-Fällen: Krank, Eintrag für andere, Leitung selbst, Freiberufler).
  // GF genehmigt niemandem gegenüber → eigener Urlaub läuft immer automatisch durch.
  // AUSNAHME: „Sonstiges" mit Arbeitszeit-Gutschrift MUSS immer von Leitung/GF freigegeben
  // werden (kein Auto-Durchlauf über die <5-Tage-Regel) – außer ein Manager trägt es selbst ein.
  const autoApprove=isSick||forOther||isLeiter||targetUser.role==='freiberuflich'||targetUser.role==='geschaeftsfuehrer'||(wd<5&&!creditWork);
  const key=`${targetUser.id}_${from}_${to}`;
  const now=new Date().toISOString();
  if(old){
    const oldUser=getUser(old.userId)||targetUser;
    if(old.status==='approved') window.clearAbsenceFromTimesheets?.(old.userId,oldUser,old.type,old.startDate,old.endDate);
    if(editId!==key) await mutate(d=>{ if(d.vacRequests?.[editId]) delete d.vacRequests[editId]; });
  }
  const req={
    id:key, userId:targetUser.id, userName:targetUser.name,
    team:getTeamForDate(targetUser,from)||(getLeitungTeams(targetUser)[0]||''),
    type, startDate:from, endDate:to, workDays:wd, halfDay:halfDay||false, note,
    hoursPerDay, creditWork,
    status:autoApprove?'approved':'pending',
    submittedAt:old?old.submittedAt:now,
    reviewedBy:autoApprove?cu.id:null,
    reviewedAt:autoApprove?now:null,
    reviewNote:autoApprove&&forOther?`Eingetragen durch ${cu.name}`:''
  };
  await mutate(d=>{ if(!d.vacRequests) d.vacRequests={}; d.vacRequests[key]=req; });
  if(autoApprove) window.syncAbsenceToTimesheets?.(targetUser.id,targetUser,type,from,to,halfDay,hoursPerDay,wd,creditWork);
  closeModal(); renderAbwesenheiten();
  if(old){
    toast(autoApprove?'Abwesenheit aktualisiert. ✓':'Abwesenheit aktualisiert – wartet erneut auf Genehmigung der Leitung. ✓','ok');
  } else if(autoApprove) toast(`${isSick?'Krankmeldung':'Abwesenheit'} für ${targetUser.name} eingetragen. ✓`,'ok');
  else toast('Antrag eingereicht – wartet auf Genehmigung. ✓','ok');
}

export function showRejectModal(id){
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const fmtD=ds=>{ const[y,m,d]=String(ds||'').split('-'); return esc(`${d}.${m}.${y}`); };
  openModal(`
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">Antrag ablehnen</h3>
    <p style="font-size:13px;margin-bottom:14px;color:var(--muted)">${esc(r.userName)}: ${esc(r.type)}, ${fmtD(r.startDate)} – ${fmtD(r.endDate)} (${esc(r.workDays)} AT)</p>
    <div class="form-group"><label>Ablehnungsgrund <span style="color:var(--danger)">*</span></label>
      <textarea id="reject-note" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;resize:vertical" placeholder="z.B. Veranstaltung kollidiert mit dem Termin am…"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-danger" onclick="confirmRejectVac(${jsq(id)})">✗ Ablehnen</button>
    </div>`);
}

export function approveVacRequest(id){
  const cu=window.cu;
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const fmtD=ds=>{ const[y,m,d]=String(ds||'').split('-'); return esc(`${d}.${m}.${y}`); };
  if(!confirm(`Antrag von ${r.userName}\n${r.type}: ${fmtD(r.startDate)} – ${fmtD(r.endDate)}\n\nGenehmigen?\n\nDie Zeiterfassung für diese Tage wird automatisch befüllt.`)) return;
  mutate(d=>{ if(d.vacRequests?.[id]){ d.vacRequests[id].status='approved'; d.vacRequests[id].reviewedBy=cu.id; d.vacRequests[id].reviewedAt=new Date().toISOString(); } });
  const absUser=getUser(r.userId);
  if(absUser) window.syncAbsenceToTimesheets?.(r.userId,absUser,r.type,r.startDate,r.endDate,r.halfDay||false,r.hoursPerDay,r.workDays,r.creditWork);
  renderAbwesenheiten(); toast('Antrag genehmigt – Zeiterfassung wurde befüllt. ✓','ok');
}

export function deleteVacRequest(id){
  const cu=window.cu;
  const r=getData().vacRequests?.[id];
  if(!r) return;
  const mayManage=r.userId===cu.id||hasPermission('genehmigung_abwesenheit',cu);
  if(!mayManage) return;
  // Offene Anträge: zurückziehen darf der/die Antragsteller:in oder ein Genehmiger.
  // GENEHMIGTE Abwesenheiten: nur noch der/die Mitarbeiter:in selbst oder der Admin
  // dürfen stornieren – NICHT mehr die Leitung.
  const cancellable=(r.status==='pending'&&mayManage)
                  ||(r.status==='approved'&&(r.userId===cu.id||cu.role==='admin'));
  if(!cancellable) return;
  const clearsTimesheet=r.status==='approved';
  const fmtD=ds=>{ const[y,m,d]=String(ds||'').split('-'); return esc(`${d}.${m}.${y}`); };
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
  const _btn=(id,active)=>{ const b=document.getElementById(id); if(!b) return; b.style.background=active?'var(--primary)':''; b.style.color=active?'var(--on-primary)':''; b.style.borderColor=active?'var(--primary)':''; };
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
    window.abCalWeekStart=localISODate(ms);
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
  return localISODate(d);
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
        dayMap[dsX].push({name:r.userName||((getUser(r.userId)||{}).name)||String(r.userId||'?'),type:r.type,userId:r.userId});
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
      const firstName=a.name.split(' ')[0];
      return `<span class="ab-cal-badge" style="background:${_typeBg(a.type)};color:${_typeFg(a.type)}" title="${esc(a.name)}: ${esc(a.type)}">${esc(firstName)}</span>`;
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

// ── Farben je Art (v516, User 30.10.2026): Urlaub blau · Krank rot · Ausgleich grün · Sonstiges gelb ──
const _AB_TYPES=[['Urlaub','Urlaub','info','#378ADD'],['AU/Krank','Krank','danger','#E24B4A'],['Arbeitszeitausgleich','Ausgleich','ok','#1D9E75'],['Sonstiges','Sonstiges','warn','#BA7517']];
function _abType(t){ return _AB_TYPES.find(x=>x[0]===t) || _AB_TYPES[3]; }
function _typeBg(t){ return `var(--${_abType(t)[2]}-bg)`; }
function _typeFg(t){ return `var(--${_abType(t)[2]}-text)`; }
function _typeBar(t){ return _abType(t)[3]; }
function _typeLegend(){
  return '<div class="ab-type-legend">'+_AB_TYPES.map(([,l,c,b])=>`<span><span class="ab-dot" style="background:${b}"></span>${esc(l)}</span>`).join('')+'</div>';
}
// Titel der Kalender-Navigation (Woche / Monat / Jahr)
function _abCalTitle(){
  const sub=window.abCalSubView||'month';
  if(sub==='year') return String(window.abCalYear||new Date().getFullYear());
  if(sub==='week'){ const mo=new Date((window.abCalWeekStart||_thisMonday())+'T12:00:00'); const su=new Date(mo); su.setDate(su.getDate()+6);
    const f=d=>String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'; return f(mo)+' – '+f(su)+su.getFullYear(); }
  return MONTHS[(window.abCalMon||1)-1]+' '+window.abCalYear;
}
export function setAbTab(t){ window.abTab=t; renderAbwesenheiten(); }
window.setAbTab=setAbTab;   // neu in v516 → über window (kein benannter Import in main.js, siehe CLAUDE.md)

// Neuer Aufbau (v516): Reiter Übersicht (Kalender + Liste nebeneinander) · Meine Abwesenheiten · Team · Genehmigen
export function renderAbwesenheiten(){
  const cu=window.cu;
  if(!window.abCalYear){ const n=new Date(); window.abCalYear=n.getFullYear(); window.abCalMon=n.getMonth()+1; }
  // alte Kopf-Knöpfe aus index.html ausblenden (Ansicht steuert sich jetzt selbst)
  ['btn-ab-list','btn-ab-cal'].forEach(id=>{ const b=document.getElementById(id); if(b) b.style.display='none'; });
  document.querySelectorAll('#view-abwesenheiten > div:first-child button').forEach(b=>{ b.style.display='none'; });   // alter Kopf (Gerätecache)
  const nav0=document.getElementById('ab-cal-nav'); if(nav0) nav0.style.display='none';
  const d=getData();
  const isAdmin=cu.role==='admin';
  const isLeitung=cu.role==='leitung';
  const isGF=cu.role==='geschaeftsfuehrer';
  const isMgr=isAdmin||isLeitung||isGF;
  const reqs=Object.values(d.vacRequests||{});
  const fmtD=ds=>{ if(!ds) return '–'; const[y,m,dd]=String(ds||'').split('-'); return esc(`${dd}.${m}.${y}`); };
  const WD=['So','Mo','Di','Mi','Do','Fr','Sa'];
  const fmtW=ds=>{ if(!ds) return '–'; const x=new Date(ds+'T12:00:00'); const[,m,dd]=String(ds).split('-'); return esc(`${WD[x.getDay()]} ${dd}.${m}.`); };
  const statusBadge=s=>({
    pending:'<span class="ab-status pending">⏳ Ausstehend</span>',
    approved:'<span class="ab-status approved">✓ Genehmigt</span>',
    rejected:'<span class="ab-status rejected">✗ Abgelehnt</span>'
  }[s]||'');
  const _typeLabel=t=>t==='Veranstaltung'?'Veranstaltung Krank / AU':t;
  const canReview=r=>{
    if(r.status!=='pending') return false;
    if(!hasPermission('genehmigung_abwesenheit',cu)) return false;
    if(isAdmin) return true;
    if(r.userId!==cu.id){ const u=getUser(r.userId); return u&&canSeeEmployee(cu,u); }
    return false;
  };
  const card=r=>{
    const showName=r.userId!==cu.id;
    const rnBtns=canReview(r)?`<div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-ok btn-sm" onclick="approveVacRequest(${jsq(r.id)})">✓ Genehmigen</button>
      <button class="btn btn-danger btn-sm" onclick="showRejectModal(${jsq(r.id)})">✗ Ablehnen</button>
    </div>`:'';
    const canDelete=(r.status==='pending'&&(r.userId===cu.id||hasPermission('genehmigung_abwesenheit',cu)))
                  ||(r.status==='approved'&&(r.userId===cu.id||cu.role==='admin'));
    const canEdit=r.userId===cu.id||cu.role==='admin';
    const delLabel=r.status==='pending'?'Antrag zurückziehen':r.type==='AU/Krank'?'Krankmeldung stornieren':'Stornieren';
    const acts=[canEdit?`<button class="btn btn-outline btn-sm ab-mini" onclick="showVacRequestForm(${jsq(r.id)})">✏️ Bearbeiten</button>`:'',
      canDelete?`<button class="btn btn-sm ab-mini ab-del" onclick="deleteVacRequest(${jsq(r.id)})">🗑 ${delLabel}</button>`:''].filter(Boolean).join('');
    const extra=r.status==='rejected'&&r.reviewNote?`<div style="font-size:12px;color:var(--danger-text);margin-top:4px">↩ Grund: ${esc(r.reviewNote)}</div>`:
                r.status==='approved'&&r.reviewNote?`<div style="font-size:12px;color:var(--ok-text);margin-top:4px">✓ ${esc(r.reviewNote)}</div>`:'';
    return `<div class="ab-card2" style="border-left-color:${_typeBar(r.type)}">
      <div class="ab-c2-top">
        ${showName?`<strong>${esc(r.userName)}</strong>`:''}
        <span class="ab-type" style="background:${_typeBg(r.type)};color:${_typeFg(r.type)}">${esc(_typeLabel(r.type))}</span>
        ${statusBadge(r.status)}
        <span class="ab-c2-sub">${r.submittedAt&&!isNaN(Date.parse(r.submittedAt))?'beantragt '+new Date(r.submittedAt).toLocaleDateString('de-DE'):''}</span>
      </div>
      <div class="ab-c2-date">📅 ${fmtW(r.startDate)}${r.endDate!==r.startDate?' – '+fmtW(r.endDate):''}${String(r.endDate).slice(0,4)!==String(new Date().getFullYear())?' '+esc(String(r.endDate).slice(0,4)):''} · <strong>${esc(r.workDays)} Arbeitstag${r.workDays!==1?'e':''}</strong>${r.halfDay?' · ½ Tag':''}</div>
      ${r.note?`<div class="ab-c2-sub" style="margin-top:2px">💬 ${esc(r.note)}</div>`:''}
      ${extra}${rnBtns}${acts?`<div class="ab-c2-acts">${acts}</div>`:''}
    </div>`;
  };
  const today=new Date(); today.setHours(0,0,0,0);
  const todayStr=localISODate(today);
  const noon=new Date(today); noon.setHours(12,0,0,0);
  const pending=reqs.filter(canReview).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  const tabs=[['uebersicht','Übersicht'],['meine','Meine Abwesenheiten']].concat(isMgr?[['team','Team · Genehmigen']]:[]);
  let tab=window.abTab||'uebersicht'; if(!tabs.some(t=>t[0]===tab)) tab='uebersicht';
  const tabBar=`<div class="ab-tabs">${tabs.map(([k,l])=>`<button class="ab-tab${k===tab?' on':''}" onclick="setAbTab(${jsq(k)})">${esc(l)}${k==='team'&&pending.length?` <span class="ab-cnt">${pending.length}</span>`:''}</button>`).join('')}
    <button class="btn btn-ok btn-sm" style="margin-left:auto" onclick="showVacRequestForm()">＋ Abwesenheit eintragen</button></div>`;
  let html=tabBar;

  if(tab==='uebersicht'){
    if(pending.length && isMgr) html+=`<div class="ab-hint" onclick="setAbTab('team')">⏳ ${pending.length} offene${pending.length===1?'r':''} Antrag${pending.length===1?'':'e'} ${pending.length===1?'wartet':'warten'} auf deine Genehmigung – im Reiter „Team · Genehmigen“ ›</div>`;
    const sub=window.abCalSubView||'month';
    const calHtml=sub==='year'?renderAbCalendarYear():(sub==='week'?renderAbCalendarWeek():renderAbCalendar());
    const sb=(k,l)=>`<button class="ab-seg${sub===k?' on':''}" onclick="setAbSubView(${jsq(k)})">${l}</button>`;
    const calCard=`<div class="ab-box ab-calbox">
      <div class="ab-calnav"><button class="btn btn-outline btn-sm" onclick="changeAbNav(-1)" aria-label="zurück">◀</button>
        <b>${esc(_abCalTitle())}</b><button class="btn btn-outline btn-sm" onclick="changeAbNav(1)" aria-label="weiter">▶</button>
        <span class="ab-segs">${sb('week','Woche')}${sb('month','Monat')}${sb('year','Jahr')}</span></div>
      ${_typeLegend()}${calHtml}</div>`;
    const upcoming=reqs.filter(r=>{
      if(r.status!=='approved') return false;
      if(r.endDate<todayStr) return false;
      const u=r.userId===cu.id?cu:getUser(r.userId);
      return u&&canSeeAbsence(cu,u);
    }).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    const rowHtml=r=>{
      const start=new Date(r.startDate+'T12:00:00'), end=new Date(r.endDate+'T12:00:00');
      const daysUntil=Math.round((start-noon)/86400000);
      const isActive=start<=noon&&end>=noon;
      let cls,txt;
      if(isActive){ const rem=Math.round((end-noon)/86400000)+1; cls='active'; txt=rem<=1?'endet heute':`läuft · noch ${rem} Tage`; }
      else if(daysUntil<=14){ cls='soon'; txt=daysUntil===1?'ab morgen':`in ${daysUntil} Tagen`; }
      else { cls='later'; txt=`in ${daysUntil} Tagen`; }
      return `<div class="ab-row" style="border-left-color:${_typeBar(r.type)}">
        <div class="ab-row-l"><div><strong>${r.userId===cu.id?'Ich':esc(r.userName)}</strong> · <span style="color:${_typeFg(r.type)}">${esc(_typeLabel(r.type))}</span></div>
          <div class="ab-c2-sub">${fmtW(r.startDate)}${r.endDate!==r.startDate?' – '+fmtW(r.endDate):''} · ${esc(r.workDays)} AT${r.halfDay?' ½':''}</div></div>
        <span class="upc-badge ${cls}">${txt}</span></div>`;
    };
    // Nur die nächsten 40 Tage offen zeigen, der Rest ist ausklappbar (v517, User 30.10.2026)
    const lim=new Date(noon); lim.setDate(lim.getDate()+40); const limStr=localISODate(lim);
    const nah=upcoming.filter(r=>r.startDate<=limStr), spaeter=upcoming.filter(r=>r.startDate>limStr);
    const rowsOf=list=>list.map(r=>rowHtml(r)).join('');
    const listCard=`<div class="ab-box ab-listbox"><div class="ab-box-h">Laufend und nächste 40 Tage <span class="ab-c2-sub">(${nah.length})</span></div>
      ${nah.length?rowsOf(nah):'<div class="ab-c2-sub" style="padding:8px 0">In den nächsten 40 Tagen ist niemand abwesend.</div>'}
      ${spaeter.length?`<details class="ab-later"${window._abLaterOpen?' open':''} ontoggle="window._abLaterOpen=this.open"><summary class="ab-sum">Später (${spaeter.length})</summary>${rowsOf(spaeter)}</details>`:''}</div>`;
    html+=`<div class="ab-grid">${calCard}${listCard}</div>`;
  }

  if(tab==='meine'){
    let vs=null; try{ const u=getUser(cu.id)||cu; if(u && u.role!=='freiberuflich' && u.role!=='admin') vs=vacStatus(cu.id,u,today.getFullYear(),today.getMonth()+1); }catch(e){ vs=null; }
    if(vs) html+=`<div class="ab-box" style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;margin-bottom:14px">
      <span><span class="ab-c2-sub">Resturlaub ${today.getFullYear()}</span><br><b style="font-size:20px">${esc(vs.left+vs.carryLeft)} Tage</b></span>
      ${vs.carryLeft>0?`<span class="ab-c2-sub">davon ${esc(vs.carryLeft)} aus ${today.getFullYear()-1} (nur im Januar)</span>`:''}
      ${vs.future>0?`<span class="ab-c2-sub">${esc(vs.future)} Tage bereits geplant</span>`:''}
      <span class="ab-c2-sub">Jahresanspruch ${esc(vs.annual)} Tage</span></div>`;
    const myReqs=reqs.filter(r=>r.userId===cu.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
    const myActive=myReqs.filter(r=>r.endDate>=todayStr||r.status==='pending').sort((a,b)=>a.startDate.localeCompare(b.startDate));
    const myPast=myReqs.filter(r=>r.endDate<todayStr&&r.status!=='pending');
    html+=`<section>${myActive.length?myActive.map(card).join(''):'<div class="empty-state"><span class="es-icon">🏖️</span><span>Keine aktiven oder geplanten Abwesenheiten.</span></div>'}
      ${myPast.length?`<details style="margin-top:10px"><summary class="ab-sum">🕓 Vergangene Abwesenheiten (${myPast.length})</summary><div style="margin-top:8px">${myPast.map(card).join('')}</div></details>`:''}</section>`;
  }

  if(tab==='team' && isMgr){
    html+=`<section style="margin-bottom:22px"><h3 class="ab-h3" style="color:var(--warn-text)">⏳ Offene Anträge (${pending.length})</h3>
      ${pending.length?pending.map(card).join(''):'<div class="ab-c2-sub">Keine offenen Anträge.</div>'}</section>`;
    const teamDone=reqs.filter(r=>{
      if(r.status==='pending'||r.userId===cu.id) return false;
      if(r.endDate<todayStr) return false;
      if(isAdmin) return true;
      const u=getUser(r.userId); return u&&canSeeAbsence(cu,u);
    }).sort((a,b)=>a.startDate.localeCompare(b.startDate));
    html+=`<section style="margin-bottom:22px"><h3 class="ab-h3">Team-Übersicht – laufend und geplant</h3>
      ${teamDone.length?teamDone.map(card).join(''):'<div class="ab-c2-sub">Keine laufenden oder geplanten Abwesenheiten.</div>'}</section>`;
    if(isAdmin){
      const allPast=reqs.filter(r=>r.status==='approved'&&r.endDate<todayStr&&r.userId!==cu.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
      if(allPast.length) html+=`<section><details><summary class="ab-sum">🕓 Vergangene Abwesenheiten – alle Mitarbeitenden (${allPast.length})</summary>
        <div style="margin-top:10px">${allPast.map(card).join('')}</div></details></section>`;
    }
  }
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
      dayMap[ds].push({name:r.userName||((getUser(r.userId)||{}).name)||String(r.userId||'?'),type:r.type,userId:r.userId});
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
  const fmtShort=ds=>{ const[,m2,d2]=String(ds||'').split('-'); return esc(`${d2}.${m2}.`); };
  const mondayStr=localISODate(monday);
  const sundayStr=localISODate(sunday);
  const GER=['Mo','Di','Mi','Do','Fr','Sa','So'];
  // Update title
  const t=document.getElementById('ab-cal-title');
  if(t) t.textContent=fmtShort(mondayStr)+' – '+fmtShort(sundayStr)+sunday.getFullYear();
  let html='<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">';
  for(let i=0;i<7;i++){
    const day=new Date(monday); day.setDate(day.getDate()+i);
    const ds=localISODate(day);
    const dw=day.getDay(); // 0=Sun
    const isWE=dw===0||dw===6;
    const hols=getHolidays(day.getFullYear(),cu.bundesland||'');
    const isHol=hols.has(ds);
    const abs=dayMap[ds]||[];
    const isToday=ds===todayStr;
    html+=`<div style="background:var(--surface,#fff);border:${isToday?'2px solid var(--primary)':'1.5px solid var(--border)'};border-radius:8px;overflow:hidden">
      <div style="background:${isWE||isHol?'#f3f4f6':'var(--primary)'};color:${isWE||isHol?'var(--muted)':'#fff'};font-size:12px;font-weight:700;padding:5px 8px;text-align:center">
        ${GER[i]}<br><span style="font-size:11px;font-weight:400">${fmtShort(ds)}</span>${isHol?'<br><span style="font-size:9px;color:var(--danger)">Feiertag</span>':''}
      </div>
      <div style="padding:6px;min-height:60px">
        ${abs.length?abs.map(a=>{
          return `<div style="font-size:11px;padding:2px 4px;border-radius:4px;background:${_typeBg(a.type)};color:${_typeFg(a.type)};margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.name)}: ${esc(a.type)}">${esc(a.name.split(' ')[0])}</div>`;
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
  let html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px">';
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
      const bg=abs.length?_typeBg(abs[0].type):(isWE||isHol?'var(--bg)':'');
      const bdr=isToday?'2px solid var(--primary)':'1px solid transparent';
      const tip=abs.map(a=>a.name+': '+a.type).join('\n')+(isHol?'\nFeiertag':'');
      const dot=abs.length>1?'<span style="position:absolute;top:0;right:0;width:4px;height:4px;border-radius:50%;background:var(--danger)"></span>':'';
      return '<div title="'+esc(tip)+'" style="position:relative;text-align:center;font-size:9px;padding:2px 0;border-radius:2px;background:'+bg+';border:'+bdr+'">'+dd+dot+'</div>';
    }).join('');
    html+='<div style="background:var(--surface,#fff);border:1.5px solid var(--border);border-radius:8px;overflow:hidden">'
      +'<div style="background:var(--primary);color:var(--on-primary,#fff);font-size:12px;font-weight:700;padding:5px 8px">'+MONTHS[m-1]+'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;padding:4px;font-size:9px">'
      +dowHeaders+empties+days
      +'</div></div>';
  }
  html+='</div>';
  return html;
}
