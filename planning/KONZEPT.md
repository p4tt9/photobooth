# Snaphora Fotobox – Modernisierungskonzept

> Status: **Diskussion / Planung** – noch keine Umsetzung.
> Letzte Aktualisierung: 2026-11-09

Dieses Dokument sammelt Anforderungen, Entscheidungen, offene Fragen und die geplanten Arbeitspakete.
Sobald die Schnittstellen feststehen, wird daraus zusätzlich eine eigene Datei für den Backend-/Website-Agenten
abgeleitet (`BACKEND_SCHNITTSTELLEN.md`).

---

## 1. Rahmenbedingungen

| Thema | Stand |
|---|---|
| Hardware | Lenovo ThinkCentre Tiny (x86, genaues Modell offen), **Touchscreen** |
| Drucker | DNP DS620 (Sublimation, 300 dpi, 4x6" = 1844×1240 px, kann 2x6"-Streifen schneiden) |
| Kamera | **Canon EOS 750D** über gphoto2 (USB) |
| Internet | eingebauter LTE-Router, unzuverlässig → **Offline-Betrieb ist Pflicht** |
| Lokales Netz | Router-WLAN ist nicht für Gäste zugänglich → gilt als vertrauenswürdig |
| Ringlicht | ESP im WLAN des LTE-Routers, Funktion „GET-Request“ (`get_request.countdown`) |
| Buzzer | USB-PowerPoint-Presenter (meldet sich als Tastatur) → löst Foto aus |
| Laufzeit | 24–48 h am Stück ohne Eingriff |
| Stromausfall | Kunden ziehen oft den Stecker → **kein Datenverlust, sauberer Neustart** |
| Pakete | 200 oder 400 Fotos → Druckkontingent kommt vom Server |
| Genutzte Funktionen | Einzelfoto, **Collage**, Druck, Galerie/QR. **Nicht genutzt:** Filter, Chroma-Key, Video, Mail (und alles Weitere, sofern nicht anders entschieden) |
| Nachbearbeitung | manuell in LightCraft (Automatisierung = ferne Zukunft) |
| Aufbau | heute nur Patrick, künftig auch Mitarbeitende |
| Server | Hetzner CX22 (2 vCPU, 4 GB RAM, 40 GB SSD), Foto-Speicher liegt dort bereits |
| Backend | `Web_Infrastructure/snaphora_backend` – Spring Boot 3.3, Java 21, Postgres, Flyway, Keycloak |
| Frontend | `Web_Infrastructure/snaphora_management_frontend` – Angular 19, Keycloak |
| Upstream | Fork ist ok, Kern darf komplett umgebaut werden, kein Push ins Original-Projekt |
| Eingekaufte Lösungen | **nein** – Provisionierung, Updates, Fernwartung selbst entwickeln (OSS-Werkzeuge ok) |
| DSGVO, Diebstahlschutz | wird gesondert / später behandelt |

---

