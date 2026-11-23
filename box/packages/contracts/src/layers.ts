// Einstellungs-Ebenen der Box (planning/AGENT.md, planning/ARCHITEKTUR.md).
//
// Jede Ebene ist eine JSON-Datei in config/layers/ mit demselben Aufbau. Zusammengeführt wird von unten nach
// oben; spätere Ebenen überschreiben frühere. Listen gelten als ein Wert (werden ersetzt, nicht gemischt).
// PHP liest dieselben Dateien mit derselben Regel (ArrayUtility::replaceLayer), bis es in Paket 9 entfällt.

export type ConfigTree = { [key: string]: ConfigValue };
export type ConfigValue = string | number | boolean | null | ConfigValue[] | ConfigTree;

export interface ConfigLayer {
    /** Nur Event-Ebenen: zu welchem Event sie gehören */
    eventId?: string;
    version?: number;
    name?: string;
    updated?: string;
    config: ConfigTree;
}

/** Reihenfolge von unten nach oben. `default` steht nicht in einer Datei, sondern im Katalog bzw. im Image. */
export const LAYER_ORDER = ['default', 'device', 'box', 'event', 'local-event'] as const;
export type LayerName = (typeof LAYER_ORDER)[number];
export type StoredLayerName = Exclude<LayerName, 'default'>;

/** Wer welche Ebene schreibt (Datenbesitz, ARCHITEKTUR.md) */
export const LAYER_OWNER: Record<StoredLayerName, 'agent' | 'app'> = {
    device: 'agent',
    box: 'app',
    event: 'agent',
    'local-event': 'app',
};

export const layerFileName = (layer: StoredLayerName): string => `${layer}.json`;

/**
 * Einstellungen, die keine Ebene setzen darf – sie sind fest im Image bzw. kommen aus der
 * Provisionierung (Umgebungsvariablen). Shell-Befehle in einer speicherbaren Einstellung wären
 * Codeausführung für jeden, der Einstellungen speichern darf.
 */
export const PROTECTED_SECTIONS = ['commands'] as const;

export function isTree(value: unknown): value is ConfigTree {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLayer(value: unknown): value is ConfigLayer {
    return isTree(value) && isTree(value.config);
}

/** Führt `upper` über `lower` zusammen (neues Objekt; Listen und Werte ersetzen) */
export function mergeLayer(lower: ConfigTree, upper: ConfigTree): ConfigTree {
    const result: ConfigTree = { ...lower };
    for (const [key, value] of Object.entries(upper)) {
        const below = result[key];
        result[key] = isTree(value) && isTree(below) ? mergeLayer(below, value) : value;
    }
    return result;
}

export function getPath(tree: ConfigTree, path: string): ConfigValue | undefined {
    let node: ConfigValue | undefined = tree;
    for (const key of path.split('.')) {
        if (!isTree(node)) {
            return undefined;
        }
        node = node[key];
    }
    return node;
}

export function hasPath(tree: ConfigTree, path: string): boolean {
    return getPath(tree, path) !== undefined;
}

/** Setzt einen Wert (neues Objekt) */
export function setPath(tree: ConfigTree, path: string, value: ConfigValue): ConfigTree {
    const [key, ...rest] = path.split('.');
    if (key === undefined) {
        return tree;
    }
    if (rest.length === 0) {
        return { ...tree, [key]: value };
    }
    const child = tree[key];
    return { ...tree, [key]: setPath(isTree(child) ? child : {}, rest.join('.'), value) };
}

/** Entfernt einen Wert (neues Objekt); leer gewordene Bereiche verschwinden mit */
export function deletePath(tree: ConfigTree, path: string): ConfigTree {
    const [key, ...rest] = path.split('.');
    if (key === undefined || !(key in tree)) {
        return tree;
    }
    const { [key]: child, ...others } = tree;
    if (rest.length === 0) {
        return others;
    }
    if (!isTree(child)) {
        return tree;
    }
    const reduced = deletePath(child, rest.join('.'));
    return Object.keys(reduced).length === 0 ? others : { ...others, [key]: reduced };
}

/** Entfernt geschützte Bereiche aus einer Ebene (z. B. Shell-Befehle) */
export function withoutProtected(tree: ConfigTree): ConfigTree {
    let result = tree;
    for (const section of PROTECTED_SECTIONS) {
        result = deletePath(result, section);
    }
    return result;
}
