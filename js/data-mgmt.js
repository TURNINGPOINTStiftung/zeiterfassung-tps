import { STORAGE_KEY } from './config.js';
import { getData, getUser, mutate, saveRaw } from './data.js';
import { computeAutoCarry } from './calc.js';
import { openModal, closeModal, toast, diffMin, addMin, localISODate } from './utils.js';

// Große/zerstörerische Datenoperationen (Gesamt-Export, Import/Überschreiben, Reset)
// sind ausschließlich dem Admin vorbehalten. Normale Nutzung (eigene Zeiten) bleibt offen.
// NUR der Account „Administrator" – delegierter Verwaltungs-Zugriff reicht dafür nicht.
const _isAdmin = () => { const cu=window.cu; return !!(cu && cu.role==='admin'); };
// EXPORT (nur Lesen) zusätzlich für „System-Verwaltung" (Recht zugriff_verwaltung, vom Admin vergeben).
// Import/Überschreiben/Reset bleiben ausschließlich beim Administrator.
const _mayExport = () => { const cu=window.cu; if(!cu) return false; if(cu.role==='admin') return true;
  try{ return !!(window.hasPermission && window.hasPermission('zugriff_verwaltung', cu)); }catch(e){ return false; } };
// Für Nicht-Admins: Passwort-Hashes und Reset-Daten NICHT in die Datei (Export ist dann eine
// Lese-Kopie, kein vollständiger Wiederherstellungsstand).
function _exportZe(){
  const d=JSON.parse(JSON.stringify(getData()||{}));
  if(_isAdmin()) return d;
  ['users','archivedUsers'].forEach(k=>{ if(Array.isArray(d[k])) d[k].forEach(u=>{ if(u) delete u.pw; }); });
  ['pwResetTokens','pwResetRequests','loginDir','uidUser','allowed','admins','gfAdmins','managers','grants'].forEach(k=>{ delete d[k]; });
  d._redacted='ohne Passwort-Hashes (Export durch System-Verwaltung)';
  return d;
}

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

