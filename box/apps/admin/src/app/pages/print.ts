// Druckkontingent: Stand und Erhöhen (auch für das Aufbau-Personal). Während eines Events gilt die Erhöhung
// nur für dieses Event und wird dem Server gemeldet.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { PrintStatus } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { State } from '../ui/state';

@Component({
    selector: 'sn-print',
    imports: [State],
    template: `
        <h1>Druckkontingent</h1>
        @if (status(); as s) {
            <section class="card" aria-labelledby="quota-title">
                <h2 id="quota-title">Kontingent</h2>
                @if (s.limit > 0) {
                    <p class="big">{{ s.remaining ?? '?' }} <small>von {{ s.limit }} übrig ({{ s.printed ?? '?' }} gedruckt)</small></p>
                    <p>
                        <sn-state [level]="s.locked ? 'error' : 'ok'">{{ s.locked ? 'Kontingent erreicht – Druck gesperrt' : 'Druck möglich' }}</sn-state>
                    </p>
                } @else {
                    <p>Kein Kontingent gesetzt – Drucken unbegrenzt ({{ s.printed ?? '?' }} gedruckt).</p>
                }
            </section>

            <section class="card" aria-labelledby="raise-title">
                <h2 id="raise-title">Kontingent erhöhen</h2>
                <div class="actions" role="group" aria-label="Schnell erhöhen">
                    @for (step of steps; track step) {
                        <button type="button" (click)="increase(step)" [disabled]="busy()">+ {{ step }}</button>
                    }
                </div>
                <form class="custom" novalidate (submit)="$event.preventDefault(); increase(custom())">
                    <label for="custom">Andere Anzahl</label>
                    <input id="custom" type="number" inputmode="numeric" min="1" max="1000" [value]="custom()" (input)="custom.set(+$any($event.target).value)" />
                    <button type="submit" [disabled]="busy() || custom() < 1 || custom() > 1000">Erhöhen</button>
                </form>
            </section>
        }
        <p class="status" role="status" aria-live="polite">
            @if (message(); as m) {
                <sn-state [level]="m.level">{{ m.text }}</sn-state>
            }
        </p>
    `,
    styles: `
        .big {
            font-size: 2.25rem;
            font-weight: 700;
            margin: 0.25rem 0;
        }
        .big small {
            font-size: 1rem;
            font-weight: 400;
            color: var(--muted);
        }
        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            margin-bottom: 1.25rem;
        }
        .actions button {
            min-width: 6rem;
            font-size: 1.25rem;
        }
        .custom {
            display: flex;
            flex-wrap: wrap;
            align-items: end;
            gap: 0.75rem;
        }
        .custom label {
            width: 100%;
        }
        .custom input {
            width: 8rem;
        }
        section + section {
            margin-top: 1rem;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Print {
    private readonly api = inject(Api);
    protected readonly steps = [10, 50, 100];
    protected readonly status = signal<PrintStatus | null>(null);
    protected readonly custom = signal(20);
    protected readonly busy = signal(false);
    protected readonly message = signal<{ level: 'ok' | 'error'; text: string } | null>(null);

    constructor() {
        this.api.print().then(
            (status) => this.status.set(status),
            (error) => this.message.set({ level: 'error', text: errorMessage(error) }),
        );
    }

    protected async increase(add: number): Promise<void> {
        this.busy.set(true);
        try {
            const status = await this.api.increaseQuota(add);
            this.status.set(status);
            this.message.set({ level: 'ok', text: `Kontingent um ${add} erhöht – jetzt ${status.remaining ?? '?'} Drucke übrig` });
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.busy.set(false);
        }
    }
}
