import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, fakeService, person, startBox } from './helpers.js';

const hardware = (camera: 'ok' | 'error' = 'ok') => ({
    checks: [
        { id: 'camera', label: 'Kamera', level: camera, message: camera === 'ok' ? 'Canon EOS 750D' : 'Keine Kamera erkannt' },
        { id: 'printer', label: 'Drucker', level: 'ok', message: 'DNP_DS620 bereit' },
        { id: 'photo', label: 'Testfoto', level: 'ok', message: '6000 × 4000 Pixel in 1.9 s' },
    ],
    testPhoto: 'data/test/selftest-20261127-100000.jpg',
});

async function services(options: { camera?: 'ok' | 'error'; agentAccepts?: boolean } = {}) {
    const reports: unknown[] = [];
    let accepts = options.agentAccepts ?? true;
    const photobooth = await fakeService(() => ({ status: 200, body: hardware(options.camera) }));
    const agent = await fakeService((method, url, body) => {
        if (url === '/v1/status') return { status: 200, body: { server: 'https://api.snaphora.de', registered: true, lastSyncError: null, uploads: {} } };
        if (method === 'POST' && url === '/v1/reports') {
            if (!accepts) return { status: 503 };
            reports.push(JSON.parse(body));
            return { status: 202, body: {} };
        }
        return { status: 404 };
    });
    return { photobooth, agent, reports, setAccepts: (value: boolean) => (accepts = value), close: async () => (await photobooth.close(), await agent.close()) };
}

async function withChecklist(box: Awaited<ReturnType<typeof startBox>>, eventId = 'evt-1') {
    await box.writeLayer('event', { eventId, name: 'Hochzeit', config: {} });
    await mkdir(box.environment.configDir, { recursive: true });
    await writeFile(
        path.join(box.environment.configDir, 'checklist.json'),
        JSON.stringify({
            eventId,
            validFrom: new Date(box.clock.now - 3600_000).toISOString(),
            validUntil: new Date(box.clock.now + 3600_000).toISOString(),
            checklist: { checklistId: 'cl-1', version: 3, name: 'Aufbau Hochzeit', items: [{ itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true }, { itemId: 'deko', text: 'Deko', required: false }] },
        }),
    );
}

test('Selbsttest: eigene Prüfungen plus Kamera/Drucker/Testfoto der bisherigen App, mit Sitzung der Person', async () => {
    const neighbours = await services();
    const box = await startBox({ photoboothUrl: neighbours.photobooth.url, agentUrl: neighbours.agent.url });
    await box.writeAccess([await person('mia', 'setup', '4711')]);
    const cookie = await box.login('4711');
    const run = await box.request('POST', '/api/v1/setup/selftest?photo=1', { cookie });
    assert.equal(run.status, 200);
    assert.deepEqual(run.body.checks.map((c: { id: string }) => c.id), ['camera', 'printer', 'photo', 'event', 'server', 'disk', 'quota', 'render', 'ringlight']);
    assert.equal(run.body.testPhoto, '/data/test/selftest-20261127-100000.jpg');
    assert.equal(neighbours.photobooth.calls[0]?.url, '/api/selftest.php?photo=1');
    assert.equal(neighbours.photobooth.calls[0]?.cookie, cookie, 'bisherige App prüft die Sitzung selbst');
    await box.close();
    await neighbours.close();
});

test('Abschluss: Bericht mit Person, Checkliste und Buzzer, an den Agent übergeben', async () => {
    const neighbours = await services();
    const box = await startBox({ photoboothUrl: neighbours.photobooth.url, agentUrl: neighbours.agent.url });
    await withChecklist(box);
    await box.writeLayer('box', { config: { picture: { key: '34' } } });
    await box.writeAccess([await person('mia', 'setup', '4711')]);
    const cookie = await box.login('4711');
    const overview = await box.request('GET', '/api/v1/setup', { cookie });
    assert.equal(overview.body.checklist.name, 'Aufbau Hochzeit');

    const run = await box.request('POST', '/api/v1/setup/selftest', { cookie });
    const done = await box.request('POST', '/api/v1/setup/complete', { cookie, body: { runId: run.body.runId, items: ['requisiten'], buzzerKey: 34 } });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.personName, 'mia');
    assert.equal(done.body.eventId, 'evt-1');
    assert.equal(done.body.checklistVersion, 3);
    assert.deepEqual(done.body.items.map((i: { itemId: string; done: boolean }) => [i.itemId, i.done]), [['requisiten', true], ['deko', false]]);
    assert.equal(done.body.checks.find((c: { id: string }) => c.id === 'buzzer').level, 'ok');
    assert.equal((neighbours.reports[0] as { reportId: string }).reportId, done.body.reportId);

    const again = await box.request('POST', '/api/v1/setup/complete', { cookie, body: { runId: run.body.runId, items: ['requisiten'] } });
    assert.equal(again.status, 404, 'ein Selbsttest ergibt genau einen Bericht');
    await box.close();
    await neighbours.close();
});

