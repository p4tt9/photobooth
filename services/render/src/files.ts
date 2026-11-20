// Stromausfallsicheres Schreiben: erst vollständig in eine temporäre Datei, auf die Platte zwingen,
// dann in einem Schritt umbenennen. Nach einem Stromausfall gibt es nur die alte oder die neue Datei.

import { randomBytes } from 'node:crypto';
import { open, rename, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function temporaryPathFor(target: string): string {
    // Beginnt mit Punkt und endet nicht auf .jpg – Galerie und Verzeichnis-Scans übersehen die Datei.
    return path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomBytes(4).toString('hex')}`);
}

export async function writeAtomic(target: string, data: Buffer | string): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = temporaryPathFor(target);
    const handle = await open(temporary, 'wx');
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

/** Für Dateien, die sharp direkt schreibt: in eine temporäre Datei schreiben lassen, dann übernehmen. */
export async function commitTemporaryFile(temporary: string, target: string): Promise<void> {
    const handle = await open(temporary, 'r+');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporary, target);
}
