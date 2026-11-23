import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import type { Role } from '@snaphora/contracts';
import { Session } from './session';

/** Nur mit Anmeldung (und gegebenenfalls Rolle); sonst zur PIN-Eingabe mit Rücksprung */
export const requireRole =
    (role: Role): CanActivateFn =>
    async (_route, state) => {
        const session = inject(Session);
        const router = inject(Router);
        if (!(await session.restore())) {
            // Vollständiger Pfad wie bei der alten Verwaltung, die ebenfalls hierher zur Anmeldung schickt
            return router.createUrlTree(['/anmelden'], { queryParams: { zurueck: `/admin${state.url}` } });
        }
        return session.allows(role) ? true : router.createUrlTree(['/']);
    };
