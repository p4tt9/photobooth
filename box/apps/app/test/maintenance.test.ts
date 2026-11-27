import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EMERGENCY_PIN, person, startBox } from './helpers.js';

test('Protokoll der bisherigen App: neueste zuerst, mit Stufe, nur für Admins', async () => {
    const box = await startBox();
    await mkdir(path.join(box.environment.photoboothVarDir!, 'log'), { recursive: true });
    await writeFile(path.join(box.environment.photoboothVarDir!, 'log', 'main.log'), '[2026-11-27 10:00:00][main][INFO] Foto aufgenommen []\n[2026-11-27 10:00:05][main][ERROR] Drucker nicht erreichbar []\n');
    await box.writeAccess([await person('mia', 'setup', '4711')]);
    assert.equal((await box.request('GET', '/api/v1/maintenance/logs', { cookie: await box.login('4711') })).status, 403);

    const { body } = await box.request('GET', '/api/v1/maintenance/logs', { cookie: await box.login(EMERGENCY_PIN) });
    assert.equal(body.available, true);
    assert.deepEqual(body.lines.map((l: { level: string }) => l.level), ['error', 'info']);
    assert.match(body.lines[0].text, /Drucker nicht erreichbar/);
    await box.close();
});
