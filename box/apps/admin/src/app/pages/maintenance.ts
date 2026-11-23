// Wartung: Abgleich mit dem Server und – bis sie in diese Oberfläche wandern – die Werkzeuge der alten Verwaltung.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api, errorMessage } from '../core/api';
import { Session } from '../core/session';
import { State } from '../ui/state';

/** Noch in der alten Oberfläche (planning/ADMIN.md: 7c–7e bzw. Paket 9) */
const LEGACY_TOOLS = [
    { href: '/admin-alt/', label: 'Alle Einstellungen (alte Verwaltung)', admin: true },
    { href: '/gallery/', label: 'Galerie (Fotos ansehen und löschen)', admin: false },
    { href: '/slideshow/', label: 'Diashow', admin: false },
    { href: '/admin-alt/diskusage/', label: 'Speicherbelegung', admin: true },
    { href: '/admin-alt/debug/', label: 'Protokolle der App', admin: true },
    { href: '/test/', label: 'Testseiten (Foto, Collage, Vorschau)', admin: true },
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
        <section class="card" aria-labelledby="legacy-title">
            <h2 id="legacy-title">Weitere Werkzeuge</h2>
            <p class="muted">Diese Seiten gehören noch zur bisherigen Oberfläche und werden schrittweise ersetzt.</p>
            <ul>
                @for (tool of tools(); track tool.href) {
                    <li><a [href]="tool.href">{{ tool.label }}</a></li>
                }
            </ul>
        </section>
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
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Maintenance {
    private readonly api = inject(Api);
    private readonly session = inject(Session);
    protected readonly busy = signal(false);
    protected readonly message = signal<{ level: 'ok' | 'warn' | 'error'; text: string } | null>(null);
    protected readonly tools = () => LEGACY_TOOLS.filter((tool) => !tool.admin || this.session.allows('admin'));

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
