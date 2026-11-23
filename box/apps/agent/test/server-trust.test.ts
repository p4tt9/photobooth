import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InvalidConfigError } from '@snaphora/contracts';
import { ServerClient } from '../src/client.js';
import { ConfigSync } from '../src/config-sync.js';
import { credentialsFor, startFakeServer } from './fake-server.js';

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
