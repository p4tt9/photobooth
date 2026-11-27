// Zustand der Box, den mehrere Module brauchen (Übersicht, Selbsttest).

import { readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

/** Unter dieser Grenze warnt die Box (Fotos einer langen Feier: ca. 10 MB je Foto mit allen Fassungen) */
export const DISK_WARN_BYTES = 10e9;
export const DISK_ERROR_BYTES = 2e9;

@Injectable()
export class StatusService {
    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    async photoCount(): Promise<number | null> {
        try {
            return (await readdir(path.join(this.environment.dataDir, 'images'))).filter((name) => /\.jpe?g$/i.test(name) && !name.startsWith('.')).length;
        } catch {
            return null;
        }
    }

    async disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
        try {
            const stats = await statfs(this.environment.dataDir);
            return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
        } catch {
            return null;
        }
    }
}
