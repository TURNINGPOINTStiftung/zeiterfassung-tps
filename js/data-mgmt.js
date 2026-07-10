import { STORAGE_KEY } from './config.js';
import { getData, getUser, mutate, saveRaw } from './data.js';
import { computeAutoCarry } from './calc.js';
import { openModal, closeModal, toast, diffMin, addMin } from './utils.js';

// Manuelle Überträge, die vom automatischen (minutengenauen) Wert abweichen, auf
// Automatik zurücksetzen. Behebt z.B. alte, versehentlich auf ganze Stunden
// gerundete Überträge (40:30 → faelschlich manuell 40). Reine Zeitdaten bleiben unberührt.
export function fixManualCarryovers(){
  const d=getData();
  const _f=h=>{ const min=Math.round((h||0)*60), neg=min<0, a=Math.abs(min); return (neg?'-':'')+Math.floor(a/60)+':'+String(a%60).padStart(2,'0'); };
  const MO=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const list=[];
  Object.keys(d.entries||{}).forEach(k=>{
    const e=d.entries[k]; if(!e||!e.carryoverManual) return;
    const parts=k.split('_'); const m=+parts.pop(); const y=+parts.pop(); const uid=parts.join('_');
    const u=getUser(uid); if(!u) return;
    const stored=Number(e.carryover||0);
    const auto=computeAutoCarry(uid,u,y,m);
    if(Math.abs(stored-auto)>0.001) list.push({k,name:u.name,y,m,stored,auto});
  });
  if(!list.length){ toast('Keine abweichenden manuellen Überträge gefunden – alles automatisch/korrekt.','ok'); return; }
  list.sort((a,b)=>a.name.localeCompare(b.name,'de')||a.y-b.y||a.m-b.m);
  const preview=list.slice(0,15).map(r=>`• ${r.name} ${MO[r.m-1]} ${r.y}: manuell ${_f(r.stored)} → auto ${_f(r.auto)}`).join('\n');
  if(!confirm(`${list.length} manuelle Überträge weichen vom automatischen Wert ab und werden auf Automatik zurückgesetzt:\n\n${preview}${list.length>15?`\n… und ${list.length-15} weitere`:''}\n\nZurücksetzen?`)) return;
  mutate(dd=>{ list.forEach(r=>{ const e=dd.entries[r.k]; if(e){ e.carryoverManual=false; e.carryover=0; } }); });
  toast(`${list.length} Übertrag/Überträge auf Automatik zurückgesetzt ✓`,'ok');
  try{ window.renderZeiterfassung?.(); window.renderOverview?.(); }catch(e){}
}

