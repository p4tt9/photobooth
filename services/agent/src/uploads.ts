// Galerie-Upload (Konzept 4.8): Jedes neue Foto der Box wird in die Online-Galerie seines Events hochgeladen.
//
// - Der Agent sieht regelmäßig in data/images nach, statt sich auf eine Benachrichtigung zu verlassen:
//   Auch Fotos, die während eines Stromausfalls oder Neustarts entstanden sind, werden gefunden.
// - Pro Foto liegt eine kleine Statusdatei im Agent-Verzeichnis (atomar geschrieben). Nach einem
//   Stromausfall geht es genau dort weiter; ein doppelter Upload ist harmlos (der Server erkennt ihn an der Prüfsumme).
// - Ein Foto gehört zu dem Event, in dessen Zeitfenster es aufgenommen wurde. Fotos ohne passendes Event
//   (oder Event ohne Online-Galerie) bleiben nur lokal.
// - Hochgeladen wird die Galerie-Version. Der Render-Dienst ersetzt die Anzeige-Version erst im Hintergrund
//   durch sie; wird die Datei nach dem Upload noch ersetzt, lädt der Agent sie erneut hoch.

import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { OfflineError, RejectedError, type ServerClient } from './client.js';
import type { EventProfile } from './contract.js';
import { readJson, sha256, writeJson } from './files.js';

export type UploadState = 'pending' | 'uploaded' | 'failed' | 'local';

export interface UploadEntry {
    photoId: string;
    eventId: string | null;
    state: UploadState;
    mtimeMs: number;
    size: number;
    sha256?: string;
    attempts: number;
    nextAttemptAt: number;
    lastError?: string;
    uploadedAt?: string;
}

export interface UploadQueueOptions {
    dataDir: string;
    agentDir: string;
    log: (message: string) => void;
    /** Event, das gerade gilt (mit Zeitfenster) */
    activeEvent: () => EventProfile | null;
    /** So lange muss eine Datei unverändert sein, bevor sie hochgeladen wird */
    settleMs?: number;
    now?: () => number;
}

const PHOTO = /^[A-Za-z0-9_-]{1,100}\.jpg$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BACKOFF_MS = 10 * 60_000;

export class UploadQueue {
    private readonly entries = new Map<string, UploadEntry>();
    private busy = false;

    constructor(private readonly options: UploadQueueOptions) {}

