import { _STAMP_KEY } from '../config.js';
import { getData, getDataCache, getEntry, entryKey, mutate } from '../data.js';
import { esc, toast, openModal, closeModal } from '../utils.js';
import { getCatsForTeam } from '../cats.js';

export function getStamp(){
  const cu=window.cu;
  if(cu&&!window._offlineMode){ const d=getData(); return (d.stamps&&d.stamps[cu.id])||null; }
  try{ const s=localStorage.getItem(_STAMP_KEY); return s?JSON.parse(s):null; }catch(e){ return null; }
}

export function renderStempelView(){
  const cu=window.cu;
  if(!cu||cu.role==='admin') return;
  if(window._zsClockInt){ clearInterval(window._zsClockInt); window._zsClockInt=null; }
  const stamp=getStamp();
  const active=stamp&&stamp.uid===cu.id;
  const cats=getCatsForTeam((cu.team||''));
  const catOpts=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  let html='<div class="zs-page">';
  html+=`<div class="zs-clock-card">
    <div class="zs-date" id="zs-view-date"></div>
    <div class="zs-time" id="zs-view-time">--:--:--</div>
  </div>`;
  if(active){
    const start=new Date(stamp.startTime);
    const von=String(start.getHours()).padStart(2,'0')+':'+String(start.getMinutes()).padStart(2,'0');
    html+=`<div class="zs-status-card stamped">
      <div class="zs-status-label">Eingestempelt seit ${von} Uhr</div>
      <div class="zs-status-main" id="zs-elapsed">–</div>
    </div>`;
  } else {
    html+=`<div class="zs-status-card not-stamped">
      <div class="zs-status-main">Noch nicht eingestempelt</div>
    </div>`;
  }
  if(active){
    html+=`<div class="zs-form-card">
      <div><span class="zs-field-lbl">Zuordnung / Kategorie</span>
        <select id="zs-zuord"><option value="">– Keine –</option>${catOpts}</select></div>
      <div><span class="zs-field-lbl">Bemerkung <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(optional)</span></span>
        <input type="text" id="zs-note" placeholder="z.B. Besprechung, Akademie-Call…"></div>
    </div>`;
  }
  html+='<div class="zs-action-card">';
  if(active){
    html+=`<button class="btn btn-ausstempeln" onclick="stopZeitstempel()">■ Ausstempeln &amp; übertragen</button>`;
    html+=`<button class="btn btn-verwerfen" onclick="cancelZeitstempel()">🗑 Stempel verwerfen</button>`;
  } else {
    html+=`<button class="btn btn-einstempeln" onclick="startZeitstempel()">▶ Einstempeln</button>`;
  }
  html+='</div></div>';
  document.getElementById('view-stempeln').innerHTML=html;
  function _tick(){
    const now=new Date();
    const el=document.getElementById('zs-view-time');
    if(el) el.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    const dl=document.getElementById('zs-view-date');
    if(dl) dl.textContent=now.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(active&&stamp){
      const start=new Date(stamp.startTime);
      const totalSec=Math.floor((now-start)/1000);
      const hh=Math.floor(totalSec/3600);
      const mm=Math.floor((totalSec%3600)/60);
      const ss=totalSec%60;
      const el2=document.getElementById('zs-elapsed');
      if(el2) el2.textContent=hh>0?`${hh} Std. ${mm} Min.`:`${mm} Min. ${String(ss).padStart(2,'0')} Sek.`;
    }
  }
  _tick();
  window._zsClockInt=setInterval(_tick,1000);
}

export function _refreshStempelView(){
  const v=document.getElementById('view-stempeln');
  if(v&&v.classList.contains('active')) renderStempelView();
}

export function _stempelLiveTick(){
  const cu=window.cu;
  const chip=document.getElementById('stempel-live');
  if(!chip||!cu) return;
  const stamp=getStamp();
  const active=stamp&&stamp.uid===cu.id;
  if(!active){ chip.style.display='none'; return; }
  const start=new Date(stamp.startTime);
  const von=stamp.von||(String(start.getHours()).padStart(2,'0')+':'+String(start.getMinutes()).padStart(2,'0'));
  const diffMs=Date.now()-start.getTime();
  const totalMin=Math.floor(diffMs/60000);
  const h=Math.floor(totalMin/60), m=totalMin%60;
  const dur=h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
  document.getElementById('stempel-live-von').textContent=von;
  document.getElementById('stempel-live-dur').textContent=dur;
  chip.style.display='flex';
}

