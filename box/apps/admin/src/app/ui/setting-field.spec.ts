import { TestBed } from '@angular/core/testing';
import { describeSettings, type SettingDescription } from '@snaphora/contracts';
import { SettingField } from './setting-field';

const definition = (path: string) => describeSettings().find((d) => d.path === path) as SettingDescription;

async function render(path: string, inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(SettingField);
    fixture.componentRef.setInput('definition', definition(path));
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('SettingField', () => {
    it('Zahl mit Grenzen und Einheit aus dem Katalog, Beschriftung mit dem Feld verbunden', async () => {
        const { root } = await render('picture.cntdwn_time', { value: 5, state: { value: 5, source: 'default', eventManaged: false } });
        const input = root.querySelector('input[type="number"]') as HTMLInputElement;
        expect(input.min).toBe('0');
        expect(input.max).toBe('10');
        expect(root.querySelector(`label[for="${input.id}"]`)?.textContent).toContain('Countdown Einzelfoto');
        expect(root.textContent).toContain('Standard');
    });

    it('vom Event vorgegeben: Hinweis, dass eine Änderung nur für dieses Event gilt', async () => {
        const { root } = await render('print.limit', { value: 200, state: { value: 200, source: 'event', eventManaged: true } });
        expect(root.textContent).toContain('vom Event vorgegeben');
        expect(root.textContent).toContain('nur für dieses Event');
    });

    it('Ja/Nein als Kontrollkästchen; Änderung wird gemeldet', async () => {
        const { fixture, root } = await render('print.auto', { value: false });
        const changes: unknown[] = [];
        fixture.componentInstance.changed.subscribe((value) => changes.push(value));
        const box = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
        box.click();
        expect(changes).toEqual([true]);
    });

    it('Fehler steht am Feld und ist mit ihm verknüpft', async () => {
        const { root } = await render('picture.cntdwn_time', { value: 99, error: 'Countdown Einzelfoto: muss zwischen 0 und 10 liegen' });
        const input = root.querySelector('input') as HTMLInputElement;
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(root.querySelector(`#${CSS.escape(input.getAttribute('aria-describedby') ?? '')}`)?.textContent).toContain('zwischen 0 und 10');
    });

    it('nur lesen, wenn die Rolle nicht reicht', async () => {
        const { root } = await render('print.auto', { value: false, readonly: true });
        expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    });
});

describe('SettingField – Gestaltung und Geräte', () => {
    it('Taste anlernen: der nächste Tastendruck wird übernommen, Escape bricht ab', async () => {
        const { fixture, root } = await render('picture.key', { value: '' });
        const changes: unknown[] = [];
        fixture.componentInstance.changed.subscribe((value) => changes.push(value));
        const learn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Taste anlernen')) as HTMLButtonElement;
        learn.click();
        fixture.detectChanges();
        expect(learn.getAttribute('aria-pressed')).toBe('true');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', keyCode: 34 } as KeyboardEventInit));
        expect(changes).toEqual(['34']);
        learn.click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 } as KeyboardEventInit));
        expect(changes).toEqual(['34']);
    });

    it('Rahmen als Auswahl mit Vorschau, „Standard“ immer dabei, Rahmen vom Server bleibt sichtbar', async () => {
        const media = [{ name: 'hochzeit.png', path: 'private/images/frames/hochzeit.png', size: 1, modified: '', usedBy: [] }];
        const { root } = await render('picture.frame', { value: `private/snaphora/assets/${'a'.repeat(64)}.png`, media });
        const options = [...root.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
        expect(options.map((o) => o.value)).toEqual(['', 'private/images/frames/hochzeit.png', `private/snaphora/assets/${'a'.repeat(64)}.png`]);
        expect(options[2]?.checked).toBe(true);
        expect(root.querySelector('legend')?.textContent).toContain('Rahmen Einzelfoto');
        expect((root.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('/private/images/frames/hochzeit.png');
    });

    it('Layout-Vorschau nur als Bild (kein HTML aus der Antwort im Dokument)', async () => {
        const layouts = [{ id: '2+2-2', label: '2+2', preview: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }];
        const { root } = await render('collage.layout', { value: '2+2-2', layouts });
        expect(root.querySelector('script')).toBeNull();
        expect((root.querySelector('img') as HTMLImageElement).src.startsWith('data:image/svg+xml')).toBe(true);
    });
});
