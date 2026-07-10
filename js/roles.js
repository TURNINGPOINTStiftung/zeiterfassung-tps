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
// hasPermission akzeptiert eine Rolle (String, legacy) ODER ein User-Objekt.
// Bei einem User-Objekt gilt zuerst die pro-User-Übersteuerung (u.perms),
// sonst die rollenbasierten Defaults. So lassen sich Rechte pro Person setzen,
// ohne die bestehende rollenbasierte Logik zu brechen.
export function hasPermission(permission, roleOrUser){
  const user = (roleOrUser && typeof roleOrUser==='object') ? roleOrUser : null;
  const role = user ? user.role : roleOrUser;
  if(role==='admin') return true;
  if(user && user.perms && Object.prototype.hasOwnProperty.call(user.perms, permission)){
    return !!user.perms[permission];
  }
  const d=getData();
  const perms=(d.rolePermissions&&d.rolePermissions[permission])
    ?? DEFAULT_PERMISSIONS[permission]
    ?? [];
  return perms.includes(role);
}

// Effektives Recht eines konkreten Users (für die pro-User-Bearbeitung).
export function userHasPermission(permission, user){ return hasPermission(permission, user); }

export function isFreelancer(u){ return u&&u.role==='freiberuflich'; }
export function isBerater(u){ return u&&u.role==='berater'; }
export function isManagerRole(u){ return u&&(u.role==='leitung'||u.role==='geschaeftsfuehrer'||u.role==='admin'); }
export function getLeitungTeams(u){ return (u&&u.role==='leitung'&&Array.isArray(u.teams))?u.teams:[]; }
export function isAdminUser(u){ return u&&(u.role==='admin'||(u.role==='leitung'&&getLeitungTeams(u).length===0)); }

export function teamHasLeitung(teamName){
  if(!teamName) return false;
  return getData().users.some(u=>{
    if(u.role!=='leitung') return false;
    const lt=(Array.isArray(u.teams)&&u.teams.length)?u.teams:(u.team?[u.team]:[]);
    return lt.includes(teamName);
  });
}

export function canSeeEmployee(mgr,emp,dateStr){
  if(!emp) return false;
  if(mgr.role==='admin') return true;
  if(mgr.role==='geschaeftsfuehrer'){
    // Mitarbeiter mit noReport (private ZE, nicht reportpflichtig) sind für GF unsichtbar
    if(emp.noReport) return false;
    // Leitung meldet an den GF: der GF sieht die Leitung in der Übersicht und kann ihre
    // EINGEREICHTEN Monate gegenzeichnen (Entwürfe bleiben in der Übersicht nicht
    // anklickbar → die Live-Erfassung bleibt privat). Die Buchhaltungsversion in den
    // GF-Berichten bleibt zusätzlich erhalten.
    if(emp.role==='leitung') return true;
    if(emp.role==='berater') return true;
    if(emp.role==='admin'||emp.role==='geschaeftsfuehrer') return false;
    // GF sieht einen Mitarbeiter nur, wenn KEINES seiner Teams eine Leitung hat
    // (sonst reportet ihn die Leitung). Alle Teams prüfen, nicht nur das primäre.
    const empTeams=(Array.isArray(emp.teams)&&emp.teams.length)?emp.teams:(emp.team?[emp.team]:[]);
    return !empTeams.some(t=>teamHasLeitung(t));
  }
  if(mgr.role==='leitung'){
    // Andere Leitung ist ebenfalls privat (nicht durch Kolleg:innen einsehbar).
    if(isBerater(emp)||emp.role==='leitung') return false;
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

// Findet die für einen Mitarbeiter zuständige Leitung (optional zu einem Datum,
// damit Team-Wechsel via teamHistory berücksichtigt werden). Wird in der
// Unterschriftenzeile genutzt, um einen echten Namen statt nur „Leitung" zu
// zeigen, falls an einem genehmigten Eintrag kein Prüfer (reviewedBy) hinterlegt ist.
export function getResponsibleLeitung(emp, dateStr){
  if(!emp) return null;
  const leiters=(getData().users||[]).filter(u=>u.role==='leitung');
  if(!leiters.length) return null;
  return leiters.find(l=>getLeitungTeams(l).length>0 && canSeeEmployee(l,emp,dateStr))
      || leiters.find(l=>canSeeEmployee(l,emp,dateStr))
      || leiters[0];
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
