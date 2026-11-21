# Neue Bildpipeline (Arbeitspaket 5) – Messung und Entwurf

> Stand: 2026-11-20 · Einzelfoto, Druck, Collage, Fotostreifen und Text umgesetzt (Abschnitte 4 und 5)

## 1. Messung heute (PHP-GD)

Gemessen auf dem Entwicklungsrechner in der Dev-Umgebung, Fotos in 750D-Auflösung (6000×4000),
Median aus 3 Läufen (`node tests/bench/pipeline.mjs`). Die Box ist vermutlich 2–3× langsamer.

| Schritt | heute |
|---|---|
| Foto verarbeiten, ohne Rahmen | 0,33 s |
| Foto verarbeiten, mit Rahmen | 2,0–2,6 s |
| Foto verarbeiten, mit Rahmen + Text | 2,0 s |
| Collage (4 Fotos) verarbeiten | 1,6 s |
| Druckbild erstellen (Rahmen, QR, Text) | 1,8 s – **danach rechnet CUPS das 6000-px-Bild noch auf Druckgröße herunter** |

**Wo die Zeit hingeht:** Mit Rahmen wird das komplette 24-MP-Bild dekodiert, mit dem auf 6000 px
hochskalierten Rahmen verrechnet und mit Qualität 100 neu kodiert – bevor der Gast irgendetwas sieht.
Beim Drucken passiert dasselbe noch einmal, und der Drucker braucht am Ende nur 1844×1240 Pixel.

## 2. Vergleich mit libvips (sharp)

Dieselben Schritte mit libvips, gleicher Rechner, Linux-Container, **ein Kern** (`tests/bench/run-sharp.sh`):

| Schritt | libvips |
|---|---|
| Anzeigebild 1920 px mit Rahmen + Text | **0,33 s** |
| Vorschaubild 500 px | 0,07 s |
| Volle Auflösung 6000 px mit Rahmen | 1,3 s |
| Druckbild 1844×1240 mit Rahmen, QR, Text | **0,33 s** |
| 2×6-Fotostreifen (4 Fotos, doppelt auf einem Blatt) | 0,13 s |

**Erkenntnis:** Der größte Gewinn kommt nicht vom schnelleren Werkzeug allein, sondern davon, für jeden
Zweck **nur die nötige Auflösung** zu rechnen und teure Arbeit **im Hintergrund** zu erledigen:
Der Gast sieht sein Foto mit Rahmen nach ~0,3 s statt ~2,5 s (Box: geschätzt < 1 s statt 5–7 s),
das Druckbild ist ~5× schneller fertig und CUPS muss nichts mehr herunterrechnen.

## 3. Entwurf

### Ablauf nach dem Auslösen

```
Kamera ──► Original (unverändert, 24 MP)              ← bleibt für die Nachbearbeitung in LightCraft
              │
              ├─ sofort ──► Anzeigebild (Bildschirmgröße, Look, Rahmen + Text)  ──► Gast sieht sein Foto
              │
              └─ im Hintergrund (Warteschlange, übersteht Stromausfall):
                    ├─ Vorschaubild (Galerie)
                    ├─ Galerie-/Download-Version (Look, Rahmen + Text, z. B. 3000 px)
                    └─ Druckbild in DS620-Auflösung (Look, 4×6 oder 2×6-Streifen, Rahmen, QR, Text)

„Drucken“ ──► Druckbild fertig? ── ja ──► sofort an CUPS (ohne Skalierung)
                                └─ nein ─► wartet auf den Hintergrundjob (Sekundenbruchteile)
```

### Bausteine

- **Neuer Dienst `render`** (TypeScript, sharp/libvips) als eigener Container im internen Docker-Netz.
  Erster Baustein der neuen TypeScript-Welt (Konzept E10).
- **Auftragswarteschlange** dateibasiert und atomar (wie in Paket 3): Ein Auftrag, der beim Stromausfall
  unterbrochen wurde, wird nach dem Neustart einfach erneut ausgeführt.
- **Layouts als Daten** (Einzelfoto, Collage-Layouts, Streifen): dieselben Beschreibungen für Anzeige,
  Galerie und Druck. Die bestehenden Collage-Layouts werden übernommen.
- **Schrittweise Umstellung:** Die PHP-API ruft für die Verarbeitung den `render`-Dienst statt GD auf.
  Oberfläche und Abläufe bleiben gleich, bis die neue Gäste-Oberfläche (Paket 9) kommt.
- **Druck:** Druckbild exakt in DS620-Auflösung, `lp` ohne `fit-to-page`; 2×6 über die Schneidefunktion
  des DS620 (Gutenprint-Option, wird bei der Abnahme an der Box geprüft).
- **Tests:** Pixelvergleich der Ausgaben (Rahmen, Text, QR an der richtigen Stelle), Zeitbudget-Tests,
  Stromausfall mitten in einem Hintergrundauftrag.

### Vorschläge, die du bestätigen solltest

