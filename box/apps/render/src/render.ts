// Rechnet aus einem Original die einzelnen Bildversionen: Anzeige, Galerie, Vorschaubild, Druck.
// Jede Version wird direkt in ihrer Zielgröße berechnet – das spart gegenüber dem Rechnen in voller
// Auflösung den Großteil der Zeit.

import { rm } from 'node:fs/promises';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { commitTemporaryFile, temporaryPathFor } from '@snaphora/platform';
import { applyLookToPixels, type Look } from './look.js';

sharp.cache(false);

export interface RenderedImage {
    width: number;
    height: number;
    data: Buffer;
}

/** Rand in Prozent des fertigen Bildes, um den das Foto für den Rahmen erweitert wird (wie bisher in GD). */
export interface FrameExtension {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** Lädt das Original in passender Größe, wendet den Look an und legt den Rahmen darüber. */
export async function renderPhoto(options: {
    source: string;
    longEdge: number;
    look: Look | null;
    frame: Buffer | null;
    extend?: FrameExtension | null;
    /** Text-Ebene (durchsichtiges PNG), wird auf die Bildgröße gestreckt */
    overlay?: Buffer | null;
}): Promise<RenderedImage> {
    const extend = options.frame ? options.extend ?? null : null;
    // Mit Erweiterung wird das fertige Bild größer als das Foto – die lange Kante gilt für das fertige Bild.
    const factorX = extend ? 1 / (1 - 0.01 * (extend.left + extend.right)) : 1;
    const factorY = extend ? 1 / (1 - 0.01 * (extend.top + extend.bottom)) : 1;

    const resized = await sharp(options.source)
        .rotate() // EXIF-Ausrichtung der Kamera übernehmen
        .resize(Math.round(options.longEdge / factorX), Math.round(options.longEdge / factorY), { fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    let { width, height } = resized.info;
    let pixels = options.look ? applyLookToPixels(options.look, resized.data, width, height) : resized.data;

    if (options.look?.sharpen) {
        pixels = await sharp(pixels, { raw: { width, height, channels: 3 } }).sharpen(options.look.sharpen).raw().toBuffer();
    }

    if (extend) {
        // Foto auf weiße Fläche setzen, Rahmen deckt den Rand ab
        const canvasWidth = Math.floor(width * factorX);
        const canvasHeight = Math.floor(height * factorY);
        const photo = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
        pixels = await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: '#ffffff' } })
            .composite([{ input: photo, left: Math.floor(canvasWidth * 0.01 * extend.left), top: Math.floor(canvasHeight * 0.01 * extend.top) }])
            .removeAlpha()
            .raw()
            .toBuffer();
        width = canvasWidth;
        height = canvasHeight;
    }

