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

const ALLOWED_ORIGINS = [
  'https://turningpointstiftung.github.io',
  'http://localhost:7891', 'http://localhost:8765',
];
const ID_RE = /^[a-z0-9._-]{1,64}$/;
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
const AREA_KEYS = ['zugriff_verwaltung_ze', 'zugriff_verwaltung_crm', 'verw_kanban', 'verw_kalender', 'verw_shop'];
const ALL_ROLES = ['mitarbeiter', 'berater', 'freiberuflich', 'leitung', 'geschaeftsfuehrer'];
const BASIC_ROLES = ['mitarbeiter', 'berater', 'freiberuflich'];
// Freigabelisten (grants) einer Person aus Rolle + Einzelrechten – gleiche Logik wie admin-setup.js
// refreshPermissionAllowlists (der Admin-Start rechnet ohnehin alles autoritativ neu).
async function grantUpdates(authUid, u) {
  const rp = (await db.ref('zeiterfassung/rolePermissions').once('value')).val() || {};
  const p = (u && u.perms) || {};
  const has = k => Object.prototype.hasOwnProperty.call(p, k) ? !!p[k] : (Array.isArray(rp[k]) ? rp[k] : (ROLE_DEFAULTS[k] || [])).includes(u.role);
  const sys = has('zugriff_verwaltung');
  const upd = {};
  ['tab_gfberichte', 'btn_teamberichte', 'btn_jahresbericht', 'genehmigung_abwesenheit', 'zugriff_verwaltung']
    .forEach(k => { upd['zeiterfassung/grants/' + k + '/' + authUid] = has(k) ? true : null; });
  AREA_KEYS.forEach(k => { upd['zeiterfassung/grants/' + k + '/' + authUid] = (sys || p[k] === true) ? true : null; });
  upd['zeiterfassung/grants/zugriff_verwaltung_plus/' + authUid] = (sys && p.zugriff_verwaltung_plus === true) ? true : null;
  return upd;
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

exports.tpsPw = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
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
      if (newPw.length < 8 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
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
      if (newPw.length < 8 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
      try {
        const u = await admin.auth().createUser({ email: accountEmail(id), password: newPw });
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
      if (newPw.length < 8 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
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
      Object.assign(upd, await grantUpdates(nuid, rec));
      if (perms.path_shop === true) upd['zeiterfassung/grants/shop_nutzen/' + nuid] = true;
      if (perms.path_messe === true) upd['zeiterfassung/grants/messe_nutzen/' + nuid] = true;
      const lvl = String((body.crm && body.crm.level) || 'none');
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
        const perms = Object.assign({}, newPerms);
        if (u.perms && u.perms.zugriff_verwaltung) perms.zugriff_verwaltung = true;
        if (u.perms && u.perms.zugriff_verwaltung_plus) perms.zugriff_verwaltung_plus = true;
        list[i] = Object.assign({}, u, { perms, crmOnly });
        if (kanbanTeams) list[i].kanbanTeams = kanbanTeams;
        target = list[i];
        return list;
      });
      if (!tr.committed || !target) return res.status(reason === 'no-user' ? 404 : 403).json({ ok: false, error: reason || 'conflict' });
      // Freigabelisten der Person angleichen (Admin-Start rechnet später ohnehin alles autoritativ neu)
      let au = null; try { au = await admin.auth().getUserByEmail(accountEmail(id)); } catch (_) {}
      const upd = {};
      if (au) {
        Object.assign(upd, await grantUpdates(au.uid, target));
        if ('path_shop' in target.perms) upd['zeiterfassung/grants/shop_nutzen/' + au.uid] = target.perms.path_shop ? true : null;
        if ('path_messe' in target.perms) upd['zeiterfassung/grants/messe_nutzen/' + au.uid] = target.perms.path_messe ? true : null;
      }
      const lvl = String((body.crm && body.crm.level) || 'none');
      if (['verein', 'readonly', 'full'].includes(lvl)) {
        const vids = (lvl === 'verein' && Array.isArray(body.crm.vereinIds)) ? body.crm.vereinIds.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0, 100) : [];
        upd['crm/access/' + id] = { level: lvl, vereinIds: vids };
      } else upd['crm/access/' + id] = null;
      await db.ref().update(upd);
      return res.json({ ok: true });
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
      if (au) {
        const upd = await grantUpdates(au.uid, target);
        upd['zeiterfassung/managers/' + au.uid] = (role === 'leitung' || role === 'geschaeftsfuehrer') ? true : null;
        upd['zeiterfassung/gfAdmins/' + au.uid] = role === 'geschaeftsfuehrer' ? true : null;
        upd['zeiterfassung/freelancers/' + au.uid] = role === 'freiberuflich' ? true : null;
        await db.ref().update(upd);
      }
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

    return res.status(400).json({ ok: false, error: 'action' });
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/user-not-found') return res.status(404).json({ ok: false, error: 'no-account' });
    if (String(code).startsWith('auth/')) return res.status(401).json({ ok: false, error: 'auth' });
    console.error('tpsPw', action, e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
