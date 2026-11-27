import { safeReturnPath } from './login';

describe('Rücksprung nach der Anmeldung', () => {
    it('nur Pfade dieser Box', () => {
        expect(safeReturnPath('/admin/druck')).toBe('/admin/druck');
        expect(safeReturnPath('/gallery/')).toBe('/gallery/');
        expect(safeReturnPath('/test/photo.php?x=1')).toBe('/test/photo.php?x=1');
    });

    it('keine fremden Adressen', () => {
        for (const bad of ['https://böse.example', '//böse.example', '/\\böse.example', 'javascript:alert(1)', '/a\nb', undefined, '']) {
            expect(safeReturnPath(bad)).toBeNull();
        }
    });
});
