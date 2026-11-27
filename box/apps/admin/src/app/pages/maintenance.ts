// Wartung: Abgleich mit dem Server, Galerie und Diashow der Gäste, Protokoll der Fotobox-App.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';
import { Session } from '../core/session';
import { State } from '../ui/state';

/** Seiten der Gäste-Oberfläche (bis Paket 9 noch die bisherige App) */
const GUEST_PAGES = [
    { href: '/gallery/', label: 'Galerie (Fotos ansehen und löschen)' },
    { href: '/slideshow/', label: 'Diashow' },
];

@Component({
    selector: 'sn-maintenance',
    imports: [State],
    template: `
        <h1>Wartung</h1>
        <section class="card" aria-labelledby="sync-title">
            <h2 id="sync-title">Server</h2>
            <p>Die Box gleicht sich jede Minute ab. Nach einer Änderung im Backend geht es hiermit sofort.</p>
            <button type="button" (click)="sync()" [disabled]="busy()">Jetzt abgleichen</button>
            <p role="status" aria-live="polite">
                @if (message(); as m) {
                    <sn-state [level]="m.level">{{ m.text }}</sn-state>
                }
            </p>
        </section>
        <section class="card" aria-labelledby="guest-title">
            <h2 id="guest-title">Gäste-Seiten</h2>
            <ul>
                @for (page of guestPages; track page.href) {
                    <li><a [href]="page.href">{{ page.label }}</a></li>
                }
            </ul>
        </section>
        @if (session.allows('admin')) {
            <section class="card" aria-labelledby="log-title">
                <h2 id="log-title">Protokoll der Fotobox-App</h2>
                <button type="button" class="secondary" (click)="loadLog()" [disabled]="loadingLog()">{{ log() ? 'Neu laden' : 'Protokoll anzeigen' }}</button>
                @if (log(); as lines) {
                    @if (lines.length === 0) {
                        <p>Keine Einträge.</p>
                    } @else {
                        <ol class="log" aria-label="Einträge, neueste zuerst" tabindex="0">
                            @for (line of lines; track $index) {
                                <li [class]="line.level">
                                    @if (line.level !== 'info') {
                                        <sn-state [level]="line.level === 'error' ? 'error' : 'warn'">{{ line.level === 'error' ? 'Fehler' : 'Warnung' }}</sn-state>
                                    }
                                    <code>{{ line.text }}</code>
                                </li>
                            }
                        </ol>
                    }
                }
            </section>
        }
    `,
    styles: `
        section + section {
            margin-top: 1rem;
        }
        ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        li a {
            display: flex;
            align-items: center;
            min-height: var(--touch);
        }
        .log {
            margin-top: 1rem;
            max-height: 30rem;
            overflow: auto;
            font-size: 0.85rem;
        }
        .log li {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            padding: 0.3rem 0;
            border-bottom: 1px solid var(--line);
        }
        .log code {
            white-space: pre-wrap;
            word-break: break-word;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Maintenance {
    private readonly api = inject(Api);
    protected readonly session = inject(Session);
    protected readonly busy = signal(false);
    protected readonly message = signal<{ level: 'ok' | 'warn' | 'error'; text: string } | null>(null);
    protected readonly guestPages = GUEST_PAGES;
    protected readonly log = signal<Array<{ text: string; level: 'error' | 'warn' | 'info' }> | null>(null);
    protected readonly loadingLog = signal(false);

    protected async loadLog(): Promise<void> {
        this.loadingLog.set(true);
        try {
            const result = await this.api.appLog();
            this.log.set(result.lines);
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.loadingLog.set(false);
        }
    }

    protected async sync(): Promise<void> {
        this.busy.set(true);
        this.message.set(null);
        try {
            const agent = await this.api.syncNow();
            if (!agent.server) {
                this.message.set({ level: 'warn', text: 'Die Box ist mit keinem Server verbunden' });
            } else if (agent.lastSyncError) {
                this.message.set({ level: 'error', text: `Abgleich fehlgeschlagen: ${agent.lastSyncError}` });
            } else {
                this.message.set({ level: 'ok', text: 'Abgeglichen' });
            }
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.busy.set(false);
        }
    }
}
