import { STORAGE_KEY } from './config.js';
import { getData, getUser, mutate, saveRaw } from './data.js';
import { openModal, closeModal, toast } from './utils.js';

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
      saveRaw(d); toast('Import erfolgreich – Seite wird neu geladen…','ok');
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
