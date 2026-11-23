# Neue Admin-Oberfläche (Arbeitspaket 7) – Plan

> Stand: 2026-11-23 · 7a und 7b umgesetzt, 7c–7e offen. Rahmen: `ARCHITEKTUR.md`

## Umgesetzt in 7b

| Was | Wo |
|---|---|
| Angular-Verwaltung (Angular 22, Standalone-Komponenten, Signals, ohne zone.js), von app unter `/admin/` ausgeliefert, strenge CSP | `box/apps/admin`, `box/apps/app/src/admin-ui.ts` |
| Seiten: Anmeldung (Ziffernblock), Übersicht, Druckkontingent, Event (Vorgaben + Änderungen an der Box zurücknehmen), Einstellungen je Bereich (aus dem Katalog erzeugt), Zugang (Protokoll, nur Admin), Wartung (Abgleich + Werkzeuge der alten Oberfläche) | `box/apps/admin/src/app/pages` |
| Prüfung im Browser mit derselben Funktion wie im Server; Antwort-Typen gemeinsam in `contracts` (`admin-api.ts`) | `box/packages/contracts` |
| Kiosk: 5× in die Ecke tippen (3 s) → PIN-Eingabe; im Kiosk 2 min Leerlauf → zurück zur Fotobox | `template/components/start.adminshortcut.php`, `assets/js/adminshortcut.js`, `core/session.ts` |
| Alte Verwaltung unter `/admin-alt/` (nur mit PIN), `/login/` leitet zur neuen Anmeldung | `deploy/apache/snaphora-app.conf` |
| Design-Grundwerte als CSS-Variablen (Farben, Abstände, Mindestgröße 48 px für Touch) – übernimmt die Gäste-Oberfläche in Paket 9 | `box/apps/admin/src/styles.css` |
| Tests: 17 Komponententests (Vitest), Playwright mit axe auf jeder Seite, Handy-Breite, Geste | `box/apps/admin/src/**/*.spec.ts`, `tests/e2e/specs/verwaltung.spec.mjs` |

**Noch in der alten Oberfläche** (verlinkt unter Wartung, nur mit PIN): alle übrigen Einstellungen, Upload von
Bildern/Schriften, Layout-Generator, Protokolle, Speicherbelegung, Testseiten. Galerie verwalten bleibt bis Paket 9
in PHP, weil die Bild-Datenbank dort liegt.

## Umgesetzt in 7a

| Was | Wo |
|---|---|
| Workspace `box/` mit `platform`, `contracts`, `app`, `render`, `agent`; ein Dockerfile, ein Ziel pro Dienst | `box/`, `box/Dockerfile` |
| Einstellungskatalog (34 Einstellungen, Prüfung, Rollen) – Standardwerte gegen PHP getestet | `box/packages/contracts/src/settings.ts` |
| Ebenen-Format und Zusammenführung, geschützte Bereiche (Shell-Befehle) | `box/packages/contracts/src/layers.ts` |
| app: `config` (lesen, speichern mit Aufteilung, Sicherung), `access` (PIN, Sperre, Sitzungen, Protokoll, globaler Guard), `print` (Kontingent), `status` | `box/apps/app/src` |
| Schnittstelle `/api/v1/` über Apache, gleicher Ursprung | `deploy/apache/snaphora-app.conf` |
| PINs vom Server (Vertrag v0.2 `staff`), Agent schreibt nur Hashes nach `config/access/staff.json` | `contracts/device-api.yaml`, `box/apps/agent/src/config-sync.ts` |
| Not-PIN auf der Box als Secret-Datei, `sudo snaphora-set-pin` | `deploy/box/compose.yml`, `deploy/box/host/files/usr/local/bin/snaphora-set-pin` |
| PHP: `box.json` statt `my.config.inc.php` (einmalige Migration), Befehle nur aus Image/Provisionierung | `src/Service/ConfigurationService.php` |
| PHP: alte Verwaltung, Testseiten, Wartungs-Schnittstellen nur mit PIN-Sitzung von app (schlägt im Zweifel zu) | `src/Service/AppAccessService.php`, `lib/boot.php` |
| Druck gesperrt, sobald Kontingent erreicht; kein Entsperren durch Gäste, `printLimit.php` entfernt | `src/Service/PrintManagerService.php`, `api/print.php` |
| Alte Anmeldung (Benutzername/Passwort, Admin-/Vermiet-PIN) entfernt; Übergangs-Anmeldeseite mit Ziffernblock | `login/` |

