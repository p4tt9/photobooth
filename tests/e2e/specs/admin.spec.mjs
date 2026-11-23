// Admin-Oberfläche: Einstellungen speichern muss funktionieren und darf nichts verlieren.

import { test, expect } from './fixtures.mjs';
import { ringlightUrl } from '../support/box.mjs';

test('Einstellungen speichern ohne Fehler und ohne Datenverlust', async ({ adminPage: page }) => {
    await page.goto('/admin/');

    // Die Seite lädt sich nach dem Speichern sofort neu – die Antwort deshalb beim Durchreichen mitlesen.
    let saveResponse = null;
    await page.route('**/api/admin.php', async (route) => {
        const response = await route.fetch();
        if (route.request().method() === 'POST') {
            saveResponse = { status: response.status(), body: await response.text() };
        }
        await route.fulfill({ response });
    });

    await page.locator('#save-admin-btn').click();
    await expect.poll(() => saveResponse, { message: 'Antwort beim Speichern' }).not.toBeNull();

    expect(saveResponse.status).toBe(200);
    expect(JSON.parse(saveResponse.body).status, `Antwort beim Speichern: ${saveResponse.body}`).toBe('success');

    // Nach dem Speichern müssen die Einstellungen noch da sein (z. B. das Ringlicht)
    await page.goto('/');
    const server = await page.evaluate(() => config.get_request.server);
    expect(server).toBe(ringlightUrl);
});
