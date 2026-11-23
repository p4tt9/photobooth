// Gesamtzustand der Box (Modul status): Grundlage für Übersicht und Selbsttest.

import { readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Inject } from '@nestjs/common';
import { Access } from '../access/access.guard.js';
import { SettingsService } from '../config/settings.service.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { PrintService } from '../print/print.service.js';

@Controller()
export class StatusController {
    private readonly startedAt = Date.now();

    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly settings: SettingsService,
        private readonly print: PrintService,
    ) {}

    @Get('health')
    @Access('public')
    health() {
        return { status: 'ok', version: this.environment.appVersion };
    }

    @Get('status')
    @Access('setup')
    async status() {
        const [event, print, photos, disk, agent] = await Promise.all([this.settings.activeEvent(), this.print.status(), this.photoCount(), this.disk(), this.agent()]);
        return { version: this.environment.appVersion, uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), event, print, photos, disk, agent };
    }

    private async photoCount(): Promise<number | null> {
        try {
            return (await readdir(path.join(this.environment.dataDir, 'images'))).filter((name) => /\.jpe?g$/i.test(name) && !name.startsWith('.')).length;
        } catch {
            return null;
        }
    }

    private async disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
        try {
            const stats = await statfs(this.environment.dataDir);
            return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
        } catch {
            return null;
        }
    }

    /** Stand des Agents (Verbindung zum Server, Uploads); fehlt er, ist das ein Zustand, kein Fehler */
    private async agent(): Promise<unknown> {
        if (!this.environment.agentUrl) {
            return { reachable: false, reason: 'nicht eingerichtet' };
        }
        try {
            const response = await fetch(`${this.environment.agentUrl}/v1/status`, { signal: AbortSignal.timeout(2000) });
            return response.ok ? { reachable: true, ...((await response.json()) as object) } : { reachable: false, reason: `HTTP ${response.status}` };
        } catch (error) {
            return { reachable: false, reason: (error as Error).message };
        }
    }
}
