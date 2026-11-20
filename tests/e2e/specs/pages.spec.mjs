// Alle Seiten der Box laden ohne JavaScript- und Server-Fehler.

import { test, expect } from './fixtures.mjs';

const pages = [
    { path: '/', name: 'Startseite' },
    { path: '/admin/', name: 'Admin-Oberfläche' },
    { path: '/gallery/', name: 'Galerie (eigenständig)' },
    { path: '/slideshow/', name: 'Diashow' },
    { path: '/manual/', name: 'Handbuch' },
    { path: '/test/', name: 'Testseite' },
    { path: '/test/photo.php', name: 'Test Bildverarbeitung Foto' },
    { path: '/test/collage.php', name: 'Test Bildverarbeitung Collage' },
    { path: '/test/healthcheck.php', name: 'Systemprüfung' },
    { path: '/admin/diskusage/', name: 'Speicherbelegung' },
];

for (const { path, name } of pages) {
    test(`${name} lädt fehlerfrei (${path})`, async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status(), `HTTP-Status von ${path}`).toBeLessThan(400);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).not.toBeEmpty();
    });
}
