import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EMERGENCY_PIN, startBox } from './helpers.js';

async function fakeServer(handler: (url: string) => { status: number; body: string }): Promise<{ url: string; calls: string[]; server: Server }> {
    const calls: string[] = [];
    const server = createServer((request, response) => {
        calls.push(request.url ?? '');
        const { status, body } = handler(request.url ?? '');
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, server };
}

test('Ringlicht testen: ruft dieselbe Adresse wie der Countdown, meldet Erfolg und Fehler verständlich', async () => {
    const esp = await fakeServer(() => ({ status: 200, body: 'ok' }));
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const none = await box.request('POST', '/api/v1/devices/ringlight/test', { cookie });
    assert.deepEqual(none.body, { ok: false, url: null, error: 'Keine Adresse für das Ringlicht eingestellt' });

    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'get_request.server': esp.url } } });
    const ok = await box.request('POST', '/api/v1/devices/ringlight/test', { cookie });
    assert.equal(ok.body.ok, true);
    assert.deepEqual(esp.calls, ['/CNTDWNPHOTO']);

    esp.server.close();
    const down = await box.request('POST', '/api/v1/devices/ringlight/test', { cookie });
    assert.equal(down.body.ok, false);
    assert.match(down.body.error, /nicht erreichbar/);
    await box.close();
});

test('Looks: Liste vom Render-Dienst; gespeichert wird nur ein Look, den es gibt', async () => {
    const render = await fakeServer(() => ({ status: 200, body: JSON.stringify([{ id: 'fotobox-look', name: 'Fotobox Look' }]) }));
    const box = await startBox({ renderUrl: render.url });
    const cookie = await box.login(EMERGENCY_PIN);
    assert.deepEqual((await box.request('GET', '/api/v1/looks', { cookie })).body, [{ id: 'fotobox-look', name: 'Fotobox Look' }]);
    assert.equal((await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'render.look': 'fotobox-look' } } })).status, 200);
    const unknown = await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'render.look': 'gibt-es-nicht' } } });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.path, 'render.look');
    assert.equal((await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'render.look': '' } } })).status, 200, 'ohne Look geht immer');
    render.server.close();
    await box.close();
});

test('Render-Dienst weg: Look kann nicht geprüft werden – lieber ablehnen als ein kaputter Look', async () => {
    const box = await startBox({ renderUrl: 'http://127.0.0.1:1' });
    const cookie = await box.login(EMERGENCY_PIN);
    assert.equal((await box.request('GET', '/api/v1/looks', { cookie })).status, 503);
    assert.equal((await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'render.look': 'fotobox-look' } } })).status, 503);
    await box.close();
});
