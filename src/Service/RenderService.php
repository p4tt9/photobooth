<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;
use Photobooth\Utility\PathUtility;
use Photobooth\Utility\TextOverlayUtility;

/**
 * Verbindung zum Snaphora-Render-Dienst (TypeScript, libvips).
 *
 * Der Dienst rechnet jede Bildversion direkt in ihrer Zielgröße: Anzeigebild und Vorschaubild sofort,
 * Galerie- und Druckbild im Hintergrund. Kann er etwas (noch) nicht oder ist er nicht erreichbar,
 * übernimmt die bisherige GD-Verarbeitung – die Box bleibt in jedem Fall bedienbar.
 */
class RenderService
{
    private const PHOTO_TIMEOUT = 20;
    private const PRINT_TIMEOUT = 75;

    public function __construct(private readonly array $config)
    {
    }

    public function isEnabled(): bool
    {
        return (bool) ($this->config['render']['enabled'] ?? false);
    }

    /**
     * Grund, warum ein Foto mit diesen Einstellungen noch über GD laufen muss – oder null.
     */
    public function photoFallbackReason(): ?string
    {
        $c = $this->config;
        return match (true) {
            !$this->isEnabled() => 'Render-Dienst ausgeschaltet',
            (bool) $c['picture']['polaroid_effect'] => 'Polaroid-Effekt',
            (int) $c['picture']['rotation'] !== 0 => 'Drehung',
            $c['picture']['flip'] !== 'off' => 'Spiegeln',
            default => null,
        };
    }

    public function printFallbackReason(): ?string
    {
        $c = $this->config;
        return match (true) {
            !$this->isEnabled() => 'Render-Dienst ausgeschaltet',
            (bool) $c['print']['crop'] => 'eigener Druck-Zuschnitt',
            default => null,
        };
    }

    /**
     * Lässt das Foto rechnen. Danach liegen Anzeigebild (vorläufig als Galerie-Datei) und Vorschaubild bereit.
     */
    public function processPhoto(string $file, string $originalPath): bool
    {
        $c = $this->config;
        $qrUrl = $this->qrUrl($file);

        // Größe des bisherigen Ergebnisbildes (Original + Rahmen-Erweiterung) – darauf beziehen sich Textpositionen
        [$width, $height] = $this->imageSize($originalPath);
        if ($c['picture']['take_frame'] && $c['picture']['extend_by_frame']) {
            $width = intval($width / (1 - 0.01 * ($c['picture']['frame_left_percentage'] + $c['picture']['frame_right_percentage'])));
            $height = intval($height / (1 - 0.01 * ($c['picture']['frame_top_percentage'] + $c['picture']['frame_bottom_percentage'])));
        }
        $textOverlay = $c['textonpicture']['enabled'] && $this->renderTextOverlay($file, 'text', $this->textSettings($c['textonpicture']), $width, $height);
        $printTextOverlay = $this->renderPrintTextOverlay($file, $width, $height);

        $payload = [
            'file' => $file,
            'look' => $c['render']['look'] !== '' ? $c['render']['look'] : null,
            'frameUrl' => $c['picture']['take_frame'] ? $this->appUrl($c['picture']['frame']) : null,
            'frameExtend' => $c['picture']['take_frame'] && $c['picture']['extend_by_frame'] ? [
                'left' => (int) $c['picture']['frame_left_percentage'],
                'right' => (int) $c['picture']['frame_right_percentage'],
                'top' => (int) $c['picture']['frame_top_percentage'],
                'bottom' => (int) $c['picture']['frame_bottom_percentage'],
            ] : null,
            'display' => ['longEdge' => (int) $c['render']['display_size'], 'quality' => 88],
            'gallery' => ['longEdge' => (int) $c['render']['gallery_size'], 'quality' => 92],
            'thumb' => ['longEdge' => $this->thumbSize(), 'quality' => max(60, (int) $c['jpeg_quality']['thumb'])],
            'textOverlay' => $textOverlay,
            'print' => $this->printFallbackReason() === null ? $this->printPayload($width, $qrUrl, $printTextOverlay) : null,
        ];

        return $this->post('/v1/photo', $payload, self::PHOTO_TIMEOUT) !== null;
    }