## 2. Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| E1 | Eigener Fork, kein Upstream-Bezug | Zuverlässigkeit und eigener Anwendungsfall wichtiger als Upstream-Updates |
| E2 | **Schrittweise ersetzen** statt Komplett-Neubau | Box muss jederzeit einsatzfähig bleiben |
| E3 | Nicht genutzte Funktionen werden entfernt | weniger Code = weniger Fehlerquellen |
| E4 | Lokales Netz der Box gilt als vertrauenswürdig | kein Gastzugang; Schutzfokus liegt auf Box ↔ Server |
| E5 | 2x6-Fotostreifen werden eingebaut | DS620 kann schneiden; extra vermarktbar |
| E6 | Bestehende Buchungen werden migriert, nichts geht verloren | Flyway-Migrationen mit sinnvollen Standardwerten |
| E7 | Checklisten bekommen ein **eigenes Modell**, verknüpft mit Paketen | Zubehör-Modell wird abgelöst, nur noch Pakete |
| E8 | Mitarbeitende werden mitgedacht (Zuweisung Event ↔ Mitarbeiter) | Aufbau künftig nicht nur durch Patrick |
| E9 | WireGuard selbst gehostet auf dem Hetzner-Server | kein Fremddienst |
| E10 | **Neue Teile in TypeScript (Node.js)**, Kiosk-Oberfläche später in **Angular** | eine Sprache auf der Box, Patrick kennt Angular/TS; `sharp` (libvips) für schnelle Bildverarbeitung; API-Client aus der OpenAPI-Beschreibung des Backends generierbar |
| E11 | PHP bleibt nur so lange, bis seine Teile ersetzt sind | Strangler-Prinzip, danach entfällt PHP komplett |
| E12 | Container-Images in der **GitHub Container Registry** | kostenlos, direkt aus GitHub Actions, schont den CX22 |
| E13 | Buzzer-Taste bleibt **frei konfigurierbar** (Geräte-Einstellung) | Presenter-Modelle senden unterschiedliche Tasten |
| E14 | Kein bestimmtes ThinkCentre-Modell vorausgesetzt | Software darf nicht an ein Modell gebunden sein; Modell wird nur per Telemetrie erfasst |
| E15 | Hetzner CX22 reicht vorerst | Speicherbelegung per Telemetrie/Monitoring beobachten, bei Bedarf Volume oder Storage Box |
| E16 | Lokale Kiosk-Oberfläche läuft über **HTTP** | lokales Netz vertrauenswürdig (E4); Ringlicht-Aufruf bleibt im Browser. Verbindung Box ↔ Server bleibt HTTPS |
| E17 | **Box zuerst, Backend am Ende.** Die Box definiert, was sie vom Backend braucht | Anforderungen entstehen dort, wo sie gebraucht werden; Backend wird danach in einem Zug sauber gebaut |

### Umgang mit dem Backend bis zur Umsetzung (aus E17)
- Der **Schnittstellen-Vertrag** wird in diesem Repo als OpenAPI-Datei gepflegt (`contracts/device-api.yaml`) und wächst mit jedem Arbeitspaket.
- Ein **Mock-Server** im Repo implementiert diesen Vertrag. Damit lassen sich Agent, Config-Sync, Upload, Telemetrie und Befehle
  entwickeln und automatisch testen, ohne dass das echte Backend existiert.
- Bis das Backend steht, läuft die Box im Einsatz mit **lokal gepflegter Konfiguration** – das ist ohnehin der Offline-Fall.
- Am Ende entsteht daraus `BACKEND_SCHNITTSTELLEN.md` für den Backend-Agenten: Vertrag, Datenmodell-Erweiterungen, Migrationen.
  Der Mock-Server dient dann als Referenz und die Vertragstests prüfen das echte Backend.

---

## 3. Zielarchitektur (Entwurf)

```
┌──────────────────────── ThinkCentre (Fotobox) ─────────────────────────┐
│ Grundsystem (automatisch provisioniert)                                │
│   • Debian/Ubuntu minimal, Docker                                      │
│   • CUPS + Gutenprint (DNP DS620)                                      │
│   • Kiosk: cage + Chromium → http://localhost                          │
│       (Buzzer = Tastatur, Ringlicht-GET kommt direkt aus dem Browser)  │
│   • WireGuard (Fernzugang SSH/Debug)                                   │
│   • Hardware-Watchdog, journald persistent                             │
│                                                                        │
│ Container                                                              │
│   • app      – Fotobox-UI + lokale API (heute PHP, später Node/Angular)│
│   • camera   – exklusiver Kamera-Dienst (gphoto2, Live-View, Settings) │
│   • render   – Bildpipeline (libvips): Anzeige-, Druck-, Upload-Version│
│   • agent    – Config-Sync, Upload-Queue, Telemetrie, Befehle, Updates │
└────────────────────────────────────────────────────────────────────────┘
          │  nur ausgehend: HTTPS (REST + WebSocket), WireGuard
          ▼
┌──────────────────────── Hetzner CX22 ──────────────────────────────────┐
│ snaphora_backend (zentrales Backend) + Keycloak + Postgres             │
│ Management-Frontend (Geräte, Event-Profile, Checklisten, Mitarbeiter)  │
│ Online-Galerie pro Buchung, Foto-Speicher                              │
│ WireGuard-Endpunkt                                                     │
└────────────────────────────────────────────────────────────────────────┘
```

