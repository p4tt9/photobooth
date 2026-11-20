// Vergleichsmessung: dieselben Arbeitsschritte wie die heutige Pipeline, aber mit libvips (sharp).
// Läuft in einem Linux-Container auf demselben Rechner wie die Dev-Umgebung:
//
//   tests/bench/run-sharp.sh
//
// Eingabe: Beispielfotos in 750D-Auflösung (6000x4000) aus dem Kamera-Simulator, Rahmen aus resources/img/frames.

import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import QRCode from 'qrcode';

const INPUT = process.env.INPUT ?? '/bench/images';
const FRAME = process.env.FRAME ?? '/bench/frame.png';
const OUT = '/tmp/bench-out';
const RUNS = Number(process.env.RUNS ?? 3);
const THREADS = Number(process.env.THREADS ?? 0); // 0 = alle Kerne
mkdirSync(OUT, { recursive: true });
if (THREADS > 0) {
    sharp.concurrency(THREADS);
}
sharp.cache(false); // jede Messung startet kalt, wie ein neues Foto

const images = readdirSync(INPUT).filter((f) => f.endsWith('.jpg')).map((f) => path.join(INPUT, f));

const SCREEN = { width: 1920, height: 1280 };
const PRINT = { width: 1844, height: 1240 }; // DNP DS620, 4x6" bei 300 dpi
const STRIP_SHEET = { width: 1240, height: 1844 }; // zwei 2x6"-Streifen nebeneinander, der Drucker schneidet

function textSvg(width, height, lines) {
    const fontSize = Math.round(height * 0.05);
    const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const text = lines
        .map((line, i) => `<text x="50%" y="${height - fontSize * (lines.length - i) - fontSize}" font-size="${fontSize}" font-family="DejaVu Sans" fill="white" text-anchor="middle">${escape(line)}</text>`)
        .join('');
    return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${text}</svg>`);
}

async function frameFor({ width, height }) {
    return sharp(FRAME).resize(width, height, { fit: 'fill' }).png().toBuffer();
}

const steps = {
    // Anzeige auf dem Bildschirm: sofort mit Rahmen und Text
    'Anzeige 1920 px mit Rahmen + Text': async (file) => {
        const frame = await frameFor(SCREEN);
        await sharp(file)
            .resize(SCREEN.width, SCREEN.height, { fit: 'cover' })
            .composite([{ input: frame }, { input: textSvg(SCREEN.width, SCREEN.height, ['Anna & Ben', '21.11.2026']) }])
            .jpeg({ quality: 85, mozjpeg: false })
            .toFile(path.join(OUT, 'screen.jpg'));
    },
    'Vorschaubild 500 px': async (file) => {
        await sharp(file).resize(500).jpeg({ quality: 60 }).toFile(path.join(OUT, 'thumb.jpg'));
    },
    // Archiv / Galerie / Nachbearbeitung: volle Auflösung mit Rahmen (heute: GD mit Qualität 100)
    'Volle Auflösung 6000 px mit Rahmen': async (file) => {
        const meta = await sharp(file).metadata();
        const frame = await frameFor({ width: meta.width, height: meta.height });
        await sharp(file).composite([{ input: frame }]).jpeg({ quality: 95 }).toFile(path.join(OUT, 'full.jpg'));
    },
    // Druck: direkt in DS620-Auflösung, mit Rahmen, QR-Code und Text
    'Druckbild 1844x1240 mit Rahmen, QR, Text': async (file) => {
        const frame = await frameFor(PRINT);
        const qr = await QRCode.toBuffer('https://snaphora.de/g/anna-ben/20261121_120000', { width: 220, margin: 1 });
        await sharp(file)
            .resize(PRINT.width, PRINT.height, { fit: 'cover' })
            .composite([
                { input: frame },
                { input: qr, left: PRINT.width - 260, top: PRINT.height - 260 },
                { input: textSvg(PRINT.width, PRINT.height, ['Anna & Ben']) },
            ])
            .jpeg({ quality: 95 })
            .toFile(path.join(OUT, 'print.jpg'));
    },
    // Neu: 2x6"-Streifen – 4 Fotos untereinander, zweimal auf einem Blatt
    'Fotostreifen 2x6 (4 Fotos, doppelt)': async (_file, all) => {
        const stripWidth = STRIP_SHEET.width / 2;
        const slot = { width: stripWidth - 40, height: Math.round((STRIP_SHEET.height - 300) / 4) - 20 };
        const tiles = await Promise.all(
            all.slice(0, 4).map((f) => sharp(f).resize(slot.width, slot.height, { fit: 'cover' }).toBuffer()),
        );
        const composites = [];
        for (const offset of [0, stripWidth]) {
            tiles.forEach((tile, i) => composites.push({ input: tile, left: offset + 20, top: 20 + i * (slot.height + 20) }));
        }
        await sharp({ create: { ...STRIP_SHEET, channels: 3, background: '#ffffff' } })
            .composite(composites)
            .jpeg({ quality: 95 })
            .toFile(path.join(OUT, 'strip.jpg'));
    },
};

const results = {};
for (const [name, step] of Object.entries(steps)) {
    const times = [];
    for (let i = 0; i < RUNS; i++) {
        const file = images[i % images.length];
        const start = performance.now();
        await step(file, images);
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results[name] = `${(times[Math.floor(times.length / 2)] / 1000).toFixed(2)} s`;
}

console.log(`libvips ${sharp.versions.vips}, Threads: ${THREADS > 0 ? THREADS : 'alle (' + sharp.concurrency() + ')'}`);
console.table(results);
