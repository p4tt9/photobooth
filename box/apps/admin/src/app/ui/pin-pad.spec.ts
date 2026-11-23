import { TestBed } from '@angular/core/testing';
import { PinPad } from './pin-pad';

function setup() {
    const fixture = TestBed.createComponent(PinPad);
    const entered: string[] = [];
    fixture.componentInstance.entered.subscribe((pin) => entered.push(pin));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const key = (name: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name) as HTMLButtonElement;
    const input = root.querySelector('input') as HTMLInputElement;
    const tap = async (name: string) => {
        key(name).click();
        fixture.detectChanges();
        await fixture.whenStable();
    };
    return { fixture, entered, key, input, tap };
}

describe('PinPad', () => {
    it('Ziffern tippen, letzte löschen, anmelden – danach ist das Feld leer', async () => {
        const { entered, input, tap } = setup();
        for (const digit of ['2', '4', '6', '8', '1']) await tap(digit);
        await tap('Letzte Ziffer löschen');
        expect(input.value).toBe('2468');
        await tap('Anmelden');
        expect(entered).toEqual(['2468']);
        expect(input.value).toBe('');
    });

    it('Anmelden erst ab 4 Ziffern, höchstens 12', async () => {
        const { entered, key, input, tap } = setup();
        for (const digit of ['1', '2', '3']) await tap(digit);
        expect(key('Anmelden').disabled).toBe(true);
        for (let i = 0; i < 15; i++) await tap('9');
        expect(input.value.length).toBe(12);
        expect(entered).toEqual([]);
    });

    it('Tastatur: nur Ziffern werden übernommen', async () => {
        const { fixture, input } = setup();
        input.value = '12ab34';
        input.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await fixture.whenStable();
        expect(input.value).toBe('1234');
    });

    it('Meldung wird als Alarm angesagt', async () => {
        const { fixture } = setup();
        fixture.componentRef.setInput('message', 'PIN falsch');
        fixture.detectChanges();
        await fixture.whenStable();
        const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
        expect(alert?.textContent).toContain('PIN falsch');
    });
});
