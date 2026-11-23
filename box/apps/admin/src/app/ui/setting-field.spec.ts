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
