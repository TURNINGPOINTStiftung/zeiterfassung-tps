import { STORAGE_KEY } from './config.js';
import { getData, getUser, mutate, saveRaw } from './data.js';
import { computeAutoCarry } from './calc.js';
import { openModal, closeModal, toast, diffMin, addMin } from './utils.js';

// Große/zerstörerische Datenoperationen (Gesamt-Export, Import/Überschreiben, Reset)
// sind ausschließlich dem Admin vorbehalten. Normale Nutzung (eigene Zeiten) bleibt offen.
const _isAdmin = () => ((window.cu && window.cu.role) === 'admin');

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
  if(!_isAdmin()){ toast('Nur der Administrator darf die Gesamtdaten exportieren.','err'); return; }
  const blob=new Blob([JSON.stringify(getData(),null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`zeiterfassung_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

export function importData(e){
  if(!_isAdmin()){ toast('Nur der Administrator darf Daten importieren/überschreiben.','err'); try{ e.target.value=''; }catch(_){} return; }
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
  if(!_isAdmin()){ toast('Nur der Administrator darf die Daten zurücksetzen.','err'); return; }
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

