# Architektur der Snaphora-Box-Software

> Stand: 2026-11-23 · verbindlich für alle Arbeitspakete ab 7. Ergänzt Abschnitt 3 in `KONZEPT.md`.

## Leitbild

Die Snaphora-Box-Software ist **eine eigene, durchdachte Anwendung**, die das Photobooth-Projekt **ablöst**.
Sie wird nicht um die alte Software herumgebaut. Der Umbau läuft schrittweise
(Strangler-Prinzip): Jede Funktion wandert einmal vollständig in die neue Anwendung, danach wird der alte Teil
gelöscht. Am Ende von Paket 9 gibt es kein PHP mehr.

Damit das nicht in Wildwuchs endet, gelten die Regeln unten. Jede Änderung muss zu ihnen passen,
sonst wird zuerst dieses Dokument geändert und begründet.

## Laufzeit: genau vier Dienste

| Dienst | Aufgabe | Warum eigener Prozess |
|---|---|---|
| **app** | *Die* Anwendung: Gäste- und Admin-Oberfläche, lokale API, Einstellungen, Anmeldung, Events, Galerie, Druck, Geräte (Ringlicht, Buzzer, GPIO, USB-Sync), Selbsttest | – (das ist der Kern) |
| **camera** | Einziger Zugriff auf die Kamera (gphoto2): Aufnahme, Live-View, Einstellungen | Kamera verträgt nur einen Besitzer; ein hängender gphoto2-Prozess darf die App nicht blockieren |
| **render** | Bildpipeline: Look, Rahmen, Collage, Streifen, Anzeige-/Galerie-/Druckversion | rechenintensiv; darf Aufnahme und Oberfläche nicht ausbremsen, eigenes Speicherlimit |
| **agent** | Einzige Verbindung ins Internet: Config-Sync, Upload, später Telemetrie, Befehle, Updates | Sicherheitsgrenze: nur er hat die Zugangsdaten zum Server; Netzprobleme bleiben bei ihm |

**Regel:** Eine neue Funktion wird ein **Modul in `app`**. Einen neuen Dienst gibt es nur mit eigener
Sicherheitsgrenze, eigenem Ressourcenbedarf oder eigenem Fehlerbereich, und nur nach Eintrag hier.

Übergangsweise läuft zusätzlich **`photobooth`** (PHP + Apache, das alte Projekt). Er schrumpft mit jedem
Paket und entfällt mit Paket 9. Neue Funktionen bekommt er nicht mehr, nur noch Anpassungen, damit er mit der
neuen Anwendung zusammenarbeitet.

Die heutige Aufnahme in PHP (gphoto2 per Shell-Befehl) wird in Paket 8/9 durch `camera` ersetzt.

## Code: ein Workspace, gemeinsame Pakete

Alle neuen Teile liegen in **einem npm-Workspace** `box/`. Das entspricht einem Maven-Multi-Modul-Projekt:
ein Lockfile, einheitliche Versionen, gemeinsame Bibliotheken als eigene Module.

```
box/
  package.json            Workspace-Wurzel: Versionen, Skripte für alle
  tsconfig.base.json      gemeinsame Compiler-Einstellungen
  packages/
    platform/             Grundbausteine: atomares Schreiben, JSON-Dateien, Logging, Umgebungsvariablen
    contracts/            Datenformate an den Grenzen: Geräte-API (Server), Einstellungskatalog,
                          Konfigurations-Ebenen, Dateiformate zwischen den Diensten – Typen + Prüfung
  apps/
    app/                  NestJS-Anwendung (der Kern)
    admin/                Angular-Admin-Oberfläche (wird von app ausgeliefert)
    render/               Bildpipeline
    agent/                Server-Verbindung
    (camera/, guest/      kommen in Paket 8/9)
```

- **Kein Code doppelt.** Was zwei Apps brauchen, gehört in ein Paket. Heute gibt es zum Beispiel
  `files.ts` in render und agent fast gleich; das wird zusammengeführt.
- **Datenformate nur in `contracts`.** Jede Datei und jede Nachricht, die zwischen Diensten oder zum Server
  geht, ist dort einmal beschrieben und wird beim Lesen geprüft. Wer ein Format ändert, sieht sofort alle Nutzer.
- **Abhängigkeiten nur nach innen:** apps → packages, nie umgekehrt. `platform` hängt von nichts ab.

### Warum NestJS für `app`

`app` wird über die nächsten Pakete die ganze Anwendung. Dafür braucht es Struktur, die auch nach
Jahren noch trägt. NestJS gibt sie, und sie ist dir aus Spring Boot vertraut:

| NestJS | Spring Boot |
|---|---|
| `@Module` | `@Configuration` / Auto-Configuration eines Bereichs |
| `@Injectable` Provider | `@Service` / `@Component` Bean mit Konstruktor-Injection |
| `@Controller` + `@Get`/`@Post` | `@RestController` + `@GetMapping`/`@PostMapping` |
| Guard | Filter / `@PreAuthorize` in Spring Security |
| Pipe | Bean Validation / Converter |
| Exception Filter | `@ControllerAdvice` |

Abwägung: NestJS bringt etwa zehn Abhängigkeiten mit (alle verbreitet und gepflegt). Agent und render bleiben
dagegen bewusst schlank (Agent ohne Laufzeit-Abhängigkeiten), weil sie klein bleiben. HTTP-Server unter
NestJS ist Fastify (schneller, schlanker als Express).

### Module in `app`

Ein Modul pro fachlichem Bereich, jedes mit eigener Verantwortung:

