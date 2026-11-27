import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidConfigError, validateDeviceConfig } from '../src/index.js';

const sha = 'a'.repeat(64);

function config(event: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        device: { deviceId: 'box-1', version: 1 },
        event: {
            eventId: 'evt-1',
            version: 1,
            validFrom: '2026-11-21T10:00:00Z',
            validUntil: '2026-11-22T10:00:00Z',
            ...event,
        },
    };
}

test('gültige Konfiguration wird übernommen, unbekannte Felder fallen weg', () => {
    const result = validateDeviceConfig({ ...config({ startScreen: { title: 'Anna & Ben' }, extra: 'x' }), more: 1 });
    assert.equal(result.event?.startScreen?.title, 'Anna & Ben');
    assert.equal((result.event as unknown as Record<string, unknown>).extra, undefined);
    assert.equal(validateDeviceConfig({ device: { deviceId: 'box-1', version: 1 }, event: null }).event, null);
});

const invalid: Array<[string, Record<string, unknown>]> = [
    ['Event-Kennung als Pfad', config({ eventId: '../../etc' })],
    ['Prüfsumme als Pfad', config({ background: { sha256: '../x', contentType: 'image/png' } })],
    ['unbekannter Dateityp', config({ logo: { sha256: sha, contentType: 'text/html' } })],
    ['Galerie ohne TLS', config({ gallery: { enabled: true, photoUrlPrefix: 'http://snaphora.de/g/' } })],
    ['Galerie als Skript-Adresse', config({ gallery: { enabled: true, photoUrlPrefix: 'javascript:alert(1)' } })],
    ['Farbe mit CSS', config({ colors: { primary: 'red;}body{display:none' } })],
    ['Layout-Name als Pfad', config({ collage: { layout: '../../private/x' } })],
    ['Countdown zu lang', config({ photo: { countdown: 600 } })],
    ['Kontingent negativ', config({ print: { quota: -1 } })],
    ['zu viele Textzeilen', config({ print: { text: ['1', '2', '3', '4'] } })],
    ['Steuerzeichen im Titel', config({ startScreen: { title: 'a\u0000b' } })],
    ['Zeitfenster verkehrt', config({ validUntil: '2026-11-20T10:00:00Z' })],
    ['Zeitpunkt kaputt', config({ validFrom: 'morgen' })],
    ['Gerät ohne Kennung', { device: { version: 1 }, event: null }],
];

for (const [name, value] of invalid) {
    test(`abgelehnt: ${name}`, () => {
        assert.throws(() => validateDeviceConfig(value), InvalidConfigError);
    });
}

test('Galerie über http nur, wenn ausdrücklich erlaubt (Entwicklung)', () => {
    const value = config({ gallery: { enabled: true, photoUrlPrefix: 'http://localhost:8082/g/' } });
    assert.equal(validateDeviceConfig(value, true).event?.gallery?.photoUrlPrefix, 'http://localhost:8082/g/');
});

const hash = `scrypt$16384$8$1$${'A'.repeat(22)}==$${'B'.repeat(43)}=`;

test('Zugänge vom Server werden geprüft übernommen', () => {
    const result = validateDeviceConfig({ device: { deviceId: 'box-1', version: 1, staff: [{ personId: 'p-1', name: 'Patrick', role: 'admin', pinHash: hash, extra: 1 }] }, event: null });
    assert.deepEqual(result.device.staff, [{ personId: 'p-1', name: 'Patrick', role: 'admin', pinHash: hash }]);
});

const badStaff: Array<[string, unknown]> = [
    ['Klartext-PIN statt Hash', { personId: 'p', name: 'X', role: 'admin', pinHash: '1234' }],
    ['unbekannte Rolle', { personId: 'p', name: 'X', role: 'root', pinHash: hash }],
    ['zu teurer Hash (lähmt die Box)', { personId: 'p', name: 'X', role: 'admin', pinHash: hash.replace('16384', '4194304') }],
    ['Kennung als Pfad', { personId: '../x', name: 'X', role: 'admin', pinHash: hash }],
];

for (const [name, entry] of badStaff) {
    test(`Zugang abgelehnt: ${name}`, () => {
        assert.throws(() => validateDeviceConfig({ device: { deviceId: 'box-1', version: 1, staff: [entry] }, event: null }), InvalidConfigError);
    });
}

test('Checkliste vom Server wird geprüft übernommen', () => {
    const value = config({ checklist: { checklistId: 'cl-1', version: 2, name: 'Aufbau Hochzeit', items: [{ itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true }], extra: 1 } });
    assert.deepEqual(validateDeviceConfig(value).event?.checklist, { checklistId: 'cl-1', version: 2, name: 'Aufbau Hochzeit', items: [{ itemId: 'requisiten', text: 'Requisiten aufgestellt', required: true }] });
});

for (const [name, checklist] of [
    ['doppelte Punkte', { checklistId: 'cl', version: 1, name: 'x', items: [{ itemId: 'a', text: 'a', required: true }, { itemId: 'a', text: 'b', required: false }] }],
    ['Steuerzeichen im Text', { checklistId: 'cl', version: 1, name: 'x', items: [{ itemId: 'a', text: 'a\u0000', required: true }] }],
    ['Pflicht nicht ja/nein', { checklistId: 'cl', version: 1, name: 'x', items: [{ itemId: 'a', text: 'a', required: 'ja' }] }],
    ['zu viele Punkte', { checklistId: 'cl', version: 1, name: 'x', items: Array.from({ length: 51 }, (_, i) => ({ itemId: `p${i}`, text: 't', required: false })) }],
] as const) {
    test(`Checkliste abgelehnt: ${name}`, () => {
        assert.throws(() => validateDeviceConfig(config({ checklist })), InvalidConfigError);
    });
}