### Grundsätze
- **Box arbeitet autark**, der Server ist zur Laufzeit „nice to have“. Alles Nötige liegt lokal vor.
- **Box baut nur ausgehende Verbindungen auf**, keine offenen Ports nach außen.
- **Ein Prozess besitzt die Kamera** (`camera`-Dienst), alle anderen – auch Fernzugriffe – gehen über ihn.
- **Jeder Schreibvorgang ist stromausfallsicher** (atomar oder transaktional).
- **Hardware-Einstellungen und Event-Einstellungen sind strikt getrennt.**

---

## 4. Anforderungen nach Bereich

### 4.1 Deployment & Provisionierung (selbst entwickelt)
- Bootfähiger USB-Stick: unbeaufsichtigte OS-Installation (Debian preseed / Ubuntu autoinstall).
- Danach idempotente Provisionierung (Skripte oder Ansible-Playbook aus diesem Repo), wiederholbar.
- Registrierung der Box am Server über ein **Einmal-Token** → Box erhält eigene Zugangsdaten + WireGuard-Konfig.
- Container-Images werden in CI gebaut (amd64), versioniert und in einer Registry abgelegt (Ort offen, siehe Fragen).
- Updates: Server gibt „Soll-Version“ vor, Agent aktualisiert **nur außerhalb von Events**, Healthcheck → automatischer Rollback.
- Ziel: neue Box von leerer SSD bis einsatzbereit ohne manuelle Schritte außer „Stick rein, Token eingeben“.

### 4.2 Performance & Bildpipeline
- Messen vor Optimieren (Zeiten pro Schritt: Auslösen → Download von der 750D → Anzeige → Druck).
- Pipeline mit **libvips** statt PHP-GD.
- Nach der Aufnahme sofort eine **Anzeige-Version inkl. Rahmen/Text** in Bildschirmauflösung (Ziel < 0,5 s).
- Parallel im Hintergrund: **Druck-Version in nativer DS620-Auflösung**, Thumbnail, Upload-Version.
- Druck-Button schickt die vorbereitete Datei direkt an CUPS. Ist sie noch nicht fertig, wartet der Job darauf.
- Original in voller Auflösung bleibt erhalten (für die Nachbearbeitung in LightCraft).
- 750D: Speicherziel (Kamera-RAM vs. SD-Karte) und JPEG-Größe beim Messen vergleichen.

### 4.3 Layouts
- Einzelfoto 4x6
- Collage (bestehende Layouts übernehmen)
- **2x6-Fotostreifen** (zwei Streifen auf einem 4x6-Blatt, DS620 schneidet) – als buchbare Option im Paket

### 4.4 Konfiguration
Ebenen (von unten nach oben, spätere überschreiben frühere):
1. **Standardwerte** (im Image)
2. **Geräte-Einstellungen** (Drucker, Kamera, Display, Ringlicht-URL, Buzzer-Taste) – selten geändert
3. **Event-Einstellungen** vom Server (Hintergrund, Farben, Zeiten, Collage/Streifen, Drucker an/aus, Galerie, Druckkontingent aus Paket …)
4. **Lokale Änderungen** über das versteckte Menü (werden an den Server gemeldet)

- Beim Hochfahren und periodisch holt der Agent das Profil des aktuellen Events vom Server.
- Bilder (Hintergründe, Rahmen, Logos) werden mit Prüfsumme geladen und lokal vorgehalten.
- Kein Internet → zuletzt erfolgreich geladenes Profil, sonst Standard-Profil.
- Profile sind versioniert; die Box meldet, welche Version aktiv ist.

