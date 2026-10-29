// 🎚️ Feine Rechte je Bereich (seit v510, Wunsch Moritz 29.10.2026)
// Ersetzt die groben Stufen Kein/Nutzen/Verwaltend für CRM, Kalender, Projektmanagement, Verteiler,
// Messemodus und Lager durch Einzelrechte + Vorlagen (Team, Leitung, Verwaltung, Nur lesen, Verein).
//
// Gespeichert am Nutzer: u.rechte = { tpl:'team', x:{ <recht>: true|false|'<option>' }, kats:[…] }
//   tpl = gewählte Vorlage, x = Abweichungen davon (nur was anders ist), kats = Kategorien für „nur bestimmte".
// Ohne u.rechte werden die Rechte aus den bisherigen Einstellungen abgeleitet (Pfade, Verwaltend, CRM-Stufe)
// → für niemanden ändert sich etwas, bis im Mitarbeiter-Dialog eine Vorlage/Häkchen gespeichert wird.
//
// Andere Module nutzen das NUR über window.tpsRecht(key[,u]) / window.TPS_RECHTE (keine benannten Importe,
// siehe CLAUDE.md – alter Gerätecache).

export const RECHTE = [
  { area:'crm', icon:'📇', label:'CRM-Kontakte', items:[
    { k:'crm_ansehen',       nr:'1.1',  label:'Kontakte ansehen', opts:[['alle','alle'],['kat','nur bestimmte Kategorien'],['verein','nur eigener Verein']] },
    { k:'crm_anlegen',       nr:'1.2',  label:'Kontakte neu anlegen' },
    { k:'crm_stamm',         nr:'1.3',  label:'Stammdaten bearbeiten (Name, Adresse, Kategorien, Status, Zusatzfelder)' },
    { k:'crm_personen',      nr:'1.4',  label:'Personen beim Kontakt anlegen/bearbeiten' },
    { k:'crm_notizen',       nr:'1.5',  label:'Kontaktnotizen schreiben' },
    { k:'crm_notizen_fremd', nr:'1.6',  label:'Fremde Kontaktnotizen bearbeiten (eigene immer)' },
    { k:'crm_aufgaben',      nr:'1.7',  label:'Aufgaben anlegen und anderen zuweisen' },
    { k:'crm_termine',       nr:'1.8',  label:'Termine am Kontakt anlegen/bearbeiten' },
    { k:'crm_statistik',     nr:'1.9',  label:'Statistik erfassen' },
    { k:'crm_foerder',       nr:'1.10', label:'Förderungen erfassen' },
    { k:'crm_koop',          nr:'1.11', label:'Kooperationen pflegen' },
    { k:'crm_dateien',       nr:'1.12', label:'Dateien/Anhänge hochladen' },
    { k:'crm_loeschen',      nr:'1.13', label:'Kontakte löschen' },
    { k:'crm_notiz_purge',   nr:'1.14', label:'Notizen endgültig löschen' },
    { k:'crm_export',        nr:'1.15', label:'Excel-Export' },
    { k:'crm_import',        nr:'1.16', label:'Excel-Import' },
    { k:'crm_einst',         nr:'1.17', label:'Einstellungen (Kategorien, Felder, Funktionen, Kachel-Infos)' },
  ]},
  { area:'kalender', icon:'📅', label:'Kalender', items:[
    { k:'kal_ansehen',     nr:'2.1', label:'Kalender ansehen', opts:[['alle','alle'],['team','eigenes Team'],['eigene','nur eigene']] },
    { k:'kal_abw',         nr:'2.2', label:'Abwesenheiten anderer sehen' },
    { k:'kal_eigene',      nr:'2.3', label:'Eigene Termine anlegen' },
    { k:'kal_zuweisen',    nr:'2.4', label:'Andere Personen einem Termin zuweisen' },
    { k:'kal_fremde',      nr:'2.5', label:'Fremde Termine bearbeiten' },
    { k:'kal_loeschen',    nr:'2.6', label:'Termine löschen', opts:[['eigene','eigene'],['alle','alle']] },
    { k:'kal_va',          nr:'2.7', label:'Veranstaltungen anlegen/bearbeiten' },
    { k:'kal_va_loeschen', nr:'2.8', label:'Veranstaltungen löschen' },
    { k:'kal_abo',         nr:'2.9', label:'Kalender-Abo (Outlook)' },
  ]},
  { area:'kanban', icon:'🗂️', label:'Projektmanagement', items:[
    { k:'pm_ansehen',       nr:'3.1', label:'Boards sehen', opts:[['teams','eigene Teams'],['alle','alle']] },
    { k:'pm_aufg_bearb',    nr:'3.2', label:'Aufgaben bearbeiten und verschieben' },
    { k:'pm_aufg_neu',      nr:'3.3', label:'Aufgaben anlegen' },
    { k:'pm_proj_eigen',    nr:'3.4', label:'Eigene Projekte anlegen' },
    { k:'pm_proj_team',     nr:'3.5', label:'Team-Projekte anlegen' },
    { k:'pm_proj_loeschen', nr:'3.6', label:'Projekte löschen' },
    { k:'pm_vorlagen',      nr:'3.7', label:'Vorlagen verwalten' },
  ]},
  { area:'verteiler', icon:'✉️', label:'Verteiler', items:[
    { k:'vt_nutzen',   nr:'4.1', label:'Verteiler verwenden (Mail öffnen, Adressen kopieren)' },
    { k:'vt_eintragen',nr:'4.2', label:'Personen ein- und austragen' },
    { k:'vt_anlegen',  nr:'4.3', label:'Verteiler anlegen/umbenennen' },
    { k:'vt_import',   nr:'4.4', label:'Massen-Übernahme aus dem CRM' },
    { k:'vt_loeschen', nr:'4.5', label:'Verteiler löschen' },
    { k:'vt_export',   nr:'4.6', label:'Verteiler exportieren' },
  ]},
  { area:'messe', icon:'🎪', label:'Messemodus', items:[
    { k:'me_formular',       nr:'5.1', label:'Formular am Stand betreiben' },
    { k:'me_liste',          nr:'5.2', label:'Erfasste Liste ansehen (mit PIN)' },
    { k:'me_uebertragen',    nr:'5.3', label:'Ins CRM übertragen' },
    { k:'me_eintrag_loeschen',nr:'5.4', label:'Erfasste Einträge löschen' },
    { k:'me_va',             nr:'5.5', label:'Messe-Veranstaltungen anlegen/ändern, PIN festlegen' },
    { k:'me_va_loeschen',    nr:'5.6', label:'Messe-Veranstaltungen löschen' },
  ]},
  { area:'shop', icon:'📦', label:'Lager', items:[
    { k:'la_ansehen',    nr:'6.1', label:'Bestand ansehen' },
    { k:'la_bestellen',  nr:'6.2', label:'Bestellen' },
    { k:'la_ausleihen',  nr:'6.3', label:'Ausleihen und zurückgeben' },
    { k:'la_best_bearb', nr:'6.4', label:'Bestellungen bearbeiten/erledigen' },
    { k:'la_bestand',    nr:'6.5', label:'Bestand pflegen (Mengen)' },
    { k:'la_artikel',    nr:'6.6', label:'Artikel und Orte anlegen' },
    { k:'la_einst',      nr:'6.7', label:'Lager-Einstellungen' },
  ]},
];
export const RECHTE_ITEMS = RECHTE.flatMap(a=>a.items.map(i=>Object.assign({area:a.area}, i)));
const _ITEM = Object.fromEntries(RECHTE_ITEMS.map(i=>[i.k,i]));
// „Ansehen"-Recht je Bereich = Bereich erscheint im Menü
export const AREA_VIEW = { crm:'crm_ansehen', kalender:'kal_ansehen', kanban:'pm_ansehen', verteiler:'vt_nutzen', messe:'me_formular', shop:'la_ansehen' };

