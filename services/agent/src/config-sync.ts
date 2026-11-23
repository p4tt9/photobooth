// Konfiguration vom Server holen und als Ebenen für die App ablegen (Konzept 4.4).
//
//   config/layers/device.json  Geräte-Einstellungen vom Server
//   config/layers/event.json   Event-Profil vom Server (nur solange es gilt)
//
// Ablauf: Konfiguration laden → alle Bilder laden und Prüfsumme prüfen → erst dann als „zuletzt gut“ speichern
// und die Ebenen schreiben. Ohne Verbindung gilt die zuletzt gute Konfiguration weiter; ein Event-Profil
// gilt nur in seinem Zeitfenster, danach läuft die Box wieder mit ihren lokalen Einstellungen.

import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ServerClient } from './client.js';
import type { DeviceConfig, EventProfile } from './contract.js';
import { readJson, sha256, writeAtomic, writeJson } from './files.js';
import { assetFileName, eventAssets, mapDevice, mapEvent } from './mapping.js';
import { validateDeviceConfig } from './validate.js';

export interface CachedConfig {
    etag: string | null;
    receivedAt: string;
    config: DeviceConfig;
}

export interface ConfigSyncOptions {
    agentDir: string;
    configDir: string;
    privateDir: string;
    log: (message: string) => void;
    now?: () => Date;
}

export class ConfigSync {
    private cached: CachedConfig | null = null;
    lastSync: string | null = null;
    lastError: string | null = null;

    constructor(private readonly options: ConfigSyncOptions) {}

    private get cacheFile(): string {
        return path.join(this.options.agentDir, 'server-config.json');
    }

    get assetDir(): string {
        return path.join(this.options.privateDir, 'snaphora', 'assets');
    }

    layerFile(name: 'device' | 'event'): string {
        return path.join(this.options.configDir, 'layers', `${name}.json`);
    }

    private now(): Date {
        return this.options.now?.() ?? new Date();
    }

    /** Beim Start: zuletzt gute Konfiguration anwenden, bevor der Server gefragt wird (oder ohne Netz). */
    async start(): Promise<void> {
        this.cached = await readJson<CachedConfig>(this.cacheFile);
        if (this.cached) {
            try {
                // Auch die eigene Datei prüfen: beschädigt oder von einer älteren Version → verwerfen
                this.cached = { ...this.cached, config: validateDeviceConfig(this.cached.config, true) };
            } catch (error) {
                this.options.log(`Zuletzt geladene Konfiguration unbrauchbar (${(error as Error).message}) – wird neu geladen`);
                this.cached = null;
            }
        }
        if (this.cached) {
            this.options.log(`Zuletzt geladene Konfiguration vom ${this.cached.receivedAt} wird verwendet`);
        }
        await this.apply();
    }

    /** Fragt den Server und wendet eine neue Konfiguration an. Wirft bei Fehlern (offline, abgelehnt). */
    async sync(client: ServerClient): Promise<boolean> {
        try {
            const result = await client.getConfig(this.cached?.etag ?? null);
            let changed = false;
            if (result.changed) {
                await this.downloadAssets(client, result.config.event);
                this.cached = { etag: result.etag, receivedAt: this.now().toISOString(), config: result.config };
                await writeJson(this.cacheFile, this.cached);
                changed = true;
                const event = result.config.event;
                this.options.log(
                    `Neue Konfiguration: Gerät v${result.config.device.version}` +
                        (event ? `, Event ${event.eventId} v${event.version} (${event.validFrom} bis ${event.validUntil})` : ', kein Event'),
                );
            }
            this.lastSync = this.now().toISOString();
            this.lastError = null;
            await this.apply();
            return changed;
        } catch (error) {
            this.lastError = (error as Error).message;
            // Zeitfenster laufen auch ohne Verbindung weiter
            await this.apply();
            throw error;
        }
    }

    /** Das Event-Profil, das gerade gilt (Zeitfenster), oder null */
    activeEvent(): EventProfile | null {
        const event = this.cached?.config.event ?? null;
        if (!event) {
            return null;
        }
        const now = this.now().getTime();
        return Date.parse(event.validFrom) <= now && now < Date.parse(event.validUntil) ? event : null;
    }

    get deviceVersion(): number | null {
        return this.cached?.config.device.version ?? null;
    }

    /** Schreibt die Ebenen-Dateien, wenn sich ihr Inhalt geändert hat. */
    async apply(): Promise<void> {
        const device = this.cached?.config.device;
        if (device) {
            await this.writeLayer('device', { source: 'server', deviceId: device.deviceId, version: device.version, config: mapDevice(device) });
        }
        const event = this.activeEvent();
        if (event) {
            await this.writeLayer('event', { source: 'server', eventId: event.eventId, version: event.version, name: event.name ?? null, validUntil: event.validUntil, config: mapEvent(event) });
        } else {
            await this.removeLayer('event');
        }
    }

    private async writeLayer(name: 'device' | 'event', layer: Record<string, unknown>): Promise<void> {
        const file = this.layerFile(name);
        const current = await readJson<Record<string, unknown>>(file);
        if (current && JSON.stringify(current) === JSON.stringify(layer)) {
            return;
        }
        await writeJson(file, layer);
        if (name === 'event') {
            this.options.log(`Event-Einstellungen aktiv: ${String(layer.eventId)} v${String(layer.version)}`);
        }
    }

    private async removeLayer(name: 'device' | 'event'): Promise<void> {
        try {
            await rm(this.layerFile(name));
            this.options.log(name === 'event' ? 'Kein Event aktiv: Box läuft mit ihren lokalen Einstellungen' : `Ebene ${name} entfernt`);
        } catch {
            // war nicht vorhanden
        }
    }

    private async downloadAssets(client: ServerClient, event: EventProfile | null): Promise<void> {
        await mkdir(this.assetDir, { recursive: true });
        const needed = eventAssets(event);
        for (const asset of needed) {
            const target = path.join(this.assetDir, assetFileName(asset));
            if (await exists(target)) {
                continue;
            }
            const data = await client.getAsset(asset.sha256);
            const actual = sha256(data);
            if (actual !== asset.sha256) {
                throw new Error(`Bild ${asset.name ?? asset.sha256}: Prüfsumme stimmt nicht (${actual})`);
            }
            await writeAtomic(target, data);
        }
        await this.pruneAssets(new Set([...needed, ...eventAssets(this.cached?.config.event ?? null)].map(assetFileName)));
    }

    /** Bilder entfernen, die weder die neue noch die bisherige Konfiguration braucht */
    private async pruneAssets(keep: Set<string>): Promise<void> {
        for (const file of await readdir(this.assetDir).catch(() => [])) {
            if (!keep.has(file) && !file.startsWith('.')) {
                await rm(path.join(this.assetDir, file), { force: true });
            }
        }
    }
}

async function exists(file: string): Promise<boolean> {
    try {
        await stat(file);
        return true;
    } catch {
        return false;
    }
}
