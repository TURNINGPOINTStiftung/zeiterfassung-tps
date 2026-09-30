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

## Stand 2026-09-29: CANDIDATE-v2.json ist LIVE
Veröffentlicht am 2026-09-29 (vorher live: CANDIDATE.json = Rückfall-Stand). Neu gegenüber v1:
- `entries/$k`: Besitzer (uidUser-ID + `_YYYY_MM`) nur solange Status ≠ approved; Status nur
  draft/submitted. Leitung/GF/Admin (`managers`) und Admin immer.
- `stamps/$uid` nur Besitzer/Admin; `vacRequests/$id` Besitzer (userId) oder managers/Admin;
  `teamReports`/`yearReports` nur managers/Admin; `_fixes` nur noch `lastAppBackup` (Datum).
- Neue Allowlist `managers` (Leitung/GF/Admin), gepflegt von admin-setup.js wie admins/gfAdmins.
Getestet: 33 Fälle im Projekt zeiterfassung-test (Bereich `ruletest`, danach zurückgebaut) +
Abgleich gegen den Live-Export (alle 19 Nutzer gemappt, 602/611 Einträge eindeutig zuordenbar –
Rest = alte `jörg_…`-Kopien) + 6 Kontrollfälle im Playground gegen die Live-Daten.
Rückfall: Inhalt von CANDIDATE.json in der Konsole veröffentlichen.

## Stand 2026-09-30: CANDIDATE-v3.json ist LIVE
Rückfall: CANDIDATE-v2.json. Neu gegenüber v2:
- `entries/$k/status`: nur gültige Übergänge – eingereicht nur aus Entwurf/abgelehnt, Entwurf aus
  Entwurf/eingereicht/abgelehnt, genehmigt/abgelehnt NUR durch managers und NUR aus „eingereicht"
  (verhindert Mischzustände bei gleichzeitigem Zurückziehen/Genehmigen). Admin: alles.
- `ze_audit/<entryKey>/<id>` (eigener Wurzelknoten, nicht im Live-Sync): Änderungsprotokoll der
  Tagesfelder, **nur anhängbar** (!data.exists()), Besitzer (nicht genehmigter Monat) oder
  managers/Admin, `by` muss zur eigenen App-ID passen. Lesen: allowlistete Nutzer.
Getestet: 15 Fälle im Projekt zeiterfassung-test (ruletest/ruletest_audit, danach zurückgebaut).
Wichtig: Regeln VOR einer App-Version veröffentlichen, die ze_audit schreibt (sonst wird das
atomare update inkl. der eigentlichen Änderung abgelehnt).

## Stand 2026-09-30: CANDIDATE-v4.json – bereit (noch NICHT live)
Rückfall: CANDIDATE-v3.json. Neu gegenüber v3 („Rechte vergibt nur der Admin – vergebene Rechte wirken"):
- Neue Freigabelisten `zeiterfassung/grants/<recht>/<authUid>` (nur Admin schreibt, abgeleitet von
  refreshPermissionAllowlists in admin-setup.js; läuft beim Admin-Start und nach Rechte-Änderungen).
- `vacRequests`: zusätzlich Recht `genehmigung_abwesenheit`; `teamReports`/`yearReports`: zusätzlich
  `btn_teamberichte`, `btn_jahresbericht`, `tab_gfberichte`.
- `crm`: Schreiben nur noch pro Sammlung (`$coll`); `crm/access` (CRM-Zugriffsstufen) und
  `crm/pathAccess` (Zugriffs-Matrix, neu als eigener Knoten) nur Admin; `crm/config` Admin oder
  Recht `zugriff_verwaltung_crm`; ganzes CRM ersetzen (Restore) nur Admin; `.validate` verhindert,
  dass access/config/pathAccess über einen Schreibvorgang auf `crm` verschwinden.
- `crm_history/$id`: nur anhängbar, `byId` = eigene App-ID, `ts` nicht in der Zukunft; löschen nur
  Einträge älter als 7 Tage (automatisches Aufräumen) oder Admin.
Getestet: 30 Fälle im Projekt zeiterfassung-test (ruletest*, danach zurückgebaut).
Reihenfolge: App ≥ v365 zuerst (läuft auch mit v3), Admin einmal anmelden (schreibt grants +
migriert pathAccess), DANN v4 veröffentlichen.
