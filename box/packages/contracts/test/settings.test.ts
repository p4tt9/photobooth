import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSettings, findSetting, InvalidSettingError, SETTINGS, validateSetting, validateSettingValues } from '../src/index.js';

const setting = (path: string) => {
    const found = findSetting(path);
    assert.ok(found, path);
    return found;
};

test('Katalog: jeder Pfad nur einmal, Standardwert ist selbst gültig, keine Shell-Befehle', () => {
    assert.equal(new Set(SETTINGS.map((s) => s.path)).size, SETTINGS.length);
    for (const s of SETTINGS) {
        assert.deepEqual(validateSetting(s, s.default), s.default, s.path);
        assert.ok(!s.path.startsWith('commands.'), s.path);
    }
});

test('gültige Werte werden normalisiert übernommen', () => {
    assert.equal(validateSetting(setting('print.limit'), 400), 400);
    assert.equal(validateSetting(setting('picture.key'), 34), '34');
    assert.equal(validateSetting(setting('get_request.server'), 'http://192.168.8.50/'), 'http://192.168.8.50');
    assert.equal(validateSetting(setting('start_screen.title'), 'Anna & Ben\r\nHochzeit'), 'Anna & Ben\nHochzeit');
});

const invalid: Array<[string, unknown]> = [
    ['print.limit', -1],
    ['print.limit', 2.5],
    ['print.limit', '400'],
    ['picture.cntdwn_time', 60],
    ['print.auto', 'ja'],
    ['picture.key', 'Enter'],
    ['collage.layout', '../../x'],
    ['custom.btn_text', 'a'.repeat(31)],
    ['custom.btn_text', 'Zeile\nzwei'],
    ['start_screen.title', 'a\u0000b'],
    ['get_request.server', 'javascript:alert(1)'],
    ['get_request.server', 'http://nutzer:geheim@esp'],
];

for (const [path, value] of invalid) {
    test(`abgelehnt: ${path} = ${JSON.stringify(value)}`, () => {
        assert.throws(() => validateSetting(setting(path), value), InvalidSettingError);
    });
}

test('unbekannte Einstellungen und leere Anfragen werden abgelehnt', () => {
    assert.throws(() => validateSettingValues({ 'commands.print': 'lp' }), /gibt es nicht/);
    assert.throws(() => validateSettingValues({}), InvalidSettingError);
    assert.throws(() => validateSettingValues([1]), InvalidSettingError);
});

test('Beschreibung für die Oberfläche ist JSON-tauglich und nennt die Rolle', () => {
    const described = describeSettings();
    assert.equal(JSON.parse(JSON.stringify(described)).length, SETTINGS.length);
    assert.equal(described.find((s) => s.path === 'print.limit')?.role, 'setup');
    assert.equal(described.find((s) => s.path === 'print.auto')?.role, 'admin');
});
