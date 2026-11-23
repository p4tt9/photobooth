// Erzeugt einen Look aus zwei in LightCraft bearbeiteten Testbildern:
//
//   1. Feld-Testbild (33 Stufen je Farbkanal, 16 px je Feld) – mit dem Preset bearbeitet, aber OHNE
//      Schärfen, Rauschreduzierung und Vignettierungs-Korrektur → daraus wird die Farbtabelle.
//   2. Gleichmäßig graue Fläche (RGB 128) – NUR mit der Vignettierungs-Korrektur des Presets
//      → daraus wird das Verstärkungs-Raster.
//
//   node dist/tools/look-from-lightcraft.js --name "Fotobox Look" --grid grid-look.png --flat grau-look.png --out looks/fotobox-look [--sharpen 0.8,0.6,1.2]
//
// Die passenden Testbilder erzeugt: node dist/tools/look-from-lightcraft.js --make-inputs <ordner>

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { writeAtomic } from '@snaphora/platform';
import { formatCube, type LookDefinition } from '../src/look.js';

const LEVELS = 33;
const PATCH = 16;
const FLAT_GRAY = 128;
const GRID_W = 60;
const GRID_H = 40;

const { values } = parseArgs({
    options: {
        name: { type: 'string' },
        grid: { type: 'string' },
        flat: { type: 'string' },
        out: { type: 'string' },
        sharpen: { type: 'string' },
        'make-inputs': { type: 'string' },
    },
});

const columns = Math.ceil(Math.sqrt(LEVELS ** 3));

async function makeInputs(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    const rows = Math.ceil(LEVELS ** 3 / columns);
    const width = columns * PATCH;
    const height = rows * PATCH;
    const data = Buffer.alloc(width * height * 3, 128);
    for (let i = 0; i < LEVELS ** 3; i++) {
        const value = [i % LEVELS, Math.floor(i / LEVELS) % LEVELS, Math.floor(i / LEVELS ** 2)].map((v) => Math.round((v / (LEVELS - 1)) * 255));
        const x0 = (i % columns) * PATCH;
        const y0 = Math.floor(i / columns) * PATCH;
        for (let y = y0; y < y0 + PATCH; y++) {
            for (let x = x0; x < x0 + PATCH; x++) {
                data.set(value, (y * width + x) * 3);
            }
        }
    }
    await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toFile(path.join(directory, 'look-farbfelder.jpg'));
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: FLAT_GRAY, g: FLAT_GRAY, b: FLAT_GRAY } } })
        .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
        .toFile(path.join(directory, 'look-grauflaeche.jpg'));
    console.log(`Testbilder in ${directory}: look-farbfelder.jpg, look-grauflaeche.jpg`);
}

async function readTable(file: string): Promise<Float32Array> {
    const image = await sharp(file).removeAlpha().toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
    const pixels = new Uint16Array(image.data.buffer, image.data.byteOffset, image.data.length / 2);
    const table = new Float32Array(LEVELS ** 3 * 3);
    const inset = PATCH / 4;
    for (let i = 0; i < LEVELS ** 3; i++) {
        const x0 = (i % columns) * PATCH;
        const y0 = Math.floor(i / columns) * PATCH;
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = y0 + inset; y < y0 + PATCH - inset; y++) {
            for (let x = x0 + inset; x < x0 + PATCH - inset; x++) {
                const o = (y * image.info.width + x) * 3;
                sum[0]! += pixels[o]!;
                sum[1]! += pixels[o + 1]!;
                sum[2]! += pixels[o + 2]!;
                n++;
            }
        }
        table.set(sum.map((s) => s / n / 65535), i * 3);
    }
    return table;
}

async function readVignette(file: string): Promise<number[]> {
    const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const small = await sharp(file).removeAlpha().toColourspace('rgb16').resize(GRID_W, GRID_H, { kernel: 'cubic' }).raw({ depth: 'ushort' }).toBuffer();
    const pixels = new Uint16Array(small.buffer, small.byteOffset, small.length / 2);
    const base = toLinear(FLAT_GRAY / 255);
    const gain: number[] = [];
    for (let i = 0; i < GRID_W * GRID_H; i++) {
        const value = (pixels[i * 3]! + pixels[i * 3 + 1]! + pixels[i * 3 + 2]!) / 3 / 65535;
        gain.push(Number((toLinear(value) / base).toFixed(4)));
    }
    return gain;
}

if (values['make-inputs']) {
    await makeInputs(values['make-inputs']);
} else {
    if (!values.name || !values.grid || !values.out) {
        console.error('Benötigt: --name, --grid, --out (optional --flat, --sharpen sigma,m1,m2)');
        process.exit(2);
    }
    const definition: LookDefinition = { format: 'snaphora.look', version: 1, name: values.name, lut: 'lut.cube' };
    await writeAtomic(path.join(values.out, 'lut.cube'), formatCube(values.name, LEVELS, await readTable(values.grid)));
    if (values.flat) {
        definition.vignette = { width: GRID_W, height: GRID_H, gain: await readVignette(values.flat) };
    }
    if (values.sharpen) {
        const [sigma, m1, m2] = values.sharpen.split(',').map(Number);
        definition.sharpen = { sigma: sigma!, m1: m1!, m2: m2! };
    }
    await writeAtomic(path.join(values.out, 'look.json'), JSON.stringify(definition, null, 2) + '\n');
    console.log(`Look „${values.name}“ geschrieben nach ${values.out}`);
}
