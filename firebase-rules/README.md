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

## Stand 2026-09-30: CANDIDATE-v4.json ist LIVE (veröffentlicht 2026-09-30, App v366)
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
Reihenfolge: App ≥ v366 zuerst (läuft auch mit v3), Admin einmal anmelden (schreibt grants), DANN v4.

## Stand 2026-10-01: CANDIDATE-v5.json ist LIVE (App v374, tpsPw Revision 00003)
Rückfall: CANDIDATE-v4.json. Neu gegenüber v4: Recht „System-Verwaltung" (`grants/zugriff_verwaltung`)
darf bei ANDEREN, bestehenden Nicht-Admin-Nutzern die Stammdaten-Felder schreiben
(`users/$i/<feld>`: email, city, bundesland, team, teams, teamHistory, customRole(s), wh, dpw, al,
entryDate, exitDate, vacHoursPerDay, holidaysLikeSunday, allowHalfVac, sollWorkdays, maxHours,
lecturePeriods, lectureFreeDays, paramHistory). Nicht: id, name, pw, role, perms & Co., eigener Datensatz,
Admin-Datensatz, neue Datensätze, ganze Nutzerliste. Archivieren/Wiederherstellen durch dieses Recht
läuft über die Cloud Function tpsPw (offboard archive:true / reboard restore:true).
Zusätzlich: Recht „Abwesenheiten genehmigen" (grants/genehmigung_abwesenheit) darf wie managers fremde
entries/$k und ze_audit schreiben (Urlaubs-/Gutschrift-Sync beim Freigeben); Status-Freigabe bleibt managers.
Getestet: 16 Fälle im Projekt zeiterfassung-test (ruletest, danach zurückgebaut) + Abwesenheits-Fälle.

