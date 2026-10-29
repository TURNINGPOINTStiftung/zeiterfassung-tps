// ══════════════════════════════════════════════════════════════════
//  TPS Zeiterfassung – Cloud Function „tpsPw" (Passwort vergessen, Stufe 1)
//
//  Warum eine Function: Jede Anmeldung braucht ZWEI Passwörter – den App-Hash (users[].pw)
//  und das Passwort des technischen Firebase-Kontos (<id>@tps.intern). Das Firebase-Passwort
//  einer ANDEREN Person kann nur der Server (Admin SDK) setzen. Ohne diese Function kann
//  daher weder „Passwort vergessen" noch „Passwort zurücksetzen" in der Verwaltung wirken.
//
//  POST { action:'request', id }        – ohne Anmeldung (Login-Bildschirm): legt eine Anfrage
//        unter zeiterfassung/pwResetRequests/<id> an. Antwortet IMMER gleich (kein Ausprobieren
//        existierender Namen), max. 1 Anfrage je Person pro 10 Minuten.
//  POST { action:'set', id, newPw }     – NUR mit gültigem ID-Token des Administrator-Accounts
//        (zeiterfassung/admins/<uid> === true): setzt das Firebase-Passwort von <id>@tps.intern
//        und entfernt eine offene Anfrage. Den App-Hash schreibt der Admin-Client selbst.
//
//  POST { action:'mfaPrep' | 'mfaReset' | 'mfaStatus' } – Zwei-Faktor-Anmeldung (siehe unten).
//  POST { action:'claimSelf' | 'claimSync' } – Freigabe-Markierung tps:true für Storage (siehe unten).
//  POST { action:'create', id, newPw } – Anmeldekonto anlegen (nur Admin mit zweitem Faktor; Registrierung ist zu).
//  POST { action:'staffCreate', user, newPw, crm } – Mitarbeiter anlegen durch System-Verwaltung (siehe unten).
//  POST { action:'staffPerms', id, perms, crm, crmOnly, kanbanTeams } – Zugriffe bestehender Personen (siehe unten).
//  POST { action:'staffRole', id, role } – Rolle ändern (nur Admin und „System-Verwaltung erweitert“, siehe unten).
//  POST { action:'backupList' | 'backupGet' | 'restore' | 'adminLog' } – Backups / Protokoll („erweitert“, siehe unten).
//  POST { action:'autoBackup' } – Tages-Backup durch den Server (jede freigeschaltete Person, siehe unten).
//  POST { action:'icsToken', op:'get'|'new'|'delete' } – eigener Kalender-Abo-Link (jede freigeschaltete Person).
//  GET  /kalender/<schlüssel>.ics – Kalender-Abo (Outlook/Google/iPhone): eigene CRM-Termine + Veranstaltungen,
//        denen die Person zugewiesen ist. Ohne Anmeldung – der lange Zufallsschlüssel ist die Berechtigung.
//  GET  /kalender/<schlüssel>-alle.ics – zweiter Kalender: alle übrigen CRM-Termine/Veranstaltungen (ohne die eigenen),
//        nur wenn die Person den Kalender-Bereich nutzen darf (perms.path_kalender bzw. crm/pathAccess.kalender).
//        Schlüssel liegen unter kalenderAbo/ (oberste Ebene, für Geräte durch die Regeln gesperrt; nur dieser Server).
//
//  „System-Verwaltung erweitert“ (seit 14.10., Recht zugriff_verwaltung_plus, vergibt NUR der Administrator, gilt nur
//  zusammen mit „System-Verwaltung“ und nur mit zweitem Faktor): zusätzlich Einmal-Passwörter setzen ('set') und die
//  Rollen Leitung/GF vergeben (staffCreate, staffRole, staffPerms auch für Leitung/GF). Nie für das Administrator-Konto,
//  nie für die eigene Person und nie für andere Personen mit „erweitert“ – die bleiben beim Administrator.
//
//  Deploy (Cloud Shell): siehe functions/README.md
// ══════════════════════════════════════════════════════════════════
const admin = require('firebase-admin');
admin.initializeApp({ databaseURL: 'https://zeiterfassung-tps-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();
const BUCKET = 'zeiterfassung-tps.firebasestorage.app';   // Storage (automatische Backups)

const ALLOWED_ORIGINS = [
  'https://turningpointstiftung.github.io',
  'http://localhost:7891', 'http://localhost:8765',
];
const ID_RE = /^[a-z0-9._-]{1,64}$/;
const crypto = require('crypto');
const accountEmail = id => String(id || '').toLowerCase().replace(/[^a-z0-9._-]/g, '') + '@tps.intern';
// Gleiche Schlüssel-Bildung wie admin-setup.js _dirKey (loginDir ist ASCII-verschlüsselt)
const dirKey = id => String(id || '')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
  .replace(/[^A-Za-z0-9._-]/g, '') || 'u';

// Zwei-Faktor-Pflicht für Admin-Aktionen (seit 13.10.): Das ID-Token trägt nach einer Anmeldung mit
// zweitem Faktor firebase.sign_in_second_factor (z. B. 'totp'). Ohne → Antwort 403 'mfa-required'.
// Gilt für Aktionen des Administrators und der System-Verwaltung (Sperren/Archivieren/Wiederherstellen) –
// nicht für Selbst-Aktionen (Zwei-Faktor einrichten,
// eigene Freigabe-Markierung), sonst könnte man sich aussperren.
const hasMfa = tok => !!(tok && tok.firebase && tok.firebase.sign_in_second_factor);
const mfaRequired = res => res.status(403).json({ ok: false, error: 'mfa-required' });

// Rollen-Standardrechte (wie js/config.js DEFAULT_PERMISSIONS) – nur die serverseitig geprüften (grants).
// Die Rechte-Matrix (zeiterfassung/rolePermissions) hat Vorrang, persönliche Einzelrechte (perms) erst recht.
const ROLE_DEFAULTS = { tab_gfberichte: ['geschaeftsfuehrer'], btn_teamberichte: [], btn_jahresbericht: ['leitung'],
  genehmigung_abwesenheit: ['leitung', 'geschaeftsfuehrer'], zugriff_verwaltung: [] };
const ALL_ROLES = ['mitarbeiter', 'berater', 'freiberuflich', 'leitung', 'geschaeftsfuehrer'];
const BASIC_ROLES = ['mitarbeiter', 'berater', 'freiberuflich'];
// Freigabelisten (grants) einer Person aus Rolle + Einzelrechten – gleiche Logik wie admin-setup.js
// refreshPermissionAllowlists (der Admin-Start rechnet ohnehin alles autoritativ neu).
// „System-Verwaltung“ (+ „erweitert“) gibt es NUR pro Person – die Rollen-Matrix zählt dafür nicht, sonst
// ließe sie sich über eine Rolle weitergeben (Audit 14.10.2026). opts.crmLevel: CRM-Stufe, falls gerade erst gesetzt.
async function grantUpdates(authUid, u, opts) {
  const val = async p => (await db.ref(p).once('value')).val();
  const rp = (await val('zeiterfassung/rolePermissions')) || {};
  const pa = (await val('crm/pathAccess')) || {};
  const acc = (await val('crm/access/' + String(u.id || '').replace(/[.#$\[\]\/]/g, '_'))) || {};
  const p = (u && u.perms) || {};
  const own = k => Object.prototype.hasOwnProperty.call(p, k);
  const has = k => own(k) ? !!p[k] : (Array.isArray(rp[k]) ? rp[k] : (ROLE_DEFAULTS[k] || [])).includes(u.role);
  const sys = p.zugriff_verwaltung === true;
  const upd = {}; const g = (k, on) => { upd['zeiterfassung/grants/' + k + '/' + authUid] = on ? true : null; };
  ['tab_gfberichte', 'btn_teamberichte', 'btn_jahresbericht', 'genehmigung_abwesenheit'].forEach(k => g(k, has(k)));
  g('zugriff_verwaltung', sys);
  g('zugriff_verwaltung_plus', sys && p.zugriff_verwaltung_plus === true);
  ['zugriff_verwaltung_ze', 'zugriff_verwaltung_crm', 'verw_kanban', 'verw_kalender'].forEach(k => g(k, sys || has(k)));
  const shopUse = own('path_shop') ? !!p.path_shop : !!(pa.shop && pa.shop[u.role]);
  g('shop_nutzen', shopUse);
  g('verw_shop', shopUse && (sys || has('verw_shop')));
  const lvl = (opts && opts.crmLevel) || acc.level || 'none';
  const messeUse = own('path_messe') ? !!p.path_messe
    : ((pa.messe && Object.prototype.hasOwnProperty.call(pa.messe, u.role)) ? !!pa.messe[u.role] : (lvl === 'full' || lvl === 'admin'));
  g('messe_nutzen', messeUse);
  return upd;
}
// ── Hilfen für Backups ──
const SHOP_COLLS = ['shopItems', 'shopPlaces', 'shopOrders', 'shopLog', 'shopLoans', 'shopConfig'];
const berlinDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });   // JJJJ-MM-TT
function fullBlob(ze, crm, source, by) {
  const crmPart = {}, shopPart = { _v: 1 };
  Object.keys(crm || {}).forEach(k => { if (SHOP_COLLS.includes(k)) shopPart[k] = crm[k]; else crmPart[k] = crm[k]; });
  return { _type: 'tps-vollbackup', _v: 2, source, exportedAt: new Date().toISOString(), byUser: by || '', zeiterfassung: ze, crm: crmPart, shop: shopPart };
}
// Eingespielte Inhalte bereinigen: Texte ohne < >, nur gültige Datenbank-Schlüssel, begrenzte Tiefe (Audit 14.10.2026)
const cleanStr = s => String(s).replace(/[<>]/g, '');
function cleanDeep(v, depth) {
  depth = depth || 0;
  if (depth > 30) return null;
  if (typeof v === 'string') return cleanStr(v).slice(0, 20000);
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, 5000).map(x => cleanDeep(x, depth + 1));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { if (k && k.length <= 200 && !/[.#$/\[\]]/.test(k)) { const x = cleanDeep(v[k], depth + 1); if (x !== undefined) o[k] = x; } }); return o; }
  return null;
}
// Protokoll aller Verwaltungsaktionen der Function (Audit 14.10.2026): ze_admin_log/<Schlüssel> – im SELBEN
// update wie die Änderung (atomar). Lesen nur über die Aktion 'adminLog' (Admin / „erweitert“).
function logTo(upd, c, action, target, details) {
  const k = db.ref('ze_admin_log').push().key;
  upd['ze_admin_log/' + k] = { ts: Date.now(), by: String((c && c.callerId) || ''), byUid: String((c && c.tok && c.tok.uid) || ''),
    action: String(action), target: String(target || '').slice(0, 80), details: details || null };
}
// Wer ruft auf? → { tok, isAdmin, isStaff (System-Verwaltung), isPlus (… erweitert), callerId } oder null
async function whoCalls(req) {
  const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const tok = await admin.auth().verifyIdToken(m[1]);
  const val = async p => (await db.ref(p).once('value')).val();
  const isAdmin = (await val('zeiterfassung/admins/' + tok.uid)) === true;
  const isStaff = !isAdmin && (await val('zeiterfassung/allowed/' + tok.uid)) === true
    && (await val('zeiterfassung/grants/zugriff_verwaltung/' + tok.uid)) === true;
  const isPlus = isStaff && (await val('zeiterfassung/grants/zugriff_verwaltung_plus/' + tok.uid)) === true;
  const callerId = (await val('zeiterfassung/uidUser/' + tok.uid)) || '';
  return { tok, isAdmin, isStaff, isPlus, callerId };
}
const isPlusUser = u => !!(u && u.perms && u.perms.zugriff_verwaltung_plus === true);

function cors(req, res) {
  const o = req.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(o)) res.set('Access-Control-Allow-Origin', o);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

// ── Kalender-Abo (ICS) ───────────────────────────────────────────────
const ICS_PATH = /^\/kalender\/([A-Za-z0-9_-]{43})(-alle)?\.ics$/;
const icsHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const CRM_NONTREE = new Set(['vorlagen','teamprojekte','access','config','verteiler','veranstaltungen','workflows','pathAccess',
  'shopItems','shopPlaces','shopOrders','shopLog','shopLoans','shopConfig','userPrefs']);
let _crmCache = null, _crmCacheAt = 0;
async function crmSnapshot() {   // höchstens alle 5 Minuten neu lesen (viele Abos fragen zeitgleich)
  if (_crmCache && Date.now() - _crmCacheAt < 5 * 60 * 1000) return _crmCache;
  _crmCache = (await db.ref('crm').once('value')).val() || {}; _crmCacheAt = Date.now(); return _crmCache;
}
const icsEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {   // Zeilen > 75 Byte umbrechen (RFC 5545)
  const out = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch, 'utf8') > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; }
  out.push(cur); return out.join('\r\n ');
}
const ymd = iso => String(iso || '').slice(0, 10).replace(/-/g, '');
function addDay(iso) { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function parseUhr(s) { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})(?:\s*[–-]\s*(\d{1,2})[:.](\d{2}))?/); if (!m) return null;
  return { a: m[1].padStart(2, '0') + m[2] + '00', b: m[3] ? (m[3].padStart(2, '0') + m[4] + '00') : null }; }
function icsEvent(o) {   // o = { uid, titel, von, bis, uhr, ort, notiz }
  const L = ['BEGIN:VEVENT', 'UID:' + o.uid, 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')];
  const t = (o.von === (o.bis || o.von)) ? parseUhr(o.uhr) : null;
  if (t) {
    L.push('DTSTART;TZID=Europe/Berlin:' + ymd(o.von) + 'T' + t.a);
    let end = t.b; if (!end || end <= t.a) { const h = Math.min(23, Number(t.a.slice(0, 2)) + 1); end = String(h).padStart(2, '0') + t.a.slice(2); }
    L.push('DTEND;TZID=Europe/Berlin:' + ymd(o.von) + 'T' + end);
  } else {
    L.push('DTSTART;VALUE=DATE:' + ymd(o.von), 'DTEND;VALUE=DATE:' + ymd(addDay(o.bis || o.von)));
  }
  L.push('SUMMARY:' + icsEsc(o.titel));
  if (o.ort) L.push('LOCATION:' + icsEsc(o.ort));
  L.push('DESCRIPTION:' + icsEsc((o.notiz ? String(o.notiz).slice(0, 800) + '\n\n' : '') + 'Aus der TPS-App – Änderungen bitte dort vornehmen.'));
  L.push('END:VEVENT');
  return L.map(icsFold).join('\r\n');
}
const VTZ_BERLIN = ['BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'].join('\r\n');
// Darf die Person den Kalender-Bereich sehen? Wie canUsePath('kalender') in crm.js: persönlich > Rollen-Matrix > Standard (ja)
function canKalender(u, pa) {
  if (u.role === 'admin') return true;
  if (u.perms && Object.prototype.hasOwnProperty.call(u.perms, 'path_kalender')) return !!u.perms.path_kalender;
  const row = pa && pa.kalender; if (row && Object.prototype.hasOwnProperty.call(row, u.role)) return !!row[u.role];
  return true;
}
async function icsServe(token, res, alle) {
  const nf = () => res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('Kalender-Abo nicht gefunden oder zurückgesetzt.');
  const rec = (await db.ref('kalenderAbo/tokens/' + icsHash(token)).once('value')).val();
  if (!rec || !rec.u) return nf();
  // Person muss noch aktiv sein (archiviert/gesperrt → Abo endet automatisch)
  const usersV = (await db.ref('zeiterfassung/users').once('value')).val() || [];
  const u = (Array.isArray(usersV) ? usersV : Object.values(usersV)).find(x => x && x.id === rec.u);
  if (!u || u.accessRevoked) return nf();
  const crm = await crmSnapshot();
  if (alle && !canKalender(u, crm.pathAccess || {})) return nf();
  const want = ma => alle ? !ma.includes(u.id) : ma.includes(u.id);   // eigener Kalender = zugewiesen; „weitere“ = alle anderen
  const cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const ev = [];
  Object.keys(crm).forEach(tk => { if (CRM_NONTREE.has(tk) || tk.startsWith('shop')) return; const ents = crm[tk]; if (!ents || typeof ents !== 'object') return;
    Object.keys(ents).forEach(eid => { const e = ents[eid]; const ts = e && e.termine; if (!ts) return;
      (Array.isArray(ts) ? ts : Object.values(ts)).forEach(t => { if (!t || !t.datum) return;
        const ma = Array.isArray(t.mitarbeiter) ? t.mitarbeiter : Object.values(t.mitarbeiter || {});
        if (!want(ma) || (t.bis || t.datum) < cutoff) return;
        const name = (e.stamm && e.stamm.name) || '';
        ev.push(icsEvent({ uid: 'termin-' + (t.id || (eid + t.datum)) + '@tps-app', titel: (t.titel || 'Termin') + (name ? ' · ' + name : ''), von: t.datum, bis: t.bis || t.datum, uhr: t.uhr, ort: t.ort, notiz: t.note }));
      }); }); });
  const vas = crm.veranstaltungen || {};
  Object.keys(vas).forEach(id => { const v = vas[id]; if (!v || !v.start) return;
    const ma = Array.isArray(v.mitarbeiter) ? v.mitarbeiter : Object.values(v.mitarbeiter || {});
    if (!want(ma) || (v.ende || v.start) < cutoff) return;
    ev.push(icsEvent({ uid: 'va-' + (v.id || id) + '@tps-app', titel: '📅 ' + (v.titel || 'Veranstaltung'), von: v.start, bis: v.ende || v.start, uhr: v.uhrzeit, ort: v.ortOderLink, notiz: v.beschreibung }));
  });
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TURNING POINT Stiftung//TPS-App//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    icsFold('X-WR-CALNAME:' + (alle ? 'TPS – weitere Termine' : 'TPS – Meine Termine')), 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    VTZ_BERLIN].concat(ev).concat(['END:VCALENDAR']).join('\r\n') + '\r\n';
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="tps-termine.ics"');
  res.set('Cache-Control', 'private, max-age=900');
  return res.status(200).send(body);
}

exports.tpsPw = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method === 'GET') {   // Kalender-Abo
    const m = String(req.path || '').match(ICS_PATH);
    if (!m) return res.status(404).send('');
    try { return await icsServe(m[1], res, !!m[2]); } catch (e) { console.error('tpsPw ics', e); return res.status(500).send(''); }
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
  const body = req.body || {};
  const action = String(body.action || '');
  const id = String(body.id || '').trim();
  try {
    if (action === 'request') {
      // Immer dieselbe Antwort – egal ob der Name existiert.
      const generic = () => res.json({ ok: true });
      if (!ID_RE.test(id)) return generic();
      const dir = (await db.ref('zeiterfassung/loginDir/' + dirKey(id)).once('value')).val();
      if (!dir || dir.id !== id) return generic();
      const ref = db.ref('zeiterfassung/pwResetRequests/' + id);
      const prev = (await ref.once('value')).val();
      if (prev && prev.at && Date.now() - prev.at < 10 * 60 * 1000) return generic();
      await ref.set({ at: Date.now(), name: String(dir.name || id).slice(0, 80) });
      return generic();
    }

    if (action === 'set') {
      const c = await whoCalls(req);
      if (!c) return res.status(401).json({ ok: false, error: 'auth' });
      if (!c.isAdmin && !c.isPlus) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(c.tok)) return mfaRequired(res);
      const newPw = String(body.newPw || '');
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'id' });
      if (newPw.length < 12 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
      if (!c.isAdmin) {
        // „System-Verwaltung erweitert": nur aktive Mitarbeitende, nicht Admin, nicht sich selbst, nicht andere „erweitert"
        if (id === 'admin' || id === c.callerId) return res.status(403).json({ ok: false, error: 'protected' });
        const users = (await db.ref('zeiterfassung/users').once('value')).val() || [];
        const t = (Array.isArray(users) ? users : Object.values(users)).find(x => x && x.id === id);
        if (!t) return res.status(404).json({ ok: false, error: 'no-user' });
        if (t.role === 'admin' || isPlusUser(t)) return res.status(403).json({ ok: false, error: 'protected' });
      }
      const u = await admin.auth().getUserByEmail(accountEmail(id));
      if (!c.isAdmin && (u.uid === c.tok.uid || (await db.ref('zeiterfassung/admins/' + u.uid).once('value')).val() === true))
        return res.status(403).json({ ok: false, error: 'protected' });
      const lu = {}; logTo(lu, c, 'Einmal-Passwort gesetzt', id); await db.ref().update(lu);   // Protokoll zuerst
      await admin.auth().updateUser(u.uid, { password: newPw });
      await db.ref('zeiterfassung/pwResetRequests/' + id).remove();
      return res.json({ ok: true });
    }

    // Anmeldekonto anlegen (seit 13.10.): Die Selbst-Registrierung im Firebase-Projekt ist geschlossen –
    // Konten legt nur noch diese Function an (Admin SDK). Nur Administrator, nur mit zweitem Faktor.
    // Ein schon vorhandenes Konto wird NICHT übernommen (Antwort 409 'exists').
    if (action === 'create') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);
      const newPw = String(body.newPw || '');
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'id' });
      if (newPw.length < 12 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
      try {
        const u = await admin.auth().createUser({ email: accountEmail(id), password: newPw });
        const lu = {}; logTo(lu, { callerId: (await db.ref('zeiterfassung/uidUser/' + tok.uid).once('value')).val() || '', tok }, 'Anmeldekonto angelegt', id);
        await db.ref().update(lu);
        return res.json({ ok: true, uid: u.uid });
      } catch (e) {
        if (e && e.code === 'auth/email-already-exists') return res.status(409).json({ ok: false, error: 'exists' });
        throw e;
      }
    }

    // Mitarbeiter anlegen durch die System-Verwaltung (seit 13.10.; Admin darf es ebenfalls).
    // Die Datenbank-Regeln erlauben neue Datensätze in users nur dem Admin – deshalb legt diese Function
    // Anmeldekonto + Datensatz + Freischaltung an und prüft alles selbst:
    //  · Aufrufer: Admin oder System-Verwaltung (grants/zugriff_verwaltung), jeweils mit zweitem Faktor
    //  · Rollen nur ohne Sonderrechte: mitarbeiter, berater, freiberuflich
    //  · Zugriffe/Einzelrechte erlaubt – AUSSER „System-Verwaltung“ selbst (zugriff_verwaltung)
    //  · Felder nur aus einer festen Liste, Texte ohne < > " ' ` (wie Regeln v8)
    if (action === 'staffCreate') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      const isStaff = !isAdmin
        && (await db.ref('zeiterfassung/allowed/' + tok.uid).once('value')).val() === true
        && (await db.ref('zeiterfassung/grants/zugriff_verwaltung/' + tok.uid).once('value')).val() === true;
      if (!isAdmin && !isStaff) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);
      const isPlus = isStaff && (await db.ref('zeiterfassung/grants/zugriff_verwaltung_plus/' + tok.uid).once('value')).val() === true;
      const inU = body.user || {};
      const newPw = String(body.newPw || '');
      const uid0 = String(inU.id || '');
      if (!ID_RE.test(uid0) || uid0 === 'admin') return res.status(400).json({ ok: false, error: 'id' });
      if (newPw.length < 12 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
      const ROLES = (isAdmin || isPlus) ? ALL_ROLES : BASIC_ROLES;   // Leitung/GF nur Admin und „erweitert"
      const role = String(inU.role || 'mitarbeiter');
      if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'role' });
      const clean = v => {
        if (typeof v === 'string') return v.replace(/[<>"'`]/g, '').slice(0, 300);
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        if (typeof v === 'boolean' || v === null) return v;
        if (Array.isArray(v)) return v.slice(0, 50).map(clean);
        if (v && typeof v === 'object') { const o = {}; Object.keys(v).slice(0, 50).forEach(k => { if (/^[A-Za-z0-9_-]{1,40}$/.test(k)) o[k] = clean(v[k]); }); return o; }
        return null;
      };
      const name = clean(String(inU.name || '')).trim().slice(0, 80);
      if (!name) return res.status(400).json({ ok: false, error: 'name' });
      const FIELDS = ['email', 'city', 'bundesland', 'team', 'teams', 'teamHistory', 'customRole', 'customRoles', 'wh', 'dpw', 'al',
        'entryDate', 'exitDate', 'vacHoursPerDay', 'holidaysLikeSunday', 'allowHalfVac', 'sollWorkdays', 'maxHours',
        'lecturePeriods', 'lectureFreeDays', 'paramHistory', 'kanbanTeams', 'crmOnly'];
      const rec = { id: uid0, name, role };
      FIELDS.forEach(f => { if (inU[f] !== undefined) rec[f] = clean(inU[f]); });
      const PERM_OK = k => k !== 'zugriff_verwaltung' && (/^(path|verw)_[a-z_]{1,30}$/.test(k) || ['zugriff_verwaltung_ze', 'zugriff_verwaltung_crm', 'startseite',
        'tab_uebersicht', 'tab_gfberichte', 'btn_teamberichte', 'btn_jahresbericht', 'btn_erinnerungen', 'genehmigung_abwesenheit', 'stempel'].includes(k));
      const perms = {};
      Object.keys(inU.perms || {}).forEach(k => { if (PERM_OK(k) && typeof inU.perms[k] === 'boolean') perms[k] = inU.perms[k]; });
      rec.perms = perms;
      const callerId = (await db.ref('zeiterfassung/uidUser/' + tok.uid).once('value')).val() || '';
      rec.createdBy = callerId; rec.createdAt = new Date().toISOString();
      // Login-ID darf es weder aktiv noch im Archiv geben
      const arch = (await db.ref('zeiterfassung/archivedUsers').once('value')).val() || [];
      if ((Array.isArray(arch) ? arch : Object.values(arch)).some(x => x && x.id === uid0)) return res.status(409).json({ ok: false, error: 'id-archived' });
      let authUser;
      try { authUser = await admin.auth().createUser({ email: accountEmail(uid0), password: newPw }); }
      catch (e) { if (e && e.code === 'auth/email-already-exists') return res.status(409).json({ ok: false, error: 'exists' }); throw e; }
      const tr = await db.ref('zeiterfassung/users').transaction(cur => {
        // Erster Durchlauf kommt oft mit null (kein lokaler Cache) → null zurückgeben, Firebase wiederholt dann mit dem echten Wert
        if (cur === null) return null;
        const list = Array.isArray(cur) ? cur : Object.values(cur);
        if (list.some(x => x && x.id === uid0)) return;   // abbrechen: ID schon vergeben
        return list.concat([rec]);
      });
      if (!tr.committed) { try { await admin.auth().deleteUser(authUser.uid); } catch (_) {} return res.status(409).json({ ok: false, error: 'id-taken' }); }
      const nuid = authUser.uid;
      const upd = {};
      upd['zeiterfassung/allowed/' + nuid] = true;
      upd['zeiterfassung/uidUser/' + nuid] = uid0;
      upd['zeiterfassung/loginDir/' + dirKey(uid0)] = { id: uid0, name };
      if (role === 'freiberuflich') upd['zeiterfassung/freelancers/' + nuid] = true;
      if (role === 'leitung' || role === 'geschaeftsfuehrer') upd['zeiterfassung/managers/' + nuid] = true;
      if (role === 'geschaeftsfuehrer') upd['zeiterfassung/gfAdmins/' + nuid] = true;
      // Freigabelisten aus Rolle + Rechten sofort (der Admin-Start rechnet später alles autoritativ neu)
      const lvl = String((body.crm && body.crm.level) || 'none');
      Object.assign(upd, await grantUpdates(nuid, rec, { crmLevel: lvl }));
      logTo(upd, { callerId, tok }, 'Person angelegt', uid0, { role, crm: lvl });
      if (['verein', 'readonly', 'full'].includes(lvl)) {
        const vids = (lvl === 'verein' && Array.isArray(body.crm.vereinIds)) ? body.crm.vereinIds.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0, 100) : [];
        upd['crm/access/' + uid0] = { level: lvl, vereinIds: vids };
      }
      await db.ref().update(upd);
      try { await admin.auth().setCustomUserClaims(nuid, { tps: true }); } catch (_) {}
      return res.json({ ok: true, uid: nuid });
    }

    // Zugriffe einer BESTEHENDEN Person ändern durch die System-Verwaltung (seit 13.10.; Admin darf es ebenfalls).
    //  · Aufrufer: Admin oder System-Verwaltung, jeweils mit zweitem Faktor; nicht die eigene Person
    //  · Ziel nur Rollen ohne Sonderrechte (mitarbeiter, berater, freiberuflich), nie ein Admin-Konto
    //  · „System-Verwaltung“ (zugriff_verwaltung) bleibt wie sie ist – weder vergeben noch entziehen
    //  · Freigabelisten (grants) der Person für die gesetzten Rechte sofort angleichen; CRM-Zugriff setzen
    if (action === 'staffPerms') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      const isStaff = !isAdmin
        && (await db.ref('zeiterfassung/allowed/' + tok.uid).once('value')).val() === true
        && (await db.ref('zeiterfassung/grants/zugriff_verwaltung/' + tok.uid).once('value')).val() === true;
      if (!isAdmin && !isStaff) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);
      if (!ID_RE.test(id) || id === 'admin') return res.status(400).json({ ok: false, error: 'id' });
      const callerId = (await db.ref('zeiterfassung/uidUser/' + tok.uid).once('value')).val() || '';
      if (callerId === id) return res.status(400).json({ ok: false, error: 'self' });
      const isPlus = isStaff && (await db.ref('zeiterfassung/grants/zugriff_verwaltung_plus/' + tok.uid).once('value')).val() === true;
      const TARGET_ROLES = (isAdmin || isPlus) ? ALL_ROLES : BASIC_ROLES;
      const PERM_OK = k => k !== 'zugriff_verwaltung' && (/^(path|verw)_[a-z_]{1,30}$/.test(k) || ['zugriff_verwaltung_ze', 'zugriff_verwaltung_crm', 'startseite',
        'tab_uebersicht', 'tab_gfberichte', 'btn_teamberichte', 'btn_jahresbericht', 'btn_erinnerungen', 'genehmigung_abwesenheit', 'stempel'].includes(k));
      const inPerms = (body.perms && typeof body.perms === 'object') ? body.perms : {};
      const newPerms = {};
      Object.keys(inPerms).forEach(k => { if (PERM_OK(k) && typeof inPerms[k] === 'boolean') newPerms[k] = inPerms[k]; });
      const kanbanTeams = Array.isArray(body.kanbanTeams) ? body.kanbanTeams.filter(x => typeof x === 'string').map(x => x.replace(/[<>"'`]/g, '').slice(0, 120)).slice(0, 50) : null;
      const crmOnly = body.crmOnly === true;
      let target = null, reason = '';
      const tr = await db.ref('zeiterfassung/users').transaction(cur => {
        // Erster Durchlauf kommt oft mit null (kein lokaler Cache) → null zurückgeben, Firebase wiederholt dann mit dem echten Wert
        if (cur === null) return null;
        const list = Array.isArray(cur) ? cur : Object.values(cur);
        const i = list.findIndex(x => x && x.id === id);
        if (i < 0) { reason = 'no-user'; return; }
        const u = list[i];
        if (u.role === 'admin' || !TARGET_ROLES.includes(u.role)) { reason = 'role'; return; }
        if (!isAdmin && isPlusUser(u)) { reason = 'protected'; return; }
        // „System-Verwaltung“ und „… erweitert“ bleiben wie sie sind (vergibt nur der Administrator)
        // (auch ein ausdrückliches „Nein“ bleibt erhalten – Audit 14.10.2026)
        const perms = Object.assign({}, newPerms);
        ['zugriff_verwaltung', 'zugriff_verwaltung_plus'].forEach(k => {
          if (u.perms && Object.prototype.hasOwnProperty.call(u.perms, k)) perms[k] = u.perms[k]; else delete perms[k]; });
        list[i] = Object.assign({}, u, { perms, crmOnly });
        if (kanbanTeams) list[i].kanbanTeams = kanbanTeams;
        target = list[i];
        return list;
      });
      if (!tr.committed || !target) return res.status(reason === 'no-user' ? 404 : 403).json({ ok: false, error: reason || 'conflict' });
      // Freigabelisten der Person angleichen (Admin-Start rechnet später ohnehin alles autoritativ neu)
      let au = null; try { au = await admin.auth().getUserByEmail(accountEmail(id)); } catch (_) {}
      const upd = {};
      const lvl = String((body.crm && body.crm.level) || 'none');
      if (au) Object.assign(upd, await grantUpdates(au.uid, target, { crmLevel: ['verein', 'readonly', 'full'].includes(lvl) ? lvl : 'none' }));
      logTo(upd, { callerId, tok }, 'Zugriffe geändert', id, { crm: lvl });
      if (['verein', 'readonly', 'full'].includes(lvl)) {
        const vids = (lvl === 'verein' && Array.isArray(body.crm.vereinIds)) ? body.crm.vereinIds.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0, 100) : [];
        upd['crm/access/' + id] = { level: lvl, vereinIds: vids };
      } else upd['crm/access/' + id] = null;
      await db.ref().update(upd);
      return res.json({ ok: true });
    }

    // ── Tages-Backup durch den SERVER (seit v458): Das erste Gerät des Tages ruft 'autoBackup' auf; die Function
    //    liest den Stand selbst und legt backups/daily/<Datum>_srv.json an. Diese Namen kann kein Gerät erzeugen
    //    (Storage-Regel verlangt dort die eigene UID) → Server-Backups sind von Geräte-Uploads unterscheidbar.
    if (action === 'autoBackup') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      if ((await db.ref('zeiterfassung/allowed/' + tok.uid).once('value')).val() !== true
        && (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() !== true) return res.status(403).json({ ok: false, error: 'forbidden' });
      const day = berlinDay();
      const file = admin.storage().bucket(BUCKET).file('backups/daily/' + day + '_srv.json');
      const [exists] = await file.exists();
      if (!exists) {
        const ze = (await db.ref('zeiterfassung').once('value')).val() || {};
        const crm = (await db.ref('crm').once('value')).val() || {};
        if (!Array.isArray(ze.users) || !ze.users.length) return res.status(409).json({ ok: false, error: 'empty' });
        try { await file.save(JSON.stringify(fullBlob(ze, crm, 'server', '')), { contentType: 'application/json', resumable: false, preconditionOpts: { ifGenerationMatch: 0 } }); }
        catch (e) { if (!(e && (e.code === 412 || e.code === '412'))) throw e; }   // gleichzeitig schon angelegt → in Ordnung
      }
      await db.ref('zeiterfassung/_fixes/lastAppBackup').set(day);
      return res.json({ ok: true, created: !exists, day });
    }

    // ── Backups für „System-Verwaltung erweitert“ (seit 14.10.; Admin nutzt zusätzlich die App direkt) ──
    //  backupList          – automatische Backups mit Herkunft: server (vom Server erstellt), vor (Sicherung vor
    //                        Einspielen), geraet (älteres/fremdes Geräte-Upload – Inhalt nicht serverseitig erstellt)
    //  backupGet { name }  – Inhalt (zum Herunterladen)
    //  restore { name | data, parts:{ze,crm,shop} } – Einspielen, NUR mit zweitem Faktor UND frischer Bestätigung
    //     (Passwort + neuer Code, auth_time ≤ 5 Min.). Gehärtet nach dem Audit 14.10.2026:
    //   · Geräte-Uploads und eigene Dateien nur nach ausdrücklicher Bestätigung (allowUntrusted) – sonst nur Server-Backups
    //   · Vorher Pflicht-Sicherung des aktuellen Stands
    //   · Nur eine ERLAUBNISLISTE von Inhaltsknoten wird ersetzt (alles andere – Anmeldung, Freigaben, Matrix,
    //     Vertretungen, Einstellungen – bleibt wie jetzt), Inhalte werden geprüft/bereinigt (IDs, Schlüssel, Texte ohne < >)
    //   · Rollen/Rechte bestehender Personen bleiben wie jetzt; wer heute aktiv ist, bleibt aktiv; Personen nur im
    //     Backup kommen als Mitarbeiter/in ohne Sonderrechte zurück
    if (action === 'backupList' || action === 'backupGet' || action === 'restore' || action === 'adminLog') {
      const c = await whoCalls(req);
      if (!c) return res.status(401).json({ ok: false, error: 'auth' });
      if (!c.isAdmin && !c.isPlus) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(c.tok)) return mfaRequired(res);
      if (action === 'adminLog') {
        const snap = await db.ref('ze_admin_log').orderByKey().limitToLast(300).once('value');
        const out = []; snap.forEach(ch => { out.push(ch.val()); });
        return res.json({ ok: true, entries: out.reverse() });
      }
      const bucket = admin.storage().bucket(BUCKET);
      const NAME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[A-Za-z0-9_-]{1,120}\.json$/;
      const kindOf = n => /_srv\.json$/.test(n) ? 'server' : (/_vorEinspielen-/.test(n) ? 'vor' : 'geraet');
      if (action === 'backupList') {
        // alle Seiten lesen; Dateien mit unplausiblem Datum (vor 2025 / in der Zukunft) ausblenden – sonst ließe sich die
        // Liste mit Geräte-Uploads fluten bzw. echte Backups verdrängen (Audit-Gegenprüfung 14.10.2026)
        const [files] = await bucket.getFiles({ prefix: 'backups/daily/', autoPaginate: true });
        const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
        const names = files.map(f => f.name.slice('backups/daily/'.length)).filter(n => NAME_RE.test(n) && n.slice(0, 10) >= '2025-01-01' && n.slice(0, 10) <= tomorrow)
          .sort().reverse().slice(0, 400);
        const uu = (await db.ref('zeiterfassung/uidUser').once('value')).val() || {};
        const users = (await db.ref('zeiterfassung/users').once('value')).val() || [];
        const nameOf = id => { const u = (Array.isArray(users) ? users : Object.values(users)).find(x => x && x.id === id); return u ? String(u.name || id) : id; };
        const items = names.map(n => { const k = kindOf(n); let by = '';
          if (k === 'geraet') { const m = n.match(/^[0-9-]{10}_([A-Za-z0-9]+)\.json$/); const lid = m ? uu[m[1]] : ''; by = lid ? nameOf(lid) : 'unbekannt'; }
          return { name: n, kind: k, by }; });
        return res.json({ ok: true, names, items });
      }
      const readBackup = async name => {
        if (!NAME_RE.test(String(name || ''))) return null;
        const [buf] = await bucket.file('backups/daily/' + name).download();
        return JSON.parse(buf.toString('utf8'));
      };
      if (action === 'backupGet') {
        const d = await readBackup(body.name);
        if (!d) return res.status(400).json({ ok: false, error: 'name' });
        const lu = {}; logTo(lu, c, 'Backup heruntergeladen', String(body.name).slice(0, 80)); await db.ref().update(lu);
        return res.json({ ok: true, data: d });
      }
      // restore – nur direkt nach erneuter Bestätigung (Passwort + Code)
      const age = Date.now() / 1000 - Number(c.tok.auth_time || 0);
      if (!(age >= 0 && age <= 300)) return res.status(403).json({ ok: false, error: 'reauth-required' });
      const trusted = !!body.name && kindOf(String(body.name)) !== 'geraet';
      if (!trusted && body.allowUntrusted !== true) return res.status(409).json({ ok: false, error: 'untrusted' });
      let src = null;
      try { src = body.name ? await readBackup(body.name) : body.data; } catch (e) { return res.status(400).json({ ok: false, error: 'file' }); }
      if (!src || typeof src !== 'object' || Array.isArray(src)) return res.status(400).json({ ok: false, error: 'file' });
      const isVoll = src._type === 'tps-vollbackup', isCrm = src._type === 'tps-crm-backup', isShop = src._type === 'tps-shop-backup';
      const ze = isVoll ? src.zeiterfassung : ((isCrm || isShop) ? null : src);
      const crmIn = (isVoll || isCrm) ? src.crm : null;
      let shopIn = isShop ? src.shop : (isVoll ? (src.shop || null) : null);
      if (crmIn && typeof crmIn === 'object' && !shopIn && SHOP_COLLS.some(k => k in crmIn)) { shopIn = {}; SHOP_COLLS.forEach(k => { if (k in crmIn) shopIn[k] = crmIn[k]; }); }
      const parts = body.parts || {};
      const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
      const doZe = parts.ze === true && !!(ze && isObj(ze) && (Array.isArray(ze.users) || isObj(ze.users)) && isObj(ze.entries));
      const doCrm = parts.crm === true && isObj(crmIn);
      const doShop = parts.shop === true && isObj(shopIn);
      if (!doZe && !doCrm && !doShop) return res.status(400).json({ ok: false, error: 'nothing' });
      // 1) Sicherung des aktuellen Stands (Pflicht)
      const curZe = (await db.ref('zeiterfassung').once('value')).val() || {};
      const curCrm = (await db.ref('crm').once('value')).val() || {};
      const now = new Date();
      const safeName = berlinDay() + '_vorEinspielen-' + c.tok.uid.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) + '-' + now.getTime() + '.json';
      await bucket.file('backups/daily/' + safeName).save(JSON.stringify(fullBlob(curZe, curCrm, 'vor-einspielen', c.callerId)), { contentType: 'application/json', resumable: false });
      const upd = {};
      // 2) Zeiterfassung: nur Inhaltsknoten der Erlaubnisliste, bereinigt; Rechte wie jetzt
      if (doZe) {
        const list = v => Array.isArray(v) ? v.filter(Boolean) : (isObj(v) ? Object.values(v).filter(Boolean) : []);
        const SEC = ['role', 'perms', 'crmOnly', 'noTimesheet', 'noReport', 'gfCountersign', 'kanbanTeams', 'accessRevoked', 'archivedAt', 'archivedBy'];
        const curActive = {}, curAll = {};
        list(curZe.archivedUsers).forEach(u => { if (u && u.id) curAll[u.id] = u; });
        list(curZe.users).forEach(u => { if (u && u.id) { curAll[u.id] = u; curActive[u.id] = u; } });   // aktiv hat Vorrang
        const fix = u => {
          if (!isObj(u) || typeof u.id !== 'string' || !ID_RE.test(u.id)) return null;
          const o = cleanDeep(u); delete o.pw;
          const cu0 = curAll[u.id];
          if (cu0) {
            if (cu0.role === 'admin' || u.id === 'admin') return Object.assign({}, cu0);   // Admin-Datensatz bleibt wie jetzt
            SEC.forEach(k => { if (cu0[k] === undefined) delete o[k]; else o[k] = cu0[k]; });
            if (cu0.role === 'leitung') ['team', 'teams', 'teamHistory'].forEach(k => { if (cu0[k] === undefined) delete o[k]; else o[k] = cu0[k]; });   // Sichtbereich der Leitung
          } else {
            o.role = BASIC_ROLES.includes(o.role) ? o.role : 'mitarbeiter';                 // nie Leitung/GF/Admin aus dem Backup
            const pp = {}; Object.keys(isObj(o.perms) ? o.perms : {}).forEach(k => { if (/^path_[a-z_]{1,30}$/.test(k) && typeof o.perms[k] === 'boolean') pp[k] = o.perms[k]; });
            o.perms = pp; delete o.crmOnly; delete o.kanbanTeams; delete o.noTimesheet; delete o.noReport; delete o.gfCountersign;
          }
          return o;
        };
        const seen = new Set(); const nu = [], na = [];
        // Ob jemand aktiv oder archiviert ist, bestimmt der JETZIGE Stand (niemand wird ausgesperrt, niemand Gesperrtes kommt
        // zurück). Personen, die es nur im Backup gibt, kommen ins Archiv und gesperrt – freischalten nur bewusst.
        const place = o => { if (curActive[o.id]) nu.push(o); else { if (!curAll[o.id]) o.accessRevoked = true; na.push(o); } };
        list(ze.users).concat(list(ze.archivedUsers)).forEach(u => { const o = fix(u); if (o && !seen.has(o.id)) { seen.add(o.id); place(o); } });
        list(curZe.users).forEach(u => { if (u && u.id && !seen.has(u.id)) { seen.add(u.id); nu.push(u); } });              // niemand wird ausgesperrt
        list(curZe.archivedUsers).forEach(u => { if (u && u.id && !seen.has(u.id)) { seen.add(u.id); na.push(u); } });
        upd['zeiterfassung/users'] = nu;
        upd['zeiterfassung/archivedUsers'] = na;
        const KEYED = { entries: /^[a-z0-9._-]{1,64}_[0-9]{4}_[0-9]{2}$/, stamps: /^[A-Za-z0-9._-]{1,80}$/, vacRequests: /^[A-Za-z0-9._-]{1,120}$/,
          teamReports: /^[A-Za-z0-9._-]{1,160}$/, yearReports: /^[A-Za-z0-9._-]{1,160}$/, teamCats: /^[^.#$/\[\]]{1,120}$/ };
        Object.keys(KEYED).forEach(n => {
          const v = ze[n]; if (!isObj(v)) { upd['zeiterfassung/' + n] = null; return; }
          const o = {}; Object.keys(v).forEach(k => { if (KEYED[n].test(k) && (n === 'entries' ? isObj(v[k]) : v[k] != null)) o[k] = cleanDeep(v[k]); });
          upd['zeiterfassung/' + n] = Object.keys(o).length ? o : null;
        });
        if (Array.isArray(ze.customRoles)) upd['zeiterfassung/customRoles'] = cleanDeep(ze.customRoles.slice(0, 200));   // nur Anzeige-Bezeichnungen
        ['teams', 'cats'].forEach(n => { if (Array.isArray(ze[n])) upd['zeiterfassung/' + n] = ze[n].filter(x => typeof x === 'string').map(x => cleanStr(x).slice(0, 120)).slice(0, 500); });
      }
      // 3) CRM (ohne Lager): Zugriffe/Matrix/persönliche Einstellungen/Konfiguration der Rechte bleiben wie jetzt
      const CRM_KEEP = ['access', 'pathAccess', 'userPrefs'];
      if (doCrm) {
        Object.keys(curCrm).forEach(k => { if (!SHOP_COLLS.includes(k) && !CRM_KEEP.includes(k) && !(k in crmIn)) upd['crm/' + k] = null; });
        Object.keys(crmIn).forEach(k => { if (!SHOP_COLLS.includes(k) && !CRM_KEEP.includes(k) && /^[A-Za-z0-9_-]{1,80}$/.test(k)) upd['crm/' + k] = isObj(crmIn[k]) ? cleanDeep(crmIn[k]) : null; });
      }
      // 4) Lager
      if (doShop) SHOP_COLLS.forEach(k => { const v = shopIn[k]; upd['crm/' + k] = (isObj(v) && Object.keys(v).length) ? cleanDeep(v) : null; });
      logTo(upd, c, 'Backup eingespielt', body.name ? String(body.name).slice(0, 80) : 'Datei', { ze: doZe, crm: doCrm, shop: doShop, safety: safeName, trusted });
      await db.ref().update(upd);
      return res.json({ ok: true, safety: safeName, parts: { ze: doZe, crm: doCrm, shop: doShop } });
    }

    // Rolle einer bestehenden Person ändern (seit 14.10.): Administrator oder „System-Verwaltung erweitert“,
    // jeweils mit zweitem Faktor. Rollen: Mitarbeiter/in, Berater/in, Freiberuflich, Leitung, GF – nie Admin.
    // Nicht die eigene Person, nie ein Admin-Konto; Personen mit „erweitert“ nur der Administrator.
    // Danach managers/gfAdmins/freelancers + Freigabelisten der Person passend setzen.
    if (action === 'staffRole') {
      const c = await whoCalls(req);
      if (!c) return res.status(401).json({ ok: false, error: 'auth' });
      if (!c.isAdmin && !c.isPlus) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(c.tok)) return mfaRequired(res);
      if (!ID_RE.test(id) || id === 'admin') return res.status(400).json({ ok: false, error: 'id' });
      if (c.callerId === id) return res.status(400).json({ ok: false, error: 'self' });
      const role = String(body.role || '');
      if (!ALL_ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'role' });
      let target = null, reason = '';
      const tr = await db.ref('zeiterfassung/users').transaction(cur => {
        if (cur === null) return null;   // erster Durchlauf ohne Cache → Firebase wiederholt mit echtem Wert
        const list = Array.isArray(cur) ? cur : Object.values(cur);
        const i = list.findIndex(x => x && x.id === id);
        if (i < 0) { reason = 'no-user'; return; }
        const u = list[i];
        if (u.role === 'admin') { reason = 'admin-target'; return; }
        if (!c.isAdmin && isPlusUser(u)) { reason = 'protected'; return; }
        list[i] = Object.assign({}, u, { role });
        target = list[i];
        return list;
      });
      if (!tr.committed || !target) return res.status(reason === 'no-user' ? 404 : 403).json({ ok: false, error: reason || 'conflict' });
      let au = null; try { au = await admin.auth().getUserByEmail(accountEmail(id)); } catch (_) {}
      const upd = {};
      if (au) {
        Object.assign(upd, await grantUpdates(au.uid, target));
        upd['zeiterfassung/managers/' + au.uid] = (role === 'leitung' || role === 'geschaeftsfuehrer') ? true : null;
        upd['zeiterfassung/gfAdmins/' + au.uid] = role === 'geschaeftsfuehrer' ? true : null;
        upd['zeiterfassung/freelancers/' + au.uid] = role === 'freiberuflich' ? true : null;
      }
      logTo(upd, c, 'Rolle geändert', id, { role });
      await db.ref().update(upd);
      return res.json({ ok: true });
    }

    // Offboarding / Wiederherstellen eines Mitarbeiters:
    //  Berechtigt: Administrator ODER Recht „System-Verwaltung" (zeiterfassung/grants/zugriff_verwaltung,
    //  vom Admin vergeben). Nie für Admin-Konten, nie für das eigene Konto.
    //  offboard: Firebase-Konto sperren + Sitzungen widerrufen, aus allowed/uidUser/admins/
    //            gfAdmins/managers/grants und loginDir entfernen → sofort kein Zugriff mehr.
    //            archive:true → zusätzlich users → archivedUsers verschieben (für Nicht-Admins, die die
    //            Nutzerliste selbst nicht schreiben dürfen). Ein vorhandener Archiv-Eintrag bekommt accessRevoked.
    //  reboard:  Konto entsperren, allowed/uidUser/loginDir (+ managers/gfAdmins nach Rolle) setzen.
    //            restore:true → archivedUsers → users zurückverschieben.
    if (action === 'offboard' || action === 'reboard') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      const isStaff = !isAdmin
        && (await db.ref('zeiterfassung/allowed/' + tok.uid).once('value')).val() === true
        && (await db.ref('zeiterfassung/grants/zugriff_verwaltung/' + tok.uid).once('value')).val() === true;
      if (!isAdmin && !isStaff) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);   // Admin UND System-Verwaltung nur mit zweitem Faktor
      if (!ID_RE.test(id) || id === 'admin') return res.status(400).json({ ok: false, error: 'id' });
      const callerId = (await db.ref('zeiterfassung/uidUser/' + tok.uid).once('value')).val() || '';
      if (callerId === id) return res.status(400).json({ ok: false, error: 'self' });
      const users = (await db.ref('zeiterfassung/users').once('value')).val() || [];
      const arch  = (await db.ref('zeiterfassung/archivedUsers').once('value')).val() || [];
      const uList = Array.isArray(users) ? users : Object.values(users);
      const aList = Array.isArray(arch) ? arch : Object.values(arch);
      const rec = uList.find(x => x && x.id === id) || aList.find(x => x && x.id === id) || null;
      if (rec && rec.role === 'admin') return res.status(403).json({ ok: false, error: 'admin-target' });
      if (!isAdmin && isPlusUser(rec)) return res.status(403).json({ ok: false, error: 'protected' });   // „erweitert" sperrt nur der Admin
      let u = null;
      try { u = await admin.auth().getUserByEmail(accountEmail(id)); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
      if (u && u.uid === tok.uid) return res.status(400).json({ ok: false, error: 'self' });
      if (u && (await db.ref('zeiterfassung/admins/' + u.uid).once('value')).val() === true) return res.status(403).json({ ok: false, error: 'admin-target' });
      const upd = {};
      if (action === 'offboard') {
        if (u) {
          await admin.auth().updateUser(u.uid, { disabled: true });
          const cl = Object.assign({}, u.customClaims || {}); delete cl.tps;   // Freigabe-Markierung weg
          await admin.auth().setCustomUserClaims(u.uid, cl);
          await admin.auth().revokeRefreshTokens(u.uid);
          for (const n of ['allowed', 'uidUser', 'admins', 'gfAdmins', 'managers']) upd['zeiterfassung/' + n + '/' + u.uid] = null;
          const grants = (await db.ref('zeiterfassung/grants').once('value')).val() || {};
          for (const g of Object.keys(grants)) if (grants[g] && grants[g][u.uid]) upd['zeiterfassung/grants/' + g + '/' + u.uid] = null;
        }
        upd['zeiterfassung/loginDir/' + dirKey(id)] = null;
        upd['zeiterfassung/pwResetRequests/' + id] = null;
        const inUsers = uList.find(x => x && x.id === id);
        if (body.archive === true && inUsers) {
          const newArch = aList.filter(x => x && x.id !== id);
          newArch.push(Object.assign({}, inUsers, { archivedAt: new Date().toISOString(), archivedBy: callerId, accessRevoked: true }));
          upd['zeiterfassung/users'] = uList.filter(x => x && x.id !== id);
          upd['zeiterfassung/archivedUsers'] = newArch;
        } else if (aList.some(x => x && x.id === id)) {
          upd['zeiterfassung/archivedUsers'] = aList.map(x => (x && x.id === id) ? Object.assign({}, x, { accessRevoked: true }) : x);
        }
      } else {
        if (!u) return res.status(404).json({ ok: false, error: 'no-account' });
        // Nur echte Mitarbeiter-Datensätze (users/archivedUsers) wiederherstellen – sonst könnte das Recht
        // „System-Verwaltung" ein beliebiges (z. B. selbst registriertes) @tps.intern-Konto freischalten.
        // Der Anzeigename kommt aus dem Datensatz, nicht aus der Anfrage.
        if (!rec) return res.status(404).json({ ok: false, error: 'no-user' });
        const name = String(rec.name || id).slice(0, 80);
        await admin.auth().updateUser(u.uid, { disabled: false });
        await admin.auth().setCustomUserClaims(u.uid, Object.assign({}, u.customClaims || {}, { tps: true }));
        upd['zeiterfassung/allowed/' + u.uid] = true;
        upd['zeiterfassung/uidUser/' + u.uid] = id;
        upd['zeiterfassung/loginDir/' + dirKey(id)] = { id, name };
        const role = rec && rec.role;
        if (role === 'leitung' || role === 'geschaeftsfuehrer') upd['zeiterfassung/managers/' + u.uid] = true;
        if (role === 'geschaeftsfuehrer') upd['zeiterfassung/gfAdmins/' + u.uid] = true;
        const inArch = aList.find(x => x && x.id === id);
        if (body.restore === true && inArch && !uList.some(x => x && x.id === id)) {
          const back = Object.assign({}, inArch); delete back.archivedAt; delete back.archivedBy; delete back.accessRevoked;
          upd['zeiterfassung/users'] = uList.concat([back]);
          upd['zeiterfassung/archivedUsers'] = aList.filter(x => x && x.id !== id);
        }
      }
      logTo(upd, { callerId, tok }, action === 'offboard' ? (body.archive === true ? 'gesperrt + archiviert' : 'gesperrt') : (body.restore === true ? 'wiederhergestellt' : 'entsperrt'), id);
      await db.ref().update(upd);
      return res.json({ ok: true, account: !!u });
    }

    // Zwei-Faktor-Anmeldung (TOTP, freiwillig für alle):
    //  mfaPrep   – jede freigeschaltete Person für das EIGENE Konto: markiert die (technische) Adresse
    //              als bestätigt. Firebase erlaubt einen zweiten Faktor nur bei bestätigter Adresse; unsere
    //              <id>@tps.intern-Adressen lassen sich nicht per Mail bestätigen.
    //  mfaReset  – nur Administrator: entfernt alle zweiten Faktoren eines Kontos (Handy verloren).
    //  mfaStatus – nur Administrator: welche Konten (ids) haben einen zweiten Faktor eingerichtet.
    if (action === 'mfaPrep' || action === 'mfaReset' || action === 'mfaStatus') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      if (action === 'mfaPrep') {
        const allowed = isAdmin || (await db.ref('zeiterfassung/allowed/' + tok.uid).once('value')).val() === true;
        if (!allowed) return res.status(403).json({ ok: false, error: 'forbidden' });
        const u = await admin.auth().getUser(tok.uid);
        if (u.disabled) return res.status(403).json({ ok: false, error: 'forbidden' });
        if (!u.emailVerified) await admin.auth().updateUser(u.uid, { emailVerified: true });
        return res.json({ ok: true });
      }
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);
      if (action === 'mfaReset') {
        if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'id' });
        const u = await admin.auth().getUserByEmail(accountEmail(id));
        const had = ((u.multiFactor && u.multiFactor.enrolledFactors) || []).length;
        const upd = {}; logTo(upd, { callerId: (await db.ref('zeiterfassung/uidUser/' + tok.uid).once('value')).val() || '', tok }, 'Zwei-Faktor zurückgesetzt', id, { removed: had });
        await db.ref().update(upd);   // Protokoll zuerst
        if (had) await admin.auth().updateUser(u.uid, { multiFactor: { enrolledFactors: null } });
        return res.json({ ok: true, removed: had });
      }
      const on = [];
      let page;
      do {
        page = await admin.auth().listUsers(1000, page && page.pageToken);
        for (const u of page.users) {
          if (u.email && u.email.endsWith('@tps.intern') && ((u.multiFactor && u.multiFactor.enrolledFactors) || []).length)
            on.push(u.email.slice(0, -'@tps.intern'.length));
        }
      } while (page.pageToken);
      return res.json({ ok: true, on });
    }

    // Freigabe-Markierung am Konto (Custom Claim tps:true) für die Storage-Regeln:
    //  Storage-Regeln können die Datenbank (allowed/admins) nicht lesen. Die Markierung spiegelt
    //  „freigeschaltet" ins Anmelde-Token.
    //  claimSelf – jede angemeldete Person für das EIGENE Konto: setzt/entfernt nach allowed/admins.
    //  claimSync – nur Administrator: gleicht ALLE <id>@tps.intern-Konten mit allowed/admins ab
    //              (gesperrte Konten verlieren die Markierung).
    if (action === 'claimSelf' || action === 'claimSync') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const allowedMap = (await db.ref('zeiterfassung/allowed').once('value')).val() || {};
      const adminsMap  = (await db.ref('zeiterfassung/admins').once('value')).val() || {};
      const want = u => !u.disabled && (allowedMap[u.uid] === true || adminsMap[u.uid] === true);
      const sync = async u => {
        const cur = Object.assign({}, u.customClaims || {});
        const on = want(u);
        if (!!cur.tps === on) return false;
        if (on) cur.tps = true; else delete cur.tps;
        await admin.auth().setCustomUserClaims(u.uid, cur);
        return true;
      };
      if (action === 'claimSelf') {
        const u = await admin.auth().getUser(tok.uid);
        const changed = await sync(u);
        return res.json({ ok: true, tps: want(u), changed });
      }
      if (adminsMap[tok.uid] !== true) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!hasMfa(tok)) return mfaRequired(res);
      let page, on = 0, changed = 0;
      do {
        page = await admin.auth().listUsers(1000, page && page.pageToken);
        for (const u of page.users) {
          if (!u.email || !u.email.endsWith('@tps.intern')) continue;
          if (await sync(u)) changed++;
          if (want(u)) on++;
        }
      } while (page.pageToken);
      return res.json({ ok: true, on, changed });
    }

    // Eigener Kalender-Abo-Link: jede freigeschaltete Person, nur für sich selbst
    if (action === 'icsToken') {
      const c = await whoCalls(req);
      if (!c || !c.callerId) return res.status(401).json({ ok: false, error: 'auth' });
      const allowed = (await db.ref('zeiterfassung/allowed/' + c.tok.uid).once('value')).val() === true;
      if (!allowed && !c.isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
      const uRef = db.ref('kalenderAbo/users/' + dirKey(c.callerId));
      const cur = (await uRef.once('value')).val();
      const op = String(body.op || 'get');
      if (op === 'get') return res.json({ ok: true, token: (cur && cur.t) || '' });
      const upd = {};
      if (cur && cur.t) upd['kalenderAbo/tokens/' + icsHash(cur.t)] = null;
      if (op === 'delete') { upd['kalenderAbo/users/' + dirKey(c.callerId)] = null; await db.ref().update(upd); return res.json({ ok: true, token: '' }); }
      if (op !== 'new') return res.status(400).json({ ok: false, error: 'op' });
      const token = crypto.randomBytes(32).toString('base64url');   // 43 Zeichen
      upd['kalenderAbo/tokens/' + icsHash(token)] = { u: c.callerId, at: Date.now() };
      upd['kalenderAbo/users/' + dirKey(c.callerId)] = { t: token, at: Date.now() };
      await db.ref().update(upd);
      return res.json({ ok: true, token });
    }

    return res.status(400).json({ ok: false, error: 'action' });
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/user-not-found') return res.status(404).json({ ok: false, error: 'no-account' });
    if (String(code).startsWith('auth/')) return res.status(401).json({ ok: false, error: 'auth' });
    console.error('tpsPw', action, e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