**Übergang (bewusst, mit Enddatum):** Die alte PHP-Verwaltung schreibt bis 7e noch `box.json`. Die Anmeldeseite
`login/` ist ein Provisorium bis zur Angular-Oberfläche (7b). Der Event-Wechsel (Archiv) bleibt bis Paket 9 in PHP,
weil PHP dort noch die Bild-Datenbank besitzt.

**Noch offen, gefunden in 7a:** Der Fernauslöser-Dienst (remotebuzzer) bietet im lokalen Netz Neustart und
Herunterfahren ohne Anmeldung an → 7c (Geräte-Modul).

## Ziel

Die alte PHP-Administration verschwindet vollständig. Die neue Oberfläche übernimmt alles, was zum Betrieb
der Box nötig ist. Jede Verwaltungsfunktion der Box liegt dann **an genau einer Stelle** und ist **nur mit
persönlicher PIN** erreichbar. Was die Gäste nutzen (Aufnahme, Galerie, Druck, Diashow), bleibt bis Paket 9 in PHP.

## Befund: Was heute alles „Admin“ ist

Die Verwaltung ist heute über das ganze Programm verteilt und überwiegend **ungeschützt**:
`login.enabled` steht standardmäßig auf `false`, und viele Schnittstellen prüfen gar nicht.

| Heute | Wo | Geschützt? | Künftig |
|---|---|---|---|
| Einstellungen (41 Bereiche, ~470 Werte) | `admin/`, `api/admin.php` | nur mit Login | neue Oberfläche, nur nötige Werte (siehe unten) |
| Zurücksetzen (Fotos, Druck-DB, Einstellungen) | `api/admin.php?reset` | nur mit Login | **Wartung**, ersetzt durch „Event archivieren“ |
| Druckkontingent erhöhen | `api/printLimit.php` | **nein** | **Druck** |
| Drucksperre aufheben | `api/printDB.php` | teilweise | **Druck** |
| Foto löschen | `api/deletePhoto.php` (aus der Gäste-Galerie) | **nein** | **Galerie**, nur mit PIN |
| Bild-Datenbank neu aufbauen | `api/rebuildImageDB.php` | **nein** | **Wartung** |
| Neustart / Herunterfahren | `api/shellCommand.php` | ja | **Wartung**, über den Host statt Shell-Befehl aus der Config |
| Bilder/Schriften hochladen | `admin/upload` | nur mit Login | **Gestaltung**, Prüfung von Typ und Größe |
| Collage-Layouts bauen | `admin/generator` | nur mit Login | **Gestaltung** (vereinfacht: Vorlagen + Vorschau) |
| Logs, Speicherplatz, Server-Info | `admin/debug`, `admin/diskusage`, `api/serverInfo.php` | nur mit Login / **nein** | **Status** und **Wartung** |
| Testseiten (Foto, Collage, Vorschau, Textpositionen, phpinfo) | `test/` | **nein** | **Selbsttest**; `phpinfo` entfällt |
| Update-Prüfung gegen GitHub | `api/checkVersion.php` | **nein** | entfällt (Updates kommen in Paket 8 vom Server) |
| FTP-Test | `api/testFtpConnection.php` | **nein** | entfällt mit FTP |
| Login, PIN-Tastatur, Menü | `login/`, `AdminKeypad` | – | ersetzt durch PIN-Anmeldung |
| Handbuch, FAQ, Willkommensseite | `manual/`, `faq/`, `welcome/` | – | entfällt (Doku des Originalprojekts) |
| Admin-Kürzel auf der Startseite | `start.adminshortcut.php` | – | versteckte Geste |
| Ganze Konfiguration im Browser | `api/settings.php` (für die Gäste-Oberfläche) | Passwörter maskiert | nur noch, was die Gäste-Oberfläche braucht |

