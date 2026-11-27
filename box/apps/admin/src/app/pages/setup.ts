// Aufbau: Selbsttest, Buzzer, Checkliste, Abschluss (Konzept 4.9).
// Am Touchscreen in Schritten von oben nach unten; das Ergebnis geht mit Person und Zeit an den Server.

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import type { SelftestRun, SetupOverview, SetupReport } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { keyName } from '../ui/setting-field';
import { State } from '../ui/state';

@Component({
    selector: 'sn-setup',
    imports: [State],
    template: `
        <h1>Aufbau</h1>

        <section class="card" aria-labelledby="schritt-1">
            <h2 id="schritt-1">1. Selbsttest</h2>
            <p>Prüft Kamera, Drucker, Verbindung, Speicher, Bildpipeline und Ringlicht.</p>
            <label class="check">
                <input type="checkbox" [checked]="withPhoto()" (change)="withPhoto.set($any($event.target).checked)" />
                <span>Mit Testfoto (kommt nicht in die Galerie)</span>
            </label>
            <button type="button" (click)="runSelftest()" [disabled]="running()">{{ running() ? 'Prüfe …' : run() ? 'Erneut prüfen' : 'Selbsttest starten' }}</button>
            @if (run(); as r) {
                <ul class="checks" aria-label="Ergebnisse">
                    @for (check of r.checks; track check.id) {
                        <li>
                            <sn-state [level]="check.level">{{ check.label }}</sn-state>
                            <span>{{ check.message }}</span>
                        </li>
                    }
                </ul>
                @if (r.testPhoto) {
                    <img class="photo" [src]="r.testPhoto" alt="Testfoto aus dem Selbsttest" />
                }
            }
        </section>

        <section class="card" aria-labelledby="schritt-2">
            <h2 id="schritt-2">2. Buzzer</h2>
            <p>Einmal den Buzzer (Presenter) drücken.</p>
            <button type="button" class="secondary" (click)="listenBuzzer()" [attr.aria-pressed]="listening()">{{ listening() ? 'Warte auf den Buzzer …' : 'Buzzer prüfen' }}</button>
            <p aria-live="polite">
                @if (buzzerKey() !== null) {
                    Angekommen: {{ buzzerLabel() }}
                }
            </p>
        </section>

        @if (overview()?.checklist; as checklist) {
            <section class="card" aria-labelledby="schritt-3">
                <h2 id="schritt-3">3. {{ checklist.name }}</h2>
                <ul class="items">
                    @for (item of checklist.items; track item.itemId) {
                        <li>
                            <label class="check">
                                <input type="checkbox" [checked]="done().has(item.itemId)" (change)="toggle(item.itemId, $any($event.target).checked)" />
                                <span>{{ item.text }}@if (item.required) {<strong class="required"> · Pflicht</strong>}</span>
                            </label>
                        </li>
                    }
                </ul>
            </section>
        }

        <section class="card" aria-labelledby="schritt-4">
            <h2 id="schritt-4">{{ overview()?.checklist ? '4' : '3' }}. Abschließen</h2>
            <label for="bemerkung">Bemerkung {{ missingRequired() ? '(nötig, weil Pflichtpunkte offen sind)' : '(optional)' }}</label>
            <textarea id="bemerkung" rows="2" maxlength="1000" [value]="note()" (input)="note.set($any($event.target).value)" [attr.aria-invalid]="missingRequired() && !note().trim()"></textarea>
            <button type="button" (click)="complete()" [disabled]="!run() || busy() || (missingRequired() && !note().trim())">Aufbau abschließen</button>
            @if (!run()) {
                <p class="muted">Erst den Selbsttest starten.</p>
            }
        </section>

        <p role="status" aria-live="polite">
            @if (message(); as m) {
                <sn-state [level]="m.level">{{ m.text }}</sn-state>
            }
        </p>

        @if (overview()?.reports?.length) {
            <section class="card" aria-labelledby="berichte">
                <h2 id="berichte">Letzte Berichte</h2>
                <table>
                    <caption class="visually-hidden">Aufbau-Berichte, neueste zuerst</caption>
                    <thead>
                        <tr><th scope="col">Zeit</th><th scope="col">Person</th><th scope="col">Ergebnis</th><th scope="col">An den Server</th></tr>
                    </thead>
                    <tbody>
                        @for (report of overview()!.reports; track report.reportId) {
                            <tr>
                                <td>{{ time(report.completedAt) }}</td>
                                <td>{{ report.personName }}</td>
                                <td><sn-state [level]="report.result">{{ resultText(report) }}</sn-state></td>
                                <td>{{ report.delivered ? 'übergeben' : 'wartet' }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
            </section>
        }
    `,
    styles: `
        section + section {
            margin-top: 1rem;
        }
        .check {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            min-height: var(--touch);
        }
        .check input {
            width: 1.75rem;
            height: 1.75rem;
            flex-shrink: 0;
        }
        .checks,
        .items {
            list-style: none;
            padding: 0;
            margin: 1rem 0 0;
        }
        .checks li {
            display: grid;
            grid-template-columns: minmax(10rem, 14rem) 1fr;
            gap: 0.75rem;
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--line);
        }
        @media (max-width: 40rem) {
            .checks li {
                grid-template-columns: 1fr;
                gap: 0.25rem;
            }
        }
        .photo {
            display: block;
            max-width: 100%;
            max-height: 18rem;
            margin-top: 1rem;
            border-radius: var(--radius);
        }
        .required {
            color: var(--danger);
        }
        label[for='bemerkung'] {
            display: block;
            font-weight: 600;
            margin-bottom: 0.35rem;
        }
        textarea {
            width: 100%;
            max-width: 36rem;
            display: block;
            margin-bottom: 1rem;
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
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Setup {
    private readonly api = inject(Api);
    protected readonly overview = signal<SetupOverview | null>(null);
    protected readonly run = signal<SelftestRun | null>(null);
    protected readonly withPhoto = signal(true);
    protected readonly running = signal(false);
    protected readonly busy = signal(false);
    protected readonly listening = signal(false);
    protected readonly buzzerKey = signal<number | null>(null);
    protected readonly done = signal(new Set<string>());
    protected readonly note = signal('');
    protected readonly message = signal<{ level: 'ok' | 'warn' | 'error'; text: string } | null>(null);
    private stopListening: (() => void) | null = null;

    protected readonly buzzerLabel = computed(() => keyName(String(this.buzzerKey() ?? '')));
    protected readonly missingRequired = computed(() => (this.overview()?.checklist?.items ?? []).some((item) => item.required && !this.done().has(item.itemId)));

    constructor() {
        void this.load();
        inject(DestroyRef).onDestroy(() => this.stopListening?.());
    }

    protected async runSelftest(): Promise<void> {
        this.running.set(true);
        this.message.set(null);
        try {
            this.run.set(await this.api.runSelftest(this.withPhoto()));
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.running.set(false);
        }
    }

    protected listenBuzzer(): void {
        if (this.listening()) {
            this.stopListening?.();
            return;
        }
        this.listening.set(true);
        const listener = (event: KeyboardEvent) => {
            event.preventDefault();
            this.buzzerKey.set(event.keyCode);
            this.stopListening?.();
        };
        window.addEventListener('keydown', listener, { capture: true });
        this.stopListening = () => {
            window.removeEventListener('keydown', listener, { capture: true });
            this.listening.set(false);
            this.stopListening = null;
        };
    }

    protected toggle(itemId: string, checked: boolean): void {
        this.done.update((done) => {
            const next = new Set(done);
            if (checked) next.add(itemId);
            else next.delete(itemId);
            return next;
        });
    }

    protected async complete(): Promise<void> {
        const run = this.run();
        if (!run) return;
        this.busy.set(true);
        try {
            const report = await this.api.completeSetup({ runId: run.runId, items: [...this.done()], note: this.note().trim() || undefined, buzzerKey: this.buzzerKey() ?? undefined });
            this.message.set({ level: report.result, text: `Aufbau abgeschlossen: ${this.resultText(report)}` });
            this.run.set(null);
            this.done.set(new Set());
            this.note.set('');
            this.buzzerKey.set(null);
            await this.load();
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        } finally {
            this.busy.set(false);
        }
    }

    protected resultText(report: SetupReport): string {
        return report.result === 'ok' ? 'alles in Ordnung' : report.result === 'warn' ? 'mit Hinweisen' : 'mit Fehlern';
    }

    protected time(iso: string): string {
        return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    private async load(): Promise<void> {
        try {
            this.overview.set(await this.api.setupOverview());
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        }
    }
}