| # | Vorschlag | Warum |
|---|---|---|
| P1 | Das **Original bleibt unverändert** gespeichert, die Version mit Rahmen ist eine eigene Datei | Für LightCraft willst du das Foto ohne Rahmen; heute wird das Original nur in `data/tmp` aufgehoben |
| P2 | Galerie/Download/Upload in **3000 px** (Rahmen + Text) statt voller Auflösung | ~4× kleinere Dateien: schnellere Galerie (heute 12–14 s Ladezeit bei 39 Fotos), weniger LTE-Datenvolumen beim späteren Upload; für Handy-Bildschirme mehr als genug |
| P3 | **2×6-Streifen** als eigene Aufnahmeart (4 Fotos), zwei identische Streifen pro Blatt | Ein Blatt 4×6 = zwei Streifen, der DS620 schneidet; Kontingent zählt 1 Blatt |
| P4 | Reihenfolge: zuerst **Einzelfoto + Druck** umstellen, dann Collage, dann Streifen | Schnellster spürbarer Gewinn, Collage-Layouts sind der aufwendigste Teil |
| P5 | **Look** (Bearbeitungs-Preset als Farbtabelle) als fester Schritt vor Rahmen und Text, pro Feier wählbar | Fotos kommen fertig bearbeitet aus der Box (Konzept 4.13); Original bleibt unbearbeitet |

## 4. Umsetzung (Stand 2026-11-20)

**Umgesetzt:** Render-Dienst `services/render` (TypeScript, sharp/libvips) als eigener Container.

| | vorher (GD) | jetzt | jetzt mit Look „Fotobox Look“ |
|---|---|---|---|
| Foto verarbeiten, bis der Gast es sieht | 2,2 s | **0,5 s** | **0,7 s** |
| Druckbild 1844×1240 bereit | erst beim Drucken, 1,8 s + CUPS-Skalierung | 0,2 s nach dem Foto, im Hintergrund | 0,5 s nach dem Foto |
| Galerie-Version 3000 px | – (volle Auflösung) | 1,1 s im Hintergrund | 1,6 s im Hintergrund |

(Entwicklungsrechner, Box vermutlich 2–3× langsamer.)

- Einzelfotos inkl. Rahmen und Rahmen-Erweiterung, Look, Vorschaubild, Galerie-Version, Druckbild mit Rahmen und QR-Code.
- Hintergrundaufträge in einer dateibasierten Warteschlange; Druckbild vor Galerie-Version.
- Was der Dienst noch nicht kann, läuft automatisch über GD: Text auf Foto/Druck, Polaroid, Drehen, Spiegeln,
  eigener Druck-Zuschnitt, Collagen. Ist der Dienst nicht erreichbar, ebenfalls GD.
- Look-Auswahl in der Admin-Oberfläche unter „Bildpipeline“; Looks liegen als Ordner im Look-Verzeichnis
  (Dev: `.dev/looks/`, Box: Volume `looks`).

**Look „Fotobox Look“:** am echten Feier-Foto gegen LightCraft geprüft – mittlere Farbabweichung ΔE 1,9
(Median 0,9), Vignettierungs-Korrektur trifft LightCraft genau. Werkzeug: `services/render/tools/look-from-lightcraft.ts`.
Der Look liegt nur lokal (`.dev/looks/`), nicht im öffentlichen Repo.

**Offen / als Nächstes:** siehe Abschnitt 5.

## 5. Collage, Fotostreifen, Text (Stand 2026-11-20)

**Umgesetzt:**
- **Collagen** im Render-Dienst mit denselben Layout-Dateien wie bisher (inkl. eigener Layouts in `private/`):
  Plätze, Drehung, Rahmen pro Foto oder einmal über die Collage, Hintergrundfarbe/-bild, Platzhalter-Bild.
  Die App rechnet das Layout aus (`Collage::renderSpec`), der Dienst setzt zusammen.
- **Fotostreifen** = die vorhandenen Layouts „2x3“ und „2x4“: gleiche Fotos zweimal nebeneinander, Schnittlinie.
  Beim Druck hängt die App die Schneide-Option an `lp` an (Einstellung „Druckoption für Fotostreifen“,
  Standard `-o PageSize=w288h432-div2` – **an der Box mit dem DS620 prüfen**).
- **Text** auf Foto, Collage (inkl. Textfeldern mit automatischer Größe und doppeltem Text auf Streifen) und Druck:
  Die App zeichnet den Text mit der bisherigen GD-Logik auf eine durchsichtige Ebene in Zielgröße, der Dienst legt
  sie auf – Schrift, Größe und Position bleiben exakt wie bisher.
- **Druck** baut jetzt wie früher auf dem fertigen Bild auf (Rahmen, Text), darauf Druck-Rahmen, QR-Code, Druck-Text.
- Bildvergleich alt/neu für Collage mit Text und Fotostreifen: gleiches Ergebnis.

| | vorher (GD) | jetzt |
|---|---|---|
| Foto ohne Rahmen | 0,33 s | 0,23 s |
| Foto mit Rahmen | 2,57 s | 0,49 s |
| Foto mit Rahmen + Text | 1,99 s | 0,69 s |
| Collage (4 Fotos, mit Text) | 1,62 s | 0,96 s |
| Druckbild (Rahmen, QR, Text) | 1,82 s + CUPS-Skalierung | 0,68 s, in Druckerauflösung |

(Entwicklungsrechner, Median aus 3 Läufen, `node tests/bench/pipeline.mjs`.)

**Noch über GD (automatischer Rückfall):** Polaroid-Effekt, Drehen/Spiegeln des Fotos, eigener Druck-Zuschnitt,
Vorschau-Collage zwischen den Aufnahmen (während der Collage-Aufnahme).

**Offen / als Nächstes:**
- An der Box prüfen: DS620-Schneide-Option, Druckzeiten, Darstellung am Touchscreen
- Vignette vollständig entfernen per Flat-Field (weiße Wand fotografieren), als Teil des Looks
- Polaroid, Drehen/Spiegeln im Render-Dienst
- LightCraft ohne Oberfläche als Alternative, falls ein Preset ortsabhängige Effekte braucht
- Looks über Admin-Oberfläche und später Backend hochladen
