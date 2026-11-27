// Prüft die Konfiguration vom Server, bevor die Box irgendetwas davon übernimmt.
//
// Auch einem eigenen Server wird nicht blind vertraut: Kennungen landen in Dateipfaden (Archiv, Bilder),
// Texte auf dem Bildschirm, Adressen im QR-Code. Eine ungültige Konfiguration wird komplett abgelehnt –
// die Box bleibt dann bei der zuletzt guten (lieber alte Einstellungen als halbe).
// Die Regeln entsprechen contracts/device-api.yaml.

import { PIN_HASH_PATTERN, type StaffMember } from './access.js';
import type { Checklist } from './setup.js';
import type { AssetRef, DeviceConfig, DeviceSettings, EventProfile } from './device-api.js';

export class InvalidConfigError extends Error {}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const LAYOUT = /^[A-Za-z0-9+_-]{1,40}$/;
const LOOK = /^[A-Za-z0-9_-]{1,64}$/;
// Steuerzeichen außer Zeilenumbruch
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
    throw new InvalidConfigError(`Konfiguration ungültig: ${path} ${message}`);
}

function object(value: unknown, path: string): Json {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(path, 'muss ein Objekt sein');
    }
    return value as Json;
}

function optional<T>(value: Json, key: string, path: string, check: (v: unknown, p: string) => T): T | undefined {
    return value[key] === undefined ? undefined : check(value[key], `${path}.${key}`);
}

function string(value: unknown, path: string, maxLength = 200): string {
    if (typeof value !== 'string' || value.length > maxLength || CONTROL.test(value)) {
        fail(path, `muss Text (max. ${maxLength} Zeichen, ohne Steuerzeichen) sein`);
    }
    return value;
}

function matching(pattern: RegExp, description: string) {
    return (value: unknown, path: string): string => {
        if (typeof value !== 'string' || !pattern.test(value)) {
            fail(path, `muss ${description} sein`);
        }
        return value;
    };
}

function integer(min: number, max: number) {
    return (value: unknown, path: string): number => {
        if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
            fail(path, `muss eine ganze Zahl von ${min} bis ${max} sein`);
        }
        return value as number;
    };
}

function boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') {
        fail(path, 'muss true oder false sein');
    }
    return value;
}

function date(value: unknown, path: string): string {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        fail(path, 'muss ein Zeitpunkt (ISO 8601) sein');
    }
    return value;
}

function url(allowHttp: boolean) {
    return (value: unknown, path: string): string => {
        const text = string(value, path, 500);
        let parsed: URL;
        try {
            parsed = new URL(text);
        } catch {
            fail(path, 'muss eine Adresse sein');
        }
        if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
            fail(path, allowHttp ? 'muss mit http:// oder https:// beginnen' : 'muss mit https:// beginnen');
        }
        return text;
    };
}

function textLines(value: unknown, path: string): string[] {
    if (!Array.isArray(value) || value.length > 3) {
        fail(path, 'muss eine Liste mit höchstens 3 Zeilen sein');
    }
    return value.map((line, index) => string(line, `${path}[${index}]`));
}

function asset(value: unknown, path: string): AssetRef {
    const input = object(value, path);
    const contentType = input.contentType;
    if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'font/ttf') {
        fail(`${path}.contentType`, 'muss image/png, image/jpeg oder font/ttf sein');
    }
    return {
        sha256: matching(SHA256, 'eine SHA-256-Prüfsumme')(input.sha256, `${path}.sha256`),
        contentType,
        size: optional(input, 'size', path, integer(0, 50 * 1024 * 1024)),
        name: optional(input, 'name', path, string),
    };
}