### 4.5 Verstecktes Menü am Display
- Öffnen über eine unauffällige Geste (z. B. 5× in eine Ecke tippen oder langes Drücken).
- Ziffernblock auf dem Touchscreen.
- **Persönliche PIN pro Person** (Patrick, später Mitarbeitende), vom Server verteilt, lokal nur als Hash.
  Damit ist jede Aktion einer Person zugeordnet.
- Sperre nach mehreren Fehlversuchen, Protokollierung jedes Zugriffs.
- Inhalt: Druckzähler/Kontingent erhöhen, Kamera-Testbild, Netzwerkstatus, Selbsttest/Checkliste, Profil neu laden, Neustart.

### 4.6 Fernwartung & Telemetrie
- Kameraeinstellungen lesen/setzen (ISO, Blende, Zeit, WB …), Testfoto, Live-View in niedriger Auflösung.
- Screenshot des Kiosk-Bildschirms auf Abruf.
- Heartbeat + Status: Kamera, Drucker, Medienrest DS620, Speicher, Temperatur, Netz, aktive Version, Druckzähler.
- Logs aller Dienste gesammelt und gepuffert an den Server.
- Alarme (z. B. Drucker ohne Papier, Kamera getrennt, Box offline).
- Befehle vom Server über eine ausgehende WebSocket-Verbindung (Neustart Dienst, Profil laden, Screenshot …).
- SSH nur über WireGuard.

### 4.7 Sicherheit
- Kommunikation Box ↔ Server: TLS, **jede Box ein eigener Keycloak-Client** (Client Credentials), einzeln sperrbar.
- WireGuard auf dem Hetzner-Server für Admin-Zugriff.
- Lokales Netz gilt als vertrauenswürdig (E4); Admin-Funktionen trotzdem hinter PIN.
- Befund im Backend: `GET /api/v1/booking/*` ist öffentlich (`SecurityConfig.java`) – prüfen, ob dadurch Kundendaten abrufbar sind.

### 4.8 Online-Galerie & Abschluss
- Fotos werden laufend hochgeladen (persistente Warteschlange, übersteht Stromausfall und Funklöcher).
- Galerie pro Buchung wird im Backend automatisch angelegt; QR-Code auf der Box zeigt dorthin.
- Event-Abschluss: Abgleich „alle Fotos hochgeladen“, Statistik (Fotos, Drucke), Bericht für den Kunden (ggf. mit Rechnung).
- Lokale Fotos werden erst nach bestätigtem Upload und Frist gelöscht.

### 4.9 Selbsttest & Aufbau-Checkliste
- Automatische Prüfungen: Kamera, Testfoto, Drucker + Medium, Ringlicht, Buzzer, Netz, Profil geladen.
- Manuelle Punkte aus **Checklisten-Vorlagen, die mit Paketen verknüpft sind** (z. B. Requisiten aufgestellt, Hintergrund aufgebaut).
- Wer aufbaut, meldet sich per persönlicher PIN an; Ergebnis wird mit Zeitstempel protokolliert und an den Server übertragen.

### 4.10 Bestehende Funktionen, die bleiben müssen
- **Ringlicht:** heute über die Einstellung „GET-Request“ (`get_request.countdown`). Der Browser ruft
  `<server>/CNTDWNPHOTO` bzw. `/CNTDWNCOLLAGE` beim Countdown-Start auf (`assets/js/core.js`), optional auch nach der Verarbeitung.
  Bleibt erhalten; ESP-Adresse wird Geräte-Einstellung. Nicht blockierend, kurzes Timeout, Fehler nur loggen.
  Achtung: Läuft die Oberfläche künftig über HTTPS, blockiert der Browser HTTP-Aufrufe an den ESP → Aufruf dann serverseitig auslösen.
- **Buzzer:** Presenter ist eine USB-Tastatur; Tasten landen im Kiosk-Browser auf dem Grundsystem.
- **Druckkontingent:** bleibt einstellbar, Wert kommt aus dem Paket (200/400), lokal erhöhbar über PIN-Menü.
- **Stromausfallsicherheit:** Heute speichert die Software ihre JSON-Datenbank nicht atomar (`DatabaseManagerService`, `file_put_contents`)
  → kann bei Stromverlust beschädigt werden. Ersatz: SQLite (WAL) oder atomares Schreiben.

