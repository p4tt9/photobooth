# Frühe Abnahme an der Box

Ziel: Prüfen, ob das neue Grundsystem auf dem ThinkCentre mit echter Hardware funktioniert –
Installation, Kamera, Drucker, Touchscreen, Buzzer, Ringlicht und Stecker-Ziehen.

Dein jetziges System bleibt unangetastet: Getestet wird auf einer **zweiten SSD**.

---

## 0. Was du brauchst

- [ ] Zweite SSD für das ThinkCentre (meist M.2 2280 NVMe, ab 128 GB)
- [ ] USB-Stick ab 2 GB (wird gelöscht)
- [ ] Netzwerkkabel zum LTE-Router – oder WLAN-Name und -Passwort
- [ ] Mac im selben Netz wie die Box (für SSH, optional)
- [ ] Stoppuhr (Handy) und etwas Druckpapier

## 1. Vorbereitung

1. **Alte SSD ausbauen und beschriften** („Fotobox alt – funktioniert“), zweite SSD einbauen.
2. **BIOS** (beim Einschalten F1 drücken):
   - „After Power Loss“ → **Power On**
   - Boot-Reihenfolge: USB vor der internen SSD (nur für die Installation)
   - Den genauen Modellnamen notieren (steht oben im BIOS) → für das Konzept
3. **USB-Stick bauen** (im Terminal auf dem Mac, im Repo-Ordner):

   ```bash
   SNAPHORA_VERSION=snaphora-fundament deploy/box/installer/build-iso.sh
   ```

   `SNAPHORA_VERSION` legt fest, welches App-Image die Box lädt – hier das des Test-Branches.
   Fragt ein Admin-Passwort ab (mind. 10 Zeichen, für Konsole und `sudo` auf der Box).
   Für WLAN statt Kabel vorher `WIFI_SSID=… WIFI_PSK=…` davorsetzen.
   Danach `.dev/installer/snaphora-installer.iso` mit balenaEtcher auf den Stick schreiben.

## 2. Installation

1. Box per Kabel mit dem Router verbinden, Stick einstecken, einschalten (F12 = Boot-Menü).
2. „Snaphora Fotobox installieren“ wählen. Ab hier läuft alles allein:
   Debian-Installation → Neustart → Ersteinrichtung (Fortschritt auf dem Bildschirm) → Neustart.
3. Stick abziehen, sobald der erste Neustart beginnt.
4. Erwartet: Ladeseite „Die Fotobox startet …“, danach die Fotobox-Oberfläche.

| Notieren | Wert |
|---|---|
| Dauer Installation bis Fotobox-Oberfläche | |
| Lief alles ohne Eingriff? Wenn nein: wo hing es? | |

## 3. App einrichten

Die App startet mit Standardeinstellungen. Über die Admin-Oberfläche (`http://<IP der Box>/admin`
vom Handy/Mac im selben Netz) mindestens einstellen:

- [ ] Ringlicht: „GET-Request“ beim Countdown einschalten, Server = Adresse des ESP
- [ ] Drucken einschalten, Druckkontingent z. B. 200
- [ ] Buzzer-Taste wie bisher
- [ ] Collage wie bisher

Die IP der Box zeigt `snaphora-check` (Abschnitt „Netz“) oder der Router.

## 4. Automatische Prüfung

Per SSH vom Mac (`ssh snaphora@<IP der Box>`) oder an der Box (Strg+Alt+F2, anmelden):

```bash
sudo snaphora-check --foto --ringlicht
```

- [ ] Ausgabe endet mit „Einsatzbereit“ – sonst die komplette Ausgabe an mich schicken

## 5. Funktionstest

| # | Test | Erwartet | Ergebnis / Zeit |
|---|---|---|---|
| 1 | Touchscreen: Foto starten | Countdown startet | |
| 2 | Buzzer drücken | Countdown startet | |
| 3 | Ringlicht beim Countdown | leuchtet | |
| 4 | Zeit von Auslösen bis Foto auf dem Bildschirm | so schnell wie bisher oder schneller | ___ s |
| 5 | Drucken: Zeit von „Drucken“ bis Papier draußen | | ___ s |
| 6 | Collage aufnehmen und drucken | korrekt | |
| 7 | 10 Fotos direkt hintereinander | keine Fehler, kein Hänger | |
| 8 | Galerie und QR-Code | Fotos sichtbar | |
| 9 | Kamera im Betrieb ab- und wieder anstecken | nächstes Foto klappt wieder | |
| 10 | Drucker aus, drucken, Drucker wieder an | verständliche Meldung, danach druckt er | |

## 6. Stecker ziehen

Jeweils Stecker ziehen, 10 Sekunden warten, wieder einstecken. **Nichts drücken** – die Box muss
von allein starten. Danach `sudo snaphora-check` und kurz in die Galerie schauen.

| # | Stecker ziehen … | Startet von allein? | Dauer bis Oberfläche | Fotos + Druckzähler ok? |
|---|---|---|---|---|
| 1 | im Leerlauf | | | |
| 2 | während des Countdowns | | | |
| 3 | direkt nach dem Auslösen (Verarbeitung) | | | |
| 4 | während des Druckens | | | |
| 5 | dreimal kurz hintereinander | | | |
| 6 | während in der Admin-Oberfläche gespeichert wird | | | |

## 7. Optional: Langlauf

Box über Nacht laufen lassen, morgens 5 Fotos machen und `sudo snaphora-check`.

## 8. Rückbau

Alte SSD wieder einbauen – die Box ist im alten Zustand. Die Test-SSD aufheben, für die nächste Runde.

## Was du mir schickst

- Ausgabe von `sudo snaphora-check --foto --ringlicht`
- Die ausgefüllten Tabellen (gern als Foto)
- Bei Problemen zusätzlich: `sudo journalctl -b -1 --no-pager | tail -200` (Protokoll des vorigen Starts)
  und `cat /home/kiosk/kiosk.log`

Alternativ: Wenn dein Mac im selben Netz ist, gib mir die IP der Box – dann kann ich die Prüfungen
per SSH selbst ausführen.
