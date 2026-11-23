import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfflineError, ServerClient } from '../src/client.js';
import { ConfigSync } from '../src/config-sync.js';
import type { DeviceConfig, EventProfile } from '../src/contract.js';
import { mapDevice, mapEvent } from '../src/mapping.js';
import { credentialsFor, startFakeServer } from './fake-server.js';

const quiet = () => {};
const png = Buffer.from('fake-png-data');
const pngSha = createHash('sha256').update(png).digest('hex');
const hour = 3600_000;

function event(overrides: Partial<EventProfile> = {}): EventProfile {
    return {
        eventId: 'evt-1',
        version: 1,
        name: 'Hochzeit',
        validFrom: new Date(Date.now() - hour).toISOString(),
        validUntil: new Date(Date.now() + hour).toISOString(),
        startScreen: { title: 'Anna & Ben' },
        print: { enabled: true, quota: 200 },
        photo: { frame: { sha256: pngSha, contentType: 'image/png' } },
        gallery: { enabled: true, photoUrlPrefix: 'https://snaphora.de/g/AbC/' },
        ...overrides,
    };
}

function deviceConfig(eventProfile: EventProfile | null = event()): DeviceConfig {
    return { device: { deviceId: 'box-1', version: 1, ringlight: { enabled: true, url: 'http://192.168.8.50' }, buzzer: { photoKey: 34 } }, event: eventProfile };
}

async function setup(config: DeviceConfig) {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-sync-'));
    const server = await startFakeServer(config);
    server.assets.set(pngSha, png);
    const options = { agentDir: path.join(root, 'agent'), configDir: path.join(root, 'config'), privateDir: path.join(root, 'private'), log: quiet };
    const client = new ServerClient(server.url, credentialsFor(server), true);
    return { root, server, options, client, sync: new ConfigSync(options) };
}

const readLayer = async (root: string, name: string) => JSON.parse(await readFile(path.join(root, 'config', 'layers', `${name}.json`), 'utf8'));

test('Profil wird in App-Einstellungen übersetzt, nur gesetzte Felder', () => {
    const config = mapEvent(event({ photo: undefined, collage: { layout: '2x4', text: ['Anna & Ben', '', ''] } }));
    assert.deepEqual(config.start_screen, { title: 'Anna & Ben', title_visible: true });
    assert.deepEqual(config.print, { from_result: true, from_gallery: true, limit: 200 });
    assert.deepEqual(config.qr, { enabled: true, url: 'https://snaphora.de/g/AbC/', append_filename: true });
    assert.equal(config.collage?.layout, '2x4');
    assert.equal(config.textoncollage?.enabled, true);
    assert.equal(config.picture, undefined, 'nicht gesetzt → Box-Einstellung bleibt');
    assert.equal(config.colors, undefined);

    assert.deepEqual(mapDevice(deviceConfig().device), { get_request: { countdown: true, server: 'http://192.168.8.50' }, picture: { key: '34' } });
});

test('Konfiguration wird geladen, Bilder geprüft abgelegt und als Ebenen geschrieben', async () => {
    const { root, server, client, sync } = await setup(deviceConfig());
    await sync.start();
    assert.equal(await sync.sync(client), true);

    const layer = await readLayer(root, 'event');
    assert.equal(layer.eventId, 'evt-1');
    assert.equal(layer.config.picture.frame, `private/snaphora/assets/${pngSha}.png`);
    assert.deepEqual(await readFile(path.join(root, 'private', 'snaphora', 'assets', `${pngSha}.png`)), png);
    assert.equal((await readLayer(root, 'device')).config.get_request.server, 'http://192.168.8.50');

    // Unverändert: Server antwortet 304, nichts wird neu geschrieben
    const before = (await stat(path.join(root, 'config', 'layers', 'event.json'))).mtimeMs;
    assert.equal(await sync.sync(client), false);
    assert.equal((await stat(path.join(root, 'config', 'layers', 'event.json'))).mtimeMs, before);
    assert.ok(server.requests.filter((r) => r.includes('/assets/')).length === 1, 'Bild nur einmal geladen');
    await server.close();
});

test('falsche Prüfsumme: neue Konfiguration wird nicht übernommen', async () => {
    const { root, server, client, sync } = await setup(deviceConfig());
    await sync.start();
    await sync.sync(client);

    server.config = deviceConfig(event({ version: 2, startScreen: { title: 'Neu' }, background: { sha256: 'a'.repeat(64), contentType: 'image/png' } }));
    server.assets.set('a'.repeat(64), Buffer.from('anderer Inhalt'));
    await assert.rejects(sync.sync(client), /Prüfsumme/);
    assert.equal((await readLayer(root, 'event')).config.start_screen.title, 'Anna & Ben', 'alte Konfiguration bleibt aktiv');
    await server.close();
});

test('ohne Verbindung gilt die zuletzt gute Konfiguration, auch nach einem Neustart', async () => {
    const { root, server, client, options, sync } = await setup(deviceConfig());
    await sync.start();
    await sync.sync(client);

    server.offline = true;
    const restarted = new ConfigSync(options);
    await restarted.start();
    await assert.rejects(restarted.sync(client), OfflineError);
    assert.equal((await readLayer(root, 'event')).eventId, 'evt-1');
    assert.equal(restarted.activeEvent()?.eventId, 'evt-1');
    await server.close();
});

test('Event gilt nur in seinem Zeitfenster – auch offline', async () => {
    let now = Date.now();
    const { root, server, client, options } = await setup(deviceConfig(event({ validFrom: new Date(now + hour).toISOString(), validUntil: new Date(now + 2 * hour).toISOString() })));
    const sync = new ConfigSync({ ...options, now: () => new Date(now) });
    await sync.start();
    await sync.sync(client);
    await assert.rejects(stat(path.join(root, 'config', 'layers', 'event.json')), 'vor dem Aufbau noch nicht aktiv');
    assert.deepEqual(await readdir(path.join(root, 'private', 'snaphora', 'assets')), [`${pngSha}.png`], 'Bilder schon vorab geladen');

    server.offline = true;
    now += 1.5 * hour;
    await assert.rejects(sync.sync(client));
    assert.equal((await readLayer(root, 'event')).eventId, 'evt-1', 'ab Aufbau aktiv, ohne Verbindung');

    now += hour;
    await assert.rejects(sync.sync(client));
    await assert.rejects(stat(path.join(root, 'config', 'layers', 'event.json')), 'nach dem Abbau zurück zu den lokalen Einstellungen');
    await server.close();
});

test('nicht mehr gebrauchte Bilder werden entfernt', async () => {
    const { root, server, client, sync } = await setup(deviceConfig());
    await sync.start();
    await sync.sync(client);
    const other = Buffer.from('zweiter Rahmen');
    const otherSha = createHash('sha256').update(other).digest('hex');
    server.assets.set(otherSha, other);

    server.config = deviceConfig(event({ version: 2, photo: { frame: { sha256: otherSha, contentType: 'image/png' } } }));
    await sync.sync(client);
    server.config = deviceConfig(event({ version: 3, photo: { frame: { sha256: otherSha, contentType: 'image/png' } }, startScreen: { title: 'x' } }));
    await sync.sync(client);
    assert.deepEqual(await readdir(path.join(root, 'private', 'snaphora', 'assets')), [`${otherSha}.png`]);
    await server.close();
});
