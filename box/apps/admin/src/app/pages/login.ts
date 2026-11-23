import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { ApiError } from '@snaphora/contracts';
import { errorMessage } from '../core/api';
import { Session } from '../core/session';
import { PinPad } from '../ui/pin-pad';

/** Rücksprung nur auf Seiten dieser Box (z. B. alte Verwaltung), nie auf fremde Adressen */
export function safeReturnPath(value: string | undefined): string | null {
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) {
        return null;
    }
    return value;
}

@Component({
    selector: 'sn-login',
    imports: [PinPad],
    template: `
        <main class="login">
            <h1>Verwaltung</h1>
            <p>Persönliche PIN eingeben</p>
            <sn-pin-pad [busy]="busy()" [message]="message()" (entered)="login($event)" />
            <a class="back" href="/">Zurück zur Fotobox</a>
        </main>
    `,
    styles: `
        :host {
            display: grid;
            place-items: center;
            min-height: 100dvh;
            padding: 1rem;
        }
        .login {
            width: min(22rem, 100%);
            background: var(--surface);
            border-radius: var(--radius-large);
            padding: 2rem 1.5rem;
            box-shadow: var(--shadow);
            text-align: center;
        }
        h1 {
            margin: 0 0 0.25rem;
        }
        p {
            margin: 0 0 1.25rem;
            color: var(--muted);
        }
        .back {
            display: inline-block;
            margin-top: 1rem;
            padding: 0.75rem;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
    readonly zurueck = input<string>();
    private readonly session = inject(Session);
    private readonly router = inject(Router);
    protected readonly busy = signal(false);
    protected readonly message = signal('');

    protected async login(pin: string): Promise<void> {
        this.busy.set(true);
        this.message.set('');
        try {
            await this.session.login(pin);
            const target = safeReturnPath(this.zurueck());
            // Seiten der alten Verwaltung liegen außerhalb dieser App
            if (target && !target.startsWith('/admin/') && target !== '/admin') {
                window.location.href = target;
            } else {
                await this.router.navigateByUrl(target ? target.replace(/^\/admin/, '') || '/' : '/');
            }
        } catch (error) {
            this.message.set(loginError(error));
        } finally {
            this.busy.set(false);
        }
    }
}

function loginError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
        if (error.status === 401) return 'PIN falsch';
        if (error.status === 429) {
            const seconds = (error.error as ApiError | null)?.retryAfterSeconds ?? 60;
            return `Zu viele Fehlversuche – bitte ${seconds} s warten`;
        }
    }
    return errorMessage(error);
}
