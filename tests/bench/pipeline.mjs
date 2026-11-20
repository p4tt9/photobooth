// Misst die heutige Bildverarbeitung (PHP-GD) über die echte API der Dev-Umgebung:
// Verarbeiten nach der Aufnahme und Erstellen des Druckbilds – für mehrere typische Einstellungen.
//
//   node tests/bench/pipeline.mjs
//
// Voraussetzung: Dev-Umgebung läuft (docker compose up -d). Setzt die Konfiguration am Ende zurück.
// Die Werte stammen vom Entwicklungsrechner und sind nur für Vergleiche gedacht, nicht als Box-Zeiten.

import { BoxClient } from '../lib/box-client.mjs';
import { resetConfiguration, setConfiguration } from '../e2e/support/box.mjs';

const RUNS = Number(process.env.RUNS ?? 3);
const box = new BoxClient();
const frame = 'resources/img/frames/frame.png';

const scenarios = [
    {
        name: 'Foto ohne Rahmen',
        config: { picture: { take_frame: false }, textonpicture: { enabled: false } },
    },
    {
        name: 'Foto mit Rahmen',
        config: { picture: { take_frame: true, frame }, textonpicture: { enabled: false } },
    },
    {
        name: 'Foto mit Rahmen + Text',
        config: {
            picture: { take_frame: true, frame },
            textonpicture: { enabled: true, line1: 'Anna & Ben', line2: '21.11.2026', line3: '' },
        },
    },
    {
        name: 'Druck mit Rahmen, QR-Code, Text',
        print: true,
        config: {
            picture: { take_frame: true, frame },
            print: { print_frame: true, frame, qrcode: true },
            textonprint: { enabled: true, line1: 'Anna & Ben', line2: '', line3: '' },
        },
    },
    {
        name: 'Collage (4 Fotos)',
        collage: true,
        config: { picture: { take_frame: true, frame }, collage: { take_frame: 'always', frame } },
    },
];

async function timed(fn) {
    const start = performance.now();
    const result = await fn();
    return [result, performance.now() - start];
}

async function photo() {
    await box.refreshToken();
    const capture = await box.capture();
    const [, processMs] = await timed(() => box.process(capture.file));
    return { file: capture.file, processMs };
}

async function collage() {
    await box.refreshToken();
    let file;
    let result;
    let number = 0;
    do {
        result = await box.request('/api/capture.php', {
            method: 'POST',
            form: { style: 'collage', collageNumber: String(number), csrf: box.token, ...(file ? { file } : {}) },
        });
        if (result.error) {
            throw new Error(`Collage-Aufnahme fehlgeschlagen: ${JSON.stringify(result)}`);
        }
        file = result.file;
        number = result.current + 1;
    } while (result.current + 1 < result.limit);

    const [, processMs] = await timed(() =>
        box.request('/api/applyEffects.php', {
            method: 'POST',
            form: { file, style: 'collage', csrf: box.token },
        }),
    );
    return { file, processMs };
}

function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return `${(median / 1000).toFixed(2)} s (min ${(sorted[0] / 1000).toFixed(2)}, max ${(sorted.at(-1) / 1000).toFixed(2)})`;
}

await box.waitUntilReady();
const rows = [];

try {
    for (const scenario of scenarios) {
        setConfiguration(scenario.config);
        const processTimes = [];
        const printTimes = [];
        for (let i = 0; i < RUNS; i++) {
            const { file, processMs } = scenario.collage ? await collage() : await photo();
            processTimes.push(processMs);
            if (scenario.print) {
                const [, printMs] = await timed(() => box.print(file));
                printTimes.push(printMs);
            }
        }
        const row = { Szenario: scenario.name, Verarbeiten: stats(processTimes) };
        if (printTimes.length > 0) {
            row['Druckbild erstellen'] = stats(printTimes);
        }
        rows.push(row);
        console.log(`${scenario.name}: Verarbeiten ${row.Verarbeiten}${row['Druckbild erstellen'] ? `, Druckbild ${row['Druckbild erstellen']}` : ''}`);
    }
} finally {
    resetConfiguration();
}

console.log('\nMedian aus ' + RUNS + ' Läufen:');
console.table(rows);
