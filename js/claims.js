// Freigabe-Markierung am Anmeldekonto (Custom Claim tps:true).
// Die Storage-Regeln (Backups, CRM-Anhänge) können die Datenbank nicht lesen und prüfen deshalb diese
// Markierung im Anmelde-Token. Gesetzt/entfernt wird sie nur von der Cloud Function tpsPw
// (claimSelf: eigenes Konto nach zeiterfassung/allowed; claimSync: Admin gleicht alle Konten ab).
// Alles best-effort: ohne Function (alter Stand) oder offline passiert einfach nichts.
import { PW_FUNCTION_URL } from './config.js';

async function _fn(payload){
  const me=firebase.auth().currentUser; if(!me) throw new Error('Nicht angemeldet.');
  const r=await fetch(PW_FUNCTION_URL,{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+await me.getIdToken()}, body:JSON.stringify(payload) });
  let j={}; try{ j=await r.json(); }catch(_){}
  if(!r.ok||!j.ok) throw new Error(j.error||('HTTP '+r.status));
  return j;
}

let _busy=null;
// Fehlt die Markierung im Token: beim Server anfordern und Token auffrischen.
export function ensureAccessClaim(){
  if(_busy) return _busy;
  _busy=(async()=>{
    try{
      const me=firebase.auth().currentUser; if(!me) return false;
      const t=await me.getIdTokenResult();
      if(t.claims && t.claims.tps===true) return true;
      const j=await _fn({ action:'claimSelf' });
      if(j.tps){ await me.getIdToken(true); return true; }
      return false;
    }catch(e){ console.warn('Freigabe-Markierung:', e&&e.message); return false; }
    finally{ setTimeout(()=>{ _busy=null; }, 0); }
  })();
  return _busy;
}

// Admin: alle Konten abgleichen (nach Rechte-/Nutzeränderungen, siehe refreshPermissionAllowlists).
export async function syncAccessClaims(){
  try{ return await _fn({ action:'claimSync' }); }
  catch(e){ console.warn('Freigabe-Markierung (alle):', e&&e.message); return null; }
}

// Nach jeder Anmeldung / beim Start mit gemerkter Sitzung kurz verzögert prüfen.
// Aufruf aus main.js, sobald Firebase initialisiert ist.
export function initAccessClaims(){
  try{ firebase.auth().onAuthStateChanged(u=>{ if(u && !window._offlineMode) setTimeout(()=>{ ensureAccessClaim(); }, 2500); }); }
  catch(e){ console.warn('Freigabe-Markierung init:', e&&e.message); }
}

try{ window.ensureAccessClaim=ensureAccessClaim; window.syncAccessClaims=syncAccessClaims; }catch(e){}
