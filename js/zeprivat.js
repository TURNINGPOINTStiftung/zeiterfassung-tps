// ═════════════════════════════════════════════════════════════════
//  PERSONALDATEN PRIVAT – Phase 2: einmaliger Umzug (nur Administrator)
//  Kopiert Zeiteinträge, Anträge und Stempelzeiten aus dem gemeinsamen Baum `zeiterfassung` nach
//  `ze_private/<Person>/…` (Regeln v16) und baut `zeiterfassung/abwesend` (nur von–bis, ohne Art) neu auf.
//  Freitext-Gründe bei Krankheit werden dabei entfernt (neu und alt). Wiederholbar (überschreibt mit dem
//  aktuellen Stand), liest direkt aus der Datenbank, vergleicht danach Eintrag für Eintrag.
//  Andere Module nur über window.* (kein benannter Import – Gerätecache).
// ═════════════════════════════════════════════════════════════════
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ABW=new Set(['Urlaub','Arbeitszeitausgleich','AU/Krank']);
const isAdmin=()=>!!(window.cu && window.cu.role==='admin');

// Eindeutige Formfehler alter Anträge an die heutigen Prüfregeln anpassen (nur in der Kopie):
// Datum mit Uhrzeit → JJJJ-MM-TT, Tagesanzahl als Text („1,5 Tage“) → Zahl, Uhrzeiten mit Sekunden → HH:MM.
function _cleanVac(r){
  let o=r; const set=(k,v)=>{ if(o===r) o=Object.assign({},r); if(v===undefined) delete o[k]; else o[k]=v; };
  ['startDate','endDate'].forEach(k=>{ const v=r[k]; if(typeof v==='string' && v && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)){ const m=/^([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(v); set(k, m?m[1]:undefined); } });
  const w=r.workDays; if(w!=null && typeof w!=='number' && !(typeof w==='string' && /^[0-9.,]{0,8}$/.test(w))){ const n=parseFloat(String(w).replace(',','.')); set('workDays', isFinite(n)?n:undefined); }
  if(r.dayTimes && typeof r.dayTimes==='object'){ let ch=false; const dt={}; Object.entries(r.dayTimes).forEach(([d,t])=>{ const f=x=>(typeof x==='string'&&!/^[0-9:. ]{0,8}$/.test(x))?((/^([0-9]{1,2}:[0-9]{2})/.exec(x)||[])[1]||''):x; const nt=Object.assign({},t||{}); if(t){ const a=f(t.von), b=f(t.bis); if(a!==t.von||b!==t.bis){ ch=true; nt.von=a; nt.bis=b; } } dt[d]=nt; }); if(ch) set('dayTimes', dt); }
  return o;
}
// Für die Fehlermeldung: welche Felder hat ein abgelehnter Antrag (ohne Art/Grund/Notiz)
function _vacInfo(r){ if(!r||typeof r!=='object') return ''; const show=k=>{ const v=r[k]; return v===undefined?'–':JSON.stringify(v).slice(0,40); };
  return ' [status='+show('status')+' start='+show('startDate')+' ende='+show('endDate')+' tage='+show('workDays')+' felder='+Object.keys(r).filter(k=>!/^(type|note|reason|reviewNote)$/.test(k)).join(',')+']'; }
// Reine Logik (testbar): aus dem Rohstand die Schreib-Aufträge bilden
export function zpPlan(raw){
  raw=raw||{}; const perUser={}, skipped=[], abwesend={}, stripOld={};
  const put=(u,coll,key,val)=>{ ((perUser[u]=perUser[u]||{})[coll]=perUser[u][coll]||{})[key]=val; };
  Object.entries(raw.entries||{}).forEach(([ek,e])=>{ const m=/^(.+)_([0-9]{4})_([0-9]{2})$/.exec(ek); if(!m||!e){ skipped.push('entries/'+ek); return; } put(m[1],'entries',ek,e); });
  Object.entries(raw.vacRequests||{}).forEach(([id,r])=>{
    if(!r||!r.userId){ skipped.push('vacRequests/'+id); return; }
    let rr=_cleanVac(r); if(r.type==='AU/Krank' && r.note){ if(rr===r) rr=Object.assign({},r); delete rr.note; stripOld[id]=true; }
    put(r.userId,'vacRequests',id,rr);
    if(r.status==='approved' && ABW.has(r.type) && r.startDate) abwesend[id]={ uid:r.userId, von:String(r.startDate).slice(0,10), bis:String(r.endDate||r.startDate).slice(0,10), halb:!!r.halfDay };
  });
  Object.entries(raw.stamps||{}).forEach(([u,st])=>{ if(st) ((perUser[u]=perUser[u]||{}).stamps)=st; });
  return { perUser, skipped, abwesend, stripOld };
}
const _stable=v=>JSON.stringify(v, (k,x)=> (x && typeof x==='object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o,kk)=>(o[kk]=x[kk],o),{}) : x);

async function _readRaw(db){
  const g=p=>db.ref('zeiterfassung/'+p).once('value').then(s=>s.val()||{});
  const [entries,vacRequests,stamps]=await Promise.all([g('entries'),g('vacRequests'),g('stamps')]);
  return { entries, vacRequests, stamps };
}
function _counts(plan){ let e=0,v=0,s=0; Object.values(plan.perUser).forEach(u=>{ e+=Object.keys(u.entries||{}).length; v+=Object.keys(u.vacRequests||{}).length; if(u.stamps) s++; }); return {e,v,s,p:Object.keys(plan.perUser).length,a:Object.keys(plan.abwesend).length,k:Object.keys(plan.stripOld).length}; }

let _busy=false, _last='';
export async function zpCheck(){
  if(!isAdmin()||_busy) return; _busy=true; _render('Lese den aktuellen Stand …');
  try{ const db=firebase.database(); const plan=zpPlan(await _readRaw(db)); const c=_counts(plan);
    // Regeln v16: Lesen nur je Person (ze_private/<Person>), nicht den ganzen Knoten
    let have=0; for(const u of Object.keys(plan.perUser)){ try{ if((await db.ref('ze_private/'+u).once('value')).exists()) have++; }catch(e){} }
    _last=`<b>Zu übertragen:</b> ${c.p} Personen · ${c.e} Monatsblätter · ${c.v} Anträge · ${c.s} Stempel-Bereiche · ${c.a} Abwesenheiten (von–bis)`+
      (c.k?` · bei ${c.k} Krankmeldungen wird der Grund entfernt`:'')+(plan.skipped.length?`<br><span style="color:var(--warn-text,#8a4b06)">Nicht zuordenbar (bleiben, wie sie sind): ${plan.skipped.length}</span>`:'')+
      `<br>Schon im privaten Bereich: ${have} Personen.`;
  }catch(e){ _last='<span style="color:var(--danger)">Lesen fehlgeschlagen: '+esc(e&&e.message)+'</span>'; }
  _busy=false; _render();
}
export async function zpMigrate(){
  if(!isAdmin()||_busy) return;
  _busy=true; _render('Übertrage … bitte die Seite offen lassen.');
  const log=[]; let fail=0;
  try{
    const db=firebase.database(); const raw=await _readRaw(db); const plan=zpPlan(raw);
    for(const [u,colls] of Object.entries(plan.perUser)){
      const upd={}; Object.entries(colls).forEach(([coll,val])=>{ if(coll==='stamps') upd['ze_private/'+u+'/stamps']=val; else Object.entries(val).forEach(([k,v])=>{ upd['ze_private/'+u+'/'+coll+'/'+k]=v; }); });
      try{ await db.ref().update(upd); }
      catch(e){ // einzeln nachschreiben, damit ein abgelehnter Datensatz nicht alle anderen blockiert
        for(const [p,v] of Object.entries(upd)){ try{ await db.ref().update({[p]:v}); }catch(e2){ fail++; log.push(p+': '+(e2&&e2.code||e2&&e2.message||'abgelehnt')+(/\/vacRequests\//.test(p)?_vacInfo(v):'')); } } }
    }
    await db.ref('zeiterfassung/abwesend').set(plan.abwesend);
    const strip={}; Object.keys(plan.stripOld).forEach(id=>{ strip['zeiterfassung/vacRequests/'+id+'/note']=null; });
    if(Object.keys(strip).length) await db.ref().update(strip);
    // Kontrolle: alles zurücklesen und Eintrag für Eintrag vergleichen
    const back={}; let diff=0;
    for(const u of Object.keys(plan.perUser)){ try{ back[u]=(await db.ref('ze_private/'+u).once('value')).val()||{}; }catch(e){ back[u]={}; log.push('Zurücklesen nicht möglich: '+u+' ('+(e&&e.code||e&&e.message)+')'); } }
    Object.entries(plan.perUser).forEach(([u,colls])=>Object.entries(colls).forEach(([coll,val])=>{
      if(coll==='stamps'){ if(_stable(((back[u]||{}).stamps)||null)!==_stable(val)){ diff++; log.push('Abweichung: '+u+'/stamps'); } return; }
      Object.entries(val).forEach(([k,v])=>{ if(_stable(((back[u]||{})[coll]||{})[k])!==_stable(v)){ diff++; if(log.length<30) log.push('Abweichung: '+u+'/'+coll+'/'+k); } }); }));
    const c=_counts(plan);
    _last=(fail||diff?'<b style="color:var(--danger)">Mit Problemen fertig.</b> ':'<b style="color:var(--ok,#1a7f3c)">✓ Übertragen und geprüft.</b> ')+
      `${c.p} Personen · ${c.e} Monatsblätter · ${c.v} Anträge · ${c.s} Stempel-Bereiche · ${c.a} Abwesenheiten`+(c.k?` · ${c.k} Krankheits-Gründe entfernt`:'')+
      `<br>Abgelehnt: ${fail} · Abweichungen beim Zurücklesen: ${diff}`+(log.length?`<details style="margin-top:6px"><summary>Einzelheiten (${log.length})</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(log.join('\n'))}</pre></details>`:'');
  }catch(e){ _last='<span style="color:var(--danger)">Abgebrochen: '+esc(e&&e.message)+'</span>'; }
  _busy=false; _render();
}
function _render(msg){
  const host=document.getElementById('verw-zepriv'); if(!host) return;
  if(!isAdmin()){ host.innerHTML=''; return; }
  host.innerHTML=`<div class="crm-sec"><h4><span class="ttl">🔒 Personaldaten privat · Umzug (Phase 2)</span></h4>
    <div class="small" style="color:var(--muted);margin-bottom:8px">Kopiert Monatsblätter, Abwesenheitsanträge und Stempelzeiten in den geschützten Bereich je Person und baut die öffentliche Liste „abwesend von–bis“ (ohne Art) neu auf. Gründe bei Krankmeldungen werden entfernt. Die bisherigen Daten bleiben vorerst unverändert lesbar (Sperre erst in Phase 4). Kann gefahrlos wiederholt werden.</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"><button class="btn-sm-crm" ${_busy?'disabled':''} onclick="zpCheck()">Prüfen (ändert nichts)</button><button class="btn-sm-crm primary" ${_busy?'disabled':''} onclick="zpMigrate()">Jetzt übertragen</button></div>
    <div class="small" role="status" aria-live="polite">${msg?esc(msg):(_last||'Noch nicht geprüft.')}</div></div>`;
}
export function renderZePrivBox(){ _render(); }
try{ Object.assign(window, { zpCheck, zpMigrate, zpPlan, renderZePrivBox }); }catch(e){}
