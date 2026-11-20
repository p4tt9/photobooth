import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JobQueue, type Job } from '../src/queue.js';

const quiet = () => {};

test('Aufträge werden der Reihe nach erledigt und Wartende benachrichtigt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'queue-'));
    const done: string[] = [];
    const queue = new JobQueue(directory, async (job: Job) => { done.push(job.id); }, quiet);
    await queue.start();
    await queue.enqueue('a', 'test', {});
    await queue.enqueue('b', 'test', {});
    await queue.waitFor('b', 5000);
    queue.stop();
    assert.deepEqual(done, ['a', 'b']);
    assert.deepEqual(await readdir(directory), [], 'erledigte Aufträge werden entfernt');
});

test('nach einem Stromausfall liegende Aufträge werden beim Start fortgesetzt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'queue-'));
    // Auftrag, den ein "Stromausfall" nicht mehr erledigen ließ
    await writeFile(path.join(directory, '1700000000000-000000-liegengeblieben.json'), JSON.stringify({ id: 'liegengeblieben', type: 'test', created: '', payload: {} }));
    const done: string[] = [];
    const queue = new JobQueue(directory, async (job) => { done.push(job.id); }, quiet);
    await queue.start();
    await queue.waitFor('liegengeblieben', 5000);
    queue.stop();
    assert.deepEqual(done, ['liegengeblieben']);
});

test('beschädigte Auftragsdatei blockiert die Warteschlange nicht', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'queue-'));
    await writeFile(path.join(directory, '1700000000000-000000-kaputt.json'), '{"id": "kaputt", "ty');
    const done: string[] = [];
    const queue = new JobQueue(directory, async (job) => { done.push(job.id); }, quiet);
    await queue.start();
    await queue.enqueue('danach', 'test', {});
    await queue.waitFor('danach', 5000);
    queue.stop();
    assert.deepEqual(done, ['danach']);
});

test('fehlgeschlagener Auftrag meldet den Fehler an Wartende und blockiert nicht', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'queue-'));
    const queue = new JobQueue(directory, async (job) => {
        if (job.id === 'fehler') {
            throw new Error('Testfehler');
        }
    }, quiet);
    await queue.start();
    await queue.enqueue('fehler', 'test', {});
    await assert.rejects(queue.waitFor('fehler', 5000), /Testfehler/);
    await queue.enqueue('ok', 'test', {});
    await queue.waitFor('ok', 5000);
    queue.stop();
});
