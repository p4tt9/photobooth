// Gast-Abläufe am Touchscreen: Foto, Buzzer, Ringlicht, Druck, Collage, Galerie.

import { test, expect } from './fixtures.mjs';
import { BUZZER_KEY, clearRinglight, printJobs, ringlightCalls } from '../support/box.mjs';

const startStage = '.stage--start.stage--active';
const resultStage = '.stage--result.stage--active';

test.beforeEach(async ({ page }) => {
    await clearRinglight();
    await page.goto('/');
    await expect(page.locator(startStage)).toBeVisible();
});

test('Foto per Touch: Countdown, Ringlicht, Ergebnis, Druck', async ({ page }) => {
    const jobsBefore = printJobs().length;

    await page.locator('[data-command="takePic"]').click();
    await expect(page.locator(resultStage)).toBeVisible({ timeout: 60_000 });

    expect(await ringlightCalls()).toContain('/CNTDWNPHOTO');

    await page.locator('[data-command="printbtn"]').click();
    await expect.poll(() => printJobs().length, { message: 'Druckauftrag beim Drucker-Simulator' }).toBe(jobsBefore + 1);

    await page.locator('[data-command="homebtn"]').click();
    await expect(page.locator(startStage)).toBeVisible();
});

test('Foto per Buzzer (Presenter-Taste)', async ({ page }) => {
    // Erst nach dem Laden der Einstellungen reagiert die Seite auf Tasten
    await page.waitForFunction(() => typeof config === 'object' && config !== null);
    await page.keyboard.press(BUZZER_KEY.code);

    await expect(page.locator(resultStage)).toBeVisible({ timeout: 60_000 });
    expect(await ringlightCalls()).toContain('/CNTDWNPHOTO');
});

test('Collage: mehrere Aufnahmen werden zu einem Bild', async ({ page }) => {
    await page.locator('[data-command="takeCollage"]').click();
    await expect(page.locator(resultStage)).toBeVisible({ timeout: 110_000 });

    expect(await ringlightCalls()).toContain('/CNTDWNCOLLAGE');
});

test('Galerie zeigt die Fotos', async ({ page }) => {
    await page.locator('[data-command="gallery-button"]').click();
    await expect(page.locator('#gallery')).toHaveClass(/gallery--open/);
    await expect(page.locator('.gallery-list-item').first()).toBeVisible();

    await page.locator('[data-command="gallery__close"]').click();
    await expect(page.locator('#gallery')).not.toHaveClass(/gallery--open/);
});
