// app und photobooth (PHP) arbeiten zusammen (Arbeitspaket 7a, planning/ADMIN.md):
//
//   1. Einstellungskatalog und PHP-Schema haben dieselben Standardwerte
//   2. Einstellung über app gespeichert → PHP verwendet sie
//   3. Druckkontingent erreicht → Druck gesperrt; nur Erhöhen mit PIN gibt ihn frei (kein Entsperren durch Gäste)
//
//   node tests/app/settings-print.mjs     (Dev-Umgebung muss laufen, box/ gebaut)

import { execFileSync } from 'node:child_process';
import { SETTINGS } from '../../box/packages/contracts/dist/src/index.js';
import { BoxClient } from '../lib/box-client.mjs';
import { fetchRetry } from '../lib/http.mjs';
import { runTest } from '../lib/report.mjs';

const box = new BoxClient();
const pin = process.env.SNAPHORA_DEV_PIN ?? '246810';
const inBox = (...args) => execFileSync('docker', ['compose', 'exec', '-T', '-u', 'application', 'photobooth', ...args]).toString();
const php = (code) => JSON.parse(inBox('php', '-r', `require "/app/vendor/autoload.php"; ${code}`));

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    console.log(`  ✓ ${message}`);
}

async function login() {
    const response = await fetch(`${box.baseUrl}/api/v1/access/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Snaphora-Request': '1' },
        body: JSON.stringify({ pin }),
    });
    check(response.ok, `Anmeldung mit Not-PIN (${response.status})`);
    return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function api(cookie, method, path, body) {
    const response = await fetchRetry(`${box.baseUrl}/api/v1${path}`, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Snaphora-Request': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${method} /api/v1${path} → HTTP ${response.status}: ${text}`);
    }
    return JSON.parse(text);
}

await runTest('app: Einstellungen und Druckkontingent mit PHP', async () => {
    await box.waitUntilReady();
    const cookie = await login();

    console.log('1. Standardwerte');
    const defaults = php('echo json_encode((new Photobooth\\Service\\ConfigurationService("/tmp/leer-" . uniqid()))->getDefaultConfiguration());');
    const value = (tree, path) => path.split('.').reduce((node, key) => node?.[key], tree);
    const different = SETTINGS.filter((s) => JSON.stringify(value(defaults, s.path)) !== JSON.stringify(s.default)).map((s) => `${s.path}: Katalog ${JSON.stringify(s.default)}, PHP ${JSON.stringify(value(defaults, s.path))}`);
    check(different.length === 0, `Katalog und PHP-Schema stimmen überein (${SETTINGS.length} Einstellungen)${different.length ? `: ${different.join('; ')}` : ''}`);

    console.log('2. Einstellung über app');
    await api(cookie, 'PATCH', '/settings', { values: { 'picture.cntdwn_time': 2, 'start_screen.title': 'Test <b>&</b> Box' } });
    const config = php('$c = (new Photobooth\\Service\\ConfigurationService())->getConfiguration(); echo json_encode([$c["picture"]["cntdwn_time"], $c["start_screen"]["title"]]);');
    check(config[0] === 2 && config[1] === 'Test <b>&</b> Box', `PHP verwendet die Werte aus app (${JSON.stringify(config)})`);
    const start = await (await fetchRetry(`${box.baseUrl}/`)).text();
    check(!start.includes('<b>&</b>'), 'Titel wird auf der Startseite escaped');

    console.log('3. Druckkontingent');
    await box.refreshToken();
    const { file } = await box.capture();
    await box.process(file);
    const before = await api(cookie, 'GET', '/print');
    const printed = before.printed ?? 0;
    await api(cookie, 'PATCH', '/settings', { values: { 'print.limit': printed + 1 } });
    const first = await box.print(file);
    check(first.status === 'locking', `letzter Druck im Kontingent meldet die Sperre (${first.status})`);
    let blocked = false;
    try {
        await box.print(file);
    } catch (error) {
        blocked = /Druck fehlgeschlagen/.test(error.message);
    }
    check(blocked, 'weiterer Druck abgelehnt');
    check((await api(cookie, 'GET', '/print')).locked === true, 'app zeigt den Druck als gesperrt');
    const unlock = await fetchRetry(`${box.baseUrl}/api/printDB.php?action=unlockPrint&csrf=${box.token}`, { headers: { Cookie: box.cookies } });
    check(unlock.status === 400, `Entsperren ohne PIN gibt es nicht mehr (${unlock.status})`);

    const raised = await api(cookie, 'POST', '/print/quota', { add: 1 });
    check(raised.locked === false && raised.remaining === 1, `Kontingent mit PIN erhöht (${JSON.stringify(raised)})`);
    const again = await box.print(file);
    check(again.status === 'locking', 'danach wieder genau ein Druck möglich');

    // Aufräumen: Box-Einstellungen aus diesem Test entfernen
    await api(cookie, 'PATCH', '/settings', { values: { 'picture.cntdwn_time': 5, 'start_screen.title': '', 'print.limit': 0 } });
    console.log('Test bestanden.');
});