### 4.11 Zuverlässigkeit (24–48 h)
- Hardware-Watchdog, Neustart-Richtlinien für alle Container.
- Kamera-Selbstheilung (Neuverbindung, ggf. USB-Port stromlos schalten).
- Kiosk-Browser im Leerlauf (Bildschirmschoner) kontrolliert neu laden gegen Speicherwachstum.
- Tests: Unit, Integration mit gphoto2-Dummy-Kamera und virtuellem CUPS-Drucker, E2E auf der Kiosk-UI,
  **Dauertest 48 h**, **Stromausfall-Tests** (harter Reset während Aufnahme, Druck, Upload, Config-Update).

### 4.12 Neue Oberflächen (Gäste und Admin)
Beide Oberflächen werden in Angular neu gebaut, mit einem gemeinsamen Design-System (Farben, Schriften, Bausteine).

**Admin-Oberfläche (früher, Paket 7):** modern, übersichtlich, auf Touchscreen, Handy und Laptop bedienbar.
Enthält auch das versteckte PIN-Menü am Touchscreen und den Selbsttest. Feier-spezifische Einstellungen werden
weiterhin im Backend gepflegt; die Admin-Oberfläche zeigt sie an und erlaubt lokale Ausnahmen (Ebene 4 in 4.4).

**Gäste-Oberfläche (Paket 9):**
- **Responsiv:** sauber auf dem Touchscreen der Box, aber auch auf anderen Auflösungen und im Hoch- wie Querformat.
- **Neues, hochwertiges Design** statt des bisherigen Photobooth-Looks.
- **Pro Feier anpassbar:** Hintergrund, Farben, Schriften, Logo/Begrüßungstext, Rahmen usw. kommen aus dem
  Event-Profil (Abschnitt 4.4). Die Gäste-Oberfläche wird dafür von vornherein als Theme mit klaren Stellschrauben gebaut,
  sodass sich eine Feier ohne Code-Änderung umgestalten lässt.

### 4.13 Bild-Look per Preset (Idee, in Prüfung)
Fotos sollen direkt mit Patricks Bearbeitungs-Preset (LightCraft) aus der Box kommen, damit die Nachbearbeitung entfällt.
- **Ansatz:** Das Preset wird einmalig in eine Farb-Nachschlagetabelle (3D-LUT, z. B. als HaldCLUT-Bild) umgewandelt:
  Ein Testbild mit allen Farben wird in LightCraft mit dem Preset bearbeitet und exportiert. Die Bildpipeline wendet
  diese Tabelle auf jedes Foto an – schnell, ohne LightCraft auf der Box.
- **Übertragbar:** alle globalen Farb- und Tonwertänderungen (Belichtung, Kontrast, Weißabgleich, Farbtöne, Gradationskurven, Sättigung, Farblooks).
- **Nicht übertragbar:** ortsabhängige Bearbeitungen (Masken, Vignette, Schärfen, Rauschreduzierung, Zuschnitt) und
  automatische Korrekturen pro Foto. Belichtungsunterschiede zwischen Locations regelt man über die Kameraeinstellungen (Fernwartung).
- **Verwaltung:** Looks über die Admin-Oberfläche und später das Backend hochladen, pro Feier auswählen, aus der Ferne wechseln.
- Das Original bleibt immer unbearbeitet erhalten.
- **Erster Test (2026-11-20)** mit dem Preset „Fotobox Look“ und zwei Testfotos: Bei einem Foto mit normalen Farben
  trifft die Farbtabelle das Preset gut (mittlere Farbabweichung ΔE ≈ 3–4, mit bloßem Auge nur im direkten Vergleich
  sichtbar). Bei einem extrem grünen Foto wird das Ergebnis heller und blasser als in LightCraft (ΔE ≈ 12–13).
  Ursache: LightCraft passt einige Regler an den Bildinhalt an; „Lichter“/„Tiefen“ arbeiten zusätzlich ortsabhängig.
  Schärfen (15), Rauschreduzierung (10) und Vignettierungs-Korrektur (30) im Preset sind ebenfalls ortsabhängig.
  **Nächster Schritt:** Test mit 5–10 echten Fotos einer früheren Feier. Alternative, falls die Abweichung zu groß ist:
  LightCraft ohne Oberfläche (headless) auf der Box für Galerie- und Druckversion – nur, wenn es unter Linux läuft.

