// Neue Verwaltung (Angular, Paket 7b): Abläufe und Barrierefreiheit.

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.mjs';
import { DEV_PIN } from '../support/box.mjs';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function axe(page) {
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}

async function login(page, path = '/admin/') {
    await page.goto(path);
    await page.getByLabel('PIN').fill(DEV_PIN);
    await page.getByRole('button', { name: 'Anmelden' }).click();
}

test('Anmeldeseite ohne Befund der automatischen Barrierefreiheitsprüfung', async ({ page }) => {
    await page.goto('/admin/anmelden');
    await expect(page.getByRole('heading', { name: 'Verwaltung' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
});

test('Übersicht zeigt den Zustand der Box, ohne Befund bei der Barrierefreiheit', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    for (const card of ['Event', 'Druck', 'Fotos', 'Speicher', 'Verbindung zum Server']) {
        await expect(page.getByRole('heading', { name: card, exact: true })).toBeVisible();
    }
    expect(await axe(page)).toEqual([]);
});

test('Kontingent erhöhen: Übersicht und Gäste-Druck sehen den neuen Stand', async ({ page }) => {
    await login(page, '/admin/druck');
    await expect(page.getByRole('heading', { name: 'Druckkontingent' })).toBeVisible();
    await page.getByRole('button', { name: '+ 10', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Kontingent um 10 erhöht');
    expect(await axe(page)).toEqual([]);
    const status = await (await page.request.get('/api/v1/print')).json();
    expect(status.limit).toBeGreaterThan(0);
    // Zurück auf unbegrenzt, damit andere Tests drucken können
    await page.request.patch('/api/v1/settings', { data: { values: { 'print.limit': 0 } }, headers: { 'X-Snaphora-Request': '1' } });
});

test('Einstellung ändern und speichern: die Gäste-Oberfläche verwendet sie', async ({ page }) => {
    await login(page, '/admin/einstellungen/capture');
    await expect(page.getByRole('heading', { name: 'Aufnahme' })).toBeVisible();
    const countdown = page.getByLabel('Countdown Collage');
    const before = await countdown.inputValue();
    await countdown.fill('4');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByRole('status')).toContainText('1 Einstellung gespeichert');
    expect(await axe(page)).toEqual([]);

    await page.goto('/');
    expect(await page.evaluate(() => config.collage.cntdwn_time)).toBe(4);

    // Zurücksetzen
    await page.request.patch('/api/v1/settings', { data: { values: { 'collage.cntdwn_time': Number(before) } }, headers: { 'X-Snaphora-Request': '1' } });
});

test('ungültiger Wert: Meldung am Feld, nichts gespeichert', async ({ page }) => {
    await login(page, '/admin/einstellungen/capture');
    await page.getByLabel('Countdown Einzelfoto').fill('60');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('muss zwischen 0 und 10 liegen').first()).toBeVisible();
    await expect(page.getByLabel('Countdown Einzelfoto')).toHaveAttribute('aria-invalid', 'true');
});

test('Zugang, Event und Wartung ohne Befund; Abmelden beendet die Sitzung', async ({ page }) => {
    await login(page, '/admin/zugang');
    await expect(page.getByRole('heading', { name: 'Protokoll' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Angemeldet' }).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('link', { name: 'Event' }).click();
    await expect(page.getByRole('heading', { name: 'Event', exact: true })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole('link', { name: 'Wartung' }).click();
    await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
    await expect(page.getByRole('status')).toContainText(/Abgeglichen|Server/);
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:8080\/$|localhost:8080\/$/);
    expect((await page.request.get('/api/v1/status')).status()).toBe(401);
});

test('am Handy: Navigation erreichbar, nichts ragt über den Rand', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);
    await expect(page.getByRole('navigation', { name: 'Bereiche' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
