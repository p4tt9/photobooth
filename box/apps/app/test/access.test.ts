import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, person, startBox } from './helpers.js';

test('ohne Anmeldung ist nichts erreichbar außer Gesundheit und Anmeldung', async () => {
    const box = await startBox();
    assert.equal((await box.request('GET', '/api/v1/health')).status, 200);
    for (const url of ['/api/v1/status', '/api/v1/settings', '/api/v1/print', '/api/v1/access/log', '/api/v1/access/session']) {
        assert.equal((await box.request('GET', url)).status, 401, url);
    }
    assert.equal((await box.request('PATCH', '/api/v1/settings', { body: { values: { 'print.limit': 5 } } })).status, 401);
    await box.close();
});

test('Not-PIN meldet an; Cookie nur für Skripte unsichtbar und nur für die eigene Seite', async () => {
    const box = await startBox();
    const response = await box.request('POST', '/api/v1/access/login', { body: { pin: EMERGENCY_PIN } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { personId: 'box-notzugang', name: 'Notzugang', role: 'admin', kiosk: false });
    const setCookie = String(response.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal((await box.request('GET', '/api/v1/status', { cookie: response.cookie })).status, 200);
    await box.close();
});

test('schreibende Anfragen ohne X-Snaphora-Request werden abgelehnt (CSRF)', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const response = await box.request('PATCH', '/api/v1/settings', { cookie, csrf: false, body: { values: { 'print.limit': 5 } } });
    assert.equal(response.status, 403);
    assert.equal((await box.request('POST', '/api/v1/access/login', { csrf: false, body: { pin: EMERGENCY_PIN } })).status, 403);
    await box.close();
});

test('Sperre nach 5 Fehlversuchen, wachsend, übersteht einen Neustart; auch die richtige PIN wartet', async () => {
    const box = await startBox();
    for (let i = 1; i <= 4; i++) {
        assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin: '0000' } })).status, 401, `Versuch ${i}`);
    }
    const fifth = await box.request('POST', '/api/v1/access/login', { body: { pin: '0000' } });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.headers['retry-after'], '60');

    await box.restart();
    assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin: EMERGENCY_PIN } })).status, 429, 'Neustart hebt die Sperre nicht auf');

    box.clock.now += 61_000;
    const sixth = await box.request('POST', '/api/v1/access/login', { body: { pin: '1111' } });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.headers['retry-after'], '120', 'zweite Sperre doppelt so lang');

    box.clock.now += 121_000;
    await box.login(EMERGENCY_PIN);
    const log = await box.request('GET', '/api/v1/access/log', { cookie: await box.login(EMERGENCY_PIN) });
    assert.equal(log.body.lock.failures, 0, 'erfolgreiche Anmeldung setzt zurück');
    await box.close();
});

test('ungültige Eingaben zählen als Fehlversuch und werfen nie', async () => {
    const box = await startBox();
    const inputs = [undefined, 1234, '12', 'abcd', '1'.repeat(100), { $gt: '' }];
    for (const [index, pin] of inputs.entries()) {
        // ab dem fünften Fehlversuch greift die Sperre
        const expected = index < 4 ? 401 : 429;
        assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin } })).status, expected, JSON.stringify(pin));
    }
    await box.close();
});

test('Aufbau-Zugang gilt nur im Zeitfenster des Events und darf nur Aufbau-Dinge', async () => {
    const box = await startBox();
    const now = box.clock.now;
    await box.writeAccess([
        await person('mia', 'setup', '4711', { eventId: 'evt-1', validFrom: new Date(now + 3600_000).toISOString(), validUntil: new Date(now + 7200_000).toISOString() }),
        await person('patrick', 'admin', '2468'),
    ]);
    assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin: '4711' } })).status, 401, 'vor dem Aufbau');

    box.clock.now = now + 3700_000;
    const mia = await box.login('4711');
    assert.equal((await box.request('GET', '/api/v1/print', { cookie: mia })).status, 200);
    assert.equal((await box.request('GET', '/api/v1/access/log', { cookie: mia })).status, 403, 'Protokoll nur für Admins');
    assert.equal((await box.request('PATCH', '/api/v1/settings', { cookie: mia, body: { values: { 'print.auto': true } } })).status, 403);
    assert.equal((await box.request('PATCH', '/api/v1/settings', { cookie: mia, body: { values: { 'print.limit': 300 } } })).status, 200, 'Kontingent darf der Aufbau');

    box.clock.now = now + 7300_000;
    assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin: '4711' } })).status, 401, 'nach dem Abbau');
    await box.close();
});

test('beschädigte oder gefälschte Zugänge werden ignoriert, die Box bleibt bedienbar', async () => {
    const box = await startBox();
    await box.writeAccess([{ personId: 'x', name: 'x', role: 'admin', pinHash: '4711' } as never, { personId: '../x', role: 'root' } as never]);
    assert.equal((await box.request('POST', '/api/v1/access/login', { body: { pin: '4711' } })).status, 401);
    await box.login(EMERGENCY_PIN);
    await box.close();
});

test('Sitzung läuft im Kiosk nach 2 min, sonst nach 15 min Leerlauf ab; Abmelden beendet sie sofort', async () => {
    const box = await startBox();
    const kiosk = await box.login(EMERGENCY_PIN, true);
    const laptop = await box.login(EMERGENCY_PIN, false);
    box.clock.now += 3 * 60_000;
    assert.equal((await box.request('GET', '/api/v1/status', { cookie: kiosk })).status, 401);
    assert.equal((await box.request('GET', '/api/v1/status', { cookie: laptop })).status, 200);
    assert.equal((await box.request('POST', '/api/v1/access/logout', { cookie: laptop })).status, 204);
    assert.equal((await box.request('GET', '/api/v1/status', { cookie: laptop })).status, 401);
    await box.close();
});

test('jede Anmeldung und jeder Fehlversuch steht im Protokoll (nur für die Box lesbar)', async () => {
    const box = await startBox();
    await box.request('POST', '/api/v1/access/login', { body: { pin: '0000' } });
    const cookie = await box.login(EMERGENCY_PIN);
    const log = await box.request('GET', '/api/v1/access/log', { cookie });
    assert.deepEqual(log.body.entries.map((e: { action: string }) => e.action), ['Angemeldet', 'Anmeldung fehlgeschlagen']);
    const file = path.join(box.environment.stateDir, 'audit.jsonl');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(file, 'utf8')).includes(EMERGENCY_PIN), 'keine PIN im Protokoll');
    await box.close();
});
