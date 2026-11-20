import { test as base, expect } from '@playwright/test';

/**
 * Wie `test`, sammelt aber JavaScript-Fehler der Seite. Jeder Fehler lässt den Test scheitern –
 * so fällt sofort auf, wenn beim Entfernen von Funktionen etwas in der Oberfläche bricht.
 */
export const test = base.extend({
    page: async ({ page }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(`JavaScript-Fehler: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error') {
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
});

export { expect };
