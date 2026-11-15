# Deployment

| Ordner | Zweck |
|---|---|
| `dev/` | Simulatoren für die Entwicklung ohne Box (Kamera, Drucker, Ringlicht) |
| `box/` | Betrieb auf der Fotobox (ThinkCentre) mit echter Hardware |

## Entwicklung auf dem Laptop

Voraussetzung: Docker Desktop, Node.js 20+.

```bash
docker compose up -d --build        # Fotobox auf http://localhost:8080
node tests/smoke/capture-print.mjs  # Auslösen → Verarbeiten → Drucken, mit Zeitmessung
docker compose down                 # stoppen (Daten bleiben in Volumes erhalten)
```

- **Kamera:** simulierte Canon EOS 750D, liefert Fotos in 6000×4000 nach ca. 1,8 s.
- **Drucker:** jeder Druckauftrag landet als Datei in `.dev/printer/`.
- **Ringlicht:** `http://localhost:8081`. In der Admin-Oberfläche unter „GET-Request“ als Server
  `http://localhost:8081` eintragen; Aufrufe stehen unter `http://localhost:8081/_log`.

Fehler simulieren (Datei anlegen = Fehler an, löschen = aus):

```bash
touch .dev/devices/camera-disconnected   # Kamera abgezogen
touch .dev/devices/camera-busy           # Kamera von anderem Prozess belegt
touch .dev/devices/printer-offline       # Drucker aus
```

Alles zurücksetzen (Fotos, Konfiguration): `docker compose down -v`

### Tests gegen die laufende Dev-Umgebung

```bash
node tests/smoke/capture-print.mjs     # Auslösen → Verarbeiten → Drucken, mit Zeitmessung
node tests/crash/damaged-files.mjs     # beschädigte Datenbank/Zähler/Konfiguration → repariert sich selbst?
node tests/crash/power-cut.mjs         # App mitten im Ablauf hart beenden, danach Daten prüfen
```

Der Absturztest beendet die Prozesse hart, kann aber keinen echten Stromausfall nachstellen
(dabei gehen auch noch nicht auf die SSD geschriebene Daten verloren). Das prüft erst der Test an der Box.

## Box

Das App-Image baut GitHub Actions (`.github/workflows/box-image.yml`) und legt es unter
`ghcr.io/p4tt9/photobooth` ab; auf der Box wird nichts kompiliert.

### Neue Box aufsetzen (USB-Stick)

```bash
deploy/box/installer/build-iso.sh   # fragt das Admin-Passwort ab, nutzt ~/.ssh/id_ed25519.pub
```

1. `.dev/installer/snaphora-installer.iso` mit balenaEtcher auf einen USB-Stick schreiben.
2. Box per Kabel mit dem Router verbinden (oder beim Bauen `WIFI_SSID`/`WIFI_PSK` setzen).
3. Vom Stick starten (ThinkCentre: F12 beim Einschalten), Menüpunkt „Snaphora Fotobox installieren“ wählen.
   **Die interne SSD wird dabei gelöscht.**
4. Ab hier läuft alles allein: Debian-Installation → Neustart → Ersteinrichtung (Fortschritt auf dem Bildschirm)
   → Neustart → Kiosk startet.
5. Einmalig im BIOS: „After Power Loss“ auf „Power On“ (siehe `planning/KONZEPT.md`, 6a).

### Bestehende Box aktualisieren

```bash
sudo /opt/snaphora/box/host/provision.sh   # idempotent, darf beliebig oft laufen
sudo /opt/snaphora/box/host/setup-printer.sh   # falls der Drucker bei der Einrichtung aus war
```

| Was | Wo |
|---|---|
| **Ist die Box einsatzbereit?** | `sudo snaphora-check` (`--foto` macht ein Testfoto, `--ringlicht` steuert das Ringlicht an) |
| Einstellungen (Image, Version) | `/etc/snaphora/box.env` |
| Protokoll der Einrichtung | `/var/log/snaphora-provision.log` |
| Kiosk-Protokoll | `/home/kiosk/kiosk.log` |
| App-Container | `systemctl status snaphora-app`, `docker compose -f /opt/snaphora/box/compose.yml logs` |

### Was das Grundsystem macht

- **Kiosk:** Benutzer `kiosk` wird auf tty1 automatisch angemeldet und startet Chromium im Kiosk-Modus
  (cage). Zuerst erscheint eine Ladeseite, bis die App antwortet. Das Browser-Profil liegt im RAM,
  daher keine Absturzmeldungen nach Stromausfall. Stürzt der Browser ab, startet er neu.
- **Drucker:** CUPS mit Gutenprint-Treiber für den DS620, wird als Standarddrucker eingerichtet.
- **Kamera:** udev-Regel gibt Canon-Kameras für den Container frei.
- **Robustheit:** Hardware-Watchdog, Neustart bei Kernel-Fehlern, automatische Dateisystemreparatur
  beim Start, kein Ruhezustand, Logs überleben Neustarts (max. 500 MB).
- **Zugang:** SSH nur mit Schlüssel, kein root-Login. WireGuard ist installiert, wird aber erst mit der
  Anmeldung am Server eingerichtet.
