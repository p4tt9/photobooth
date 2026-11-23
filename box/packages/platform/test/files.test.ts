import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, sha256, sha256File, writeAtomic, writeJson } from '../src/index.js';

test('atomar geschrieben: keine temporären Dateien bleiben zurück, Rechte wie verlangt', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'platform-'));
    await writeAtomic(path.join(dir, 'sub', 'a.txt'), 'eins', 0o600);
    await writeAtomic(path.join(dir, 'sub', 'a.txt'), 'zwei', 0o600);
    assert.equal(await readFile(path.join(dir, 'sub', 'a.txt'), 'utf8'), 'zwei');
    assert.deepEqual(await readdir(path.join(dir, 'sub')), ['a.txt']);
    assert.equal((await stat(path.join(dir, 'sub', 'a.txt'))).mode & 0o777, 0o600);
});

test('JSON: fehlende oder beschädigte Datei ergibt null statt Absturz', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'platform-'));
    await writeJson(path.join(dir, 'ok.json'), { a: 1 });
    await writeFile(path.join(dir, 'kaputt.json'), '{"a":');
    assert.deepEqual(await readJson(path.join(dir, 'ok.json')), { a: 1 });
    assert.equal(await readJson(path.join(dir, 'kaputt.json')), null);
    assert.equal(await readJson(path.join(dir, 'fehlt.json')), null);
});

test('Prüfsumme aus Speicher und Datei stimmen überein', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'platform-'));
    await writeFile(path.join(dir, 'x'), 'Inhalt');
    assert.equal(await sha256File(path.join(dir, 'x')), sha256(Buffer.from('Inhalt')));
});
