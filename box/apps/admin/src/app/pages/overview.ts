// Übersicht: Ist die Box einsatzbereit? Event, Druck, Fotos, Speicher, Verbindung – alle 10 s aktualisiert.

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BoxStatus } from '@snaphora/contracts';
import { Api, errorMessage } from '../core/api';
import { State, type Level } from '../ui/state';

const REFRESH_MS = 10_000;

export function diskLevel(disk: BoxStatus['disk']): Level {
    if (!disk) return 'warn';
    const free = disk.freeBytes / disk.totalBytes;
    return disk.freeBytes < 2e9 || free < 0.05 ? 'error' : free < 0.15 ? 'warn' : 'ok';
}

@Component({
    selector: 'sn-overview',
    imports: [State, RouterLink, DecimalPipe],
    template: `
        <h1>Übersicht</h1>
        @if (error()) {
            <p role="alert"><sn-state level="error">{{ error() }}</sn-state></p>
        }
        @if (status(); as s) {
            <div class="cards">
                <section class="card" aria-labelledby="event-title">
                    <h2 id="event-title">Event</h2>
                    @if (s.event) {
                        <p><sn-state level="ok">{{ s.event.name ?? s.event.eventId }}</sn-state></p>
                        <a routerLink="/event">Vorgaben und Änderungen</a>
                    } @else {
                        <p><sn-state level="warn">Kein Event aktiv – Box-Einstellungen gelten</sn-state></p>
                    }
                </section>
                <section class="card" aria-labelledby="print-title">
                    <h2 id="print-title">Druck</h2>
                    @if (s.print.limit > 0) {
                        <p class="big">{{ s.print.remaining ?? '?' }} <small>von {{ s.print.limit }} übrig</small></p>
                        <p>
                            <sn-state [level]="s.print.locked ? 'error' : (s.print.remaining ?? 0) < 20 ? 'warn' : 'ok'">{{
                                s.print.locked ? 'Kontingent erreicht – Druck gesperrt' : 'Druck möglich'
                            }}</sn-state>
                        </p>
                    } @else {
                        <p class="big">{{ s.print.printed ?? '?' }} <small>gedruckt</small></p>
                        <p><sn-state level="ok">Kein Kontingent</sn-state></p>
                    }
                    <a routerLink="/druck">Kontingent erhöhen</a>
                </section>
                <section class="card" aria-labelledby="photos-title">
                    <h2 id="photos-title">Fotos</h2>
                    <p class="big">{{ s.photos ?? '?' }}</p>
                    @if (s.agent.uploads; as uploads) {
                        <p>
                            <sn-state [level]="uploads.failed > 0 ? 'error' : uploads.pending > 20 ? 'warn' : 'ok'"
                                >{{ uploads.uploaded }} hochgeladen, {{ uploads.pending }} warten{{ uploads.failed ? ', ' + uploads.failed + ' abgelehnt' : '' }}</sn-state
                            >
                        </p>
                    }
                </section>
                <section class="card" aria-labelledby="disk-title">
                    <h2 id="disk-title">Speicher</h2>
                    @if (s.disk; as disk) {
                        <p class="big">{{ disk.freeBytes / 1e9 | number: '1.0-1' }} <small>GB frei</small></p>
                    }
                    <p>
                        <sn-state [level]="diskLevel(s.disk)">{{ diskLevel(s.disk) === 'ok' ? 'Genug Platz' : 'Wenig Platz' }}</sn-state>
                    </p>
                </section>
                <section class="card" aria-labelledby="server-title">
                    <h2 id="server-title">Verbindung zum Server</h2>
                    <p>
                        <sn-state [level]="serverLevel()">{{ serverText() }}</sn-state>
                    </p>
                    @if (s.agent.lastSync) {
                        <p class="muted">Letzter Abgleich: {{ time(s.agent.lastSync) }}</p>
                    }
                </section>
            </div>
            <p class="muted">Version {{ s.version }}</p>
        } @else if (!error()) {
            <p aria-live="polite">Wird geladen …</p>
        }
    `,
    styles: `
        .cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
            gap: 1rem;
        }
        .big {
            font-size: 2rem;
            font-weight: 700;
            margin: 0.25rem 0;
        }
        .big small {
            font-size: 1rem;
            font-weight: 400;
            color: var(--muted);
        }
        .card a {
            display: inline-flex;
            min-height: var(--touch);
            align-items: center;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Overview {
    private readonly api = inject(Api);
    protected readonly status = signal<BoxStatus | null>(null);
    protected readonly error = signal('');
    protected readonly diskLevel = diskLevel;

    protected readonly serverLevel = computed<Level>(() => {
        const agent = this.status()?.agent;
        if (!agent?.reachable) return 'error';
        if (!agent.server) return 'warn';
        return agent.registered && !agent.lastSyncError ? 'ok' : 'warn';
    });

    protected readonly serverText = computed(() => {
        const agent = this.status()?.agent;
        if (!agent?.reachable) return 'Agent läuft nicht – kein Abgleich, kein Upload';
        if (!agent.server) return 'Ohne Server – Box nutzt ihre eigenen Einstellungen';
        if (!agent.registered) return 'Box ist nicht registriert';
        return agent.lastSyncError ? 'Server gerade nicht erreichbar (offline?) – letzte Konfiguration gilt' : 'Verbunden';
    });

    constructor() {
        void this.load();
        const timer = setInterval(() => void this.load(), REFRESH_MS);
        inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }

    protected time(iso: string): string {
        return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }

    private async load(): Promise<void> {
        try {
            this.status.set(await this.api.status());
            this.error.set('');
        } catch (error) {
            this.error.set(errorMessage(error));
        }
    }
}
