// Stromausfallsicheres Schreiben: erst vollständig in eine temporäre Datei, auf die Platte zwingen,
// dann in einem Schritt umbenennen. Nach einem Stromausfall gibt es nur die alte oder die neue Datei.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export function temporaryPathFor(target: string): string {
    return path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomBytes(4).toString('hex')}`);
}

export async function writeAtomic(target: string, data: Buffer | string, mode = 0o644): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = temporaryPathFor(target);
    const handle = await open(temporary, 'wx', mode);
    try {
        await handle.writeFile(data);
        await handle.sync();
    } catch (error) {
        await handle.close();
        await rm(temporary, { force: true });
        throw error;
    }
    await handle.close();
    await rename(temporary, target);
}

export async function writeJson(target: string, value: unknown, mode?: number): Promise<void> {
    await writeAtomic(target, `${JSON.stringify(value, null, 2)}\n`, mode);
}

/** Liest eine JSON-Datei; fehlt sie oder ist sie beschädigt, `null`. */
export async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

export function sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(file: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) {
        hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
}
