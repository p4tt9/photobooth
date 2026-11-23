import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ServerClient } from '../src/client.js';
import type { EventProfile } from '../src/contract.js';
import { UploadQueue } from '../src/uploads.js';
import { credentialsFor, startFakeServer, type FakeServer } from './fake-server.js';

const quiet = () => {};
const hour = 3600_000;

const activeEvent: EventProfile = {
    eventId: 'evt-1',
    version: 1,
    validFrom: new Date(Date.now() - hour).toISOString(),
    validUntil: new Date(Date.now() + hour).toISOString(),
    gallery: { enabled: true, photoUrlPrefix: 'https://snaphora.de/g/AbC/' },
};

async function setup(event: EventProfile | null = activeEvent) {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-upload-'));
    await mkdir(path.join(root, 'data', 'images'), { recursive: true });
    const server = await startFakeServer({ device: { deviceId: 'box-1', version: 1 }, event: null });
    const client = new ServerClient(server.url, credentialsFor(server), true);
    let current = event;
    const options = { dataDir: path.join(root, 'data'), agentDir: path.join(root, 'agent'), log: quiet, activeEvent: () => current, settleMs: 0 };
    const queue = new UploadQueue(options);
    await queue.start();
    return { root, server, client, queue, options, setEvent: (next: EventProfile | null) => { current = next; } };
}

async function photo(root: string, name: string, content: string, ageMs = 1000): Promise<void> {
    const file = path.join(root, 'data', 'images', name);
    await writeFile(file, content);
    const time = new Date(Date.now() - ageMs);
    await utimes(file, time, time);
}

const shaOf = (content: string) => createHash('sha256').update(content).digest('hex');
const uploaded = (server: FakeServer, name: string) => server.photos.get(`evt-1/${name}`);

test('neue Fotos werden ins Event hochgeladen, jedes genau einmal', async () => {
    const { root, server, client, queue } = await setup();
    await photo(root, 'a.jpg', 'A');
    await photo(root, 'b.jpg', 'B');
    await queue.scan();
    assert.equal(await queue.uploadDue(client), 2);
    assert.equal(uploaded(server, 'a.jpg')?.sha256, shaOf('A'));

    await queue.scan();
    assert.equal(await queue.uploadDue(client), 0);
    assert.equal(uploaded(server, 'a.jpg')?.count, 1);
    assert.deepEqual(queue.counts(), { pending: 0, failed: 0, uploaded: 2, local: 0 });
    await server.close();
});

test('Fotos, die der Render-Dienst noch bearbeitet, warten auf die Galerie-Version', async () => {
    const { root, server, client, queue } = await setup();
    await photo(root, 'a.jpg', 'Anzeige');
    await mkdir(path.join(root, 'data', 'render-queue'));
    await writeFile(path.join(root, 'data', 'render-queue', '1-000001-gallery-a.jpg.json'), '{}');
    await queue.scan();
    assert.equal(await queue.uploadDue(client), 0);

    await rm(path.join(root, 'data', 'render-queue', '1-000001-gallery-a.jpg.json'));
    await photo(root, 'a.jpg', 'Galerie');
    await queue.scan();
    await queue.uploadDue(client);
    assert.equal(uploaded(server, 'a.jpg')?.sha256, shaOf('Galerie'));
    await server.close();
});

test('nach dem Upload ersetzte Datei wird erneut hochgeladen', async () => {
    const { root, server, client, queue } = await setup();
    await photo(root, 'a.jpg', 'Anzeige', 5000);
    await queue.scan();
    await queue.uploadDue(client);
    await photo(root, 'a.jpg', 'Galerie-Version', 1000);
    await queue.scan();
    await queue.uploadDue(client);
    assert.deepEqual(uploaded(server, 'a.jpg'), { sha256: shaOf('Galerie-Version'), size: 15, count: 2 });
    await server.close();
});

test('offline: Fotos bleiben in der Warteschlange und kommen nach einem Neustart nach', async () => {
    const { root, server, client, queue, options } = await setup();
    server.offline = true;
    await photo(root, 'a.jpg', 'A');
    await queue.scan();
    assert.equal(await queue.uploadDue(client), 0);
    assert.equal(queue.counts().pending, 1);

    // Stromausfall: neuer Agent liest den Stand von der Platte
    server.offline = false;
    const restarted = new UploadQueue({ ...options, now: () => Date.now() + 60_000 });
    await restarted.start();
    assert.equal(restarted.counts().pending, 1);
    await restarted.scan();
    assert.equal(await restarted.uploadDue(client), 1);
    assert.equal(uploaded(server, 'a.jpg')?.count, 1);
    await server.close();
});

test('ohne Event oder ohne Online-Galerie bleiben Fotos lokal; später zugeordnet, wenn das Event-Profil kommt', async () => {
    const { root, server, client, queue, setEvent } = await setup(null);
    await photo(root, 'a.jpg', 'A');
    await queue.scan();
    assert.equal(queue.counts().local, 1);

    setEvent({ ...activeEvent, gallery: { enabled: false } });
    await queue.scan();
    assert.equal(queue.counts().local, 1, 'Galerie aus');

    setEvent(activeEvent);
    await queue.scan();
    assert.equal(await queue.uploadDue(client), 1);
    await server.close();
});

test('Fotos vor dem Aufbau gehören nicht zum Event', async () => {
    const { root, server, queue } = await setup();
    await photo(root, 'alt.jpg', 'alt', 2 * hour);
    await queue.scan();
    assert.deepEqual(queue.counts(), { pending: 0, failed: 0, uploaded: 0, local: 1 });
    await server.close();
});

test('archivierte Fotos (Event-Wechsel) werden aus dem Archiv hochgeladen', async () => {
    const { root, server, client, queue } = await setup();
    server.offline = true;
    await photo(root, 'a.jpg', 'A');
    await queue.scan();
    await queue.uploadDue(client);

    await mkdir(path.join(root, 'data', 'archive', 'evt-1'), { recursive: true });
    await rename(path.join(root, 'data', 'images'), path.join(root, 'data', 'archive', 'evt-1', 'images'));
    await mkdir(path.join(root, 'data', 'images'));
    server.offline = false;
    const later = new UploadQueue({ dataDir: path.join(root, 'data'), agentDir: path.join(root, 'agent'), log: quiet, activeEvent: () => null, now: () => Date.now() + 60_000 });
    await later.start();
    assert.equal(await later.uploadDue(client), 1);
    assert.equal(uploaded(server, 'a.jpg')?.sha256, shaOf('A'));
    await server.close();
});

test('vom Server abgelehnte Fotos werden nicht endlos wiederholt, gelöschte vergessen', async () => {
    const { root, server, client, queue } = await setup();
    server.photoStatus = 409;
    await photo(root, 'a.jpg', 'A');
    await photo(root, 'b.jpg', 'B');
    await queue.scan();
    await rm(path.join(root, 'data', 'images', 'b.jpg'));
    await queue.uploadDue(client);
    assert.deepEqual(queue.counts(), { pending: 0, failed: 1, uploaded: 0, local: 0 });
    await server.close();
});
