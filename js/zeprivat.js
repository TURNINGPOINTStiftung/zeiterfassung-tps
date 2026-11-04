// ═════════════════════════════════════════════════════════════════
//  PERSONALDATEN PRIVAT – Abschluss (Phase 4, nur Administrator, Verwaltung → Daten & Backup)
//  Der einmalige Umzug (Phase 2, v547–v550) ist erledigt und wurde in v552 entfernt; zpPlan bleibt als
//  Zuordnung alt → je Person für den Abschluss-Vergleich. Andere Module nur über Namespace-Import/window.*.
// ═════════════════════════════════════════════════════════════════
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import * as D from './data.js';
const ABW=new Set(['Urlaub','Arbeitszeitausgleich','AU/Krank']);
const isAdmin=()=>!!(window.cu && window.cu.role==='admin');

// Eindeutige Formfehler alter Anträge an die heutigen Prüfregeln anpassen (nur in der Kopie):
// id ≠ Schlüssel → Schlüssel, Datum mit Uhrzeit → JJJJ-MM-TT, Tagesanzahl als Text („1,5 Tage“) → Zahl, Uhrzeiten mit Sekunden → HH:MM.
function _cleanVac(r, key){
  let o=r; const set=(k,v)=>{ if(o===r) o=Object.assign({},r); if(v===undefined) delete o[k]; else o[k]=v; };
  // Feld id = Schlüssel (nach „Umlaut-IDs bereinigen“ steht innen teils noch die alte Kennung, z. B. jörg_…)
  if(key && r.id!==undefined && r.id!==key) set('id', key);
  ['startDate','endDate'].forEach(k=>{ const v=r[k]; if(typeof v==='string' && v && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)){ const m=/^([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(v); set(k, m?m[1]:undefined); } });
  const w=r.workDays; if(w!=null && typeof w!=='number' && !(typeof w==='string' && /^[0-9.,]{0,8}$/.test(w))){ const n=parseFloat(String(w).replace(',','.')); set('workDays', isFinite(n)?n:undefined); }
  if(r.dayTimes && typeof r.dayTimes==='object'){ let ch=false; const dt={}; Object.entries(r.dayTimes).forEach(([d,t])=>{ const f=x=>(typeof x==='string'&&!/^[0-9:. ]{0,8}$/.test(x))?((/^([0-9]{1,2}:[0-9]{2})/.exec(x)||[])[1]||''):x; const nt=Object.assign({},t||{}); if(t){ const a=f(t.von), b=f(t.bis); if(a!==t.von||b!==t.bis){ ch=true; nt.von=a; nt.bis=b; } } dt[d]=nt; }); if(ch) set('dayTimes', dt); }
  return o;
}
// Reine Logik (testbar): aus dem Rohstand die Schreib-Aufträge bilden
export function zpPlan(raw){
  raw=raw||{}; const perUser={}, skipped=[], abwesend={}, stripOld={}, fixIdOld={};
  const put=(u,coll,key,val)=>{ ((perUser[u]=perUser[u]||{})[coll]=perUser[u][coll]||{})[key]=val; };
  Object.entries(raw.entries||{}).forEach(([ek,e])=>{ const m=/^(.+)_([0-9]{4})_([0-9]{2})$/.exec(ek); if(!m||!e){ skipped.push('entries/'+ek); return; } put(m[1],'entries',ek,e); });
  Object.entries(raw.vacRequests||{}).forEach(([id,r])=>{
    if(!r||!r.userId){ skipped.push('vacRequests/'+id); return; }
    if(r.id!==undefined && r.id!==id) fixIdOld[id]=true;
    let rr=_cleanVac(r, id); if(r.type==='AU/Krank' && r.note){ if(rr===r) rr=Object.assign({},r); delete rr.note; stripOld[id]=true; }
    put(r.userId,'vacRequests',id,rr);
    if(r.status==='approved' && ABW.has(r.type) && r.startDate) abwesend[id]={ uid:r.userId, von:String(r.startDate).slice(0,10), bis:String(r.endDate||r.startDate).slice(0,10), halb:!!r.halfDay };
  });
  Object.entries(raw.stamps||{}).forEach(([u,st])=>{ if(st) ((perUser[u]=perUser[u]||{}).stamps)=st; });
  return { perUser, skipped, abwesend, stripOld, fixIdOld };
}
const _stable=v=>JSON.stringify(v, (k,x)=> (x && typeof x==='object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o,kk)=>(o[kk]=x[kk],o),{}) : x);

async function _readRaw(db){
  const g=p=>db.ref('zeiterfassung/'+p).once('value').then(s=>s.val()||{});
  const [entries,vacRequests,stamps]=await Promise.all([g('entries'),g('vacRequests'),g('stamps')]);
  return { entries, vacRequests, stamps };
}

// ═════════════════════════════════════════════════════════════════
//  Phase 4 (v552): Abschluss – alte Sammlungen zeiterfassung/entries|vacRequests|stamps löschen.
//  Erst dann sind die Personaldaten wirklich geschützt (in RTDB erbt ein Kind die Leserechte des Elternknotens).
//  Ablauf im Werkzeug: 1. Prüfen (alt ↔ ze_private je Person, welche Geräte noch mit alter App schreiben)
//  2. Sicherung herunterladen  3. Löschen (Reste nur am alten Ort werden vorher nach ze_private übernommen,
//  danach Merker zeiterfassung/zePrivOnly → die App schreibt nur noch neu). Danach Regeln v17 veröffentlichen.
// ═════════════════════════════════════════════════════════════════
// Reine Logik (testbar): Vergleich alter Stand ↔ ze_private. Liefert, was nur alt liegt (wird übernommen),
// was abweicht (ze_private gewinnt – so zeigt es die App seit v551) und die Schreib-Aufträge fürs Übernehmen.
export function zpCompare(raw, priv){
  raw=raw||{}; priv=priv||{};
  const onlyOld=[], differ=[], copy={}; let same=0;
  const plan=zpPlan(raw);
  Object.entries(plan.perUser).forEach(([u,colls])=>{
    const p=priv[u]||{};
    Object.entries(colls).forEach(([coll,val])=>{
      if(coll==='stamps'){ if(p.stamps==null){ onlyOld.push(u+'/stamps'); copy['ze_private/'+u+'/stamps']=val; } else if(_stable(p.stamps)!==_stable(val)) differ.push(u+'/stamps'); else same++; return; }
      Object.entries(val).forEach(([k,v])=>{ const pv=(p[coll]||{})[k];
        if(pv===undefined){ onlyOld.push(u+'/'+coll+'/'+k); copy['ze_private/'+u+'/'+coll+'/'+k]=v;
          if(coll==='vacRequests' && plan.abwesend[k]) copy['zeiterfassung/abwesend/'+k]=plan.abwesend[k]; }
        else if(_stable(pv)!==_stable(v)) differ.push(u+'/'+coll+'/'+k); else same++; });
    });
  });
  return { onlyOld, differ, same, copy, skipped:plan.skipped };
}
// Reine Logik (testbar): Wer hat in den letzten Tagen noch mit einer App OHNE Phase-4-Kennung (zp:4) geschrieben?
export function zpOldWriters(audit, sinceTs){
  const last={};
  Object.values(audit||{}).forEach(m=>Object.values(m||{}).forEach(r=>{ if(!r||!r.by||!(r.ts>=sinceTs)) return;
    const cur=last[r.by]; if(!cur||r.ts>cur.ts) last[r.by]={ ts:r.ts, zp:r.zp===4, name:r.byName||r.by }; }));
  const old=Object.entries(last).filter(([,x])=>!x.zp).map(([id,x])=>({ id, name:x.name, ts:x.ts })).sort((a,b)=>b.ts-a.ts);
  return { old, fresh:Object.values(last).filter(x=>x.zp).length };
}
const _ids=(d,raw)=>{ const s=new Set(); ((d&&d.users)||[]).concat(Array.isArray(d&&d.archivedUsers)?d.archivedUsers:[]).forEach(u=>{ if(u&&u.id) s.add(u.id); });
  Object.keys(zpPlan(raw).perUser).forEach(u=>s.add(u)); return [...s]; };
async function _readPriv(db, ids){ const out={}; for(const u of ids){ try{ out[u]=(await db.ref('ze_private/'+u).once('value')).val()||{}; }catch(e){ out[u]=null; } } return out; }
const _when=ts=>{ try{ return new Date(ts).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})+' '+new Date(ts).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } };

let _busy=false, _last='', _cmp=null, _saved=false, _done=false;
export async function zpCheck(){
  if(!isAdmin()||_busy) return; _busy=true; _render('Lese den aktuellen Stand …');
  try{ const db=firebase.database(); const raw=await _readRaw(db);
    const d=((D.getData&&D.getData())||{});
    const ids=_ids(d,raw); const priv=await _readPriv(db, ids); const unread=ids.filter(u=>priv[u]===null);
    _cmp=zpCompare(raw, priv);
    let aud={}; try{ aud=(await db.ref('ze_audit').once('value')).val()||{}; }catch(e){}
    const ow=zpOldWriters(aud, Date.now()-14*864e5);
    const nOld=Object.keys(raw.entries||{}).length+Object.keys(raw.vacRequests||{}).length+Object.keys(raw.stamps||{}).length;
    _done=!nOld && d.zePrivOnly===true;
    _last=_done ? '<b style="color:var(--ok,#1a7f3c)">✓ Abgeschlossen:</b> am alten Ort liegt nichts mehr, die App schreibt nur noch in den geschützten Bereich.'
      : `<b>Alter Ort:</b> ${Object.keys(raw.entries||{}).length} Monatsblätter · ${Object.keys(raw.vacRequests||{}).length} Anträge · ${Object.keys(raw.stamps||{}).length} Stempel-Bereiche`+
      `<br><b>Vergleich mit dem geschützten Bereich:</b> ${_cmp.same} gleich · ${_cmp.onlyOld.length} nur am alten Ort (werden beim Abschluss übernommen) · ${_cmp.differ.length} abweichend (es gilt der geschützte Bereich – so zeigt es die App schon seit v551)`+
      (unread.length?`<br><span style="color:var(--danger)">Nicht lesbar: ${esc(unread.join(', '))}</span>`:'')+
      ((_cmp.onlyOld.length||_cmp.differ.length)?`<details style="margin-top:4px"><summary>Einzelheiten</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(_cmp.onlyOld.slice(0,40).map(x=>'nur alt: '+x).concat(_cmp.differ.slice(0,40).map(x=>'abweichend: '+x)).join('\n'))}</pre></details>`:'')+
      `<br><b>Geräte (letzte 14 Tage, Änderungsprotokoll):</b> ${ow.fresh} Person${ow.fresh===1?'':'en'} schreib${ow.fresh===1?'t':'en'} mit neuer App`+
      (ow.old.length?` · <span style="color:var(--warn-text,#8a4b06)">noch mit alter App: ${ow.old.map(x=>esc(x.name)+' ('+esc(_when(x.ts))+')').join(', ')}</span> – erst abschließen, wenn hier niemand mehr steht (App neu laden lassen).`:' · niemand mehr mit alter App ✓');
  }catch(e){ _last='<span style="color:var(--danger)">Lesen fehlgeschlagen: '+esc(e&&e.message)+'</span>'; _cmp=null; }
  _busy=false; _render();
}
export async function zpBackup(){
  if(!isAdmin()||_busy) return; _busy=true; _render('Erstelle Sicherung …');
  try{ const db=firebase.database(); const raw=await _readRaw(db); const d=((D.getData&&D.getData())||{});
    const priv=await _readPriv(db, _ids(d,raw)); let abw={}; try{ abw=(await db.ref('zeiterfassung/abwesend').once('value')).val()||{}; }catch(e){}
    const blob={ _type:'tps-zeprivat-sicherung', _v:1, exportedAt:new Date().toISOString(), alt:raw, ze_private:priv, abwesend:abw };
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(blob)],{type:'application/json'}));
    a.download='Personaldaten-Sicherung_'+new Date().toISOString().slice(0,10)+'.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
    _saved=true; _last=(_last?_last+'<br>':'')+'<b style="color:var(--ok,#1a7f3c)">✓ Sicherung heruntergeladen.</b> Bitte gut aufbewahren (enthält Gesundheitsdaten).';
  }catch(e){ _last='<span style="color:var(--danger)">Sicherung fehlgeschlagen: '+esc(e&&e.message)+'</span>'; }
  _busy=false; _render();
}
export async function zpFinish(){
  if(!isAdmin()||_busy||!_cmp||!_saved) return;
  const t=window.prompt('Die alten Sammlungen werden endgültig gelöscht (Monatsblätter, Anträge, Stempel am alten Ort). Vorher werden '+_cmp.onlyOld.length+' Reste in den geschützten Bereich übernommen.\n\nZum Bestätigen LÖSCHEN eingeben:');
  if(t!=='LÖSCHEN') return;
  _busy=true; _render('Schließe ab … bitte die Seite offen lassen.');
  try{ const db=firebase.database();
    // frisch vergleichen (zwischen Prüfen und Löschen kann jemand etwas gespeichert haben)
    const raw=await _readRaw(db); const d=((D.getData&&D.getData())||{}); const priv=await _readPriv(db, _ids(d,raw));
    const unread=Object.keys(priv).filter(u=>priv[u]===null); if(unread.length) throw new Error('nicht lesbar: '+unread.join(', '));
    const cmp=zpCompare(raw, priv);
    const upd=Object.assign({}, cmp.copy, { 'zeiterfassung/entries':null, 'zeiterfassung/vacRequests':null, 'zeiterfassung/stamps':null, 'zeiterfassung/zePrivOnly':true });
    await db.ref().update(upd);   // atomar: Reste übernehmen + alten Ort löschen + Merker
    const chk=await _readRaw(db); const left=Object.keys(chk.entries).length+Object.keys(chk.vacRequests).length+Object.keys(chk.stamps).length;
    _done=!left; _cmp=null; _saved=false;
    _last=left?'<b style="color:var(--danger)">Am alten Ort liegen noch '+left+' Datensätze.</b>'
      :`<b style="color:var(--ok,#1a7f3c)">✓ Abgeschlossen.</b> ${cmp.onlyOld.length} Reste übernommen, alter Ort gelöscht. Jetzt Regeln v17 veröffentlichen (Anleitung in firebase-rules/README.md).`;
  }catch(e){ _last='<span style="color:var(--danger)">Abgebrochen, nichts gelöscht: '+esc(e&&e.message)+'</span>'; }
  _busy=false; _render();
}
function _render(msg){
  const host=document.getElementById('verw-zepriv'); if(!host) return;
  if(!isAdmin()){ host.innerHTML=''; return; }
  const can=!_busy&&!!_cmp&&_saved&&!_done;
  host.innerHTML=`<div class="crm-sec"><h4><span class="ttl">🔒 Personaldaten privat · Abschluss (Phase 4)</span></h4>
    <div class="small" style="color:var(--muted);margin-bottom:8px">Löscht Monatsblätter, Anträge und Stempelzeiten am alten, für alle lesbaren Ort. Die App liest seit v551 nur noch den geschützten Bereich je Person. Reihenfolge: 1. Prüfen · 2. Sicherung herunterladen · 3. Abschließen · danach Regeln v17 veröffentlichen.</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"><button class="btn-sm-crm" ${_busy?'disabled':''} onclick="zpCheck()">1. Prüfen (ändert nichts)</button>
      <button class="btn-sm-crm" ${(_busy||!_cmp||_done)?'disabled':''} onclick="zpBackup()">2. Sicherung herunterladen</button>
      <button class="btn-sm-crm primary" ${can?'':'disabled'} onclick="zpFinish()">3. Alten Ort löschen</button></div>
    <div class="small" role="status" aria-live="polite">${msg?esc(msg):(_last||'Noch nicht geprüft.')}</div></div>`;
}
export function renderZePrivBox(){ _render(); }
try{ Object.assign(window, { zpCheck, zpBackup, zpFinish, zpPlan, zpCompare, zpOldWriters, renderZePrivBox }); }catch(e){}
