// Einstellungen eines Bereichs, erzeugt aus dem Katalog. Geprüft wird schon hier mit derselben Funktion wie im
// Server (gleiche Meldungen); maßgeblich bleibt die Prüfung in app. Gespeichert werden nur geänderte Werte.

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import {
    findSetting,
    InvalidSettingError,
    validateSetting,
    type ConfigValue,
    type SettingSection,
    type SettingsResponse,
} from '@snaphora/contracts';
import { Api, errorMessage, errorPath } from '../core/api';
import { Session } from '../core/session';
import { SettingField } from '../ui/setting-field';
import { State } from '../ui/state';

@Component({
    selector: 'sn-settings',
    imports: [SettingField, State],
    template: `
        <h1>{{ title() }}</h1>
        @if (data(); as d) {
            @if (d.event) {
                <p class="note">Event <strong>{{ d.event.name ?? d.event.eventId }}</strong> ist aktiv. Einstellungen, die es vorgibt, gelten nach einer Änderung nur für dieses Event.</p>
            }
            <form novalidate (submit)="$event.preventDefault(); save()">
                @for (definition of definitions(); track definition.path) {
                    <sn-setting-field
                        [definition]="definition"
                        [state]="d.values[definition.path]"
                        [value]="current(definition.path)"
                        [error]="errors()[definition.path] ?? null"
                        [readonly]="!session.allows(definition.role)"
                        (changed)="change(definition.path, $event)"
                    />
                }
                <div class="bar">
                    <button type="submit" [disabled]="busy() || !dirty()">Speichern</button>
                    <button type="button" class="secondary" [disabled]="busy() || !dirty()" (click)="discard()">Verwerfen</button>
                </div>
            </form>
        }
        <p role="status" aria-live="polite">
            @if (message(); as m) {
                <sn-state [level]="m.level">{{ m.text }}</sn-state>
            }
        </p>
    `,
    styles: `
        .note {
            background: var(--brand-soft);
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
        }
        form {
            background: var(--surface);
            border-radius: var(--radius-large);
            padding: 0.5rem 1.25rem 1.25rem;
            max-width: 44rem;
        }
        .bar {
            position: sticky;
            bottom: 0;
            display: flex;
            gap: 0.75rem;
            padding-top: 1rem;
            background: var(--surface);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
    readonly section = input.required<SettingSection>();
    private readonly api = inject(Api);
    protected readonly session = inject(Session);
    protected readonly data = signal<SettingsResponse | null>(null);
    protected readonly edits = signal<Record<string, ConfigValue>>({});
    protected readonly errors = signal<Record<string, string>>({});
    protected readonly busy = signal(false);
    protected readonly message = signal<{ level: 'ok' | 'error'; text: string } | null>(null);

    protected readonly title = computed(() => this.data()?.sections[this.section()] ?? 'Einstellungen');
    protected readonly definitions = computed(() => this.data()?.definitions.filter((d) => d.section === this.section()) ?? []);
    protected readonly dirty = computed(() => Object.keys(this.edits()).length > 0);

    constructor() {
        // Bereich gewechselt → neu laden, ungespeicherte Änderungen verwerfen
        effect(() => {
            this.section();
            this.edits.set({});
            this.errors.set({});
            this.message.set(null);
            void this.load();
        });
    }

    protected current(path: string): ConfigValue | undefined {
        const edits = this.edits();
        return path in edits ? edits[path] : this.data()?.values[path]?.value;
    }

    protected change(path: string, value: ConfigValue): void {
        const original = this.data()?.values[path]?.value;
        this.edits.update((edits) => {
            const { [path]: _previous, ...rest } = edits;
            return JSON.stringify(value) === JSON.stringify(original) ? rest : { ...rest, [path]: value };
        });
        this.errors.update(({ [path]: _previous, ...rest }) => rest);
    }

    protected discard(): void {
        this.edits.set({});
        this.errors.set({});
    }

    protected async save(): Promise<void> {
        const values: Record<string, ConfigValue> = {};
        const errors: Record<string, string> = {};
        for (const [path, value] of Object.entries(this.edits())) {
            const setting = findSetting(path);
            try {
                if (!setting) throw new InvalidSettingError(path, `Einstellung ${path} gibt es nicht`);
                values[path] = validateSetting(setting, value);
            } catch (error) {
                errors[path] = error instanceof Error ? error.message : String(error);
            }
        }
        this.errors.set(errors);
        if (Object.keys(errors).length > 0) {
            this.message.set({ level: 'error', text: 'Bitte die markierten Felder prüfen' });
            return;
        }
        this.busy.set(true);
        try {
            const result = await this.api.saveSettings(values);
            this.data.update((data) => (data ? { ...data, values: result.values } : data));
            this.edits.set({});
            this.message.set({ level: 'ok', text: result.changes.length === 1 ? '1 Einstellung gespeichert' : `${result.changes.length} Einstellungen gespeichert` });
        } catch (error) {
            const path = errorPath(error);
            if (path) this.errors.set({ [path]: errorMessage(error) });
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
