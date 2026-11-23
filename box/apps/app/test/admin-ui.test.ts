import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBox } from './helpers.js';

async function fakeBuild(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'admin-ui-'));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Verwaltung</title>');
    await writeFile(path.join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
    return dir;
}

test('Verwaltung unter /admin/: Unterseiten bekommen index.html, Dateien mit Prüfsumme lange im Cache', async () => {
    const box = await startBox({ adminDir: await fakeBuild() });
    const page = await box.request('GET', '/admin/druck');
    assert.equal(page.status, 200);
    assert.match(String(page.body), /Verwaltung/);
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.match(String(page.headers['content-security-policy']), /script-src 'self'.*frame-ancestors 'none'/);

    const script = await box.request('GET', '/admin/main-ABCDEFGH.js');
    assert.equal(script.status, 200);
    assert.match(String(script.headers['cache-control']), /immutable/);

    assert.equal((await box.request('GET', '/admin')).status, 301);
    const traversal = await box.request('GET', '/admin/..%2F..%2F..%2Fetc%2Fpasswd');
    assert.ok(!String(traversal.body).includes('root:'), 'keine Dateien außerhalb der Oberfläche');
    // Schnittstelle bleibt JSON und geschützt
    assert.equal((await box.request('GET', '/api/v1/status')).status, 401);
    await box.close();
});
