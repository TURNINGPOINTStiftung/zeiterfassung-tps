import { DEFAULT_CATS, DEFAULT_TEAM_CATS, DEFAULT_PERMISSIONS } from '../config.js';
import { getData, getUser, mutate, getCustomRoles, _fk } from '../data.js';
import { isManagerRole, canSeeEmployee, getLeitungTeams, roleLabel, _baseRoleLabel, getTeamForDate } from '../roles.js';
import { esc, toast, openModal, closeModal, wsPeriodRows, wsCollectPeriods } from '../utils.js';
import { makePwRecord } from '../auth.js';
import { getTeams, getCatsForTeam } from '../cats.js';
import { vacDailyMin } from '../calc.js';

export function renderSettings(){
  const cu=window.cu;
  const d=getData();
  document.getElementById('user-list').innerHTML=d.users.map(u=>{
    // GF: noTimesheet = ZE komplett aus | Leitung: noReport = ZE privat, nicht einreichpflichtig
    const isGFUser=u.role==='geschaeftsfuehrer';
    const isLeitungUser=u.role==='leitung';
    const zeAktiv=!u.noTimesheet;
    const reportAktiv=!u.noReport;
    const zeToggle=isGFUser
      ?`<button class="btn btn-sm btn-${zeAktiv?'warn':'ok'}" onclick="toggleGFTimesheet('${u.id}')" style="font-size:11px;padding:4px 9px">${zeAktiv?'ZE deaktivieren':'ZE aktivieren'}</button>`
      :isLeitungUser
        ?`<span style="font-size:11px;color:var(--muted)" title="Leitungs-Zeiterfassung ist immer privat; eingereichte Monate gehen als Buchhaltungsversion an die GF">🔒 ZE privat · Buchhaltung an GF</span>`
        :'';
    return `<div class="user-row">
      <div>
        <div class="name">${esc(u.name)} <span class="chip chip-${u.role}">${roleLabel(u.role,u)}</span>${(Array.isArray(u.customRoles)&&u.customRoles.length?u.customRoles:u.customRole?[u.customRole]:[]).map(cid=>{const cr=getCustomRoles().find(r=>r.id===cid);return cr?`<span class="chip" style="background:#e8f4fd;color:#1a5276;font-size:10px">${esc(cr.label)}</span>`:''}).join('')}${(Array.isArray(u.teams)&&u.teams.length?u.teams:[u.team]).filter(Boolean).map(t=>`<span class="team-badge">${t}</span>`).join('')}${u.role==='geschaeftsfuehrer'&&u.noTimesheet?'<span style="font-size:10px;color:var(--muted);margin-left:6px">ZE inaktiv</span>':''}${u.role==='leitung'&&u.noReport?'<span style="font-size:10px;color:var(--muted);margin-left:6px">ZE privat</span>':''}</div>
        <div class="details">${u.city||'–'} · ${u.role==='freiberuflich'?'flexibel':`${u.wh}h/Woche · ${u.al} T Urlaub`}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${zeToggle}
        <button class="btn btn-outline btn-sm" onclick="showEditUser('${u.id}')">Bearbeiten</button>
        ${u.id!==cu.id?`<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">×</button>`:''}
      </div>
    </div>`;
  }).join('');

  const teams=getTeams();
  document.getElementById('team-list').innerHTML=teams.length
    ? teams.map((t,i)=>`<span class="team-chip">${t} <button onclick="removeTeam(${i})" title="Entfernen">×</button></span>`).join('')
    : '<span style="color:var(--muted);font-size:13px">Noch keine Teams angelegt.</span>';

  const crs=getCustomRoles();
  const crEl=document.getElementById('custom-role-list');
  if(crEl) crEl.innerHTML=crs.length
    ? crs.map(r=>`<span class="team-chip">${esc(r.label)} <span style="font-size:10px;opacity:.7">(${_baseRoleLabel(r.base)})</span> <button onclick="removeCustomRole('${esc(r.id)}')" title="Entfernen">×</button></span>`).join('')
    : '<span style="color:var(--muted);font-size:13px">Noch keine eigenen Rollen.</span>';

  {
    const tms=getTeams();
    const dd2=getData();
    const mkChips=(arr,teamArg)=>arr.length
      ? arr.map((c,i)=>{
          const ta=JSON.stringify(teamArg);
          const lt=i>0?`<button onclick='moveTeamCat(${ta},${i},-1)' title="nach vorne (höher in der Liste)">‹</button> `:'';
          const rt=i<arr.length-1?` <button onclick='moveTeamCat(${ta},${i},1)' title="nach hinten (tiefer in der Liste)">›</button>`:'';
          return `<span class="cat-chip">${lt}${esc(c)} <button onclick='removeTeamCat(${ta},${i})' title="Entfernen">×</button>${rt}</span>`;
        }).join('')
      : '<span style="color:var(--muted);font-size:12px">Keine Kategorien.</span>';
    const mkSection=(label,labelColor,arr,teamArg,idx,note='')=>{
      const ta=JSON.stringify(teamArg);
      return `<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">${esc(label)}</div>
        ${note}
        <div style="margin-bottom:6px">${mkChips(arr,teamArg)}</div>
        <div class="flex mt-14">
          <input class="tag-input" id="nci-${idx}" placeholder="Neue Kategorie…" onkeydown='if(event.key===\"Enter\")addTeamCat(${ta},${idx})'>
          <button class="btn btn-ok btn-sm" onclick='addTeamCat(${ta},${idx})'>+</button>
        </div>
      </div>`;
    };
    let csHtml='<div style="font-size:11px;color:var(--muted);margin-bottom:10px;padding:6px 10px;background:#f5f7fa;border-radius:6px">Mit ‹ › die Reihenfolge ändern. Urlaub &amp; AU/Krank erscheinen in der Zeiterfassung immer ganz unten.</div>';
    csHtml+=mkSection('Standard (kein Team)','var(--muted)',dd2.cats||[...DEFAULT_CATS],null,0);
    tms.forEach((t,i)=>{
      const isCustom=dd2.teamCats&&Array.isArray(dd2.teamCats[_fk(t)]);
      const arr=isCustom?dd2.teamCats[_fk(t)]:getCatsForTeam(t);
      const note=isCustom?'':'<div style="font-size:10px;color:var(--muted);margin-bottom:4px">↳ Vorkonfigurierte Kategorien – Änderungen gelten nur für dieses Team</div>';
      csHtml+=mkSection(t,'var(--primary)',arr,t,i+1,note);
    });
    csHtml+=`<div style="padding:6px 10px;background:#f5f5f5;border-radius:6px;font-size:11px;color:var(--muted)">★ Freiberufliche: AKADEMIE · WENDESTART · WENDEKURS · WENDETRAINING (fest, nicht änderbar)</div>`;
    document.getElementById('cat-section').innerHTML=csHtml;
  }

  // ── Berechtigungs-Matrix ──
  const permEl=document.getElementById('permissions-section');
  if(permEl) renderPermissionsMatrix(permEl);

  // Mitarbeiter-Tabelle in der Verwaltungs-Ebene mit aktualisieren (falls offen)
  try{ window._refreshVerwUsers && window._refreshVerwUsers(); }catch(e){}
}

// ── Einmalige Datenkorrektur (Admin) ─────────────────────────────────
// Genehmigte Zeiterfassungen und an die GF gesendete Berichte, die
// versehentlich über das Admin-Konto liefen, der Leitung „Moritz Kriese"
// zuordnen. Zeigt vor dem Schreiben eine Vorschau. Idempotent – mehrfaches
// Ausführen ist gefahrlos (bereits korrigierte Einträge werden übersprungen).
// Es werden NUR Genehmiger-/Absender-Felder gesetzt – Zeiten/Inhalte bleiben unangetastet.
export function fixApproverToLeitung(){
  const cu=window.cu;
  if(!cu||cu.role!=='admin'){ toast('Nur als Admin möglich.','err'); return; }
  const d=getData();
  const users=d.users||[];
  const isAdminId=id=>{ const u=id?getUser(id):null; return !!u&&u.role==='admin'; };
  const uidOf=k=>{ const p=k.split('_'); return p.slice(0,-2).join('_'); };
  const monthStart=(y,m)=>y+'-'+String(m).padStart(2,'0')+'-01';
  const leiters=users.filter(u=>u.role==='leitung'&&getLeitungTeams(u).length>0);
  // Zuständige Team-Leitung eines Mitarbeiters zu einem Datum (History-aware).
  const respLeit=(emp,dateStr)=> emp?(leiters.find(l=>canSeeEmployee(l,emp,dateStr))||null):null;
  // Team-Leitung anhand des Teamnamens (auch „Leitung <Team>"-Label).
  const leitForTeam=(team)=>{ if(!team) return null; const t=String(team).replace(/^Leitung\s+/i,''); return leiters.find(l=>getLeitungTeams(l).includes(t))||null; };

  const tsPlan=[], yrPlan=[], tmPlan=[], skipped=[];

  // 1) Genehmigte Zeiterfassungen → Prüfer = zuständige TEAM-Leitung (nicht Admin/„Moritz").
  Object.entries(d.entries||{}).forEach(([k,e])=>{
    if(!(e&&e.status==='approved')) return;
    const emp=getUser(uidOf(k)); if(!emp||emp.role==='leitung') return; // Leitungs-eigene ZE unangetastet
    const p=k.split('_'); const y=+p[p.length-2], m=+p[p.length-1];
    const leit=respLeit(emp, monthStart(y,m));
    if(!leit){ if(isAdminId(e.reviewedBy)) skipped.push('ZE '+emp.name+' '+m+'/'+y); return; }
    if(e.reviewedBy===leit.id) return; // schon korrekt
    tsPlan.push({k, leitId:leit.id, leitName:leit.name});
  });
  // 2) Jahresberichte → Absender = zuständige Leitung des jeweiligen Mitarbeiters.
  Object.entries(d.yearReports||{}).forEach(([id,r])=>{
    if(!r) return; const emp=getUser(r.userId); const leit=emp?respLeit(emp, (r.year||new Date().getFullYear())+'-06-01'):null;
    if(!leit||r.sentBy===leit.id) return; yrPlan.push({id, leitId:leit.id, leitName:leit.name});
  });
  // 3) Teamberichte → Leitung = Leitung des Team-Berichts (eigene „LEIT_"-Berichte auslassen).
  Object.entries(d.teamReports||{}).forEach(([id,r])=>{
    if(!r||String(id).startsWith('LEIT_')) return;
    const leit=leitForTeam(r.teamName||(Array.isArray(r.managedTeams)&&r.managedTeams[0]));
    if(!leit||r.leitungId===leit.id) return; tmPlan.push({id, leitId:leit.id, leitName:leit.name});
  });

  const total=tsPlan.length+yrPlan.length+tmPlan.length;
  if(!total){
    alert('Nichts zu korrigieren ✓\n\nAlle Genehmiger/Absender sind bereits die jeweilige Team-Leitung.'
      +(skipped.length?'\n\n⚠ '+skipped.length+' Eintrag/Einträge haben keine zuständige Team-Leitung (bleiben unverändert).':''));
    return;
  }
  const byLeit={}; tsPlan.forEach(x=>{ byLeit[x.leitName]=(byLeit[x.leitName]||0)+1; });
  let msg='Genehmiger/Absender werden auf die jeweilige TEAM-LEITUNG gesetzt:\n\n'
    +'• '+tsPlan.length+' genehmigte Zeiterfassung(en)\n'
    +'• '+yrPlan.length+' Jahresbericht(e)\n'
    +'• '+tmPlan.length+' Teambericht(e)\n';
  if(Object.keys(byLeit).length) msg+='\nZeiterfassungen je Leitung:\n'+Object.entries(byLeit).map(([n,c])=>'  • '+n+': '+c).join('\n')+'\n';
  if(skipped.length) msg+='\n⚠ '+skipped.length+' ohne zuständige Team-Leitung (bleiben unverändert).\n';
  msg+='\nZeiten und Inhalte bleiben unverändert – es wird nur der/die Genehmiger/Absender gesetzt.\n\nFortfahren?';
  if(!confirm(msg)) return;

  mutate(dd=>{
    tsPlan.forEach(x=>{ if(dd.entries&&dd.entries[x.k]) dd.entries[x.k].reviewedBy=x.leitId; });
    yrPlan.forEach(x=>{ if(dd.yearReports&&dd.yearReports[x.id]){ dd.yearReports[x.id].sentBy=x.leitId; dd.yearReports[x.id].sentByName=x.leitName; } });
    tmPlan.forEach(x=>{ if(dd.teamReports&&dd.teamReports[x.id]){ dd.teamReports[x.id].leitungId=x.leitId; dd.teamReports[x.id].leitungName=x.leitName; } });
  });
  toast(total+' Eintrag/Einträge auf die jeweilige Team-Leitung gesetzt ✓','ok');
  renderSettings();
}

// Berechtigungs-Matrix rendern + speichern
const PERM_DEFS=[
  {key:'tab_uebersicht',       label:'Tab: Mitarbeiterübersicht anzeigen'},
  {key:'tab_gfberichte',       label:'Tab: GF-Berichte anzeigen'},
  {key:'btn_teamberichte',     label:'Button: „An GF senden" (Zeiterfassung)'},
  {key:'btn_jahresbericht',    label:'Button: „An GF senden" (Jahresübersicht)'},
  {key:'btn_erinnerungen',     label:'Button: „Erinnerungen senden"'},
  {key:'genehmigung_abwesenheit', label:'Funktion: Abwesenheiten genehmigen / ablehnen'},
  {key:'stempel',              label:'Funktion: Zeitstempel nutzen'},
];
const PERM_ROLES=[
  {key:'mitarbeiter',      label:'Mitarbeiter'},
  {key:'berater',          label:'Berater'},
  {key:'freiberuflich',    label:'Freiberuflich'},
  {key:'leitung',          label:'Leitung'},
  {key:'geschaeftsfuehrer',label:'GF'},
];

function renderPermissionsMatrix(el){
  const d=getData();
  const perms=d.rolePermissions||{};
  const getVal=(pk,rk)=>{
    if(rk==='admin') return true;
    return Array.isArray(perms[pk])?perms[pk].includes(rk):DEFAULT_PERMISSIONS[pk]?.includes(rk)??false;
  };
  const hdrs=PERM_ROLES.map(r=>`<th style="text-align:center;font-size:11px;padding:6px 8px;min-width:60px">${r.label}</th>`).join('');
  const rows=PERM_DEFS.map(p=>{
    const cells=PERM_ROLES.map(r=>{
      const checked=getVal(p.key,r.key);
      return `<td style="text-align:center;padding:5px">
        <input type="checkbox" data-perm="${p.key}" data-role="${r.key}" ${checked?'checked':''}
               style="cursor:pointer;width:16px;height:16px"
               onchange="savePermission(this.dataset.perm,this.dataset.role,this.checked)">
      </td>`;
    }).join('');
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="font-size:12px;padding:7px 10px;color:var(--text)">${p.label}</td>
      ${cells}
      <td style="text-align:center;padding:5px"><span style="font-size:11px;color:var(--muted)">✓</span></td>
    </tr>`;
  }).join('');
  el.innerHTML=`
    <h3 style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:10px;margin-top:20px">🔐 Berechtigungen</h3>
    <p style="font-size:12px;color:var(--muted);margin-bottom:10px">Admin hat immer alle Rechte. Änderungen gelten sofort.</p>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1.5px solid var(--border);border-radius:8px;overflow:hidden">
      <thead><tr style="background:var(--primary);color:#fff">
        <th style="text-align:left;padding:8px 10px;font-size:12px">Berechtigung</th>
        ${hdrs}
        <th style="text-align:center;font-size:11px;padding:6px 8px">Admin</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

export function savePermission(permKey,role,checked){
  mutate(d=>{
    if(!d.rolePermissions) d.rolePermissions={};
    const cur=Array.isArray(d.rolePermissions[permKey])
      ? [...d.rolePermissions[permKey]]
      : [...(DEFAULT_PERMISSIONS[permKey]||[])];
    const idx=cur.indexOf(role);
    if(checked&&idx===-1) cur.push(role);
    if(!checked&&idx>=0) cur.splice(idx,1);
    d.rolePermissions[permKey]=cur;
  });
  // App-Navigation sofort aktualisieren
  window.initApp?.();
}

export function addTeam(){
  const inp=document.getElementById('new-team-input'); const val=inp.value.trim();
  if(!val) return;
  mutate(d=>{ if(!d.teams) d.teams=[]; if(!d.teams.includes(val)) d.teams.push(val); });
  inp.value=''; renderSettings(); window.populateUeberTeam?.(); toast('Team hinzugefügt.');
}

export function removeTeam(i){
  mutate(d=>{ d.teams.splice(i,1); });
  renderSettings(); window.populateUeberTeam?.();
}

export function addCustomRole(){
  const lbl=document.getElementById('new-role-label')?.value.trim();
  const base=document.getElementById('new-role-base')?.value||'mitarbeiter';
  if(!lbl){ toast('Bitte eine Bezeichnung eingeben.','err'); return; }
  const id=lbl.toLowerCase().replace(/[^a-z0-9äöüß]+/g,'_').replace(/^_|_$/g,'');
  const d=getData();
  if((d.customRoles||[]).find(r=>r.id===id)){ toast('Bezeichnung bereits vorhanden.','err'); return; }
  mutate(d=>{ if(!d.customRoles) d.customRoles=[]; d.customRoles.push({id,label:lbl,base}); });
  document.getElementById('new-role-label').value='';
  renderSettings(); toast('Rolle hinzugefügt.');
}

export function removeCustomRole(id){
  mutate(d=>{ d.customRoles=(d.customRoles||[]).filter(r=>r.id!==id); });
  renderSettings();
}

export function addCategory(){
  const inp=document.getElementById('new-cat-input'); if(!inp) return;
  const val=inp.value.trim();
  if(!val) return;
  mutate(d=>{ if(!d.cats.includes(val)) d.cats.push(val); });
  inp.value=''; renderSettings(); toast('Kategorie hinzugefügt.');
}

export function removeCat(i){ mutate(d=>{ d.cats.splice(i,1); }); renderSettings(); }

function _initTeamCats(d,teamName){
  if(!d.teamCats) d.teamCats={};
  const k=_fk(teamName);
  if(!Array.isArray(d.teamCats[k])){
    d.teamCats[k]=[...(DEFAULT_TEAM_CATS[teamName]||d.cats||DEFAULT_CATS)];
  }
}

export function addTeamCat(teamName,idx){
  const inp=document.getElementById('nci-'+idx);
  const val=(inp?inp.value.trim():'');
  if(!val) return;
  mutate(d=>{
    if(teamName){
      _initTeamCats(d,teamName);
      const _k=_fk(teamName);
      if(!d.teamCats[_k].includes(val)) d.teamCats[_k].push(val);
    } else {
      if(!d.cats) d.cats=[...DEFAULT_CATS];
      if(!d.cats.includes(val)) d.cats.push(val);
    }
  });
  if(inp) inp.value=''; renderSettings(); toast('Kategorie hinzugefügt.');
}

export function removeTeamCat(teamName,i){
  mutate(d=>{
    if(teamName){
      _initTeamCats(d,teamName);
      d.teamCats[_fk(teamName)].splice(i,1);
    } else {
      if(!d.cats) d.cats=[...DEFAULT_CATS];
      d.cats.splice(i,1);
    }
  });
  renderSettings();
}

// Kategorie um eine Position verschieben (dir = -1 nach vorne, +1 nach hinten).
export function moveTeamCat(teamName,i,dir){
  mutate(d=>{
    let arr;
    if(teamName){ _initTeamCats(d,teamName); arr=d.teamCats[_fk(teamName)]; }
    else { if(!d.cats) d.cats=[...DEFAULT_CATS]; arr=d.cats; }
    const j=i+dir;
    if(j<0||j>=arr.length||arr[i]===undefined) return;
    const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  });
  renderSettings();
}

export function showAddUser(){
  const cu=window.cu;
  if(cu.role!=='admin'){ toast('Kein Zugriff – nur Admin.','err'); return; }
  openModal(`<h3>Mitarbeiter hinzufügen</h3>${userForm()}<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button><button class="btn btn-ok" onclick="saveNewUser()">Speichern</button></div>`, true);
  // Inline-<script> im Formular läuft bei innerHTML NICHT → Sichtbarkeit hier explizit setzen.
  try{ toggleFreelancerFields(); toggleWerkstudentFields(); }catch(e){}
}

export function showEditUser(id){
  const cu=window.cu;
  if(cu.role!=='admin'){ toast('Kein Zugriff – nur Admin.','err'); return; }
  openModal(`<h3>Mitarbeiter bearbeiten</h3>${userForm(getUser(id))}<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">Abbrechen</button><button class="btn btn-ok" onclick="saveEditUser('${id}')">Speichern</button></div>`, true);
  // Inline-<script> im Formular läuft bei innerHTML NICHT → Sichtbarkeit hier explizit setzen.
  try{ toggleFreelancerFields(); toggleWerkstudentFields(); }catch(e){}
}

