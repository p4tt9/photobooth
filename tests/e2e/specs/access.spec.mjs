// Zugang zur Verwaltung nur mit persönlicher PIN (planning/ADMIN.md, Pakete 7a/7b).

import { test, expect } from './fixtures.mjs';
import { DEV_PIN } from '../support/box.mjs';

test('ohne PIN: Verwaltung führt zur Anmeldung; alte Verwaltung, Testseiten und Wartungs-Schnittstellen gibt es nicht mehr', async ({ page }) => {
    await page.goto('/admin/druck');
    await expect(page).toHaveURL(/\/admin\/anmelden\?zurueck=%2Fadmin%2Fdruck/);
    await page.goto('/admin-alt/');
    await expect(page, 'alte Lesezeichen führen zur neuen Verwaltung').toHaveURL(/\/admin\/anmelden/);
    for (const gone of ['/test/photo.php', '/manual/', '/welcome/', '/api/serverInfo.php', '/api/admin.php', '/api/rebuildImageDB.php', '/api/selfie.php', '/api/printLimit.php?increaseCount=5']) {
        expect((await page.request.get(gone)).status(), gone).toBe(404);
    }
});

test('alte Lesezeichen auf /login/ führen zur neuen Verwaltung', async ({ page }) => {
    await page.goto('/login/');
    await expect(page).toHaveURL(/\/admin\/anmelden/);
});

test('Anmelden am Ziffernblock wie am Touchscreen, danach zurück zur gewünschten Seite', async ({ page }) => {
    await page.goto('/admin/druck');
    for (const digit of DEV_PIN) {
        await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/admin\/druck$/);
    await expect(page.getByRole('heading', { name: 'Druckkontingent' })).toBeVisible();
});

test('versteckte Geste: 5× in die Ecke tippen öffnet die PIN-Eingabe im Kiosk-Modus', async ({ page }) => {
    await page.goto('/');
    const corner = page.locator('.adminshortcut');
    await expect(corner).toHaveAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) {
        await corner.dispatchEvent('pointerdown');
    }
    await page.waitForTimeout(300);
    await expect(page, 'vier Mal reicht nicht').toHaveURL(/\/$/);
    await corner.dispatchEvent('pointerdown');
    await expect(page).toHaveURL(/\/admin\/anmelden\?kiosk=1/);
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
});

test.describe('falsche PIN', () => {
    // Die Schnittstelle antwortet richtigerweise mit 401; das meldet der Browser in der Konsole
    test.use({ expectedConsoleErrors: [/status of 401/] });

    test('wird angesagt; Eingabe auch per Tastatur möglich', async ({ page }) => {
        await page.goto('/admin/anmelden');
        await page.getByLabel('PIN').fill('0000');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('alert')).toHaveText('PIN falsch');
    });
});
