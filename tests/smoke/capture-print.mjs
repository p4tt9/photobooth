// Smoke-Test: einmal den kompletten Ablauf wie ein Gast – Foto auslösen, verarbeiten, drucken –
// und die Zeit jedes Schritts messen.
//
//   node tests/smoke/capture-print.mjs
//
// Umgebungsvariablen:
//   BASE_URL     Adresse der Fotobox (Standard http://localhost:8080)
//   SPOOL_DIR    Ablage des Drucker-Simulators (Standard .dev/printer); leer = Druckprüfung überspringen
//   RUNS         Anzahl Durchläufe (Standard 1)

import { readdir } from 'node:fs/promises';
import { BoxClient } from '../lib/box-client.mjs';
import { runTest } from '../lib/report.mjs';

const spoolDir = process.env.SPOOL_DIR ?? '.dev/printer';
const runs = Number(process.env.RUNS ?? 1);
const box = new BoxClient();

async function timed(fn) {
    const start = performance.now();
    const result = await fn();
    return [result, Math.round(performance.now() - start)];
}

async function spoolJobs() {
    try {
        return (await readdir(spoolDir)).filter((f) => f.endsWith('.txt'));
    } catch {
        return [];
    }
}

async function runOnce() {
    await box.refreshToken();
    const [capture, captureMs] = await timed(() => box.capture());
    const [, processMs] = await timed(() => box.process(capture.file));

    const jobsBefore = new Set(await spoolJobs());
    const [, printMs] = await timed(() => box.print(capture.file));
    if (spoolDir) {
        const newJobs = (await spoolJobs()).filter((j) => !jobsBefore.has(j));
        if (newJobs.length === 0) {
            throw new Error(`Druckauftrag kam nicht beim Drucker-Simulator an (${spoolDir})`);
        }
    }

    return { file: capture.file, captureMs, processMs, printMs };
}

await runTest('Smoke-Test', async () => {
    await box.waitUntilReady();

    const results = [];
    for (let i = 1; i <= runs; i++) {
        const result = await runOnce();
        results.push(result);
        console.log(
            `Durchlauf ${i}: ${result.file}  Auslösen ${result.captureMs} ms · Verarbeiten ${result.processMs} ms · Drucken ${result.printMs} ms`,
        );
    }

    if (runs > 1) {
        const avg = (key) => Math.round(results.reduce((sum, r) => sum + r[key], 0) / results.length);
        console.log(`Durchschnitt: Auslösen ${avg('captureMs')} ms · Verarbeiten ${avg('processMs')} ms · Drucken ${avg('printMs')} ms`);
    }
    console.log('Smoke-Test bestanden.');
});