export function showEditDpw(id){
  const cu=window.cu;
  const u=getUser(id);
  if(!u){ toast('Mitarbeiter nicht gefunden.','err'); return; }
  if(cu.role!=='admin'&&!(cu.role==='leitung'&&canSeeEmployee(cu,u))){ toast('Kein Zugriff.','err'); return; }
  openModal(`<h3 style="margin-bottom:6px">Arbeitstage / Woche</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">${esc(u.name)} &middot; ${u.wh||0}&thinsp;h/Woche</p>
    <div class="form-group">
      <label>Arbeitstage pro Woche <span style="font-size:11px;color:var(--muted)">(beeinflusst Urlaubs- &amp; Krankheitsstunden)</span></label>
      <input id="edit-dpw-val" type="number" min="1" max="7" value="${u.dpw||5}" style="max-width:90px">
    </div>
    <div class="modal-btns">
      <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-ok" onclick="saveEditDpw('${id}')">Speichern</button>
    </div>`);
}

export function saveEditDpw(id){
  const val=parseInt(document.getElementById('edit-dpw-val').value)||5;
  if(val<1||val>7){ toast('Bitte einen Wert zwischen 1 und 7 eingeben.','err'); return; }
  mutate(d=>{ const u=d.users.find(x=>x.id===id); if(u) u.dpw=val; });
  closeModal(); window.renderOverview?.();
  toast('Arbeitstage pro Woche aktualisiert. ✓','ok');
}

