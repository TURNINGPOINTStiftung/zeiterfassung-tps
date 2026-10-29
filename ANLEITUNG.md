# Zeiterfassung Turning Point Stiftung – Anleitung

Diese Anleitung erklärt alle Funktionen und den richtigen Umgang mit der Zeiterfassung.
Sie ist nach Themen gegliedert – am Ende findest du einen Abschnitt mit häufigen Fragen.

> **Kurzfassung für den Alltag:** Zeiten erfassen (tippen oder stempeln) → Zuordnung wählen →
> am Monatsende **„Monat einreichen"**. Pausen, Feiertage und Urlaub berücksichtigt das System automatisch.

---

## Inhalt

1. [Anmelden, Passwort & Zwei-Faktor](#1-anmelden-passwort--zwei-faktor)
2. [Rollen & Zugriffe – wer darf was](#2-rollen--zugriffe--wer-darf-was)
3. [Startseite & Navigation](#3-startseite--navigation)
4. [Zeiten erfassen](#4-zeiten-erfassen)
5. [Pausen, Nachtschicht, Zeitumstellung & Rundung](#5-pausen-nachtschicht-zeitumstellung--rundung)
6. [Die Kennzahlen oben](#6-die-kennzahlen-oben)
7. [Monat einreichen](#7-monat-einreichen)
8. [Abwesenheiten (Urlaub, Krank …)](#8-abwesenheiten-urlaub-krank-)
9. [Weitere Bereiche: CRM, Projekte, Kalender, Lager](#9-weitere-bereiche-crm-projekte-kalender-lager)
   - [Kalender & Abo in Outlook / am Handy](#kalender--abo-in-outlook--am-handy)
10. [Für Leitung & Geschäftsführung](#10-für-leitung--geschäftsführung)
11. [Für Administratoren & System-Verwaltung](#11-für-administratoren--system-verwaltung)
12. [Mein Profil: Darstellung, Startseite, Sicherungen](#12-mein-profil-darstellung-startseite-sicherungen)
13. [App installieren (Handy/Tablet)](#13-app-installieren-handytablet)
14. [Häufige Fragen](#14-häufige-fragen)

---

## 1. Anmelden, Passwort & Zwei-Faktor

1. App öffnen → die **Anmeldemaske** erscheint.
2. **Namen eintippen** – schon nach den ersten Buchstaben erscheinen Vorschläge
   (Groß-/Kleinschreibung egal). Passenden Namen auswählen.
3. **Passwort** eingeben.
4. Mit **Enter** oder Klick auf **Anmelden** bestätigen.
5. Hast du die **Zwei-Faktor-Anmeldung** eingeschaltet, fragt die App jetzt noch den **6-stelligen Code**
   aus deiner Authenticator-App ab (siehe unten).

**Tastatur-Bedienung:** Du kannst dich komplett mit **Tab / Pfeiltasten / Enter** durch die
Anmeldung bewegen – die Maus ist nicht nötig.

**„Angemeldet bleiben":** Merkt sich auf diesem Gerät deinen **Namen** und hält dich angemeldet.
**Nur auf eigenen, privaten Geräten nutzen.** Beim **Abmelden** werden alle gespeicherten Daten vom
Gerät gelöscht – wichtig auf geteilten Geräten.

### Passwort vergessen
1. In der Anmeldemaske auf **„Passwort vergessen?"** klicken und deinen **Namen** eingeben.
2. Die Anfrage landet beim **Administrator**. Er vergibt dir ein **Einmal-Passwort** und gibt es dir
   persönlich oder telefonisch weiter.
3. Mit **Name + Einmal-Passwort** anmelden und danach im **Profil** ein eigenes Passwort festlegen
   (mindestens 12 Zeichen).

### Passwort ändern
**Profil** (Klick auf deinen Namen oben rechts) → **„🔒 Passwort ändern"**: aktuelles und neues Passwort
eingeben, **Speichern**. Das neue Passwort gilt sofort auf allen Geräten.

### Zwei-Faktor-Anmeldung (2FA)
Zusätzlich zum Passwort fragt die App beim Anmelden einen **6-stelligen Code** ab, den eine
**Authenticator-App** auf deinem Handy erzeugt (z. B. Microsoft Authenticator, Google Authenticator,
Proton Pass). Wer nur dein Passwort kennt, kommt so nicht in dein Konto.

**Wer braucht das?**
- **Alle:** freiwillig, aber empfohlen.
- **Administrator:** Pflicht – Admin-Aktionen (Passwort setzen, Konten anlegen/sperren, Zwei-Faktor
  zurücksetzen, Backup einspielen …) funktionieren nur nach einer Anmeldung **mit Code**.
- **System-Verwaltung:** Pflicht – Änderungen an Mitarbeitenden, Archiv und Organisation sind nur nach
  Anmeldung mit Code möglich. Ohne Code zeigt die App einen gelben Hinweis und sperrt das Speichern.

**Einrichten (einmalig, ca. 2 Minuten):**
1. Authenticator-App auf dem Handy installieren.
2. In der Zeiterfassung **Profil** (Name oben rechts) → **🔐 Zwei-Faktor-Anmeldung** → **„Jetzt einrichten"**.
3. Mit der Authenticator-App den angezeigten **QR-Code scannen** (oder den Schlüssel abtippen).
4. Den 6-stelligen Code aus der App eingeben → **Einschalten**.
5. Für Admin/System-Verwaltung: einmal **ab- und wieder anmelden** – erst diese Anmeldung „mit Code"
   schaltet die geschützten Funktionen frei.

**Anmelden mit 2FA:** Name + Passwort wie gewohnt, danach den aktuellen Code aus der App eingeben.
Der Code wechselt alle 30 Sekunden – einfach den gerade angezeigten nehmen.

**Neues Handy?** Vorher im Profil unter **„Verwalten"** entfernen und auf dem neuen Handy neu einrichten.
**Handy verloren?** Den Administrator ansprechen: er setzt die Zwei-Faktor-Anmeldung im
Mitarbeiter-Dialog zurück (**„🔐 2FA zurücksetzen"**); danach gilt wieder nur das Passwort und du kannst
neu einrichten.

---

## 2. Rollen & Zugriffe – wer darf was

| Rolle | Sieht / darf … |
|---|---|
| **Mitarbeiter/in** | Eigene Zeiterfassung, eigene Abwesenheiten beantragen, Monat einreichen. |
| **Berater/in** | Wie Mitarbeiter/in. |
| **Freiberuflich** | Eigene Zeiten – **ohne Pausenabzug**, **ohne Genehmigungspflicht** bei Abwesenheiten. |
| **Leitung** | Zusätzlich: Team-Übersicht, Abwesenheiten genehmigen, Erinnerungen senden, an GF senden. |
| **Geschäftsführung** | Eingegangene Berichte aller Mitarbeitenden, Jahresberichte. |
| **Administrator** | Vollzugriff: Benutzer & Teams verwalten, Berechtigungen, alle Module. |

**Zugriffe pro Bereich:** Für jede Person legt der Administrator je Bereich (Zeiterfassung, CRM,
Projektmanagement, Kalender, Lager …) fest:
- **Kein** – Bereich ist nicht sichtbar.
- **Nutzen** – Bereich ansehen und normal damit arbeiten.
- **Verwaltend** – zusätzlich die Einstellungen des Bereichs ändern (z. B. im Kalender Termine
  anlegen, im Lager Artikel und Orte pflegen, im CRM Felder und Kategorien).
- **System-Verwaltung** – Stammdaten anderer Mitarbeitender pflegen, archivieren/wiederherstellen,
  Daten exportieren. **Rechte vergeben kann nur das Administrator-Konto.**

> Eine Person kann **mehreren Teams** zugeordnet sein. Die Leitung sieht standardmäßig **ihr(e) Team(s)**;
> eine Leitung **ohne Team** sieht alle (Admin-ähnlich).

---

## 3. Startseite & Navigation

**Startseite:** Nach dem Anmelden landest du auf deiner Startseite (sofern freigeschaltet) mit
Karten wie **Wetter & Wind**, **Stempeln**, **Was ansteht**, **Mitteilungen**, **Team** (Leitung/GF)
und **Kacheln** zu allen Bereichen. Mit **„Anordnen"** verschiebst oder versteckst du Karten;
⭐ merkt sich Favoriten. Welche Karten erscheinen, stellst du im **Profil** unter „Meine Startseite" ein.

**Menü ☰ (oben links):** Wechsel zwischen den Bereichen (Zeiterfassung, CRM, Projektmanagement,
Kalender, Lager, **Anleitung** …) – du siehst nur die Bereiche, für die du freigeschaltet bist.
Diese Anleitung findest du direkt in der App unter **☰ → Anleitung** bzw. als Kachel auf der Startseite
(mit Suchfeld; der Administrator kann sie pro Rolle oder Person ausblenden).

**Zurück-Taste & Links:** Die Zurück-Taste des Browsers/Handys springt zur vorherigen Ansicht in der App.
Jede Ansicht hat eine eigene Adresse – Neu laden behält den Ort, Links lassen sich teilen.

**Reiter in der Zeiterfassung (je nach Rolle sichtbar):**

- **Zeiterfassung** – dein Monatsblatt (Standardansicht).
- **Stempeln** – Ein-/Ausstempeln (am Handy eigener Reiter; am PC der Button **⏱ Stempeln** oben rechts).
- **Mitarbeiterübersicht** – nur Leitung/GF/Admin.
- **Eingegangene Berichte** – nur GF.
- **Abwesenheiten** – Urlaub/Krank beantragen & verwalten.
- **Vertretungen** – Vertretungsregelung bei Ausfall einer Team-Leitung (GF/Admin).

**Monat wechseln:** Mit den Pfeilen **◀ ▶** in der Zeiterfassung blätterst du durch die Monate.

---

## 4. Zeiten erfassen

Es gibt zwei Wege – beide schreiben in dasselbe Tagesfeld:

### A) Manuell eintippen
Pro Tag stehen Felder zur Verfügung:

- **Block 1:** „von" / „bis" (z. B. 08:00 – 12:00)
- **Block 2:** „von" / „bis" (z. B. 13:00 – 17:00) – für einen zweiten Abschnitt am selben Tag
- **Kleinteiliges:** Minuten für kurze Tätigkeiten ohne festen Block (z. B. ein Telefonat abends)
- **Zuordnung:** Kategorie wählen (siehe unten)
- **Bemerkung:** freier Text

**Tastatur:** Mit **Tab/Enter** und **Pfeiltasten** springst du von Feld zu Feld; die **Zuordnung**
lässt sich ebenfalls mit den Pfeiltasten auswählen.

### B) Stempeln (Kommen/Gehen in Echtzeit)
1. **▶ Einstempeln** – das System merkt sich die Startzeit; oben läuft ein Live-Zähler
   („Eingestempelt seit …").
2. **■ Ausstempeln & übertragen** – beim Ausstempeln wählst du die **Zuordnung**; die Zeit wird
   automatisch in den Tag übernommen.
3. **🗑 Stempel verwerfen** – laufenden Stempel abbrechen, ohne zu übertragen.

**Gut zu wissen:**
- Trägst du **manuell eine Startzeit** ein, während ein Stempel läuft, passt sich der Stempel an.
- Trägst du eine **Endzeit** ein, während du eingestempelt bist, **stoppt der Stempel automatisch**.
- **Mehrfach am Tag** ein-/ausstempeln ist möglich – das System bildet daraus die zwei größten
  zusammenhängenden Blöcke (Block 1 / Block 2), der Rest läuft als „Kleinteiliges".

### Zuordnung (Kategorien)
Jede Arbeitszeit wird einer **Kategorie** zugeordnet (z. B. *Akademie, Marketing, Besprechung,
Telefonate, Veranstaltung* …). Welche Kategorien angeboten werden, hängt vom **Team** ab.

> **Leitung:** Du siehst **alle** Kategorien; die deinem Team zugeordneten sind **farblich markiert**.

---

## 5. Pausen, Nachtschicht, Zeitumstellung & Rundung

**Pausen werden automatisch berücksichtigt** – du musst nichts manuell abziehen:

- ab **6 Std.** Arbeitszeit → **30 Min.** Pause
- ab **9 Std.** Arbeitszeit → **45 Min.** Pause

So wird gerechnet (einheitlich im ganzen System): Die Pause wird auf die **Abfahrtszeit
aufgeschlagen** und in der **Gesamtsumme wieder abgezogen** – deine tatsächliche (Netto-)Arbeitszeit
bleibt dadurch korrekt. Hast du selbst eine längere Pause zwischen Block 1 und Block 2 gemacht,
wird diese angerechnet.

- **Freiberufler/innen:** **keinerlei** Pausenfunktion – Zeiten werden 1:1 übernommen.

**Rundung beim Ausstempeln:** Die gestempelte Zeit wird auf gängige Schritte gerundet; danach wird
(wie oben) die Pause aufgeschlagen. Das ist bewusst identisch zur manuellen Erfassung.

**Nachtschicht über Mitternacht:** Arbeitest du z. B. **22:00–02:00**, erkennt das System den
Vortag (… – 23:59) und den Folgetag (00:00 – …) automatisch als **eine** Schicht und ordnet die
Pause korrekt zu. Du musst dafür nichts Besonderes tun.

**Sommer-/Winterzeit:** In der Nacht der Zeitumstellung (letzter Sonntag im **März** bzw. **Oktober**)
rechnet das System automatisch richtig: Ein Zeitblock, der die Zeit **2–3 Uhr** ganz überspannt, zählt im
Oktober **1 Std. mehr** (die Stunde gibt es doppelt) und im März **1 Std. weniger**. In der Zeile steht
dann der Hinweis „+1 h" bzw. „−1 h Zeitumstellung".

---

## 6. Die Kennzahlen oben

Über dem Monatsblatt zeigen Kacheln deine Werte:

- **SOLL-Stunden** – wie viel du in dem Monat leisten solltest.
- **IST-Stunden** – was tatsächlich erfasst wurde.
- **Urlaub genutzt** – Urlaubstage **in diesem Monat**.
- **Resturlaub** – verbleibende Tage, z. B. *„6 von 30"* (genommen bis einschließlich aktuellem Monat;
  zukünftig genehmigter Urlaub zählt erst in seinem Monat).
  **Im Januar** wird nicht genommener Urlaub des Vorjahres mitgezählt (z. B. *„31 T – 30 T 2027 +
  1 T aus 2026"*). Urlaub im Januar wird **zuerst vom Vorjahresrest** abgezogen; was Ende Januar übrig ist,
  verfällt. (Gilt ab dem Jahreswechsel 2026/2027.)
- **Übertrag → nächster Monat** – Plus-/Minusstunden, die mitgenommen werden.
- Bei Rollen mit **Monatslimit** (z. B. Werkstudierende/Honorarkräfte): **„Abgerechnet (Limit …)"**
  und der Übertrag des überschüssigen Anteils.

---

## 7. Monat einreichen

Wenn alle Zeiten des Monats erfasst sind:

1. Unten auf **„📨 Monat einreichen"** klicken und bestätigen.
2. Status wechselt auf **„eingereicht – wartet auf Prüfung durch die Leitung"**.
   Solange läuft, sind keine Änderungen möglich.
3. **↩ Zurückziehen** holt einen eingereichten Monat zurück (solange noch nicht geprüft).
4. Nach Prüfung:
   - **✓ Genehmigt** – fertig.
   - **✗ Abgelehnt** – mit Anmerkung der Leitung; **korrigieren und erneut einreichen**.

> **Erinnerung:** Reicht jemand bis zum Monatswechsel nicht ein, kann die **Leitung** eine
> **Erinnerungs-Mail** verschicken (siehe Abschnitt 9).

---

## 8. Abwesenheiten (Urlaub, Krank …)

Reiter **Abwesenheiten** → **„Abwesenheit eintragen"**.

**Arten:** Urlaub · AU/Krank · Arbeitszeitausgleich · Sonstiges.

### Urlaub beantragen
- Zeitraum **von – bis** wählen.
- **Halber Urlaubstag** möglich (z. B. 4 Std. bei einem 8-Std.-Tag) – bei eintägigem Urlaub.
- **Urlaubstage berechnen:** wahlweise nach **Wochenarbeitszeit** (automatisch) oder **manuell**
  (Anzahl Tage). Maximal 5 Urlaubstage pro Kalenderwoche.
- **„📨 Antrag einreichen"** → der Antrag geht an die Leitung **zur Genehmigung**.
- Anträge über **eine Woche** brauchen eine kurze **Begründung**.

### Krankmeldung (AU/Krank)
Wird **sofort als aktiv** eingetragen – **kein** Genehmigungsschritt.

### Was passiert nach der Genehmigung?
Die **Zeiterfassung wird automatisch befüllt**:

- **Festangestellte:** Urlaub und AU/Krank erzeugen **Stunden + Zuordnung** (anteilig nach
  Wochenarbeitszeit/Arbeitstagen).
- **Freiberufler/innen** sowie **Arbeitszeitausgleich:** **nur eine Bemerkung**, keine Zeitgutschrift.
- **Sonstiges:** normalerweise **nur eine Bemerkung**. Mit dem Häkchen **„Arbeitszeit gutschreiben"**
  (z. B. **Bildungsurlaub**) wird die **reine Tagesarbeitszeit** eingetragen – ohne Pausenabzug und ohne
  Rundung, wie bei Krankheit. Solche Anträge muss immer die **Leitung oder Geschäftsführung** genehmigen.

### Urlaub direkt in der Zeiterfassung
Trägst du Urlaub bzw. AU/Krank **direkt im Monatsblatt** ein, erscheint das **automatisch unter
Abwesenheiten**. **Mehrere aufeinanderfolgende Tage** werden als **ein zusammenhängender Zeitraum**
erkannt.

### Zurückziehen / Stornieren
- Offener Antrag → **„🗑 Antrag zurückziehen"**.
- Genehmigte Abwesenheit / Krankmeldung → **„🗑 Abwesenheit stornieren"**.
  Dabei werden die zugehörigen **Einträge in der Zeiterfassung wieder entfernt**.

---

## 9. Weitere Bereiche: CRM, Projekte, Kalender, Lager

Welche Bereiche du siehst, hängt von deinen Zugriffen ab (siehe Abschnitt 2).

- **CRM (Kontakte):** Vereine, Sozialakteure, Förderer usw. mit Kontaktpersonen, Notizen, Aufgaben und
  Terminen. Suche oben in der Leiste, 🔔 zeigt Änderungen anderer.
  Jeder Kontakt hat eine oder mehrere **Kategorien** (z. B. Vereine, Sozialakteure, Segelverband,
  Intern) – alle gleichrangig. Pflichtangaben beim Anlegen: Name, Adresse oder Sitz sowie E-Mail oder Telefon.
  Kategorien können **eigene Zusatzfelder** haben (Verwaltung → CRM → Kategorie ✎), z. B. bei Fundraising
  „Antragsfrist“; sie erscheinen beim Kontakt als eigener Block, sobald die Kategorie angehakt ist.
- **Projektmanagement:** Team-Boards mit Aufgaben (offen / in Arbeit / erledigt) und Veranstaltungen.
- **Kalender:** Veranstaltungen und Termine neben den Abwesenheiten aller Mitarbeitenden – Konflikte
  auf einen Blick. **Nutzen** = ansehen, **Verwaltend** = Termine und Veranstaltungen anlegen.
  Ausführlich: [Kalender & Abo](#kalender--abo-in-outlook--am-handy).
- **Lager:** **Bestand** (Flaggen, Flyer, Bootsmaterial … je Ort), **Bestellungen** melden,
  **Ausleihen** verwalten, **Fällig**-Liste (Prüftermine). Bestellen und Ausleihen dürfen alle mit
  „Nutzen"; Artikel, Orte und Buchungen pflegen nur „Verwaltend".
- **Verteiler:** gespeicherte E-Mail- und Adresslisten (z. B. für Serienbriefe).
- **Messemodus:** Besucher tragen sich am Tablet selbst ein (Vollbild, nur das leere Formular sichtbar).
  Veranstaltungen und erfasste Kontakte gelten für **alle Messe-Geräte gemeinsam** – mehrere Tablets am Stand
  sehen dieselbe Liste. **Ohne Netz** wird auf dem Gerät zwischengespeichert und automatisch nachgeschickt,
  sobald wieder Netz da ist (oben steht „📴 offline · x wartet auf Netz“). Dafür muss man auf dem Gerät vorher
  einmal angemeldet gewesen sein („Angemeldet bleiben“). Das Personal öffnet mit der **PIN der Veranstaltung**
  (gilt auf allen Geräten) die Liste und **überträgt ins CRM** – danach werden die Besucherdaten im Messemodus gelöscht
  und stehen nur noch im CRM. Freigabe: Verwaltung → Mitarbeiter → Zugriffe → Messemodus „Nutzen“.

### Kalender & Abo in Outlook / am Handy

**Ansichten** (Reiter oben): **Liste** (am Handy Standard), **Woche**, **Monat**, **Jahr** und
**Konflikte** (Termine, bei denen zugewiesene Personen abwesend sind). Über die Auswahl daneben
filterst du nach **Team** oder **„👤 Nur ich"** – dann sind deine eigenen Termine hervorgehoben.

**Was steht drin?**
- **Veranstaltungen und Termine** aus dem CRM – jede mit eigener **Farbe** (beim Anlegen wählbar).
- **Abwesenheiten** aller Mitarbeitenden, einheitlich als **„Abwesend"** (blau) – der Grund
  (Urlaub, Ausgleich …) wird nicht angezeigt. Krankmeldungen erscheinen im Kalender gar nicht.
- Hat eine Person mehrere Termine am Tag oder Termin und Abwesenheit gleichzeitig, stehen sie
  **untereinander** in ihrer Zeile.
- Mehrtägige Einträge zeigen in der Liste **„↳ Tag x/y"**; ab einer Woche Dauer nur noch montags,
  damit die Liste übersichtlich bleibt.

**Anlegen** (nur mit Zugriff „Verwaltend"): **＋ Neu** → Termin oder Veranstaltung. Das Fenster gleitet
von rechts herein und bleibt offen, bis du **Speichern** oder **✕** klickst. CRM-Kontakte und
Mitarbeitende wählst du über die **Suchfelder** (tippen, mit ↑/↓ und Enter auswählen). Ein Termin
braucht mindestens einen CRM-Kontakt.

**📲 Kalender-Abo – Termine in Outlook, Google oder am Handy:**
Im Kalender oben **„📲 In Outlook / Handy"** (oder **Profil → 📲 Kalender-Abo einrichten**) →
**„Abo-Link erstellen"**. Du bekommst zwei persönliche Links:

1. **Meine Termine** – alle Termine und Veranstaltungen, denen **du zugewiesen** bist.
2. **Weitere Termine der Stiftung** (optional) – alle übrigen, ohne deine eigenen.

Beide getrennt abonnieren und in Outlook **unterschiedliche Farben** geben (z. B. „TPS" kräftig,
„TPS – weitere" grau) – Outlook färbt pro Kalender, nicht pro Termin.

**So abonnieren:** Link mit **📋 Kopieren** übernehmen, dann …
- **Outlook (Web / neues Outlook):** Kalender → **„Kalender hinzufügen"** → **„Aus dem Internet
  abonnieren"** → Link einfügen → Namen vergeben (z. B. „TPS").
- **Outlook (klassisch, Windows):** Kalender → **„Kalender öffnen"/„Kalender hinzufügen"** →
  **„Aus dem Internet …"** → Link einfügen.
- **Google Kalender:** „Weitere Kalender" **＋** → **„Per URL"** → Link einfügen.
- **iPhone/iPad:** im Abo-Fenster den Link **antippen** oder Einstellungen → Kalender → Accounts →
  Account hinzufügen → Andere → **Kalenderabo**.

**Gut zu wissen:**
- Neue und geänderte Termine kommen **automatisch** dazu – Outlook aktualisiert allerdings nur
  **alle paar Stunden**, nicht sofort.
- Das Abo geht **nur in eine Richtung**: Änderungen bitte in der App machen, nicht in Outlook.
- Der Link ist **persönlich und geheim** – wer ihn kennt, sieht deine Termine. Bei Verdacht im
  Abo-Fenster **„🔄 Neuen Link erzeugen"** (der alte funktioniert dann nicht mehr; im Kalender neu
  abonnieren) oder **„Abo beenden"**.

---

## 10. Für Leitung & Geschäftsführung

### Mitarbeiterübersicht (Leitung & Admin)
- Karten je Mitarbeiter/in mit IST-Stunden, Resturlaub usw.
- Karte anklicken → **Monat dieser Person öffnen** (sobald eingereicht).
- **„📨 An GF senden"** – die Zeiterfassungen des Teams für den Monat in der **Buchhaltungsversion**
  gebündelt an die Geschäftsführung senden.
- **„🔔 Erinnerungen senden"** – schickt allen, die **noch nicht eingereicht** haben, eine
  **Erinnerungs-Mail** (nur an Personen mit hinterlegter E-Mail).

### Abwesenheiten genehmigen
Unter **Abwesenheiten** stehen offene Anträge mit **„✓ Genehmigen"** / **Ablehnen**.
Beim Genehmigen wird die Zeiterfassung der betreffenden Tage automatisch befüllt.

### Eingegangene Berichte (GF)
Übersicht aller eingereichten Monats- und **Jahresberichte**; pro Person als **PDF herunterladbar**
oder als Jahresmappe.

### Buchhaltungsversion / PDF
Im Jahres-/Monatsbericht: **„⬇ PDF herunterladen"** für die Buchhaltung. Der **Resturlaub** ist in
der Buchhaltungsversion enthalten.

---

## 11. Für Administratoren & System-Verwaltung

Menü ☰ → **Verwaltung**:

- **Benutzer anlegen/bearbeiten:** Name, Rolle(n), Team(s), E-Mail, **Wochenarbeitszeit**,
  **Jahresurlaub**, **Stunden pro Urlaubstag**, Vortrag (Plus/Minus) usw.
- **Arbeitstage pro Woche** je Person (beeinflusst Urlaubs- & Krankheitsstunden).
- **Feiertagsregel:** je Person festlegen, ob **Feiertage wie ein Sonntag** gelten
  (kein SOLL / kein Urlaubsabzug) oder nicht.
- **Team-Geschichte:** Teamwechsel mit Datum hinterlegen – vergangene Monate bleiben dadurch dem
  **richtigen Team** zugeordnet. Admin kann die Historie einsehen und ändern.
- **Berechtigungen:** je Rolle steuern, wer welche Buttons/Funktionen sieht
  (z. B. „An GF senden", „Erinnerungen senden", Abwesenheiten genehmigen, Zeitstempel nutzen).
- **Rolle** (oben unter „Rolle & Zugehörigkeit“): bestimmt neben Leitung/GF/Freiberuflich auch die **Standard-Rechte**.
  Welche Vorlage zu welcher Rolle gehört, steht unter Verwaltung → **Standard-Rechte je Rolle** (Zeile „Vorlage“).
- **Zugriffe pro Person:** Jedes Modul hat einen Kasten mit **Kein / Nutzen / Verwaltend** und darunter den
  **Feinrechten** als Häkchen (z. B. „Kontakte löschen“, „Termine löschen: eigene/alle“, „Kontakte ansehen: nur
  bestimmte Kategorien“). **Kein** schaltet das Modul ganz ab, **Nutzen** setzt die Häkchen der Rolle, **Verwaltend**
  alle. Weichen einzelne Häkchen ab, steht dort **„Angepasst“**. Neue Personen starten mit allen Modulen auf „Kein“;
  die Häkchen sind nach der Rolle schon vorbelegt und gelten, sobald das Modul eingeschaltet wird. Wird die Rolle
  einer Person geändert, fragt die App, ob die Häkchen angepasst werden sollen. Knöpfe „Füllen: wie Rolle /
  Verein (extern) / alles / nichts“ setzen alle Module auf einmal.
  Nach dem Ändern einmal die App als Administrator neu öffnen – dann werden die Freigaben für den Server neu berechnet.
- **🔑 Einmal-Passwort:** bei vergessenem Passwort; offene Anfragen erscheinen unter „Mitarbeiter".
- **Archivieren (✕):** Person verlässt die Stiftung → Zugang wird sofort gesperrt, die Zeitdaten bleiben
  erhalten. Unter „Archivierte Mitarbeiter" wiederherstellbar.
- **Daten & Backup:** automatische Tages-Backups, Export/Import.

**System-Verwaltung** (vom Administrator vergebenes Recht): Reiter **Mitarbeiter**, **CRM** und
**💾 Export**. Stammdaten anderer Personen pflegen (Arbeitszeit, Urlaub, Teams, Eintritt/Austritt …),
archivieren/wiederherstellen und Daten exportieren (ohne Passwörter). Name, Login, Rolle und Zugriffe
ändert nur der Administrator; die eigenen Stammdaten ebenfalls.

### E-Mail-Versand (EmailJS)
Erinnerungen laufen über **EmailJS**. Die Schlüssel sind in `js/config.js`
hinterlegt. Vorlagen verwalten: **https://dashboard.emailjs.com/admin/templates**.
Verwendete Platzhalter in den Vorlagen: `{{to_name}}`, `{{to_email}}`, `{{monat}}`, `{{app_url}}`
(beim Reset zusätzlich der Reset-Link).

---

## 12. Mein Profil: Darstellung, Startseite, Sicherungen

Klick auf deinen **Namen** oben rechts öffnet dein Profil:

- **Kontaktdaten:** E-Mail, Wohnort (für die Wetter-Karte), Bundesland (Feiertage).
- **Meine Startseite:** welche Karten du sehen möchtest.
- **🌓 Darstellung:** **Automatisch** (folgt Hell/Dunkel des Geräts), **Hell** oder **Dunkel**.
  Gilt für das jeweilige Gerät.
- **🔒 Passwort ändern.**
- **🔐 Zwei-Faktor-Anmeldung** (freiwillig, für Admin und System-Verwaltung Pflicht) – Einrichten und
  Handy-Wechsel siehe [Abschnitt 1](#zwei-faktor-anmeldung-2fa). In der Mitarbeiterliste zeigt **🔐 2FA**,
  wer sie eingeschaltet hat.
- **📲 Kalender-Abo einrichten:** eigene Termine in Outlook / am Handy, siehe
  [Kalender & Abo](#kalender--abo-in-outlook--am-handy).
- **Eigene Sicherung:** **„⬇ Backup herunterladen"** sichert deine Zeiterfassung als Datei,
  **„⬆ Backup wiederherstellen"** spielt sie wieder ein (fehlende Tage werden ergänzt, nichts geht
  verloren). Optional legt die App **am 10. jeden Monats** automatisch einen Schnappschuss in der Cloud ab.
- **🔄 App aktualisieren:** holt sofort die neueste Version.

---

## 13. App installieren (Handy/Tablet)

Die Zeiterfassung ist eine **PWA** und lässt sich wie eine App installieren:

- **iPhone/iPad (Safari):** Teilen-Symbol → **„Zum Home-Bildschirm"**.
- **Android (Chrome):** Menü → **„App installieren"** / **„Zum Startbildschirm hinzufügen"**.
- **Android-APK:** Über den **Download-Link** in der App.

**iOS-Hinweise:** Die Darstellung ist für iPhone/iPad optimiert (Kalender, Leisten, Buttons).
Beim Tippen in Felder zoomt Safari nicht mehr ungewollt hinein.

---

## 14. Häufige Fragen

**Die Seite lädt nicht / zeigt alte Inhalte.**
Einmal **vollständig neu laden** (am PC: `Strg`+`Umschalt`+`R`). Die App holt sich beim Laden immer
die aktuelle Version; nach einem Update aktualisieren sich offene Fenster automatisch.

**Meine Pause stimmt nicht.**
Prüfe deine **Block-Zeiten**. Ab 6 Std. werden 30 Min., ab 9 Std. 45 Min. berücksichtigt – die
**Gesamtsumme** ist dein Nettowert. Freiberufler/innen haben **keinen** Pausenabzug.

**Resturlaub sieht zu niedrig aus.**
Es zählt der genommene Urlaub **bis einschließlich aktuellem Monat**. **Zukünftig** genehmigter
Urlaub wird erst **in seinem Monat** abgezogen.

**Ich kann den Monat nicht mehr ändern.**
Er ist vermutlich **eingereicht**. Mit **„↩ Zurückziehen"** wieder öffnen (solange nicht geprüft).

**Ich habe mein Passwort vergessen.**
Auf der Anmeldeseite **„Passwort vergessen?"** – der Administrator gibt dir ein Einmal-Passwort.

**Der Zwei-Faktor-Code wird nicht angenommen.**
Den **gerade angezeigten** Code nehmen (er wechselt alle 30 Sekunden). Prüfen, ob Uhrzeit und Datum
am Handy automatisch gestellt sind. Handy weg oder gewechselt? Administrator setzt 2FA zurück.

**Ein Termin fehlt in Outlook.**
Outlook holt Abo-Kalender nur **alle paar Stunden** neu – etwas Geduld. In „Meine Termine" stehen nur
Termine, denen du **zugewiesen** bist; alle anderen stehen im zweiten Abo „Weitere Termine".

**Keine Erinnerungs-Mail erhalten.**
Ist eine **E-Mail-Adresse** hinterlegt? **Spam-Ordner** prüfen. Sonst Admin informieren.

**Die App ist plötzlich dunkel bzw. hell.**
Unter **Profil → Darstellung** auf **Hell**, **Dunkel** oder **Automatisch** stellen.

**Im Januar steht beim Resturlaub „+ X T aus dem Vorjahr".**
Das ist nicht genommener Urlaub des Vorjahres – nur im Januar nutzbar, danach verfällt er.

**In der Nacht der Zeitumstellung stimmt meine Stundenzahl nicht?**
Doch – das System rechnet die doppelte bzw. ausgefallene Stunde automatisch ein (siehe Abschnitt 5).

**Ich habe über Mitternacht gearbeitet.**
Einfach normal erfassen/stempeln – das System erkennt die **Nachtschicht** und rechnet die Pause
korrekt zu.

---

*Bei Fragen oder Fehlern bitte an die Leitung oder den Administrator wenden.*
