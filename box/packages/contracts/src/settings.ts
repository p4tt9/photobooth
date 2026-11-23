// Einstellungskatalog: jede Einstellung, die man an der Box ändern kann (planning/ARCHITEKTUR.md).
//
// Was hier nicht steht, ist an der Box nicht einstellbar. Aus dem Katalog entstehen die Prüfung beim Speichern
// (app), die Formulare der Admin-Oberfläche und die Doku. Standardwerte müssen mit dem PHP-Schema übereinstimmen,
// solange es existiert (tests/Unit/Service/SettingsCatalogueTest.php prüft das).

import type { SettingDescription } from './admin-api.js';
import { isTree, type ConfigValue } from './layers.js';

export type Role = 'setup' | 'admin';

/** Rechte: Admin darf alles, Aufbau nur, was ausdrücklich für den Aufbau freigegeben ist */
export const ROLE_RANK: Record<Role, number> = { setup: 1, admin: 2 };
export const roleAllows = (role: Role, required: Role): boolean => ROLE_RANK[role] >= ROLE_RANK[required];

export const SETTING_SECTIONS = {
    print: 'Druck',
    capture: 'Aufnahme',
    design: 'Gestaltung',
    devices: 'Geräte',
    gallery: 'Galerie',
} as const;
export type SettingSection = keyof typeof SETTING_SECTIONS;

interface BaseSetting {
    /** Pfad in der Konfiguration, z. B. `print.limit` */
    path: string;
    section: SettingSection;
    label: string;
    help?: string;
    /** Wer die Einstellung ändern darf (Standard: admin) */
    role?: Role;
}

export type SettingDefinition = BaseSetting &
    (
        | { type: 'boolean'; default: boolean }
        | { type: 'integer'; default: number; min: number; max: number; unit?: string }
        | { type: 'text'; default: string; maxLength: number; pattern?: RegExp; multiline?: boolean }
        | { type: 'choice'; default: string; options: Readonly<Record<string, string>> }
        /** Taste als JavaScript-keyCode (Buzzer, Presenter); leer = keine Taste */
        | { type: 'key'; default: string }
        /** Adresse im lokalen Netz (z. B. Ringlicht); leer = aus */
        | { type: 'url'; default: string; schemes: readonly string[] }
    );

const LAYOUT = /^[A-Za-z0-9+_-]{1,40}$/;

export const SETTINGS: readonly SettingDefinition[] = [
    // Druck
    { path: 'print.limit', section: 'print', type: 'integer', default: 0, min: 0, max: 100000, role: 'setup', label: 'Druckkontingent', help: 'Wie viele Drucke dieses Event insgesamt darf. 0 = unbegrenzt.' },
    { path: 'print.from_result', section: 'print', type: 'boolean', default: false, label: 'Drucken direkt nach der Aufnahme' },
    { path: 'print.from_gallery', section: 'print', type: 'boolean', default: false, label: 'Drucken aus der Galerie' },
    { path: 'print.auto', section: 'print', type: 'boolean', default: false, label: 'Jedes Foto automatisch drucken' },
    { path: 'print.max_multi', section: 'print', type: 'integer', default: 1, min: 1, max: 10, label: 'Kopien pro Druck höchstens' },
    { path: 'print.qrcode', section: 'print', type: 'boolean', default: false, label: 'QR-Code auf den Druck' },
    { path: 'print.print_frame', section: 'print', type: 'boolean', default: false, label: 'Eigenen Druckrahmen verwenden' },
    { path: 'print.key', section: 'print', type: 'key', default: '', label: 'Taste zum Drucken' },

    // Aufnahme
    { path: 'picture.enabled', section: 'capture', type: 'boolean', default: true, label: 'Einzelfoto anbieten' },
    { path: 'picture.cntdwn_time', section: 'capture', type: 'integer', default: 5, min: 0, max: 10, unit: 's', label: 'Countdown Einzelfoto' },
    { path: 'picture.key', section: 'capture', type: 'key', default: '', label: 'Buzzer-Taste Einzelfoto' },
    { path: 'picture.allow_delete', section: 'capture', type: 'boolean', default: true, label: 'Gäste dürfen ihr Foto direkt nach der Aufnahme löschen' },
    { path: 'collage.enabled', section: 'capture', type: 'boolean', default: true, label: 'Collage anbieten' },
    { path: 'collage.cntdwn_time', section: 'capture', type: 'integer', default: 3, min: 0, max: 10, unit: 's', label: 'Countdown Collage' },
    { path: 'collage.key', section: 'capture', type: 'key', default: '', label: 'Buzzer-Taste Collage' },
    { path: 'collage.layout', section: 'capture', type: 'text', default: '2+2-2', maxLength: 40, pattern: LAYOUT, label: 'Collage-Layout' },
    { path: 'custom.enabled', section: 'capture', type: 'boolean', default: false, label: '„Custom“-Aufnahme anbieten' },
    { path: 'custom.btn_text', section: 'capture', type: 'text', default: 'Custom', maxLength: 30, label: 'Beschriftung „Custom“-Knopf' },
    { path: 'custom.cntdwn_time', section: 'capture', type: 'integer', default: 5, min: 0, max: 10, unit: 's', label: 'Countdown „Custom“' },
    { path: 'custom.key', section: 'capture', type: 'key', default: '', label: 'Buzzer-Taste „Custom“' },

    // Gestaltung
    { path: 'start_screen.title', section: 'design', type: 'text', default: '', maxLength: 120, multiline: true, label: 'Titel auf der Startseite' },
    { path: 'start_screen.title_visible', section: 'design', type: 'boolean', default: false, label: 'Titel anzeigen' },
    { path: 'start_screen.subtitle', section: 'design', type: 'text', default: '', maxLength: 120, multiline: true, label: 'Untertitel auf der Startseite' },
    { path: 'start_screen.subtitle_visible', section: 'design', type: 'boolean', default: false, label: 'Untertitel anzeigen' },

    // Geräte
    { path: 'get_request.countdown', section: 'devices', type: 'boolean', default: false, label: 'Ringlicht beim Countdown einschalten' },
    { path: 'get_request.server', section: 'devices', type: 'url', default: '', schemes: ['http:', 'https:'], label: 'Adresse des Ringlichts', help: 'z. B. http://192.168.8.50' },
    { path: 'screensaver.enabled', section: 'devices', type: 'boolean', default: false, label: 'Bildschirmschoner' },
    { path: 'screensaver.timeout_minutes', section: 'devices', type: 'integer', default: 3, min: 1, max: 120, unit: 'min', label: 'Bildschirmschoner nach' },
    { path: 'remotebuzzer.startserver', section: 'devices', type: 'boolean', default: false, label: 'Fernauslöser (GPIO/Netzwerk)' },
    { path: 'remotebuzzer.usebuttons', section: 'devices', type: 'boolean', default: false, label: 'Fernauslöser: Hardware-Taster verwenden' },

    // Galerie
    { path: 'gallery.enabled', section: 'gallery', type: 'boolean', default: true, label: 'Galerie am Kiosk' },
    { path: 'gallery.newest_first', section: 'gallery', type: 'boolean', default: true, label: 'Neueste Fotos zuerst' },
    { path: 'gallery.allow_delete', section: 'gallery', type: 'boolean', default: true, label: 'Löschen in der Galerie am Kiosk' },
    { path: 'qr.enabled', section: 'gallery', type: 'boolean', default: true, label: 'QR-Code zum Foto anzeigen' },
];