export function updateZeitstempelBtn(){
  const cu=window.cu;
  const btn=document.getElementById('btn-zeitstempel');
  if(!btn||!cu) return;
  const stamp=getStamp();
  const active=stamp&&stamp.uid===cu.id;
  btn.textContent=active?'⏱ Gestempelt':'⏱ Stempeln';
  if(active){ btn.classList.add('zs-active'); }
  else { btn.classList.remove('zs-active'); }
  const tabMob=document.getElementById('tab-stempeln-mobile');
  if(tabMob){ tabMob.textContent=active?'⏱ Gestempelt':'⏱ Stempeln'; tabMob.classList.toggle('zs-active',active); }
  _stempelLiveTick();
  if(active&&!window._stempelLiveInt){
    window._stempelLiveInt=setInterval(_stempelLiveTick,1000);
  } else if(!active&&window._stempelLiveInt){
    clearInterval(window._stempelLiveInt); window._stempelLiveInt=null;
    const chip=document.getElementById('stempel-live');
    if(chip) chip.style.display='none';
  }
}

export function openZeitstempel(){
  const cu=window.cu;
  if(!cu||cu.role==='admin') return;
  const stamp=getStamp();
  if(stamp&&stamp.uid===cu.id){ _zsShowStop(stamp); } else { _zsShowStart(); }
}