    /**
     * Lässt eine Collage bzw. Fotostreifen rechnen (Beschreibung aus Collage::renderSpec()).
     */
    public function processCollage(string $file, array $spec): bool
    {
        $c = $this->config;
        $textOverlay = $spec['text'] !== null && $this->renderTextOverlay($file, 'text', $spec['text'], (int) $spec['width'], (int) $spec['height']);
        $printTextOverlay = $this->renderPrintTextOverlay($file, (int) $spec['width'], (int) $spec['height']);
        $sources = array_map(fn (array $source): array => isset($source['placeholderPath'])
            ? ['placeholderUrl' => $this->appUrl((string) $source['placeholderPath'])]
            : ['path' => $source['path']], $spec['sources']);
        $payload = [
            'file' => $file,
            'look' => $c['render']['look'] !== '' ? $c['render']['look'] : null,
            'frameUrl' => $spec['framePath'] !== null ? $this->appUrl($spec['framePath']) : null,
            'backgroundUrl' => $spec['backgroundPath'] !== null ? $this->appUrl($spec['backgroundPath']) : null,
            'spec' => [
                'width' => $spec['width'],
                'height' => $spec['height'],
                'background' => $spec['background'],
                'slots' => $spec['slots'],
                'sources' => $sources,
                'frameOnce' => $spec['frameOnce'],
                'cutLine' => $spec['cutLine'],
            ],
            'display' => ['longEdge' => (int) $c['render']['display_size'], 'quality' => 88],
            'gallery' => ['longEdge' => (int) $c['render']['gallery_size'], 'quality' => 92],
            'thumb' => ['longEdge' => $this->thumbSize(), 'quality' => max(60, (int) $c['jpeg_quality']['thumb'])],
            'textOverlay' => $textOverlay,
            'print' => $this->printFallbackReason() === null ? $this->printPayload((int) $spec['width'], $this->qrUrl($file), $printTextOverlay) : null,
        ];

        return $this->post('/v1/collage', $payload, self::PHOTO_TIMEOUT) !== null;
    }

    /**
     * Fertiges Druckbild: absoluter Pfad und ob es ein Fotostreifen ist (Drucker soll schneiden),
     * oder null wenn der Dienst es nicht liefern kann.
     *
     * @return array{path: string, cut: bool}|null
     */
    public function preparePrint(string $file): ?array
    {
        $result = $this->post('/v1/print', ['file' => $file], self::PRINT_TIMEOUT);
        if ($result === null || empty($result['path'])) {
            return null;
        }
        $path = PathUtility::getAbsolutePath('data/' . $result['path']);

        return is_file($path) ? ['path' => $path, 'cut' => (bool) ($result['cut'] ?? false)] : null;
    }

    /**
     * Druckbefehl für Fotostreifen: Schneide-Option des Druckers ergänzen (nur bei `lp`).
     */
    public function stripPrintCommand(string $command): string
    {
        $options = self::safePrintOptions((string) ($this->config['render']['strip_print_options'] ?? ''));
        if ($options === '' || !preg_match('/^\s*lp(\s|$)/', $command)) {
            return $command;
        }

        return (string) preg_replace('/^(\s*lp)(\s|$)/', '$1 ' . $options . '$2', $command, 1);
    }

    /**
     * The option is a setting but ends up in a shell command: only plain CUPS options (`-o Name=Value`) are
     * accepted, each escaped. Anything else is ignored – otherwise saving settings would allow running commands.
     */
    public static function safePrintOptions(string $options): string
    {
        $options = trim($options);
        if ($options === '') {
            return '';
        }
        if (!preg_match('/^(-o\s+[A-Za-z0-9_-]{1,40}=[A-Za-z0-9_.-]{1,60}\s*)+$/', $options)) {
            error_log('Ignoring invalid strip print options (only "-o Name=Value" allowed): ' . $options);

            return '';
        }
        preg_match_all('/-o\s+([A-Za-z0-9_-]{1,40}=[A-Za-z0-9_.-]{1,60})/', $options, $matches);

        return implode(' ', array_map(static fn (string $option): string => '-o ' . escapeshellarg($option), $matches[1]));
    }

    /**
     * @return array<int, array{id: string, name: string}>
     */
    public function listLooks(): array
    {
        $context = stream_context_create(['http' => ['timeout' => 2, 'ignore_errors' => true]]);
        $response = @file_get_contents(rtrim($this->config['render']['url'], '/') . '/v1/looks', false, $context);
        $looks = $response !== false ? json_decode($response, true) : null;

        return is_array($looks) ? $looks : [];
    }

