import { TestBed } from '@angular/core/testing';
import { describeSettings, SETTING_SECTIONS, type ConfigValue, type SettingsResponse } from '@snaphora/contracts';
import { Api } from '../core/api';
import { Session } from '../core/session';
import { Settings } from './settings';

function response(): SettingsResponse {
    const definitions = describeSettings();
    return {
        sections: SETTING_SECTIONS,
        definitions,
        values: Object.fromEntries(definitions.map((d) => [d.path, { value: d.default, source: 'default', eventManaged: false }])),
        event: null,
    };
}

async function setup(role: 'admin' | 'setup') {
    const saved: Array<Record<string, ConfigValue>> = [];
    TestBed.configureTestingModule({
        providers: [
            { provide: Api, useValue: { settings: async () => response(), saveSettings: async (values: Record<string, ConfigValue>) => (saved.push(values), { changes: Object.keys(values).map((path) => ({ path })), values: response().values }) } },
            { provide: Session, useValue: { allows: (required: string) => role === 'admin' || required === 'setup' } },
        ],
    });
    const fixture = TestBed.createComponent(Settings);
    fixture.componentRef.setInput('section', 'capture');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const field = (label: string) => [...root.querySelectorAll('sn-setting-field')].find((f) => f.textContent?.includes(label))?.querySelector('input') as HTMLInputElement;
    const type = async (input: HTMLInputElement, value: string) => {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await fixture.whenStable();
    };
    const save = async () => {
        (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
        await fixture.whenStable();
        fixture.detectChanges();
    };
    return { fixture, root, field, type, save, saved };
}

describe('Einstellungen', () => {
    it('zeigt die Felder des Bereichs und speichert nur Geändertes', async () => {
        const { root, field, type, save, saved } = await setup('admin');
        expect(root.querySelector('h1')?.textContent).toBe('Aufnahme');
        await type(field('Countdown Einzelfoto'), '3');
        await save();
        expect(saved).toEqual([{ 'picture.cntdwn_time': 3 }]);
        expect(root.textContent).toContain('1 Einstellung gespeichert');
    });

    it('ungültiger Wert: nichts wird gesendet, Meldung steht am Feld', async () => {
        const { root, field, type, save, saved } = await setup('admin');
        await type(field('Countdown Einzelfoto'), '60');
        await save();
        expect(saved).toEqual([]);
        expect(root.textContent).toContain('muss zwischen 0 und 10 liegen');
    });

    it('Aufbau-Personal sieht Admin-Einstellungen nur zum Lesen', async () => {
        const { field } = await setup('setup');
        expect(field('Countdown Einzelfoto').disabled).toBe(true);
    });
});