/** Persönliche Zugänge; die scrypt-Parameter sind begrenzt, damit ein Hash die Box nicht lahmlegen kann */
function staff(value: unknown, path: string): StaffMember[] {
    if (!Array.isArray(value) || value.length > 50) {
        fail(path, 'muss eine Liste mit höchstens 50 Personen sein');
    }
    return value.map((entry, index) => {
        const p = `${path}[${index}]`;
        const input = object(entry, p);
        if (input.role !== 'admin' && input.role !== 'setup') {
            fail(`${p}.role`, 'muss admin oder setup sein');
        }
        const pinHash = matching(PIN_HASH_PATTERN, 'ein scrypt-Hash')(input.pinHash, `${p}.pinHash`);
        const [, n, r, parallel] = PIN_HASH_PATTERN.exec(pinHash) ?? [];
        const cost = Number(n);
        if ((cost & (cost - 1)) !== 0 || cost < 1024 || cost > 131072 || Number(r) < 1 || Number(r) > 16 || Number(parallel) < 1 || Number(parallel) > 4) {
            fail(`${p}.pinHash`, 'hat unzulässige scrypt-Parameter');
        }
        return {
            personId: matching(ID, 'eine Kennung')(input.personId, `${p}.personId`),
            name: string(input.name, `${p}.name`, 80),
            role: input.role,
            pinHash,
        };
    });
}

function checklist(value: unknown, path: string): Checklist {
    const input = object(value, path);
    if (!Array.isArray(input.items) || input.items.length > 50) {
        fail(`${path}.items`, 'muss eine Liste mit höchstens 50 Punkten sein');
    }
    const ids = new Set<string>();
    return {
        checklistId: matching(ID, 'eine Kennung')(input.checklistId, `${path}.checklistId`),
        version: integer(0, Number.MAX_SAFE_INTEGER)(input.version, `${path}.version`),
        name: string(input.name, `${path}.name`, 100),
        items: input.items.map((entry, index) => {
            const p = `${path}.items[${index}]`;
            const item = object(entry, p);
            const itemId = matching(ID, 'eine Kennung')(item.itemId, `${p}.itemId`);
            if (ids.has(itemId)) fail(`${p}.itemId`, 'kommt doppelt vor');
            ids.add(itemId);
            return { itemId, text: string(item.text, `${p}.text`, 200), required: boolean(item.required, `${p}.required`) };
        }),
    };
}

function device(value: unknown, path: string): DeviceSettings {
    const input = object(value, path);
    const result: DeviceSettings = {
        deviceId: matching(ID, 'eine Kennung')(input.deviceId, `${path}.deviceId`),
        version: integer(0, Number.MAX_SAFE_INTEGER)(input.version, `${path}.version`),
        name: optional(input, 'name', path, string),
        staff: optional(input, 'staff', path, staff),
    };
    if (input.ringlight !== undefined) {
        const ringlight = object(input.ringlight, `${path}.ringlight`);
        // Der ESP hängt im lokalen Netz und spricht nur HTTP
        result.ringlight = {
            enabled: optional(ringlight, 'enabled', `${path}.ringlight`, boolean),
            url: optional(ringlight, 'url', `${path}.ringlight`, url(true)),
        };
    }
    if (input.buzzer !== undefined) {
        const buzzer = object(input.buzzer, `${path}.buzzer`);
        const key = (v: unknown, p: string) => (v === null ? null : integer(1, 999)(v, p));
        result.buzzer = {
            photoKey: optional(buzzer, 'photoKey', `${path}.buzzer`, key),
            collageKey: optional(buzzer, 'collageKey', `${path}.buzzer`, key),
        };
    }
    return result;
}

