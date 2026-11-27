// Alle Seiten der Box laden ohne JavaScript- und Server-Fehler.

import { test, expect } from './fixtures.mjs';

const pages = [
    { path: '/', name: 'Startseite' },
    { path: '/admin/', name: 'Verwaltung', admin: true },
    { path: '/admin/anmelden', name: 'Anmeldung' },
    { path: '/gallery/', name: 'Galerie (eigenständig)' },
    { path: '/slideshow/', name: 'Diashow' },
];

for (const { path, name, admin } of pages) {
    test(`${name} lädt fehlerfrei (${path})`, async ({ page, adminPage }) => {
        if (admin) {
            page = adminPage;
        }
        const response = await page.goto(path);
        expect(response?.status(), `HTTP-Status von ${path}`).toBeLessThan(400);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).not.toBeEmpty();
    });
}
