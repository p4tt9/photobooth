// Einstellungskatalog: jede Einstellung, die man an der Box ändern kann (planning/ARCHITEKTUR.md).
//
// Was hier nicht steht, ist an der Box nicht einstellbar. Aus dem Katalog entstehen die Prüfung beim Speichern
// (app), die Formulare der Admin-Oberfläche und die Doku. Standardwerte müssen mit dem PHP-Schema übereinstimmen,
// solange es existiert (tests/Unit/Service/SettingsCatalogueTest.php prüft das).

import type { SettingDescription } from './admin-api.js';
import { isTree, type ConfigValue } from './layers.js';
import { isMediaPath, type MediaKind } from './media.js';

export type Role = 'setup' | 'admin';

/** Rechte: Admin darf alles, Aufbau nur, was ausdrücklich für den Aufbau freigegeben ist */
export const ROLE_RANK: Record<Role, number> = { setup: 1, admin: 2 };
export const roleAllows = (role: Role, required: Role): boolean => ROLE_RANK[role] >= ROLE_RANK[required];

export const SETTING_SECTIONS = {
    print: 'Druck',
    capture: 'Aufnahme',
    design: 'Gestaltung',
    devices: 'Geräte',
    gallery: 'Galerie',
    general: 'Allgemein',
} as const;
export type SettingSection = keyof typeof SETTING_SECTIONS;

interface BaseSetting {
    /** Pfad in der Konfiguration, z. B. `print.limit` */
    path: string;
    section: SettingSection;
    label: string;
    help?: string;
    /** Zwischenüberschrift innerhalb des Bereichs (z. B. „Text auf dem Foto“) */
    group?: string;
    /** Wer die Einstellung ändern darf (Standard: admin) */
    role?: Role;
}

export type SettingDefinition = BaseSetting &
    (
        | { type: 'boolean'; default: boolean }
        | { type: 'integer'; default: number; min: number; max: number; unit?: string }
        | { type: 'text'; default: string; maxLength: number; pattern?: RegExp; multiline?: boolean }
        | { type: 'choice'; default: string; options: Readonly<Record<string, string>> }
        /** Taste als JavaScript-keyCode (Buzzer, Presenter); leer = keine Taste */
        | { type: 'key'; default: string }
        /** Adresse im lokalen Netz (z. B. Ringlicht); leer = aus */
        | { type: 'url'; default: string; schemes: readonly string[] }
        /** Farbe #rrggbb */
        | { type: 'color'; default: string }
        /** Datei aus der Bibliothek (Rahmen, Hintergrund, Logo, Schrift); leer = Standard */
        | { type: 'media'; default: string; kind: MediaKind }
        /** Look (Bearbeitungs-Preset) der Bildpipeline; leer = ohne Look. Ob es ihn gibt, prüft app beim Speichern. */
        | { type: 'look'; default: string }
        /** Collage- oder Streifen-Layout */
        | { type: 'layout'; default: string }
    );

const LAYOUT = /^[A-Za-z0-9+_-]{1,40}$/;
const LOOK = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Text auf Foto, Collage oder Druck: dieselben Einstellungen, nur andere Standardwerte */
function textSettings(
    prefix: 'textonpicture' | 'textoncollage' | 'textonprint',
    group: string,
    defaults: { enabled: boolean; lines: [string, string, string]; color: string; size: number; x: number; y: number; rotation: number; linespace: number },
): SettingDefinition[] {
    return [
        { path: `${prefix}.enabled`, section: 'design', group, type: 'boolean', default: defaults.enabled, label: 'Text anzeigen' },
        ...defaults.lines.map((line, index): SettingDefinition => ({ path: `${prefix}.line${index + 1}`, section: 'design', group, type: 'text', default: line, maxLength: 80, label: `Zeile ${index + 1}` })),
        { path: `${prefix}.font`, section: 'design', group, type: 'media', kind: 'font', default: '', label: 'Schrift' },
        { path: `${prefix}.font_color`, section: 'design', group, type: 'color', default: defaults.color, label: 'Schriftfarbe' },
        { path: `${prefix}.font_size`, section: 'design', group, type: 'integer', default: defaults.size, min: 10, max: 400, unit: 'px', label: 'Schriftgröße' },
        { path: `${prefix}.locationx`, section: 'design', group, type: 'integer', default: defaults.x, min: 0, max: 10000, unit: 'px', label: 'Position von links' },
        { path: `${prefix}.locationy`, section: 'design', group, type: 'integer', default: defaults.y, min: 0, max: 10000, unit: 'px', label: 'Position von oben' },
        { path: `${prefix}.rotation`, section: 'design', group, type: 'integer', default: defaults.rotation, min: -359, max: 359, unit: '°', label: 'Drehung' },
        { path: `${prefix}.linespace`, section: 'design', group, type: 'integer', default: defaults.linespace, min: 0, max: 1000, unit: 'px', label: 'Zeilenabstand' },
    ];
}

