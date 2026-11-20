# Snaphora Fotobox

Software der Snaphora-Mietfotobox: Kiosk-Oberfläche am Touchscreen, Kamera (Canon EOS 750D über gphoto2),
Druck (DNP DS620 über CUPS), Galerie und QR-Code, Ringlicht per GET-Request, Buzzer per USB-Presenter.

Die Box läuft als Container auf einem Lenovo ThinkCentre mit Debian 13. Einrichtung, Updates und Tests
sind auf Zuverlässigkeit im Dauerbetrieb (24–48 h, Stecker ziehen ohne Datenverlust) ausgelegt.

> Basiert auf [Photobooth](https://github.com/PhotoboothProject/photobooth) (MIT-Lizenz) von Andre Rinas,
> Andreas Blaesius und der Photobooth-Community. Dieser Fork wird eigenständig weiterentwickelt.

## Überblick

| Ordner | Inhalt |
|---|---|
| `planning/` | Konzept, Entscheidungen, Fortschritt, Abnahme-Anleitung |
| `deploy/dev/` | Simulatoren für die Entwicklung ohne Hardware (Kamera, Drucker, Ringlicht) |
| `deploy/box/` | Betrieb auf der Box: Compose-Datei, USB-Installer, Einrichtung des Grundsystems, `snaphora-check` |
| `tests/` | Unit-Tests (PHP), Smoke-, Absturz- und Selbstreparatur-Tests, Oberflächentests (Playwright) |

## Entwicklung auf dem Laptop

Voraussetzung: Docker Desktop, Node.js 20+, Google Chrome (für die Oberflächentests).

```bash
docker compose up -d --build     # Fotobox auf http://localhost:8080, Ringlicht-Simulator auf :8081
tests/run-all.sh                 # alle Tests gegen die laufende App (mit --schnell ohne Absturztest)
```

Details zu Simulatoren und Fehlersimulation: [`deploy/README.md`](deploy/README.md).

## Box

Neue Box per USB-Stick aufsetzen, bestehende Box aktualisieren und prüfen: [`deploy/README.md`](deploy/README.md).
Der erste Test an der echten Hardware: [`planning/ABNAHME-BOX.md`](planning/ABNAHME-BOX.md).

## Funktionsumfang

Einzelfoto, Collage, Druck mit Druckkontingent, Galerie, QR-Code-Download, Diashow, Bildschirmschoner,
Rahmen und Text auf Foto/Collage/Druck, Ringlicht-Ansteuerung, Tastatur-/Presenter-Auslösung,
Admin-Oberfläche.

Entfernt gegenüber dem Original: Windows-Unterstützung, alter Installer, Bildfilter, Chroma-Key und
KI-Hintergrundentfernung, Video-Aufnahme, E-Mail-Versand.

## Lizenz

MIT, siehe [`LICENSE`](LICENSE) und [`LICENSE_NOTICE`](LICENSE_NOTICE).
