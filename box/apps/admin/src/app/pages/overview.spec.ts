import { diskLevel } from './overview';

describe('Speicherplatz', () => {
    it('warnt rechtzeitig und meldet Fehler, bevor Fotos verloren gehen', () => {
        const gb = 1e9;
        expect(diskLevel({ freeBytes: 100 * gb, totalBytes: 250 * gb })).toBe('ok');
        expect(diskLevel({ freeBytes: 25 * gb, totalBytes: 250 * gb })).toBe('warn');
        expect(diskLevel({ freeBytes: 1.5 * gb, totalBytes: 250 * gb })).toBe('error');
        expect(diskLevel(null)).toBe('warn');
    });
});
