// Protokoll der bisherigen Fotobox-App (var/log/main.log) für die Wartung – nur lesen, nur die letzten Zeilen.
// Die Protokolle von app, agent und render folgen mit der Telemetrie in Paket 8.

import { open } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

const MAX_BYTES = 256 * 1024;
const LEVEL = /\]\[(DEBUG|INFO|NOTICE|WARNING|ERROR|CRITICAL|ALERT|EMERGENCY)\]/;

export interface LogLine {
    text: string;
    level: 'error' | 'warn' | 'info';
}

@Injectable()
export class LogsService {
    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    /** Letzte Zeilen, neueste zuerst; liest höchstens die letzten 256 KB der Datei */
    async tail(lines = 300): Promise<LogLine[] | null> {
        if (!this.environment.photoboothVarDir) return null;
        let handle;
        try {
            handle = await open(path.join(this.environment.photoboothVarDir, 'log', 'main.log'), 'r');
        } catch {
            return [];
        }
        try {
            const { size } = await handle.stat();
            const length = Math.min(size, MAX_BYTES);
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, size - length);
            const all = buffer.toString('utf8').split('\n').filter((line) => line.trim() !== '');
            // Die erste Zeile kann mitten im Text beginnen, wenn die Datei länger ist
            if (size > MAX_BYTES) all.shift();
            return all
                .slice(-lines)
                .reverse()
                .map((text) => {
                    const level = LEVEL.exec(text)?.[1] ?? 'INFO';
                    return { text: text.slice(0, 2000), level: ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(level) ? 'error' : level === 'WARNING' ? 'warn' : 'info' };
                });
        } finally {
            await handle.close();
        }
    }
}