    private get stateDir(): string {
        return path.join(this.options.agentDir, 'uploads');
    }

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }

    async start(): Promise<void> {
        await mkdir(this.stateDir, { recursive: true });
        for (const file of await readdir(this.stateDir)) {
            if (!file.endsWith('.json') || file.startsWith('.')) {
                continue;
            }
            const entry = await readJson<UploadEntry>(path.join(this.stateDir, file));
            if (entry?.photoId) {
                this.entries.set(entry.photoId, entry);
            } else {
                // beschädigt: beim nächsten Durchsuchen wird das Foto neu erfasst
                await rm(path.join(this.stateDir, file), { force: true });
            }
        }
        const pending = this.counts().pending;
        if (pending > 0) {
            this.options.log(`Upload: ${pending} Fotos warten noch auf den Upload`);
        }
    }

    counts(): { pending: number; failed: number; uploaded: number; local: number } {
        const counts = { pending: 0, failed: 0, uploaded: 0, local: 0 };
        for (const entry of this.entries.values()) {
            counts[entry.state]++;
        }
        return counts;
    }

    list(): UploadEntry[] {
        return [...this.entries.values()].sort((a, b) => a.mtimeMs - b.mtimeMs);
    }

    /** Neue und veränderte Fotos erfassen. */
    async scan(): Promise<void> {
        const imageDir = path.join(this.options.dataDir, 'images');
        const files = (await readdir(imageDir).catch(() => [] as string[])).filter((file) => PHOTO.test(file));
        const rendering = await this.filesBeingRendered();
        const event = this.options.activeEvent();

        for (const file of files) {
            const info = await stat(path.join(imageDir, file)).catch(() => null);
            if (!info || this.now() - info.mtimeMs < (this.options.settleMs ?? 3000) || rendering.has(file)) {
                continue; // noch in Arbeit
            }
            const entry = this.entries.get(file);
            if (!entry) {
                const eventId = this.eventFor(event, info.mtimeMs);
                await this.save({ photoId: file, eventId, state: eventId ? 'pending' : 'local', mtimeMs: info.mtimeMs, size: info.size, attempts: 0, nextAttemptAt: 0 });
            } else if (entry.state === 'local') {
                // Box war beim Aufnehmen noch ohne Event-Profil (z. B. offline gestartet) – jetzt zuordnen
                const eventId = this.eventFor(event, entry.mtimeMs);
                if (eventId) {
                    await this.save({ ...entry, eventId, state: 'pending', nextAttemptAt: 0 });
                }
            } else if (entry.state === 'uploaded' && (entry.mtimeMs !== info.mtimeMs || entry.size !== info.size)) {
                // Datei wurde ersetzt (Galerie-Version nach der Anzeige-Version) – neu hochladen
                await this.save({ ...entry, state: 'pending', mtimeMs: info.mtimeMs, size: info.size, attempts: 0, nextAttemptAt: 0 });
            }
        }
    }

    private eventFor(event: EventProfile | null, mtimeMs: number): string | null {
        if (!event?.gallery?.enabled) {
            return null;
        }
        return Date.parse(event.validFrom) <= mtimeMs && mtimeMs < Date.parse(event.validUntil) ? event.eventId : null;
    }

    /** Fotos, für die der Render-Dienst noch die Galerie-Version rechnet */
    private async filesBeingRendered(): Promise<Set<string>> {
        const jobs = await readdir(path.join(this.options.dataDir, 'render-queue')).catch(() => [] as string[]);
        const files = new Set<string>();
        for (const job of jobs) {
            const match = /-gallery-(.+\.jpg)\.json$/.exec(job);
            if (match?.[1]) {
                files.add(match[1]);
            }
        }
        return files;
    }

    /** Lädt alle fälligen Fotos hoch, eins nach dem anderen (LTE). */
    async uploadDue(client: ServerClient): Promise<number> {
        if (this.busy) {
            return 0;
        }
        this.busy = true;
        let uploaded = 0;
        try {
            for (const entry of this.list()) {
                if (entry.state !== 'pending' || entry.nextAttemptAt > this.now()) {
                    continue;
                }
                const result = await this.upload(client, entry);
                if (result === 'offline') {
                    break; // die übrigen hätten dasselbe Problem
                }
                if (result === 'uploaded') {
                    uploaded++;
                }
            }
        } finally {
            this.busy = false;
        }
        return uploaded;
    }

    private async upload(client: ServerClient, entry: UploadEntry): Promise<'uploaded' | 'failed' | 'offline' | 'gone'> {
        const file = await this.locate(entry);
        if (!file) {
            // Foto wurde an der Box gelöscht
            this.entries.delete(entry.photoId);
            await rm(path.join(this.stateDir, `${entry.photoId}.json`), { force: true });
            this.options.log(`Upload: ${entry.photoId} existiert nicht mehr, wird nicht hochgeladen`);
            return 'gone';
        }
        try {
            const [data, info] = await Promise.all([readFile(file), stat(file)]);
            const hash = sha256(data);
            await client.putPhoto(entry.eventId!, entry.photoId, data, {
                sha256: hash,
                capturedAt: new Date(entry.mtimeMs).toISOString(),
            });
            await this.save({ ...entry, state: 'uploaded', sha256: hash, mtimeMs: info.mtimeMs, size: info.size, uploadedAt: new Date(this.now()).toISOString(), lastError: undefined });
            return 'uploaded';
        } catch (error) {
            const attempts = entry.attempts + 1;
            if (error instanceof RejectedError && error.status !== 401) {
                // Wiederholen ändert nichts (Event unbekannt, abgeschlossen, Datei abgelehnt)
                await this.save({ ...entry, state: 'failed', attempts, lastError: error.message });
                this.options.log(`Upload: ${entry.photoId} abgelehnt – ${error.message}`);
                return 'failed';
            }
            const backoff = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(attempts - 1, 10));
            await this.save({ ...entry, attempts, nextAttemptAt: this.now() + backoff, lastError: (error as Error).message });
            return error instanceof OfflineError || error instanceof RejectedError ? 'offline' : 'failed';
        }
    }

    /** Liegt das Foto noch in der Galerie oder schon im Archiv seines Events? */
    private async locate(entry: UploadEntry): Promise<string | null> {
        // Statusdateien liegen auf der Platte: Kennungen vor der Verwendung in Pfaden prüfen
        if (!PHOTO.test(entry.photoId) || (entry.eventId !== null && !EVENT_ID.test(entry.eventId))) {
            return null;
        }
        const candidates = [path.join(this.options.dataDir, 'images', entry.photoId)];
        if (entry.eventId) {
            candidates.push(path.join(this.options.dataDir, 'archive', entry.eventId, 'images', entry.photoId));
        }
        for (const candidate of candidates) {
            if (await stat(candidate).then(() => true, () => false)) {
                return candidate;
            }
        }
        return null;
    }

    private async save(entry: UploadEntry): Promise<void> {
        await writeJson(path.join(this.stateDir, `${entry.photoId}.json`), entry);
        this.entries.set(entry.photoId, entry);
    }
}
