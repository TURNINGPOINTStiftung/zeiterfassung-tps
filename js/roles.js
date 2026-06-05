import { getData, getCustomRoles } from './data.js';
import { DEFAULT_PERMISSIONS } from './config.js';

// Liefert das korrekte Team eines Users für ein bestimmtes Datum.
// Berücksichtigt die Team-Geschichte (teamHistory).
// Datum robust vergleichbar machen – egal ob ISO 'YYYY-MM-DD' oder deutsch 'DD.MM.YYYY'.
// Liefert 'YYYYMMDD' für einen rein chronologischen String-Vergleich.
function _cmpDate(s){
  if(!s&&s!==0) return '';
  s=String(s).trim();
  let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0');
  m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if(m) return m[3]+m[2].padStart(2,'0')+m[1].padStart(2,'0');
  return s;
}

export function getTeamForDate(user, dateStr){
  if(!user) return '';
  const hist=user.teamHistory;
  if(Array.isArray(hist)&&hist.length){
    const ds=_cmpDate(dateStr);
    // Neuester Eintrag, dessen fromDate <= dateStr (datumsformat-robust)
    const sorted=[...hist].sort((a,b)=>_cmpDate(b.fromDate).localeCompare(_cmpDate(a.fromDate)));
    const e=sorted.find(h=>_cmpDate(h.fromDate)<=ds);
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

export function canSeeEmployee(mgr,emp,dateStr){
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
    const t=getLeitungTeams(mgr);
    if(t.length===0) return true;
    // History-aware: für ein bestimmtes Datum das damals gültige Team prüfen
    // (sonst das aktuelle). So sieht z.B. die Akademie-Leitung Simon bis Mai,
    // die Marketing-Leitung ab Juni.
    const empTeam=dateStr?getTeamForDate(emp,dateStr):emp.team;
    return t.includes(empTeam);
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
