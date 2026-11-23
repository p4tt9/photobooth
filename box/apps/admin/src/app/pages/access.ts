// Zugang: wer ist angemeldet, Sperre, Protokoll aller Anmeldungen und Änderungen (nur Admins).

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AccessLog, AuditEntry } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { State } from '../ui/state';

@Component({
    selector: 'sn-access',
    imports: [State],
    template: `
        <h1>Zugang</h1>
        @if (log(); as l) {
            <section class="card" aria-labelledby="now-title">
                <h2 id="now-title">Jetzt</h2>
                @if (l.lock.lockedUntil) {
                    <p><sn-state level="error">Anmeldung gesperrt bis {{ time(l.lock.lockedUntil) }} ({{ l.lock.failures }} Fehlversuche)</sn-state></p>
                } @else if (l.lock.failures > 0) {
                    <p><sn-state level="warn">{{ l.lock.failures }} Fehlversuch(e) seit der letzten Anmeldung</sn-state></p>
                }
                <p>Angemeldet: {{ sessions(l) }}</p>
            </section>
            <section class="card" aria-labelledby="log-title">
                <h2 id="log-title">Protokoll</h2>
                <table>
                    <caption class="visually-hidden">Anmeldungen und Änderungen, neueste zuerst</caption>
                    <thead>
                        <tr><th scope="col">Zeit</th><th scope="col">Person</th><th scope="col">Was</th></tr>
                    </thead>
                    <tbody>
                        @for (entry of l.entries; track $index) {
                            <tr>
                                <td>{{ time(entry.at) }}</td>
                                <td>{{ entry.name ?? '–' }}</td>
                                <td>{{ entry.action }}{{ details(entry) }}</td>
                            </tr>
                        } @empty {
                            <tr><td colspan="3">Noch keine Einträge</td></tr>
                        }
                    </tbody>
                </table>
            </section>
        }
        @if (error()) {
            <p role="alert"><sn-state level="error">{{ error() }}</sn-state></p>
        }
    `,
    styles: `
        section + section {
            margin-top: 1rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th,
        td {
            text-align: left;
            padding: 0.5rem;
            border-bottom: 1px solid var(--line);
            vertical-align: top;
        }
        td:first-child {
            white-space: nowrap;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Access {
    private readonly api = inject(Api);
    protected readonly log = signal<AccessLog | null>(null);
    protected readonly error = signal('');

    constructor() {
        this.api.accessLog().then(
            (log) => this.log.set(log),
            (error) => this.error.set(errorMessage(error)),
        );
    }

    protected time(iso: string): string {
        return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    protected sessions(log: AccessLog): string {
        return log.sessions.map((s) => `${s.name}${s.kiosk ? ' (Kiosk)' : ''}`).join(', ') || 'niemand';
    }

    /** Kurzfassung der Details, z. B. welche Einstellung von welchem auf welchen Wert */
    protected details(entry: AuditEntry): string {
        const details = entry.details ?? {};
        const changes = details['changes'];
        if (Array.isArray(changes)) {
            return ': ' + changes.map((c: { path: string; from: unknown; to: unknown }) => `${c.path} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join(', ');
        }
        if (typeof details['add'] === 'number') {
            return `: +${details['add']} (jetzt ${String(details['limit'])})`;
        }
        return '';
    }
}