const _all = (on)=>Object.fromEntries(RECHTE_ITEMS.map(i=>[i.k, on ? (i.opts ? i.opts[i.k==='kal_loeschen'||i.k==='pm_ansehen'?1:0][0] : true) : false]));
const _pick = (vals)=>Object.assign(_all(false), vals);
const TEAM = {
  crm_ansehen:'alle', crm_anlegen:true, crm_stamm:true, crm_personen:true, crm_notizen:true, crm_notizen_fremd:true,
  crm_aufgaben:true, crm_termine:true, crm_statistik:true, crm_foerder:true, crm_koop:true, crm_dateien:true,
  kal_ansehen:'alle', kal_abw:true, kal_eigene:true, kal_zuweisen:true, kal_fremde:true, kal_loeschen:'eigene', kal_va:true, kal_abo:true,
  pm_ansehen:'teams', pm_aufg_bearb:true, pm_aufg_neu:true, pm_proj_eigen:true,
  vt_nutzen:true, vt_eintragen:true, vt_anlegen:true,
  me_formular:true, me_liste:true, me_uebertragen:true,
  la_ansehen:true, la_bestellen:true, la_ausleihen:true,
};
const LEITUNG = Object.assign({}, TEAM, {
  crm_loeschen:true, crm_notiz_purge:true, crm_export:true,
  kal_loeschen:'alle', kal_va_loeschen:true,
  pm_ansehen:'alle', pm_proj_team:true, pm_proj_loeschen:true,
  vt_import:true, vt_loeschen:true, vt_export:true,
  me_eintrag_loeschen:true, me_va:true, me_va_loeschen:true,
  la_best_bearb:true,
});
export const VORLAGEN = [
  { key:'team',       label:'Team',          hint:'überall ansehen, anlegen und bearbeiten – nichts löschen, keine Einstellungen', vals:_pick(TEAM) },
  { key:'leitung',    label:'Leitung',       hint:'wie Team, zusätzlich löschen, Team-Projekte, Messe-Veranstaltungen', vals:_pick(LEITUNG) },
  { key:'verwaltung', label:'Verwaltung',    hint:'alles', vals:_all(true) },
  { key:'lesen',      label:'Nur lesen',     hint:'überall nur ansehen', vals:_pick({ crm_ansehen:'alle', kal_ansehen:'alle', kal_abw:true, kal_abo:true, pm_ansehen:'teams', vt_nutzen:true, la_ansehen:true }) },
  { key:'verein',     label:'Verein (extern)', hint:'nur den eigenen Verein: Personen, Notizen, Statistik', vals:_pick({ crm_ansehen:'verein', crm_personen:true, crm_notizen:true, crm_statistik:true }) },
  { key:'keine',      label:'Keine',         hint:'keine dieser Bereiche', vals:_all(false) },
];
const _TPL = Object.fromEntries(VORLAGEN.map(v=>[v.key,v]));

