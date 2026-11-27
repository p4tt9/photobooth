// Aufbau mit Selbsttest und Checkliste (Paket 7d, Konzept 4.9) – ganzer Weg durch die Dev-Umgebung:
//
//   1. Event mit Checkliste und Aufbau-PIN kommt vom Server (Mock-Backend → Agent → app)
//   2. Selbsttest: Kamera, Testfoto, Drucker (bisherige App) und eigene Prüfungen von app
//   3. Drucker aus → Selbsttest meldet es
//   4. Abschluss mit Bemerkung für den offenen Pflichtpunkt → Bericht kommt beim Server an, mit Person
//
//   node tests/app/setup-report.mjs     (Dev-Umgebung muss laufen)

import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { BoxClient } from '../lib/box-client.mjs';
import { fetchRetry } from '../lib/http.mjs';
import { runTest } from '../lib/report.mjs';

const mock = process.env.MOCK_URL ?? 'http://localhost:8082';
const agent = process.env.AGENT_URL ?? 'http://localhost:8083';
const box = new BoxClient();
// Fehler im Drucker-Simulator schalten – im Container, denn der Ordner gehört dort dem Simulator (in CI darf der
// Testlauf selbst nicht hineinschreiben)
const printer = (offline) =>
    execFileSync('docker', ['compose', 'exec', '-T', 'photobooth', 'sh', '-c', `${offline ? 'touch' : 'rm -f'} "\${FAKE_DEVICE_STATE:-/var/lib/fake-devices}/printer-offline"`]);
const run = Date.now().toString(36);
const eventId = `aufbau-${run}`;

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    console.log(`  ✓ ${message}`);
}

async function call(base, url, method = 'GET', body = undefined, headers = {}) {
    const response = await fetchRetry(base + url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${method} ${url} → HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
}

const hashPin = (pin) => execFileSync('docker', ['compose', 'exec', '-T', 'app', 'snaphora-app', 'hash-pin'], { input: pin }).toString().trim();

async function login(pin) {
    const response = await fetchRetry(`${box.baseUrl}/api/v1/access/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Snaphora-Request': '1' },
        body: JSON.stringify({ pin }),
    });
    check(response.ok, `Anmeldung mit Aufbau-PIN (${response.status})`);
    return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const app = (cookie, method, url, body) => call(box.baseUrl, `/api/v1${url}`, method, body, { Cookie: cookie, 'X-Snaphora-Request': '1' });
const level = (selftest, id) => selftest.checks.find((c) => c.id === id)?.level;

await runTest('Aufbau: Selbsttest, Checkliste, Bericht an den Server', async () => {
    await box.waitUntilReady();
    printer(false);

    console.log('1. Event mit Checkliste und Aufbau-PIN vom Server');
    await call(mock, '/_mock/devices/box-dev', 'PUT', {
        event: {
            eventId,
            version: 1,
            name: 'Aufbau-Test',
            validFrom: new Date(Date.now() - 60_000).toISOString(),
            validUntil: new Date(Date.now() + 3600_000).toISOString(),
            staff: [{ personId: 'tom', name: 'Tom', role: 'setup', pinHash: hashPin('5813') }],
            checklist: {
                checklistId: 'aufbau-test',
                version: 4,
                name: 'Aufbau Test',
                items: [
                    { itemId: 'hintergrund', text: 'Hintergrund aufgebaut', required: true },
                    { itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true },
                ],
            },
        },
    });
    await call(agent, '/v1/sync', 'POST');
    await box.request('/api/csrf.php');
    const cookie = await login('5813');
    const overview = await app(cookie, 'GET', '/setup');
    check(overview.checklist?.name === 'Aufbau Test' && overview.eventId === eventId, 'Checkliste des Events ist da');

    console.log('2. Selbsttest');
    const selftest = await app(cookie, 'POST', '/setup/selftest?photo=1');
    check(level(selftest, 'camera') === 'ok', `Kamera erkannt (${selftest.checks.find((c) => c.id === 'camera')?.message})`);
    check(level(selftest, 'photo') === 'ok' && selftest.testPhoto, `Testfoto aufgenommen (${selftest.checks.find((c) => c.id === 'photo')?.message})`);
    check((await fetchRetry(box.baseUrl + selftest.testPhoto)).ok, 'Testfoto ist abrufbar');
    check(level(selftest, 'printer') === 'ok', 'Drucker bereit');
    check(['event', 'server', 'disk', 'quota', 'render', 'ringlight'].every((id) => level(selftest, id)), 'eigene Prüfungen von app dabei');
    const gallery = execFileSync('docker', ['compose', 'exec', '-T', 'photobooth', 'sh', '-c', 'ls /app/data/images; cat /app/data/db.txt 2>/dev/null; true']).toString();
    check(!gallery.includes('selftest'), 'Testfoto landet nicht in der Galerie');

    console.log('3. Drucker aus');
    printer(true);
    const offline = await app(cookie, 'POST', '/setup/selftest');
    printer(false);
    check(level(offline, 'printer') === 'error', `Selbsttest meldet den Drucker (${offline.checks.find((c) => c.id === 'printer')?.message})`);

    console.log('4. Abschluss');
    const report = await app(cookie, 'POST', '/setup/complete', { runId: selftest.runId, items: ['hintergrund'], note: 'Requisiten kommen nach', buzzerKey: 34 });
    check(report.personName === 'Tom' && report.checklistVersion === 4, 'Bericht mit Person und Checkliste');
    let received = null;
    for (let i = 0; i < 20 && !received; i++) {
        received = (await call(mock, '/_mock/setup-reports')).find((r) => r.report.reportId === report.reportId);
        if (!received) await sleep(1000);
    }
    check(received, 'Bericht ist beim Server angekommen');
    check(received.report.personId === 'tom' && received.report.eventId === eventId, 'Server sieht, wer bei welchem Event aufgebaut hat');
    check(received.report.items.find((i) => i.itemId === 'requisiten')?.done === false && received.report.note === 'Requisiten kommen nach', 'offener Pflichtpunkt mit Begründung');

    await call(mock, '/_mock/devices/box-dev', 'PUT', { event: null });
    await call(agent, '/v1/sync', 'POST');
    console.log('Test bestanden.');
});