| Modul | Paket | Aufgabe |
|---|---|---|
| `config` | 7 | Ebenen lesen, zusammenführen, Einstellungskatalog, Speichern mit Aufteilung |
| `access` | 7 | PIN-Anmeldung, Sitzungen, Rollen, Sperre, Zugriffsprotokoll |
| `print` | 7 → 9 | Kontingent, Sperre, Zähler; ab 9 auch Druckaufträge |
| `status` | 7 | Gesamtzustand der Box (Event, Fotos, Uploads, Speicher, Geräte) |
| `maintenance` | 7 | Archivieren, Datenbank neu aufbauen, Logs, Neustart |
| `selftest` | 7 | Prüfungen und Checkliste |
| `devices` | 7 → 9 | Ringlicht, Buzzer, GPIO, USB-Sync |
| `gallery` | 7 → 9 | Fotos, Löschen, QR-Code |
| `events` | 9 | Event-Wechsel und Archiv (heute noch in PHP) |
| `capture` | 9 | Ablauf von Aufnahme und Collage, spricht mit `camera` und `render` |
| `guest` | 9 | Schnittstelle für die Gäste-Oberfläche |

## Daten: jede Datei hat genau einen Besitzer

Nur der Besitzer schreibt. Alle anderen lesen. Geschrieben wird immer atomar.

| Daten | Besitzer | Leser |
|---|---|---|
| `config/layers/device.json`, `event.json` | agent | app, photobooth |
| `config/layers/box.json` (Box-Einstellungen, ersetzt `my.config.inc.php`) | app | photobooth, agent |
| `config/layers/local-event.json` | app | photobooth, agent |
| `config/access/staff.json` (PIN-Hashes vom Server) | agent | app |
| `private/images/*`, `private/fonts` (Bibliothek der Gestaltung) | app (übergangsweise auch der alte Upload) | photobooth, render |
| `private/snaphora/assets` (Bilder vom Server) | agent | app, photobooth, render |
| `data/images`, Bild-Datenbank, Druckzähler | photobooth → app (Paket 9) | render, agent |
| `data/render-queue` | photobooth/app stellen ein, render arbeitet ab | – |
| `agent/` (Zugangsdaten, Upload-Stand) | agent | – |
| `app/` (Zugriffsprotokoll, Sperrzustand, Sitzungen) | app | – |

**Übergang:** Bis zum Ende von Paket 7 schreibt auch die alte PHP-Administration noch `box.json` und
`local-event.json`, mit derselben Regel. Mit 7e entfällt sie.

## Schnittstellen und Adressen

- `app` stellt seine API unter **`/api/v1/`** bereit und die Admin-Oberfläche unter **`/admin/`**. Dieselben Adressen
  gelten nach Paket 9 weiter, nur ohne Apache davor.
- Bis Paket 9 leitet Apache im `photobooth`-Container diese Pfade an `app` weiter. Dadurch gibt es nur einen
  Ursprung, Cookies brauchen kein CORS, und der Kiosk hat eine Adresse.
- Dienste sprechen über **Dateien mit festem Format** (Ebenen, Render-Warteschlange; stromausfallsicher,
  auch wenn ein Dienst gerade nicht läuft) oder über **lokales HTTP** im Docker-Netz (agent ↔ app, app ↔ camera).
  Kein gemeinsamer Zustand im Speicher, keine Datenbank, die sich zwei Dienste teilen.
- Die Schnittstelle zum Server ist `contracts/device-api.yaml`. Die Typen in `box/packages/contracts` folgen ihr.

## Einstellungen

- **Einstellungskatalog** (`box/packages/contracts`): jede Einstellung, die man an der Box ändern kann, mit
  Typ, Grenzen, Standardwert, Bereich und Beschriftung. Daraus entstehen Prüfung, Formulare und Doku.
- Was nicht im Katalog steht, ist **nicht einstellbar** (fester Wert im Image). Das gilt insbesondere für
  Shell-Befehle: Wer Einstellungen speichern darf, darf deshalb noch lange keine Befehle ausführen.
- Bis Paket 9 hat PHP ein eigenes Schema mit Standardwerten. Ein Test stellt sicher, dass beide für jede Katalog-Einstellung
  übereinstimmen. Mit Paket 9 wird der Katalog die einzige Quelle.

## Querschnitt (gilt für jedes Modul)

- **Robust:** atomares Schreiben, beschädigte Dateien überspringen statt abstürzen, Neustart jederzeit
  möglich, kein Zustand nur im Speicher, der nach einem Stromausfall fehlt.
- **Sicher:**
  - Alles von außen gilt als ungeprüft (Server, Browser, Dateien anderer Dienste) und wird an der Grenze geprüft.
  - Jede schreibende Aktion verlangt eine Anmeldung und wird protokolliert.
  - Container laufen ohne Root.
  - Jeder Dienst bekommt nur die Volumes, die er braucht; was er nur liest, ist read-only eingehängt.
- **Wartbar:** ein Modul hat eine Aufgabe; Tests neben dem Code; Doku zum Modul in `planning/` oder als README im Paket.
- **Testbar ohne Box:** jede Hardware hat einen Simulator (Kamera, Drucker, Ringlicht, Buzzer).

## Weg dorthin

| Paket | Was wandert von PHP nach `app` | Was entfällt in PHP |
|---|---|---|
| 7 | Einstellungen speichern, Anmeldung, Druckkontingent, Wartung, Galerie verwalten, Selbsttest, Uploads | `admin/`, `login/`, `test/`, `manual/`, `faq/`, `welcome/`, Verwaltungs-Endpunkte |
| 8 | – (`camera` entsteht, Telemetrie und Befehle über agent → app) | Kamera-Shell-Befehle |
| 9 | Aufnahme, Galerie, Druck, Event-Wechsel, Gäste-Oberfläche | alles: `photobooth`-Container, Apache, PHP |
