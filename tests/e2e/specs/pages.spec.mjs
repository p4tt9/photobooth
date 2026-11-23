// Alle Seiten der Box laden ohne JavaScript- und Server-Fehler.

import { test, expect } from './fixtures.mjs';

const pages = [
    { path: '/', name: 'Startseite' },
    { path: '/admin/', name: 'Admin-Oberfläche', admin: true },
    { path: '/gallery/', name: 'Galerie (eigenständig)' },
    { path: '/slideshow/', name: 'Diashow' },
    { path: '/manual/', name: 'Handbuch' },
    { path: '/login/', name: 'Anmeldung' },
    { path: '/login/', name: 'Menü nach Anmeldung', admin: true },
    { path: '/test/', name: 'Testseite', admin: true },
    { path: '/test/photo.php', name: 'Test Bildverarbeitung Foto', admin: true },
    { path: '/test/collage.php', name: 'Test Bildverarbeitung Collage', admin: true },
    { path: '/test/healthcheck.php', name: 'Systemprüfung', admin: true },
    { path: '/admin/diskusage/', name: 'Speicherbelegung', admin: true },
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
