// Selbsttest und Aufbau-Checkliste (Modul selftest, Konzept 4.9).
//
// Ablauf beim Aufbau:
//   1. Selbsttest starten → automatische Prüfungen; Kamera, Testfoto und Drucker fragt app bis Paket 8/9 bei der
//      bisherigen App ab (api/selftest.php, mit der Sitzung der angemeldeten Person)
//   2. Buzzer drücken (prüft die Oberfläche), Punkte der Checkliste abhaken
//   3. Abschließen → Aufbau-Bericht mit Person und Zeit; gespeichert in app, übergeben an den Agent, der ihn
//      zum Server bringt. Ist der Agent gerade nicht da, versucht app es jede Minute erneut.

import { randomBytes } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
    CHECKLIST_FILE,
    REPORT_ID,
    worstLevel,
    type CheckLevel,
    type Checklist,
    type ChecklistFile,
    type SelftestCheck,
    type SelftestRun,
    type SetupOverview,
    type SetupReport,
} from '@snaphora/contracts';
import { readJson, writeJson } from '@snaphora/platform';
import type { Session } from '../access/access.service.js';
import { AgentLink } from '../agent-link/agent-link.service.js';
import { SettingsService } from '../config/settings.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { PrintService } from '../print/print.service.js';
import { DISK_ERROR_BYTES, DISK_WARN_BYTES, StatusService } from '../status/status.service.js';

interface StoredReport {
    report: SetupReport;
    delivered: boolean;
}

interface OpenRun {
    run: SelftestRun;
    personId: string;
    createdAt: number;
}

const RUN_VALID_MS = 2 * 3600_000;
const RETRY_MS = 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface CompleteInput {
    runId?: unknown;
    items?: unknown;
    note?: unknown;
    buzzerKey?: unknown;
}

const check = (id: string, label: string, level: CheckLevel, message: string): SelftestCheck => ({ id, label, level, message });