function _zsShowStart(){
  const now=new Date();
  const tStr=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const dStr=now.toLocaleDateString('de-DE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  openModal(`<h3>⏱ Zeitstempel</h3>
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:38px;font-weight:700;color:var(--primary)">${tStr}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">${dStr}</div>
    </div>
    <div style="background:#f0fff4;border:1.5px solid var(--ok);border-radius:8px;padding:14px;text-align:center;margin-bottom:18px">
      <div style="font-size:13px;color:var(--ok);font-weight:600">Noch nicht eingestempelt</div>
    </div>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" onclick="startZeitstempel()">▶ Einstempeln</button>
    </div>`);
}

function _zsShowStop(stamp){
  const cu=window.cu;
  const start=new Date(stamp.startTime);
  const now=new Date();
  const eMin=Math.round((now-start)/60000);
  const von=String(start.getHours()).padStart(2,'0')+':'+String(start.getMinutes()).padStart(2,'0');
  const bis=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const elapsed=eMin>=60?`${Math.floor(eMin/60)} Std. ${eMin%60} Min.`:`${eMin} Min.`;
  const cats=getCatsForTeam((cu.team||''));
  const catOpts=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  openModal(`<h3>⏱ Ausstempeln</h3>
    <div style="background:#e8f0fe;border:1.5px solid var(--primary-l);border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;color:var(--muted)">Eingestempelt seit <strong>${von}</strong></div>
      <div style="font-size:22px;font-weight:700;color:var(--primary);margin-top:4px">${elapsed} &nbsp;·&nbsp; ${von} – ${bis}</div>
    </div>
    <div class="form-group"><label>Zuordnung / Kategorie</label>
      <select id="zs-zuord" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px">
        <option value="">– Keine –</option>${catOpts}
      </select></div>
    <div class="form-group"><label>Bemerkung <span style="font-size:11px;color:var(--muted)">(optional)</span></label>
      <input type="text" id="zs-note" placeholder="z.B. Besprechung, Akademie-Call…" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px"></div>
    <div class="modal-btns">
      <button class="btn btn-danger btn-sm" onclick="cancelZeitstempel()" style="margin-right:auto">🗑 Verwerfen</button>
      <button class="btn btn-outline" onclick="closeModal()">Schließen</button>
      <button class="btn btn-warn" onclick="stopZeitstempel()">■ Ausstempeln &amp; übertragen</button>
    </div>`);
}

export async function startZeitstempel(){
  const cu=window.cu;
  if(!cu||cu.role==='admin') return;
  const now=new Date();
  const von=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const startDate=now.toISOString().slice(0,10);
  const [sy,sm]=startDate.split('-').map(Number);
  const k=entryKey(cu.id,sy,sm);
  if(!window._offlineMode&&getDataCache()){
    try{
      const snap=await window._fbRef.child('entries').child(k).once('value');
      const val=snap.val(); if(val) getDataCache().entries[k]=val;
    }catch(e){}
  }
  const dayNow=(getEntry(cu.id,sy,sm).days||{})[startDate]||{};
  const b1full=!!(dayNow.b1von&&dayNow.b1bis);
  const b2full=!!(dayNow.b2von&&dayNow.b2bis);
  const block=b1full?(b2full?'kt':'b2'):'b1';
  const stamp={uid:cu.id,startTime:now.toISOString(),startDate,von,block};
  try{ localStorage.setItem(_STAMP_KEY,JSON.stringify(stamp)); }catch(e){}
  mutate(d=>{
    if(!d.stamps) d.stamps={};
    d.stamps[cu.id]=stamp;
    if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
    if(!d.entries[k].days) d.entries[k].days={};
    if(!d.entries[k].days[startDate]) d.entries[k].days[startDate]={};
    if(block==='b1') d.entries[k].days[startDate].b1von=von;
    else if(block==='b2') d.entries[k].days[startDate].b2von=von;
  });
  closeModal(); updateZeitstempelBtn(); toast('Eingestempelt ✓ ('+von+')','ok'); _refreshStempelView();
  const vze=document.getElementById('view-zeiterfassung');
  if(vze&&vze.classList.contains('active')){ window.year=sy; window.mon=sm; window.renderZeiterfassung?.(); }
}

export function cancelZeitstempel(){
  const cu=window.cu;
  if(!confirm('Stempel verwerfen? Die Zeit wird NICHT in die Zeiterfassung übertragen.')) return;
  const stamp=getStamp();
  if(stamp&&stamp.uid===cu.id&&stamp.startDate){
    const von=stamp.von||'', ds=stamp.startDate, block=stamp.block||'b1';
    const [sy,sm]=ds.split('-').map(Number);
    mutate(d=>{
      const day=d.entries?.[entryKey(cu.id,sy,sm)]?.days?.[ds];
      if(day){
        if(block==='b1'&&day.b1von===von&&!day.b1bis) day.b1von='';
        else if(block==='b2'&&day.b2von===von&&!day.b2bis) day.b2von='';
      }
      if(d.stamps) delete d.stamps[cu.id];
    });
  } else {
    mutate(d=>{ if(d.stamps) delete d.stamps[cu.id]; });
  }
  try{ localStorage.removeItem(_STAMP_KEY); }catch(e){}
  closeModal(); updateZeitstempelBtn(); toast('Stempel verworfen.'); _refreshStempelView();
}

// Berechnet b1/b2/Pause aus allen Stempel-Sessions des Tages
function _recomputeFromSessions(day){
  const sessions=day.stampSessions||[];
  if(!sessions.length) return;
  // Die 2 längsten Sessions → Block 1 + Block 2 (chronologisch sortiert)
  const sorted=[...sessions].sort((a,b)=>b.min-a.min);
  const top2=sorted.slice(0,2).sort((a,b)=>a.von<b.von?-1:1);
  const rest=sorted.slice(2);
  // Blöcke leeren
  day.b1von=''; day.b1bis=''; day.b1zuord=''; day.b1bem='';
  day.b2von=''; day.b2bis=''; day.b2zuord=''; day.b2bem='';
  day.ktmin=0;
  if(top2[0]){
    day.b1von=top2[0].von; day.b1bis=top2[0].bis;
    if(top2[0].zuord) day.b1zuord=top2[0].zuord;
    if(top2[0].note)  day.b1bem=top2[0].note;
  }
  if(top2[1]){
    day.b2von=top2[1].von; day.b2bis=top2[1].bis;
    if(top2[1].zuord) day.b2zuord=top2[1].zuord;
    if(top2[1].note)  day.b2bem=top2[1].note;
  }
  // Restliche Sessions → Pause (Summe der Minuten)
  day.ktmin=rest.reduce((s,r)=>s+r.min,0);
}

export function stopZeitstempel(){
  const cu=window.cu;
  const stamp=getStamp();
  if(!stamp||stamp.uid!==cu.id){ toast('Kein aktiver Stempel.','err'); return; }
  const zuord=document.getElementById('zs-zuord')?.value||'';
  const note=document.getElementById('zs-note')?.value.trim()||'';
  const von=stamp.von||'';
  const end=new Date();
  const bis=String(end.getHours()).padStart(2,'0')+':'+String(end.getMinutes()).padStart(2,'0');
  const ds=stamp.startDate;
  const [sy,sm]=ds.split('-').map(Number);
  const durationMin=Math.max(0,Math.round((end-new Date(stamp.startTime))/60000));
  mutate(d=>{
    const k=entryKey(cu.id,sy,sm);
    if(!d.entries[k]) d.entries[k]={status:'draft',carryover:0,managerNote:'',submittedAt:null,reviewedAt:null,reviewedBy:null,days:{}};
    if(!d.entries[k].days) d.entries[k].days={};
    if(!d.entries[k].days[ds]) d.entries[k].days[ds]={};
    const day=d.entries[k].days[ds];
    // Session aufzeichnen
    if(!Array.isArray(day.stampSessions)) day.stampSessions=[];
    day.stampSessions.push({von,bis,min:durationMin,zuord:zuord||'',note:note||''});
    // Aus allen Sessions die 2 größten Blöcke berechnen, Rest → Pause
    _recomputeFromSessions(day);
    const dd=d.entries[k].days[ds];
    if(dd&&!dd.b1von&&!dd.b1bis&&!dd.b2von&&!dd.b2bis&&!Number(dd.ktmin)&&!dd.b1bem&&!dd.b2bem){
      delete d.entries[k].days[ds];
    }
  });
  window.check10hCarryover?.(cu.id,sy,sm,ds);
  try{ localStorage.removeItem(_STAMP_KEY); }catch(e){}
  mutate(d=>{ if(d.stamps) delete d.stamps[cu.id]; });
  toast(`Ausgestempelt – ${durationMin} Min. übertragen ✓`,'ok');
  closeModal(); updateZeitstempelBtn();
  _refreshStempelView();
  const vze=document.getElementById('view-zeiterfassung');
  if(vze&&vze.classList.contains('active')){ window.year=sy; window.mon=sm; window.renderZeiterfassung?.(); }
}