**Sicherheitsproblem nebenbei:** Die Einstellungen enthalten Shell-Befehle (`commands.print`,
`take_picture`, `pre_photo`, …), die die App ausführt. Wer Einstellungen speichern darf, kann damit
beliebige Befehle auf der Box ausführen. Künftig sind diese Befehle **fest im Image** und nicht mehr
einstellbar.

## Aufbau

```
Kiosk-Browser / Handy / Laptop
        │  https://box/admin/…  (gleiche Adresse wie die Gäste-Oberfläche)
        ▼
photobooth (Apache) ──Proxy /admin, /api/v1────►  app  (NestJS – der Kern, siehe ARCHITEKTUR.md)
   Gäste-Oberfläche (PHP, bis Paket 9)              • liefert die Angular-App aus
   liest Einstellungs-Ebenen                        • PIN-Anmeldung, Sitzungen, Protokoll
                                                    • Einstellungen lesen/prüfen/schreiben
                                                    • Selbsttest, Checkliste, Wartung
agent  ◄── lokale Schnittstelle ──────────────────  • Status, „jetzt abgleichen“, PINs vom Server
```

- **`app` ist kein Zusatzdienst, sondern die neue Anwendung** (Dienst `app` aus dem Konzept, Abschnitt 3). Paket 7
  legt ihren Grundstein mit den Modulen `config`, `access`, `print`, `status`, `maintenance`, `selftest`.
  In Paket 9 kommen Aufnahme, Galerie und Gäste-Oberfläche dazu, dann entfällt PHP komplett.
- **Angular-App** in `box/apps/admin` (Angular 19 wie das Management-Frontend, Standalone-Komponenten, Signals).
  Für Touchscreen, Handy und Laptop gebaut. Später teilt sie sich das Design-System mit der Gäste-Oberfläche.
- **Gleiche Adresse:** Apache leitet `/admin` an app weiter. Dann gibt es nur einen Ursprung, Cookies
  funktionieren ohne CORS, und der Kiosk braucht keine zweite Adresse.

## Einstellungen

- **Box-Einstellungen als JSON:** `config/my.config.inc.php` wird zu `config/layers/box.json` (Ebene 3).
  Beim ersten Start wird einmalig migriert, mit Sicherung. PHP liest die Datei nur noch, schreiben tut nur app.
  Damit bleibt eine einzige schreibende Stelle, atomar geschrieben wie die anderen Ebenen.
- **Ein Einstellungskatalog** (`box/packages/contracts` (siehe `ARCHITEKTUR.md`)) beschreibt jede Einstellung, die die Oberfläche
  anbietet: Typ, Grenzen, Bereich, Beschriftung und ob das Event sie steuert. Aus dem Katalog kommen
  die Prüfung in app, die Formulare in Angular und die Aufteilung beim Speichern
  (Event-gesteuert → `local-event.json`, sonst → `box.json`). Der Agent nutzt dieselbe Liste.
  Das ersetzt die Pfadliste, die heute in PHP steht.
- **Nur, was gebraucht wird:** Die Oberfläche zeigt die Werte, die den Betrieb betreffen (Schätzung: 60–80).
  Der Rest (Icons, Animationen, interne Pfade, Funktionen ohne Nutzen) wird zu festen Standardwerten im Image.
  Wird später doch etwas gebraucht, kommt es als neuer Eintrag in den Katalog.

### Bereiche der Oberfläche

