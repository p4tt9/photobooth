// Looks: ein Bearbeitungs-Preset (z. B. aus LightCraft), übersetzt in
//   - eine 3D-Farbtabelle (.cube, alle globalen Farb- und Tonwertänderungen),
//   - eine Vignettierungs-Korrektur (Verstärkung je Bildposition in linearem Licht),
//   - optional leichtes Schärfen.
// Ein Look liegt als Ordner mit look.json und lut.cube vor (siehe tools/look-from-lightcraft.ts).

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface VignetteMap {
    width: number;
    height: number;
    /** Verstärkung je Rasterpunkt, zeilenweise, in linearem Licht (1 = unverändert) */
    gain: number[];
}

export interface SharpenSettings {
    sigma: number;
    m1: number;
    m2: number;
}

export interface LookDefinition {
    format: 'snaphora.look';
    version: 1;
    name: string;
    lut?: string;
    vignette?: VignetteMap;
    sharpen?: SharpenSettings;
}

export interface Look {
    name: string;
    lutSize: number;
    /** RGB-Tripel 0..1, Rot läuft am schnellsten (wie im .cube-Format) */
    lut: Float32Array | null;
    vignette: VignetteMap | null;
    sharpen: SharpenSettings | null;
}

export function parseCube(text: string): { size: number; table: Float32Array } {
    let size = 0;
    const values: number[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        if (line.startsWith('LUT_3D_SIZE')) {
            size = Number(line.split(/\s+/)[1]);
            continue;
        }
        if (/^[A-Z_]/.test(line)) {
            continue; // TITLE, DOMAIN_MIN, DOMAIN_MAX …
        }
        const parts = line.split(/\s+/).map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
            values.push(...parts);
        }
    }
    if (size < 2 || values.length !== size ** 3 * 3) {
        throw new Error(`Ungültige .cube-Datei: Größe ${size}, ${values.length / 3} Einträge`);
    }
    return { size, table: Float32Array.from(values) };
}

export function formatCube(name: string, size: number, table: Float32Array): string {
    const lines = [`TITLE "${name.replaceAll('"', "'")}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let i = 0; i < size ** 3; i++) {
        lines.push(`${table[i * 3]!.toFixed(6)} ${table[i * 3 + 1]!.toFixed(6)} ${table[i * 3 + 2]!.toFixed(6)}`);
    }
    return lines.join('\n') + '\n';
}

export async function loadLook(directory: string): Promise<Look> {
    const definition = JSON.parse(await readFile(path.join(directory, 'look.json'), 'utf8')) as LookDefinition;
    if (definition.format !== 'snaphora.look' || definition.version !== 1) {
        throw new Error(`Unbekanntes Look-Format in ${directory}`);
    }
    let lut: Float32Array | null = null;
    let lutSize = 0;
    if (definition.lut) {
        const cube = parseCube(await readFile(path.join(directory, definition.lut), 'utf8'));
        lut = cube.table;
        lutSize = cube.size;
    }
    const vignette = definition.vignette ?? null;
    if (vignette && vignette.gain.length !== vignette.width * vignette.height) {
        throw new Error(`Vignettierungs-Raster in ${directory} passt nicht zur Größe`);
    }
    return { name: definition.name, lutSize, lut, vignette, sharpen: definition.sharpen ?? null };
}

// sRGB <-> linear über Tabellen, damit die Schleife ohne Potenzfunktionen auskommt
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
    const v = i / 255;
    TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const SRGB_STEPS = 4096;
const TO_SRGB = new Float32Array(SRGB_STEPS + 1);
for (let i = 0; i <= SRGB_STEPS; i++) {
    const v = i / SRGB_STEPS;
    TO_SRGB[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function vignetteRow(map: VignetteMap, y: number, height: number, width: number): Float32Array {
    // Verstärkung für eine Bildzeile vorberechnen (bilinear aus dem groben Raster)
    const row = new Float32Array(width);
    const gy = height > 1 ? (y / (height - 1)) * (map.height - 1) : 0;
    const y0 = Math.min(Math.floor(gy), map.height - 2);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
        const gx = width > 1 ? (x / (width - 1)) * (map.width - 1) : 0;
        const x0 = Math.min(Math.floor(gx), map.width - 2);
        const fx = gx - x0;
        const g = (xx: number, yy: number) => map.gain[yy * map.width + xx]!;
        row[x] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    }
    return row;
}

/**
 * Wendet Vignettierungs-Korrektur und Farbtabelle auf ein RGB-Bild (8 Bit, 3 Kanäle) an.
 * Arbeitet direkt im Puffer und gibt ihn zurück.
 */
export function applyLookToPixels(look: Look, pixels: Buffer, width: number, height: number): Buffer {
    const { lut, lutSize: n, vignette } = look;
    if (!lut && !vignette) {
        return pixels;
    }
    const max = n - 1;
    const strideG = n * 3;
    const strideB = n * n * 3;
    const rgb = [0, 0, 0];

    for (let y = 0; y < height; y++) {
        const gains = vignette ? vignetteRow(vignette, y, height, width) : null;
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 3;
            if (gains) {
                const k = gains[x]!;
                for (let c = 0; c < 3; c++) {
                    const linear = Math.min(1, TO_LINEAR[pixels[p + c]!]! * k);
                    rgb[c] = TO_SRGB[Math.round(linear * SRGB_STEPS)]!;
                }
            } else {
                rgb[0] = pixels[p]! / 255;
                rgb[1] = pixels[p + 1]! / 255;
                rgb[2] = pixels[p + 2]! / 255;
            }

            if (!lut) {
                pixels[p] = Math.round(rgb[0]! * 255);
                pixels[p + 1] = Math.round(rgb[1]! * 255);
                pixels[p + 2] = Math.round(rgb[2]! * 255);
                continue;
            }

            // Trilineare Interpolation in der Farbtabelle
            const r = rgb[0]! * max, g = rgb[1]! * max, b = rgb[2]! * max;
            const r0 = Math.min(r | 0, max - 1), g0 = Math.min(g | 0, max - 1), b0 = Math.min(b | 0, max - 1);
            const fr = r - r0, fg = g - g0, fb = b - b0;
            const base = r0 * 3 + g0 * strideG + b0 * strideB;
            for (let c = 0; c < 3; c++) {
                const i = base + c;
                const c00 = lut[i]! + (lut[i + 3]! - lut[i]!) * fr;
                const c10 = lut[i + strideG]! + (lut[i + strideG + 3]! - lut[i + strideG]!) * fr;
                const c01 = lut[i + strideB]! + (lut[i + strideB + 3]! - lut[i + strideB]!) * fr;
                const c11 = lut[i + strideG + strideB]! + (lut[i + strideG + strideB + 3]! - lut[i + strideG + strideB]!) * fr;
                const c0 = c00 + (c10 - c00) * fg;
                const c1 = c01 + (c11 - c01) * fg;
                const value = (c0 + (c1 - c0) * fb) * 255;
                pixels[p + c] = value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
            }
        }
    }
    return pixels;
}
