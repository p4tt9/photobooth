<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;

/**
 * Hardware checks for the setup self-test (concept 4.9) – transitional (planning/ADMIN.md, 7d).
 *
 * Camera and printer are still driven by this container (gphoto2, CUPS socket). app runs the self-test and asks
 * this service for these checks via api/selftest.php. With the camera service (package 8) and printing in app
 * (package 9) the checks move there and this class is removed.
 *
 * Every check has a hard time limit and never throws: a hanging camera must not hang the self-test.
 */
final class SelftestService
{
    private const TIMEOUT_SECONDS = 15;
    private const KEEP_TEST_PHOTOS = 5;

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(private readonly array $config)
    {
    }

    /**
     * @return array{id: string, label: string, level: string, message: string}
     */
    public function camera(): array
    {
        [$status, $output] = $this->run('gphoto2 --auto-detect');
        if ($status !== 0) {
            return $this->check('camera', 'Kamera', 'error', 'gphoto2 antwortet nicht (' . $this->firstLine($output) . ')');
        }
        // Liste nach der Trennlinie: "<Modell>   usb:001,004"
        $models = [];
        $afterHeader = false;
        foreach ($output as $line) {
            if (str_starts_with($line, '---')) {
                $afterHeader = true;
                continue;
            }
            if ($afterHeader && trim($line) !== '') {
                $models[] = trim((string) preg_replace('/\s{2,}\S+$/', '', $line));
            }
        }
        if ($models === []) {
            return $this->check('camera', 'Kamera', 'error', 'Keine Kamera erkannt – USB-Kabel und Einschalter prüfen');
        }

        return $this->check('camera', 'Kamera', 'ok', implode(', ', $models));
    }

    /**
     * Takes a photo with the configured command into data/test/ (not into the gallery).
     *
     * @return array{check: array{id: string, label: string, level: string, message: string}, file: string|null}
     */
    public function testPhoto(): array
    {
        $directory = FolderEnum::TEST->absolute();
        if (!is_dir($directory)) {
            mkdir($directory, 0775, true);
        }
        $name = 'selftest-' . date('Ymd-His') . '.jpg';
        $file = $directory . DIRECTORY_SEPARATOR . $name;
        $command = (string) ($this->config['commands']['take_picture'] ?? '');
        if ($command === '') {
            return ['check' => $this->check('photo', 'Testfoto', 'error', 'Kein Aufnahmebefehl eingerichtet'), 'file' => null];
        }
        $started = microtime(true);
        $previous = getcwd();
        // gphoto2 legt Hilfsdateien im Arbeitsverzeichnis ab
        chdir($directory);
        [$status, $output] = $this->run(sprintf($command, escapeshellarg($file)));
        if ($previous !== false) {
            chdir($previous);
        }
        $seconds = microtime(true) - $started;
        $size = is_file($file) ? @getimagesize($file) : false;
        if ($status !== 0 || $size === false) {
            @unlink($file);

            return ['check' => $this->check('photo', 'Testfoto', 'error', 'Aufnahme fehlgeschlagen (' . $this->firstLine($output) . ')'), 'file' => null];
        }
        $this->pruneTestPhotos($directory);
        $level = $seconds > 6 ? 'warn' : 'ok';
        $message = sprintf('%d × %d Pixel in %.1f s', $size[0], $size[1], $seconds) . ($level === 'warn' ? ' – Aufnahme ungewöhnlich langsam' : '');

        return ['check' => $this->check('photo', 'Testfoto', $level, $message), 'file' => FolderEnum::TEST->value . '/' . $name];
    }

    /**
     * @return array{id: string, label: string, level: string, message: string}
     */
    public function printer(): array
    {
        [$status, $output] = $this->run('lpstat -d');
        $default = $status === 0 && preg_match('/destination:\s*(\S+)/', implode("\n", $output), $match) ? $match[1] : null;
        if ($default === null) {
            return $this->check('printer', 'Drucker', 'error', 'Kein Standarddrucker eingerichtet (CUPS nicht erreichbar?)');
        }
        [$status, $output] = $this->run('lpstat -p ' . escapeshellarg($default));
        $text = implode(' ', array_map('trim', $output));
        if ($status !== 0) {
            return $this->check('printer', 'Drucker', 'error', $default . ': ' . $this->firstLine($output));
        }
        if (str_contains($text, 'disabled')) {
            return $this->check('printer', 'Drucker', 'error', $default . ' ist gestoppt – einschalten, Papier und Farbband prüfen');
        }

        return $this->check('printer', 'Drucker', 'ok', $default . (str_contains($text, 'printing') ? ' druckt gerade' : ' bereit'));
    }

    /**
     * @return array{0: int, 1: array<int, string>}
     */
    private function run(string $command): array
    {
        $output = [];
        $status = 0;
        exec('timeout ' . self::TIMEOUT_SECONDS . ' ' . $command . ' 2>&1', $output, $status);

        return [$status === 124 ? 124 : $status, $status === 124 ? ['keine Antwort innerhalb von ' . self::TIMEOUT_SECONDS . ' s'] : $output];
    }

    /**
     * @param array<int, string> $output
     */
    private function firstLine(array $output): string
    {
        foreach ($output as $line) {
            if (trim($line) !== '') {
                return mb_substr(trim($line), 0, 160);
            }
        }

        return 'ohne Meldung';
    }

    private function pruneTestPhotos(string $directory): void
    {
        $files = glob($directory . DIRECTORY_SEPARATOR . 'selftest-*.jpg') ?: [];
        rsort($files);
        foreach (array_slice($files, self::KEEP_TEST_PHOTOS) as $old) {
            @unlink($old);
        }
    }

    /**
     * @return array{id: string, label: string, level: string, message: string}
     */
    private function check(string $id, string $label, string $level, string $message): array
    {
        return ['id' => $id, 'label' => $label, 'level' => $level, 'message' => $message];
    }
}
