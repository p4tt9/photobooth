import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ServerClient } from '../src/client.js';
import { ConfigSync } from '../src/config-sync.js';
import { InvalidConfigError, validateDeviceConfig } from '../src/validate.js';
import { credentialsFor, startFakeServer } from './fake-server.js';

const sha = 'a'.repeat(64);

function config(event: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        device: { deviceId: 'box-1', version: 1 },
        event: {
            eventId: 'evt-1',
            version: 1,
            validFrom: '2026-11-21T10:00:00Z',
            validUntil: '2026-11-22T10:00:00Z',
            ...event,
        },
    };
}

test('gültige Konfiguration wird übernommen, unbekannte Felder fallen weg', () => {
    const result = validateDeviceConfig({ ...config({ startScreen: { title: 'Anna & Ben' }, extra: 'x' }), more: 1 });
    assert.equal(result.event?.startScreen?.title, 'Anna & Ben');
    assert.equal((result.event as unknown as Record<string, unknown>).extra, undefined);
    assert.equal(validateDeviceConfig({ device: { deviceId: 'box-1', version: 1 }, event: null }).event, null);
});

const invalid: Array<[string, Record<string, unknown>]> = [
    ['Event-Kennung als Pfad', config({ eventId: '../../etc' })],
    ['Prüfsumme als Pfad', config({ background: { sha256: '../x', contentType: 'image/png' } })],
    ['unbekannter Dateityp', config({ logo: { sha256: sha, contentType: 'text/html' } })],
    ['Galerie ohne TLS', config({ gallery: { enabled: true, photoUrlPrefix: 'http://snaphora.de/g/' } })],
    ['Galerie als Skript-Adresse', config({ gallery: { enabled: true, photoUrlPrefix: 'javascript:alert(1)' } })],
    ['Farbe mit CSS', config({ colors: { primary: 'red;}body{display:none' } })],
    ['Layout-Name als Pfad', config({ collage: { layout: '../../private/x' } })],
    ['Countdown zu lang', config({ photo: { countdown: 600 } })],
    ['Kontingent negativ', config({ print: { quota: -1 } })],
    ['zu viele Textzeilen', config({ print: { text: ['1', '2', '3', '4'] } })],
    ['Steuerzeichen im Titel', config({ startScreen: { title: 'a\u0000b' } })],
    ['Zeitfenster verkehrt', config({ validUntil: '2026-11-20T10:00:00Z' })],
    ['Zeitpunkt kaputt', config({ validFrom: 'morgen' })],
    ['Gerät ohne Kennung', { device: { version: 1 }, event: null }],
];

for (const [name, value] of invalid) {
    test(`abgelehnt: ${name}`, () => {
        assert.throws(() => validateDeviceConfig(value), InvalidConfigError);
    });
}

test('Galerie über http nur, wenn ausdrücklich erlaubt (Entwicklung)', () => {
    const value = config({ gallery: { enabled: true, photoUrlPrefix: 'http://localhost:8082/g/' } });
    assert.equal(validateDeviceConfig(value, true).event?.gallery?.photoUrlPrefix, 'http://localhost:8082/g/');
});

test('Server ohne TLS wird im Betrieb abgelehnt', () => {
    assert.throws(() => new ServerClient('http://api.snaphora.de', () => null), /https/);
    assert.doesNotThrow(() => new ServerClient('https://api.snaphora.de', () => null));
});

test('ungültige Konfiguration vom Server: zuletzt gute bleibt aktiv', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'agent-validate-'));
    const server = await startFakeServer(config({ startScreen: { title: 'Gut' } }) as never);
    const client = new ServerClient(server.url, credentialsFor(server), true);
    const sync = new ConfigSync({ agentDir: path.join(root, 'agent'), configDir: path.join(root, 'config'), privateDir: path.join(root, 'private'), log: () => {}, now: () => new Date('2026-11-21T12:00:00Z') });
    await sync.start();
    await sync.sync(client);

    server.config = config({ version: 2, eventId: '../böse' }) as never;
    await assert.rejects(sync.sync(client), InvalidConfigError);
    const layer = JSON.parse(await readFile(path.join(root, 'config', 'layers', 'event.json'), 'utf8'));
    assert.equal(layer.config.start_screen.title, 'Gut');
    await server.close();
});
