import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLookToPixels, formatCube, parseCube, type Look } from '../src/look.js';

function identityTable(size: number): Float32Array {
    const table = new Float32Array(size ** 3 * 3);
    for (let i = 0; i < size ** 3; i++) {
        table[i * 3] = (i % size) / (size - 1);
        table[i * 3 + 1] = (Math.floor(i / size) % size) / (size - 1);
        table[i * 3 + 2] = Math.floor(i / size ** 2) / (size - 1);
    }
    return table;
}

function randomPixels(count: number): Buffer {
    const pixels = Buffer.alloc(count * 3);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (i * 7919) % 256;
    }
    return pixels;
}

test('.cube schreiben und wieder lesen ergibt dieselbe Tabelle', () => {
    const table = identityTable(5);
    const parsed = parseCube(formatCube('Test', 5, table));
    assert.equal(parsed.size, 5);
    assert.deepEqual(Array.from(parsed.table).map((v) => v.toFixed(5)), Array.from(table).map((v) => v.toFixed(5)));
});

test('unvollständige .cube-Datei wird abgelehnt', () => {
    assert.throws(() => parseCube('LUT_3D_SIZE 3\n0 0 0\n'), /Ungültige .cube-Datei/);
});

test('neutrale Farbtabelle verändert das Bild nicht', () => {
    const look: Look = { name: 'neutral', lutSize: 17, lut: identityTable(17), vignette: null, sharpen: null };
    const original = randomPixels(1000);
    const result = applyLookToPixels(look, Buffer.from(original), 1000, 1);
    for (let i = 0; i < original.length; i++) {
        assert.ok(Math.abs(result[i]! - original[i]!) <= 1, `Pixelwert ${i}: ${original[i]} → ${result[i]}`);
    }
});

test('Farbtabelle wird angewendet (Beispiel: Farben umkehren)', () => {
    const size = 2;
    const inverted = identityTable(size).map((v) => 1 - v);
    const look: Look = { name: 'invert', lutSize: size, lut: inverted, vignette: null, sharpen: null };
    const result = applyLookToPixels(look, Buffer.from([0, 128, 255]), 1, 1);
    assert.deepEqual(Array.from(result), [255, 127, 0]);
});

test('Vignettierungs-Korrektur hellt die Ecken auf und lässt die Mitte unverändert', () => {
    // 3x3-Raster: Mitte ×1, Rand ×2 (lineares Licht)
    const gain = [2, 2, 2, 2, 1, 2, 2, 2, 2];
    const look: Look = { name: 'vignette', lutSize: 0, lut: null, vignette: { width: 3, height: 3, gain }, sharpen: null };
    const width = 5;
    const height = 5;
    const pixels = Buffer.alloc(width * height * 3, 100);
    applyLookToPixels(look, pixels, width, height);
    const at = (x: number, y: number) => pixels[(y * width + x) * 3]!;
    assert.equal(at(2, 2), 100, 'Mitte unverändert');
    assert.ok(at(0, 0) > 125, `Ecke deutlich heller (${at(0, 0)})`);
});
