// Einstellungen lesen und speichern (Modul config).
//
// Liest alle Ebenen wie PHP (unten → oben: Standard, Gerät, Box, Event, am Gerät fürs Event geändert) und
// schreibt nur die Ebenen, die app gehören: box.json und local-event.json. Gespeichert wird je Einstellung:
//   - steuert das aktive Event sie → local-event.json (gilt nur für dieses Event, wird dem Server gemeldet)
//   - sonst → box.json
// Stimmt der neue Wert mit der Ebene darunter überein, wird der Eintrag entfernt statt doppelt gespeichert.

import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    getPath,
    hasPath,
    isLayer,
    LAYER_ORDER,
    layerFileName,
    mergeLayer,
    deletePath,
    setPath,
    SETTINGS,
    withoutProtected,
    type ConfigLayer,
    type ConfigTree,
    type ConfigValue,
    type LayerName,
    type SettingDefinition,
    type StoredLayerName,
} from '@snaphora/contracts';
import { readJson, writeJson } from '@snaphora/platform';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

export interface SettingState {
    value: ConfigValue;
    /** Aus welcher Ebene der wirksame Wert kommt */
    source: LayerName;
    /** Das aktive Event gibt die Einstellung vor; eine Änderung gilt nur für dieses Event */
    eventManaged: boolean;
}

export interface Layers {
    device: ConfigLayer | null;
    box: ConfigLayer | null;
    event: ConfigLayer | null;
    'local-event': ConfigLayer | null;
}

export interface ActiveEvent {
    eventId: string;
    name: string | null;
    version: number | null;
}

export interface SettingChange {
    path: string;
    from: ConfigValue;
    to: ConfigValue;
    layer: 'box' | 'local-event';
}

const DEFAULTS: ConfigTree = SETTINGS.reduce<ConfigTree>((tree, setting) => setPath(tree, setting.path, setting.default), {});

@Injectable()
export class SettingsService {
    private readonly logger = new Logger('Einstellungen');
    /** Schreibvorgänge nacheinander, damit sich zwei Anfragen nicht gegenseitig überschreiben */
    private writing: Promise<unknown> = Promise.resolve();

    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    layerFile(name: StoredLayerName): string {
        return path.join(this.environment.configDir, 'layers', layerFileName(name));
    }

    /** Liest eine Ebene; beschädigte Dateien werden übersprungen (die Box muss immer starten) */
    private async readLayer(name: StoredLayerName): Promise<ConfigLayer | null> {
        const candidates = name === 'box' ? [this.layerFile(name), `${this.layerFile(name)}.bak`] : [this.layerFile(name)];
        for (const file of candidates) {
            const layer = await readJson<unknown>(file);
            if (layer === null) {
                continue;
            }
            if (!isLayer(layer)) {
                this.logger.warn(`Ebene ${file} ist beschädigt und wird übersprungen`);
                continue;
            }
            return { ...layer, config: withoutProtected(layer.config) };
        }
        return null;
    }

    async layers(): Promise<Layers> {
        const [device, box, event, localEvent] = await Promise.all([this.readLayer('device'), this.readLayer('box'), this.readLayer('event'), this.readLayer('local-event')]);
        const activeEvent = event && typeof event.eventId === 'string' ? event : null;
        return {
            device,
            box,
            event: activeEvent,
            // Änderungen am Gerät gehören zu genau einem Event
            'local-event': activeEvent && localEvent?.eventId === activeEvent.eventId ? localEvent : null,
        };
    }

    async activeEvent(): Promise<ActiveEvent | null> {
        const { event } = await this.layers();
        return event ? { eventId: event.eventId as string, name: event.name ?? null, version: event.version ?? null } : null;
    }

    /** Wirksame Werte aller Einstellungen im Katalog, mit Herkunft */
    async values(): Promise<Record<string, SettingState>> {
        const layers = await this.layers();
        const trees: Record<LayerName, ConfigTree> = {
            default: DEFAULTS,
            device: layers.device?.config ?? {},
            box: layers.box?.config ?? {},
            event: layers.event?.config ?? {},
            'local-event': layers['local-event']?.config ?? {},
        };
        const result: Record<string, SettingState> = {};
        for (const setting of SETTINGS) {
            const source = [...LAYER_ORDER].reverse().find((layer) => hasPath(trees[layer], setting.path)) ?? 'default';
            result[setting.path] = {
                value: getPath(trees[source], setting.path) ?? setting.default,
                source,
                eventManaged: hasPath(trees.event, setting.path),
            };
        }
        return result;
    }

    async value(setting: SettingDefinition): Promise<ConfigValue> {
        return (await this.values())[setting.path]?.value ?? setting.default;
    }

    /** Speichert geprüfte Werte (Prüfung und Rechte macht der Aufrufer). Gibt zurück, was sich geändert hat. */
    update(values: Map<SettingDefinition, ConfigValue>): Promise<SettingChange[]> {
        const run = this.writing.then(() => this.write(values));
        this.writing = run.catch(() => undefined);
        return run;
    }

    private async write(values: Map<SettingDefinition, ConfigValue>): Promise<SettingChange[]> {
        const layers = await this.layers();
        const before = await this.values();
        const below = mergeLayer(DEFAULTS, layers.device?.config ?? {});
        let box = layers.box?.config ?? {};
        let localEvent = layers['local-event']?.config ?? {};
        const changes: SettingChange[] = [];

        for (const [setting, value] of values) {
            const eventConfig = layers.event?.config;
            const previous = before[setting.path]?.value ?? setting.default;
            if (eventConfig && hasPath(eventConfig, setting.path)) {
                localEvent = same(getPath(eventConfig, setting.path), value) ? deletePath(localEvent, setting.path) : setPath(localEvent, setting.path, value);
                if (!same(previous, value)) changes.push({ path: setting.path, from: previous, to: value, layer: 'local-event' });
            } else {
                box = same(getPath(below, setting.path), value) ? deletePath(box, setting.path) : setPath(box, setting.path, value);
                if (!same(previous, value)) changes.push({ path: setting.path, from: previous, to: value, layer: 'box' });
            }
        }

        const updated = this.environment.now().toISOString();
        if (!same(box, layers.box?.config ?? {})) {
            await this.writeBox({ ...(layers.box ?? {}), updated, config: box });
        }
        if (layers.event && !same(localEvent, layers['local-event']?.config ?? {})) {
            await writeJson(this.layerFile('local-event'), { eventId: layers.event.eventId, updated, config: localEvent } satisfies ConfigLayer);
        }
        return changes;
    }

    /** Box-Einstellungen: vorher die letzte gute Fassung sichern (Rückfall, falls die Datei je beschädigt wird) */
    private async writeBox(layer: ConfigLayer): Promise<void> {
        const file = this.layerFile('box');
        if (isLayer(await readJson<unknown>(file))) {
            await copyFile(file, `${file}.bak`);
        }
        await writeJson(file, layer);
    }

    /** Alle Änderungen am Gerät für das aktive Event verwerfen */
    async resetEventChanges(): Promise<boolean> {
        const run = this.writing.then(async () => {
            const layers = await this.layers();
            if (!layers.event || !layers['local-event']) {
                return false;
            }
            await writeJson(this.layerFile('local-event'), { eventId: layers.event.eventId, updated: this.environment.now().toISOString(), config: {} } satisfies ConfigLayer);
            return true;
        });
        this.writing = run.catch(() => undefined);
        return run;
    }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