const color = (path: string, section: SettingSection, group: string, label: string, value: string): SettingDefinition => ({ path, section, group, type: 'color', default: value, label });

/** Positionen am Bildschirm (Werte so, wie die Gäste-Oberfläche sie als CSS-Klassen erwartet) */
const SIDE_POSITIONS = {
    hidden: 'nicht anzeigen',
    'left left--top': 'links oben',
    'left left--center': 'links Mitte',
    'left left--bottom': 'links unten',
    'right right--top': 'rechts oben',
    'right right--center': 'rechts Mitte',
    'right right--bottom': 'rechts unten',
} as const;

export const SETTINGS: readonly SettingDefinition[] = [
    // Druck
    { path: 'print.limit', section: 'print', group: 'Druck', type: 'integer', default: 0, min: 0, max: 100000, role: 'setup', label: 'Druckkontingent', help: 'Wie viele Drucke dieses Event insgesamt darf. 0 = unbegrenzt.' },
    { path: 'print.from_result', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'Drucken direkt nach der Aufnahme' },
    { path: 'print.from_gallery', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'Drucken aus der Galerie' },
    { path: 'print.auto', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'Jedes Foto automatisch drucken' },
    { path: 'print.auto_delay', section: 'print', group: 'Druck', type: 'integer', default: 1000, min: 250, max: 10000, unit: 'ms', label: 'Automatischer Druck nach' },
    { path: 'print.max_multi', section: 'print', group: 'Druck', type: 'integer', default: 1, min: 1, max: 10, label: 'Kopien pro Druck höchstens' },
    { path: 'print.qrcode', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'QR-Code auf den Druck' },
    { path: 'print.print_frame', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'Eigenen Druckrahmen verwenden' },
    { path: 'print.no_rotate', section: 'print', group: 'Druck', type: 'boolean', default: false, label: 'Hochformat nicht drehen' },
    { path: 'print.key', section: 'print', group: 'Druck', type: 'key', default: '', label: 'Taste zum Drucken' },
    { path: 'print.crop', section: 'print', group: 'Zuschneiden', type: 'boolean', default: false, label: 'Vor dem Druck zuschneiden' },
    { path: 'print.crop_width', section: 'print', group: 'Zuschneiden', type: 'integer', default: 1000, min: 1, max: 10000, unit: 'px', label: 'Breite' },
    { path: 'print.crop_height', section: 'print', group: 'Zuschneiden', type: 'integer', default: 500, min: 1, max: 10000, unit: 'px', label: 'Höhe' },
    { path: 'print.time', section: 'print', group: 'Hinweise am Bildschirm', type: 'integer', default: 5000, min: 500, max: 60000, unit: 'ms', label: 'Hinweis „wird gedruckt“ anzeigen für' },
    { path: 'print.locking_msg', section: 'print', group: 'Hinweise am Bildschirm', type: 'text', default: 'Printing... Print limit reached, print will be locked.', maxLength: 200, label: 'Text beim letzten Druck im Kontingent' },
    { path: 'print.limit_msg', section: 'print', group: 'Hinweise am Bildschirm', type: 'text', default: 'Print locked.', maxLength: 200, label: 'Text, wenn das Kontingent erreicht ist' },

    // Aufnahme
    { path: 'picture.enabled', section: 'capture', group: 'Einzelfoto', type: 'boolean', default: true, label: 'Einzelfoto anbieten' },
    { path: 'picture.cntdwn_time', section: 'capture', group: 'Einzelfoto', type: 'integer', default: 5, min: 0, max: 10, unit: 's', label: 'Countdown Einzelfoto' },
    { path: 'picture.key', section: 'capture', group: 'Einzelfoto', type: 'key', default: '', label: 'Buzzer-Taste Einzelfoto' },
    { path: 'picture.allow_delete', section: 'capture', group: 'Einzelfoto', type: 'boolean', default: true, label: 'Gäste dürfen ihr Foto direkt nach der Aufnahme löschen' },
    { path: 'collage.enabled', section: 'capture', group: 'Collage und Fotostreifen', type: 'boolean', default: true, label: 'Collage anbieten' },
    { path: 'collage.cntdwn_time', section: 'capture', group: 'Collage und Fotostreifen', type: 'integer', default: 3, min: 0, max: 10, unit: 's', label: 'Countdown Collage' },
    { path: 'collage.key', section: 'capture', group: 'Collage und Fotostreifen', type: 'key', default: '', label: 'Buzzer-Taste Collage' },
    { path: 'collage.layout', section: 'capture', group: 'Collage und Fotostreifen', type: 'layout', default: '2+2-2', label: 'Collage-Layout' },
    { path: 'collage.allow_selection', section: 'capture', group: 'Collage und Fotostreifen', type: 'boolean', default: false, label: 'Gäste wählen das Layout selbst' },
    { path: 'collage.continuous', section: 'capture', group: 'Collage und Fotostreifen', type: 'boolean', default: true, label: 'Automatisch zum nächsten Foto' },
    { path: 'collage.continuous_time', section: 'capture', group: 'Collage und Fotostreifen', type: 'integer', default: 5, min: 0, max: 20, unit: 's', label: 'Pause zwischen den Fotos' },
    { path: 'collage.orientation', section: 'capture', group: 'Collage und Fotostreifen', type: 'choice', default: 'landscape', options: { landscape: 'Querformat', portrait: 'Hochformat' }, label: 'Ausrichtung' },
    { path: 'collage.placeholder', section: 'capture', group: 'Collage und Fotostreifen', type: 'boolean', default: false, label: 'Ein Platz mit festem Bild (Platzhalter)' },
    { path: 'collage.placeholderposition', section: 'capture', group: 'Collage und Fotostreifen', type: 'integer', default: 1, min: 1, max: 10, label: 'Platz des Platzhalters' },
    { path: 'collage.placeholderpath', section: 'capture', group: 'Collage und Fotostreifen', type: 'media', kind: 'background', default: '', label: 'Platzhalter-Bild' },
    { path: 'picture.polaroid_effect', section: 'capture', group: 'Polaroid-Effekt', type: 'boolean', default: false, label: 'Einzelfoto als Polaroid' },
    { path: 'picture.polaroid_rotation', section: 'capture', group: 'Polaroid-Effekt', type: 'integer', default: 0, min: -359, max: 359, unit: '°', label: 'Drehung Einzelfoto' },
    { path: 'collage.polaroid_effect', section: 'capture', group: 'Polaroid-Effekt', type: 'boolean', default: false, label: 'Collage-Fotos als Polaroid' },
    { path: 'collage.polaroid_rotation', section: 'capture', group: 'Polaroid-Effekt', type: 'integer', default: 0, min: -359, max: 359, unit: '°', label: 'Drehung Collage-Fotos' },
    {
        path: 'preview.mode',
        section: 'capture',
        group: 'Live-Vorschau',
        type: 'choice',
        default: 'none',
        options: { none: 'aus', url: 'Kamera-Livebild (Adresse)', device_cam: 'Kamera des Geräts (Webcam)' },
        label: 'Live-Vorschau beim Countdown',
    },
    { path: 'preview.url', section: 'capture', group: 'Live-Vorschau', type: 'url', default: '', schemes: ['http:', 'https:'], label: 'Adresse des Livebilds' },
    { path: 'preview.url_delay', section: 'capture', group: 'Live-Vorschau', type: 'integer', default: 1000, min: 0, max: 30000, unit: 'ms', label: 'Livebild verzögert starten' },
    { path: 'preview.camera_mode', section: 'capture', group: 'Live-Vorschau', type: 'choice', default: 'user', options: { user: 'Frontkamera', environment: 'Rückkamera' }, label: 'Kamera des Geräts' },
    { path: 'preview.style', section: 'capture', group: 'Live-Vorschau', type: 'choice', default: 'scale-down', options: { 'scale-down': 'verkleinern, wenn nötig', contain: 'ganz zeigen', cover: 'Bildschirm füllen (beschneiden)', fill: 'strecken', none: 'Originalgröße' }, label: 'Darstellung' },
    { path: 'preview.flip', section: 'capture', group: 'Live-Vorschau', type: 'choice', default: 'off', options: { off: 'nicht spiegeln', 'flip-horizontal': 'waagerecht spiegeln', 'flip-vertical': 'senkrecht spiegeln' }, label: 'Spiegeln' },
    { path: 'preview.rotation', section: 'capture', group: 'Live-Vorschau', type: 'choice', default: '0deg', options: { '0deg': 'nicht drehen', '90deg': '90°', '-90deg': '−90°', '180deg': '180°', '45deg': '45°', '-45deg': '−45°' }, label: 'Drehen' },
    { path: 'preview.stop_time', section: 'capture', group: 'Live-Vorschau', type: 'integer', default: 2, min: 0, max: 10, unit: 's', label: 'Livebild vor der Aufnahme beenden' },
    { path: 'preview.extend_by_frame', section: 'capture', group: 'Live-Vorschau', type: 'boolean', default: false, label: 'Rahmen über dem Livebild' },
    { path: 'custom.enabled', section: 'capture', group: '„Custom“-Aufnahme', type: 'boolean', default: false, label: '„Custom“-Aufnahme anbieten' },
    { path: 'custom.btn_text', section: 'capture', group: '„Custom“-Aufnahme', type: 'text', default: 'Custom', maxLength: 30, label: 'Beschriftung „Custom“-Knopf' },
    { path: 'custom.cntdwn_time', section: 'capture', group: '„Custom“-Aufnahme', type: 'integer', default: 5, min: 0, max: 10, unit: 's', label: 'Countdown „Custom“' },
    { path: 'custom.key', section: 'capture', group: '„Custom“-Aufnahme', type: 'key', default: '', label: 'Buzzer-Taste „Custom“' },

    // Gestaltung
    { path: 'start_screen.title', section: 'design', group: 'Startseite', type: 'text', default: '', maxLength: 120, multiline: true, label: 'Titel' },
    { path: 'start_screen.title_visible', section: 'design', group: 'Startseite', type: 'boolean', default: false, label: 'Titel anzeigen' },
    { path: 'start_screen.subtitle', section: 'design', group: 'Startseite', type: 'text', default: '', maxLength: 120, multiline: true, label: 'Untertitel' },
    { path: 'start_screen.subtitle_visible', section: 'design', group: 'Startseite', type: 'boolean', default: false, label: 'Untertitel anzeigen' },
    {
        path: 'ui.startpage_text_position',
        section: 'design',
        group: 'Startseite',
        type: 'choice',
        default: 'bottom',
        options: { top: 'oben', center: 'Mitte', bottom: 'unten', 'left-top': 'links oben', 'left-center': 'links Mitte', 'left-bottom': 'links unten', 'right-top': 'rechts oben', 'right-center': 'rechts Mitte', 'right-bottom': 'rechts unten' },
        label: 'Position des Texts',
    },
    { path: 'event.enabled', section: 'design', group: 'Startseite', type: 'boolean', default: false, label: 'Symbol zwischen den Namen anzeigen' },
    {
        path: 'event.symbol',
        section: 'design',
        group: 'Startseite',
        type: 'choice',
        default: 'fa-regular fa-heart',
        options: {
            'fa-regular fa-heart': 'Herz (Umriss)',
            'fa-solid fa-heart': 'Herz',
            'fa-solid fa-heart-pulse': 'Herzschlag',
            'fa-light fa-champagne-glasses': 'Sektgläser',
            'fa-birthday-cake': 'Torte',
            'fa-gift': 'Geschenk',
            'fa-camera': 'Kamera',
            'fa-camera-retro': 'Kamera (retro)',
            'fa-users': 'Personen',
            'fa-tree': 'Baum',
            'fa-snowflake': 'Schneeflocke',
            'fa-solid fa-sun': 'Sonne',
            'fa-anchor': 'Anker',
            'fa-gears': 'Zahnräder',
            'fa-brands fa-apple': 'Apfel',
        },
        label: 'Symbol',
    },
    { path: 'background.defaults', section: 'design', group: 'Startseite', type: 'media', kind: 'background', default: '', label: 'Hintergrund' },
    { path: 'logo.enabled', section: 'design', group: 'Startseite', type: 'boolean', default: true, label: 'Logo anzeigen' },
    { path: 'logo.path', section: 'design', group: 'Startseite', type: 'media', kind: 'logo', default: '', label: 'Logo' },
    {
        path: 'logo.position',
        section: 'design',
        group: 'Startseite',
        type: 'choice',
        default: 'center',
        options: { center: 'Mitte', top_left: 'oben links', top_right: 'oben rechts', bottom_left: 'unten links', bottom_right: 'unten rechts' },
        label: 'Position des Logos',
    },
    { path: 'ui.style', section: 'design', group: 'Farben und Stil', type: 'choice', default: 'modern_squared', options: { modern_squared: 'modern, eckig', modern: 'modern, rund', classic: 'klassisch', classic_rounded: 'klassisch, abgerundet' }, label: 'Stil' },
    { path: 'ui.button', section: 'design', group: 'Farben und Stil', type: 'choice', default: 'modern_squared', options: { modern_squared: 'modern, eckig', modern: 'modern, rund', classic: 'klassisch', classic_rounded: 'klassisch, abgerundet' }, label: 'Knöpfe' },
    { path: 'ui.scale', section: 'design', group: 'Farben und Stil', type: 'integer', default: 100, min: 100, max: 200, unit: '%', label: 'Größe der Bedienelemente' },
    { path: 'ui.rounded_corners', section: 'design', group: 'Farben und Stil', type: 'boolean', default: false, label: 'Abgerundete Ecken' },
    { path: 'ui.decore_lines', section: 'design', group: 'Farben und Stil', type: 'boolean', default: true, label: 'Zierlinien' },
    { path: 'ui.shutter_animation', section: 'design', group: 'Farben und Stil', type: 'boolean', default: true, label: 'Auslöse-Animation' },
    { path: 'ui.result_buttons', section: 'design', group: 'Farben und Stil', type: 'boolean', default: true, label: 'Knöpfe unter dem fertigen Foto' },
    color('colors.primary', 'design', 'Farben und Stil', 'Hauptfarbe', '#1b3faa'),
    color('colors.primary_light', 'design', 'Farben und Stil', 'Hauptfarbe hell', '#e8ebf6'),
    color('colors.secondary', 'design', 'Farben und Stil', 'Zweitfarbe', '#5f78c3'),
    color('colors.highlight', 'design', 'Farben und Stil', 'Hervorhebung', '#8d9fd4'),
    color('colors.font', 'design', 'Farben und Stil', 'Schrift', '#c9c9c9'),
    color('colors.font_secondary', 'design', 'Farben und Stil', 'Schrift auf hellem Grund', '#333333'),
    color('colors.panel', 'design', 'Farben und Stil', 'Flächen', '#1b3faa'),
    color('colors.border', 'design', 'Farben und Stil', 'Rahmenlinien', '#eeeeee'),
    color('colors.box', 'design', 'Farben und Stil', 'Kästen', '#e8ebf6'),
    color('colors.background_countdown', 'design', 'Farben und Stil', 'Hintergrund Countdown', '#8d9fd4'),
    color('colors.cheese', 'design', 'Farben und Stil', '„Cheese“-Anzeige', '#aa1b3f'),
    color('colors.status_bar', 'design', 'Farben und Stil', 'Statusleiste', '#000000'),
    color('colors.gallery_button', 'design', 'Farben und Stil', 'Galerie-Knopf', '#ffffff'),
    { path: 'render.look', section: 'design', group: 'Look', type: 'look', default: '', label: 'Look (Bearbeitung der Fotos)', help: 'Wird auf jedes Foto angewendet; das Original bleibt unverändert.' },
    { path: 'picture.take_frame', section: 'design', group: 'Rahmen', type: 'boolean', default: true, label: 'Rahmen auf dem Einzelfoto' },
    { path: 'picture.frame', section: 'design', group: 'Rahmen', type: 'media', kind: 'frame', default: '', label: 'Rahmen Einzelfoto' },
    { path: 'collage.take_frame', section: 'design', group: 'Rahmen', type: 'choice', default: 'off', options: { off: 'kein Rahmen', always: 'um jedes Foto der Collage', once: 'um die ganze Collage' }, label: 'Rahmen auf der Collage' },
    { path: 'collage.frame', section: 'design', group: 'Rahmen', type: 'media', kind: 'frame', default: '', label: 'Rahmen Collage' },
    { path: 'print.frame', section: 'design', group: 'Rahmen', type: 'media', kind: 'frame', default: '', label: 'Rahmen Druck', help: 'Gilt, wenn unter Druck „Eigenen Druckrahmen verwenden“ an ist.' },
    color('collage.background_color', 'design', 'Collage', 'Hintergrundfarbe', '#ffffff'),
    { path: 'collage.background', section: 'design', group: 'Collage', type: 'media', kind: 'background', default: '', label: 'Hintergrundbild' },
    color('collage.dashedline_color', 'design', 'Collage', 'Schnittlinie bei Fotostreifen', '#000000'),
    ...textSettings('textonpicture', 'Text auf dem Foto', { enabled: false, lines: ['line 1', 'line 2', 'line 3'], color: '#ffffff', size: 80, x: 80, y: 80, rotation: 0, linespace: 90 }),
    ...textSettings('textoncollage', 'Text auf der Collage', { enabled: true, lines: ['Photobooth', '   we love', 'OpenSource'], color: '#000000', size: 50, x: 1470, y: 250, rotation: 0, linespace: 60 }),
    ...textSettings('textonprint', 'Text auf dem Druck', { enabled: false, lines: ['line 1', 'line 2', 'line 3'], color: '#ffffff', size: 100, x: 2250, y: 1050, rotation: 40, linespace: 100 }),

    // Geräte
    { path: 'get_request.countdown', section: 'devices', group: 'Ringlicht', type: 'boolean', default: false, label: 'Ringlicht beim Countdown einschalten' },
    { path: 'get_request.server', section: 'devices', group: 'Ringlicht', type: 'url', default: '', schemes: ['http:', 'https:'], label: 'Adresse des Ringlichts', help: 'z. B. http://192.168.8.50' },
    { path: 'screensaver.enabled', section: 'devices', group: 'Bildschirmschoner', type: 'boolean', default: false, label: 'Bildschirmschoner' },
    { path: 'screensaver.timeout_minutes', section: 'devices', group: 'Bildschirmschoner', type: 'integer', default: 3, min: 1, max: 120, unit: 'min', label: 'Bildschirmschoner nach' },
    { path: 'screensaver.mode', section: 'devices', group: 'Bildschirmschoner', type: 'choice', default: 'image', options: { image: 'ein Bild', gallery: 'Fotos aus der Galerie', folder: 'Bilder aus einem Ordner', video: 'Video' }, label: 'Was zeigt er?' },
    { path: 'screensaver.image_source', section: 'devices', group: 'Bildschirmschoner', type: 'media', kind: 'background', default: '', label: 'Bild' },
    { path: 'screensaver.switch_seconds', section: 'devices', group: 'Bildschirmschoner', type: 'integer', default: 60, min: 1, max: 3600, unit: 's', label: 'Bild wechseln nach' },
    { path: 'screensaver.text', section: 'devices', group: 'Bildschirmschoner', type: 'text', default: '', maxLength: 120, label: 'Text' },
    { path: 'screensaver.text_position', section: 'devices', group: 'Bildschirmschoner', type: 'choice', default: 'center', options: { 'top-center': 'oben', center: 'Mitte', 'bottom-center': 'unten' }, label: 'Position des Texts' },
    color('screensaver.text_color', 'devices', 'Bildschirmschoner', 'Textfarbe', '#ffffff'),
    color('screensaver.text_backdrop_color', 'devices', 'Bildschirmschoner', 'Hintergrund des Texts', '#202020'),
    { path: 'remotebuzzer.startserver', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Fernauslöser (GPIO/Netzwerk)' },
    { path: 'remotebuzzer.usebuttons', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Hardware-Taster verwenden' },
    { path: 'remotebuzzer.picturebutton', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: true, label: 'Taster löst Einzelfoto aus' },
    { path: 'remotebuzzer.collagebutton', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Taster löst Collage aus' },
    { path: 'remotebuzzer.custombutton', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Taster löst „Custom“ aus' },
    { path: 'remotebuzzer.printbutton', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Taster druckt' },
    { path: 'remotebuzzer.userotary', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Drehregler verwenden' },
    { path: 'remotebuzzer.enable_standalonegallery', section: 'devices', group: 'Fernauslöser', type: 'boolean', default: false, label: 'Taster öffnet die Galerie' },
    { path: 'remotebuzzer.move2usb', section: 'devices', group: 'Fernauslöser', type: 'choice', default: 'disabled', options: { disabled: 'aus', copy: 'Fotos auf USB-Stick kopieren', move: 'Fotos auf USB-Stick verschieben' }, label: 'Taster für USB-Stick' },
    { path: 'remotebuzzer.port', section: 'devices', group: 'Fernauslöser', type: 'integer', default: 14711, min: 1024, max: 65535, label: 'Port', help: 'Auf der Box ist dieser Port nach außen nicht freigegeben.' },
    { path: 'synctodrive.enabled', section: 'devices', group: 'USB-Stick', type: 'boolean', default: false, label: 'Fotos automatisch auf USB-Stick kopieren' },
    { path: 'synctodrive.target', section: 'devices', group: 'USB-Stick', type: 'text', default: 'photobooth', maxLength: 40, pattern: /^[A-Za-z0-9_-]+$/, label: 'Name des USB-Sticks' },
    { path: 'synctodrive.interval', section: 'devices', group: 'USB-Stick', type: 'integer', default: 300, min: 10, max: 600, unit: 's', label: 'Kopieren alle' },

    // Galerie
    { path: 'gallery.enabled', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Galerie am Kiosk' },
    { path: 'gallery.newest_first', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Neueste Fotos zuerst' },
    { path: 'gallery.allow_delete', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Löschen in der Galerie am Kiosk' },
    { path: 'gallery.show_date', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Datum anzeigen' },
    { path: 'gallery.date_format', section: 'gallery', group: 'Galerie', type: 'text', default: 'd.m.Y - G:i', maxLength: 30, pattern: /^[dDjlNSwzWFmMntLoYyaABgGhHisuvT .:,/-]+$/, label: 'Datumsformat', help: 'z. B. d.m.Y - G:i' },
    { path: 'gallery.figcaption', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Bildunterschrift' },
    { path: 'gallery.bottom_bar', section: 'gallery', group: 'Galerie', type: 'boolean', default: true, label: 'Leiste unter dem Foto' },
    { path: 'gallery.use_thumb', section: 'gallery', group: 'Galerie', type: 'boolean', default: false, label: 'Vorschaubilder statt großer Fotos (schneller)' },
    { path: 'gallery.use_slideshow', section: 'gallery', group: 'Diashow', type: 'boolean', default: true, label: 'Diashow-Knopf in der Galerie' },
    { path: 'slideshow.use_thumbs', section: 'gallery', group: 'Diashow', type: 'boolean', default: false, label: 'Diashow mit Vorschaubildern (schneller)' },
    { path: 'qr.enabled', section: 'gallery', group: 'QR-Code', type: 'boolean', default: true, label: 'QR-Code zum Foto anzeigen' },
    { path: 'qr.result', section: 'gallery', group: 'QR-Code', type: 'choice', default: 'hidden', options: { hidden: 'nicht anzeigen', left: 'links', 'left left--top': 'links oben', 'left left--center': 'links Mitte', 'left left--bottom': 'links unten', right: 'rechts', 'right right--top': 'rechts oben', 'right right--center': 'rechts Mitte', 'right right--bottom': 'rechts unten' }, label: 'QR-Code neben dem fertigen Foto' },
    { path: 'qr.pswp', section: 'gallery', group: 'QR-Code', type: 'choice', default: 'hidden', options: { ...SIDE_POSITIONS, 'center center--top': 'Mitte oben', 'center center--bottom': 'Mitte unten' }, label: 'QR-Code in der Galerie' },
    { path: 'qr.short_text', section: 'gallery', group: 'QR-Code', type: 'text', default: '', maxLength: 80, label: 'Kurzer Text am QR-Code' },
    { path: 'qr.custom_text', section: 'gallery', group: 'QR-Code', type: 'boolean', default: false, label: 'Eigenen Hinweistext anzeigen' },
    { path: 'qr.text', section: 'gallery', group: 'QR-Code', type: 'text', default: '', maxLength: 300, multiline: true, label: 'Hinweistext' },

    // Allgemein
    { path: 'ui.language', section: 'general', type: 'choice', default: 'de', options: { de: 'Deutsch', en: 'Englisch', fr: 'Französisch', it: 'Italienisch', nl: 'Niederländisch', es: 'Spanisch', pt: 'Portugiesisch', cs: 'Tschechisch', hr: 'Kroatisch', tr: 'Türkisch' }, label: 'Sprache der Gäste-Oberfläche' },
    {
        path: 'ui.local_timezone',
        section: 'general',
        type: 'choice',
        default: 'Europe/Berlin',
        options: {
            'Europe/Berlin': 'Deutschland (Berlin)',
            'Europe/Vienna': 'Österreich (Wien)',
            'Europe/Zurich': 'Schweiz (Zürich)',
            'Europe/Luxembourg': 'Luxemburg',
            'Europe/Amsterdam': 'Niederlande (Amsterdam)',
            'Europe/Brussels': 'Belgien (Brüssel)',
            'Europe/Paris': 'Frankreich (Paris)',
            'Europe/Copenhagen': 'Dänemark (Kopenhagen)',
            'Europe/London': 'Großbritannien (London)',
        },
        label: 'Zeitzone',
    },
];

const BY_PATH = new Map(SETTINGS.map((setting) => [setting.path, setting]));

export const findSetting = (path: string): SettingDefinition | undefined => BY_PATH.get(path);
export const requiredRole = (setting: SettingDefinition): Role => setting.role ?? 'admin';

export class InvalidSettingError extends Error {
    constructor(
        readonly path: string,
        message: string,
    ) {
        super(message);
    }
}

// Steuerzeichen außer Zeilenumbruch (Texte landen auf dem Kiosk-Bildschirm und im Druck)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** Prüft einen Wert gegen seine Definition und gibt ihn normalisiert zurück */
export function validateSetting(setting: SettingDefinition, value: unknown): ConfigValue {
    const fail = (message: string): never => {
        throw new InvalidSettingError(setting.path, `${setting.label}: ${message}`);
    };
    switch (setting.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : fail('muss ja oder nein sein');
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value)) {
                return fail('muss eine ganze Zahl sein');
            }
            return value >= setting.min && value <= setting.max ? value : fail(`muss zwischen ${setting.min} und ${setting.max} liegen`);
        case 'text': {
            if (typeof value !== 'string') {
                return fail('muss ein Text sein');
            }
            const text = setting.multiline ? value.replace(/\r\n?/g, '\n') : value;
            if (text.length > setting.maxLength) {
                return fail(`höchstens ${setting.maxLength} Zeichen`);
            }
            if (CONTROL.test(text) || (!setting.multiline && text.includes('\n'))) {
                return fail('enthält unzulässige Zeichen');
            }
            if (setting.pattern && text !== '' && !setting.pattern.test(text)) {
                return fail('hat ein ungültiges Format');
            }
            return text;
        }
        case 'choice':
            return typeof value === 'string' && Object.hasOwn(setting.options, value) ? value : fail('ist keine der erlaubten Möglichkeiten');
        case 'key':
            if (value === '' || value === null) {
                return '';
            }
            if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1000) {
                return String(value);
            }
            return typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value) ? value : fail('ist keine gültige Taste');
        case 'color':
            return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : fail('muss eine Farbe wie #1b3faa sein');
        case 'media':
            if (value === '') {
                return '';
            }
            return typeof value === 'string' && isMediaPath(setting.kind, value) ? value : fail('ist keine Datei aus der Bibliothek');
        case 'look':
            return value === '' || (typeof value === 'string' && LOOK.test(value)) ? value : fail('ist kein gültiger Look-Name');
        case 'layout':
            return typeof value === 'string' && LAYOUT.test(value) ? value : fail('ist kein gültiges Layout');
        case 'url': {
            if (value === '') {
                return '';
            }
            if (typeof value !== 'string' || value.length > 200) {
                return fail('ist keine gültige Adresse');
            }
            let url: URL;
            try {
                url = new URL(value);
            } catch {
                return fail('ist keine gültige Adresse');
            }
            if (!setting.schemes.includes(url.protocol) || url.username || url.password) {
                return fail(`muss mit ${setting.schemes.join(' oder ')}// beginnen`);
            }
            return value.replace(/\/+$/, '');
        }
    }
}

/** Werte aus einer Anfrage `{ "print.limit": 8, … }` prüfen; unbekannte Pfade werden abgelehnt */
export function validateSettingValues(values: unknown): Map<SettingDefinition, ConfigValue> {
    if (!isTree(values) || Object.keys(values).length === 0) {
        throw new InvalidSettingError('', 'Keine Einstellungen angegeben');
    }
    const result = new Map<SettingDefinition, ConfigValue>();
    for (const [path, value] of Object.entries(values)) {
        const setting = findSetting(path);
        if (!setting) {
            throw new InvalidSettingError(path, `Einstellung ${path} gibt es nicht`);
        }
        result.set(setting, validateSetting(setting, value));
    }
    return result;
}

/** Für die Oberfläche: Definitionen ohne RegExp (JSON-tauglich) */
export function describeSettings(): SettingDescription[] {
    return SETTINGS.map((setting) => {
        const { pattern: _pattern, ...rest } = setting as SettingDefinition & { pattern?: RegExp };
        return { ...rest, role: requiredRole(setting) } as SettingDescription;
    });
}