    private function qrUrl(string $file): string
    {
        $c = $this->config;
        $url = $c['qr']['url'] . ($c['qr']['append_filename'] ? $file : '');

        return PathUtility::isUrl($url) ? $url : PathUtility::getPublicPath($url, true);
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function imageSize(string $path): array
    {
        $imageSize = @getimagesize($path);

        return $imageSize !== false ? [max(1, (int) $imageSize[0]), max(1, (int) $imageSize[1])] : [6000, 4000];
    }

    /**
     * Text-Einstellungen eines Abschnitts (textonpicture, textonprint) im Format von TextOverlayUtility.
     */
    private function textSettings(array $section): array
    {
        return [
            'font' => (string) $section['font'],
            'color' => (string) $section['font_color'],
            'size' => (int) $section['font_size'],
            'rotation' => (int) $section['rotation'],
            'x' => (int) $section['locationx'],
            'y' => (int) $section['locationy'],
            'lines' => [(string) $section['line1'], (string) $section['line2'], (string) $section['line3']],
            'linespace' => (int) $section['linespace'],
            'zone' => null,
        ];
    }

    /**
     * Text-Ebene in Größe der Galerie-Version (der Dienst skaliert sie für Anzeige und Druckbasis).
     */
    private function renderTextOverlay(string $file, string $kind, array $text, int $referenceWidth, int $referenceHeight): bool
    {
        $scale = (int) $this->config['render']['gallery_size'] / max($referenceWidth, $referenceHeight);
        $width = (int) round($referenceWidth * $scale);
        $height = (int) round($referenceHeight * $scale);

        return TextOverlayUtility::render($text, $width, $height, $scale, 0, 0, $this->assetPath($file, $kind . '.png'));
    }

    /**
     * Text auf dem Druck: bisher auf das (ggf. gedrehte) Ergebnisbild gesetzt. Hier direkt in Druckgröße,
     * mit demselben Zuschnitt, den der Dienst beim Einpassen auf das Blatt vornimmt.
     */
    private function renderPrintTextOverlay(string $file, int $referenceWidth, int $referenceHeight): bool
    {
        $c = $this->config;
        if (!$c['textonprint']['enabled']) {
            return false;
        }
        if ($referenceHeight > $referenceWidth && !$c['print']['no_rotate']) {
            [$referenceWidth, $referenceHeight] = [$referenceHeight, $referenceWidth];
        }
        $printWidth = (int) $c['render']['print_width'];
        $printHeight = (int) $c['render']['print_height'];
        $scale = max($printWidth / $referenceWidth, $printHeight / $referenceHeight);
        $offsetX = ($referenceWidth * $scale - $printWidth) / 2;
        $offsetY = ($referenceHeight * $scale - $printHeight) / 2;

        return TextOverlayUtility::render($this->textSettings($c['textonprint']), $printWidth, $printHeight, $scale, $offsetX, $offsetY, $this->assetPath($file, 'printtext.png'));
    }

    private function assetPath(string $file, string $kind): string
    {
        return FolderEnum::DATA->absolute() . DIRECTORY_SEPARATOR . 'render-assets' . DIRECTORY_SEPARATOR . $file . '.' . $kind;
    }

    /**
     * @param int $sourceWidth Breite des Bildes, auf das der QR-Code bisher in Pixeln gesetzt wurde –
     *                         gleiche Proportionen behalten
     */
    private function printPayload(int $sourceWidth, ?string $qrUrl, bool $textOverlay = false): array
    {
        $c = $this->config;
        $qr = null;
        if ($c['print']['qrcode'] && $qrUrl !== null) {
            $qr = [
                'url' => $qrUrl,
                'size' => min(0.5, ((int) $c['print']['qrSize'] * 40) / $sourceWidth),
                'offset' => (int) $c['print']['qrOffset'] / $sourceWidth,
                'margin' => max(1, (int) round((int) $c['print']['qrMargin'] / 2)),
                'position' => $c['print']['qrPosition'],
                'background' => $c['print']['qrBgColor'],
            ];
        }

        return [
            'width' => (int) $c['render']['print_width'],
            'height' => (int) $c['render']['print_height'],
            'rotatePortrait' => !$c['print']['no_rotate'],
            'frameUrl' => $c['print']['print_frame'] ? $this->appUrl($c['print']['frame']) : null,
            'qr' => $qr,
            'textOverlay' => $textOverlay,
            'quality' => 95,
        ];
    }

    private function thumbSize(): int
    {
        return (int) substr((string) $this->config['picture']['thumb_size'], 0, -2) ?: 500;
    }

    private function appUrl(string $path): ?string
    {
        if ($path === '') {
            return null;
        }
        if (PathUtility::isUrl($path)) {
            return $path;
        }

        return rtrim($this->config['render']['app_url'], '/') . PathUtility::getPublicPath($path);
    }

    private function post(string $endpoint, array $payload, int $timeout): ?array
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode($payload),
                'timeout' => $timeout,
                'ignore_errors' => true,
            ],
        ]);
        $url = rtrim($this->config['render']['url'], '/') . $endpoint;
        $response = @file_get_contents($url, false, $context);
        $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s?/', $http_response_header[0], $m) ? (int) $m[1] : 0;
        if ($response === false || $status !== 200) {
            error_log('Render-Dienst ' . $endpoint . ' nicht verfügbar (HTTP ' . $status . '): ' . ($response === false ? 'keine Verbindung' : $response));
            return null;
        }
        $decoded = json_decode($response, true);

        return is_array($decoded) ? $decoded : null;
    }
}
