import { getData, getCustomRoles } from './data.js';
import { DEFAULT_PERMISSIONS } from './config.js';

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
  return r==='leitung'?'Leitungspersonal':
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