const BY_PATH = new Map(SETTINGS.map((setting) => [setting.path, setting]));

export const findSetting = (path: string): SettingDefinition | undefined => BY_PATH.get(path);
export const requiredRole = (setting: SettingDefinition): Role => setting.role ?? 'admin';

export class InvalidSettingError extends Error {
    constructor(
        readonly path: string,
        message: string,
    ) {
        super(message);
    }
}

// Steuerzeichen außer Zeilenumbruch (Texte landen auf dem Kiosk-Bildschirm und im Druck)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** Prüft einen Wert gegen seine Definition und gibt ihn normalisiert zurück */
export function validateSetting(setting: SettingDefinition, value: unknown): ConfigValue {
    const fail = (message: string): never => {
        throw new InvalidSettingError(setting.path, `${setting.label}: ${message}`);
    };
    switch (setting.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : fail('muss ja oder nein sein');
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value)) {
                return fail('muss eine ganze Zahl sein');
            }
            return value >= setting.min && value <= setting.max ? value : fail(`muss zwischen ${setting.min} und ${setting.max} liegen`);
        case 'text': {
            if (typeof value !== 'string') {
                return fail('muss ein Text sein');
            }
            const text = setting.multiline ? value.replace(/\r\n?/g, '\n') : value;
            if (text.length > setting.maxLength) {
                return fail(`höchstens ${setting.maxLength} Zeichen`);
            }
            if (CONTROL.test(text) || (!setting.multiline && text.includes('\n'))) {
                return fail('enthält unzulässige Zeichen');
            }
            if (setting.pattern && text !== '' && !setting.pattern.test(text)) {
                return fail('hat ein ungültiges Format');
            }
            return text;
        }
        case 'choice':
            return typeof value === 'string' && Object.hasOwn(setting.options, value) ? value : fail('ist keine der erlaubten Möglichkeiten');
        case 'key':
            if (value === '' || value === null) {
                return '';
            }
            if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1000) {
                return String(value);
            }
            return typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value) ? value : fail('ist keine gültige Taste');
        case 'url': {
            if (value === '') {
                return '';
            }
            if (typeof value !== 'string' || value.length > 200) {
                return fail('ist keine gültige Adresse');
            }
            let url: URL;
            try {
                url = new URL(value);
            } catch {
                return fail('ist keine gültige Adresse');
            }
            if (!setting.schemes.includes(url.protocol) || url.username || url.password) {
                return fail(`muss mit ${setting.schemes.join(' oder ')}// beginnen`);
            }
            return value.replace(/\/+$/, '');
        }
    }
}

/** Werte aus einer Anfrage `{ "print.limit": 8, … }` prüfen; unbekannte Pfade werden abgelehnt */
export function validateSettingValues(values: unknown): Map<SettingDefinition, ConfigValue> {
    if (!isTree(values) || Object.keys(values).length === 0) {
        throw new InvalidSettingError('', 'Keine Einstellungen angegeben');
    }
    const result = new Map<SettingDefinition, ConfigValue>();
    for (const [path, value] of Object.entries(values)) {
        const setting = findSetting(path);
        if (!setting) {
            throw new InvalidSettingError(path, `Einstellung ${path} gibt es nicht`);
        }
        result.set(setting, validateSetting(setting, value));
    }
    return result;
}

/** Für die Oberfläche: Definitionen ohne RegExp (JSON-tauglich) */
export function describeSettings(): SettingDescription[] {
    return SETTINGS.map((setting) => {
        const { pattern: _pattern, ...rest } = setting as SettingDefinition & { pattern?: RegExp };
        return { ...rest, role: requiredRole(setting) } as SettingDescription;
    });
}
