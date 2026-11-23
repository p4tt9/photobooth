# Agent und Konfiguration (Arbeitspaket 6)

> Stand: 2026-11-21 · umgesetzt gegen das Mock-Backend, Vertrag `contracts/device-api.yaml` v0.1

## Überblick

```
Backend (später echt, jetzt Mock)                 Fotobox
─────────────────────────────────                 ──────────────────────────────────────────────────────
                                                  agent (TypeScript, eigener Container)
POST /device/v1/register   ◄── Einmal-Token ───── Registrierung → Zugangsdaten nur im Volume `agent`
POST …/token (Keycloak)    ◄── Client Credentials
GET  /device/v1/config     ◄── jede Minute ─────  Konfiguration → config/layers/device.json, event.json
GET  /device/v1/assets/…   ◄── Bilder, Prüfsumme   → private/snaphora/assets/<sha256>.png
PUT  …/events/{id}/photos  ◄── Galerie-Version ── Upload-Warteschlange (übersteht Stromausfall)
POST /device/v1/status     ◄── nach Abgleich      Event, Upload-Stand, Drucke, Änderungen am Gerät

                                                  photobooth (PHP)
                                                  liest die Ebenen bei jeder Anfrage,
                                                  archiviert beim Event-Wechsel Galerie und Druckzähler
```

Die Box baut nur ausgehende Verbindungen auf. Ohne Server (oder ohne `SERVER_URL`) läuft sie wie bisher.

## Einstellungen in Ebenen (Konzept 4.4)

Von unten nach oben, spätere überschreiben frühere:

| Ebene | Datei | Wer schreibt | Gilt |
|---|---|---|---|
| 1. Standardwerte | im Image | – | immer |
| 2. Gerät vom Server | `config/layers/device.json` | Agent | immer (Ringlicht-Adresse, Buzzer-Taste) |
| 3. Box-Einstellungen | `config/my.config.inc.php` | Admin-Oberfläche | immer – wie bisher |
| 4. Event vom Server | `config/layers/event.json` | Agent | nur im Zeitfenster des Events |
| 5. Am Gerät fürs Event geändert | `config/layers/local-event.json` | Admin-Oberfläche | nur solange dieses Event aktiv ist |

- **Server-Vorgaben setzen nur, was sie kennen.** Das Event-Profil enthält fachliche Angaben (Titel, Farben,
  Rahmen, Kontingent, Galerie …). Der Agent übersetzt sie in App-Einstellungen (`services/agent/src/mapping.ts`).
  Alles andere (Schrift, Textposition, Kamera, Drucker) bleibt Box-Einstellung.
- **Speichern in der Admin-Oberfläche** trennt automatisch: Einstellungen, die das Event steuert, landen in
  Ebene 5 (gelten nur für dieses Event, werden dem Server gemeldet), alles andere in Ebene 3.
  Beispiel: Kontingent um 5 erhöhen → gilt für diese Feier, die nächste beginnt wieder mit dem Paket-Kontingent.
- **Beschädigte oder ungültige Ebenen** werden übersprungen (Box startet immer).
- **Offline:** Die zuletzt vollständig geladene Konfiguration gilt weiter, auch nach Neustarts. Ein Event
  wird erst übernommen, wenn alle Bilder geladen und geprüft sind.
- **Zeitfenster:** Das Event-Profil kommt schon vor dem Aufbau (Bilder werden vorab geladen), aktiv wird es
  ab `validFrom` – auch ohne Verbindung. Nach `validUntil` läuft die Box wieder mit ihren eigenen Einstellungen.

## Event-Wechsel

Wird ein anderes Event aktiv, verschiebt die App Galerie, Originale, Druckbilder, Bild-Datenbank,
Druckprotokoll und Druckzähler nach `data/archive/<eventId>/` (Fotos von vor dem ersten Event:
`data/archive/ohne-event-<Datum>/`). Das neue Event beginnt mit leerer Galerie und Druckzähler 0;
gelöscht wird nichts. Ein unterbrochener Wechsel (Stromausfall) wird bei der nächsten Anfrage vervollständigt.
Endet ein Event ohne Nachfolger, bleibt alles, wie es ist.

## Galerie-Upload (Konzept 4.8)

- Der Agent sieht alle 5 s in `data/images` nach. Neue Fotos gehören zu dem Event, in dessen Zeitfenster sie
  entstanden sind, und nur, wenn das Event eine Online-Galerie hat. Sonst bleiben sie lokal.
- Hochgeladen wird die **Galerie-Version** (3000 px, mit Look, Rahmen, Text), sobald der Render-Dienst sie fertig hat.
- Pro Foto eine Statusdatei in `agent/uploads/`. Nach Funkloch oder Stromausfall geht es dort weiter;
  der Server erkennt doppelte Uploads an der Prüfsumme.
- Wiederholung mit wachsendem Abstand (5 s … 10 min). Vom Server abgelehnte Fotos (Event abgeschlossen,
  unbekannt) werden als „fehlgeschlagen“ markiert und nicht endlos wiederholt.
- Fotos, die beim Event-Wechsel noch nicht hochgeladen waren, holt der Agent aus dem Archiv.
- Der **QR-Code** zeigt bei aktivem Event auf die Online-Galerie (`photoUrlPrefix` + Dateiname).

## Sicherheit und Robustheit

