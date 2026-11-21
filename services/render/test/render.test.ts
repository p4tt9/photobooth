import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { qrPlacement, renderPhoto, renderPrint, writeJpeg, type PrintSettings } from '../src/render.js';

async function photo(width: number, height: number): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'render-'));
    const file = path.join(directory, 'original.jpg');
    await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 150, b: 100 } } }).jpeg().toFile(file);
    return file;
}

async function frame(): Promise<Buffer> {
    // Rahmen: roter Rand, Mitte transparent
    const svg = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100" fill="none" stroke="red" stroke-width="20"/></svg>';
    return sharp(Buffer.from(svg)).png().toBuffer();
}

const printSettings = (overrides: Partial<PrintSettings> = {}): PrintSettings => ({
    width: 1844, height: 1240, rotatePortrait: true, frame: null, qr: null, quality: 90, ...overrides,
});

test('Anzeigebild: lange Kante wie gewünscht, Rahmen liegt außen, Mitte bleibt Foto', async () => {
    const image = await renderPhoto({ source: await photo(6000, 4000), longEdge: 1920, look: null, frame: await frame() });
    assert.equal(image.width, 1920);
    assert.equal(image.height, 1280);
    const pixel = (x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3));
    assert.ok(pixel(2, 2)[0]! > 200 && pixel(2, 2)[1]! < 60, `Rand rot: ${pixel(2, 2)}`);
    assert.deepEqual(pixel(960, 640).map((v) => Math.round(v / 10)), [20, 15, 10], 'Mitte unverändert');
});

test('Rahmen-Erweiterung: Foto liegt innen, Ränder wie in GD, lange Kante bleibt', async () => {
    const extend = { left: 10, right: 10, top: 10, bottom: 10 };
    const image = await renderPhoto({ source: await photo(6000, 4000), longEdge: 1920, look: null, frame: await frame(), extend });
    assert.ok(Math.abs(image.width - 1920) <= 2, `Breite ${image.width}`);
    // Foto (braun) sitzt bei 10 % Rand innen, außen liegt der rote Rahmen
    const pixel = (x: number, y: number) => Array.from(image.data.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3));
    assert.deepEqual(pixel(Math.floor(image.width / 2), Math.floor(image.height / 2)).map((v) => Math.round(v / 10)), [20, 15, 10]);
    assert.ok(pixel(3, 3)[0]! > 200 && pixel(3, 3)[1]! < 60, 'Rand rot');
});

test('kleine Originale werden nicht hochgerechnet', async () => {
    const image = await renderPhoto({ source: await photo(800, 600), longEdge: 1920, look: null, frame: null });
    assert.equal(image.width, 800);
});

test('Druckbild hat exakt die Auflösung des DS620, auch bei Hochformat-Fotos', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'print-'));
    for (const [w, h] of [[6000, 4000], [4000, 6000]] as const) {
        const target = path.join(directory, `${w}x${h}.jpg`);
        await renderPrint({ source: await photo(w, h), look: null }, printSettings(), target);
        const meta = await sharp(target).metadata();
        assert.deepEqual([meta.width, meta.height], [1844, 1240], `${w}×${h}`);
    }
    assert.deepEqual((await readdir(directory)).filter((f) => f.startsWith('.')), [], 'keine temporären Dateien übrig');
});

test('QR-Code landet an der gewählten Position', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'print-'));
    const target = path.join(directory, 'qr.jpg');
    await renderPrint({ source: await photo(6000, 4000), look: null }, printSettings({
        qr: { url: 'https://snaphora.de/g/test', size: 0.15, offset: 0.02, margin: 1, position: 'bottomRight', background: '#ffffff' },
    }), target);
    const { data, info } = await sharp(target).raw().toBuffer({ resolveWithObject: true });
    // Rechts unten liegen jetzt schwarze QR-Module (das Foto ist hellbraun)
    let dark = 0;
    for (let y = info.height - 250; y < info.height - 40; y++) {
        for (let x = info.width - 250; x < info.width - 40; x++) {
            if (data[(y * info.width + x) * 3]! < 50) dark++;
        }
    }
    assert.ok(dark > 1000, `QR-Code gefunden (${dark} dunkle Pixel)`);
});

test('Position des QR-Codes wird korrekt berechnet', () => {
    assert.deepEqual(qrPlacement('topLeft', 1000, 600, 100, 10), { left: 10, top: 10 });
    assert.deepEqual(qrPlacement('bottomRight', 1000, 600, 100, 10), { left: 890, top: 490 });
    assert.deepEqual(qrPlacement('bottom', 1000, 600, 100, 10), { left: 450, top: 490 });
});

test('JPEG wird ohne Zwischenstände geschrieben', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'write-'));
    const image = await renderPhoto({ source: await photo(1000, 800), longEdge: 500, look: null, frame: null });
    await writeJpeg(image, path.join(directory, 'bild.jpg'), 80);
    assert.deepEqual(await readdir(directory), ['bild.jpg']);
});
