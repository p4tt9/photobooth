// Bildpipeline: richtige Bildversionen und Look werden angewendet.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.mjs';
import { printJobs, repoRoot, setConfiguration, TEST_CONFIGURATION } from '../support/box.mjs';

const resultStage = '.stage--result.stage--active';

function inBox(script) {
    return execFileSync('docker', ['compose', 'exec', '-T', '-u', 'application', 'photobooth', 'sh', '-c', script], { cwd: repoRoot })
        .toString()
        .trim();
}

function imageSize(relativePath) {
    const [width, height] = inBox(`php -r '$s = getimagesize("/app/data/${relativePath}"); echo $s[0], " ", $s[1];'`).split(' ').map(Number);
    return { width, height };
}

function pixelAt(relativePath, x, y) {
    const value = Number(inBox(`php -r '$i = imagecreatefromjpeg("/app/data/${relativePath}"); echo imagecolorat($i, ${x}, ${y});'`));
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

async function takePhoto(page) {
    await page.goto('/');
    await page.locator('[data-command="takePic"]').click();
    await expect(page.locator(resultStage)).toBeVisible({ timeout: 60_000 });
    return page.locator(resultStage).getAttribute('data-img');
}

test('Anzeige, Galerie, Vorschaubild und Druck in der richtigen Größe', async ({ page }) => {
    const file = await takePhoto(page);
    expect(file).toMatch(/\.jpg$/);

    // Galerie-Version entsteht im Hintergrund (lange Kante 3000 px)
    await expect.poll(() => Math.max(...Object.values(imageSize(`images/${file}`))), { timeout: 20_000 }).toBe(3000);
    expect(Math.max(...Object.values(imageSize(`thumbs/${file}`)))).toBeLessThanOrEqual(600);

    const jobsBefore = printJobs().length;
    await page.locator('[data-command="printbtn"]').click();
    await expect.poll(() => printJobs().length).toBe(jobsBefore + 1);
    expect(imageSize(`print/${file}`)).toEqual({ width: 1844, height: 1240 });
});

test('Look wird angewendet, Original bleibt unverändert', async ({ page }) => {
    // Test-Look: Farbtabelle, die jede Farbe auf Rot abbildet – eindeutig erkennbar
    const directory = path.join(repoRoot, '.dev/looks/e2e-rot');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'look.json'), JSON.stringify({ format: 'snaphora.look', version: 1, name: 'E2E Rot', lut: 'lut.cube' }));
    writeFileSync(path.join(directory, 'lut.cube'), ['LUT_3D_SIZE 2', ...Array(8).fill('1 0 0')].join('\n') + '\n');

    setConfiguration({ ...TEST_CONFIGURATION, render: { look: 'e2e-rot' }, picture: { ...TEST_CONFIGURATION.picture, take_frame: false } });
    try {
        const file = await takePhoto(page);
        const shown = pixelAt(`images/${file}`, 100, 100);
        expect(shown.r).toBeGreaterThan(200);
        expect(shown.g + shown.b).toBeLessThan(60);

        const original = pixelAt(`tmp/${file}`, 100, 100);
        expect(original.g + original.b, 'Original ohne Look').toBeGreaterThan(60);
    } finally {
        setConfiguration({ ...TEST_CONFIGURATION, render: { look: '' }, picture: { ...TEST_CONFIGURATION.picture, take_frame: true } });
    }
});