## Stand 2026-10-09: CANDIDATE-v6.json ist LIVE (App v428)
Rückfall: CANDIDATE-v5.json. Neu gegenüber v5: Shop-Daten (`crm/shop*`) nur für Shop-Berechtigte.
- Freigabelisten `grants/shop_nutzen` (Shop „Nutzen": persönliche Freischaltung `path_shop` oder
  Zugriffs-Matrix `crm/pathAccess/shop`) und `grants/verw_shop` (Shop „Verwaltend"), App ≥ v428.
- `shopConfig`, `shopPlaces`: nur Verwaltend. `shopItems`: Nutzen anlegen/ändern, löschen nur Verwaltend.
- `shopOrders`: Nutzen anlegen/ändern, löschen nur eigene (byId); Verwaltend alles.
- `shopLoans`: Nutzen anlegen/ändern; Ausleihende ohne Shop-Zugang dürfen ihre eigene Ausleihe
  bestätigen; löschen nur Verwaltend. `shopLog`: nur anhängbar (Verwaltend darf korrigieren).
- `crm/$coll` schließt `shop*` aus (neue Shop-Sammlungen brauchen eine eigene Regel).
Getestet: 20 Fälle im Projekt zeiterfassung-test (ruletest/ruletest_crm, danach zurückgebaut).
Reihenfolge: App v428 live → Admin einmal anmelden (schreibt grants/shop_*) → v6 veröffentlichen.

## Stand 2026-10-13: CANDIDATE-v7.json ist LIVE (App v439, tpsPw mit claimSelf/claimSync/reboard-Fix)
Rückfall: CANDIDATE-v6.json. Neu gegenüber v6:
- `zeiterfassung/teams`, `cats`, `teamCats`: zusätzlich Recht „Zeiterfassung: Verwaltend“ (`grants/zugriff_verwaltung_ze`), nur Texte ≤ 120 Zeichen.
- `crm/teamprojekte/$id`: anlegen/löschen/Team ändern nur Projektmanagement „Verwaltend“ (`grants/verw_kanban`) oder Admin;
  eigene Projekte (`owner` = eigene App-ID) frei; Inhalte bearbeiten alle Freigeschalteten (Team und Besitzer bleiben).
- `crm/userPrefs/$uid`: nur die eigene App-ID (oder Admin).
- `zeiterfassung/pwResetTokens`: keine eigene Freigabe mehr (nur Admin) – Altlast.
- `messe/*` (neu, eigener Knoten): lesen/schreiben nur Messemodus „Nutzen“ (`grants/messe_nutzen`) oder Admin; Felder validiert;
  `transferred` als Übertrag-Marker (nur eigener, nicht überschreibbar).
Getestet: 31 + 20 Fälle im Projekt zeiterfassung-test (ruletest*, danach zurückgebaut); vollständige Datei vom Compiler akzeptiert.
Storage: STORAGE.rules Stand 2 (Custom Claim `tps:true`) ebenfalls live seit 2026-10-13.

## Kandidat 2026-10-13: CANDIDATE-v8.json (NICHT einzeln veröffentlicht – geht in v9 auf)
Rückfall: CANDIDATE-v7.json. Neu gegenüber v7 – nur Inhaltsprüfungen (.validate), keine Rechteänderung;
zweite Schutzschicht zur Anzeige-Absicherung (v438):
- `entries/$k/days/$ds`: Zeiten nur Ziffern/`:`/`.`/Leerzeichen (≤ 8), Kleinteilig Zahl, Zuordnungen ohne `< > " ' ``` (≤ 120).
- `vacRequests/$id`: `id`/`userId` nur `A–Z a–z 0–9 _ . -`, Art ohne Sonderzeichen, Datum `JJJJ-MM-TT`, Tage Zahl,
  Status nur pending/approved/rejected, Zeiten je Tag wie oben.
- `users/$i`: Vorlesungszeiten/Eintritt/Austritt Datum, wh/dpw/al/vacHoursPerDay/maxHours Zahl, Team(s) ohne Sonderzeichen.
- `teams`, `cats`, `teamCats`: zusätzlich ohne `< > " ' ```.
- `crm/shopItems/$id/foto`: nur `data:image/…;base64,…` oder https-Adresse ohne Sonderzeichen; `min` Zahl.
Hinweis: Die Regelsprache kennt keinen Backslash in Zeichenklassen (Compilerfehler) – deshalb ohne `\`.
Getestet: 27 Fälle im Projekt zeiterfassung-test (ruletest*, danach zurückgebaut); vollständige Datei vom Compiler akzeptiert.
Nicht in v8 (offen): Selbstgenehmigung eigener Urlaubsanträge serverseitig (braucht Rolle im Server, Freiberufler/Kurz-Abwesenheit autom. genehmigt).

## Stand 2026-10-13: CANDIDATE-v9.json ist LIVE (= v8 + Zwei-Faktor für System-Verwaltung; App v443, tpsPw c6cc493)
Rückfall: CANDIDATE-v7.json (live). v9 enthält alle Inhaltsprüfungen aus v8 und zusätzlich:
- Überall, wo `grants/zugriff_verwaltung` (System-Verwaltung) etwas erlaubt (Stammdaten anderer, 21 Felder), nur mit
  `auth.token.firebase.sign_in_second_factor != null` (Anmeldung mit Zwei-Faktor).
- Bereichsrechte, die die System-Verwaltung automatisch mitbringt (zugriff_verwaltung_ze/_crm, verw_kanban/_kalender/_shop):
  wer zusätzlich System-Verwaltung hat, braucht dafür ebenfalls den zweiten Faktor; reine Bereichsrechte unverändert.
Getestet (Testprojekt): 6 Fälle ohne zweiten Faktor (Playground kann keinen zweiten Faktor simulieren) + vollständige Datei
vom Compiler akzeptiert. Live bestätigt (13.10.): System-Verwaltung MIT Code speichert Stammdaten anderer → RTDB liest
  auth.token.firebase.sign_in_second_factor korrekt. Rückweg: v7.
Dazu tpsPw: offboard/reboard auch für System-Verwaltung nur mit zweitem Faktor; App ≥ v442 zeigt Hinweise.

## Stand 2026-10-13: CANDIDATE-v10.json ist LIVE (= v9 + keine Selbstgenehmigung von Urlaubsanträgen; App v444)
Rückfall: CANDIDATE-v9.json (live). Neu: `vacRequests/$id/{status,startDate,endDate,workDays,type,creditWork}` – wer nicht
genehmigen darf (kein Admin/managers/grants/genehmigung_abwesenheit), darf den eigenen Antrag nur dann „approved“ setzen,
wenn die App ihn automatisch genehmigt: AU/Krank · Veranstaltung · Freiberufler (`zeiterfassung/freelancers`, vom Admin-Start
geschrieben) · workDays < 5 ohne creditWork. Ein genehmigter Antrag darf unverändert bleiben (Eckdaten gleich).
Prüfung an jedem Feld über newData.parent() (die App speichert feldweise; .validate läuft nur für geschriebene Knoten).
Grenze: workDays wird nicht gegen den Datumsbereich nachgerechnet (Regelsprache ohne Datumsrechnung).
Getestet: 13 Fälle im Projekt zeiterfassung-test, vollständige Datei vom Compiler akzeptiert.
Reihenfolge: App v444 live → Admin einmal anmelden (schreibt `freelancers`) → v10 veröffentlichen.

## Stand 2026-10-15: CANDIDATE-v11.json ist LIVE (+ Storage Stand 3; App ab v459) – veröffentlicht von Moritz per Cloud Shell, Prüfwort 21 Treffer, Storage-Konsole geprüft, Bedienung getestet
= v10 + Härtungen aus dem Audit 14.10.2026 (Datei aus v10 erzeugt, siehe Commit 60dd285):
- `entries/$k/gfReturn`: anlegen/ändern nur Admin/managers; Mitarbeitende nur „gelesen“ (ack) bei sonst gleichen
  Feldern; `y`/`m` Zahlen (m 1–12).
- `crm/$coll` → Schreibrecht auf Eintrags-Ebene `crm/$coll/$id`; Löschen (außer vorlagen/verteiler/workflows) nur
  CRM-Stufe „full“ oder `grants/zugriff_verwaltung_crm`. Ganze Sammlungen nur Admin.
- `teamprojekte`: Ändern durch alle nur bei Team-Projekten (ohne `owner`); persönliche nur Besitzer/Kanban-Verwaltung.
- `shopOrders`: „Nutzen“ nur eigene (`byId`) und automatische (`byId:'auto'`); fremde nur `seenBy/<eigeneId>`.
- `shopLoans`: „Nutzen“ ohne Sonderrecht – nur eigene Ausleihen.  `shopLog`: neue Buchungen nur mit eigenem `byId`.
- `users/$i`: System-Verwaltung ändert keine Stammdaten von Personen mit „erweitert“; `paramHistory/$n/role` nur
  unverändert oder = aktuelle Rolle (Admin frei).
Test im Testprojekt 15.10.2026 (vollständige Datei vom Compiler akzeptiert; Knoten umbenannt auf `rt_*`):
33 Fälle, 32 wie erwartet. Abweichung C2 („ganze Sammlung per set überschreiben“ erlaubt) ist die bekannte
Simulator-Eigenheit (set auf Elternknoten = Zusammenführen); real braucht `set` auf `crm/<coll>` ein Schreibrecht auf
Sammlungsebene, das nur der Admin hat; `delete` der Sammlung (C1) ist verweigert. Gegenprobe mit v10: 13 der 33 Fälle
sind unter v10 erlaubt und unter v11 verweigert (= geschlossene Lücken); alle „muss weiter gehen“-Fälle bleiben erlaubt.
Nicht simulierbar (Zwei-Faktor): Stammdaten-Schutz für „erweitert“ und paramHistory durch System-Verwaltung.
Testdaten gelöscht, Original-Regeln des Testprojekts wieder eingesetzt (PUT ohne Anmeldung → 401).
sha256 (raw @60dd285): 467299220d00c452f149d984d435efdd87ac7cd0994b195ecffa21383b0e6f6c · Prüfwort `zugriff_verwaltung_plus` = 21 Treffer.
Rückweg: CANDIDATE-v10.json.

**Storage Stand 3** (`STORAGE.rules` @60dd285, sha256 8d72e3f3c7da42c7c23a7901564917fe8f028c02fc061ebe58da631b6dae2906):
`backups/daily` kein Geräte-Upload mehr (Tages-Backup erstellt tpsPw `autoBackup`); `crm-anlagen` nur Bilder/PDF/Office/
Text mit `uploaderUid`, Löschen nur Admin oder Hochladende. Im Testprojekt nicht prüfbar (Storage braucht dort den
Blaze-Tarif) → Syntax beim Veröffentlichen in der Konsole; Rückweg: vorherigen Stand aus der Konsolen-Historie.

## Stand 2026-10-29: CANDIDATE-v13.json ist LIVE – Vertretungen für Leitung (App v513, tpsPw rev tpspw-00018) – veröffentlicht von Moritz per Cloud Shell, Live-Text = Datei (54.860 Zeichen, identisch)
= v12 + `zeiterfassung/vertretungen/$i`: mit `grants/vertretung_verwalten` einzelne Einträge anlegen/ändern, NUR wenn
`grants/vt_team/<teamKey>/<uid>` = Teamname des Eintrags (vom Admin-Start aus den Teams der Person berechnet); Team eines
Eintrags nicht änderbar, kein Löschen (Löschen/ganze Liste weiter nur Admin/GF).
Test im Testprojekt 29.10.2026 (`ruletest_ze`): 10 Fälle, 9 wie erwartet; V9 („Leitung überschreibt ganze Liste“ erlaubt) ist die
bekannte Simulator-Eigenheit (set auf Elternknoten = Zusammenführen) – real hat die Liste nur für Admin/GF ein Schreibrecht.
Hinweis: `numChildren()` gibt es in RTDB-Regeln nicht (Versuch verworfen). Vollständige Datei vom Compiler akzeptiert.
sha256 (raw @7a2c4e4): 67a2496d4c1ce2fb119247e8cdd0ba3c1482d1d50e967b14e4c78df34858beab · Prüfwort `vt_team` = 1 Treffer.
**Reihenfolge:** tpsPw (vertretung_verwalten) deployen → App v513 live → Admin öffnet App (schreibt grants/vt_team) → v13. Rückweg: v12.

## Stand 2026-10-29: CANDIDATE-v12.json ist LIVE – feine Rechte (App v510/v511, tpsPw rev tpspw-00017) – veröffentlicht von Moritz per Cloud Shell, Live-Text = Datei (54.256 Zeichen, identisch), Bedienung getestet
= v11 + Schreibrechte je Datensatz nach Server-Freigaben `grants/r_*` (berechnet aus den Einzelrechten, App `js/rechte.js`
SERVER_GRANTS bzw. tpsPw `fineGrants` – identisch, Vergleich über 34.720 Kombinationen ohne Abweichung):
- `crm/$coll/$id` (Kontakte): anlegen `r_crm_anlegen` oder `r_me_uebertragen` (Messe-Übertrag); ändern `r_crm_bearbeiten`
  oder der Stiftungs-Eintrag aus `crm/shopConfig/org` (Postadresse im Profil); löschen `r_crm_loeschen` oder `zugriff_verwaltung_crm`.
- `crm/veranstaltungen`: anlegen `r_kal_va`, ändern `r_kal_va` oder `r_pm_aufg_bearb`, löschen `r_kal_va_loeschen`.
- `crm/verteiler`: anlegen `r_vt_anlegen`, ändern `r_vt_bearbeiten`, löschen `r_vt_loeschen`. `crm/vorlagen`: `r_pm_vorlagen`.
- `messe/events`: anlegen/ändern `r_me_va`, löschen `r_me_va_loeschen`; `messe/entries/$ev/$id` löschen nur `r_me_eintrag_loeschen`
  oder wenn schon übertragen; ganze `entries/$ev`/`transferred/$ev` löschen (Veranstaltung löschen) mit `r_me_va_loeschen`;
  Übertrag-Marker nur mit `r_me_uebertragen`.
Test im Testprojekt 29.10.2026 (Abschnitte crm+messe auf `ruletest_*`): 38 Fälle (25 CRM, 13 Messe), alle wie erwartet;
vollständige Datei vom Compiler akzeptiert. Testdaten gelöscht, Original-Regeln zurück (PUT ohne Anmeldung → 401).
Nicht geprüft: Einschränkung „nur eigener Verein“ bzw. Felder innerhalb eines Kontakts (wirkt nur in der App).
sha256 (raw @f4c4c61): 256f5d16bd03f2e4037f3f442cbd6f095a5204fcc21e3bddb11144b1558b1f00 · Prüfwort `r_crm_bearbeiten` = 1 Treffer.
**Reihenfolge:** tpsPw mit `fineGrants` deployen → App v511 live → Administrator öffnet die App (schreibt `grants/r_*`, in der Konsole
prüfen, dass z. B. `grants/r_crm_bearbeiten` Einträge hat) → v12 veröffentlichen. Rückweg: CANDIDATE-v11.json.

## Stand 2026-11-03: CANDIDATE-v14.json ist LIVE – Kiosk-Konten (Messe-Tablet) (App v536, tpsPw @69e5914 = rev tpspw-00019-wob) – veröffentlicht von Moritz per Cloud Shell, Live-Text = Datei (57.076 Zeichen, identisch), messe/kioskEvents gefüllt
= v13 + Kiosk-Kennzeichen `zeiterfassung/kiosk/<uid>` (nur Admin schreibt, nur Wahrheitswert; das Konto selbst darf sein Kennzeichen lesen):
- Kiosk-Konten lesen `zeiterfassung`, `ze_audit`, `crm`, `crm_history` und `messe` nicht mehr (`loginDir` bleibt öffentlich).
- Neu `messe/kioskEvents/<ev>` = `{ name, createdAt }` (keine PIN, keine Kategorien): lesen alle Messe-Berechtigten inkl. Kiosk,
  schreiben wie `messe/events` (`r_me_va` / `r_me_va_loeschen`), Kiosk nie.
- `messe/entries/$ev/$id`: Kiosk nur neu anlegen bzw. denselben Eintrag (gleiches `dev` + `ts`) erneut senden; kein Ändern/Löschen.
  Veranstaltungen, Übertrag-Vermerke und Sammel-Löschungen für Kiosk gesperrt.
Test im Testprojekt 03.11.2026 (Abschnitte auf `rt_*` umbenannt, vollständiger v14-Inhalt vom Compiler akzeptiert): 31 Fälle, alle wie erwartet
(Kiosk: 18 Lese-/Schreibfälle, Personal: 6, Admin/Kennzeichen: 3, ohne Anmeldung: 1, Warmlauf 1, loginDir 1). Testdaten gelöscht,
Original-Regeln zurück (PUT ohne Anmeldung → 401).
sha256 (raw @d89f7a1): e2436851706d3f0a8ada92ddda4b07809ad063d7b36d2988e4c8a9616f61f761 · Prüfwort `kioskEvents` = 1 Treffer.
**Reihenfolge:** tpsPw (Kiosk ausgeschlossen) deployen → App mit Kiosk-Modus live → v14 veröffentlichen → Personal öffnet einmal den
Messemodus (füllt `kioskEvents`) → Admin setzt im Mitarbeiterdialog den Haken „Kiosk-Konto“ → Passwort des Messe-Kontos ändern.
Rückweg: CANDIDATE-v13.json.

## Stand 2026-11-04: CANDIDATE-v15.json ist LIVE (veröffentlicht von Moritz per Cloud Shell, Kontrolle r_pm_aufg_bearb = 2) – Team-Projekte nur mit Recht „Aufgaben bearbeiten“ ändern (App v544)
= v14 + in `crm/teamprojekte/$id` verlangt das Ändern eines bestehenden Team-Projekts (ohne `owner`, Team unverändert) zusätzlich
`grants/r_pm_aufg_bearb` (bisher: jede freigeschaltete Person). Anlegen/Team wechseln/Löschen weiter nur mit `verw_kanban` bzw. Admin;
eigene Projekte (`owner`) unverändert nur die Person selbst.
Nicht serverseitig prüfbar (bleibt App-Prüfung): ÖA-Freigabe/Phase innerhalb verschachtelter Aufgaben, Team-Grenze beim Ändern.
Test im Testprojekt 04.11.2026 (Abschnitt `crm/teamprojekte` auf `ruletest/` umbenannt): 17 Simulator-Fälle alle wie erwartet
(ohne/mit Recht ändern, Team/Besitzer ändern, Löschen, Leitung mit verw_kanban, Admin, eigene/fremde eigene Projekte, Anlegen, unbekannte UID)
+ PUT ohne Anmeldung → 401; vollständige v15-Datei vom Compiler akzeptiert. Testdaten gelöscht, Original-Regeln zurück (PUT → 401).
sha256 (raw @6f9c3c3): a8894af53b201a70359b1ebb44fe115efaf63a97b26c0e45f729adebd142d536 · Prüfwort `r_pm_aufg_bearb` = 2 Treffer (v14: 1).
**Reihenfolge:** App v544 live → Administrator öffnet die App einmal (Freigaben `grants/r_pm_aufg_bearb` neu berechnen) → v15 veröffentlichen.
Rückweg: CANDIDATE-v14.json.

## Stand 2026-11-04: CANDIDATE-v16.json ist LIVE (veröffentlicht von Moritz per Cloud Shell, Kontrolle ze_private = 1) – „Personaldaten privat“ Phase 1 (App v546)
= v15 + neuer Top-Level-Knoten `ze_private/<userId>/{entries,vacRequests,stamps}` und `zeiterfassung/abwesend/<id> = {uid,von,bis,halb}`:
- Lesen `ze_private/<u>`: die Person selbst, Admin, oder `zeiterfassung/seeOf/<auth.uid>/<u>` (schreibt die Admin-App aus `canSeeEmployee`).
  `vacRequests` zusätzlich `managers` und `grants/genehmigung_abwesenheit`. Kiosk nie.
- Schreiben: Regeln von `entries`/`vacRequests`/`stamps` 1:1 übernommen, zusätzlich Schlüssel bzw. `userId` muss zur Person `<u>` passen;
  unbekannte Unterknoten verboten. `abwesend`: Admin/Leitung/GF/Genehmiger:in oder die Person für eigene; nur uid/von/bis/halb (keine Art).
- Alte Knoten unverändert lesbar (Phase 1 schreibt nur zusätzlich, Phase 4 sperrt alt).
Test im Testprojekt 04.11.2026 (Abschnitte auf `ruletest`/`ruletest_priv`): 29 Simulator-Fälle wie erwartet (Fall „eigene Stempelzeit“ im
Sammellauf einmal Fehlläufer, einzeln wiederholt 2× erlaubt), dazu Lesen/Schreiben ohne Anmeldung → 401; vollständige v16-Datei vom Compiler
akzeptiert. Testdaten gelöscht, Original-Regeln zurück (PUT → 401).
sha256 (raw @ff63ed6): de81c647985e654bf0354a322c7d2a566ae4fd641ce8673d62addecbc4a26252 · Prüfwort `ze_private` ≥ 1 Treffer (v15: 0).
**Reihenfolge:** App v546 live (Spiegel ist best effort, schaltet sich ohne v16 still ab) → v16 veröffentlichen → Administrator öffnet die App
(schreibt `seeOf`). Rückweg: CANDIDATE-v15.json.

## GETESTET CANDIDATE-v17.json – „Personaldaten privat“ Phase 4 (noch NICHT live)
= v16 + alte Sammlungen gesperrt:
- `zeiterfassung/entries`, `vacRequests`, `stamps`: `.validate: false` (auf dem Knoten und je Kind) → dort entsteht nichts mehr, auch nicht
  durch den Admin (`.validate` gilt für alle, nur Löschen geht). Personen schreiben seit App v552 nach dem Abschluss nur noch `ze_private`.
- `zeiterfassung/zePrivOnly`: nur `true` (setzt das Abschluss-Werkzeug, Verwaltung → Daten & Backup; schreibt nur der Admin).
- `ze_audit/$k/$id` (Person selbst): Status-Prüfung „Monat nicht genehmigt“ liest jetzt `ze_private/<eigene Person>/entries/$k/status`.
**Reihenfolge (zwingend):** App v552 live → tpsPw deployen (Backup/Einspielen mit ze_private) → warten, bis das Werkzeug unter „Geräte“
niemanden mit alter App mehr zeigt → Werkzeug: Prüfen · Sicherung herunterladen · Alten Ort löschen → **sofort danach** v17 veröffentlichen.
Grund: Geräte mit v551 schreiben weiter auch an den alten Ort; unter v17 würde das abgelehnt. Rückweg: CANDIDATE-v16.json (+ Sicherungsdatei).
Test im Testprojekt 04.11.2026 (Abschnitte auf `ruletest`/`ruletest_priv`/`ruletest_audit`): 20 Simulator-Fälle wie erwartet –
alter Ort: Anna/Leitung/Admin schreiben Monatsblatt, Antrag, Stempel → verweigert; Admin löscht alte Sammlungen → erlaubt, Anna → verweigert;
Merker: Admin true → erlaubt, false → verweigert, Anna → verweigert; ze_private: eigener Entwurfsmonat/Stempel → erlaubt, genehmigter Monat →
verweigert, Leitung ohne seeOf liest nicht; Protokoll: Entwurfsmonat (auch mit zp:4) → erlaubt, genehmigter Monat (Status aus ze_private) →
verweigert. Vollständige v17-Datei vom Compiler akzeptiert. Testdaten gelöscht, Original-Regeln zurück (PUT/GET ohne Anmeldung → 401).
tpsPw @ab44d6d deployt 04.11.2026 (Moritz, rev tpspw-00021-luk, ACTIVE) – Backup/Einspielen mit ze_private.
sha256 (raw @ab44d6d): 5589373f3b0b0ed9f651fe4f32447a886bd4fda4d4ae8f608963e73f1aa206f0 · Prüfwort `zePrivOnly` = 1 Treffer (v16: 0).

## Stand 2026-11-11: CANDIDATE-v18.json ist LIVE (veröffentlicht von Moritz per Cloud Shell) – persönliche Projekte gezielt teilen (App v563)
= v16 (live) + eine weitere Schreib-Erlaubnis in `crm/teamprojekte/$id`: Mitglieder eines persönlichen Projekts
(`teilen` = Text `|uid1|uid2|`, enthält die eigene Personen-ID aus `uidUser`) dürfen Inhalte ändern – aber nur, wenn
`owner` und `teilen` gleich bleiben und das Projekt bestehen bleibt (kein Löschen, kein Anlegen fremder Projekte).
Test im Testprojekt 11.11.2026 (Abschnitt `ruletest/teamprojekte`): 11 Simulator-Fälle wie erwartet – Mitglied hakt ab /
benennt um → erlaubt; Mitglied ändert Teilen-Liste / macht sich zum Besitzer / löscht → verweigert; Nicht-Mitglied →
verweigert; Mitglied in nicht geteiltem Projekt → verweigert; fremdes geteiltes Projekt anlegen → verweigert; Besitzerin ändert
Teilen / hakt ab / löscht → erlaubt. Vollständige v18-Datei vom Compiler akzeptiert (im Testprojekt veröffentlicht), danach
Testdaten gelöscht, Original-Regeln zurück (PUT/GET `ruletest` ohne Anmeldung → 401).
sha256 (raw @2028bfe): 3e2dd19130f4c361cccb87f169a8fc284e2851ed22962826b1a3ef490a06a7b3 · Prüfwort `teilen` ≥ 1 Treffer (v16: 0).
Rückweg: CANDIDATE-v16.json.
**CANDIDATE-v19.json** = v17 + dieselbe Teilen-Erlaubnis → beim Abschluss „Personaldaten privat“ (Phase 4) **v19 statt v17** veröffentlichen.

## Stand 2026-11-13: CANDIDATE-v21.json ist LIVE (veröffentlicht von Moritz per Cloud Shell, Kontrolle versand = 1) – Bestellungen im Planner (App v578)
= v20 + für alle Angemeldeten (allowed, kein Kiosk, mit uidUser): `shopOrders/$id` bestehende Bestellung ändern, wenn `byId`
gleich bleibt (kein Anlegen fremder, kein Löschen) · `shopLoans/$id` neu anlegen nur mit `orderId` einer bestehenden Bestellung,
`status` aktiv, keine Zuordnung · `shopLog/$id` zusätzlich Typen `ausgabe`/`verleih`/`versand`/`umlagern` (Absender eigene Person).
Test im Testprojekt 13.11.2026 (`ruletest_crm` = v21-crm umgeschrieben): 18 Simulator-Fälle wie erwartet – Status/Antwort/ausgegeben
erlaubt; Besteller tauschen / löschen / fremde anlegen / Kiosk verweigert; Ausleihe aus Bestellung erlaubt, ohne/unbekannte Bestellung
oder als Zuordnung verweigert; Verlauf Ausgabe/Verleih erlaubt, Korrektur / fremder Absender verweigert; Regression v20 (Bestand
erlaubt, Artikelname verweigert) und Lager-Verwalter ganze Bestellung erlaubt. Vollständige v21-Datei vom Compiler akzeptiert,
danach Testdaten gelöscht, Original-Regeln zurück (PUT `ruletest`/`ruletest_crm` ohne Anmeldung → 401).
sha256 (raw @07f0f42): c3bf22599f6e5250a1999a5c20e3f358605b470e361493b3c40de077c7426363 · Prüfwort `'versand'` = 1 Treffer (v20: 0).
Reihenfolge: erst Regeln v21, dann App v578. Rückweg: CANDIDATE-v20.json.
**Phase 4 „Personaldaten privat“:** statt v19 eine **v22 = v19 + Lager-Freigaben aus v20 und v21**.

## Stand 2026-11-13: CANDIDATE-v20.json ist LIVE (veröffentlicht von Moritz per Cloud Shell, Kontrolle shopTasks = 1) – Lager-Aufgaben im Planner (App v575)
= v18 (live) + Lager-Freigaben für alle Angemeldeten (allowed, kein Kiosk, mit uidUser):
`crm/shopTasks/$id` (Zuständige/Status/Notizen einer Lager-Aufgabe; .validate id = Schlüssel, datum Pflicht) ·
`shopPlaces/$id/termine` · `shopItems/$id/stock` · `shopItems/$id/units/$u/{termine,placeId}` ·
`shopLog/$id` neu mit type `termin`/`rueckgabe` (Absender = eigene Person, wie bisher per .validate) ·
`shopLoans/$id` aktive Ausleihe ändern, ohne borrowerId/itemId/placeId/unitId/zuord zu tauschen.
Test im Testprojekt 13.11.2026 (Abschnitt `ruletest_crm` = v20-crm mit `zeiterfassung/`→`ruletest/`): 24 Simulator-Fälle wie
erwartet – shopTasks anlegen erlaubt; Kiosk / falsche id / ohne Anmeldung verweigert; Ort-Termine erlaubt, Ort-Name verweigert;
Bestand, Stück-Ort, Stück-Termine erlaubt, Artikelname/Stück-Bezeichnung verweigert; Verlauf rueckgabe erlaubt, anderer Typ /
fremder Absender / bestehenden ändern verweigert; Ausleihe zurückbuchen erlaubt, Ausleiher tauschen / abgeschlossene ändern /
Kiosk verweigert; Regression: Lager-Verwalter ganzer Ort erlaubt, Ausleiherin eigene Ausleihe erlaubt, Mitarbeiterin ganzer Ort
verweigert. Vollständige v20-Datei vom Compiler akzeptiert (im Testprojekt veröffentlicht), danach Testdaten gelöscht,
Original-Regeln zurück (PUT/GET `ruletest` ohne Anmeldung → 401).
sha256 (raw @26d90ed): bc3162a8061e26675b2f740f53d6a93bfe2413f51ac1ad070b0ba63be4d5d98d · Prüfwort `shopTasks` = 1 Treffer (v18: 0).
Reihenfolge: erst Regeln v20, dann App v575. Rückweg: CANDIDATE-v18.json.
**Für Phase 4 „Personaldaten privat“:** statt v19 eine **v21 = v19 + diese Lager-Freigaben** bauen und veröffentlichen.

## Veröffentlichen per Cloud Shell (bewährt seit v10, statt Kopieren in der Konsole)
```
cd ~ && curl -s "https://zeiterfassung-tps-default-rtdb.europe-west1.firebasedatabase.app/.settings/rules.json?access_token=$(gcloud auth print-access-token)" -o regeln_backup.json
curl -sfo regeln_neu.json https://raw.githubusercontent.com/TURNINGPOINTStiftung/zeiterfassung-tps/<commit>/firebase-rules/CANDIDATE-vN.json && sha256sum regeln_neu.json
curl -s -X PUT "https://zeiterfassung-tps-default-rtdb.europe-west1.firebasedatabase.app/.settings/rules.json?access_token=$(gcloud auth print-access-token)" --data-binary @regeln_neu.json   # → {"status":"ok"}
```
Prüfen: GET wie oben und nach einem nur in der neuen Version vorkommenden Wort zählen (grep -o … | wc -l). Rückweg: PUT mit regeln_backup.json.