function _dlJson(obj, prefix){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${prefix}_${localISODate()}.json`;
  a.click();
}
// Nur Zeiterfassung
export function exportData(){
  if(!_mayExport()){ toast('Nur Administrator oder System-Verwaltung darf die Gesamtdaten exportieren.','err'); return; }
  _dlJson(_exportZe(), 'Zeiterfassung-Backup');
  toast('Zeiterfassungs-Backup erstellt ✓','ok');
}
// Alles: Zeiterfassung + CRM + Shop in EINER Datei (drei getrennte Teile)
export function exportAllData(){
  if(!_mayExport()){ toast('Nur Administrator oder System-Verwaltung darf exportieren.','err'); return; }
  let crm=null, shop=null;
  try{ crm=window.crmExportBlob?window.crmExportBlob():null; }catch(e){}
  try{ shop=window.shopExportBlob?window.shopExportBlob():null; }catch(e){}
  _dlJson({ _type:'tps-vollbackup', _v:2, exportedAt:new Date().toISOString(), zeiterfassung:_exportZe(), crm:crm, shop:shop }, 'TPS-Vollbackup');
  toast(crm?'Vollbackup erstellt (Zeiterfassung + CRM + Shop) ✓':'Nur Zeiterfassung gesichert – CRM/Shop waren nicht geladen (einmal CRM öffnen).', crm?'ok':'err');
}
// Nur CRM (ohne Shop)
export function exportCrmOnly(){
  if(!_mayExport()){ toast('Nur Administrator oder System-Verwaltung darf exportieren.','err'); return; }
  let crm=null; try{ crm=window.crmExportBlob?window.crmExportBlob():null; }catch(e){}
  if(!crm){ toast('CRM-Daten nicht verfügbar – bitte das CRM einmal öffnen und erneut versuchen.','err'); return; }
  _dlJson({ _type:'tps-crm-backup', _v:2, exportedAt:new Date().toISOString(), crm:crm }, 'CRM-Backup');
  toast('CRM-Backup erstellt ✓ (ohne Shop)','ok');
}
// Nur Shop (Artikel, Orte, Bestellungen, Ausleihen, Verlauf, Einstellung)
export function exportShopOnly(){
  if(!_mayExport()){ toast('Nur Administrator oder System-Verwaltung darf exportieren.','err'); return; }
  let shop=null; try{ shop=window.shopExportBlob?window.shopExportBlob():null; }catch(e){}
  if(!shop){ toast('Shop-Daten nicht verfügbar – bitte die App neu laden und erneut versuchen.','err'); return; }
  _dlJson({ _type:'tps-shop-backup', _v:1, exportedAt:new Date().toISOString(), shop:shop }, 'Shop-Backup');
  toast('Shop-Backup erstellt ✓','ok');
}
// Direkt hier registrieren (nicht über main.js importieren): eine neue benannte Import-Beziehung
// würde bei einem Cache-Mischzustand nach dem Update den App-Start blockieren.
try{ window.exportShopOnly=exportShopOnly; }catch(e){}

// Import: erkennt automatisch Vollbackup ({_type:'tps-vollbackup', zeiterfassung, crm, shop?}),
// CRM-Backup ({_type:'tps-crm-backup', crm}), Shop-Backup ({_type:'tps-shop-backup', shop})
// oder ein reines Zeiterfassungs-Blob ({users,entries}). CRM und Shop werden GETRENNT eingespielt:
// ein CRM-Backup lässt den Shop unberührt und umgekehrt. Alte Vollbackups (Shop steckte im CRM-Teil)
// stellen den Shop trotzdem mit her.
export function importData(e){
  if(!_isAdmin()){ toast('Nur der Administrator darf Daten importieren/überschreiben.','err'); try{ e.target.value=''; }catch(_){} return; }
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      const isVoll = d && d._type==='tps-vollbackup';
      const isCrm  = d && d._type==='tps-crm-backup';
      const isShop = d && d._type==='tps-shop-backup';
      const ze  = isVoll ? d.zeiterfassung : ((isCrm||isShop) ? null : d);
      const crm = (isVoll||isCrm) ? d.crm : null;
      // Shop: eigener Teil, bei alten Vollbackups aus dem CRM-Teil herausgelöst; ein CRM-Backup
      // spielt NIE den Shop ein (Trennung), auch wenn eine alte Datei Shop-Daten enthält.
      let shop = isShop ? d.shop : (isVoll ? (d.shop || null) : null);
      if(isVoll && !shop && crm && window.crmSplitShop){ try{ shop=window.crmSplitShop(crm).shop; }catch(_){} }
      if((crm||isShop||shop) && !window.crmBackupSplitReady){ toast('Die App ist noch nicht vollständig aktualisiert – bitte neu laden (Profil → App aktualisieren) und erneut einspielen.','err'); try{ e.target.value=''; }catch(_){} return; }
      const hasZE = !!(ze && ze.users && ze.entries);
      if(!hasZE && !crm && !shop) throw new Error('unrecognized');
      const parts=[hasZE&&'Zeiterfassung', crm&&'CRM', shop&&'Shop'].filter(Boolean);
      const what = parts.length>1 ? parts.join(' + ') : 'nur '+parts[0];
      const keep=['CRM','Shop'].filter(p=>!parts.includes(p));
      if(!confirm(`Backup einspielen: ${what}.\n\nDie betroffenen aktuellen Daten werden vollständig ersetzt.`+(keep.length?`\n${keep.join(' und ')} bleib${keep.length>1?'en':'t'} unverändert.`:'')+`\n\nFortfahren?`)){ try{ e.target.value=''; }catch(_){} return; }
      const tasks=[];
      if(hasZE){
        // Beabsichtigte Vollersetzung: Datenverlust-Schutz für DIESEN Schreibvorgang erlauben.
        window._allowDataShrink=true;
        tasks.push(Promise.resolve(saveRaw(ze)).finally(()=>{ window._allowDataShrink=false; }));
      }
      if(crm && window.crmRestoreBlob){ tasks.push(Promise.resolve(window.crmRestoreBlob(crm))); }   // lässt den Shop unberührt
      if(shop && window.shopRestoreBlob){ tasks.push(Promise.resolve(window.shopRestoreBlob(shop))); } // lässt das CRM unberührt
      Promise.all(tasks).finally(()=>{
        toast('Import erfolgreich – Seite wird neu geladen…','ok');
        setTimeout(()=>location.reload(),1200);
      });
    }catch(err){ toast('Ungültige oder unbekannte Backup-Datei.','err'); }
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
    <div style="background:var(--warn-bg,#fff3cd);border:1.5px solid var(--warn);border-radius:8px;padding:12px 14px;font-size:13px;color:var(--warn-text,#856404);margin-bottom:16px">
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

