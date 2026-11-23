// Übersetzt Geräte-Einstellungen und Event-Profil (Vertrag) in Einstellungen der App.
// Der Vertrag beschreibt fachlich, was eine Feier braucht; welche Schlüssel die App dafür hat, steht nur hier.
// Kommt später die neue Oberfläche (Paket 9), ändert sich diese Datei – der Vertrag mit dem Backend nicht.
//
// Nur Felder, die der Server setzt, werden übernommen. Alles andere bleibt, wie es an der Box eingestellt ist.

import type { AssetRef, DeviceSettings, EventProfile } from '@snaphora/contracts';

export type AppConfig = Record<string, Record<string, unknown>>;

/** Pfad eines geladenen Bildes, wie die App ihn erwartet (relativ zum App-Verzeichnis) */
export function assetAppPath(asset: AssetRef): string {
    return `private/snaphora/assets/${assetFileName(asset)}`;
}

export function assetFileName(asset: AssetRef): string {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'font/ttf': 'ttf' }[asset.contentType] ?? 'bin';
    return `${asset.sha256}.${extension}`;
}

function set(config: AppConfig, section: string, key: string, value: unknown): void {
    if (value === undefined) {
        return;
    }
    (config[section] ??= {})[key] = value;
}

function setText(config: AppConfig, section: string, lines: string[] | undefined): void {
    if (lines === undefined) {
        return;
    }
    set(config, section, 'enabled', lines.some((line) => line.trim() !== ''));
    for (let index = 0; index < 3; index++) {
        set(config, section, `line${index + 1}`, lines[index] ?? '');
    }
}

export function mapDevice(device: DeviceSettings): AppConfig {
    const config: AppConfig = {};
    if (device.ringlight) {
        set(config, 'get_request', 'countdown', device.ringlight.enabled);
        set(config, 'get_request', 'server', device.ringlight.url);
    }
    if (device.buzzer) {
        // Die App speichert die Taste als Text ('' = keine)
        const key = (value: number | null | undefined) => (value === undefined ? undefined : value === null ? '' : String(value));
        set(config, 'picture', 'key', key(device.buzzer.photoKey));
        set(config, 'collage', 'key', key(device.buzzer.collageKey));
    }
    return config;
}

export function mapEvent(event: EventProfile): AppConfig {
    const config: AppConfig = {};

    if (event.startScreen) {
        const { title, subtitle } = event.startScreen;
        set(config, 'start_screen', 'title', title);
        set(config, 'start_screen', 'title_visible', title === undefined ? undefined : title.trim() !== '');
        set(config, 'start_screen', 'subtitle', subtitle);
        set(config, 'start_screen', 'subtitle_visible', subtitle === undefined ? undefined : subtitle.trim() !== '');
    }

    if (event.colors) {
        set(config, 'colors', 'primary', event.colors.primary);
        set(config, 'colors', 'secondary', event.colors.secondary);
        set(config, 'colors', 'highlight', event.colors.highlight);
        set(config, 'colors', 'font', event.colors.font);
        set(config, 'colors', 'background_countdown', event.colors.countdownBackground);
    }

    if (event.background) {
        set(config, 'background', 'type', 'image');
        set(config, 'background', 'defaults', assetAppPath(event.background));
    }
    if (event.logo) {
        set(config, 'logo', 'enabled', true);
        set(config, 'logo', 'path', assetAppPath(event.logo));
    }

    if (event.photo) {
        set(config, 'picture', 'enabled', event.photo.enabled);
        set(config, 'picture', 'cntdwn_time', event.photo.countdown);
        if (event.photo.frame) {
            set(config, 'picture', 'take_frame', true);
            set(config, 'picture', 'frame', assetAppPath(event.photo.frame));
        }
        setText(config, 'textonpicture', event.photo.text);
    }

    if (event.collage) {
        set(config, 'collage', 'enabled', event.collage.enabled);
        set(config, 'collage', 'layout', event.collage.layout);
        set(config, 'collage', 'cntdwn_time', event.collage.countdown);
        if (event.collage.frame) {
            set(config, 'collage', 'take_frame', 'once');
            set(config, 'collage', 'frame', assetAppPath(event.collage.frame));
        }
        setText(config, 'textoncollage', event.collage.text);
    }

    if (event.print) {
        set(config, 'print', 'from_result', event.print.enabled);
        set(config, 'print', 'from_gallery', event.print.enabled);
        set(config, 'print', 'limit', event.print.quota);
        set(config, 'print', 'qrcode', event.print.qrCode);
        if (event.print.frame) {
            set(config, 'print', 'print_frame', true);
            set(config, 'print', 'frame', assetAppPath(event.print.frame));
        }
        setText(config, 'textonprint', event.print.text);
    }

    if (event.gallery) {
        // Gäste erreichen das lokale Netz der Box nicht (E4): Ein QR-Code ergibt nur mit Online-Galerie Sinn.
        const online = event.gallery.enabled && Boolean(event.gallery.photoUrlPrefix);
        set(config, 'qr', 'enabled', online);
        if (online) {
            set(config, 'qr', 'url', event.gallery.photoUrlPrefix);
            set(config, 'qr', 'append_filename', true);
        }
    }

    if (event.look !== undefined) {
        set(config, 'render', 'look', event.look ?? '');
    }

    return config;
}

/** Alle Bilder, die ein Profil braucht */
export function eventAssets(event: EventProfile | null): AssetRef[] {
    if (!event) {
        return [];
    }
    const assets = [event.background, event.logo, event.photo?.frame, event.collage?.frame, event.print?.frame];
    return assets.filter((asset): asset is AssetRef => asset !== undefined);
}
