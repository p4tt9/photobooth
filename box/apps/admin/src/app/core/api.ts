// Zugriff auf die Schnittstelle von app (/api/v1/). Typen kommen aus @snaphora/contracts – dieselben wie im Server.

import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import type {
    AccessLog,
    AgentStatus,
    ApiError,
    BoxStatus,
    ConfigValue,
    PersonInfo,
    PrintStatus,
    SessionInfo,
    SettingsResponse,
    SettingsUpdateResponse,
} from '@snaphora/contracts';
import { catchError, firstValueFrom, throwError } from 'rxjs';

export const API = '/api/v1';

/**
 * Jede Anfrage mit dem Kopf, den app für schreibende Anfragen verlangt (Schutz gegen CSRF).
 * Läuft die Sitzung ab (401 außerhalb der Anmeldung), geht es zurück zur PIN-Eingabe.
 */
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
    if (!request.url.startsWith(API)) {
        return next(request);
    }
    const router = inject(Router);
    return next(request.clone({ setHeaders: { 'X-Snaphora-Request': '1' } })).pipe(
        catchError((error: unknown) => {
            const silent = request.url.endsWith('/access/login') || request.url.endsWith('/access/session');
            if (error instanceof HttpErrorResponse && error.status === 401 && !silent) {
                void router.navigate(['/anmelden'], { queryParams: { zurueck: `/admin${router.url}` } });
            }
            return throwError(() => error);
        }),
    );
};

/** Fehler in einen Satz für die Oberfläche übersetzen */
export function errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
        const body = (error.error ?? {}) as ApiError;
        if (error.status === 0) return 'Die Box antwortet nicht';
        return body.error ?? body.message ?? `Fehler ${error.status}`;
    }
    return 'Unbekannter Fehler';
}

export const errorPath = (error: unknown): string | undefined => (error instanceof HttpErrorResponse ? (error.error as ApiError | null)?.path : undefined);

@Injectable({ providedIn: 'root' })
export class Api {
    private readonly http = inject(HttpClient);

    private get<T>(path: string): Promise<T> {
        return firstValueFrom(this.http.get<T>(API + path));
    }

    private send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
        return firstValueFrom(this.http.request<T>(method, API + path, { body }));
    }

    login(pin: string, kiosk: boolean): Promise<PersonInfo> {
        return this.send('POST', '/access/login', { pin, kiosk });
    }
    logout(): Promise<void> {
        return this.send('POST', '/access/logout');
    }
    async session(): Promise<PersonInfo | null> {
        return (await this.get<SessionInfo>('/access/session')).person;
    }
    accessLog(): Promise<AccessLog> {
        return this.get('/access/log');
    }
    status(): Promise<BoxStatus> {
        return this.get('/status');
    }
    print(): Promise<PrintStatus> {
        return this.get('/print');
    }
    increaseQuota(add: number): Promise<PrintStatus> {
        return this.send('POST', '/print/quota', { add });
    }
    settings(): Promise<SettingsResponse> {
        return this.get('/settings');
    }
    saveSettings(values: Record<string, ConfigValue>): Promise<SettingsUpdateResponse> {
        return this.send('PATCH', '/settings', { values });
    }
    resetEventChanges(): Promise<{ reset: boolean }> {
        return this.send('DELETE', '/settings/event-changes');
    }
    syncNow(): Promise<AgentStatus> {
        return this.send('POST', '/maintenance/sync');
    }
}
