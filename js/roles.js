import { getData, getCustomRoles } from './data.js';
import { DEFAULT_PERMISSIONS } from './config.js';

// Liefert das korrekte Team eines Users für ein bestimmtes Datum.
// Berücksichtigt die Team-Geschichte (teamHistory).
export function getTeamForDate(user, dateStr){
  if(!user) return '';
  const hist=user.teamHistory;
  if(Array.isArray(hist)&&hist.length){
    // Neuester Eintrag, dessen fromDate <= dateStr
    const sorted=[...hist].sort((a,b)=>b.fromDate.localeCompare(a.fromDate));
    const e=sorted.find(h=>h.fromDate<=dateStr);
    if(e) return e.team||'';
    // Datum vor erstem Eintrag → ältesten nehmen
    return sorted[sorted.length-1]?.team||user.team||'';
  }
  return user.team||'';
}

// Hilfsfunktion: YYYY-MM-01 aus year/month
export function monthStartDate(y,m){ return `${y}-${String(m).padStart(2,'0')}-01`; }

// Prüft ob eine Rolle eine bestimmte Berechtigung hat
// Admin hat immer alle Berechtigungen
export function hasPermission(permission, role){
  if(role==='admin') return true;
  const d=getData();
  const perms=(d.rolePermissions&&d.rolePermissions[permission])
    ?? DEFAULT_PERMISSIONS[permission]
    ?? [];
  return perms.includes(role);
}

export function isFreelancer(u){ return u&&u.role==='freiberuflich'; }
export function isBerater(u){ return u&&u.role==='berater'; }
export function isManagerRole(u){ return u&&(u.role==='leitung'||u.role==='geschaeftsfuehrer'||u.role==='admin'); }
export function getLeitungTeams(u){ return (u&&u.role==='leitung'&&Array.isArray(u.teams))?u.teams:[]; }
export function isAdminUser(u){ return u&&(u.role==='admin'||(u.role==='leitung'&&getLeitungTeams(u).length===0)); }

export function teamHasLeitung(teamName){
  if(!teamName) return false;
  return getData().users.some(u=>u.role==='leitung'&&Array.isArray(u.teams)&&u.teams.includes(teamName));
}

export function canSeeEmployee(mgr,emp){
  if(!emp) return false;
  if(mgr.role==='admin') return true;
  if(mgr.role==='geschaeftsfuehrer'){
    // Mitarbeiter mit noReport (private ZE, nicht reportpflichtig) sind für GF unsichtbar
    if(emp.noReport) return false;
    if(emp.role==='leitung'||emp.role==='berater') return true;
    if(emp.role==='admin'||emp.role==='geschaeftsfuehrer') return false;
    return !teamHasLeitung(emp.team);
  }
  if(mgr.role==='leitung'){
    if(isBerater(emp)) return false;
    const t=getLeitungTeams(mgr); return t.length===0||t.includes(emp.team);
  }
  return false;
}

export function canSeeAbsence(viewer,target){
  return !!(target&&target.id);
}

export function _baseRoleLabel(r){
  return r==='leitung'?'Leitung':
         r==='geschaeftsfuehrer'?'Geschäftsführung':
         r==='admin'?'Administrator':
         r==='freiberuflich'?'Freiberuflich':
         r==='berater'?'Berater/in':'Mitarbeiter/in';
}

export function roleLabel(r,u){
  if(u?.customRole){
    const cr=getCustomRoles().find(c=>c.id===u.customRole);
    if(cr) return cr.label;
  }
  return _baseRoleLabel(r);
}
