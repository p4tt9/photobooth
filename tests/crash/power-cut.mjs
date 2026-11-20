// Absturztest: App und Render-Dienst werden mitten im Ablauf (Auslösen, Verarbeiten, Drucken) hart beendet –
// wie bei einem gezogenen Stecker – und danach neu gestartet. Anschließend wird geprüft,
// ob die gespeicherten Daten intakt sind und die Box weiterarbeitet.
//
//   node tests/crash/power-cut.mjs
//
// Voraussetzung: Dev-Umgebung läuft (docker compose up -d).
//
// Umgebungsvariablen:
//   ITERATIONS   Anzahl Abbrüche (Standard 15)
//   MAX_DELAY_MS Spätester Abbruchzeitpunkt nach dem Auslösen (Standard 4500)
//   SEED         Startwert für die Zufallszeitpunkte (reproduzierbar)
//
// Grenze: `docker kill` beendet die Prozesse sofort, der Inhalt des Dateisystem-Caches bleibt aber erhalten.
// Einen echten Stromausfall (Cache geht verloren) prüft erst der Test an der Box.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { BoxClient } from '../lib/box-client.mjs';
import { reportError, runTest } from '../lib/report.mjs';

const iterations = Number(process.env.ITERATIONS ?? 15);
const maxDelayMs = Number(process.env.MAX_DELAY_MS ?? 4500);
let seed = Number(process.env.SEED ?? Date.now() % 100000);
const checker = readFileSync(new URL('./check-consistency.php', import.meta.url));

function random() {
    // Einfacher, reproduzierbarer Zufallsgenerator (mulberry32)
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function compose(...args) {
    return execFileSync('docker', ['compose', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function checkConsistency() {
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'photobooth', 'php'], { input: checker });
    if (result.status !== 0) {
        throw new Error(`Prüfskript fehlgeschlagen: ${result.stderr}`);
    }
    return JSON.parse(result.stdout.toString().trim().split('\n').pop());
}

async function guestFlow(box, signal) {
    await box.refreshToken();
    const capture = await box.capture({ signal });
    await box.process(capture.file, { signal });
    await box.print(capture.file, { signal });
    return 'durchgelaufen';
}

await runTest('Absturztest', async () => {
    console.log(`Absturztest: ${iterations} Abbrüche, Startwert ${seed} (SEED=${seed} wiederholt die Zeitpunkte)\n`);

    const box = new BoxClient();
    await box.waitUntilReady();

    const allErrors = [];
    let warningCount = 0;

    for (let i = 1; i <= iterations; i++) {
        const delay = Math.round(random() * maxDelayMs);
        const controller = new AbortController();
        const flow = guestFlow(box, controller.signal).catch((error) => `abgebrochen (${error.name})`);

        await sleep(delay);
        compose('kill', '-s', 'KILL', 'photobooth', 'render');
        controller.abort();
        const state = await flow;

        compose('up', '-d', '--wait', '--wait-timeout', '120', 'photobooth', 'render');
        await box.waitUntilReady();

        const report = checkConsistency();
        warningCount += report.warnings.length;
        const status = report.errors.length === 0 ? 'ok' : `${report.errors.length} FEHLER`;
        console.log(
            `#${String(i).padStart(2)}  Abbruch nach ${String(delay).padStart(4)} ms  Ablauf ${state.padEnd(24)} ` +
                `Bilder ${report.stats.images}, Galerie ${report.stats.databaseEntries}  → ${status}`,
        );
        for (const error of report.errors) {
            console.log(`      ✗ ${error}`);
        }
        for (const warning of report.warnings) {
            console.log(`      ! ${warning}`);
        }
        allErrors.push(...report.errors.map((e) => `#${i}: ${e}`));
    }

    // Nach allen Abbrüchen muss die Box normal weiterarbeiten
    await box.refreshToken();
    const capture = await box.capture();
    await box.process(capture.file);
    await box.print(capture.file);
    console.log('\nNach den Abbrüchen: Auslösen, Verarbeiten und Drucken funktionieren.');

    if (allErrors.length > 0) {
        console.log(`\nAbsturztest FEHLGESCHLAGEN: ${allErrors.length} Fehler.`);
        for (const error of allErrors) {
            reportError('Absturztest', error);
        }
        process.exit(1);
    }
    console.log(`\nAbsturztest bestanden${warningCount > 0 ? ` (${warningCount} Hinweise)` : ''}.`);
});