| Bereich | Inhalt |
|---|---|
| **Übersicht** | aktives Event, Fotos/Drucke/Kontingent, Uploads, Netz, Speicher, Kamera, Drucker, Agent – mit Ampel |
| **Event** | Vorgaben vom Server (nur lesen), lokale Ausnahmen mit „zurücksetzen“, „jetzt abgleichen“ |
| **Druck** | Kontingent erhöhen, Sperre aufheben, Drucker und Restmedium DS620, Testdruck, Druck an/aus |
| **Gestaltung** | Looks (Farbtabellen) hochladen und wählen, Rahmen, Hintergrund, Logo, Collage- und 2x6-Streifen-Layouts mit Vorschau, Texte, Schriften, Farben, Uploads |
| **Aufnahme** | Countdown, Live-Vorschau, Kamera-Testbild, Kameraeinstellungen (ISO, Blende, Zeit, Weißabgleich), Collage und „Custom“-Aufnahme an/aus, Löschen am Kiosk an/aus |
| **Geräte** | Ringlicht (Adresse, Test), Buzzer-Tasten (per Tastendruck anlernen), Fernauslöser/GPIO, USB-Stick-Sync, Bildschirmschoner, Diashow |
| **Galerie** | Fotos ansehen und löschen, QR-Code, Upload-Stand je Foto (hochgeladen, wartet, fehlgeschlagen) |
| **Selbsttest & Checkliste** | Kamera, Testfoto, Drucker + Medium, Ringlicht, Buzzer, Netz/LTE, Profil geladen; Checkliste fürs Paket; Ergebnis mit Person und Zeit an den Server |
| **Wartung** | Event abschließen (prüft „alle Fotos hochgeladen“), Event archivieren, Bild-Datenbank neu aufbauen, Profil neu laden, Logs, Speicherplatz, Dienste neu starten, Neustart |
| **Zugang** | wer angemeldet ist, Protokoll der Zugriffe |

## Anmeldung mit PIN (Konzept 4.5)

- **Persönliche PINs** kommen vom Server mit der Geräte-Konfiguration (`device.staff`: Person, Rolle,
  PIN-Hash). Lokal liegt nur der Hash (scrypt, mit Salt). Der Vertrag wird dafür erweitert.
- **Not-PIN** für den Fall ohne Server, nie verbunden oder kaputt: wird bei der Provisionierung gesetzt und
  liegt nur als Hash in `/etc/snaphora/box.env`.
- **Sperre:** nach 5 Fehlversuchen 1 min, dann wachsend bis 15 min. Gilt pro Box, nicht pro Browser,
  damit niemand sie durch Neuladen umgeht.
- **Sitzung:** Cookie `HttpOnly`, `SameSite=Strict`, im Kiosk 2 min Leerlauf, sonst 15 min. Danach zurück zur Gäste-Oberfläche.
- **Protokoll:** Jede Anmeldung und jede Änderung wird mit Person und Zeit gespeichert und an den Server
  gemeldet (Status-Meldung, Paket 8 dann vollständig).
- **Rollen** (vorerst zwei): *Aufbau* (Übersicht, Druck, Selbsttest, Checkliste, Galerie) und
  *Admin* (alles). Admin-PINs kommen mit der Geräte-Konfiguration. Aufbau-PINs kommen mit dem Event und gelten
  nur für die Mitarbeitenden, die der Buchung zugewiesen sind, und nur im Zeitfenster des Events (Konzept 5).
- **Von außen** (Laptop über WireGuard) gilt dieselbe Anmeldung. Ohne WireGuard ist `/admin` aus dem Internet nicht erreichbar.
- **Versteckte Geste am Touchscreen:** 5× oben links tippen, innerhalb von 3 s. Dann erscheint der Ziffernblock.
  Am Handy oder Laptop einfach `/admin` öffnen.

## Abschalten der alten Oberfläche

- `admin/`, `login/`, `test/`, `manual/`, `faq/`, `welcome/` und die Verwaltungs-Endpunkte unter `api/` werden
  **gelöscht**, nicht nur gesperrt. Was nicht da ist, kann nicht angegriffen werden.
- Die Gäste-Oberfläche ruft nur noch Gäste-Endpunkte auf. `deletePhoto.php` und `printLimit.php` gibt es dann nicht mehr.
- Ein Test prüft, dass alle alten Adressen 404 liefern.

## Barrierefreiheit

- Bedienelemente mindestens 48 × 48 px groß (Finger am Touchscreen, auch mit Handschuh beim Aufbau).
- Alles per Tastatur bedienbar (Laptop), sichtbarer Fokus, echte Beschriftungen an jedem Feld,
  Fehlermeldungen am Feld und für Screenreader angesagt.
- Kontrast nach WCAG AA, Status nie nur über Farbe (Ampel zusätzlich mit Symbol und Text).
- Automatische Prüfung mit axe in den Playwright-Tests. Das findet einen Großteil der Fehler ohne Handarbeit.

## Tests