- **Nur HTTPS zum Server.** Eine `http://`-Adresse lehnt der Agent ab (Ausnahme nur in der Dev-Umgebung:
  `ALLOW_INSECURE_HTTP=1` für das Mock-Backend). Eine falsche Adresse legt die Box nicht lahm: Der Agent läuft
  dann ohne Server weiter.
- **Alles vom Server wird geprüft** (`services/agent/src/validate.ts`, Regeln wie im Vertrag): Kennungen, Prüfsummen,
  Farben, Layout- und Look-Namen nur aus erlaubten Zeichen (sie landen in Dateipfaden bzw. CSS), Texte ohne
  Steuerzeichen und mit Längengrenze, Zahlen mit Grenzen, Galerie-Adressen nur `https://`. Eine ungültige
  Konfiguration wird komplett abgelehnt, die zuletzt gute bleibt aktiv. Unbekannte Felder fallen weg.
- **Bilder** nur mit passender SHA-256-Prüfsumme, erst danach wird umgeschaltet.
- **Texte** vom Server (Titel, Untertitel) gibt die Startseite escaped aus, also kein HTML oder Skript im Kiosk.
- **Zugangsdaten** der Box liegen nur im Volume `agent` (Rechte 600), nicht in der App und nicht im Web.
- **Interne Dateien** werden nie über HTTP ausgeliefert, unabhängig vom Inhalt der Volumes
  (`deploy/apache/snaphora-protect.conf` im Image): `config/` (inkl. Ebenen), `var/`, Archiv, Arbeitsdaten der
  Bildpipeline, Bild-Datenbank, Druckprotokoll, Zähler. Der Agent-Test prüft das.
  Gefunden bei dieser Prüfung: Das Original-Projekt schützte `config/` per `.htaccess`, die seit der Umstellung
  auf Volumes fehlte.
- **Lokale Schnittstelle des Agents** ist auf der Box nicht nach außen veröffentlicht (nur `docker compose exec`).
- Statusdateien auf der Platte werden vor der Verwendung in Pfaden erneut geprüft.

## Registrierung

1. Im Management-Frontend (später) ein Einmal-Token für die Box erzeugen.
2. Auf der Box: `SNAPHORA_REGISTRATION_TOKEN` in `/etc/snaphora/box.env` eintragen oder
   `docker compose -f /opt/snaphora/box/compose.yml exec agent snaphora-agent register <token>`.
3. Die Zugangsdaten (Keycloak-Client der Box) liegen nur im Volume `agent`, nicht in der App.

## Tests

| Test | Was |
|---|---|
| `services/agent` (32 Unit-Tests, laufen beim Image-Bau) | Prüfung der Server-Daten (14 Angriffs-/Fehlerfälle), HTTPS-Pflicht, Übersetzung Profil → Einstellungen, Prüfsummen, Offline-Fallback, Zeitfenster, Aufräumen alter Bilder, Upload genau einmal, Galerie-Version abwarten, Funkloch + Neustart, Zuordnung zum Event, Archiv, Ablehnung |
| `tests/Unit/Service/ConfigurationLayersTest.php` (8) | Reihenfolge der Ebenen, getrenntes Speichern, Wechsel, beschädigte Ebenen, Listen |
| `tests/Unit/Service/EventArchiveServiceTest.php` (4) | Archiv beim Wechsel, unterbrochener Wechsel |
| `tests/agent/sync-upload.mjs` (Dev-Umgebung, CI) | Gesamter Ablauf: Event → Startseite, Upload der Galerie-Version, Funkloch, Agent hart beendet, Kontingent am Gerät erhöht → gemeldet, Event-Wechsel, Event-Ende |

## Bewusst noch nicht (spätere Pakete)

- Telemetrie, Logs, Befehle vom Server, Updates mit Rollback, WireGuard-Konfiguration → Paket 8
- Verstecktes PIN-Menü und Anzeige des Agent-Status am Display → Paket 7
- Persönliche PINs vom Server, Checklisten → Paket 7 (Vertrag wird dann erweitert)
- Kiosk lädt eine neue Event-Konfiguration erst beim nächsten Seitenaufruf (in der Regel beim Start der Box).
  Wechsel mitten im Betrieb → mit der neuen Gäste-Oberfläche (Paket 9) live übernehmen.
- Am Gerät geänderte **Box**-Einstellungen (Ebene 3) werden noch nicht gemeldet, nur die fürs Event.
- Originale (24 MP) hochladen, Löschen lokaler Fotos nach bestätigtem Upload + Frist, Event-Abschluss.

## Für das Backend notiert (geht später in `BACKEND_SCHNITTSTELLEN.md`)

- Einmal-Token pro Gerät, wiederholbare Registrierung (gleiche `installationId` → gleiche Zugangsdaten).
- Pro Box ein Keycloak-Client (Client Credentials), einzeln sperrbar.
- Konfiguration mit ETag; Bilder unveränderlich über SHA-256, nur Bilder der eigenen Konfiguration ausliefern.
- Event-Profil schon vor dem Aufbau ausliefern (Bilder vorab laden), `validFrom`/`validUntil` = Aufbau bis Abbau + Puffer.
- Uploads auch nach Event-Ende annehmen, bis das Event abgeschlossen ist (dann 409).
- Galerie-Seite für ein Foto, das noch nicht hochgeladen ist: „wird gerade übertragen“ statt Fehler (QR-Code zeigt früher hin).
- Galerie-Adressen mit nicht erratbarem Token.
- Statusmeldungen speichern (letzter Stand pro Box reicht vorerst), `localChanges` im Management-Frontend anzeigen.
