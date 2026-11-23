// Hintergrund-Warteschlange für Bildversionen, die der Gast nicht sofort sehen muss.
// Jeder Auftrag liegt als JSON-Datei auf der Platte: Ein Auftrag, den ein Stromausfall
// unterbrochen hat, wird nach dem Neustart einfach noch einmal ausgeführt.

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from '@snaphora/platform';

export interface Job {
    id: string;
    type: string;
    created: string;
    payload: Record<string, unknown>;
}

type Handler = (job: Job) => Promise<void>;

export class JobQueue {
    private readonly waiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>();
    private readonly failures = new Map<string, Error>();
    private running = false;
    private wakeUp: (() => void) | null = null;
    private sequence = 0;

    constructor(
        private readonly directory: string,
        private readonly handler: Handler,
        private readonly log: (message: string) => void = console.log,
    ) {}

    async start(): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        const pending = await this.pendingIds();
        if (pending.length > 0) {
            this.log(`Warteschlange: ${pending.length} unterbrochene Aufträge werden fortgesetzt`);
        }
        this.running = true;
        void this.loop();
    }

    stop(): void {
        this.running = false;
        this.wakeUp?.();
    }

    /** Legt einen Auftrag an (gleiche id ersetzt einen noch nicht erledigten Auftrag). */
    async enqueue(id: string, type: string, payload: Record<string, unknown>): Promise<void> {
        // Dateiname sortiert nach Eingang: Aufträge werden in der Reihenfolge erledigt, in der sie kamen.
        const job: Job = { id, type, created: new Date().toISOString(), payload };
        this.failures.delete(id);
        const existing = await this.fileFor(id);
        const file = existing ?? path.join(this.directory, `${Date.now()}-${String(this.sequence++).padStart(6, '0')}-${id}.json`);
        await writeAtomic(file, JSON.stringify(job));
        this.wakeUp?.();
    }

    /** Wartet, bis der Auftrag erledigt ist (sofort, wenn er nicht oder nicht mehr in der Warteschlange ist). */
    async waitFor(id: string, timeoutMs: number): Promise<void> {
        const failure = this.failures.get(id);
        if (failure) {
            throw failure;
        }
        if (!(await this.fileFor(id))) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Auftrag ${id} nicht rechtzeitig fertig`)), timeoutMs);
            const list = this.waiters.get(id) ?? [];
            list.push({
                resolve: () => { clearTimeout(timer); resolve(); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            this.waiters.set(id, list);
        });
    }

    async size(): Promise<number> {
        return (await this.pendingIds()).length;
    }

    private async pendingFiles(): Promise<string[]> {
        return (await readdir(this.directory)).filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort();
    }

    private async pendingIds(): Promise<string[]> {
        return (await this.pendingFiles()).map((f) => f.replace(/^\d+-\d+-/, '').replace(/\.json$/, ''));
    }

    private async fileFor(id: string): Promise<string | null> {
        const match = (await this.pendingFiles()).find((f) => f.endsWith(`-${id}.json`));
        return match ? path.join(this.directory, match) : null;
    }

    private async loop(): Promise<void> {
        while (this.running) {
            const [next] = await this.pendingFiles();
            if (!next) {
                await new Promise<void>((resolve) => {
                    this.wakeUp = resolve;
                    setTimeout(resolve, 5000);
                });
                this.wakeUp = null;
                continue;
            }
            const file = path.join(this.directory, next);
            let job: Job;
            try {
                job = JSON.parse(await readFile(file, 'utf8')) as Job;
            } catch (error) {
                this.log(`Warteschlange: beschädigten Auftrag ${next} verworfen (${(error as Error).message})`);
                await rm(file, { force: true });
                continue;
            }
            const started = performance.now();
            try {
                await this.handler(job);
                await rm(file, { force: true });
                this.log(`Auftrag ${job.type} ${job.id} erledigt in ${Math.round(performance.now() - started)} ms`);
                this.settle(job.id, null);
            } catch (error) {
                // Fehler nicht endlos wiederholen: Auftrag entfernen, Wartende informieren.
                await rm(file, { force: true });
                this.log(`Auftrag ${job.type} ${job.id} fehlgeschlagen: ${(error as Error).message}`);
                this.failures.set(job.id, error as Error);
                this.settle(job.id, error as Error);
            }
        }
    }

    private settle(id: string, error: Error | null): void {
        const list = this.waiters.get(id) ?? [];
        this.waiters.delete(id);
        for (const waiter of list) {
            if (error) {
                waiter.reject(error);
            } else {
                waiter.resolve();
            }
        }
    }
}
