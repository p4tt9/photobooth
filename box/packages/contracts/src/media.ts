// Bilder und Schriften der Box (Gestaltung): Rahmen, Hintergründe, Logos, Schriften.
//
// Hochgeladen wird über app in die Ordner unter private/ (Volume `private`). Einstellungen verweisen mit einem
// relativen Pfad darauf, z. B. `private/images/frames/hochzeit.png` – genau so, wie PHP und die Gäste-Oberfläche
// sie bis Paket 9 erwarten. Bilder vom Server legt der Agent unter private/snaphora/assets/ ab.

export const MEDIA_KINDS = {
    frame: {
        label: 'Rahmen',
        help: 'PNG mit transparenter Fläche, in der das Foto erscheint',
        uploadDir: 'private/images/frames',
        extensions: ['png'],
        maxBytes: 20 * 1024 * 1024,
    },
    background: {
        label: 'Hintergründe',
        help: 'JPG oder PNG für die Startseite',
        uploadDir: 'private/images/background',
        extensions: ['jpg', 'png'],
        maxBytes: 20 * 1024 * 1024,
    },
    logo: {
        label: 'Logos',
        help: 'PNG (mit Transparenz) oder JPG',
        uploadDir: 'private/images/logo',
        extensions: ['png', 'jpg'],
        maxBytes: 10 * 1024 * 1024,
    },
    font: {
        label: 'Schriften',
        help: 'TrueType (.ttf) oder OpenType (.otf)',
        uploadDir: 'private/fonts',
        extensions: ['ttf', 'otf'],
        maxBytes: 10 * 1024 * 1024,
    },
} as const;

export type MediaKind = keyof typeof MEDIA_KINDS;
export const isMediaKind = (value: unknown): value is MediaKind => typeof value === 'string' && Object.hasOwn(MEDIA_KINDS, value);

/** Größte Kantenlänge eines Bildes in Pixeln (größere Bilder bremsen die Bildpipeline unnötig) */
export const MAX_IMAGE_EDGE = 8000;

/** Dateiname in der Bibliothek: nur unbedenkliche Zeichen, Endung passend zur Art */
export const MEDIA_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Wo ein Verweis einer Einstellung hinzeigen darf (Bibliothek, Bilder vom Server, mitgelieferte Dateien) */
const ALLOWED_DIRECTORIES: Record<MediaKind, readonly string[]> = {
    frame: ['private/images/frames', 'private/snaphora/assets', 'resources/img/frames'],
    background: ['private/images/background', 'private/snaphora/assets', 'resources/img/background', 'resources/img'],
    logo: ['private/images/logo', 'private/snaphora/assets', 'resources/img/logo', 'resources/img'],
    font: ['private/fonts', 'private/snaphora/assets', 'resources/fonts', 'resources/fonts/dosis'],
};

const EXTENSIONS: Record<MediaKind, readonly string[]> = {
    frame: ['png'],
    background: ['jpg', 'jpeg', 'png'],
    logo: ['png', 'jpg', 'jpeg'],
    font: ['ttf', 'otf'],
};

/** Prüft einen Verweis wie `private/images/frames/a.png` – kein `..`, kein absoluter Pfad, keine fremde Adresse */
export function isMediaPath(kind: MediaKind, value: string): boolean {
    const slash = value.lastIndexOf('/');
    if (slash < 0) {
        return false;
    }
    const directory = value.slice(0, slash);
    const name = value.slice(slash + 1);
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    return ALLOWED_DIRECTORIES[kind].includes(directory) && MEDIA_FILE_NAME.test(name) && EXTENSIONS[kind].includes(extension);
}

export interface MediaItem {
    name: string;
    /** Verweis für Einstellungen und Adresse für die Vorschau (`/` + path) */
    path: string;
    size: number;
    modified: string;
    /** Einstellungen, die diese Datei verwenden (dann nicht löschbar) */
    usedBy: string[];
}

export type MediaLibrary = Record<MediaKind, MediaItem[]>;
