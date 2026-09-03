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
