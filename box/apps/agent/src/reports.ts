// Aufbau-Berichte an den Server (Konzept 4.9): app übergibt sie, der Agent liefert sie aus.
//
// Wie bei den Fotos: eine Datei je Bericht in agent/reports/, Wiederholung mit wachsendem Abstand, übersteht
// Funkloch und Stromausfall. Der Server erkennt Wiederholungen an der Kennung (PUT ist wiederholbar).

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_ID, type SetupReport } from '@snaphora/contracts';
import { readJson, writeJson } from '@snaphora/platform';
import { OfflineError, RejectedError, type ServerClient } from './client.js';

export interface ReportEntry {
    report: SetupReport;
    state: 'pending' | 'sent' | 'rejected';
    attempts: number;
    nextAttemptAt: number;
    lastError?: string;
    sentAt?: string;
}

export interface ReportQueueOptions {
    agentDir: string;
    log: (message: string) => void;
    now?: () => number;
}

const MAX_BACKOFF_MS = 10 * 60_000;
/** Gesendete Berichte bleiben eine Weile zur Ansicht liegen, dann werden sie gelöscht */
const KEEP_SENT_MS = 30 * 24 * 3600_000;

export class InvalidReportError extends Error {}

/** Grobe Prüfung an der Grenze – app hat den Bericht gebaut, aber der Agent vertraut niemandem blind */
export function checkReport(value: unknown): SetupReport {
    const report = value as Partial<SetupReport> | null;
    if (!report || typeof report !== 'object' || typeof report.reportId !== 'string' || !REPORT_ID.test(report.reportId)) {
        throw new InvalidReportError('Bericht ohne gültige Kennung');
    }
    if (report.eventId !== null && (typeof report.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(report.eventId))) {
        throw new InvalidReportError('Bericht mit ungültigem Event');
    }
    if (!Array.isArray(report.checks) || !Array.isArray(report.items) || typeof report.personId !== 'string' || typeof report.completedAt !== 'string') {
        throw new InvalidReportError('Bericht unvollständig');
    }
    if (JSON.stringify(report).length > 256 * 1024) {
        throw new InvalidReportError('Bericht zu groß');
    }
    return report as SetupReport;
}

export class ReportQueue {
    private readonly entries = new Map<string, ReportEntry>();

    constructor(private readonly options: ReportQueueOptions) {}

    private get directory(): string {
        return path.join(this.options.agentDir, 'reports');
    }

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }

    async start(): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        for (const name of await readdir(this.directory)) {
            const id = name.replace(/\.json$/, '');
            if (!REPORT_ID.test(id)) continue;
            const entry = await readJson<ReportEntry>(path.join(this.directory, name));
            if (!entry) continue;
            try {
                checkReport(entry.report);
            } catch {
                continue;
            }
            if (entry.state === 'sent' && entry.sentAt && this.now() - Date.parse(entry.sentAt) > KEEP_SENT_MS) {
                await rm(path.join(this.directory, name), { force: true });
                continue;
            }
            this.entries.set(id, entry);
        }
    }

    /** Übernimmt einen Bericht; derselbe Bericht zweimal ändert nichts */
    async add(value: unknown): Promise<ReportEntry> {
        const report = checkReport(value);
        const existing = this.entries.get(report.reportId);
        if (existing) return existing;
        const entry: ReportEntry = { report, state: 'pending', attempts: 0, nextAttemptAt: this.now() };
        await this.save(entry);
        return entry;
    }

    private async save(entry: ReportEntry): Promise<void> {
        this.entries.set(entry.report.reportId, entry);
        await writeJson(path.join(this.directory, `${entry.report.reportId}.json`), entry);
    }

    counts(): { pending: number; sent: number; rejected: number } {
        const counts = { pending: 0, sent: 0, rejected: 0 };
        for (const entry of this.entries.values()) counts[entry.state] += 1;
        return counts;
    }

    has(reportId: string): boolean {
        return this.entries.has(reportId);
    }

    async uploadDue(client: ServerClient): Promise<number> {
        let sent = 0;
        for (const entry of this.entries.values()) {
            if (entry.state !== 'pending' || entry.nextAttemptAt > this.now()) continue;
            try {
                await client.putSetupReport(entry.report);
                await this.save({ ...entry, state: 'sent', sentAt: new Date(this.now()).toISOString(), lastError: undefined });
                sent += 1;
            } catch (error) {
                if (error instanceof RejectedError && error.status !== 401) {
                    this.options.log(`Aufbau-Bericht ${entry.report.reportId} abgelehnt (HTTP ${error.status}) – wird nicht wiederholt`);
                    await this.save({ ...entry, state: 'rejected', lastError: error.message });
                    continue;
                }
                const attempts = entry.attempts + 1;
                await this.save({ ...entry, attempts, nextAttemptAt: this.now() + Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (attempts - 1)), lastError: (error as Error).message });
                if (error instanceof OfflineError) break;
            }
        }
        return sent;
    }
}