function userForm(u={}){
  const allTeams=getTeams();
  // Teams: alle Rollen können mehrere Teams haben
  const userTeams=Array.isArray(u.teams)&&u.teams.length?u.teams:(u.team?[u.team]:[]);
  const teamChecks=allTeams.length?allTeams.map((t,i)=>`<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:13px"><input type="checkbox" id="uf-team-cb-${i}" value="${esc(t)}"${userTeams.includes(t)?' checked':''}> ${esc(t)}</label>`).join(''):'<span style="color:var(--muted);font-size:12px">Noch keine Teams angelegt.</span>';
  const BL=[['','– Bundesland –'],['BW','Baden-Württemberg'],['BY','Bayern'],['BE','Berlin'],
    ['BB','Brandenburg'],['HB','Bremen'],['HH','Hamburg'],['HE','Hessen'],
    ['MV','Mecklenburg-Vorpommern'],['NI','Niedersachsen'],['NW','Nordrhein-Westfalen'],
    ['RP','Rheinland-Pfalz'],['SL','Saarland'],['SN','Sachsen'],['ST','Sachsen-Anhalt'],
    ['SH','Schleswig-Holstein'],['TH','Thüringen']];
  const blOpts=BL.map(([v,l])=>`<option value="${v}"${(u.bundesland||'')=== v?' selected':''}>${l}</option>`).join('');
  return `
    <div class="uf-section-head">👤 Zugangsdaten</div>
    <div class="uf-grid2">
      <div class="form-group"><label>Name *</label><input id="uf-name" type="text" value="${esc(u.name||'')}"></div>
      <div class="form-group"><label>Login-ID *</label><input id="uf-id" type="text" value="${esc(u.id||'')}" ${u.id?'disabled':''}></div>
    </div>
    <div class="uf-grid2">
      <div class="form-group"><label>E-Mail</label><input id="uf-email" type="email" value="${esc(u.email||'')}" placeholder="vorname@beispiel.de"></div>
      <div class="form-group"><label>Passwort${u.id?' <span style="font-size:11px;color:var(--muted)">(leer = nicht ändern)</span>':' *'}</label><input id="uf-pw" type="password" placeholder="${u.id?'Leer lassen = unverändert':'Passwort eingeben'}" autocomplete="new-password"></div>
    </div>
    <div class="uf-section-head">🏢 Rolle &amp; Zugehörigkeit</div>
    <div class="form-group"><label>Systemrolle <span style="font-size:11px;color:var(--muted)">(bestimmt Zugriffsrechte)</span></label>
      ${u.id==='admin'
        ? `<input type="hidden" id="uf-role" value="admin"><div style="padding:8px 12px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:6px;font-size:13px;color:#991b1b;font-weight:600">🔒 Administrator – Rolle kann nicht geändert werden</div>`
        : `<select id="uf-role" onchange="toggleFreelancerFields()">
              <option value="mitarbeiter"${(u.role||'mitarbeiter')==='mitarbeiter'?' selected':''}>Mitarbeiter/in (festangestellt)</option>
              <option value="freiberuflich"${u.role==='freiberuflich'?' selected':''}>★ Freiberuflich</option>
              <option value="berater"${u.role==='berater'?' selected':''}>🧭 Berater/in (AZ→GF)</option>
              <option value="leitung"${u.role==='leitung'?' selected':''}>Leitung</option>
              <option value="geschaeftsfuehrer"${u.role==='geschaeftsfuehrer'?' selected':''}>Geschäftsführung</option>
           </select>`}
    </div>
    ${u.id==='admin'?'':`<div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="uf-crmonly" ${u.crmOnly?'checked':''} style="width:auto;cursor:pointer"
          onchange="var f=document.getElementById('uf-employed-fields'); if(f) f.style.display=this.checked?'none':'';">
        🚫 Nur CRM-Zugang – keine Zeiterfassung
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">Für externe/zusätzliche Personen, die nur das CRM nutzen. Der Zeiterfassungs-Bereich wird für sie ausgeblendet; den CRM-Zugriff stellst du unten in der Tabelle ein.</div>
    </div>`}
    ${u.id==='admin'?'':`<div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="uf-gfcountersign" ${u.gfCountersign?'checked':''} style="width:auto;cursor:pointer">
        ✍ Zeiterfassung vom GF gegenzeichnen lassen <span style="font-weight:400;color:var(--muted)">(nur für Leitung)</span>
      </label>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">Wenn aktiv, sieht die Geschäftsführung die <b>eingereichten</b> Monate dieser Leitung in der Mitarbeiterübersicht und zeichnet sie gegen. Ohne Haken bleibt die Leitung für den GF privat.</div>
    </div>`}
    <div class="form-group"><label>Funktionsbezeichnungen <span style="font-size:11px;color:var(--muted)">(Anzeige-Labels, mehrere möglich)</span></label>
      ${(()=>{
          const crs=getCustomRoles();
          const userCRs=Array.isArray(u.customRoles)?u.customRoles:(u.customRole?[u.customRole]:[]);
          if(!crs.length) return '<span style="font-size:12px;color:var(--muted)">Noch keine eigenen Rollen angelegt (Einstellungen → Rollen)</span>';
          return '<div style="padding:6px;border:1.5px solid var(--border);border-radius:6px;max-height:110px;overflow-y:auto">'
            +crs.map((cr,i)=>`<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:13px"><input type="checkbox" id="uf-cr-${i}" value="${esc(cr.id)}"${userCRs.includes(cr.id)?' checked':''} onchange="toggleWerkstudentFields()"> ${esc(cr.label)}</label>`).join('')
            +'</div>';
        })()}
    </div>
    <div class="uf-section-head">📍 Standort</div>
    <div class="uf-grid2">
    <div class="form-group"><label>Team(s) <span style="font-size:11px;color:var(--muted)">(aktuell)</span></label>
      <div id="uf-team-multi" style="padding:6px;border:1.5px solid var(--border);border-radius:6px;max-height:130px;overflow-y:auto">${teamChecks}</div>
    </div>
    ${u.id?(()=>{
      const hist=(u.teamHistory||[]).sort((a,b)=>a.fromDate.localeCompare(b.fromDate));
      const histRows=hist.map((h,i)=>`
        <div style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
          <input type="date" value="${h.fromDate}" style="padding:3px 6px;border:1.5px solid var(--border);border-radius:5px;font-size:12px;width:130px"
            onchange="updateTeamHistEntry('${u.id}',${i},this.value,'team')">
          <select style="flex:1;padding:3px 6px;border:1.5px solid var(--border);border-radius:5px;font-size:12px"
            onchange="updateTeamHistEntry('${u.id}',${i},this.value,'date')">
            <option value="">– kein Team –</option>
            ${getTeams().map(t=>`<option value="${esc(t)}"${h.team===t?' selected':''}>${esc(t)}</option>`).join('')}
          </select>
          <button class="btn btn-danger btn-sm" style="padding:2px 8px;font-size:11px"
            onclick="deleteTeamHistEntry('${u.id}',${i})">×</button>
        </div>`).join('');
      return `<div class="form-group"><label>📅 Team-Verlauf <span style="font-size:11px;color:var(--muted)">(editierbar)</span></label>
        <div style="border:1.5px solid var(--border);border-radius:6px;padding:6px;margin-bottom:8px;max-height:160px;overflow-y:auto">
          ${histRows||'<span style="font-size:12px;color:var(--muted)">Noch kein Verlauf.</span>'}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--muted)">Eintrag hinzufügen:</span>
          <input type="date" id="uf-team-change-date" value="${new Date().toISOString().slice(0,10)}" style="padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px">
          <button class="btn btn-ok btn-sm" onclick="addTeamHistEntry('${u.id}')">+ Eintrag</button>
        </div>
      </div>`;
    })():''}
    </div>
    <div class="uf-grid2">
      <div class="form-group"><label>Wohnort</label><input id="uf-city" type="text" value="${esc(u.city||'')}"></div>
      <div class="form-group"><label>Bundesland <span style="font-size:11px;color:var(--muted)">(für Feiertage)</span></label><select id="uf-bl">${blOpts}</select></div>
    </div>
    <div id="uf-employed-fields"${u.crmOnly?' style="display:none"':''}>
      <div class="uf-section-head">⏱ Arbeitszeit &amp; Urlaub</div>
      <div class="form-group" style="background:rgba(0,0,0,.03);padding:8px 10px;border-radius:6px">
        <label style="font-size:12px">Änderungen an Stunden / Urlaub / Rolle gültig ab</label>
        <input type="date" id="uf-param-change-date" value="${new Date().toISOString().slice(0,8)}01" style="max-width:160px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px">
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Greift nur, wenn du unten einen Wert änderst. Vergangene Monate rechnen dann weiter mit den bisherigen Werten (SOLL & Überträge bleiben korrekt).</div>
        ${(()=>{ const ph=Array.isArray(u.paramHistory)?u.paramHistory:[]; if(!ph.length) return ''; const rows=ph.slice().sort((a,b)=>a.fromDate<b.fromDate?1:-1).map(h=>`<div style="font-size:11px;color:var(--muted);padding:2px 0">ab ${esc(h.fromDate)}: ${h.wh??'?'} h/Wo · ${h.dpw??'?'} Tage/Wo · ${h.al??'?'} Urlaubstage${h.role?' · '+esc(h.role):''}</div>`).join(''); return `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--muted)">📁 Parameter-Verlauf (${ph.length})</summary>${rows}</details>`; })()}
      </div>
      <div class="uf-grid2">
        <div class="form-group"><label>Wochenarbeitszeit (h)</label><input id="uf-wh" type="number" min="1" max="60" value="${u.wh||20}"></div>
        <div class="form-group"><label>Arbeitstage / Woche</label><input id="uf-dpw" type="number" min="1" max="7" value="${u.dpw||5}"></div>
      </div>
      <div class="uf-grid2">
        <div class="form-group"><label>Jahresurlaub (Tage)</label><input id="uf-al" type="number" min="0" max="60" step="0.5" value="${u.al||24}"></div>
        <div class="form-group"><label>Stunden / Urlaubstag <span style="font-size:11px;color:var(--muted)">(Teilzeit i.d.R. 8)</span></label>
          <input id="uf-vhpd" type="number" min="1" max="24" step="0.5" value="${u.vacHoursPerDay||Math.round(vacDailyMin(u)/60*10)/10}">
        </div>
      </div>
      <div class="uf-grid2">
        <div class="form-group"><label>Minusstunden Vorjahr (h)</label><input id="uf-neg" type="number" min="-99" max="0" value="${u.prevNeg||0}"></div>
        <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:4px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="uf-hol" ${u.holidaysLikeSunday!==false?' checked':''} style="width:auto;cursor:pointer">
            Feiertage = kein SOLL / kein Urlaubsabzug
          </label>
        </div>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="uf-sollwd"${u.sollWorkdays?' checked':''} style="width:auto;cursor:pointer">
          SOLL arbeitstaggenau berechnen <span style="font-size:11px;color:var(--muted)">(statt pauschal 4× Wochenstunden)</span>
        </label>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">Für Teilzeit, wenn das Monatsziel den echten Arbeitstagen des Monats folgen soll. Vollzeit rechnet ohnehin immer arbeitstaggenau.</div>
      </div>
      <div id="uf-werkstudent-fields" data-haslecture="${((Array.isArray(u.lecturePeriods)&&u.lecturePeriods.length)||(Array.isArray(u.lectureFreeDays)&&u.lectureFreeDays.length))?'1':''}" style="display:none">
        <div class="uf-section-head">🎓 Werkstudent – Vorlesungszeiten</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">In der Vorlesungszeit gilt die 20h-/Woche-Grenze: Wochen, in denen Mo–Fr zwischen 8 und 20 Uhr mehr als 20h gearbeitet werden, werden in der Zeiterfassung rot markiert (Zeiten vor 8 / nach 20 Uhr und am Wochenende zählen nicht mit). Pro Semester einen Zeitraum eintragen.</div>
        ${wsPeriodRows(u.lecturePeriods,'uf-lp',4,'Semester')}
        <div class="uf-section-head" style="margin-top:14px">🌉 Brückentage / vorlesungsfreie Tage</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Tage oder Zeiträume INNERHALB der Vorlesungszeit, an denen die 20h-/Woche-Grenze NICHT gilt (z.B. Brückentage, vorlesungsfreie Tage – dann darf wie in den Semesterferien mehr gearbeitet werden). Einzelner Tag: bei „von" und „bis" dasselbe Datum eintragen.</div>
        ${wsPeriodRows(u.lectureFreeDays,'uf-lf',6,'Zeitraum')}
      </div>
    </div>
    <div id="uf-freelancer-fields" style="display:none">
      <div class="form-group"><label>Monatliches Stundenlimit (h) <span style="font-size:11px;color:var(--muted)">(0 = kein Limit)</span></label><input id="uf-maxhours" type="number" min="0" max="999" step="0.5" value="${u.maxHours||0}"></div>
    </div>
    <div class="uf-section-head">🔐 Berechtigungen <span style="font-size:11px;color:var(--muted)">(pro Person)</span></div>
    ${u.id==='admin'
      ? `<div style="padding:8px 12px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:6px;font-size:13px;color:#991b1b;font-weight:600">🔒 Administrator – hat immer alle Rechte</div>`
      : `<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Häkchen = erlaubt. Überschreibt die Standardrechte der Rolle.</div>
         <div id="uf-perms" style="padding:6px;border:1.5px solid var(--border);border-radius:6px">
           ${PERM_DEFS.map(p=>{
             const on=(u.perms&&Object.prototype.hasOwnProperty.call(u.perms,p.key))?!!u.perms[p.key]:(DEFAULT_PERMISSIONS[p.key]?.includes(u.role||'mitarbeiter')??false);
             return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px"><input type="checkbox" id="uf-perm-${p.key}" ${on?'checked':''} style="width:auto;cursor:pointer"> ${esc(p.label)}</label>`;
           }).join('')}
         </div>`}
    <script>toggleFreelancerFields();toggleWerkstudentFields()<\/script>`;
}

