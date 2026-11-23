// Zugriffsprotokoll: jede Anmeldung und jede Änderung mit Person und Zeit (Konzept 4.5).
// Eine Zeile JSON pro Eintrag, auf die Platte gezwungen; bei 2 MB wird eine ältere Datei behalten.

import { open, readFile, rename, stat } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

export interface AuditEntry {
    at: string;
    action: string;
    personId: string | null;
    name: string | null;
    details?: Record<string, unknown>;
}

const MAX_SIZE = 2 * 1024 * 1024;

@Injectable()
export class AuditService {
    private readonly logger = new Logger('Protokoll');
    private writing: Promise<void> = Promise.resolve();

    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    get file(): string {
        return path.join(this.environment.stateDir, 'audit.jsonl');
    }

    record(action: string, person: { personId: string; name: string } | null, details?: Record<string, unknown>): Promise<void> {
        const entry: AuditEntry = { at: this.environment.now().toISOString(), action, personId: person?.personId ?? null, name: person?.name ?? null, ...(details ? { details } : {}) };
        this.logger.log(`${action}${person ? ` (${person.name})` : ''}${details ? ` ${JSON.stringify(details)}` : ''}`);
        this.writing = this.writing.then(() => this.append(entry)).catch((error: Error) => this.logger.error(`Protokoll nicht geschrieben: ${error.message}`));
        return this.writing;
    }

    private async append(entry: AuditEntry): Promise<void> {
        await mkdir(this.environment.stateDir, { recursive: true });
        try {
            if ((await stat(this.file)).size > MAX_SIZE) {
                await rename(this.file, `${this.file}.1`);
            }
        } catch {
            // noch keine Datei
        }
        const handle = await open(this.file, 'a', 0o600);
        try {
            await handle.appendFile(`${JSON.stringify(entry)}\n`);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    /** Die letzten Einträge, neueste zuerst; eine halb geschriebene letzte Zeile (Stromausfall) wird übersprungen */
    async recent(limit = 100): Promise<AuditEntry[]> {
        await this.writing;
        let content = '';
        try {
            content = await readFile(this.file, 'utf8');
        } catch {
            return [];
        }
        const entries: AuditEntry[] = [];
        for (const line of content.split('\n').reverse()) {
            if (entries.length >= limit) break;
            try {
                if (line) entries.push(JSON.parse(line) as AuditEntry);
            } catch {
                // beschädigte Zeile
            }
        }
        return entries;
    }
}