| Test | Warum |
|---|---|
| app Unit-Tests | PIN-Prüfung, Sperre, Sitzungsablauf, Katalog-Prüfung, Aufteilung auf Ebenen, Migration der alten Config. Das ist die sicherheitskritische Logik |
| PHP-Unit-Tests | PHP liest `box.json` richtig, Migration ist verlustfrei |
| Angular-Komponententests (wenige) | Ziffernblock, Formular mit Fehlern. Nur dort, wo Logik in der Oberfläche steckt |
| Playwright | Geste → PIN → Kontingent erhöhen → wird gemeldet; falsche PIN → Sperre; Einstellung speichern → Gäste-Oberfläche zeigt sie; alte Adressen 404; axe ohne Befund; Gäste-Tests laufen unverändert |
| Stromausfall | app hart beenden während des Speicherns → Einstellungen ganz alt oder ganz neu |

## Reihenfolge

1. **7a Fundament und Sicherheit:** app, PIN mit Sperre und Protokoll, `box.json` mit Migration,
   Katalog, Shell-Befehle fest im Image, Apache-Proxy. Die alten ungeschützten Endpunkte werden sofort gesperrt.
2. **7b Oberfläche:** Angular-App mit Übersicht, Event, Druck, Galerie und Wartung, dazu die versteckte Geste.
3. **7c Gestaltung und Geräte:** Uploads, Layouts mit Vorschau, Ringlicht- und Buzzer-Test.
4. **7d Selbsttest und Checkliste:** Vertrag erweitern, Mock-Backend nachziehen.
5. **7e Altes entfernen:** PHP-Admin und Testseiten löschen, Doku, Abschluss in KONZEPT.md.

Jeder Schritt läuft mit grünen Tests. Die Box bleibt zwischendurch voll benutzbar.

## Funktionen: bleiben oder entfallen (geklärt 2026-11-23)

| Bleibt (in der neuen Oberfläche einstellbar) | Entfällt |
|---|---|
| Diashow, Bildschirmschoner, Fernauslöser/GPIO (remotebuzzer), USB-Stick-Sync, „Custom“-Aufnahme, Foto löschen am Kiosk (abschaltbar) | Selfie-Upload, FTP-Upload (ersetzt durch den Galerie-Upload des Agents), Update-Prüfung gegen GitHub, `phpinfo`, Handbuch/FAQ des Originals |

## Abgleich mit dem Konzept

| Konzept | Wo in Paket 7 |
|---|---|
| 4.3 Collage und 2x6-Streifen | Gestaltung: Layouts mit Vorschau |
| 4.4 Ebenen, lokale Ausnahmen | Event; Aufteilung über den Einstellungskatalog |
| 4.5 Verstecktes Menü, persönliche PIN, Sperre, Protokoll, Menüinhalt | Anmeldung, Geste, alle Bereiche |
| 4.6 Kameraeinstellungen, Testfoto | Aufnahme (lokal). Fernzugriff und Telemetrie folgen in Paket 8 über dieselben app-Funktionen |
| 4.7 PIN auch im vertrauenswürdigen LAN, WireGuard | Anmeldung; Shell-Befehle nicht mehr einstellbar |
| 4.8 Event-Abschluss „alle Fotos hochgeladen“ | Wartung, Galerie |
| 4.9 Selbsttest und Checkliste aus Paketen | Selbsttest & Checkliste; Vertrag wird erweitert |
| 4.10 Ringlicht, Buzzer konfigurierbar, Kontingent über PIN erhöhbar | Geräte, Druck. Das Ringlicht löst weiterhin der Kiosk-Browser auf der Box direkt beim Countdown aus (E16: Kiosk bleibt HTTP, nur im lokalen Netz). Der Test-Knopf in der Admin-Oberfläche ruft den ESP ebenfalls von der Box aus auf |
| 4.11 Stromausfall | atomares Schreiben, Stromausfall-Test beim Speichern |
| 4.12 Angular, Touch/Handy/Laptop, gemeinsames Design-System | `box/apps/admin`; Design-Bausteine so angelegt, dass Paket 9 sie übernimmt |
| 4.13 Looks verwalten | Gestaltung |
| 5 Mitarbeitende, Zuweisung zur Buchung | Rollen und Aufbau-PINs pro Event |