test('Pflichtpunkt offen: Abschluss nur mit Begründung; falsche Buzzer-Taste wird als Fehler vermerkt', async () => {
    const neighbours = await services({ camera: 'error' });
    const box = await startBox({ photoboothUrl: neighbours.photobooth.url, agentUrl: neighbours.agent.url });
    await withChecklist(box);
    await box.writeLayer('box', { config: { picture: { key: '34' } } });
    const cookie = await box.login(EMERGENCY_PIN);
    const run = await box.request('POST', '/api/v1/setup/selftest', { cookie });
    const refused = await box.request('POST', '/api/v1/setup/complete', { cookie, body: { runId: run.body.runId, items: [] } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /Requisiten aufgestellt/);

    const done = await box.request('POST', '/api/v1/setup/complete', { cookie, body: { runId: run.body.runId, items: [], note: 'Requisiten fehlen im Auto', buzzerKey: 13 } });
    assert.equal(done.status, 201);
    assert.equal(done.body.result, 'error', 'Kamera fehlt');
    assert.equal(done.body.note, 'Requisiten fehlen im Auto');
    assert.match(done.body.checks.find((c: { id: string }) => c.id === 'buzzer').message, /Taste 13 gedrückt, eingestellt ist 34/);
    await box.close();
    await neighbours.close();
});

test('Agent gerade nicht da: Bericht bleibt in app und wird später übergeben', async () => {
    const neighbours = await services({ agentAccepts: false });
    const box = await startBox({ photoboothUrl: neighbours.photobooth.url, agentUrl: neighbours.agent.url });
    const cookie = await box.login(EMERGENCY_PIN);
    const run = await box.request('POST', '/api/v1/setup/selftest', { cookie });
    const done = await box.request('POST', '/api/v1/setup/complete', { cookie, body: { runId: run.body.runId } });
    assert.equal(done.status, 201);
    let overview = await box.request('GET', '/api/v1/setup', { cookie });
    assert.equal(overview.body.reports[0].delivered, false);
    const file = JSON.parse(await readFile(path.join(box.environment.stateDir, 'setup-reports', `${done.body.reportId}.json`), 'utf8'));
    assert.equal(file.report.personId, 'box-notzugang');

    neighbours.setAccepts(true);
    overview = await box.request('GET', '/api/v1/setup', { cookie });
    assert.equal(overview.body.reports[0].delivered, true);
    assert.equal(neighbours.reports.length, 1);
    await box.close();
    await neighbours.close();
});

test('ohne bisherige App: Kamera und Drucker als nicht prüfbar gemeldet, Selbsttest läuft trotzdem', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const run = await box.request('POST', '/api/v1/setup/selftest', { cookie });
    assert.equal(run.status, 200);
    assert.match(run.body.checks.find((c: { id: string }) => c.id === 'camera').message, /Nicht prüfbar/);
    assert.equal(run.body.checks.find((c: { id: string }) => c.id === 'server').level, 'error');
    await box.close();
});

test('Checkliste eines anderen oder abgelaufenen Events gilt nicht', async () => {
    const box = await startBox();
    await withChecklist(box, 'evt-1');
    await box.writeLayer('event', { eventId: 'evt-2', config: {} });
    const cookie = await box.login(EMERGENCY_PIN);
    assert.equal((await box.request('GET', '/api/v1/setup', { cookie })).body.checklist, null);
    await box.close();
});
