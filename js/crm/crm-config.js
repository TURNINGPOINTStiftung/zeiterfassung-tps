// ══════════════════════════════════════════════════════════════════
//  CRM-Konfiguration  –  hier wird die Struktur "wie gezeichnet" gepflegt
// ══════════════════════════════════════════════════════════════════
//  Alle drei Bäume teilen dieselbe Engine. Was sich unterscheidet, steht
//  hier (und nur hier) – Felder lassen sich ohne Code-Umbau anpassen.

// Die drei Bäume (oberste Ebene)
export const TREES = [
  { key:'vereine',       label:'Vereine',       icon:'🏛️', single:'Verein' },
  { key:'sozialakteure', label:'Sozialakteure', icon:'🤝', single:'Sozialakteur' },
  { key:'fundraising',   label:'Fundraising',   icon:'💶', single:'Fundraising-Kontakt' },
  { key:'marketing',     label:'Marketing & Öffentlichkeitsarbeit', icon:'📣', single:'Marketing-Eintrag' },
];

export function treeByKey(k){ return TREES.find(t=>t.key===k) || TREES[0]; }

// Stammdaten-Felder. Für alle Bäume gleich – bei Bedarf später pro Baum
// über STAMM_FIELDS_BY_TREE überschreibbar.
export const STAMM_FIELDS = [
  { key:'name',    label:'Name',            type:'text',     required:true },
  { key:'adresse', label:'Adresse',         type:'textarea' },
  { key:'sitz',    label:'Sitz / Standort', type:'text' },
  { key:'web',     label:'Website',         type:'text' },
  { key:'email',   label:'E-Mail',          type:'text' },
  { key:'tel',     label:'Telefon',         type:'text' },
  { key:'tags',    label:'Schlagworte',     type:'text',     hint:'kommagetrennt' },
  { key:'statStart', label:'Statistik ab',  type:'date',     hint:'ab wann zählt die Statistik' },
];

// Optionale baum-spezifische Überschreibung der Stammdaten.
// Beispiel: Fundraising braucht evtl. andere Felder. Leer = STAMM_FIELDS.
export const STAMM_FIELDS_BY_TREE = {
  // fundraising: [ ...eigene Felder... ],
};

export function stammFields(tree){
  return STAMM_FIELDS_BY_TREE[tree] || STAMM_FIELDS;
}

// Funktionen, die ein Kontakt / Mitglied im Verein haben kann
export const MEMBER_FUNCTIONS = [
  'Vorstand','1. Vorsitz','2. Vorsitz','Kassenwart','Schriftführer',
  'Trainer/in','Ansprechpartner/in','Mitglied','Sonstiges'
];

// ── Aufgaben (ToDos) ───────────────────────────────────────────────
// Status einer Aufgabe (Reihenfolge = Anzeige). Farbe für Badges.
export const TASK_STATUS = [
  { key:'offen',    label:'Offen',     color:'#7f8c8d' },
  { key:'inarbeit', label:'In Arbeit', color:'#2d6099' },
  { key:'erledigt', label:'Erledigt',  color:'#48ae4d' },
];
export function taskStatusByKey(k){ return TASK_STATUS.find(s=>s.key===k) || TASK_STATUS[0]; }

// Fallback-Teams, falls die Zeiterfassungs-Teams (read-only) nicht lesbar sind.
export const FALLBACK_TEAMS = ['Akademie','Marketing & Öffentlichkeitsarbeit','Verwaltung','Vereinsentwicklung'];

// ── KI-Zusammenfassung (Diktat) ────────────────────────────────────
// Endpoint eines kleinen Proxys (z. B. Cloudflare Worker), der den Text
// an ein LLM weitergibt. Leer = Diktat funktioniert (Text), nur die
// automatische Zusammenfassung ist deaktiviert. Wird zur Laufzeit aus
// localStorage gelesen, damit der Admin ihn ohne Deploy setzen kann.
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
