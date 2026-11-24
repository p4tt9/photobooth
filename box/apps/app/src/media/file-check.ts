// Prüfung hochgeladener Dateien – am Inhalt, nie an Endung oder angegebenem Typ.
//
// Bilder: PNG oder JPEG, Größe aus dem Dateikopf (ohne das Bild zu dekodieren). Schriften: TrueType oder OpenType.
// SVG wird bewusst nicht angenommen: es kann Skripte enthalten und wird unter derselben Adresse ausgeliefert.

import { MAX_IMAGE_EDGE, MEDIA_KINDS, type MediaKind } from '@snaphora/contracts';

export type DetectedType = 'png' | 'jpg' | 'ttf' | 'otf';

export class RejectedFileError extends Error {}

export function detectType(data: Buffer): DetectedType | null {
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
    if (data.length >= 4) {
        const head = data.subarray(0, 4);
        if (head.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || head.toString('latin1') === 'true') return 'ttf';
        if (head.toString('latin1') === 'OTTO') return 'otf';
    }
    return null;
}

/** Breite und Höhe aus dem Kopf eines PNG oder JPEG; null, wenn er nicht lesbar ist */
export function imageSize(data: Buffer, type: 'png' | 'jpg'): { width: number; height: number } | null {
    if (type === 'png') {
        // IHDR folgt direkt auf die Signatur
        if (data.length < 24 || data.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    let offset = 2;
    while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) return null;
        const marker = data[offset + 1] ?? 0;
        const length = data.readUInt16BE(offset + 2);
        // Start of Frame (außer DHT C4, JPG C8, DAC CC) enthält die Bildgröße
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
        }
        if (length < 2) return null;
        offset += 2 + length;
    }
    return null;
}

/** Prüft eine Datei für eine Art der Bibliothek und gibt die passende Endung zurück */
export function checkUpload(kind: MediaKind, data: Buffer): DetectedType {
    const rules = MEDIA_KINDS[kind];
    if (data.length === 0) throw new RejectedFileError('Die Datei ist leer');
    if (data.length > rules.maxBytes) throw new RejectedFileError(`Die Datei ist größer als ${Math.round(rules.maxBytes / 1024 / 1024)} MB`);
    const type = detectType(data);
    if (!type || !(rules.extensions as readonly string[]).includes(type)) {
        throw new RejectedFileError(`Für ${rules.label} sind nur ${rules.extensions.map((e) => e.toUpperCase()).join(' oder ')} erlaubt`);
    }
    if (type === 'png' || type === 'jpg') {
        const size = imageSize(data, type);
        if (!size || size.width < 1 || size.height < 1) throw new RejectedFileError('Das Bild ist beschädigt');
        if (size.width > MAX_IMAGE_EDGE || size.height > MAX_IMAGE_EDGE) {
            throw new RejectedFileError(`Das Bild ist zu groß (${size.width} × ${size.height}, höchstens ${MAX_IMAGE_EDGE} Pixel je Seite)`);
        }
    }
    return type;
}

/** Sicherer Dateiname aus dem Namen beim Hochladen: „Hochzeit Rahmen (1).PNG“ → „Hochzeit-Rahmen-1.png“ */
export function safeFileName(original: string, type: DetectedType): string {
    const base = original
        .replace(/\.[^.]*$/, '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[^A-Za-z0-9]+|[-.]+$/g, '')
        .slice(0, 80);
    return `${base || 'datei'}.${type}`;
}
