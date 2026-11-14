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

## Box

Siehe `box/compose.yml`. Das Image baut GitHub Actions (`.github/workflows/box-image.yml`)
und legt es unter `ghcr.io/p4tt9/photobooth` ab; auf der Box wird nichts kompiliert.
Die Einrichtung des Grundsystems (CUPS, Kiosk, udev-Regel, WireGuard) folgt in einem eigenen Schritt.
