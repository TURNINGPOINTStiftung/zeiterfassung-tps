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

export function catOptionsForUser(user,selected=''){
  if(isFreelancer(user)) return catOptionsFree(selected);
  const norm=normZuord(selected);
  const cats=[...new Set(getCatsForTeam(user&&user.team||'').map(normZuord))];
  return `<option value=""></option>`+cats.map(c=>`<option value="${c}"${c===norm?' selected':''}>${c}</option>`).join('');
}
