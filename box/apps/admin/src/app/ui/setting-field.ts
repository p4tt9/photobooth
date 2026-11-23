// Ein Eingabefeld, erzeugt aus einer Katalog-Einstellung (Typ, Grenzen, Beschriftung).
// Zeigt, woher der Wert kommt (Standard, Server, Box, Event) – wichtig, um zu verstehen, was eine Änderung bewirkt.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ConfigValue, LayerName, SettingDescription, SettingState } from '@snaphora/contracts';

export const SOURCE_LABEL: Record<LayerName, string> = {
    default: 'Standard',
    device: 'vom Server (Gerät)',
    box: 'an der Box eingestellt',
    event: 'vom Event vorgegeben',
    'local-event': 'für dieses Event an der Box geändert',
};

@Component({
    selector: 'sn-setting-field',
    template: `
        @let d = definition();
        @let id = 'feld-' + d.path;
        <div class="field" [class.invalid]="error()">
            @switch (d.type) {
                @case ('boolean') {
                    <label class="check">
                        <input type="checkbox" [id]="id" [checked]="value() === true" [disabled]="readonly()" (change)="changed.emit($any($event.target).checked)" [attr.aria-describedby]="id + '-info'" />
                        <span>{{ d.label }}</span>
                    </label>
                }
                @default {
                    <label [for]="id">{{ d.label }}</label>
                    @switch (d.type) {
                        @case ('integer') {
                            <span class="with-unit">
                                <input type="number" inputmode="numeric" [id]="id" [min]="$any(d).min" [max]="$any(d).max" step="1" [value]="value()" [disabled]="readonly()" (input)="changed.emit(toNumber($any($event.target).value))" [attr.aria-describedby]="id + '-info'" [attr.aria-invalid]="!!error()" />
                                @if ($any(d).unit) {
                                    <span>{{ $any(d).unit }}</span>
                                }
                            </span>
                        }
                        @case ('choice') {
                            <select [id]="id" [disabled]="readonly()" (change)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'">
                                @for (option of options(); track option[0]) {
                                    <option [value]="option[0]" [selected]="option[0] === value()">{{ option[1] }}</option>
                                }
                            </select>
                        }
                        @default {
                            @if ($any(d).multiline) {
                                <textarea [id]="id" rows="2" [attr.maxlength]="$any(d).maxLength" [value]="value()" [disabled]="readonly()" (input)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'" [attr.aria-invalid]="!!error()"></textarea>
                            } @else {
                                <input
                                    [type]="d.type === 'url' ? 'url' : 'text'"
                                    [attr.inputmode]="d.type === 'key' ? 'numeric' : null"
                                    [id]="id"
                                    [attr.maxlength]="$any(d).maxLength ?? 200"
                                    [value]="value() ?? ''"
                                    [disabled]="readonly()"
                                    (input)="changed.emit($any($event.target).value)"
                                    [attr.aria-describedby]="id + '-info'"
                                    [attr.aria-invalid]="!!error()"
                                />
                            }
                        }
                    }
                }
            }
            <p class="info" [id]="id + '-info'">
                @if (error()) {
                    <span class="error">{{ error() }}</span>
                }
                @if (d.help) {
                    <span>{{ d.help }}</span>
                }
                @if (d.type === 'key') {
                    <span>Taste als Nummer (z. B. 34 = „Bild ab“ am Presenter), leer = keine.</span>
                }
                <span class="source">{{ sourceText() }}</span>
            </p>
        </div>
    `,
    styles: `
        .field {
            padding: 0.75rem 0;
            border-bottom: 1px solid var(--line);
        }
        label {
            display: block;
            font-weight: 600;
            margin-bottom: 0.35rem;
        }
        .check {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            min-height: var(--touch);
            margin: 0;
        }
        .check input {
            width: 1.75rem;
            height: 1.75rem;
        }
        input:not([type='checkbox']),
        select,
        textarea {
            width: 100%;
            max-width: 28rem;
        }
        .with-unit {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .with-unit input {
            max-width: 8rem;
        }
        .info {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
            margin: 0.35rem 0 0;
            font-size: 0.9rem;
            color: var(--muted);
        }
        .error {
            color: var(--danger);
            font-weight: 600;
        }
        .invalid input,
        .invalid textarea {
            border-color: var(--danger);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingField {
    readonly definition = input.required<SettingDescription>();
    readonly state = input<SettingState>();
    /** Aktueller Wert im Formular (ggf. geändert, noch nicht gespeichert) */
    readonly value = input<ConfigValue>();
    readonly error = input<string | null>(null);
    readonly readonly = input(false);
    readonly changed = output<ConfigValue>();

    protected readonly options = computed(() => {
        const d = this.definition();
        return d.type === 'choice' ? Object.entries(d.options) : [];
    });

    protected readonly sourceText = computed(() => {
        const state = this.state();
        if (!state) return '';
        const text = SOURCE_LABEL[state.source];
        return state.eventManaged && state.source !== 'local-event' ? `${text} · eine Änderung gilt nur für dieses Event` : text;
    });

    protected toNumber(value: string): ConfigValue {
        return value === '' ? '' : Number(value);
    }
}
