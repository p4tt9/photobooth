import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, person, startBox } from './helpers.js';

test('Kontingent: Stand, Sperre bei erreichtem Kontingent, Erhöhen gilt nur fürs Event', async () => {
    const box = await startBox();
    await box.writeLayer('event', { eventId: 'evt-1', config: { print: { limit: 3 } } });
    await writeFile(path.join(box.environment.dataDir, 'print.count'), '3');
    await box.writeAccess([await person('mia', 'setup', '4711')]);
    const cookie = await box.login('4711');

    assert.deepEqual((await box.request('GET', '/api/v1/print', { cookie })).body, { limit: 3, printed: 3, remaining: 0, locked: true });
    const raised = await box.request('POST', '/api/v1/print/quota', { cookie, body: { add: 5 } });
    assert.equal(raised.status, 200);
    assert.deepEqual(raised.body, { limit: 8, printed: 3, remaining: 5, locked: false });

    const admin = await box.login(EMERGENCY_PIN);
    const log = await box.request('GET', '/api/v1/access/log', { cookie: admin });
    assert.ok(log.body.entries.some((e: { action: string; name: string }) => e.action === 'Druckkontingent erhöht' && e.name === 'mia'), 'mit Person protokolliert');
    await box.close();
});

test('Zähler fehlt oder ist beschädigt: aus dem Druckprotokoll; ungültige Erhöhungen werden abgelehnt', async () => {
    const box = await startBox();
    await writeFile(path.join(box.environment.dataDir, 'print.count'), 'kaputt');
    await writeFile(path.join(box.environment.dataDir, 'printed.csv'), 'a\nb\n');
    const cookie = await box.login(EMERGENCY_PIN);
    assert.equal((await box.request('GET', '/api/v1/print', { cookie })).body.printed, 2);
    for (const add of [0, -5, 1.5, '10', 5000]) {
        assert.equal((await box.request('POST', '/api/v1/print/quota', { cookie, body: { add } })).status, 400, JSON.stringify(add));
    }
    // unbegrenzt (0) → Erhöhen beginnt bei den schon gedruckten
    assert.equal((await box.request('POST', '/api/v1/print/quota', { cookie, body: { add: 10 } })).body.limit, 12);
    await box.close();
});
