// Aufbau in der Verwaltung (Paket 7d): Selbsttest, Buzzer, Abschluss – am Touchscreen und barrierefrei.

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';
import { BUZZER_KEY, DEV_PIN } from '../support/box.mjs';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function axe(page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

test('Selbsttest mit Testfoto, Buzzer prüfen, Aufbau abschließen', async ({ page }) => {
    await page.goto('/admin/aufbau');
    await page.getByLabel('PIN').fill(DEV_PIN);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('heading', { name: 'Aufbau', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aufbau abschließen' })).toBeDisabled();

    await page.getByRole('button', { name: 'Selbsttest starten' }).click();
    const results = page.getByRole('list', { name: 'Ergebnisse' });
    await expect(results).toContainText('Kamera', { timeout: 30_000 });
    await expect(results).toContainText('Drucker');
    await expect(results).toContainText('Bildpipeline');
    await expect(page.getByRole('img', { name: 'Testfoto aus dem Selbsttest' })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Buzzer prüfen' }).click();
    await page.keyboard.press(BUZZER_KEY.code);
    await expect(page.getByText(`Angekommen: Bild ab (${BUZZER_KEY.keyCode})`)).toBeVisible();

    await page.getByRole('button', { name: 'Aufbau abschließen' }).click();
    await expect(page.getByRole('status')).toContainText('Aufbau abgeschlossen');
    await expect(page.getByRole('table')).toContainText('Notzugang');
    expect(await axe(page)).toEqual([]);
});
