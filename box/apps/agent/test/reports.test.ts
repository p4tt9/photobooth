import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SetupReport } from '@snaphora/contracts';
import { ServerClient } from '../src/client.js';
import { ConfigSync } from '../src/config-sync.js';
import { InvalidReportError, ReportQueue } from '../src/reports.js';
import { credentialsFor, startFakeServer } from './fake-server.js';

const quiet = () => {};

function report(id = 'bericht-0001'): SetupReport {
    return {
        reportId: id,
        eventId: 'evt-1',
        checklistId: 'cl-1',
        checklistVersion: 1,
        personId: 'mia',
        personName: 'Mia',
        startedAt: '2026-11-27T10:00:00Z',
        completedAt: '2026-11-27T10:05:00Z',
        result: 'ok',
        checks: [{ id: 'camera', label: 'Kamera', level: 'ok', message: 'Canon EOS 750D' }],
        items: [{ itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true, done: true }],
        note: null,
    };
}

async function setup() {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-reports-'));
    const server = await startFakeServer({ device: { deviceId: 'box-1', version: 1 }, event: null });
    const client = new ServerClient(server.url, credentialsFor(server), true);
    let clock = Date.now();
    const options = { agentDir: path.join(root, 'agent'), log: quiet, now: () => clock };
    const queue = new ReportQueue(options);
    await queue.start();
    return { root, server, client, queue, options, advance: (ms: number) => (clock += ms) };
}

test('Bericht wird genau einmal übertragen, auch wenn app ihn doppelt übergibt', async () => {
    const { server, client, queue } = await setup();
    await queue.add(report());
    await queue.add(report());
    assert.equal(await queue.uploadDue(client), 1);
    assert.equal(await queue.uploadDue(client), 0);
    assert.equal(server.reports.get('bericht-0001')?.count, 1);
    assert.deepEqual(queue.counts(), { pending: 0, sent: 1, rejected: 0 });
    await server.close();
});

test('Funkloch und Neustart: Bericht wartet auf der Platte und kommt danach an', async () => {
    const { server, client, queue, options, advance } = await setup();
    server.offline = true;
    await queue.add(report());
    assert.equal(await queue.uploadDue(client), 0);
    server.offline = false;
    const restarted = new ReportQueue(options);
    await restarted.start();
    assert.equal(restarted.counts().pending, 1);
    advance(10_000);
    assert.equal(await restarted.uploadDue(client), 1);
    await server.close();
});

test('vom Server abgelehnt: nicht endlos wiederholt', async () => {
    const { server, client, queue } = await setup();
    server.reportStatus = 400;
    await queue.add(report());
    await queue.uploadDue(client);
    assert.deepEqual(queue.counts(), { pending: 0, sent: 0, rejected: 1 });
    await server.close();
});

test('ungültige Berichte werden nicht angenommen', async () => {
    const { queue, server } = await setup();
    for (const bad of [null, { ...report(), reportId: '../x' }, { ...report(), eventId: '../x' }, { reportId: 'bericht-0002' }]) {
        await assert.rejects(queue.add(bad), InvalidReportError);
    }
    await assert.rejects(queue.add({ ...report('bericht-0003'), note: 'x'.repeat(300 * 1024) }), /zu groß/);
    await server.close();
});

test('Checkliste des Events wird für app abgelegt und nach dem Abbau entfernt', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-checklist-'));
    const hour = 3600_000;
    let now = Date.now();
    const checklist = { checklistId: 'cl-1', version: 1, name: 'Aufbau Hochzeit', items: [{ itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true }] };
    const server = await startFakeServer({
        device: { deviceId: 'box-1', version: 1 },
        event: { eventId: 'evt-1', version: 1, validFrom: new Date(now + hour).toISOString(), validUntil: new Date(now + 2 * hour).toISOString(), checklist },
    });
    const sync = new ConfigSync({ agentDir: path.join(root, 'agent'), configDir: path.join(root, 'config'), privateDir: path.join(root, 'private'), log: quiet, now: () => new Date(now) });
    await sync.start();
    await sync.sync(new ServerClient(server.url, credentialsFor(server), true));
    const file = JSON.parse(await readFile(path.join(root, 'config', 'checklist.json'), 'utf8'));
    assert.equal(file.eventId, 'evt-1', 'schon vor dem Aufbau da');
    assert.deepEqual(file.checklist, checklist);

    now += 3 * hour;
    await sync.apply();
    await assert.rejects(readFile(path.join(root, 'config', 'checklist.json')));
    await server.close();
});
