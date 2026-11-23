<?php

namespace Photobooth\Service;

use Photobooth\Utility\FileUtility;

/**
 * Wechselt die Box auf ein anderes Event (Konfiguration vom Server), beginnt das neue Event mit leerer Galerie
 * und Druckzähler 0. Fotos, Druckprotokoll und Zähler des vorherigen Events werden nach
 * data/archive/<eventId>/ verschoben – gelöscht wird nichts. Der Agent lädt noch ausstehende Fotos von dort hoch.
 *
 * Stromausfallsicher: Die Markierung des aktiven Events wird erst geschrieben, wenn alles verschoben ist.
 * Wird der Vorgang unterbrochen, wiederholt die nächste Anfrage ihn und verschiebt den Rest.
 */
final class EventArchiveService
{
    public const MARKER_FILE = 'event.json';
    public const ARCHIVE_DIRECTORY = 'archive';

    /** Verzeichnisse und Dateien in data/, die zu einem Event gehören */
    private const EVENT_DIRECTORIES = ['images', 'thumbs', 'tmp', 'print', 'qrcodes', 'render-assets'];
    private const EVENT_FILES = ['printed.csv', 'print.count'];

    public function __construct(
        private readonly string $dataDirectory,
        private readonly string $databaseFile,
    ) {
    }

    /**
     * Stellt sicher, dass die Daten in data/ zum aktiven Event gehören. Ohne Event (keine Konfiguration vom
     * Server, Profil abgelaufen) bleibt alles, wie es ist.
     *
     * @return string|null Name des Archivs, wenn gerade archiviert wurde
     */
    public function ensureEvent(?string $eventId): ?string
    {
        if ($eventId === null || $this->currentEventId() === $eventId) {
            return null;
        }

        FileUtility::createDirectory($this->dataDirectory);
        $lock = fopen($this->dataDirectory . DIRECTORY_SEPARATOR . 'event.lock', 'c');
        if ($lock === false) {
            throw new \RuntimeException('Event-Wechsel: Sperre kann nicht angelegt werden');
        }
        try {
            flock($lock, LOCK_EX);
            // Eine parallele Anfrage hat den Wechsel eventuell schon erledigt
            $previous = $this->currentEventId();
            if ($previous === $eventId) {
                return null;
            }
            $archive = $this->archiveName($previous);
            $moved = $this->moveEventData($archive);
            $this->unlockPrinting();
            FileUtility::writeAtomic($this->markerFile(), (string) json_encode([
                'eventId' => $eventId,
                'since' => date(DATE_ATOM),
                'previous' => $previous,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            if ($moved) {
                error_log('Event-Wechsel auf ' . $eventId . ': Daten des vorherigen Events liegen in data/' . self::ARCHIVE_DIRECTORY . '/' . $archive);

                return $archive;
            }

            return null;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public function currentEventId(): ?string
    {
        $content = @file_get_contents($this->markerFile());
        $marker = is_string($content) ? json_decode($content, true) : null;

        return is_array($marker) && is_string($marker['eventId'] ?? null) ? $marker['eventId'] : null;
    }

    private function markerFile(): string
    {
        return $this->dataDirectory . DIRECTORY_SEPARATOR . self::MARKER_FILE;
    }

    private function archiveName(?string $previous): string
    {
        if ($previous !== null && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $previous)) {
            return $previous;
        }

        // Fotos von vor der ersten Server-Konfiguration (oder unbekanntes Event)
        return 'ohne-event-' . date('Ymd-His');
    }

    /**
     * @return bool ob es etwas zu archivieren gab
     */
    private function moveEventData(string $archive): bool
    {
        $target = $this->dataDirectory . DIRECTORY_SEPARATOR . self::ARCHIVE_DIRECTORY . DIRECTORY_SEPARATOR . $archive;
        $moved = false;

        foreach (self::EVENT_DIRECTORIES as $directory) {
            $source = $this->dataDirectory . DIRECTORY_SEPARATOR . $directory;
            if (!is_dir($source) || $this->isEmptyDirectory($source)) {
                continue;
            }
            FileUtility::createDirectory($target);
            $destination = $target . DIRECTORY_SEPARATOR . $directory;
            if (!file_exists($destination)) {
                // Ein Schritt: entweder liegt das Verzeichnis noch hier oder schon im Archiv
                $this->rename($source, $destination);
            } else {
                // Nach einem unterbrochenen Wechsel: übrige Dateien einzeln nachziehen
                foreach (scandir($source) ?: [] as $entry) {
                    if ($entry !== '.' && $entry !== '..' && !file_exists($destination . DIRECTORY_SEPARATOR . $entry)) {
                        $this->rename($source . DIRECTORY_SEPARATOR . $entry, $destination . DIRECTORY_SEPARATOR . $entry);
                    }
                }
            }
            FileUtility::createDirectory($source);
            $moved = true;
        }

        foreach ([...self::EVENT_FILES, basename($this->databaseFile)] as $file) {
            $source = $this->dataDirectory . DIRECTORY_SEPARATOR . $file;
            if (!file_exists($source)) {
                continue;
            }
            FileUtility::createDirectory($target);
            $this->rename($source, $target . DIRECTORY_SEPARATOR . $file);
            $moved = true;
        }

        return $moved;
    }

    private function unlockPrinting(): void
    {
        $lock = $this->dataDirectory . DIRECTORY_SEPARATOR . 'print.lock';
        if (file_exists($lock)) {
            unlink($lock);
        }
    }

    private function isEmptyDirectory(string $directory): bool
    {
        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                return false;
            }
        }

        return true;
    }

    private function rename(string $from, string $to): void
    {
        if (!rename($from, $to)) {
            throw new \RuntimeException('Event-Wechsel: ' . $from . ' kann nicht nach ' . $to . ' verschoben werden');
        }
    }
}
