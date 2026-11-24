// Ringlicht beim Aufbau prüfen: löst es einmal aus, so wie beim Countdown.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { RinglightTest } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { State } from './state';

@Component({
    selector: 'sn-ringlight-test',
    imports: [State],
    template: `
        <section class="card" aria-labelledby="ringlicht-titel">
            <h2 id="ringlicht-titel">Ringlicht prüfen</h2>
            <p>Schaltet das Ringlicht einmal ein, wie beim Countdown. Gespeicherte Adresse wird verwendet.</p>
            <button type="button" (click)="test()" [disabled]="busy()">Ringlicht testen</button>
            <p role="status" aria-live="polite">
                @if (result(); as r) {
                    <sn-state [level]="r.ok ? 'ok' : 'error'">{{ r.ok ? 'Ringlicht hat geantwortet' + (r.milliseconds !== undefined ? ' (' + r.milliseconds + ' ms)' : '') : r.error }}</sn-state>
                }
            </p>
        </section>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RinglightTestCard {
    private readonly api = inject(Api);
    protected readonly busy = signal(false);
    protected readonly result = signal<RinglightTest | null>(null);

    protected async test(): Promise<void> {
        this.busy.set(true);
        try {
            this.result.set(await this.api.testRinglight());
        } catch (error) {
            this.result.set({ ok: false, url: null, error: errorMessage(error) });
        } finally {
            this.busy.set(false);
        }
    }
}