// Vorlesungszeit-Felder nur zeigen, wenn eine als „Werkstudent" benannte
// Funktionsbezeichnung angehakt ist (und kein Freiberufler/Admin).
export function toggleWerkstudentFields(){
  const wrap=document.getElementById('uf-werkstudent-fields');
  if(!wrap) return;
  const crs=getCustomRoles();
  let isWst=false;
  crs.forEach((cr,i)=>{
    const cb=document.getElementById('uf-cr-'+i);
    if(cb&&cb.checked&&(cr.label||'').toLowerCase().includes('werkstudent')) isWst=true;
  });
  const role=_resolveUfRole();
  // Auch zeigen, wenn der Nutzer bereits Vorlesungszeiten/Brückentage hat (damit Bestands-
  // Werkstudenten immer bearbeitbar sind, selbst wenn die Funktionsbezeichnung nicht (mehr) passt).
  const forced=wrap.dataset.haslecture==='1';
  wrap.style.display=((isWst||forced)&&role!=='freiberuflich'&&role!=='admin')?'':'none';
}

export function _resolveUfRole(){
  return document.getElementById('uf-role')?.value||'mitarbeiter';
}

export function toggleFreelancerFields(){
  const fields=document.getElementById('uf-employed-fields');
  if(!fields) return;
  const role=_resolveUfRole();
  fields.style.display=(role==='freiberuflich'||role==='admin')?'none':'';
  const ff=document.getElementById('uf-freelancer-fields');
  if(ff) ff.style.display=role==='freiberuflich'?'':'none';
  // Alle Rollen zeigen Multi-Team-Auswahl (uf-team-single wurde entfernt)
  toggleWerkstudentFields();
}

