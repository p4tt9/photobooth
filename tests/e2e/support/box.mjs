// Hilfsfunktionen für Oberflächentests: Konfiguration der Box setzen, Ringlicht- und Drucker-Simulator auslesen.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ringlightUrl = process.env.RINGLIGHT_URL ?? 'http://localhost:8081';
const spoolDir = path.join(repoRoot, '.dev/printer');

/** Not-PIN der Dev-Umgebung (docker-compose.yml) */
export const DEV_PIN = process.env.SNAPHORA_DEV_PIN ?? '246810';

/** Meldet den Browser-Kontext mit PIN bei app an (die alte Verwaltung verlangt das, planning/ADMIN.md) */
export async function adminLogin(page) {
    const response = await page.request.post('/api/v1/access/login', {
        data: { pin: DEV_PIN },
        headers: { 'X-Snaphora-Request': '1' },
    });
    if (!response.ok()) {
        throw new Error(`Anmeldung mit Dev-PIN fehlgeschlagen: ${response.status()} ${await response.text()}`);
    }
}

/** Taste, die der Buzzer (PowerPoint-Presenter) in den Tests sendet: Bild ab (Page Down). */
export const BUZZER_KEY = { code: 'PageDown', keyCode: 34 };

/** Einstellungen, mit denen die Tests schnell und vollständig laufen. */
export const TEST_CONFIGURATION = {
    picture: { cntdwn_time: 1, cheese_time: 0, key: String(BUZZER_KEY.keyCode) },
    collage: { cntdwn_time: 1, continuous: true, continuous_time: 1 },
    print: { from_result: true, from_gallery: true },
    get_request: { countdown: true, server: ringlightUrl },
    ui: { show_fork: false },
};

function inBox(args, input) {
    return execFileSync(
        'docker',
        ['compose', 'exec', '-T', '-u', 'application', 'photobooth', ...args],
        { cwd: repoRoot, input, stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString();
}

/**
 * Mischt Testwerte in die Box-Einstellungen (config/layers/box.json). Auch Werte außerhalb des Katalogs
 * (z. B. kurze Wartezeiten) – deshalb direkt in die Datei, nicht über die Schnittstelle von app.
 */
export function setConfiguration(overrides) {
    const script = `<?php
require '/app/vendor/autoload.php';
$overrides = json_decode(stream_get_contents(STDIN), true);
$file = '/app/config/layers/box.json';
$layer = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
$config = Photobooth\\Utility\\ArrayUtility::replaceLayer(is_array($layer['config'] ?? null) ? $layer['config'] : [], $overrides);
Photobooth\\Utility\\FileUtility::createDirectory(dirname($file));
Photobooth\\Utility\\FileUtility::writeAtomic($file, (string) json_encode(['updated' => date(DATE_ATOM), 'config' => $config], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
echo "ok";`;
    const scriptPath = '/tmp/snaphora-e2e-config.php';
    inBox(['sh', '-c', `cat > ${scriptPath}`], script);
    const result = inBox(['php', scriptPath], JSON.stringify(overrides));
    if (!result.includes('ok')) {
        throw new Error(`Konfiguration konnte nicht gesetzt werden: ${result}`);
    }
}

export function resetConfiguration() {
    inBox(['rm', '-f', '/app/config/layers/box.json', '/app/config/layers/box.json.bak', '/app/config/layers/local-event.json']);
}

export async function ringlightCalls() {
    const response = await fetch(`${ringlightUrl}/_log`);
    return (await response.json()).map((entry) => entry.path);
}

export async function clearRinglight() {
    await fetch(`${ringlightUrl}/_log`, { method: 'DELETE' });
}

export function printJobs() {
    try {
        return readdirSync(spoolDir).filter((file) => file.endsWith('.txt')).sort();
    } catch {
        return [];
    }
}
