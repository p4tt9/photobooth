// Gestaltung und Geräte in der Verwaltung (Paket 7c): Bibliothek, Rahmen, Layouts, Buzzer-Taste, Ringlicht.

import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { DEV_PIN, repoRoot } from '../support/box.mjs';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const headers = { 'X-Snaphora-Request': '1' };

async function axe(page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

async function login(page, target) {
    await page.goto(target);
    await page.getByLabel('PIN').fill(DEV_PIN);
    await page.getByRole('button', { name: 'Anmelden' }).click();
}

test('Rahmen hochladen, auswählen, in der Gäste-Oberfläche verwenden; verwendet = nicht löschbar', async ({ page }) => {
    await login(page, '/admin/bibliothek');
    await expect(page.getByRole('heading', { name: 'Bilder und Schriften' })).toBeVisible();
    await page.getByRole('region', { name: 'Rahmen' }).locator('input[type="file"]').setInputFiles({
        name: 'E2E Rahmen.png',
        mimeType: 'image/png',
        buffer: await import('node:fs/promises').then((fs) => fs.readFile(path.join(repoRoot, 'resources/img/frames/frame.png'))),
    });
    await expect(page.getByRole('status')).toContainText('E2E-Rahmen.png hochgeladen');
    expect(await axe(page)).toEqual([]);

    await page.goto('/admin/einstellungen/design');
    await page.getByRole('group', { name: 'Rahmen Einzelfoto' }).getByText('E2E-Rahmen.png').click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');
    expect(await axe(page)).toEqual([]);

    await page.goto('/');
    expect(await page.evaluate(() => config.picture.frame)).toContain('private/images/frames/E2E-Rahmen.png');

    await page.goto('/admin/bibliothek');
    const item = page.getByRole('listitem').filter({ hasText: 'E2E-Rahmen.png' });
    await expect(item).toContainText('Verwendet: Rahmen: Rahmen Einzelfoto (Box)');
    await expect(item.getByRole('button', { name: /löschen/ })).toHaveCount(0);

    // Aufräumen: Auswahl zurück, Datei löschen (mit Nachfrage)
    await page.request.patch('/api/v1/settings', { data: { values: { 'picture.frame': '' } }, headers });
    await page.reload();
    await item.getByRole('button', { name: 'E2E-Rahmen.png löschen' }).click();
    await item.getByRole('button', { name: 'Wirklich löschen' }).click();
    await expect(page.getByRole('status')).toContainText('gelöscht');
});

test.describe('abgelehnte Dateien', () => {
    // app antwortet richtigerweise mit 400; das meldet der Browser in der Konsole
    test.use({ expectedConsoleErrors: [/status of 400/] });

    test('SVG wird nicht angenommen (könnte Skripte enthalten)', async ({ page }) => {
        await login(page, '/admin/bibliothek');
        await page.getByRole('region', { name: 'Logos' }).locator('input[type="file"]').setInputFiles({
            name: 'logo.png',
            mimeType: 'image/png',
            buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        });
        await expect(page.getByRole('status')).toContainText('nur PNG oder JPG');
    });
});

test('Collage-Layout mit Vorschau wählen', async ({ page }) => {
    await login(page, '/admin/einstellungen/capture');
    const layouts = page.getByRole('group', { name: 'Collage-Layout' });
    await expect(layouts.getByRole('radio')).not.toHaveCount(0);
    const before = await (await page.request.get('/api/v1/settings')).json();
    await layouts.getByText('1+2 Layout').click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('gespeichert');
    const after = await (await page.request.get('/api/v1/settings')).json();
    expect(after.values['collage.layout'].value).toBe('1+2-1');
    await page.request.patch('/api/v1/settings', { data: { values: { 'collage.layout': before.values['collage.layout'].value } }, headers });
});

test('Buzzer-Taste anlernen: Taste am Presenter drücken statt Tastencode kennen', async ({ page }) => {
    await login(page, '/admin/einstellungen/capture');
    const field = page.getByLabel('Buzzer-Taste Collage');
    await page.getByRole('button', { name: 'Taste anlernen' }).nth(1).click();
    await page.keyboard.press('PageUp');
    await expect(field).toHaveValue('33');
    await expect(page.getByText('Belegt: Bild auf (33)')).toBeVisible();
    await page.getByRole('button', { name: 'Verwerfen' }).click();
});

test('Geräte: Ringlicht testen meldet ein Ergebnis, Seite ohne Befund', async ({ page }) => {
    await login(page, '/admin/einstellungen/devices');
    await page.getByRole('button', { name: 'Ringlicht testen' }).click();
    // In der Dev-Umgebung zeigt die Adresse auf den Laptop (localhost:8081), die Box selbst erreicht sie nicht –
    // geprüft wird hier nur, dass ein verständliches Ergebnis kommt
    await expect(page.getByRole('status').first()).toContainText(/Ringlicht/);
    expect(await axe(page)).toEqual([]);
});
