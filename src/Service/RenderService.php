<?php

namespace Photobooth\Service;

use Photobooth\Utility\PathUtility;

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
            (bool) $c['textonpicture']['enabled'] => 'Text auf dem Foto',
            default => null,
        };
    }

    public function printFallbackReason(): ?string
    {
        $c = $this->config;
        return match (true) {
            !$this->isEnabled() => 'Render-Dienst ausgeschaltet',
            (bool) $c['textonprint']['enabled'] => 'Text auf dem Druck',
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
        $qrUrl = $c['qr']['url'] . ($c['qr']['append_filename'] ? $file : '');
        $qrUrl = PathUtility::isUrl($qrUrl) ? $qrUrl : PathUtility::getPublicPath($qrUrl, true);
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
            'print' => $this->printFallbackReason() === null ? $this->printPayload($originalPath, $qrUrl) : null,
        ];

        return $this->post('/v1/photo', $payload, self::PHOTO_TIMEOUT) !== null;
    }

    /**
     * Absoluter Pfad des fertigen Druckbilds, oder null wenn der Dienst es nicht liefern kann.
     */
    public function preparePrint(string $file): ?string
    {
        $result = $this->post('/v1/print', ['file' => $file], self::PRINT_TIMEOUT);
        if ($result === null || empty($result['path'])) {
            return null;
        }
        $path = PathUtility::getAbsolutePath('data/' . $result['path']);

        return is_file($path) ? $path : null;
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

    private function printPayload(string $originalPath, ?string $qrUrl): array
    {
        $c = $this->config;
        $qr = null;
        if ($c['print']['qrcode'] && $qrUrl !== null) {
            // Bisher wurde der QR-Code in Pixeln auf das Original (z. B. 6000 px) gesetzt – gleiche Proportionen behalten.
            $imageSize = @getimagesize($originalPath);
            $sourceWidth = $imageSize !== false ? max(1, (int) $imageSize[0]) : 6000;
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
