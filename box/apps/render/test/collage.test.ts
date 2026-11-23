import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { renderCollage, type CollageSpec } from '../src/collage.js';

async function photo(color: { r: number; g: number; b: number }, width = 3000, height = 2000): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'collage-'));
    const file = path.join(directory, 'foto.jpg');
    await sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 95 }).toFile(file);
    return file;
}

const RED = { r: 220, g: 30, b: 30 };
const BLUE = { r: 30, g: 30, b: 220 };
const noAssets = { frame: null, backgroundImage: null, placeholders: new Map<number, Buffer>() };

function pixel(image: { width: number; data: Buffer }, x: number, y: number): number[] {
    const o = (y * image.width + x) * 3;
    return Array.from(image.data.subarray(o, o + 3));
}

test('Fotos landen in ihren Plätzen, Leinwand in Zielgröße', async () => {
    const spec: CollageSpec = {
        width: 1800,
        height: 1200,
        background: '#ffffff',
        sources: [{ path: await photo(RED), placeholder: false }, { path: await photo(BLUE), placeholder: false }],
        slots: [
            { x: 0, y: 0, width: 900, height: 1200, rotation: 0, source: 0, frame: false },
            { x: 900, y: 0, width: 900, height: 1200, rotation: 0, source: 1, frame: false },
        ],
        frameOnce: false,
        cutLine: null,
    };
    const image = await renderCollage(spec, 3000, null, noAssets);
    assert.deepEqual([image.width, image.height], [3000, 2000]);
    assert.ok(pixel(image, 700, 1000)[0]! > 180, 'links rot');
    assert.ok(pixel(image, 2300, 1000)[2]! > 180, 'rechts blau');
});

test('Fotostreifen: Fotos doppelt, Schnittlinie in der Mitte, Hintergrundfarbe', async () => {
    const red = await photo(RED);
    const spec: CollageSpec = {
        width: 1200,
        height: 1800,
        background: '#00ff00',
        sources: [{ path: red, placeholder: false }],
        slots: [
            { x: 50, y: 50, width: 500, height: 400, rotation: 0, source: 0, frame: false },
            { x: 650, y: 50, width: 500, height: 400, rotation: 0, source: 0, frame: false },
        ],
        frameOnce: false,
        cutLine: { x1: 600, y1: 0, x2: 600, y2: 1800, color: '#000000' },
    };
    const image = await renderCollage(spec, 1844, null, noAssets);
    assert.equal(image.height, 1844);
    const scale = 1844 / 1800;
    assert.ok(pixel(image, Math.round(300 * scale), Math.round(250 * scale))[0]! > 180, 'linker Streifen rot');
    assert.ok(pixel(image, Math.round(900 * scale), Math.round(250 * scale))[0]! > 180, 'rechter Streifen rot');
    assert.ok(pixel(image, Math.round(300 * scale), Math.round(1000 * scale))[1]! > 200, 'Hintergrund grün');
    const lineX = Math.round(600 * scale);
    const darkest = Math.min(...Array.from({ length: 60 }, (_, i) => Math.min(...[-1, 0, 1].map((dx) => pixel(image, lineX + dx, 10 + i)[1]!))));
    assert.ok(darkest < 100, `gestrichelte Schnittlinie vorhanden (dunkelster Wert ${darkest})`);
});

test('Plätze, die über den Rand ragen, werden abgeschnitten statt abgelehnt', async () => {
    const spec: CollageSpec = {
        width: 1000,
        height: 1000,
        background: '#ffffff',
        sources: [{ path: await photo(RED), placeholder: false }],
        slots: [{ x: -100, y: 800, width: 400, height: 400, rotation: 0, source: 0, frame: false }],
        frameOnce: false,
        cutLine: null,
    };
    const image = await renderCollage(spec, 1000, null, noAssets);
    assert.ok(pixel(image, 50, 900)[0]! > 180);
});

test('Platzhalter-Bild und gedrehter Platz', async () => {
    const placeholder = await sharp({ create: { width: 100, height: 100, channels: 3, background: BLUE } }).png().toBuffer();
    const spec: CollageSpec = {
        width: 1200,
        height: 1200,
        background: '#ffffff',
        sources: [{ path: await photo(RED), placeholder: false }, { path: '', placeholder: true }],
        slots: [
            { x: 0, y: 0, width: 600, height: 400, rotation: 90, source: 0, frame: false },
            { x: 600, y: 600, width: 600, height: 600, rotation: 0, source: 1, frame: false },
        ],
        frameOnce: false,
        cutLine: null,
    };
    const image = await renderCollage(spec, 1200, null, { ...noAssets, placeholders: new Map([[1, placeholder]]) });
    assert.ok(pixel(image, 200, 300)[0]! > 180, 'gedrehtes Foto: 400 breit, 600 hoch');
    assert.ok(pixel(image, 900, 900)[2]! > 180, 'Platzhalter blau');
});
