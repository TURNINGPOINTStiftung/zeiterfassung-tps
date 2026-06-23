// ══════════════════════════════════════════════════════════════════
//  CRM-Konfiguration  –  Bäume & Felder sind admin-editierbar
// ══════════════════════════════════════════════════════════════════
//  Die Defaults hier sind nur noch der FALLBACK. Die tatsächliche
//  Struktur kommt – sofern gesetzt – aus crm/config (Verwaltung).
//  Wird nichts konfiguriert, gilt unverändert das hier Definierte.
//  → Kein Code-Anfassen mehr nötig, um Bäume/Felder zu ändern.

import { getCrmConfig } from './crm-data.js';

// ── Standard-Bäume (Fallback) ──────────────────────────────────────
export const DEFAULT_TREES = [
  { key:'vereine',       label:'Vereine',       icon:'🏛️', single:'Verein' },
  { key:'sozialakteure', label:'Sozialakteure', icon:'🤝', single:'Sozialakteur' },
  { key:'fundraising',   label:'Fundraising',   icon:'💶', single:'Fundraising-Kontakt' },
  { key:'marketing',     label:'Marketing & Öffentlichkeitsarbeit', icon:'📣', single:'Marketing-Eintrag' },
];

// ── Standard-Stammdatenfelder (Fallback) ───────────────────────────
export const DEFAULT_STAMM_FIELDS = [
  { key:'name',    label:'Name',            type:'text',     required:true },
  { key:'adresse', label:'Adresse',         type:'textarea' },
  { key:'sitz',    label:'Sitz / Standort', type:'text' },
  { key:'web',     label:'Website',         type:'text' },
  { key:'email',   label:'E-Mail',          type:'text' },
  { key:'tel',     label:'Telefon',         type:'text' },
  { key:'tags',    label:'Schlagworte',     type:'text',     hint:'kommagetrennt' },
  { key:'statStart', label:'Statistik ab',  type:'date',     hint:'ab wann zählt die Statistik' },
];

// ── Standard-Kontaktfunktionen (Fallback) ──────────────────────────
export const DEFAULT_MEMBER_FUNCTIONS = [
  'Vorstand','1. Vorsitz','2. Vorsitz','Kassenwart','Schriftführer',
  'Trainer/in','Ansprechpartner/in','Mitglied','Sonstiges'
];

// Verfügbare Feldtypen (für den Felder-Editor in der Verwaltung)
export const FIELD_TYPES = [
  { key:'text',     label:'Text (einzeilig)' },
  { key:'textarea', label:'Text (mehrzeilig)' },
  { key:'date',     label:'Datum' },
];

// ── Live-Zugriffe (lesen crm/config, fallen auf Defaults zurück) ───
function _cfg(){ try{ return getCrmConfig(); }catch(e){ return null; } }

export function getTrees(){
  const c=_cfg();
  if(c && Array.isArray(c.trees) && c.trees.length) return c.trees;
  return DEFAULT_TREES;
}
export function treeByKey(k){ const t=getTrees(); return t.find(x=>x.key===k) || t[0]; }

// Stammdaten-Felder eines Baums: baum-spezifisch → Standard-Override → Code-Default
export function stammFields(tree){
  const c=_cfg();
  const sf = c && c.stammFields;
  if(sf && typeof sf==='object'){
    if(Array.isArray(sf[tree]) && sf[tree].length) return sf[tree];
    if(Array.isArray(sf.__default) && sf.__default.length) return sf.__default;
  }
  return DEFAULT_STAMM_FIELDS;
}

export function memberFunctions(){
  const c=_cfg();
  if(c && Array.isArray(c.memberFunctions) && c.memberFunctions.length) return c.memberFunctions;
  return DEFAULT_MEMBER_FUNCTIONS;
}

// ── Aufgaben-Status (bewusst FIX – „erledigt" ist Logik-tragend) ───
export const TASK_STATUS = [
  { key:'offen',    label:'Offen',     color:'#7f8c8d' },
  { key:'inarbeit', label:'In Arbeit', color:'#2d6099' },
  { key:'erledigt', label:'Erledigt',  color:'#48ae4d' },
];
export function getTaskStatus(){ return TASK_STATUS; }
export function taskStatusByKey(k){ return TASK_STATUS.find(s=>s.key===k) || TASK_STATUS[0]; }

// Fallback-Teams, falls die Zeiterfassungs-Teams (read-only) nicht lesbar sind.
export const FALLBACK_TEAMS = ['Akademie','Marketing & Öffentlichkeitsarbeit','Verwaltung','Vereinsentwicklung'];

// ── KI-Zusammenfassung (Diktat) ────────────────────────────────────
export const CRM_AI_ENDPOINT_LS = 'tps_crm_ai_endpoint';
export function getAiEndpoint(){
  try{ return localStorage.getItem(CRM_AI_ENDPOINT_LS) || ''; }catch(e){ return ''; }
}
export function setAiEndpoint(url){
  try{
    if(url) localStorage.setItem(CRM_AI_ENDPOINT_LS, url);
    else    localStorage.removeItem(CRM_AI_ENDPOINT_LS);
  }catch(e){}
}