// ── Ableitung aus den BISHERIGEN Einstellungen (Personen ohne u.rechte) – Verhalten bleibt gleich ──
function _legacy(u){
  let acc={}; try{ acc=(window.crmModuleAccess&&window.crmModuleAccess(u))||{}; }catch(e){}
  const on=a=>acc[a]&&acc[a]!=='kein', adm=a=>acc[a]==='verwaltend';
  let lvl='none'; try{ const a=window.crmUserAccess&&window.crmUserAccess(u.id); lvl=(a&&a.level)||'none'; }catch(e){}
  const crm=on('crm'), full=crm&&(lvl==='full'||lvl==='admin'), ro=crm&&lvl==='readonly', ver=crm&&lvl==='verein', crmAdm=adm('crm');
  const edit=full||ver;
  // Termine/Veranstaltungen anlegen hing bisher an CRM „Verwaltend" (_canManageEvents), Veranstaltungs-Knöpfe
  // in Listen an „Voll" – beides bleibt so.
  const kalEdit=crmAdm;
  const kb=on('kanban'), kbAdm=adm('kanban');
  const vt=on('verteiler'), me=on('messe'), sh=on('shop'), shAdm=adm('shop');
  let seesAll=false; try{ seesAll=!!(window._crmKanbanSeesAll&&window._crmKanbanSeesAll(u)); }catch(e){}
  return {
    crm_ansehen: crm ? (ver?'verein':'alle') : false,
    crm_anlegen: full, crm_stamm: edit, crm_personen: edit, crm_notizen: edit, crm_notizen_fremd: full,
    crm_aufgaben: edit||ro, crm_termine: kalEdit, crm_statistik: edit, crm_foerder: edit, crm_koop: edit, crm_dateien: edit,
    crm_loeschen: full, crm_notiz_purge: crmAdm, crm_export: crmAdm, crm_import: crmAdm, crm_einst: crmAdm,
    kal_ansehen: on('kalender') ? 'alle' : false, kal_abw: on('kalender'),
    kal_eigene: kalEdit, kal_zuweisen: kalEdit, kal_fremde: kalEdit,
    kal_loeschen: kalEdit ? 'alle' : false, kal_va: kalEdit||full, kal_va_loeschen: kalEdit||full, kal_abo: true,
    pm_ansehen: kb ? (seesAll?'alle':'teams') : false, pm_aufg_bearb: kb, pm_aufg_neu: kb, pm_proj_eigen: true,
    pm_proj_team: kbAdm, pm_proj_loeschen: kbAdm, pm_vorlagen: kb||crm,
    vt_nutzen: vt, vt_eintragen: vt, vt_anlegen: vt&&full, vt_import: vt&&full, vt_loeschen: vt&&full, vt_export: vt,
    me_formular: me, me_liste: me, me_uebertragen: me, me_eintrag_loeschen: me, me_va: me, me_va_loeschen: me,
    la_ansehen: sh, la_bestellen: sh, la_ausleihen: sh, la_best_bearb: shAdm, la_bestand: shAdm, la_artikel: shAdm, la_einst: shAdm,
  };
}

