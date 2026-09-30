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
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
      const newPw = String(body.newPw || '');
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'id' });
      if (newPw.length < 8 || newPw.length > 128) return res.status(400).json({ ok: false, error: 'pw' });
      const u = await admin.auth().getUserByEmail(accountEmail(id));
      await admin.auth().updateUser(u.uid, { password: newPw });
      await db.ref('zeiterfassung/pwResetRequests/' + id).remove();
      return res.json({ ok: true });
    }

    // Offboarding / Wiederherstellen eines Mitarbeiters (nur Administrator):
    //  offboard: Firebase-Konto sperren + Sitzungen widerrufen, aus allowed/uidUser/admins/
    //            gfAdmins/managers und loginDir entfernen → sofort kein Zugriff mehr.
    //  reboard:  Konto entsperren, allowed/uidUser/loginDir wieder setzen (Rollen-Allowlists
    //            berechnet der Admin-Client danach per refreshPermissionAllowlists neu).
    if (action === 'offboard' || action === 'reboard') {
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ ok: false, error: 'auth' });
      const tok = await admin.auth().verifyIdToken(m[1]);
      const isAdmin = (await db.ref('zeiterfassung/admins/' + tok.uid).once('value')).val() === true;
      if (!isAdmin) return res.status(403).json({ ok: false, error: 'forbidden' });
      if (!ID_RE.test(id) || id === 'admin') return res.status(400).json({ ok: false, error: 'id' });
      let u = null;
      try { u = await admin.auth().getUserByEmail(accountEmail(id)); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
      if (u && u.uid === tok.uid) return res.status(400).json({ ok: false, error: 'self' });
      const upd = {};
      if (action === 'offboard') {
        if (u) {
          await admin.auth().updateUser(u.uid, { disabled: true });
          await admin.auth().revokeRefreshTokens(u.uid);
          for (const n of ['allowed', 'uidUser', 'admins', 'gfAdmins', 'managers']) upd['zeiterfassung/' + n + '/' + u.uid] = null;
        }
        upd['zeiterfassung/loginDir/' + dirKey(id)] = null;
        upd['zeiterfassung/pwResetRequests/' + id] = null;
      } else {
        if (!u) return res.status(404).json({ ok: false, error: 'no-account' });
        const name = String(body.name || id).slice(0, 80);
        await admin.auth().updateUser(u.uid, { disabled: false });
        upd['zeiterfassung/allowed/' + u.uid] = true;
        upd['zeiterfassung/uidUser/' + u.uid] = id;
        upd['zeiterfassung/loginDir/' + dirKey(id)] = { id, name };
      }
      await db.ref().update(upd);
      return res.json({ ok: true, account: !!u });
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