function collectUserForm(){
  const role=document.getElementById('uf-role')?.value||'mitarbeiter';
  // Mehrere Funktionsbezeichnungen (custom roles, nur Anzeige)
  const crs=getCustomRoles();
  const customRoles=crs.filter((_,i)=>{ const cb=document.getElementById(`uf-cr-${i}`); return cb&&cb.checked; }).map(cr=>cr.id);
  const customRole=customRoles[0]||''; // Rückwärtskompatibilität
  const isFree=role==='freiberuflich';
  const at=getTeams();
  // Alle Rollen können mehrere Teams haben
  const teams=at.filter((_,i)=>{ const cb=document.getElementById(`uf-team-cb-${i}`); return cb&&cb.checked; });
  const wh=isFree?0:parseFloat(document.getElementById('uf-wh')?.value)||20;
  const dpw=isFree?5:parseInt(document.getElementById('uf-dpw')?.value)||5;
  // Werkstudent: Vorlesungszeiten (Semester-Zeiträume) einsammeln
  // Aktive Slots + im Verlauf mitgeführte (abgelaufene) Zeiträume zusammenführen.
  const lecturePeriods=wsCollectPeriods('uf-lp',4);
  const lectureFreeDays=wsCollectPeriods('uf-lf',6);
  // Pro-User-Berechtigungen (überschreiben die Rolle). Admin: keine Häkchen → leer.
  const perms={};
  PERM_DEFS.forEach(p=>{ const cb=document.getElementById('uf-perm-'+p.key); if(cb) perms[p.key]=!!cb.checked; });
  const crmOnly=!!(document.getElementById('uf-crmonly')?.checked);
  const gfCountersign=!!(document.getElementById('uf-gfcountersign')?.checked);
  return {
    perms,
    crmOnly,
    gfCountersign,
    name:document.getElementById('uf-name').value.trim(),
    id:document.getElementById('uf-id').value.trim().toLowerCase().replace(/\s+/g,'_'),
    email:document.getElementById('uf-email')?.value.trim()||'',
    pw:document.getElementById('uf-pw').value,
    role,
    customRole,  // erstes für Rückwärtskompatibilität
    customRoles, // alle ausgewählten Bezeichnungen
    team:teams[0]||'',   // primäres Team (Rückwärtskompatibilität)
    teams,
    city:document.getElementById('uf-city').value.trim(),
    bundesland:document.getElementById('uf-bl').value,
    wh,
    dpw,
    al:isFree?0:parseFloat(document.getElementById('uf-al').value)||24,
    vacHoursPerDay:isFree?0:(parseFloat(document.getElementById('uf-vhpd')?.value)||Math.round(vacDailyMin({wh,dpw,role})/60*10)/10),
    holidaysLikeSunday:!!(document.getElementById('uf-hol')?.checked),
    sollWorkdays:!!(document.getElementById('uf-sollwd')?.checked),
    prevNeg:isFree?0:parseFloat(document.getElementById('uf-neg').value)||0,
    maxHours:isFree?parseFloat(document.getElementById('uf-maxhours').value)||0:0,
    lecturePeriods,
    lectureFreeDays
  };
}

