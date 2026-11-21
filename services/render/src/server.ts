// HTTP-Schnittstelle des Render-Dienstes (nur im internen Docker-Netz erreichbar).
//
//   POST /v1/photo   Foto nach der Aufnahme: Anzeige + Vorschaubild sofort, Galerie- und Druckbild im Hintergrund
//   POST /v1/collage Collage bzw. Fotostreifen, gleicher Ablauf
//   POST /v1/print   Druckbild bereitstellen (wartet auf den Hintergrundauftrag, rechnet notfalls sofort)
//   GET  /v1/looks   verfügbare Looks
//   GET  /health     Zustand

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './files.js';
import { loadLook, type Look } from './look.js';
import { JobQueue, type Job } from './queue.js';
import { renderCollage, type CollageSpec } from './collage.js';
import { renderPhoto, renderPrint, writeJpeg, type FrameExtension, type PrintSettings, type QrPosition, type RenderedImage } from './render.js';

const DATA = process.env.DATA_DIR ?? '/data';
const LOOKS = process.env.LOOKS_DIR ?? '/looks';
const PORT = Number(process.env.PORT ?? 3000);
const ASSETS = path.join(DATA, 'render-assets');
const FILE_NAME = /^[A-Za-z0-9._-]+\.jpg$/;

interface Variant { longEdge: number; quality: number }
interface PhotoRequest {
    kind?: 'photo';
    file: string;
    look: string | null;
    frameUrl: string | null;
    frameExtend: FrameExtension | null;
    /** Text-Ebene liegt als render-assets/<file>.text.png bereit (von der App gezeichnet) */
    textOverlay?: boolean;
    display: Variant;
    gallery: Variant;
    thumb: Variant;
    print: (Omit<PrintSettings, 'frame' | 'textOverlay'> & { frameUrl: string | null; textOverlay?: boolean }) | null;
}

/** Collage: Quellen sind Pfade relativ zum Datenverzeichnis oder Platzhalter-Bilder per URL. */
interface CollageRequest extends Omit<PhotoRequest, 'frameExtend' | 'kind'> {
    kind: 'collage';
    backgroundUrl: string | null;
    spec: Omit<CollageSpec, 'sources'> & { sources: Array<{ path?: string; placeholderUrl?: string }> };
}

type RenderRequest = PhotoRequest | CollageRequest;

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

// --- Looks (zwischengespeichert, neu geladen wenn sich look.json ändert) ---
const lookCache = new Map<string, { mtime: number; look: Look }>();
async function getLook(name: string | null): Promise<Look | null> {
    if (!name) {
        return null;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new Error(`Ungültiger Look-Name: ${name}`);
    }
    const directory = path.join(LOOKS, name);
    const mtime = (await stat(path.join(directory, 'look.json'))).mtimeMs;
    const cached = lookCache.get(name);
    if (cached && cached.mtime === mtime) {
        return cached.look;
    }
    const look = await loadLook(directory);
    lookCache.set(name, { mtime, look });
    log(`Look „${look.name}“ geladen`);
    return look;
}

async function listLooks(): Promise<Array<{ id: string; name: string }>> {
    const result: Array<{ id: string; name: string }> = [];
    for (const entry of await readdir(LOOKS).catch(() => [] as string[])) {
        try {
            const definition = JSON.parse(await readFile(path.join(LOOKS, entry, 'look.json'), 'utf8')) as { name?: string };
            result.push({ id: entry, name: definition.name ?? entry });
        } catch {
            // kein Look-Ordner
        }
    }
    return result;
}