function event(value: unknown, path: string, allowHttp: boolean): EventProfile {
    const input = object(value, path);
    const result: EventProfile = {
        eventId: matching(ID, 'eine Kennung')(input.eventId, `${path}.eventId`),
        version: integer(0, Number.MAX_SAFE_INTEGER)(input.version, `${path}.version`),
        name: optional(input, 'name', path, string),
        validFrom: date(input.validFrom, `${path}.validFrom`),
        validUntil: date(input.validUntil, `${path}.validUntil`),
        background: optional(input, 'background', path, asset),
        logo: optional(input, 'logo', path, asset),
        staff: optional(input, 'staff', path, staff),
        checklist: optional(input, 'checklist', path, checklist),
    };
    if (Date.parse(result.validUntil) <= Date.parse(result.validFrom)) {
        fail(`${path}.validUntil`, 'muss nach validFrom liegen');
    }
    if (input.startScreen !== undefined) {
        const startScreen = object(input.startScreen, `${path}.startScreen`);
        result.startScreen = {
            title: optional(startScreen, 'title', `${path}.startScreen`, (v, p) => string(v, p, 100)),
            subtitle: optional(startScreen, 'subtitle', `${path}.startScreen`, string),
        };
    }
    if (input.colors !== undefined) {
        const colors = object(input.colors, `${path}.colors`);
        const color = matching(COLOR, 'eine Farbe wie #1b3faa');
        result.colors = {
            primary: optional(colors, 'primary', `${path}.colors`, color),
            secondary: optional(colors, 'secondary', `${path}.colors`, color),
            highlight: optional(colors, 'highlight', `${path}.colors`, color),
            font: optional(colors, 'font', `${path}.colors`, color),
            countdownBackground: optional(colors, 'countdownBackground', `${path}.colors`, color),
        };
    }
    const countdown = integer(0, 10);
    if (input.photo !== undefined) {
        const photo = object(input.photo, `${path}.photo`);
        result.photo = {
            enabled: optional(photo, 'enabled', `${path}.photo`, boolean),
            countdown: optional(photo, 'countdown', `${path}.photo`, countdown),
            frame: optional(photo, 'frame', `${path}.photo`, asset),
            text: optional(photo, 'text', `${path}.photo`, textLines),
        };
    }
    if (input.collage !== undefined) {
        const collage = object(input.collage, `${path}.collage`);
        result.collage = {
            enabled: optional(collage, 'enabled', `${path}.collage`, boolean),
            layout: optional(collage, 'layout', `${path}.collage`, matching(LAYOUT, 'ein Layout-Name')),
            countdown: optional(collage, 'countdown', `${path}.collage`, countdown),
            frame: optional(collage, 'frame', `${path}.collage`, asset),
            text: optional(collage, 'text', `${path}.collage`, textLines),
        };
    }
    if (input.print !== undefined) {
        const print = object(input.print, `${path}.print`);
        result.print = {
            enabled: optional(print, 'enabled', `${path}.print`, boolean),
            quota: optional(print, 'quota', `${path}.print`, integer(0, 100_000)),
            frame: optional(print, 'frame', `${path}.print`, asset),
            text: optional(print, 'text', `${path}.print`, textLines),
            qrCode: optional(print, 'qrCode', `${path}.print`, boolean),
        };
    }
    if (input.gallery !== undefined) {
        const gallery = object(input.gallery, `${path}.gallery`);
        result.gallery = {
            enabled: boolean(gallery.enabled, `${path}.gallery.enabled`),
            photoUrlPrefix: optional(gallery, 'photoUrlPrefix', `${path}.gallery`, url(allowHttp)),
        };
    }
    if (input.look !== undefined) {
        result.look = input.look === null ? null : matching(LOOK, 'ein Look-Name')(input.look, `${path}.look`);
    }
    return result;
}

/**
 * Gibt eine geprüfte Kopie zurück, die nur bekannte Felder enthält.
 * @param allowHttp Galerie-Adressen ohne TLS erlauben (nur Entwicklung)
 */
const REGISTRATION_FIELDS = ['clientId', 'clientSecret'] as const;

/** Antwort der Registrierung prüfen, bevor Zugangsdaten gespeichert werden */
export function validateRegistration(value: unknown, allowHttp = false): { deviceId: string; name?: string; clientId: string; clientSecret: string; tokenUrl: string } {
    const input = object(value, 'Registrierung');
    for (const field of REGISTRATION_FIELDS) {
        string(input[field], `Registrierung.${field}`, 500);
    }
    return {
        deviceId: matching(ID, 'eine Kennung')(input.deviceId, 'Registrierung.deviceId'),
        name: optional(input, 'name', 'Registrierung', string),
        clientId: input.clientId as string,
        clientSecret: input.clientSecret as string,
        tokenUrl: url(allowHttp)(input.tokenUrl, 'Registrierung.tokenUrl'),
    };
}

export function validateDeviceConfig(value: unknown, allowHttp = false): DeviceConfig {
    const input = object(value, 'Konfiguration');
    return {
        device: device(input.device, 'device'),
        event: input.event === null || input.event === undefined ? null : event(input.event, 'event', allowHttp),
    };
}
