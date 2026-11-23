import { isKiosk } from './session';

describe('Kiosk-Erkennung', () => {
    it('Browser der Box (localhost) oder über die Geste (?kiosk=1)', () => {
        expect(isKiosk({ hostname: 'localhost', search: '' })).toBe(true);
        expect(isKiosk({ hostname: '127.0.0.1', search: '' })).toBe(true);
        expect(isKiosk({ hostname: '192.168.8.20', search: '?kiosk=1' })).toBe(true);
    });

    it('Handy oder Laptop über die Adresse der Box', () => {
        expect(isKiosk({ hostname: '192.168.8.20', search: '' })).toBe(false);
        expect(isKiosk({ hostname: 'fotobox.local', search: '?kiosk=0' })).toBe(false);
    });
});
