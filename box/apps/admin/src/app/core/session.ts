// Angemeldete Person und Kiosk-Verhalten.
//
// Kiosk: Der Browser der Box öffnet immer localhost (oder kommt über die Geste mit ?kiosk=1). Dort endet die
// Sitzung nach 2 min ohne Bedienung, und die Box zeigt wieder die Gäste-Oberfläche – damit niemand eine
// offene Verwaltung am Touchscreen vorfindet. app beendet die Sitzung zusätzlich selbst (Server ist maßgeblich).

import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { roleAllows, type PersonInfo, type Role } from '@snaphora/contracts';
import { Api } from './api';

export const KIOSK_IDLE_MS = 2 * 60_000;

@Injectable({ providedIn: 'root' })
export class Session {
    private readonly api = inject(Api);
    readonly person = signal<PersonInfo | null>(null);
    readonly kiosk = isKiosk(window.location);
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private checked = false;

    constructor() {
        if (this.kiosk) {
            for (const event of ['pointerdown', 'keydown']) {
                window.addEventListener(event, () => this.resetIdle(), { passive: true });
            }
        }
        inject(DestroyRef).onDestroy(() => clearTimeout(this.idleTimer));
    }

    /** Fragt app einmal, ob schon jemand angemeldet ist (Cookie) */
    async restore(): Promise<PersonInfo | null> {
        if (!this.checked) {
            this.checked = true;
            try {
                this.person.set(await this.api.session());
                this.resetIdle();
            } catch {
                this.person.set(null);
            }
        }
        return this.person();
    }

    async login(pin: string): Promise<PersonInfo> {
        const person = await this.api.login(pin, this.kiosk);
        this.person.set(person);
        this.checked = true;
        this.resetIdle();
        return person;
    }

    async logout(toGuests = false): Promise<void> {
        clearTimeout(this.idleTimer);
        try {
            await this.api.logout();
        } finally {
            this.person.set(null);
            if (toGuests) {
                window.location.href = '/';
            }
        }
    }

    /** Sitzung abgelaufen (401 vom Server) */
    expired(): void {
        this.person.set(null);
    }

    allows(role: Role): boolean {
        const person = this.person();
        return person !== null && roleAllows(person.role, role);
    }

    private resetIdle(): void {
        if (!this.kiosk || !this.person()) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => void this.logout(true), KIOSK_IDLE_MS);
    }
}

export function isKiosk(location: Pick<Location, 'hostname' | 'search'>): boolean {
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || new URLSearchParams(location.search).get('kiosk') === '1';
}
