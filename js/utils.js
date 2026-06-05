import { DAYS } from './config.js';

// ── Time helpers ─────────────────────────────────────────────────
export function tMin(s){ if(!s||!s.includes(':')) return 0; const[h,m]=s.split(':').map(Number); return h*60+m; }
export function minFmt(n){ n=Math.round(n); if(n<=0) return ''; const h=Math.floor(n/60),m=n%60; return `${h}:${String(m).padStart(2,'0')}`; }
export function hFmt(n){ n=Math.round(n); if(n<=0) return '0:00'; const h=Math.floor(n/60),m=n%60; return `${h}:${String(m).padStart(2,'0')}`; }
// Vorzeichen-behaftete Stunden (Übertrag/Differenz): '+H:MM' / '-H:MM' / '0:00'.
// WICHTIG: hFmt liefert für negative Werte faelschlich '0:00' – fuer Salden IMMER sFmt nutzen.
export function sFmt(n){ n=Math.round(n); const a=Math.abs(n),h=Math.floor(a/60),m=a%60,t=`${h}:${String(m).padStart(2,'0')}`; return n<0?('-'+t):n>0?('+'+t):t; }
export function dayFmt(min){
  if(min<=0) return '';
  const d=Math.round(min/480*4)/4;
  const whole=Math.floor(d), frac=Math.round((d-whole)*4);
  const fracStr=['','¼','½','¾'][frac]||'';
  const num=(whole>0?whole:'')+fracStr||'0';
  return num+' '+(d===1&&!frac?'Tag':'Tage');
}
export function diffMin(v,b){ const d=tMin(b)-tMin(v); return d>0?d:0; }
export function addMin(t,m){ const tot=tMin(t)+m; return `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`; }
export function roundToQuarter(val){
  if(!val||!val.includes(':')) return val;
  let [h,m]=val.split(':').map(Number);
  m=Math.round(m/15)*15;
  if(m===60){h+=1;m=0;}
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

// ── Date helpers ─────────────────────────────────────────────────
export function isoWeek(date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const y=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-y)/86400000)+1)/7);
}
export function daysInMonth(y,m){ return new Date(y,m,0).getDate(); }
export function dateStr(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
export function isWeekend(y,m,d){ const wd=new Date(y,m-1,d).getDay(); return wd===0||wd===6; }
export function dayName(y,m,d){ return DAYS[new Date(y,m-1,d).getDay()]; }
export function isToday(y,m,d){ const t=new Date(); return t.getFullYear()===y&&t.getMonth()+1===m&&t.getDate()===d; }
export function addDays(date,n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
export function ds2(date){ return dateStr(date.getFullYear(),date.getMonth()+1,date.getDate()); }

// ── Public holidays (Deutschland) ────────────────────────────────
export function getEaster(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d2=Math.floor(b/4),e=b%4,
        f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
        h=(19*a+b-d2-g+15)%30,i=Math.floor(c/4),k=c%4,
        l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
        mo=Math.floor((h+l-7*m+114)/31),dy=((h+l-7*m+114)%31)+1;
  return new Date(y,mo-1,dy);
}
export function getHolidays(y,bl){
  const e=getEaster(y); const s=new Set();
  [dateStr(y,1,1),dateStr(y,5,1),dateStr(y,10,3),dateStr(y,12,25),dateStr(y,12,26),
   ds2(addDays(e,-2)),ds2(addDays(e,1)),ds2(addDays(e,39)),ds2(addDays(e,50))
  ].forEach(x=>s.add(x));
  if(!bl) return s;
  if(['BW','BY','ST'].includes(bl)) s.add(dateStr(y,1,6));
  if(bl==='BE') s.add(dateStr(y,3,8));
  if(['BW','BY','HE','NW','RP','SL'].includes(bl)) s.add(ds2(addDays(e,60)));
  if(['BY','SL'].includes(bl)) s.add(dateStr(y,8,15));
  if(['BB','MV','SN','ST','TH','HB','HH','NI','SH'].includes(bl)) s.add(dateStr(y,10,31));
  if(['BW','BY','NW','RP','SL'].includes(bl)) s.add(dateStr(y,11,1));
  if(bl==='SN'){
    let bdt=new Date(y,10,22); while(bdt.getDay()!==0) bdt.setDate(bdt.getDate()-1);
    bdt.setDate(bdt.getDate()-4); s.add(ds2(bdt));
  }
  return s;
}

// ── Formatting ───────────────────────────────────────────────────
export function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
export function fmtTs(iso){
  if(!iso) return '';
  const d=new Date(iso);
  return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})+
         ' '+d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' Uhr';
}

// ── UI helpers ───────────────────────────────────────────────────
export function openModal(html,wide=false){
  const m=document.getElementById('modal-body');
  m.innerHTML=html;
  m.classList.toggle('modal-wide',!!wide);
  document.getElementById('modal-bg').classList.add('show');
}
export function closeModal(){ document.getElementById('modal-bg').classList.remove('show'); }
export function initModalClose(){
  document.getElementById('modal-bg').addEventListener('click',e=>{
    if(e.target===document.getElementById('modal-bg')) closeModal();
  });
}
export function toast(msg,type=''){
  const el=document.createElement('div');
  el.className='toast'+(type?' '+type:''); el.textContent=msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3500);
}