export async function saveNewUser(){
  const u=collectUserForm();
  if(!u.name||!u.id||!u.pw){ toast('Bitte alle Pflichtfelder ausfüllen.','err'); return; }
  if(u.id==='admin'||u.role==='admin'){ toast('Es kann nur einen Admin-Account geben.','err'); return; }
  if(getUser(u.id)){ toast('Login-ID bereits vergeben.','err'); return; }
  const _plainPw=u.pw;  // Klartext vor dem Hashen für das Firebase-Konto
  u.pw=await makePwRecord(u.pw);
  await mutate(d=>d.users.push(u));
  try{ window.provisionAuthAccount?.(u.id, _plainPw, u.email); }catch(e){}  // echtes Konto anlegen (best effort)
  closeModal(); renderSettings(); window.rebuildEmpSelect?.(); toast('Mitarbeiter hinzugefügt. ✓','ok');
}

export async function saveEditUser(id){
  const cu=window.cu;
  const u=collectUserForm(); u.id=id;
  if(id==='admin') u.role='admin';
  if(u.pw){ u.pw=await makePwRecord(u.pw); }
  else { const ex=getUser(id); if(ex) u.pw=ex.pw; }
  // Team-Verlauf: wenn primäres Team gewechselt hat → History-Eintrag hinzufügen
  const existing=getUser(id);
  const newTeam=u.teams[0]||u.team||'';
  const oldTeam=existing?.teams?.[0]||existing?.team||'';
  if(newTeam&&newTeam!==oldTeam){
    const changeDate=document.getElementById('uf-team-change-date')?.value||new Date().toISOString().slice(0,10);
    const existHist=Array.isArray(existing?.teamHistory)?existing.teamHistory:[];
    u.teamHistory=[...existHist.filter(h=>h.fromDate!==changeDate),{team:newTeam,fromDate:changeDate}]
      .sort((a,b)=>a.fromDate.localeCompare(b.fromDate));
  } else {
    u.teamHistory=existing?.teamHistory||u.teamHistory;
  }
  // Parameter-Historie: bei Änderung von Stunden/Urlaub/Rolle etc. die ALTEN Werte mit
  // Gültig-ab bewahren, damit vergangene Monate weiter mit den damaligen Werten rechnen.
  const _pk=['wh','dpw','al','vacHoursPerDay','role','sollWorkdays','holidaysLikeSunday','bundesland','maxHours'];
  const _pnorm=(k,v)=>k==='holidaysLikeSunday'?(v!==false?'1':'0'):(k==='sollWorkdays'?(v?'1':'0'):String(v??''));
  const _pchg=existing&&_pk.some(k=>_pnorm(k,existing[k])!==_pnorm(k,u[k]));
  if(existing&&_pchg){
    const cd=document.getElementById('uf-param-change-date')?.value||(new Date().toISOString().slice(0,8)+'01');
    let ph=Array.isArray(existing.paramHistory)?existing.paramHistory.slice():[];
    if(!ph.length){ const base={fromDate:'2000-01-01'}; _pk.forEach(k=>base[k]=existing[k]); ph.push(base); } // Alt-Werte gelten "seit jeher"
    const rec={fromDate:cd}; _pk.forEach(k=>rec[k]=u[k]);
    ph=ph.filter(h=>h.fromDate!==cd); ph.push(rec);
    ph.sort((a,b)=>a.fromDate<b.fromDate?-1:1);
    u.paramHistory=ph;
  } else {
    u.paramHistory=existing?.paramHistory||u.paramHistory;
  }
  await mutate(d=>{ const i=d.users.findIndex(x=>x.id===id); if(i>=0){ Object.assign(d.users[i],u); } });
  closeModal(); renderSettings(); window.rebuildEmpSelect?.(); toast('Mitarbeiter gespeichert. ✓','ok');
  if(cu.id===id){ window.cu=getUser(id); document.getElementById('hdr-name').textContent=window.cu.name; }
}