### 4.14 Erweiterbarkeit (später)
- Geräteübersicht für mehrere Boxen.
- Geräte-Protokoll so allgemein, dass später andere vermietbare Gegenstände dazukommen können.
- Automatische Nachbearbeitung mit LightCraft (ferne Zukunft).

---

## 5. Erweiterungen im Backend (für den Backend-Agenten)
- **Gerät** (Device) mit Zugangsdaten/Keycloak-Client, angehängt an `BookableAssetModel`.
- **Zuordnung Buchung ↔ konkretes Gerät** (fehlt heute; Buchung kennt nur Produkte).
- **Mitarbeitende** (Keycloak-Rolle), Zuweisung Buchung ↔ Mitarbeiter, persönliche PIN für die Box.
- **Event-Profil** (Design-Konfiguration + Bilder) pro Buchung, Vorlagen pro Paket.
- **Druckkontingent und Layouts (Collage, 2x6-Streifen) pro Paket.**
- **Checklisten** als eigenes Modell: Vorlage mit Punkten, verknüpft mit Paketen; Durchlauf pro Buchung mit Ergebnis je Punkt, Person, Zeitstempel.
- Upload-API und Galerie pro Buchung (`instantview` existiert schon als Ansatz).
- Telemetrie, Logs, Alarme, Befehle, Soll-Versionen.
- Event-Abschlussbericht.
- **Migration:** bestehende Buchungen bleiben vollständig erhalten; neue Felder per Flyway mit Standardwerten bzw. nachträglicher Zuordnung.
- Abhängigkeit: Umbau Zubehör → Pakete läuft im Backend ohnehin; Checklisten und Kontingente erst danach an Pakete hängen.

---

## 6. Offene Fragen
Derzeit keine. (Geklärt: E15, E16)

## 6b. Entwicklung und Tests ohne Box
Entwickelt und getestet wird auf dem Laptop; die Box kommt erst für Hardware-Abnahmen dazu.

| Box-Teil | Ersatz auf dem Laptop |
|---|---|
| Canon 750D | Kamera-Simulator im `camera`-Dienst (liefert echte Beispielfotos mit realistischen Verzögerungen, simuliert Fehler wie „Kamera getrennt“) |
| DNP DS620 | virtueller CUPS-Drucker, der Druckaufträge als Datei ablegt (Inhalt, Auflösung, Schnitt prüfbar) |
| Kiosk + Touchscreen | Chrome auf dem Laptop, Touch per Playwright simuliert |
| Buzzer | Tastendruck (gleiche Taste wie konfiguriert) |
| Ringlicht-ESP | Mock-Endpunkt, der jeden GET-Aufruf protokolliert |
| Backend | Mock-Server nach `contracts/device-api.yaml` |
| LTE-Ausfall | Netz zum Mock-Server per Test gezielt trennen |
| Stromausfall | Container hart beenden (`docker kill`) mitten in Aufnahme, Druck, Upload, Config-Update |
| ThinkCentre (x86) | CI auf GitHub-Runnern (amd64) baut und testet die echten Images |

**Was nur an der Box geht** (Abnahme):
- Kamera per USB im Container, Druckzeiten und 2x6-Schnitt am DS620, Touchscreen, Presenter, ESP, LTE
- echte Stromausfälle (Stecker ziehen), 48-h-Dauertest, BIOS-Einstellung
- Performance-Messungen (der Laptop ist schneller und ggf. ARM statt x86 → Laptop-Werte nur für Vergleiche)

