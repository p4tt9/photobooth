<?php

namespace Photobooth\Utility;

use Photobooth\Image;

/**
 * Zeichnet Text mit der bewährten GD-Logik (Schrift, Position, Zeilenabstand, Textfeld mit automatischer
 * Größe) auf eine durchsichtige Ebene in Zielgröße. Der Render-Dienst legt diese Ebene über das Bild –
 * so sieht der Text genauso aus wie bisher, ohne dass die Text-Regeln doppelt gepflegt werden.
 */
final class TextOverlayUtility
{
    /**
     * @param array{
     *     font: string, color: string, size: int|float, rotation: int, x: int|float, y: int|float,
     *     lines: array<int, string>, linespace: int|float,
     *     zone?: array{x: float, y: float, w: float, h: float, padding: float, align: string, valign: string, rotation: int}|null
     * }|array<int, array<string, mixed>> $text Text in Koordinaten des bisherigen Bildes (Referenz); auch
     *     mehrere Texte (z. B. Fotostreifen: gleicher Text auf beiden Streifen)
     * @param float $scale Referenz → Zielgröße
     * @param float $offsetX Verschiebung in Zielpixeln (z. B. Zuschnitt beim Druck)
     */
    public static function render(array $text, int $width, int $height, float $scale, float $offsetX, float $offsetY, string $target): bool
    {
        $canvas = imagecreatetruecolor(max(1, $width), max(1, $height));
        if (!$canvas instanceof \GdImage) {
            return false;
        }
        imagesavealpha($canvas, true);
        imagealphablending($canvas, false);
        imagefill($canvas, 0, 0, (int) imagecolorallocatealpha($canvas, 0, 0, 0, 127));
        imagealphablending($canvas, true);

        /** @var array<int, array<string, mixed>> $entries */
        $entries = isset($text['font']) ? [$text] : $text;
        foreach ($entries as $entry) {
            self::draw($canvas, $entry, $scale, $offsetX, $offsetY);
        }

        FileUtility::createDirectory(dirname($target));
        $temporary = FileUtility::temporaryPathFor($target);
        if (!imagepng($canvas, $temporary, 1)) {
            @unlink($temporary);
            return false;
        }
        FileUtility::commitTemporaryFile($temporary, $target);

        return true;
    }

    private static function draw(\GdImage $canvas, array $entry, float $scale, float $offsetX, float $offsetY): void
    {
        $image = new Image();
        $image->fontPath = $entry['font'];
        $image->fontColor = $entry['color'];
        $image->fontSize = max(1, (int) round($entry['size'] * $scale));
        $image->fontRotation = (int) $entry['rotation'];
        $image->fontLocationX = (int) round($entry['x'] * $scale - $offsetX);
        $image->fontLocationY = (int) round($entry['y'] * $scale - $offsetY);
        $image->textLineSpacing = (int) round($entry['linespace'] * $scale);
        $image->textLine1 = (string) ($entry['lines'][0] ?? '');
        $image->textLine2 = (string) ($entry['lines'][1] ?? '');
        $image->textLine3 = (string) ($entry['lines'][2] ?? '');

        $zone = $entry['zone'] ?? null;
        if ($zone !== null) {
            $image->textZoneMode = true;
            $image->textZoneX = $zone['x'] * $scale - $offsetX;
            $image->textZoneY = $zone['y'] * $scale - $offsetY;
            $image->textZoneW = $zone['w'] * $scale;
            $image->textZoneH = $zone['h'] * $scale;
            $image->textZonePadding = $zone['padding'] * $scale;
            $image->textZoneAlign = $zone['align'];
            $image->textZoneValign = $zone['valign'];
            $image->textZoneRotation = (int) $zone['rotation'];
        }

        $image->applyText($canvas);
    }
}
