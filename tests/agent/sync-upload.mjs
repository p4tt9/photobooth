// Agent gegen das Mock-Backend in der laufenden Dev-Umgebung (Arbeitspaket 6):
//
//   1. Event vom Server → Einstellungen der App (Titel, Rahmen, Druckkontingent)
//   2. Foto → Galerie-Version landet in der Online-Galerie des Events
//   3. Funkloch → Fotos warten, kommen danach vollständig und je einmal an
//   4. Agent hart beendet (Stromausfall) mitten im Funkloch → Upload nach Neustart
//   5. Änderung am Gerät (Druckkontingent erhöht) → wird dem Server gemeldet
//   6. Event-Wechsel → Galerie und Druckzähler archiviert, neue Fotos gehen ins neue Event
//   7. Kein Event mehr → Box läuft wieder mit ihren lokalen Einstellungen
//
//   node tests/agent/sync-upload.mjs

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { BoxClient } from '../lib/box-client.mjs';
import { runTest } from '../lib/report.mjs';

const mock = process.env.MOCK_URL ?? 'http://localhost:8082';
const agent = process.env.AGENT_URL ?? 'http://localhost:8083';
const box = new BoxClient();
const hour = 3600_000;
// Eigene Event-Namen pro Lauf: Änderungen am Gerät gelten pro Event und bleiben sonst vom letzten Lauf stehen
const run = Date.now().toString(36);
const eventA = `test-a-${run}`;
const eventB = `test-b-${run}`;

async function call(base, path, method = 'GET', body = undefined, contentType = 'application/json') {
    const response = await fetch(base + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': contentType } : {},
        body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${method} ${base}${path} → HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
}

const inBox = (...args) => execFileSync('docker', ['compose', 'exec', '-T', 'photobooth', ...args]).toString();
const sync = () => call(agent, '/v1/sync', 'POST');
const photos = async () => Object.fromEntries((await call(mock, '/_mock/photos')).map((p) => [`${p.eventId}/${p.photoId}`, p]));

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    console.log(`  ✓ ${message}`);
}

async function eventProfile(eventId, overrides = {}) {
    const frame = await call(mock, '/_mock/assets', 'POST', await readFile('resources/img/frames/frame.png'), 'image/png');
    return {
        eventId,
        version: Date.now(),
        name: `Test ${eventId}`,
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + hour).toISOString(),
        startScreen: { title: `Titel ${eventId}` },
        photo: { frame: { ...frame, name: 'frame.png' } },
        print: { enabled: true, quota: 3 },
        gallery: { enabled: true, photoUrlPrefix: `https://galerie.example/${eventId}/` },
        ...overrides,
    };
}

async function setEvent(event) {
    await call(mock, '/_mock/devices/box-dev', 'PUT', { event });
    await sync();
    await box.request('/api/csrf.php'); // eine Anfrage an die App: übernimmt den Event-Wechsel
}

async function takePhoto() {
    await box.refreshToken();
    const { file } = await box.capture();
    await box.process(file);
    return file;
}

/** Wartet, bis die Fotos im Mock-Backend angekommen sind */
async function waitForUploads(keys, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        await sync();
        const uploaded = await photos();
        if (keys.every((key) => uploaded[key])) {
            return uploaded;
        }
        if (Date.now() > deadline) {
            throw new Error(`Nicht hochgeladen: ${keys.filter((key) => !uploaded[key]).join(', ')}`);
        }
        await sleep(1000);
    }
}

/** HTTP-Status; Apache schließt wiederverwendete Verbindungen gelegentlich – dann einmal neu versuchen */
async function statusOf(url) {
    try {
        return (await fetch(url)).status;
    } catch (error) {
        if (error?.cause?.code !== 'UND_ERR_SOCKET') {
            throw error;
        }
        return (await fetch(url)).status;
    }
}

const sha256InBox = (path) => inBox('sha256sum', path).split(' ')[0];

