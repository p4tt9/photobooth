import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, png, startBox } from './helpers.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0x01, 0x22, 0x00]);
const ttf = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(64)]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test('Rahmen hochladen: Name bereinigt, nicht überschrieben, in der Bibliothek mit Pfad für Einstellungen', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const first = await box.request('POST', '/api/v1/media/frame', { cookie, file: { name: 'Hochzeit Rahmen (1).PNG', data: png(3000, 2000) } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.path, 'private/images/frames/Hochzeit-Rahmen-1.png');
    const second = await box.request('POST', '/api/v1/media/frame', { cookie, file: { name: 'Hochzeit Rahmen (1).png', data: png(3000, 2000) } });
    assert.equal(second.body.name, 'Hochzeit-Rahmen-1-2.png');
    const file = path.join(box.environment.privateDir, 'images', 'frames', 'Hochzeit-Rahmen-1.png');
    assert.equal((await stat(file)).mode & 0o777, 0o644, 'für die Gäste-Oberfläche lesbar');

    const library = await box.request('GET', '/api/v1/media', { cookie });
    assert.deepEqual(library.body.frame.map((item: { name: string }) => item.name), ['Hochzeit-Rahmen-1-2.png', 'Hochzeit-Rahmen-1.png']);
    assert.deepEqual(library.body.font, []);
    await box.close();
});

const rejected: Array<[string, string, Buffer, RegExp]> = [
    ['SVG als Logo (kann Skripte enthalten)', 'logo', svg, /nur PNG oder JPG/],
    ['JPEG als Rahmen (keine Transparenz)', 'frame', jpeg, /nur PNG/],
    ['PHP-Datei mit Bild-Endung', 'background', Buffer.from('<?php system($_GET["c"]);'), /nur JPG oder PNG/],
    ['riesiges Bild', 'background', png(9000, 100), /zu groß/],
    ['leere Datei', 'font', Buffer.alloc(0), /leer/],
];

for (const [name, kind, data, message] of rejected) {
    test(`abgelehnt: ${name}`, async () => {
        const box = await startBox();
        const cookie = await box.login(EMERGENCY_PIN);
        const response = await box.request('POST', `/api/v1/media/${kind}`, { cookie, file: { name: 'x.png', data } });
        assert.equal(response.status, 400, JSON.stringify(response.body));
        assert.match(response.body.error, message);
        assert.deepEqual(await readdir(path.join(box.environment.privateDir)).catch(() => []), [], 'nichts gespeichert');
        await box.close();
    });
}

test('Endung kommt vom Inhalt: JPEG-Hintergrund mit falscher Endung wird .jpg, Schrift .ttf', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    assert.equal((await box.request('POST', '/api/v1/media/background', { cookie, file: { name: 'Bühne.png', data: jpeg } })).body.name, 'Buhne.jpg');
    assert.equal((await box.request('POST', '/api/v1/media/font', { cookie, file: { name: 'Great Vibes.ttf', data: ttf } })).body.path, 'private/fonts/Great-Vibes.ttf');
    await box.close();
});

test('verwendete Dateien lassen sich nicht löschen; unbenutzte schon; nur Admins', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const { body: item } = await box.request('POST', '/api/v1/media/frame', { cookie, file: { name: 'rahmen.png', data: png() } });
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'picture.frame': item.path } } });
    const library = await box.request('GET', '/api/v1/media', { cookie });
    assert.deepEqual(library.body.frame[0].usedBy, ['Rahmen: Rahmen Einzelfoto (Box)']);

    const blocked = await box.request('DELETE', '/api/v1/media/frame/rahmen.png', { cookie });
    assert.equal(blocked.status, 409);
    await box.request('PATCH', '/api/v1/settings', { cookie, body: { values: { 'picture.frame': '' } } });
    assert.equal((await box.request('DELETE', '/api/v1/media/frame/rahmen.png', { cookie })).status, 204);
    assert.equal((await box.request('DELETE', '/api/v1/media/frame/..%2F..%2Fconfig', { cookie })).status, 404);
    const log = await box.request('GET', '/api/v1/access/log', { cookie });
    assert.ok(log.body.entries.some((e: { action: string }) => e.action === 'Datei gelöscht'));
    await box.close();
});

test('Rahmen vom Server (Event) gilt als verwendet', async () => {
    const box = await startBox();
    const cookie = await box.login(EMERGENCY_PIN);
    const { body: item } = await box.request('POST', '/api/v1/media/frame', { cookie, file: { name: 'event.png', data: png() } });
    await box.writeLayer('event', { eventId: 'evt-1', config: { collage: { frame: item.path } } });
    assert.equal((await box.request('DELETE', '/api/v1/media/frame/event.png', { cookie })).status, 409);
    assert.ok((await readFile(path.join(box.environment.privateDir, 'images', 'frames', 'event.png'))).length > 0);
    await box.close();
});