// Effektive Rechte einer Person (Objekt key→Wert). Admin: alles.
export function rechteOf(u){
  if(!u) return _all(false);
  if(u.role==='admin' || u.id==='admin') return _all(true);
  const r=u.rechte;
  if(!r || typeof r!=='object' || !_TPL[r.tpl]) {
    const base = (r && r.tpl==='eigen' && r.x) ? _all(false) : _legacy(u);
    return (r && r.tpl==='eigen' && r.x) ? Object.assign(base, _clean(r.x)) : base;
  }
  return Object.assign({}, _TPL[r.tpl].vals, _clean(r.x));
}
function _clean(x){ const o={}; if(x&&typeof x==='object') Object.keys(x).forEach(k=>{ if(_ITEM[k]) o[k]=x[k]; }); return o; }

// Ein Recht prüfen. Optionen-Rechte: Wert (z. B. 'alle'/'teams') oder false. opt=gewünschter Mindestwert.
export function recht(key, u, opt){
  u = u || window.cu; if(!u) return false;
  const v = rechteOf(u)[key];
  if(opt===undefined) return !!v;
  return v===opt;
}
// Hat die Person eigene (neue) Rechte gespeichert? Sonst gilt die Ableitung aus den alten Stufen.
export function hatNeueRechte(u){ return !!(u && u.rechte && typeof u.rechte==='object' && u.rechte.tpl); }
export function vorlageVon(u){ return hatNeueRechte(u) ? u.rechte.tpl : ''; }
// Abweichungen von einer Vorlage berechnen (nur was anders ist → klein und übersichtlich gespeichert)
export function diffZuVorlage(tpl, vals){
  const base=(_TPL[tpl]||_TPL.keine).vals, x={};
  Object.keys(vals).forEach(k=>{ if(_ITEM[k] && vals[k]!==base[k]) x[k]=vals[k]; });
  return x;
}
// Passende CRM-Stufe (crm/access) zu den Rechten – damit Server-Prüfungen (Löschen, Messe-Standard) stimmig bleiben
export function crmStufeAus(vals){
  if(!vals || !vals.crm_ansehen) return 'none';
  if(vals.crm_ansehen==='verein') return 'verein';
  if(vals.crm_anlegen || vals.crm_loeschen || vals.crm_stamm) return 'full';
  return 'readonly';
}

try{ Object.assign(window, { TPS_RECHTE:RECHTE, TPS_VORLAGEN:VORLAGEN, TPS_AREA_VIEW:AREA_VIEW, tpsRecht:recht, tpsRechteOf:rechteOf,
  tpsHatNeueRechte:hatNeueRechte, tpsVorlageVon:vorlageVon, tpsDiffZuVorlage:diffZuVorlage, tpsCrmStufeAus:crmStufeAus }); }catch(e){}