await runTest('Agent: Konfiguration und Galerie-Upload', async () => {
    await box.waitUntilReady();
    await call(mock, '/_mock', 'DELETE');
    const status = await sync();
    check(status.registered, `Agent ist registriert (${status.deviceId})`);

    console.log('1. Event vom Server');
    await setEvent(await eventProfile(eventA));
    const startPage = await (await fetch(`${box.baseUrl}/`)).text();
    check(startPage.includes(`Titel ${eventA}`), 'Titel des Events erscheint auf der Startseite');
    const layer = JSON.parse(inBox('cat', '/app/config/layers/event.json'));
    check(layer.config.print.limit === 3, 'Druckkontingent aus dem Paket ist eingestellt');
    check(inBox('ls', '/app/private/snaphora/assets').includes('.png'), 'Rahmen liegt geprüft auf der Box');
    for (const internal of ['config/layers/event.json', 'config/layers/device.json', 'data/event.json', 'data/printed.csv', 'var/log/main.log', `data/archive/${eventA}/`]) {
        const code = await statusOf(`${box.baseUrl}/${internal}`);
        check(code === 403 || code === 404, `${internal} ist nicht über HTTP abrufbar (${code})`);
    }

    console.log('2. Foto → Online-Galerie');
    const first = await takePhoto();
    let uploaded = await waitForUploads([`${eventA}/${first}`]);
    // Galerie-Version abwarten: Ist die Anzeige-Version zuerst hochgeladen, wird sie ersetzt
    for (let i = 0; i < 20 && uploaded[`${eventA}/${first}`].sha256 !== sha256InBox(`/app/data/images/${first}`); i++) {
        await sleep(1000);
        uploaded = await waitForUploads([`${eventA}/${first}`]);
    }
    check(uploaded[`${eventA}/${first}`].sha256 === sha256InBox(`/app/data/images/${first}`), 'hochgeladen ist die fertige Galerie-Version (gleiche Prüfsumme)');

    console.log('3. Funkloch');
    await call(mock, '/_mock/network', 'PUT', { offline: true });
    const offlinePhotos = [await takePhoto(), await takePhoto()];
    // Fotos werden erfasst, sobald der Render-Dienst ihre Galerie-Version fertig hat
    let pending = 0;
    for (let i = 0; i < 30 && pending < 2; i++) {
        await sleep(1000);
        pending = (await call(agent, '/v1/status')).uploads.pending;
    }
    check(pending >= 2, `Fotos warten auf den Upload (${pending})`);
    check(!(await photos())[`${eventA}/${offlinePhotos[0]}`], 'nichts kommt durch, solange das Netz weg ist');

    console.log('4. Stromausfall des Agents');
    const third = await takePhoto();
    await sleep(3000);
    execFileSync('docker', ['compose', 'kill', 'agent']);
    execFileSync('docker', ['compose', 'up', '-d', '--wait', 'agent']);
    await call(mock, '/_mock/network', 'PUT', { offline: false });
    uploaded = await waitForUploads([...offlinePhotos, third].map((file) => `${eventA}/${file}`), 90_000);
    check(true, 'nach Funkloch und Neustart sind alle Fotos angekommen');
    check([first, ...offlinePhotos, third].every((file) => uploaded[`${eventA}/${file}`].uploads <= 2), 'kein Foto mehrfach mit gleichem Inhalt gespeichert');

    console.log('5. Änderung am Gerät');
    await box.request('/api/printLimit.php?increaseCount=5');
    await sync();
    const report = (await call(mock, '/_mock/status')).at(-1).report;
    check(report.localChanges?.print?.limit === 8, `erhöhtes Druckkontingent wird gemeldet (${JSON.stringify(report.localChanges)})`);
    check(report.config.eventId === eventA && report.uploads.pending === 0, `Status: Event ${eventA}, nichts ausstehend`);

    console.log('6. Event-Wechsel');
    await setEvent(await eventProfile(eventB));
    check(inBox('ls', '/app/data/images').trim() === '', 'Galerie des neuen Events ist leer');
    check(inBox('ls', `/app/data/archive/${eventA}/images`).includes(first), 'Fotos des vorherigen Events liegen im Archiv');
    const configB = JSON.parse(inBox('php', '-r', 'require "/app/vendor/autoload.php"; echo json_encode((new Photobooth\\Service\\ConfigurationService())->getConfiguration()["print"]);'));
    check(configB.limit === 3, 'Druckkontingent gilt neu, Änderung aus dem vorherigen Event nicht mehr');
    const next = await takePhoto();
    await waitForUploads([`${eventB}/${next}`]);
    check(!(await photos())[`${eventA}/${next}`], 'neues Foto geht ins neue Event');

    console.log('7. Kein Event mehr');
    await setEvent(null);
    check(!(await (await fetch(`${box.baseUrl}/`)).text()).includes(`Titel ${eventB}`), 'Box läuft wieder mit ihren lokalen Einstellungen');
    const local = await takePhoto();
    await sleep(3000);
    await sync();
    check(!Object.keys(await photos()).some((key) => key.endsWith(local)), 'ohne Event wird nichts hochgeladen');

    console.log('Agent-Test bestanden.');
});