**Zwei Abnahmen statt einer am Ende:**
1. **Früh, nach Paket 2:** kritische Annahmen prüfen – Kamera-USB im Container, CUPS → DS620 aus dem Container, Kiosk, Ringlicht.
   Wenn hier etwas nicht klappt, soll es früh auffallen, nicht nach Monaten.
2. **Am Ende:** vollständige Abnahme mit Dauertest und Stromausfall-Tests.

**Altsystem bleibt unangetastet:** Für die Abnahmen eine zweite SSD verwenden. Zurück zum alten Stand = SSD tauschen.
Die Box bleibt so jederzeit vermietbar.

## 6a. BIOS-Einstellungen am ThinkCentre (einmalig, manuell)
Lassen sich unter Linux nicht zuverlässig per Skript setzen, daher Teil der Einrichtungs-Checkliste:
- **„After Power Loss“ → „Power On“** – sonst bleibt die Box nach gezogenem Stecker aus. Wichtigste Einstellung!
- Boot-Reihenfolge: interne SSD zuerst (USB nur für die Erstinstallation)
- Optional: Wake-on-LAN aus, Secure Boot passend zum gewählten OS

---

## 6c. Fortschritt

| Datum | Stand |
|---|---|
| 2026-11-20 | Paket 5, Teil 1: Neue Bildpipeline. Render-Dienst (TypeScript, libvips) für Einzelfoto und Druck: Gast sieht sein Foto nach 0,5 s statt 2,2 s, Druckbild liegt in DS620-Auflösung bereit, Galerie 3000 px. Look aus LightCraft-Preset (ΔE 1,9 am echten Foto) inkl. Vignettierungs-Korrektur. Rückfall auf GD für noch nicht unterstützte Einstellungen. Details: `planning/BILDPIPELINE.md`. |
| 2026-11-20 | Paket 4: Aufräumen. Entfernt: E-Mail-Versand (inkl. PHPMailer, virtuelle Tastatur), Video-Aufnahme, Chroma-Key (inkl. Keying, Seriously.js), KI-Hintergrundentfernung (rembg), Bildfilter, Windows-Unterstützung, alter Installer (`install-photobooth.sh`), DDEV. Live-Vorschau, Bildschirmschoner- und Hintergrundvideo bleiben. Neu: Oberflächentests im Browser (Playwright, 15 Tests: Foto per Touch und Buzzer, Ringlicht, Druck, Collage, Galerie, Admin speichern, alle Seiten ohne JS-/Server-Fehler), `tests/run-all.sh`, Sicherheitsupdates für symfony/config, symfony/filesystem, phpseclib. Rund 8.700 Zeilen weniger. |
| 2026-11-14 | Vorbereitung frühe Abnahme: Anleitung `planning/ABNAHME-BOX.md`, Prüfskript `snaphora-check` auf der Box. Dabei gefunden und behoben: PHP lief im Image ohne Gruppe `plugdev` und hätte die Kamera an der Box nicht ansprechen dürfen. |
| 2026-11-14 | Paket 3: Stromausfallsichere Datenhaltung. Alle dauerhaften Schreibvorgänge atomar (temporäre Datei + fsync + rename): Bild-Datenbank, Konfiguration, Druckzähler, Bilder/Vorschaubilder, Themes, Collage-Layouts. Selbstreparatur: beschädigte Datenbank wird aus den Bildern neu aufgebaut; beschädigte Konfiguration → letzte gute Version (`my.config.inc.php.bak`); beschädigter Druckzähler → Zählung aus dem Druckprotokoll; abgeschnittene Protokollzeilen bleiben zählbar. Gegencheck mit altem Code: Galerie verlor alte Fotos, Druckkontingent fiel auf 0, Box antwortete mit Fehler 500 – mit neuem Code alles repariert. Neue Tests: 25 Unit-Tests, Selbstreparatur-Test, Absturztest (20 harte Abbrüche ohne Schaden), alle in CI. |
| 2026-11-14 | Paket 2, Teil B: Grundsystem. USB-Installer (Debian 13 Preseed, löscht nur nach Auswahl im Menü), idempotentes `provision.sh`, Kiosk (cage + Chromium, Profil im RAM), CUPS + Gutenprint DS620, udev-Kamerafreigabe, Watchdog, fsck-Autoreparatur, SSH nur mit Schlüssel. Getestet: zwei Läufe in frischem Debian 13 (ohne systemd), ISO-Bau inkl. Bootfähigkeit UEFI/BIOS. **Nicht getestet:** echte Installation, Kiosk-Anzeige, Drucker/Kamera – folgt bei der frühen Abnahme. |
| 2026-11-14 | Paket 2, Teil A: Produktions-Image (mehrstufig, nichts wird auf der Box gebaut), Dev-Umgebung mit Kamera-, Drucker- und Ringlicht-Simulator, Box-Compose mit USB/CUPS-Anbindung, CI baut und testet, veröffentlicht nach GHCR. Smoke-Test Auslösen → Verarbeiten → Drucken läuft. |