// ── Team-History Admin-Funktionen ─────────────────────────────────
export function addTeamHistEntry(uid){
  const dateEl=document.getElementById('uf-team-change-date');
  const date=dateEl?.value||new Date().toISOString().slice(0,10);
  mutate(d=>{
    const u=d.users.find(x=>x.id===uid); if(!u) return;
    if(!Array.isArray(u.teamHistory)) u.teamHistory=[];
    // Aktuelles primäres Team als Standardwert
    const curTeam=u.teams?.[0]||u.team||'';
    u.teamHistory.push({team:curTeam,fromDate:date});
    u.teamHistory.sort((a,b)=>a.fromDate.localeCompare(b.fromDate));
  });
  showEditUser(uid); // Modal neu öffnen mit aktuellen Daten
  toast('Eintrag hinzugefügt','ok');
}

export function updateTeamHistEntry(uid,idx,val,changed){
  // changed = 'team' oder 'date' – aber wir speichern den ganzen Eintrag neu
  // Da wir nur onchange auf einem Feld haben, lesen wir alle Inputs neu
  mutate(d=>{
    const u=d.users.find(x=>x.id===uid); if(!u||!Array.isArray(u.teamHistory)) return;
    if(idx>=u.teamHistory.length) return;
    // Wert direkt setzen (Datum oder Team je nach changed)
    if(changed==='team') u.teamHistory[idx].fromDate=val;
    else u.teamHistory[idx].team=val;
    u.teamHistory.sort((a,b)=>a.fromDate.localeCompare(b.fromDate));
  });
  toast('Gespeichert','ok');
}