@Injectable()
export class SelftestService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger('Selbsttest');
    private readonly runs = new Map<string, OpenRun>();
    private retryTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly settings: SettingsService,
        private readonly print: PrintService,
        private readonly devices: DevicesService,
        private readonly state: StatusService,
        private readonly agent: AgentLink,
    ) {}

    onModuleInit(): void {
        this.retryTimer = setInterval(() => void this.deliverPending(), RETRY_MS);
        this.retryTimer.unref();
    }

    onModuleDestroy(): void {
        clearInterval(this.retryTimer);
    }

    private get reportDir(): string {
        return path.join(this.environment.stateDir, 'setup-reports');
    }

    private now(): Date {
        return this.environment.now();
    }

    /** Checkliste des aktiven Events (nur in dessen Zeitfenster) */
    async checklist(): Promise<{ eventId: string | null; checklist: Checklist | null }> {
        const event = await this.settings.activeEvent();
        const file = await readJson<ChecklistFile>(path.join(this.environment.configDir, CHECKLIST_FILE));
        const now = this.now().getTime();
        const valid =
            file !== null &&
            event !== null &&
            file.eventId === event.eventId &&
            Date.parse(file.validFrom) <= now &&
            now < Date.parse(file.validUntil) &&
            Array.isArray(file.checklist?.items);
        return { eventId: event?.eventId ?? null, checklist: valid ? file.checklist : null };
    }

    async run(session: Session, sessionCookie: string | undefined, withPhoto: boolean): Promise<SelftestRun> {
        const [own, hardware] = await Promise.all([this.ownChecks(), this.hardwareChecks(sessionCookie, withPhoto)]);
        const run: SelftestRun = { runId: randomBytes(12).toString('base64url'), startedAt: this.now().toISOString(), checks: [...hardware.checks, ...own], testPhoto: hardware.testPhoto };
        this.forgetOldRuns();
        this.runs.set(run.runId, { run, personId: session.personId, createdAt: this.now().getTime() });
        return run;
    }

    private forgetOldRuns(): void {
        const now = this.now().getTime();
        for (const [id, open] of this.runs) {
            if (now - open.createdAt > RUN_VALID_MS) this.runs.delete(id);
        }
    }

    /** Was app selbst prüfen kann */
    private async ownChecks(): Promise<SelftestCheck[]> {
        const [event, agent, disk, print, values] = await Promise.all([this.settings.activeEvent(), this.agent.status(), this.state.disk(), this.print.status(), this.settings.values()]);
        const checks: SelftestCheck[] = [];
        checks.push(event ? check('event', 'Event', 'ok', `${event.name ?? event.eventId} geladen`) : check('event', 'Event', 'warn', 'Kein Event aktiv – Box-Einstellungen gelten'));
        if (!agent.reachable) {
            checks.push(check('server', 'Server', 'error', `Agent läuft nicht (${agent.reason ?? 'unbekannt'}) – keine Konfiguration, kein Upload`));
        } else if (!agent.server) {
            checks.push(check('server', 'Server', 'warn', 'Ohne Server – Box läuft mit eigenen Einstellungen'));
        } else if (!agent.registered) {
            checks.push(check('server', 'Server', 'error', 'Box ist nicht registriert'));
        } else {
            checks.push(agent.lastSyncError ? check('server', 'Server', 'warn', 'Gerade keine Verbindung (LTE?) – letzte Konfiguration gilt, Uploads warten') : check('server', 'Server', 'ok', 'Verbunden'));
        }
        if (!disk) {
            checks.push(check('disk', 'Speicher', 'warn', 'Freier Speicher nicht lesbar'));
        } else {
            const free = `${(disk.freeBytes / 1e9).toFixed(1)} GB frei`;
            checks.push(check('disk', 'Speicher', disk.freeBytes < DISK_ERROR_BYTES ? 'error' : disk.freeBytes < DISK_WARN_BYTES ? 'warn' : 'ok', free));
        }
        checks.push(
            print.limit > 0
                ? check('quota', 'Druckkontingent', print.locked ? 'error' : 'ok', print.locked ? 'Kontingent erreicht – Druck gesperrt' : `${print.remaining ?? '?'} von ${print.limit} übrig`)
                : check('quota', 'Druckkontingent', 'ok', 'Kein Kontingent – Drucken unbegrenzt'),
        );
        checks.push(await this.renderCheck());
        if (values['get_request.countdown']?.value === true) {
            const ringlight = await this.devices.testRinglight();
            checks.push(check('ringlight', 'Ringlicht', ringlight.ok ? 'ok' : 'error', ringlight.ok ? `Hat geantwortet (${ringlight.milliseconds ?? '?'} ms)` : (ringlight.error ?? 'Fehler')));
        } else {
            checks.push(check('ringlight', 'Ringlicht', 'ok', 'Nicht eingeschaltet'));
        }
        return checks;
    }

    private async renderCheck(): Promise<SelftestCheck> {
        if (!this.environment.renderUrl) return check('render', 'Bildpipeline', 'warn', 'Nicht eingerichtet');
        try {
            const response = await fetch(`${this.environment.renderUrl}/health`, { signal: AbortSignal.timeout(3000) });
            await response.body?.cancel();
            return response.ok ? check('render', 'Bildpipeline', 'ok', 'Bereit') : check('render', 'Bildpipeline', 'error', `Antwortet mit HTTP ${response.status}`);
        } catch (error) {
            return check('render', 'Bildpipeline', 'error', `Nicht erreichbar (${(error as Error).message}) – Fotos werden langsamer verarbeitet`);
        }
    }

    /** Kamera, Testfoto, Drucker: bis Paket 8/9 bei der bisherigen App (sie besitzt Kamera und CUPS) */
    private async hardwareChecks(sessionCookie: string | undefined, withPhoto: boolean): Promise<{ checks: SelftestCheck[]; testPhoto: string | null }> {
        const unavailable = (reason: string) => ({
            checks: [check('camera', 'Kamera', 'error', reason), check('printer', 'Drucker', 'error', reason)],
            testPhoto: null,
        });
        if (!this.environment.photoboothUrl) return unavailable('Nicht prüfbar (Fotobox-App nicht eingerichtet)');
        try {
            const response = await fetch(`${this.environment.photoboothUrl}/api/selftest.php${withPhoto ? '?photo=1' : ''}`, {
                method: 'POST',
                headers: sessionCookie ? { Cookie: sessionCookie } : {},
                signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) return unavailable(`Nicht prüfbar (Fotobox-App: HTTP ${response.status})`);
            const body = (await response.json()) as { checks?: unknown; testPhoto?: unknown };
            const checks = (Array.isArray(body.checks) ? body.checks : [])
                .filter((c): c is SelftestCheck => typeof c?.id === 'string' && ['ok', 'warn', 'error'].includes(c?.level) && typeof c?.message === 'string' && typeof c?.label === 'string')
                .map((c) => check(c.id.slice(0, 40), c.label.slice(0, 60), c.level, c.message.slice(0, 300)));
            const testPhoto = typeof body.testPhoto === 'string' && /^data\/test\/selftest-[0-9-]+\.jpg$/.test(body.testPhoto) ? `/${body.testPhoto}` : null;
            return { checks, testPhoto };
        } catch (error) {
            return unavailable(`Nicht prüfbar (${(error as Error).message})`);
        }
    }

    async complete(input: CompleteInput, session: Session): Promise<SetupReport> {
        const runId = typeof input.runId === 'string' ? input.runId : '';
        const open = this.runs.get(runId);
        if (!open || open.personId !== session.personId) {
            throw new NotFoundException({ error: 'Selbsttest nicht gefunden oder abgelaufen – bitte neu starten' });
        }
        const { eventId, checklist } = await this.checklist();
        const done = new Set(Array.isArray(input.items) ? input.items.filter((id): id is string => typeof id === 'string' && ID.test(id)) : []);
        const note = typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim().slice(0, 1000) : null;
        const items = (checklist?.items ?? []).map((item) => ({ itemId: item.itemId, text: item.text, required: item.required, done: done.has(item.itemId) }));
        const missing = items.filter((item) => item.required && !item.done);
        if (missing.length > 0 && !note) {
            throw new BadRequestException({ error: `Nicht erledigt: ${missing.map((item) => item.text).join(', ')} – bitte abhaken oder in der Bemerkung begründen`, path: 'note' });
        }

        const checks = [...open.run.checks, await this.buzzerCheck(input.buzzerKey)];
        const report: SetupReport = {
            reportId: `${this.now().toISOString().slice(0, 10)}-${randomBytes(8).toString('hex')}`,
            eventId,
            checklistId: checklist?.checklistId ?? null,
            checklistVersion: checklist?.version ?? null,
            personId: session.personId,
            personName: session.name,
            startedAt: open.run.startedAt,
            completedAt: this.now().toISOString(),
            result: worstLevel([...checks.map((c) => c.level), ...(missing.length > 0 ? (['warn'] as CheckLevel[]) : [])]),
            checks,
            items,
            note,
        };
        this.runs.delete(runId);
        await mkdir(this.reportDir, { recursive: true });
        const stored: StoredReport = { report, delivered: await this.agent.deliverReport(report) };
        await writeJson(path.join(this.reportDir, `${report.reportId}.json`), stored, 0o600);
        if (!stored.delivered) this.logger.warn(`Aufbau-Bericht ${report.reportId} noch nicht beim Agent – neuer Versuch in einer Minute`);
        return report;
    }

    /** Die Oberfläche meldet, welche Taste beim „Buzzer drücken“ kam; verglichen wird mit der Einstellung */
    private async buzzerCheck(value: unknown): Promise<SelftestCheck> {
        const values = await this.settings.values();
        const configured = [values['picture.key']?.value, values['collage.key']?.value].filter((key): key is string => typeof key === 'string' && key !== '');
        if (configured.length === 0) return check('buzzer', 'Buzzer', 'warn', 'Keine Buzzer-Taste eingestellt');
        if (typeof value !== 'number' || !Number.isInteger(value)) return check('buzzer', 'Buzzer', 'warn', 'Nicht geprüft');
        return configured.includes(String(value)) ? check('buzzer', 'Buzzer', 'ok', `Taste ${value} kommt an`) : check('buzzer', 'Buzzer', 'error', `Taste ${value} gedrückt, eingestellt ist ${configured.join(' / ')}`);
    }

    private async storedReports(): Promise<Array<{ file: string; stored: StoredReport }>> {
        const result: Array<{ file: string; stored: StoredReport }> = [];
        for (const name of await readdir(this.reportDir).catch(() => [] as string[])) {
            if (!name.endsWith('.json') || !REPORT_ID.test(name.slice(0, -5))) continue;
            const file = path.join(this.reportDir, name);
            const stored = await readJson<StoredReport>(file);
            if (stored?.report?.reportId) result.push({ file, stored });
        }
        return result.sort((a, b) => b.stored.report.completedAt.localeCompare(a.stored.report.completedAt));
    }

    /** Berichte, die der Agent noch nicht übernommen hat, erneut übergeben */
    async deliverPending(): Promise<void> {
        for (const { file, stored } of await this.storedReports()) {
            if (stored.delivered) continue;
            if (await this.agent.deliverReport(stored.report)) {
                await writeJson(file, { ...stored, delivered: true }, 0o600);
            } else {
                return;
            }
        }
    }

    async overview(): Promise<SetupOverview> {
        const { eventId, checklist } = await this.checklist();
        const reports = (await this.storedReports()).slice(0, 20).map(({ stored }) => ({ ...stored.report, delivered: stored.delivered }));
        return { eventId, checklist, reports };
    }
}