export function exportData(){
  const blob=new Blob([JSON.stringify(getData(),null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`zeiterfassung_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

export function importData(e){
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(!d.users||!d.entries) throw new Error();
      if(!confirm('Alle aktuellen Daten ersetzen?')) return;
      // Beabsichtigte Vollersetzung: Datenverlust-Schutz für DIESEN Schreibvorgang
      // erlauben (ein Import/Backup darf kleiner sein als der aktuelle Stand).
      window._allowDataShrink=true;
      Promise.resolve(saveRaw(d)).finally(()=>{ window._allowDataShrink=false; });
      toast('Import erfolgreich – Seite wird neu geladen…','ok');
      setTimeout(()=>location.reload(),1200);
    }catch(e){ toast('Ungültige Datei.','err'); }
  };
  reader.readAsText(file); e.target.value='';
}

export function resetData(){
  if(!confirm('ACHTUNG: Alle Zeitdaten unwiderruflich löschen?')) return;
  if(!confirm('Wirklich?')) return;
  localStorage.removeItem(STORAGE_KEY);
  toast('Daten gelöscht – Seite wird neu geladen…','err');
  setTimeout(()=>location.reload(),1200);
}

export function showCarryoverCleanup(){
  openModal(`<h3 style="margin-bottom:14px">🧹 Übertrag-Korrekturen bereinigen</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">Entfernt alle automatisch angelegten „Übertrag 10h Korrektur"-Einträge. Echte Arbeitszeiten bleiben erhalten.</p>
    <div style="background:#fff3cd;border:1.5px solid var(--warn);border-radius:8px;padding:12px 14px;font-size:13px;color:#856404;margin-bottom:16px">
      ⚠ Bereinigt <strong>alle Mitarbeiter, alle Monate</strong> auf einmal. Diese Aktion kann nicht rückgängig gemacht werden.
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-danger" onclick="runCarryoverCleanup()" style="width:auto">🧹 Alle Korrekturen löschen</button>
      <button class="btn btn-outline" onclick="closeModal()" style="width:auto">Abbrechen</button>
    </div>`);
}

export function runCarryoverCleanup(){
  let removed=0;
  const byUser={};
  mutate(d=>{
    if(!d.entries) return;
    Object.keys(d.entries).forEach(k=>{
      const daysObj=d.entries[k].days;
      if(!daysObj) return;
      const uid=k.split('_')[0];
      Object.keys(daysObj).forEach(ds=>{
        const day=daysObj[ds];
        if(day.b1bem==='Übertrag 10h Korrektur'){
          day.b1von=''; day.b1bis=''; day.b1zuord=''; day.b1bem='';
          byUser[uid]=(byUser[uid]||0)+1; removed++;
        }
        if(day.b2bem==='Übertrag 10h Korrektur'){
          day.b2von=''; day.b2bis=''; day.b2zuord=''; day.b2bem='';
          byUser[uid]=(byUser[uid]||0)+1; removed++;
        }
        // ktmin > 600 is cascaded carryover (manual max ~240, normal max ~480)
        if(Number(day.ktmin||0)>600){
          day.ktmin=0;
          byUser[uid]=(byUser[uid]||0)+1; removed++;
        }
        const badTime=t=>t&&t.includes(':')&&parseInt(t.split(':')[0],10)>23;
        if(badTime(day.b1bis)){ day.b1von=''; day.b1bis=''; day.b1zuord=''; day.b1bem=''; byUser[uid]=(byUser[uid]||0)+1; removed++; }
        if(badTime(day.b2bis)){ day.b2von=''; day.b2bis=''; day.b2zuord=''; day.b2bem=''; byUser[uid]=(byUser[uid]||0)+1; removed++; }
        if(!day.b1von&&!day.b1bis&&!day.b2von&&!day.b2bis&&!Number(day.ktmin)&&!day.b1bem&&!day.b2bem)
          delete daysObj[ds];
      });
      if(d.entries[k].days&&Object.keys(d.entries[k].days).length===0)
        delete d.entries[k].days;
    });
  });
  closeModal();
  try{ window.renderZeiterfassung?.(); }catch(e){}
  if(removed===0){
    toast('Keine Übertrag-Korrekturen gefunden – alles sauber ✓','ok');
  } else {
    const detail=Object.entries(byUser).map(([uid,n])=>{ const u=getUser(uid); return `${u?u.name:uid}: ${n}`; }).join(', ');
    toast(`✓ ${removed} Einträge bereinigt (${detail})`,'ok');
  }
}

// ── Pause-Migration ────────────────────────────────────────────────
// Historische Einträge: Pause wurde in der Formel abgezogen, aber b1bis
// (Abfahrtszeit) wurde damals noch nicht angepasst → zu wenige Stunden.
// Diese Migration addiert die auto-Pause zur gespeicherten b1bis.
export function showPauseMigration(){
  const d=getData();
  const ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
  let count=0;
  const preview=[];
  Object.entries(d.entries||{}).forEach(([ek,entry])=>{
    Object.entries(entry.days||{}).forEach(([ds,day])=>{
      if(!day.b1von||!day.b1bis) return;
      if(ABS.has(day.b1zuord)||ABS.has(day.b1bem)) return;
      if(day.b2von) return; // Zwei-Block-Tag: Pause liegt im Gap
      const gross=diffMin(day.b1von,day.b1bis)+Number(day.ktmin||0);
      const autoPause=gross>=540?45:gross>=360?30:0;
      if(autoPause===0) return;
      // Bereits migriert? Prüfen ob b1bis schon die Pause enthält
      if(day._pauseMigrated) return;
      count++;
      if(preview.length<5){
        const uid=ek.split('_')[0];
        const u=getUser(uid);
        preview.push(`${u?.name||uid} · ${ds}: ${day.b1von}–${day.b1bis} → ${addMin(day.b1bis,autoPause)} (+${autoPause} Min.)`);
      }
    });
  });

  if(count===0){
    openModal(`<h3>✅ Pause-Migration</h3>
      <p style="font-size:13px;color:var(--muted);margin:12px 0">Keine Einträge gefunden die migriert werden müssen – alles aktuell.</p>
      <div class="modal-btns"><button class="btn btn-primary" onclick="closeModal()">Schließen</button></div>`);
    return;
  }

  const previewHtml=preview.map(p=>`<div style="font-family:monospace;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border)">${p}</div>`).join('');
  openModal(`<h3>🔧 Pause-Migration</h3>
    <p style="font-size:13px;color:var(--muted);margin:10px 0 8px">
      <strong>${count} Einträge</strong> haben die auto-Pause noch nicht in der Abfahrtszeit.
      Die Migration addiert die Pause zur b1bis, damit die Gesamtstunden korrekt sind.
    </p>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px;font-size:12px;color:#856404;margin-bottom:12px">
      ⚠ Bitte vorher ein Backup exportieren (Einstellungen → Daten exportieren)!
    </div>
    <div style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px;margin-bottom:12px">
      ${previewHtml}
      ${count>5?`<div style="font-size:12px;color:var(--muted);padding:4px 0">… und ${count-5} weitere</div>`:''}
    </div>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" onclick="runPauseMigration()">✓ Migration ausführen (${count} Einträge)</button>
    </div>`);
}

export function runPauseMigration(){
  const ABS=new Set(['Urlaub','AU/Krank','Arbeitszeitausgleich']);
  let fixed=0;
  mutate(d=>{
    Object.values(d.entries||{}).forEach(entry=>{
      Object.values(entry.days||{}).forEach(day=>{
        if(!day.b1von||!day.b1bis) return;
        if(ABS.has(day.b1zuord)||ABS.has(day.b1bem)) return;
        if(day.b2von) return;
        if(day._pauseMigrated) return;
        const gross=diffMin(day.b1von,day.b1bis)+Number(day.ktmin||0);
        const autoPause=gross>=540?45:gross>=360?30:0;
        if(autoPause===0) return;
        day.b1bis=addMin(day.b1bis,autoPause);
        day._pauseMigrated=true;
        fixed++;
      });
    });
  });
  closeModal();
  toast(`✓ Pause-Migration abgeschlossen: ${fixed} Einträge korrigiert`,'ok');
  window.renderZeiterfassung?.();
}
