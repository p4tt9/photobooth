// Ein Eingabefeld, erzeugt aus einer Katalog-Einstellung (Typ, Grenzen, Beschriftung).
// Zeigt, woher der Wert kommt (Standard, Server, Box, Event) – wichtig, um zu verstehen, was eine Änderung bewirkt.

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import type { ConfigValue, LayerName, LookInfo, MediaItem, SettingDescription, SettingState } from '@snaphora/contracts';
import type { CollageLayout } from '../core/api';

export const SOURCE_LABEL: Record<LayerName, string> = {
    default: 'Standard',
    device: 'vom Server (Gerät)',
    box: 'an der Box eingestellt',
    event: 'vom Event vorgegeben',
    'local-event': 'für dieses Event an der Box geändert',
};

/** Namen der Tasten, die ein Presenter typischerweise sendet */
const KEY_NAMES: Record<string, string> = { '33': 'Bild auf', '34': 'Bild ab', '13': 'Enter', '32': 'Leertaste', '66': 'B', '116': 'F5', '27': 'Escape', '37': 'Pfeil links', '39': 'Pfeil rechts' };

export const keyName = (code: string): string => (code ? `${KEY_NAMES[code] ?? 'Taste'} (${code})` : 'keine');

/** SVG nur als Bild anzeigen: ein <img> führt keine Skripte aus */
export const svgImage = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

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
                @case ('media') {
                    <fieldset [attr.aria-describedby]="id + '-info'">
                        <legend>{{ d.label }}</legend>
                        <div class="tiles">
                            <label class="tile" [class.selected]="value() === ''">
                                <input type="radio" [name]="id" value="" [checked]="value() === ''" [disabled]="readonly()" (change)="changed.emit('')" />
                                <span class="thumb empty" aria-hidden="true">–</span>
                                <span>Standard</span>
                            </label>
                            @for (item of mediaOptions(); track item.path) {
                                <label class="tile" [class.selected]="value() === item.path">
                                    <input type="radio" [name]="id" [value]="item.path" [checked]="value() === item.path" [disabled]="readonly()" (change)="changed.emit(item.path)" />
                                    @if ($any(d).kind === 'font') {
                                        <span class="thumb font" aria-hidden="true">Aa</span>
                                    } @else {
                                        <img class="thumb" [src]="'/' + item.path" alt="" loading="lazy" />
                                    }
                                    <span class="name">{{ item.name }}</span>
                                </label>
                            }
                        </div>
                    </fieldset>
                }
                @case ('layout') {
                    <fieldset [attr.aria-describedby]="id + '-info'">
                        <legend>{{ d.label }}</legend>
                        @if (layouts(); as all) {
                            <div class="tiles">
                                @for (layout of all; track layout.id) {
                                    <label class="tile" [class.selected]="value() === layout.id">
                                        <input type="radio" [name]="id" [value]="layout.id" [checked]="value() === layout.id" [disabled]="readonly()" (change)="changed.emit(layout.id)" />
                                        <img class="thumb" [src]="preview(layout)" alt="" />
                                        <span class="name">{{ layout.label }}</span>
                                    </label>
                                }
                            </div>
                        } @else {
                            <p class="muted">Layouts werden geladen …</p>
                        }
                    </fieldset>
                }
                @default {
                    <label [for]="id">{{ d.label }}</label>
                    @switch (d.type) {
                        @case ('integer') {
                            <span class="row">
                                <input type="number" inputmode="numeric" class="short" [id]="id" [min]="$any(d).min" [max]="$any(d).max" step="1" [value]="value()" [disabled]="readonly()" (input)="changed.emit(toNumber($any($event.target).value))" [attr.aria-describedby]="id + '-info'" [attr.aria-invalid]="!!error()" />
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
                        @case ('look') {
                            <select [id]="id" [disabled]="readonly() || !looks()" (change)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'">
                                <option value="" [selected]="value() === ''">ohne Look</option>
                                @for (look of lookOptions(); track look.id) {
                                    <option [value]="look.id" [selected]="look.id === value()">{{ look.name }}</option>
                                }
                            </select>
                        }
                        @case ('color') {
                            <span class="row">
                                <input type="color" class="swatch" [id]="id" [value]="value()" [disabled]="readonly()" (input)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'" />
                                <code>{{ value() }}</code>
                            </span>
                        }
                        @case ('key') {
                            <span class="row">
                                <input type="text" inputmode="numeric" class="short" [id]="id" maxlength="3" [value]="value() ?? ''" [disabled]="readonly()" (input)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'" [attr.aria-invalid]="!!error()" />
                                <button type="button" class="secondary" [disabled]="readonly()" (click)="learnKey()" [attr.aria-pressed]="learning()">{{ learning() ? 'Warte auf Taste …' : 'Taste anlernen' }}</button>
                            </span>
                        }
                        @default {
                            @if ($any(d).multiline) {
                                <textarea [id]="id" rows="2" [attr.maxlength]="$any(d).maxLength" [value]="value()" [disabled]="readonly()" (input)="changed.emit($any($event.target).value)" [attr.aria-describedby]="id + '-info'" [attr.aria-invalid]="!!error()"></textarea>
                            } @else {
                                <input
                                    [type]="d.type === 'url' ? 'url' : 'text'"
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
            <p class="info" [id]="id + '-info'" aria-live="polite">
                @if (error()) {
                    <span class="error">{{ error() }}</span>
                }
                @if (learning()) {
                    <span class="hint">Jetzt die Taste am Presenter drücken (Escape bricht ab).</span>
                }
                @if (d.help) {
                    <span>{{ d.help }}</span>
                }
                @if (d.type === 'key') {
                    <span>Belegt: {{ keyLabel() }}</span>
                }
                @if (d.type === 'look' && !looks()) {
                    <span>Looks gerade nicht abrufbar (Bildpipeline).</span>
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
        label,
        legend {
            display: block;
            font-weight: 600;
            margin-bottom: 0.35rem;
        }
        fieldset {
            border: 0;
            margin: 0;
            padding: 0;
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
        input:not([type='checkbox']):not([type='radio']):not(.swatch),
        select,
        textarea {
            width: 100%;
            max-width: 28rem;
        }
        input.short {
            max-width: 8rem;
        }
        .row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        .swatch {
            width: var(--touch);
            height: var(--touch);
            padding: 0.2rem;
        }
        .tiles {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
            gap: 0.75rem;
        }
        .tile {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.35rem;
            margin: 0;
            padding: 2rem 0.5rem 0.5rem;
            border: 2px solid var(--line);
            border-radius: var(--radius);
            font-weight: 400;
            text-align: center;
            cursor: pointer;
        }
        .tile.selected {
            border-color: var(--brand);
            background: var(--brand-soft);
        }
        .tile input {
            position: absolute;
            top: 0.4rem;
            left: 0.4rem;
            width: 1.25rem;
            height: 1.25rem;
        }
        .tile:focus-within {
            outline: 3px solid var(--brand);
            outline-offset: 2px;
        }
        .thumb {
            width: 100%;
            height: 5rem;
            object-fit: contain;
            background: repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 16px 16px;
            border-radius: 0.3rem;
        }
        .thumb.empty,
        .thumb.font {
            display: grid;
            place-items: center;
            font-size: 1.75rem;
            background: var(--background);
        }
        .name {
            font-size: 0.85rem;
            word-break: break-word;
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
        .hint {
            color: var(--brand);
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
    /** Für Dateien: Bibliothek der passenden Art */
    readonly media = input<MediaItem[] | null>(null);
    /** Für Looks: was der Render-Dienst kennt; null = nicht abrufbar */
    readonly looks = input<LookInfo[] | null>(null);
    readonly layouts = input<CollageLayout[] | null>(null);
    readonly changed = output<ConfigValue>();

    protected readonly learning = signal(false);
    private stopLearning: (() => void) | null = null;

    constructor() {
        inject(DestroyRef).onDestroy(() => this.stopLearning?.());
    }

    protected readonly options = computed(() => {
        const d = this.definition();
        return d.type === 'choice' ? Object.entries(d.options) : [];
    });

    /** Bibliothek plus der aktuelle Wert, falls er woanders liegt (z. B. Rahmen vom Server) */
    protected readonly mediaOptions = computed<MediaItem[]>(() => {
        const items = this.media() ?? [];
        const value = this.value();
        if (typeof value === 'string' && value !== '' && !items.some((item) => item.path === value)) {
            const name = value.startsWith('private/snaphora/assets/') ? 'vom Server' : (value.split('/').pop() ?? value);
            return [...items, { name, path: value, size: 0, modified: '', usedBy: [] }];
        }
        return items;
    });

    protected readonly lookOptions = computed<LookInfo[]>(() => {
        const looks = this.looks() ?? [];
        const value = this.value();
        return typeof value === 'string' && value !== '' && !looks.some((look) => look.id === value) ? [...looks, { id: value, name: `${value} (nicht mehr vorhanden)` }] : looks;
    });

    protected readonly keyLabel = computed(() => keyName(String(this.value() ?? '')));

    protected readonly sourceText = computed(() => {
        const state = this.state();
        if (!state) return '';
        const text = SOURCE_LABEL[state.source];
        return state.eventManaged && state.source !== 'local-event' ? `${text} · eine Änderung gilt nur für dieses Event` : text;
    });

    protected toNumber(value: string): ConfigValue {
        return value === '' ? '' : Number(value);
    }

    protected preview(layout: CollageLayout): string {
        return svgImage(layout.preview);
    }

    /** Nächster Tastendruck wird übernommen – so muss niemand Tastencodes kennen */
    protected learnKey(): void {
        if (this.learning()) {
            this.stopLearning?.();
            return;
        }
        this.learning.set(true);
        const listener = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key !== 'Escape') {
                this.changed.emit(String(event.keyCode));
            }
            this.stopLearning?.();
        };
        window.addEventListener('keydown', listener, { capture: true });
        this.stopLearning = () => {
            window.removeEventListener('keydown', listener, { capture: true });
            this.learning.set(false);
            this.stopLearning = null;
        };
    }
}