async function fetchAsset(url: string): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
        throw new Error(`Datei ${url} nicht abrufbar: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

const exists = (file: string) => access(file).then(() => true, () => false);
const assetPath = (file: string, kind: string) => path.join(ASSETS, `${file}.${kind}`);
const readOptional = async (file: string) => ((await exists(file)) ? readFile(file) : null);

// --- Rechnen ---
/** Fertiges Bild (Foto bzw. Collage) mit langer Kante `longEdge`. */
async function renderFinal(file: string, request: RenderRequest, longEdge: number, frame?: Buffer | null): Promise<RenderedImage> {
    const look = await getLook(request.look);
    const frameData = frame !== undefined ? frame : await readOptional(assetPath(file, 'frame.png'));
    const overlay = request.textOverlay ? await readOptional(assetPath(file, 'text.png')) : null;
    if (request.kind === 'collage') {
        const placeholders = new Map<number, Buffer>();
        const sources = await Promise.all(request.spec.sources.map(async (source, index) => {
            if (source.placeholderUrl) {
                const data = await readOptional(assetPath(file, `placeholder-${index}.png`));
                if (data) {
                    placeholders.set(index, data);
                }
                return { path: '', placeholder: true };
            }
            return { path: path.join(DATA, safeRelative(source.path ?? '')), placeholder: false };
        }));
        return renderCollage({ ...request.spec, sources }, longEdge, look, {
            frame: frameData,
            backgroundImage: await readOptional(assetPath(file, 'background.png')),
            placeholders,
            overlay,
        });
    }
    return renderPhoto({ source: path.join(DATA, 'tmp', file), longEdge, look, frame: frameData, extend: request.frameExtend, overlay });
}

/** Nur Pfade innerhalb des Datenverzeichnisses zulassen. */
function safeRelative(relative: string): string {
    const normalized = path.posix.normalize(relative);
    if (normalized.startsWith('..') || path.posix.isAbsolute(normalized) || !/^[A-Za-z0-9._\/-]+$/.test(normalized)) {
        throw Object.assign(new Error(`Ungültiger Pfad: ${relative}`), { status: 400 });
    }
    return normalized;
}

// --- Hintergrundaufträge ---
async function handleJob(job: Job): Promise<void> {
    const file = String(job.payload.file);
    const request = JSON.parse(await readFile(assetPath(file, 'json'), 'utf8')) as RenderRequest;

    if (job.type === 'gallery') {
        const image = await renderFinal(file, request, request.gallery.longEdge);
        await writeJpeg(image, path.join(DATA, 'images', file), request.gallery.quality);
    } else if (job.type === 'print' && request.print) {
        // Wie bisher: Gedruckt wird das fertige Bild (mit Rahmen und Text), darauf Druck-Rahmen, QR-Code und Druck-Text
        const printSettings = {
            ...request.print,
            frame: await readOptional(assetPath(file, 'printframe.png')),
            textOverlay: request.print.textOverlay ? await readOptional(assetPath(file, 'printtext.png')) : null,
        };
        const image = await renderFinal(file, request, Math.max(request.print.width, request.print.height));
        await renderPrint({ image }, printSettings, path.join(DATA, 'print', file));
    }
}

const queue = new JobQueue(path.join(DATA, 'render-queue'), handleJob, log);

// --- Anfragen ---
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

async function processRequest(body: RenderRequest): Promise<Record<string, unknown>> {
    if (!FILE_NAME.test(body.file)) {
        throw Object.assign(new Error('Ungültiger Dateiname'), { status: 400 });
    }
    if (body.kind === 'collage') {
        for (const source of body.spec.sources) {
            if (source.path && !(await exists(path.join(DATA, safeRelative(source.path))))) {
                throw Object.assign(new Error(`Collage-Foto ${source.path} fehlt`), { status: 404 });
            }
        }
    } else if (!(await exists(path.join(DATA, 'tmp', body.file)))) {
        throw Object.assign(new Error(`Original ${body.file} fehlt`), { status: 404 });
    }
    const started = performance.now();

    // Rahmen, Hintergrund und Platzhalter genau einmal holen: Ein zufälliger Rahmen soll auf
    // Anzeige, Galerie und Druck derselbe sein, und Hintergrundaufträge brauchen kein Netz.
    const frame = body.frameUrl ? await fetchAsset(body.frameUrl) : null;
    if (frame) {
        await writeAtomic(assetPath(body.file, 'frame.png'), frame);
    }
    if (body.print?.frameUrl) {
        await writeAtomic(assetPath(body.file, 'printframe.png'), await fetchAsset(body.print.frameUrl));
    }
    if (body.kind === 'collage') {
        if (body.backgroundUrl) {
            await writeAtomic(assetPath(body.file, 'background.png'), await fetchAsset(body.backgroundUrl));
        }
        for (const [index, source] of body.spec.sources.entries()) {
            if (source.placeholderUrl) {
                await writeAtomic(assetPath(body.file, `placeholder-${index}.png`), await fetchAsset(source.placeholderUrl));
            }
        }
    }
    await writeAtomic(assetPath(body.file, 'json'), JSON.stringify(body));

    // Sofort: Anzeige (landet zunächst in der Galerie-Datei) und Vorschaubild
    const display = await renderFinal(body.file, body, body.display.longEdge, frame);
    await writeJpeg(display, path.join(DATA, 'images', body.file), body.display.quality);
    await writeJpeg(display, path.join(DATA, 'thumbs', body.file), body.thumb.quality, body.thumb.longEdge);
    const displayMs = Math.round(performance.now() - started);

    // Im Hintergrund: zuerst das Druckbild (der Gast tippt vielleicht gleich auf „Drucken“), dann die Galerie-Version
    if (body.print) {
        await queue.enqueue(`print-${body.file}`, 'print', { file: body.file });
    }
    await queue.enqueue(`gallery-${body.file}`, 'gallery', { file: body.file });
    log(`${body.kind === 'collage' ? 'Collage' : 'Foto'} ${body.file}: Anzeige in ${displayMs} ms (${display.width}×${display.height})`);
    return { file: body.file, displayMs, width: display.width, height: display.height };
}

async function preparePrint(file: string): Promise<Record<string, unknown>> {
    if (!FILE_NAME.test(file)) {
        throw Object.assign(new Error('Ungültiger Dateiname'), { status: 400 });
    }
    const started = performance.now();
    const target = path.join(DATA, 'print', file);
    await queue.waitFor(`print-${file}`, 60_000);
    if (!(await exists(target))) {
        // Kein Auftrag vorhanden (z. B. Foto vor der Umstellung entstanden) – jetzt rechnen
        if (!(await exists(assetPath(file, 'json')))) {
            throw Object.assign(new Error(`Keine Druckeinstellungen für ${file}`), { status: 404 });
        }
        await handleJob({ id: `print-${file}`, type: 'print', created: new Date().toISOString(), payload: { file } });
    }
    const request = JSON.parse(await readFile(assetPath(file, 'json'), 'utf8')) as RenderRequest;
    // Fotostreifen: Die App lässt den Drucker das Blatt in zwei Streifen schneiden
    const cut = request.kind === 'collage' && request.spec.cutLine !== null;
    return { path: `print/${file}`, cut, waitedMs: Math.round(performance.now() - started) };
}

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://render');
        if (request.method === 'GET' && url.pathname === '/health') {
            send(response, 200, { ok: true, queue: await queue.size() });
        } else if (request.method === 'GET' && url.pathname === '/v1/looks') {
            send(response, 200, await listLooks());
        } else if (request.method === 'POST' && url.pathname === '/v1/photo') {
            send(response, 200, await processRequest({ ...((await readJson(request)) as unknown as PhotoRequest), kind: 'photo' }));
        } else if (request.method === 'POST' && url.pathname === '/v1/collage') {
            send(response, 200, await processRequest({ ...((await readJson(request)) as unknown as CollageRequest), kind: 'collage' }));
        } else if (request.method === 'POST' && url.pathname === '/v1/print') {
            send(response, 200, await preparePrint(String((await readJson(request)).file ?? '')));
        } else {
            send(response, 404, { error: 'Unbekannte Anfrage' });
        }
    } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        log(`Fehler bei ${request.method} ${request.url}: ${(error as Error).message}`);
        send(response, status, { error: (error as Error).message });
    }
});

export type { QrPosition };

await queue.start();
server.listen(PORT, () => log(`Render-Dienst bereit auf Port ${PORT} (Daten ${DATA}, Looks ${LOOKS})`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        queue.stop();
        server.close(() => process.exit(0));
    });
}
