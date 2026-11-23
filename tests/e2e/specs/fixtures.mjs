import { test as base, expect } from '@playwright/test';
import { adminLogin } from '../support/box.mjs';

/**
 * Wie `test`, sammelt aber JavaScript-Fehler der Seite. Jeder Fehler lässt den Test scheitern –
 * so fällt sofort auf, wenn beim Entfernen von Funktionen etwas in der Oberfläche bricht.
 */
export const test = base.extend({
    /** Konsolenmeldungen, die ein Test erwartet (z. B. 401 bei falscher PIN) */
    expectedConsoleErrors: [[], { option: true }],
    page: async ({ page, expectedConsoleErrors }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(`JavaScript-Fehler: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error' && !expectedConsoleErrors.some((pattern) => pattern.test(message.text()))) {
                errors.push(`Konsole: ${message.text()}`);
            }
        });
        page.on('response', (response) => {
            if (response.status() >= 500) {
                errors.push(`Server-Fehler ${response.status()}: ${response.url()}`);
            }
        });

        await use(page);

        expect(errors, 'Fehler in der Oberfläche').toEqual([]);
    },
    /** Seite mit PIN-Anmeldung (Admin) */
    adminPage: async ({ page }, use) => {
        await adminLogin(page);
        await use(page);
    },
});

export { expect };