Erste Laptop-Werte (Apple Silicon, nur zum Vergleich, nicht repräsentativ für die Box):
Auslösen 1,8 s (simuliert) · Verarbeiten 1,6 s (24 MP, ohne Rahmen) · Druckdatei 0,4 s.

Erledigt (2026-11-14): Workflows, Vorlagen und Crowdin-Anbindung des Original-Projekts entfernt;
verbleibend: `box-image.yml` (Smoke-Test + Image), `build.yml` (Lint, PHPStan, PHPUnit, nur Linux),
`linters.yaml` (Pre-commit inkl. Shellcheck für Snaphora-Skripte). Update-Abfrage beim Original-Projekt abgeschaltet.

Offene Punkte für das Aufräumen:
- Reboot/Shutdown aus der Oberfläche funktionieren im Container nicht → übernimmt später der Agent
- Doku/FAQ des Original-Projekts (`docs/`, `faq/`, `mkdocs_remote.yml`, Handbuch-Texte),
  `CONTRIBUTING.md`/`SECURITY.md` mit Verweisen aufs Original; Übersetzungstexte der entfernten Funktionen
- Noch zu klären, ob genutzt: Fernauslöser/GPIO (remotebuzzer), Selfie-Upload, USB-Stick-Sync,
  FTP-Upload, „Custom“-Aufnahme, Diashow, Bildschirmschoner
- Performance: Galerie und Diashow laden bei vielen 24-MP-Fotos spürbar langsamer (Paket 5)

## 7. Arbeitspakete (Reihenfolge, Entwurf)
1. Bestandsaufnahme: Zeitmessung der Pipeline, Ist-Verhalten bei Stromausfall, nicht genutzte Funktionen markieren
2. Fundament: Provisionierung, Container-Images aus CI, Kiosk, CUPS, WireGuard
3. Stromausfallsichere Datenhaltung + Testumgebung (Dummy-Kamera, virtueller Drucker, Dauertest)
4. Aufräumen: Filter, Chroma-Key, Video, Mail usw. entfernen
5. Neue Bildpipeline (Anzeige sofort, Druck vorbereitet) inkl. 2x6-Streifen
6. Agent: Registrierung, Config-Sync mit Ebenen, Offline-Fallback, Upload-Queue (gegen Mock-Server)
7. Neue Admin-Oberfläche in Angular (4.12) inkl. verstecktem PIN-Menü, Selbsttest und Checkliste
8. Fernwartung: Kamera-Remote, Screenshot, Logs, Telemetrie, Befehle, Updates mit Rollback (gegen Mock-Server)
9. Neue Gäste-Oberfläche in Angular (responsiv, neues Design, pro Feier anpassbar – 4.12), PHP schrittweise entfernen
10. **Abschluss Box:** Vertrag einfrieren, `BACKEND_SCHNITTSTELLEN.md` für den Backend-Agenten erstellen
11. Backend umsetzen (separat), danach Vertragstests gegen das echte Backend und Umstellung der Box vom Mock auf den Server

Ab Paket 6 wird der Vertrag `contracts/device-api.yaml` laufend erweitert.
