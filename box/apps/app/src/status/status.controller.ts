// Gesamtzustand der Box (Modul status): Grundlage für Übersicht und Selbsttest.

import { readdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { BadGatewayException, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AgentStatus, BoxStatus } from '@snaphora/contracts';
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
    async status(): Promise<BoxStatus> {
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

    /** Sofort mit dem Server abgleichen (sonst jede Minute) */
    @Post('maintenance/sync')
    @Access('setup')
    @HttpCode(200)
    async syncNow(): Promise<AgentStatus> {
        const agent = await this.agent('POST', '/v1/sync', 60_000);
        if (!agent.reachable) {
            throw new BadGatewayException({ error: `Agent nicht erreichbar: ${agent.reason}` });
        }
        return agent;
    }

    /**
     * Stand des Agents (Verbindung zum Server, Uploads); fehlt er, ist das ein Zustand, kein Fehler.
     * Weitergegeben werden nur die Felder für die Oberfläche (keine Dateinamen, keine Adressen von Fotos).
     */
    private async agent(method: 'GET' | 'POST' = 'GET', path = '/v1/status', timeout = 2000): Promise<AgentStatus> {
        if (!this.environment.agentUrl) {
            return { reachable: false, reason: 'nicht eingerichtet' };
        }
        try {
            const response = await fetch(`${this.environment.agentUrl}${path}`, { method, signal: AbortSignal.timeout(timeout) });
            if (!response.ok) {
                return { reachable: false, reason: `HTTP ${response.status}` };
            }
            const body = (await response.json()) as Record<string, any>;
            const uploads = body.uploads ?? {};
            return {
                reachable: true,
                server: typeof body.server === 'string' ? body.server : null,
                registered: body.registered === true,
                deviceId: typeof body.deviceId === 'string' ? body.deviceId : null,
                lastSync: typeof body.lastSync === 'string' ? body.lastSync : null,
                lastSyncError: typeof body.lastSyncError === 'string' ? body.lastSyncError : null,
                uploads: { pending: Number(uploads.pending) || 0, failed: Number(uploads.failed) || 0, uploaded: Number(uploads.uploaded) || 0, local: Number(uploads.local) || 0 },
            };
        } catch (error) {
            return { reachable: false, reason: (error as Error).message };
        }
    }
}
