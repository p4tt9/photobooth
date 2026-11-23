// Zugang zur Verwaltung nur mit persönlicher PIN (planning/ADMIN.md, Paket 7a).

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';
import { DEV_PIN } from '../support/box.mjs';

test('Verwaltung und Testseiten ohne PIN: weiter zur Anmeldung, Wartungs-Schnittstellen gesperrt', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page).toHaveURL(/\/login\/?\?zurueck=%2Fadmin%2F/);
    await page.goto('/test/photo.php');
    await expect(page).toHaveURL(/\/login\/?\?zurueck=/);
    expect((await page.request.get('/api/serverInfo.php')).status()).toBe(401);
    expect(
        (await page.request.get('/api/printLimit.php?increaseCount=5')).status(),
        'Kontingent nur noch mit PIN'
    ).toBe(404);
});

test('Anmelden am Ziffernblock wie am Touchscreen, danach zurück zur gewünschten Seite', async ({ page }) => {
    await page.goto('/admin/');
    for (const digit of DEV_PIN) {
        await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/admin\/$/);
    await expect(page.locator('#save-admin-btn')).toBeVisible();
});

test.describe('falsche PIN', () => {
    // Die Schnittstelle antwortet richtigerweise mit 401; das meldet der Browser in der Konsole
    test.use({ expectedConsoleErrors: [/status of 401/] });

    test('wird angesagt; Eingabe auch per Tastatur möglich', async ({ page }) => {
        await page.goto('/login/');
        await page.getByLabel('PIN').fill('0000');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('alert')).toHaveText('PIN falsch');
    });
});

test('Anmeldeseite ohne Befund der automatischen Barrierefreiheitsprüfung', async ({ page }) => {
    await page.goto('/login/');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
