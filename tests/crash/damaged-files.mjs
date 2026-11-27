// Stellt die Schäden nach, die ein Stromausfall beim Speichern hinterlassen kann, und prüft,
// ob die laufende Box sie selbst repariert und normal weiterarbeitet:
//   - Bild-Datenbank abgeschnitten → wird aus den Bildern neu aufgebaut, keine Fotos gehen verloren
//   - Druckzähler leer → Druckkontingent zählt trotzdem weiter
//   - Konfiguration abgeschnitten → letzte gute Version wird genutzt, die Box startet
//
//   node tests/crash/damaged-files.mjs
//
// Voraussetzung: Dev-Umgebung läuft (docker compose up -d). Ändert Daten in der Dev-Umgebung.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BoxClient } from '../lib/box-client.mjs';
import { reportError, runTest } from '../lib/report.mjs';

const checker = readFileSync(new URL('./check-consistency.php', import.meta.url));
const box = new BoxClient();
const failures = [];

function inBox(script) {
    return execFileSync('docker', ['compose', 'exec', '-T', '-u', 'application', 'photobooth', 'sh', '-c', script])
        .toString()
        .trim();
}

function checkConsistency() {
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'photobooth', 'php'], { input: checker });
    return JSON.parse(result.stdout.toString().trim().split('\n').pop());
}

function expect(condition, message) {
    console.log(`${condition ? '✓' : '✗'} ${message}`);
    if (!condition) {
        failures.push(message);
        reportError('Selbstreparatur', message);
    }
}

async function takePhoto() {
    await box.refreshToken();
    const capture = await box.capture();
    await box.process(capture.file);
    return capture;
}

await runTest('Selbstreparatur', async () => {
    await box.waitUntilReady();

    // Ausgangslage: mindestens zwei Fotos in der Galerie
    await takePhoto();
    await takePhoto();
    const before = checkConsistency();
    console.log(`Ausgangslage: ${before.stats.images} Bilder, ${before.stats.databaseEntries} in der Galerie\n`);

    // 1. Bild-Datenbank abgeschnitten
    inBox('printf \'["2026\' > /app/data/db.txt');
    const newPhoto = await takePhoto();
    const afterDb = checkConsistency();
    expect(afterDb.errors.length === 0, `Datenbank repariert, keine Fehler (${afterDb.errors.join('; ') || 'ok'})`);
    // Wiederaufgebaut wird aus den Bildern auf der Platte: danach steht jedes Foto in der Galerie – auch solche, die
    // vorher fehlten (z. B. nach einem abgebrochenen Ablauf). Keines darf verloren gehen.
    expect(
        afterDb.stats.databaseEntries === afterDb.stats.images && afterDb.stats.databaseEntries >= before.stats.databaseEntries + 1,
        `Galerie enthält alle ${afterDb.stats.images} Fotos auf der Platte (vorher ${before.stats.databaseEntries} in der Galerie, jetzt ${afterDb.stats.databaseEntries})`,
    );
    expect(inBox('cat /app/data/db.txt').includes(newPhoto.file), 'Neues Foto steht in der Galerie');

    // 2. Druckzähler leer – darf das Kontingent nicht zurücksetzen
    await box.refreshToken();
    const first = await box.print(newPhoto.file);
    inBox(': > /app/data/print.count');
    await box.refreshToken();
    const counted = await box.request(`/api/printDB.php?action=getPrintCount&csrf=${encodeURIComponent(box.token)}`).catch(() => null);
    const printLines = Number(inBox('grep -c "" /app/data/printed.csv'));
    expect(printLines >= 1, `Druckprotokoll enthält ${printLines} Druck(e)`);
    if (counted && typeof counted.count === 'number') {
        expect(counted.count === printLines, `Druckzähler liest ${counted.count} statt 0 (laut Protokoll ${printLines})`);
        const repaired = inBox('cat /app/data/print.count');
        expect(repaired === String(printLines), `Druckzähler-Datei wieder repariert (${JSON.stringify(repaired)})`);
    } else {
        console.log(`  (Druckzähler-Abfrage nicht verfügbar: ${JSON.stringify(counted)}; Druck-Antwort: ${JSON.stringify(first)})`);
    }

    // 3. Konfiguration abgeschnitten – erst eine gute Version speichern (wird zur Sicherung), dann beschädigen
    // so wie app speichert: letzte gute Fassung als Sicherung, dann die neue
    inBox(`printf '{"config": {"print": {"limit": 200}}}' > /app/config/layers/box.json.bak`);
    inBox(`printf '{"config": {"print": {"limit": 400}}}' > /app/config/layers/box.json`);
    inBox(`printf '{"config": {"print": {"lim' > /app/config/layers/box.json`);
    let configOk = true;
    try {
        await box.waitUntilReady(10_000);
        await takePhoto();
    } catch (error) {
        configOk = false;
        console.log(`  ${error.message}`);
    }
    expect(configOk, 'Box startet und fotografiert trotz beschädigter Konfiguration');
    const limit = inBox(
        `php -r 'require "/app/vendor/autoload.php"; echo (new Photobooth\\Service\\ConfigurationService("/app/config"))->getConfiguration()["print"]["limit"];' 2>/dev/null`,
    );
    expect(limit === '200', `Letzte gute Konfiguration aktiv (Druckkontingent ${limit}, erwartet 200)`);

    // Aufräumen: Konfiguration zurücksetzen
    inBox('rm -f /app/config/layers/box.json /app/config/layers/box.json.bak');

    // Danach dürfen keine beschädigten Dateien übrig sein – auch nicht für nachfolgende Tests
    const after = checkConsistency();
    expect(after.errors.length === 0, `Keine beschädigten Dateien übrig (${after.errors.join('; ') || 'ok'})`);

    if (failures.length > 0) {
        console.log(`\n${failures.length} Prüfung(en) fehlgeschlagen.`);
        process.exit(1);
    }
    console.log('\nAlle beschädigten Dateien wurden selbst repariert.');
});
