// Bibliothek: Rahmen, Hintergründe, Logos und Schriften hochladen und löschen.
// Verwendete Dateien lassen sich nicht löschen (app prüft das auch selbst); Löschen fragt einmal nach.

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MEDIA_KINDS, type MediaItem, type MediaKind, type MediaLibrary } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { Session } from '../core/session';
import { State } from '../ui/state';

const ACCEPT: Record<MediaKind, string> = {
    frame: 'image/png',
    background: 'image/jpeg,image/png',
    logo: 'image/png,image/jpeg',
    font: '.ttf,.otf,font/ttf,font/otf',
};

@Component({
    selector: 'sn-library',
    imports: [State, DecimalPipe],
    template: `
        <h1>Bilder und Schriften</h1>
        <p class="muted">Ausgewählt werden sie unter Einstellungen → Gestaltung.</p>
        <p role="status" aria-live="polite">
            @if (message(); as m) {
                <sn-state [level]="m.level">{{ m.text }}</sn-state>
            }
        </p>
        @for (kind of kinds; track kind) {
            <section class="card" [attr.aria-labelledby]="'art-' + kind">
                <div class="head">
                    <h2 [id]="'art-' + kind">{{ info[kind].label }}</h2>
                    @if (session.allows('admin')) {
                        <label class="upload">
                            <input type="file" [accept]="accept[kind]" (change)="upload(kind, $event)" [disabled]="busy()" [attr.aria-describedby]="'hilfe-' + kind" />
                            <span>Hochladen</span>
                        </label>
                    }
                </div>
                <p class="muted" [id]="'hilfe-' + kind">{{ info[kind].help }}, höchstens {{ info[kind].maxBytes / 1048576 | number: '1.0-0' }} MB.</p>
                @let items = library()?.[kind] ?? [];
                @if (items.length === 0) {
                    <p>Noch nichts hochgeladen.</p>
                } @else {
                    <ul class="items">
                        @for (item of items; track item.path) {
                            <li>
                                @if (kind === 'font') {
                                    <span class="thumb font" aria-hidden="true">Aa</span>
                                } @else {
                                    <img class="thumb" [src]="'/' + item.path" [alt]="info[kind].label + ' ' + item.name" loading="lazy" />
                                }
                                <span class="name">{{ item.name }}</span>
                                <span class="muted small">{{ item.size / 1024 | number: '1.0-0' }} KB</span>
                                @if (item.usedBy.length) {
                                    <span class="small">Verwendet: {{ item.usedBy.join(', ') }}</span>
                                } @else if (session.allows('admin')) {
                                    @if (confirming() === item.path) {
                                        <span class="confirm">
                                            <button type="button" class="danger" (click)="remove(kind, item)">Wirklich löschen</button>
                                            <button type="button" class="secondary" (click)="confirming.set(null)">Abbrechen</button>
                                        </span>
                                    } @else {
                                        <button type="button" class="secondary" (click)="confirming.set(item.path)" [attr.aria-label]="item.name + ' löschen'">Löschen</button>
                                    }
                                }
                            </li>
                        }
                    </ul>
                }
            </section>
        }
    `,
    styles: `
        section + section {
            margin-top: 1rem;
        }
        .head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
        }
        .head h2 {
            margin: 0;
        }
        .upload {
            position: relative;
            display: inline-flex;
            align-items: center;
            min-height: var(--touch);
            padding: 0 1.25rem;
            border-radius: var(--radius);
            background: var(--brand);
            color: var(--on-brand);
            font-weight: 600;
            cursor: pointer;
        }
        .upload input {
            position: absolute;
            inset: 0;
            opacity: 0;
            cursor: pointer;
        }
        .upload:focus-within {
            outline: 3px solid var(--brand);
            outline-offset: 2px;
        }
        .items {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
            gap: 1rem;
        }
        .items li {
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            padding: 0.75rem;
            border: 1px solid var(--line);
            border-radius: var(--radius);
        }
        .thumb {
            width: 100%;
            height: 7rem;
            object-fit: contain;
            background: repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 16px 16px;
            border-radius: 0.3rem;
        }
        .thumb.font {
            display: grid;
            place-items: center;
            font-size: 2rem;
            background: var(--background);
        }
        .name {
            font-weight: 600;
            word-break: break-word;
        }
        .small {
            font-size: 0.85rem;
        }
        .confirm {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        button.danger {
            background: var(--danger);
            border-color: var(--danger);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Library {
    private readonly api = inject(Api);
    protected readonly session = inject(Session);
    protected readonly kinds = Object.keys(MEDIA_KINDS) as MediaKind[];
    protected readonly info = MEDIA_KINDS;
    protected readonly accept = ACCEPT;
    protected readonly library = signal<MediaLibrary | null>(null);
    protected readonly busy = signal(false);
    protected readonly confirming = signal<string | null>(null);
    protected readonly message = signal<{ level: 'ok' | 'error'; text: string } | null>(null);

    constructor() {
        void this.load();
    }

    protected async upload(kind: MediaKind, event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        if (file.size > MEDIA_KINDS[kind].maxBytes) {
            this.message.set({ level: 'error', text: `${file.name}: zu groß (höchstens ${MEDIA_KINDS[kind].maxBytes / 1048576} MB)` });
            return;
        }
        this.busy.set(true);
        this.message.set(null);
        try {
            const item = await this.api.uploadMedia(kind, file);
            this.message.set({ level: 'ok', text: `${item.name} hochgeladen` });
            await this.load();
        } catch (error) {
            this.message.set({ level: 'error', text: `${file.name}: ${errorMessage(error)}` });
        } finally {
            this.busy.set(false);
        }
    }

    protected async remove(kind: MediaKind, item: MediaItem): Promise<void> {
        this.confirming.set(null);
        try {
            await this.api.deleteMedia(kind, item.name);
            this.message.set({ level: 'ok', text: `${item.name} gelöscht` });
            await this.load();
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        }
    }

    private async load(): Promise<void> {
        try {
            this.library.set(await this.api.media());
        } catch (error) {
            this.message.set({ level: 'error', text: errorMessage(error) });
        }
    }
}