export function deleteTeamHistEntry(uid,idx){
  if(!confirm('Eintrag löschen?')) return;
  mutate(d=>{
    const u=d.users.find(x=>x.id===uid); if(!u||!Array.isArray(u.teamHistory)) return;
    u.teamHistory.splice(idx,1);
  });
  showEditUser(uid);
  toast('Eintrag gelöscht','ok');
}
// ───────────────────────────────────────────────────────────────────

export function toggleGFTimesheet(uid){
  const cu=window.cu;
  if(cu.role!=='admin'){ toast('Kein Zugriff – nur Admin.','err'); return; }
  mutate(d=>{
    const u=d.users.find(x=>x.id===uid);
    if(u&&u.role==='geschaeftsfuehrer') u.noTimesheet=!u.noTimesheet;
  });
  renderSettings();
  toast('ZE-Status aktualisiert ✓','ok');
}

export function toggleLeitungReport(uid){
  const cu=window.cu;
  if(cu.role!=='admin'){ toast('Kein Zugriff – nur Admin.','err'); return; }
  mutate(d=>{
    const u=d.users.find(x=>x.id===uid);
    if(u&&u.role==='leitung') u.noReport=!u.noReport;
  });
  renderSettings();
  toast(getData().users.find(u=>u.id===uid)?.noReport
    ?'ZE auf privat gesetzt – GF hat keinen Zugriff ✓'
    :'GF-Zugriff aktiviert ✓','ok');
}

export function deleteUser(id){
  const cu=window.cu;
  if(cu.role!=='admin'){ toast('Kein Zugriff – nur Admin.','err'); return; }
  if(id==='admin'){ toast('Der Admin-Account kann nicht gelöscht werden.','err'); return; }
  if(!confirm('Mitarbeiter und alle Zeitdaten wirklich löschen?')) return;
  mutate(d=>{
    d.users=d.users.filter(u=>u.id!==id);
    Object.keys(d.entries).forEach(k=>{ if(k.startsWith(id+'_')) delete d.entries[k]; });
  });
  renderSettings(); toast('Mitarbeiter gelöscht.','err');
  if(window.viewEmpId===id){
    const rem=getData().users.filter(u=>!isManagerRole(u)).filter(u=>canSeeEmployee(cu,u));
    window.viewEmpId=rem.length?rem[0].id:null;
    window.rebuildEmpSelect?.(); window.renderZeiterfassung?.();
  }
}