    let pipeline = sharp(pixels, { raw: { width, height, channels: 3 } });
    const layers: sharp.OverlayOptions[] = [];
    if (options.frame) {
        // Wie bisher: Rahmen wird auf die Bildgröße gestreckt
        layers.push({ input: await sharp(options.frame).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }
    if (options.overlay) {
        layers.push({ input: await sharp(options.overlay).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }
    if (layers.length > 0) {
        pipeline = pipeline.composite(layers);
    }
    const data = await pipeline.removeAlpha().raw().toBuffer();
    return { width, height, data };
}

export async function writeJpeg(image: RenderedImage, target: string, quality: number, resizeTo?: number): Promise<void> {
    const temporary = temporaryPathFor(target);
    try {
        let pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
        if (resizeTo) {
            pipeline = pipeline.resize(resizeTo, resizeTo, { fit: 'inside', withoutEnlargement: true });
        }
        await pipeline.jpeg({ quality, mozjpeg: false, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' }).toFile(temporary);
        await commitTemporaryFile(temporary, target);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export type QrPosition = 'topLeft' | 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left';

export interface PrintSettings {
    width: number;
    height: number;
    /** Hochformat-Fotos um 90° drehen, damit sie das Querformat-Blatt füllen */
    rotatePortrait: boolean;
    frame: Buffer | null;
    qr: {
        url: string;
        /** Kantenlänge relativ zur Druckbreite (0..1) */
        size: number;
        /** Abstand zum Rand relativ zur Druckbreite (0..1) */
        offset: number;
        /** Ruhezone um den Code, in QR-Modulen */
        margin: number;
        position: QrPosition;
        background: string;
    } | null;
    /** Text auf dem Druck: durchsichtiges PNG in Druckgröße */
    textOverlay?: Buffer | null;
    quality: number;
}

/**
 * Druckbild in exakter Druckerauflösung. Eingabe ist entweder ein Original (Look wird angewendet)
 * oder ein bereits fertig gerechnetes Bild, z. B. eine Collage.
 */
export async function renderPrint(
    input: { source: string; look: Look | null } | { image: RenderedImage },
    settings: PrintSettings,
    target: string,
): Promise<void> {
    let portrait: boolean;
    let start: sharp.Sharp;
    if ('source' in input) {
        const meta = await sharp(input.source).metadata();
        // EXIF-Ausrichtung 5–8 bedeutet: Breite und Höhe sind vertauscht gespeichert
        const swapped = (meta.orientation ?? 1) >= 5;
        portrait = swapped ? (meta.width ?? 0) > (meta.height ?? 0) : (meta.height ?? 0) > (meta.width ?? 0);
        start = sharp(input.source).rotate();
    } else {
        portrait = input.image.height > input.image.width;
        start = sharp(input.image.data, { raw: { width: input.image.width, height: input.image.height, channels: 3 } });
    }
    const rotate = portrait && settings.rotatePortrait;
    const look = 'source' in input ? input.look : null;

    const rotated = rotate ? await start.rotate(90).raw().toBuffer({ resolveWithObject: true }) : null;
    const base = await (rotated ? sharp(rotated.data, { raw: { width: rotated.info.width, height: rotated.info.height, channels: 3 } }) : start)
        .resize(settings.width, settings.height, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height } = base.info;

    let pipeline = sharp(look ? applyLookToPixels(look, base.data, width, height) : base.data, {
        raw: { width, height, channels: 3 },
    });
    if (look?.sharpen) {
        pipeline = pipeline.sharpen(look.sharpen);
    }
    const layers: sharp.OverlayOptions[] = [];
    if (settings.frame) {
        layers.push({ input: await sharp(settings.frame).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }
    if (settings.qr) {
        const size = Math.max(64, Math.round(settings.qr.size * width));
        const offset = Math.round(settings.qr.offset * width);
        const qr = await QRCode.toBuffer(settings.qr.url, {
            width: size,
            margin: Math.max(0, Math.round(settings.qr.margin)),
            color: { dark: '#000000', light: settings.qr.background },
        });
        const qrSize = (await sharp(qr).metadata()).width ?? size;
        layers.push({ input: qr, ...qrPlacement(settings.qr.position, width, height, qrSize, offset) });
    }
    if (settings.textOverlay) {
        layers.push({ input: await sharp(settings.textOverlay).resize(width, height, { fit: 'fill' }).png().toBuffer() });
    }
    if (layers.length > 0) {
        pipeline = pipeline.composite(layers);
    }
    const data = await pipeline.removeAlpha().raw().toBuffer();
    await writeJpeg({ width, height, data }, target, settings.quality);
}

export function qrPlacement(position: QrPosition, width: number, height: number, size: number, offset: number): { left: number; top: number } {
    const centerX = Math.round((width - size) / 2);
    const centerY = Math.round((height - size) / 2);
    const right = width - size - offset;
    const bottom = height - size - offset;
    switch (position) {
        case 'topLeft': return { left: offset, top: offset };
        case 'top': return { left: centerX, top: offset };
        case 'topRight': return { left: right, top: offset };
        case 'right': return { left: right, top: centerY };
        case 'bottom': return { left: centerX, top: bottom };
        case 'bottomLeft': return { left: offset, top: bottom };
        case 'left': return { left: offset, top: centerY };
        case 'bottomRight':
        default: return { left: right, top: bottom };
    }
}
