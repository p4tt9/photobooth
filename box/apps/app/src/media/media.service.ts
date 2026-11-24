// Bibliothek für Rahmen, Hintergründe, Logos und Schriften (Modul media).
//
// app besitzt die Upload-Ordner unter private/ (planning/ARCHITEKTUR.md, Datenbesitz). Eine Datei, die eine
// Einstellung verwendet (in irgendeiner Ebene, auch vom Server), lässt sich nicht löschen.

import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { getPath, MEDIA_FILE_NAME, MEDIA_KINDS, SETTINGS, type MediaItem, type MediaKind, type MediaLibrary } from '@snaphora/contracts';
import { writeAtomic } from '@snaphora/platform';
import { SettingsService } from '../config/settings.service.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { checkUpload, safeFileName } from './file-check.js';

const LAYER_LABEL = { device: 'Server (Gerät)', box: 'Box', event: 'Event', 'local-event': 'Event, an der Box geändert' } as const;

@Injectable()
export class MediaService {
    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly settings: SettingsService,
    ) {}

    private directory(kind: MediaKind): string {
        // privateDir ist das Volume, das in der App unter /app/private liegt; uploadDir beginnt mit "private/"
        return path.join(this.environment.privateDir, MEDIA_KINDS[kind].uploadDir.replace(/^private\//, ''));
    }

    /** Welche Einstellungen (in welcher Ebene) auf einen Pfad verweisen */
    async usage(): Promise<Map<string, string[]>> {
        const layers = await this.settings.layers();
        const usage = new Map<string, string[]>();
        for (const setting of SETTINGS) {
            if (setting.type !== 'media') continue;
            for (const [layer, label] of Object.entries(LAYER_LABEL) as Array<[keyof typeof LAYER_LABEL, string]>) {
                const value = getPath(layers[layer]?.config ?? {}, setting.path);
                if (typeof value === 'string' && value !== '') {
                    usage.set(value, [...(usage.get(value) ?? []), `${setting.group ? setting.group + ': ' : ''}${setting.label} (${label})`]);
                }
            }
        }
        return usage;
    }

    async list(): Promise<MediaLibrary> {
        const usage = await this.usage();
        const library = {} as MediaLibrary;
        for (const kind of Object.keys(MEDIA_KINDS) as MediaKind[]) {
            const directory = this.directory(kind);
            const items: MediaItem[] = [];
            for (const name of await readdir(directory).catch(() => [] as string[])) {
                if (!MEDIA_FILE_NAME.test(name)) continue;
                const info = await stat(path.join(directory, name)).catch(() => null);
                if (!info?.isFile()) continue;
                const relative = `${MEDIA_KINDS[kind].uploadDir}/${name}`;
                items.push({ name, path: relative, size: info.size, modified: info.mtime.toISOString(), usedBy: usage.get(relative) ?? [] });
            }
            library[kind] = items.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        }
        return library;
    }

    /** Speichert eine geprüfte Datei; gleicher Name wird nicht überschrieben, sondern durchnummeriert */
    async upload(kind: MediaKind, originalName: string, data: Buffer): Promise<MediaItem> {
        const type = checkUpload(kind, data);
        const directory = this.directory(kind);
        const wanted = safeFileName(originalName, type);
        const existing = new Set(await readdir(directory).catch(() => [] as string[]));
        let name = wanted;
        for (let counter = 2; existing.has(name); counter++) {
            name = wanted.replace(/\.(\w+)$/, `-${counter}.$1`);
        }
        await writeAtomic(path.join(directory, name), data, 0o644);
        return { name, path: `${MEDIA_KINDS[kind].uploadDir}/${name}`, size: data.length, modified: this.environment.now().toISOString(), usedBy: [] };
    }

    async remove(kind: MediaKind, name: string): Promise<void> {
        if (!MEDIA_FILE_NAME.test(name)) throw new NotFoundException('Datei nicht gefunden');
        const relative = `${MEDIA_KINDS[kind].uploadDir}/${name}`;
        const usedBy = (await this.usage()).get(relative);
        if (usedBy?.length) {
            throw new ConflictException({ error: `Wird noch verwendet: ${usedBy.join(', ')}`, usedBy });
        }
        const file = path.join(this.directory(kind), name);
        if (!(await stat(file).catch(() => null))?.isFile()) throw new NotFoundException('Datei nicht gefunden');
        await rm(file);
    }
}
