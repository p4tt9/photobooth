// Verbindung von app zum Agent im internen Docker-Netz (Status, sofortiger Abgleich, Aufbau-Berichte).
// Fehlt der Agent oder antwortet er nicht, ist das ein Zustand, kein Fehler: die Box läuft auch ohne ihn.

import { Inject, Injectable } from '@nestjs/common';
import type { AgentStatus, SetupReport } from '@snaphora/contracts';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

@Injectable()
export class AgentLink {
    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    /** Stand des Agents; weitergegeben werden nur die Felder für die Oberfläche (keine Dateinamen von Fotos) */
    async status(method: 'GET' | 'POST' = 'GET', path = '/v1/status', timeout = 2000): Promise<AgentStatus> {
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

    syncNow(): Promise<AgentStatus> {
        return this.status('POST', '/v1/sync', 60_000);
    }

    /** Übergibt einen Aufbau-Bericht; true, sobald der Agent ihn sicher gespeichert hat */
    async deliverReport(report: SetupReport): Promise<boolean> {
        if (!this.environment.agentUrl) {
            return false;
        }
        try {
            const response = await fetch(`${this.environment.agentUrl}/v1/reports`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(report),
                signal: AbortSignal.timeout(5000),
            });
            await response.body?.cancel();
            return response.status === 202;
        } catch {
            return false;
        }
    }
}
