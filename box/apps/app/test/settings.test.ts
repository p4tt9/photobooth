import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, startBox, type TestBox } from './helpers.js';

const layer = async (box: TestBox, name: string) => JSON.parse(await readFile(path.join(box.environment.configDir, 'layers', `${name}.json`), 'utf8'));

test('Werte mit Herkunft: Standard → Gerät → Box → Event → am Gerät fürs Event geändert', async () => {
    const box = await startBox();
    await box.writeLayer('device', { config: { get_request: { server: 'http://192.168.8.50' }, picture: { key: '34' } } });
    await box.writeLayer('box', { config: { picture: { key: '13' }, print: { auto: true } } });
    await box.writeLayer('event', { eventId: 'evt-1', name: 'Hochzeit', config: { print: { limit: 200 }, start_screen: { title: 'Anna & Ben' } } });
    await box.writeLayer('local-event', { eventId: 'evt-1', config: { print: { limit: 250 } } });
    const cookie = await box.login(EMERGENCY_PIN);
    const { body } = await box.request('GET', '/api/v1/settings', { cookie });
    assert.deepEqual(body.event, { eventId: 'evt-1', name: 'Hochzeit', version: null });
    assert.deepEqual(body.values['picture.cntdwn_time'], { value: 5, source: 'default', eventManaged: false });
    assert.deepEqual(body.values['get_request.server'], { value: 'http://192.168.8.50', source: 'device', eventManaged: false });
    assert.deepEqual(body.values['picture.key'], { value: '13', source: 'box', eventManaged: false });
    assert.deepEqual(body.values['start_screen.title'], { value: 'Anna & Ben', source: 'event', eventManaged: true });
    assert.deepEqual(body.values['print.limit'], { value: 250, source: 'local-event', eventManaged: true });
    await box.close();
});

test('Speichern trennt: vom Event gesteuert → nur fürs Event, sonst Box; gleiche Werte werden nicht doppelt gespeichert', async () => {
    const box = await startBox();
    await box.writeLayer('box', { config: { ui: { language: 'de' } } });
    await box.writeLayer('event', { eventId: 'evt-1', config: { print: { limit: 200 } } });
    const cookie = await box.login(EMERGENCY_PIN);
    const response = await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.limit': 220, 'print.auto': true, 'picture.cntdwn_time': 5 } } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.changes.map((c: { path: string; layer: string }) => [c.path, c.layer]), [['print.limit', 'local-event'], ['print.auto', 'box']]);
    assert.deepEqual((await layer(box, 'local-event')).config, { print: { limit: 220 } });
    assert.deepEqual((await layer(box, 'box')).config, { ui: { language: 'de' }, print: { auto: true } }, 'fremde Werte bleiben, Standardwert wird nicht gespeichert');

    // Zurück auf den Wert des Events → Ausnahme verschwindet
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.limit': 200 } } });
    assert.deepEqual((await layer(box, 'local-event')).config, {});
    await box.close();
});

test('ungültige Werte: ganze Anfrage abgelehnt, nichts gespeichert, Feld benannt', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const response = await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.auto': true, 'picture.cntdwn_time': 99 } } });
    assert.equal(response.status, 400);
    assert.equal(response.body.path, 'picture.cntdwn_time');
    const shell = await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'commands.print': 'curl x | sh' } } });
    assert.equal(shell.status, 400, 'Shell-Befehle sind nicht einstellbar');
    await assert.rejects(readFile(path.join(box.environment.configDir, 'layers', 'box.json')));
    await box.close();
});

test('Shell-Befehle aus einer Ebene werden nie übernommen', async () => {
    const box = await startBox();
    await box.writeLayer('box', { config: { commands: { print: 'curl x | sh' }, print: { auto: true } } });
    const cookie = await box.login(EMERGENCY_PIN);
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.from_result': true } } });
    assert.deepEqual((await layer(box, 'box')).config, { print: { auto: true, from_result: true } });
    await box.close();
});

test('beschädigte Box-Ebene: letzte gute Fassung wird verwendet', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'picture.cntdwn_time': 7 } } });
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'picture.cntdwn_time': 8 } } });
    await writeFile(path.join(box.environment.configDir, 'layers', 'box.json'), '{"config": {"pic');
    const { body } = await box.request('GET', '/api/v1/settings', { cookie });
    assert.equal(body.values['picture.cntdwn_time'].value, 7);
    await box.close();
});

test('gleichzeitige Änderungen gehen nicht verloren', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    await Promise.all([
        box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.auto': true } } }),
        box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.from_result': true } } }),
        box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'picture.cntdwn_time': 3 } } }),
    ]);
    assert.deepEqual((await layer(box, 'box')).config, { print: { auto: true, from_result: true }, picture: { cntdwn_time: 3 } });
    await box.close();
});

test('Änderungen am Gerät gehören zum Event: nach einem Wechsel gelten sie nicht mehr; Admin kann sie verwerfen', async () => {
    const box = await startBox();
    await box.writeLayer('event', { eventId: 'evt-1', config: { print: { limit: 200 } } });
    const cookie = await box.login(EMERGENCY_PIN);
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.limit': 260 } } });
    await box.writeLayer('event', { eventId: 'evt-2', config: { print: { limit: 400 } } });
    let { body } = await box.request('GET', '/api/v1/settings', { cookie });
    assert.equal(body.values['print.limit'].value, 400);

    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'print.limit': 410 } } });
    assert.equal((await box.request('DELETE', '/api/v1/settings/event-changes', { cookie })).status, 200);
    ({ body } = await box.request('GET', '/api/v1/settings', { cookie }));
    assert.equal(body.values['print.limit'].value, 400);
    const log = await box.request('GET', '/api/v1/access/log', { cookie });
    assert.ok(log.body.entries.some((e: { action: string }) => e.action === 'Einstellungen geändert'));
    await box.close();
});
