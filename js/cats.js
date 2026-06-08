import { DEFAULT_CATS, DEFAULT_TEAM_CATS } from './config.js';
import { getData } from './data.js';
import { _fk } from './data.js';
import { isFreelancer } from './roles.js';
import { normZuord } from './calc.js';

export function getCats(){ return getData().cats||[...DEFAULT_CATS]; }
export function getTeams(){ return getData().teams||[]; }

export function catOptions(selected=''){
  return `<option value=""></option>`+getCats().map(c=>`<option value="${c}"${c===selected?' selected':''}>${c}</option>`).join('');
}

export function catOptionsFree(selected=''){
  const FREE_CATS=['AKADEMIE','WENDESTART','WENDEKURS','WENDETRAINING'];
  return `<option value=""></option>`+FREE_CATS.map(c=>`<option value="${c}"${c===selected?' selected':''}>${c}</option>`).join('');
}

export function getCatsForTeam(teamName){
  const d=getData();
  if(teamName&&d.teamCats){
    const arr=d.teamCats[_fk(teamName)];
    if(Array.isArray(arr)) return arr;
  }
  if(teamName&&DEFAULT_TEAM_CATS[teamName]) return DEFAULT_TEAM_CATS[teamName];
  return d.cats||[...DEFAULT_CATS];
}

// Liefert die AKTUELL gültigen Zuordnungskategorien eines Nutzers als Array
// (Freiberufler: feste Liste, sonst die Team-Kategorien + Standard-Sonderkategorien).
// Wird von der Statistik genutzt, um nur aktuelle Kategorien anzuzeigen – nicht
// jede jemals in den Daten vorkommende (alte/umbenannte) Zuordnung.
export function currentCatsForUser(user){
  if(isFreelancer(user)) return ['AKADEMIE','WENDESTART','WENDEKURS','WENDETRAINING'];
  const teams=Array.isArray(user?.teams)&&user.teams.length?user.teams:(user?.team?[user.team]:[]);
  const out=new Set();
  (teams.length?teams:['']).forEach(t=>getCatsForTeam(t).forEach(c=>out.add(c)));
  ['Urlaub','AU/Krank','Arbeitszeitausgleich','Sonstiges','Veranstaltung Krank / AU'].forEach(c=>out.add(c));
  return [...out];
}

export function catOptionsForUser(user,selected=''){
  if(isFreelancer(user)) return catOptionsFree(selected);
  const norm=normZuord(selected);
  // Team-Kategorien des Nutzers (mehrere Teams möglich)
  const userTeams=Array.isArray(user?.teams)&&user.teams.length
    ? user.teams : (user?.team ? [user.team] : []);
  const teamCats=new Set(
    (userTeams.length?userTeams:[''])
    .flatMap(t=>getCatsForTeam(t).map(normZuord))
  );

  // Abwesenheits-Kategorien immer verfügbar machen (sonst zeigt eine
  // automatisch gesetzte Zuordnung wie "Urlaub"/"AU/Krank" nichts an)
  teamCats.add('Urlaub'); teamCats.add('AU/Krank');

  let cats;
  const isLeitung=user&&user.role==='leitung';
  if(isLeitung){
    // Leitung: ALLE Kategorien (alle Teams + Standard), Team-Kategorien markiert
    const all=new Set();
    getTeams().forEach(t=>getCatsForTeam(t).forEach(c=>all.add(normZuord(c))));
    (getData().cats||DEFAULT_CATS).forEach(c=>all.add(normZuord(c)));
    teamCats.forEach(c=>all.add(c));
    cats=[...all].sort((a,b)=>{ // eigene Team-Kategorien zuerst
      const ta=teamCats.has(a),tb=teamCats.has(b);
      if(ta!==tb) return ta?-1:1;
      return a.localeCompare(b,'de');
    });
  } else {
    cats=[...teamCats];
  }
  // Gespeicherte Zuordnung (z.B. „Veranstaltung") immer anzeigbar machen,
  // auch wenn sie nicht in den Team-Kategorien steht – sonst bleibt das Feld leer.
  if(norm&&!cats.includes(norm)) cats.unshift(norm);

  // Abwesenheits-/Sonderkategorien ans Ende sortieren (Urlaub & AU/Krank ganz unten).
  const _tail=['Arbeitszeitausgleich','Sonstiges','Veranstaltung Krank / AU','Urlaub','AU/Krank'];
  cats=[...cats.filter(c=>!_tail.includes(c)), ..._tail.filter(c=>cats.includes(c))];

  return `<option value=""></option>`+cats.map(c=>{
    const sel=c===norm?' selected':'';
    const mark=isLeitung&&teamCats.has(c);
    const style=mark?' style="background:#eaf7ea;color:#2e7d32;font-weight:600"':'';
    return `<option value="${c}"${sel}${style}>${c}</option>`;
  }).join('');
}
