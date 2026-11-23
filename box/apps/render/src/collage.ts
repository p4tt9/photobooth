// Collagen und Fotostreifen. Die App liest das Layout (dieselben JSON-Dateien wie bisher), rechnet die
// Positionen auf der Leinwand aus und schickt eine fertige Beschreibung. Der Dienst setzt sie in jeder
// gewünschten Größe zusammen – für Anzeige, Galerie und Druck jeweils direkt in der Zielgröße.

import sharp from 'sharp';
import { applyLookToPixels, type Look } from './look.js';
import type { RenderedImage } from './render.js';

export interface CollageSlot {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    /** Index in `sources` */
    source: number;
    /** Rahmen auf dieses Foto legen (Layout-Angabe oder „Rahmen auf jedes Foto“) */
    frame: boolean;
}

export interface CollageSource {
    /** Pfad eines Fotos (Look wird angewendet) */
    path: string;
    /** Platzhalter-Bild aus dem Layout: kein Look */
    placeholder: boolean;
}

export interface CollageSpec {
    /** Leinwand in Layout-Pixeln (z. B. 1800×1200) */
    width: number;
    height: number;
    background: string;
    slots: CollageSlot[];
    sources: CollageSource[];
    /** Rahmen einmal über die ganze Collage */
    frameOnce: boolean;
    /** Schnittlinie zwischen zwei Streifen (Layout-Pixel) */
    cutLine: { x1: number; y1: number; x2: number; y2: number; color: string } | null;
}

export interface CollageAssets {
    frame: Buffer | null;
    backgroundImage: Buffer | null;
    /** Bilddaten je Quelle, für Platzhalter-Bilder (die übrigen werden von der Platte gelesen) */
    placeholders: Map<number, Buffer>;
}

async function slotImage(input: string | Buffer, width: number, height: number, look: Look | null, frame: Buffer | null, rotation: number): Promise<{ data: Buffer; width: number; height: number }> {
    // Wie bisher: Bei 90° wird das Foto für die gedrehte Fläche zugeschnitten und danach gedreht.
    const quarterTurn = Math.abs(rotation) === 90;
    const fitWidth = quarterTurn ? height : width;
    const fitHeight = quarterTurn ? width : height;

    const resized = await sharp(input)
        .rotate()
        .resize(fitWidth, fitHeight, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let pixels = look ? applyLookToPixels(look, resized.data, fitWidth, fitHeight) : resized.data;
    if (look?.sharpen) {
        pixels = await sharp(pixels, { raw: { width: fitWidth, height: fitHeight, channels: 3 } }).sharpen(look.sharpen).raw().toBuffer();
    }

    let image = sharp(pixels, { raw: { width: fitWidth, height: fitHeight, channels: 3 } });
    if (frame) {
        image = image.composite([{ input: await sharp(frame).resize(fitWidth, fitHeight, { fit: 'fill' }).png().toBuffer() }]);
    }
    if (rotation !== 0) {
        // GD dreht gegen den Uhrzeigersinn, sharp im Uhrzeigersinn
        const turned = await sharp(await image.png().toBuffer())
            .rotate(-rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer({ resolveWithObject: true });
        return { data: turned.data, width: turned.info.width, height: turned.info.height };
    }
    const png = await image.png().toBuffer();
    return { data: png, width: fitWidth, height: fitHeight };
}

function cutLineSvg(line: NonNullable<CollageSpec['cutLine']>, scale: number, width: number, height: number): Buffer {
    // Wie bisher: 1 px breit, 4 px Strich / 4 px Lücke (in Layout-Pixeln)
    const stroke = Math.max(1, Math.round(scale));
    const dash = Math.max(2, Math.round(4 * scale));
    return Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
            `<line x1="${line.x1 * scale}" y1="${line.y1 * scale}" x2="${line.x2 * scale}" y2="${line.y2 * scale}" ` +
            `stroke="${line.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${dash}"/></svg>`,
    );
}

/** Setzt die Collage so zusammen, dass ihre lange Kante `longEdge` Pixel misst. */
export async function renderCollage(spec: CollageSpec, longEdge: number, look: Look | null, assets: CollageAssets & { overlay?: Buffer | null }): Promise<RenderedImage> {
    const scale = longEdge / Math.max(spec.width, spec.height);
    const width = Math.round(spec.width * scale);
    const height = Math.round(spec.height * scale);

    const background = assets.backgroundImage
        ? sharp(assets.backgroundImage).resize(width, height, { fit: 'fill' }).removeAlpha()
        : sharp({ create: { width, height, channels: 3, background: spec.background } });

    const layers: sharp.OverlayOptions[] = [];
    // Gleiche Fotos werden bei Streifen-Layouts doppelt gebraucht – nur einmal rechnen.
    const cache = new Map<string, Promise<{ data: Buffer; width: number; height: number }>>();
    for (const slot of spec.slots) {
        const source = spec.sources[slot.source];
        if (!source) {
            throw new Error(`Collage-Platz verweist auf fehlendes Foto ${slot.source}`);
        }
        const slotWidth = Math.max(1, Math.round(slot.width * scale));
        const slotHeight = Math.max(1, Math.round(slot.height * scale));
        const key = `${slot.source}|${slotWidth}|${slotHeight}|${slot.rotation}|${slot.frame}`;
        if (!cache.has(key)) {
            const input = source.placeholder ? assets.placeholders.get(slot.source) : source.path;
            if (!input) {
                throw new Error(`Platzhalter-Bild für Platz ${slot.source} fehlt`);
            }
            cache.set(key, slotImage(input, slotWidth, slotHeight, source.placeholder ? null : look, slot.frame ? assets.frame : null, slot.rotation));
        }
        const image = await cache.get(key)!;
        const layer = await fitLayer(image, Math.round(slot.x * scale), Math.round(slot.y * scale), width, height);
        if (layer) {
            layers.push(layer);
        }
    }
    if (spec.cutLine) {
        layers.push({ input: cutLineSvg(spec.cutLine, scale, width, height) });
    }
    if (spec.frameOnce && assets.frame) {
        layers.push({ input: await sharp(assets.frame).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }
    if (assets.overlay) {
        layers.push({ input: await sharp(assets.overlay).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }

    // Plätze dürfen über den Rand ragen – erst auf die Leinwand setzen, dann zuschneiden
    const composed = await sharp(await background.png().toBuffer())
        .composite(layers)
        .removeAlpha()
        .raw()
        .toBuffer();
    return { width, height, data: composed };
}

/**
 * GD schneidet Fotos, die über den Rand der Leinwand ragen, einfach ab. sharp verlangt Ebenen innerhalb
 * der Leinwand – den sichtbaren Teil deshalb vorher ausschneiden.
 */
async function fitLayer(
    image: { data: Buffer; width: number; height: number },
    left: number,
    top: number,
    canvasWidth: number,
    canvasHeight: number,
): Promise<sharp.OverlayOptions | null> {
    const x0 = Math.max(0, left);
    const y0 = Math.max(0, top);
    const x1 = Math.min(canvasWidth, left + image.width);
    const y1 = Math.min(canvasHeight, top + image.height);
    if (x1 <= x0 || y1 <= y0) {
        return null;
    }
    if (x0 === left && y0 === top && x1 === left + image.width && y1 === top + image.height) {
        return { input: image.data, left, top };
    }
    const visible = await sharp(image.data)
        .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
        .png()
        .toBuffer();
    return { input: visible, left: x0, top: y0 };
}
