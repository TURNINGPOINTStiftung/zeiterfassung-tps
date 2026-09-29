# Firebase-RTDB-Regeln (TPS Zeiterfassung)

Die Regeln liegen live NUR in der Firebase-Konsole. Diese Dateien sind die
versionierte Referenz:

- **LIVE-baseline-2026-09-01.json** – die Regeln, wie sie am 2026-09-01 live waren
  (ein `.write` ganz oben auf `zeiterfassung` → jeder allowlistete Nutzer darf ALLES).
- **CANDIDATE.json** – die neuen Regeln: Schreibrecht pro Datenklasse getrennt.

## Was CANDIDATE.json macht
`zeiterfassung` bekommt `.write: isAdmin` (Admin-Bypass für Import/Restore/Voll-Knoten).
Normale Nutzer werden über Kind-`.write`-Regeln nur für ihre Knoten freigeschaltet:

- **nur Admin/Verwaltung:** `users` (ganzer Array), `rolePermissions`, `teams`, `cats`,
  `teamCats`, `customRoles`, `loginDir`, `allowed`, `admins`, `gfAdmins`, `uidUser`
- **Eigentümer oder Admin:** `users/$i/{pw,email,city,bundesland,lecturePeriods,lectureFreeDays}`
- **GF + Admin:** `vertretungen`
- **allowlistete Nutzer (wie bisher):** `entries`, `stamps`, `vacRequests`, `teamReports`,
  `yearReports`, `_fixes`, `pwResetTokens`
- Lesen unverändert (ganzes `zeiterfassung` für allowlistete; `loginDir` öffentlich).

`isAdmin`/`isGF`/Eigentümer werden über drei Allowlist-Knoten aufgelöst, die der Client pflegt:
`admins` (uid→true), `gfAdmins` (uid→true), `uidUser` (uid→App-Nutzer-ID).

## Cutover-Reihenfolge (ZWINGEND – sonst Team ausgesperrt)
1. **Client deployen** (Versions-Bump + Push). Rückwärtskompatibel. Enthält:
   - `data.js`: `setUserFields` (gezielte Owner-Feld-Writes); `fbWriteMerge` knoten-bewusst
     (Nicht-Admin schreibt keine Config-Knoten; `loginDir`/`allowed`/`admins`/`gfAdmins`/`uidUser`
     nie aus dem Blob); Restore-Pfad über `fbWriteMerge` (kein `set()` mehr → löscht keine
     Sicherheits-Knoten).
   - `profile.js` / `auth.js`: Passwort-/Profil-Writes gezielt auf `users/<idx>/<feld>`.
   - `admin-setup.js`: `runSecuritySetup`/`reprovisionUser` pflegen zusätzlich
     `admins`/`gfAdmins`/`uidUser`; neue `refreshPermissionAllowlists()` (recompute aus uidUser+Rollen).
   - `einstellungen.js`: ruft nach dem Speichern best-effort `refreshPermissionAllowlists`.
2. **Seeding (unter den ALTEN Regeln):** `admins`/`gfAdmins`/`uidUser` für ALLE bestehenden
   Nutzer befüllen. Da der Client die UID bereits provisionierter (evtl. migrierter) Konten nicht
   mehr per Stabil-PW holen kann, wird das einmalig über die Firebase-Auth-Konsolenliste (uid↔email,
   email = `<id>@tps.intern`) + die Rollen aus `users` erzeugt und in die DB geschrieben.
3. **CANDIDATE.json im Rules-Playground simulieren** (echte Daten, kein Schreibvorgang) – volle Matrix.
4. **Erst nach grüner Matrix veröffentlichen.**
5. Verifizieren (alle Nutzertypen).

## Rules-Playground-Testmatrix (Minimum)
- Nicht-Admin → `entries/x` schreiben: ERLAUBT (Kind-`.write` trotz Eltern-`.write:isAdmin=false`).
- Nicht-Admin → `users` (ganzer Array) schreiben: VERWEIGERT.
- Eigentümer → `users/<eigenerIdx>/pw`: ERLAUBT; fremder Index: VERWEIGERT.
- Nicht-Admin → `users/<idx>/role`: VERWEIGERT (keine Rechte-Eskalation).
- Nicht-Admin → `cats` / `teams` / `loginDir` / `allowed`: VERWEIGERT.
- Admin → `cats` / `users` / `loginDir`: ERLAUBT.
- GF → `vertretungen`: ERLAUBT; Nicht-GF/Nicht-Admin: VERWEIGERT.
- Lesen (allowlistet) ganzes `zeiterfassung`: ERLAUBT; `loginDir` ohne Auth: ERLAUBT.

## Storage-Regeln (STORAGE.rules)
Firebase Storage (Bucket `zeiterfassung-tps.firebasestorage.app`, angelegt 2026-09-29, Blaze).
Live nur in der Konsole unter Storage → Rules; `STORAGE.rules` ist die Referenz.
- `backups/daily/<datum>_<uid>.json`: automatische App-Backups (`js/backup.js`). Jedes App-Konto darf das
  Tages-Backup unter SEINER uid NEU anlegen (nie überschreiben); Lesen/Löschen nur `admin@tps.intern`.
  Grund für die uid im Namen: Auth-Sign-up ist offen (App legt Konten clientseitig an) → ein fremdes
  Konto darf das echte Backup nicht blockieren/vortäuschen können.
- `crm-anlagen/<nodeId>/<datei>`: CRM-Dateianhänge, nur @tps.intern-Konten, nur Einzelabruf, max. 15 MB.
- alles andere gesperrt.

## Backups (Stand 2026-09-29)
1. **Firebase (Konsole → Realtime Database → Backups):** täglich automatisch, Daten + Regeln,
   gzip, 30 Tage Aufbewahrung, Bucket `zeiterfassung-tps-default-rtdb-backups`.
2. **App (`js/backup.js`):** erstes Gerät des Tages lädt den Server-Stand (ZE + CRM) nach
   `backups/daily/<YYYY-MM-DD>_<uid>.json`. Aufbewahrung 90 Tage, der 1. jedes Monats dauerhaft
   (ArbZG ≥ 2 Jahre). Einsehen/Laden: Verwaltung → Daten & Backup → „☁ Automatische App-Backups".
