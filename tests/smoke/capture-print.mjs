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
import { setTimeout as sleep } from 'node:timers/promises';

const baseUrl = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const spoolDir = process.env.SPOOL_DIR ?? '.dev/printer';
const runs = Number(process.env.RUNS ?? 1);

let cookies = '';

async function request(path, { method = 'GET', form } = {}) {
    const response = await fetch(baseUrl + path, {
        method,
        headers: {
            ...(cookies ? { Cookie: cookies } : {}),
            ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
        redirect: 'manual',
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
        cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
    }
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${method} ${path} → HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${method} ${path} → keine JSON-Antwort: ${text.slice(0, 300)}`);
    }
}

async function timed(fn) {
    const start = performance.now();
    const result = await fn();
    return [result, Math.round(performance.now() - start)];
}

async function waitForBox(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            return await request('/api/csrf.php');
        } catch (error) {
            if (Date.now() > deadline) {
                throw new Error(`Fotobox unter ${baseUrl} nicht erreichbar: ${error.message}`);
            }
            await sleep(2000);
        }
    }
}

async function spoolJobs() {
    try {
        return (await readdir(spoolDir)).filter((f) => f.endsWith('.txt'));
    } catch {
        return [];
    }
}

async function runOnce() {
    const { token } = await request('/api/csrf.php');
    if (!token) {
        throw new Error('Kein CSRF-Token erhalten');
    }

    const [capture, captureMs] = await timed(() =>
        request('/api/capture.php', { method: 'POST', form: { style: 'photo', csrf: token } }),
    );
    if (capture.error || !capture.file) {
        throw new Error(`Auslösen fehlgeschlagen: ${JSON.stringify(capture)}`);
    }

    const [processed, processMs] = await timed(() =>
        request('/api/applyEffects.php', {
            method: 'POST',
            form: { file: capture.file, style: 'photo', filter: '', csrf: token },
        }),
    );
    if (processed.error) {
        throw new Error(`Verarbeitung fehlgeschlagen: ${JSON.stringify(processed)}`);
    }

    const jobsBefore = new Set(await spoolJobs());
    const [printed, printMs] = await timed(() =>
        request(
            `/api/print.php?filename=${encodeURIComponent(capture.file)}&copies=1&csrf=${encodeURIComponent(token)}`,
        ),
    );
    if (printed.error) {
        throw new Error(`Druck fehlgeschlagen: ${JSON.stringify(printed)}`);
    }

    if (spoolDir) {
        const newJobs = (await spoolJobs()).filter((j) => !jobsBefore.has(j));
        if (newJobs.length === 0) {
            throw new Error(`Druckauftrag kam nicht beim Drucker-Simulator an (${spoolDir})`);
        }
    }

    return { file: capture.file, captureMs, processMs, printMs };
}

await waitForBox();

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
