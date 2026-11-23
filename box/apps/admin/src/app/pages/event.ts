// Event: was der Server für die Feier vorgibt und was an der Box davon abweicht (Ebene „local-event“).
// Die Vorgaben selbst werden im Backend gepflegt; hier sieht man sie und kann Ausnahmen zurücknehmen.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SettingsResponse } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { Session } from '../core/session';
import { State } from '../ui/state';

@Component({
    selector: 'sn-event',
    imports: [State, RouterLink],
    template: `
        <h1>Event</h1>
        @if (data(); as d) {
            @if (d.event; as event) {
                <section class="card" aria-labelledby="event-name">
                    <h2 id="event-name">{{ event.name ?? event.eventId }}</h2>
                    <p class="muted">Kennung {{ event.eventId }}{{ event.version !== null ? ' · Version ' + event.version : '' }}</p>
                </section>

                <section class="card" aria-labelledby="managed-title">
                    <h2 id="managed-title">Vorgaben des Events</h2>
                    <table>
                        <caption class="visually-hidden">Einstellungen, die das Event vorgibt</caption>
                        <thead>
                            <tr><th scope="col">Einstellung</th><th scope="col">Wert</th><th scope="col">Herkunft</th></tr>
                        </thead>
                        <tbody>
                            @for (row of managed(); track row.path) {
                                <tr>
                                    <td>{{ row.label }}</td>
                                    <td>{{ row.value }}</td>
                                    <td>
                                        @if (row.changed) {
                                            <sn-state level="warn">an der Box geändert</sn-state>
                                        } @else {
                                            vom Event
                                        }
                                    </td>
                                </tr>
                            }
                        </tbody>
                    </table>
                    @if (changedCount() > 0 && session.allows('admin')) {
                        <button type="button" class="secondary" (click)="reset()" [disabled]="busy()">Alle Änderungen an der Box zurücknehmen</button>
                    }
                </section>
            } @else {
                <section class="card">
                    <p><sn-state level="warn">Kein Event aktiv.</sn-state> Die Box läuft mit ihren eigenen Einstellungen.</p>
                    <p>Ein Event kommt vom Server, sobald die Box einer Buchung zugeordnet ist, und gilt in deren Zeitfenster.</p>
                    <a routerLink="/wartung">Jetzt mit dem Server abgleichen</a>
                </section>
            }
        }
        <p role="status" aria-live="polite">
            @if (message(); as m) {
                <sn-state [level]="m.level">{{ m.text }}</sn-state>
            }
        </p>
    `,
    styles: `
        section + section {
            margin-top: 1rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1rem;
        }
        th,
        td {
            text-align: left;
            padding: 0.6rem 0.5rem;
            border-bottom: 1px solid var(--line);
            vertical-align: top;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Event {
    private readonly api = inject(Api);
    protected readonly session = inject(Session);
    protected readonly data = signal<SettingsResponse | null>(null);
    protected readonly busy = signal(false);
    protected readonly message = signal<{ level: 'ok' | 'error'; text: string } | null>(null);

    protected readonly managed = computed(() => {
        const data = this.data();
        if (!data) return [];
        return data.definitions
            .filter((d) => data.values[d.path]?.eventManaged)
            .map((d) => {
                const state = data.values[d.path];
                const value = state?.value;
                return {
                    path: d.path,
                    label: d.label,
                    value: typeof value === 'boolean' ? (value ? 'ja' : 'nein') : String(value ?? ''),
                    changed: state?.source === 'local-event',
                };
            });
    });
    protected readonly changedCount = computed(() => this.managed().filter((row) => row.changed).length);

    constructor() {
        void this.load();
    }

    protected async reset(): Promise<void> {
        this.busy.set(true);
        try {
            await this.api.resetEventChanges();
            await this.load();
            this.message.set({ level: 'ok', text: 'Die Vorgaben des Events gelten wieder' });
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.busy.set(false);
        }
    }

    private async load(): Promise<void> {
        try {
            this.data.set(await this.api.settings());
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        }
    }
}
