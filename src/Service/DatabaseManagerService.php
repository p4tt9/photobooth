<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;
use Photobooth\Utility\FileUtility;

/**
 * Class DatabaseManager
 *
 * Manages the database, including adding and deleting files.
 */
class DatabaseManagerService
{
    public string $databaseFile = '';
    public string $imageDirectory = '';

    /**
     * Nesting depth of withLock(); flock() on a second handle of the same file would block this process.
     */
    private int $lockDepth = 0;

    public function __construct()
    {
        $config = ConfigurationService::getInstance()->getConfiguration();
        $this->databaseFile = FolderEnum::DATA->absolute() . DIRECTORY_SEPARATOR . $config['database']['file'] . '.txt';
        $this->imageDirectory = FolderEnum::IMAGES->absolute();
    }

    /**
     * Get the list of files from the database file.
     *
     * A database damaged by a power loss is rebuilt from the image directory instead of being
     * treated as empty – otherwise the next photo would overwrite it and the gallery would
     * forget every earlier picture.
     */
    public function getContentFromDB(): array
    {
        // check if the database file is defined and non-empty
        if (!isset($this->databaseFile) || empty($this->databaseFile)) {
            throw new \Exception('Database not defined.');
        }

        if (!file_exists($this->databaseFile)) {
            return [];
        }

        $entries = $this->readDatabaseFile();
        if ($entries !== null) {
            return $entries;
        }

        error_log('Image database ' . $this->databaseFile . ' is damaged, rebuilding it from ' . $this->imageDirectory);

        return $this->withLock(function (): array {
            // Another request may have repaired it while we waited for the lock.
            $entries = $this->readDatabaseFile();
            if ($entries !== null) {
                return $entries;
            }
            $entries = $this->scanImageDirectory();
            $this->writeDatabase($entries);

            return $entries;
        });
    }

    /**
     * Returns the entries of the database file, or null if it cannot be read or decoded.
     */
    private function readDatabaseFile(): ?array
    {
        $data = @file_get_contents($this->databaseFile);
        if ($data === false) {
            return null;
        }
        $decoded = json_decode($data, true);
        if (!is_array($decoded) || !array_is_list($decoded)) {
            return null;
        }
        foreach ($decoded as $entry) {
            if (!is_string($entry)) {
                return null;
            }
        }

        return $decoded;
    }

    /**
     * Writes the database atomically, so a power loss leaves either the old or the new version.
     */
    private function writeDatabase(array $entries): void
    {
        $encoded = json_encode(array_values($entries));
        if ($encoded === false) {
            throw new \Exception('Failed to encode database content to JSON: ' . json_last_error_msg());
        }
        FileUtility::writeAtomic($this->databaseFile, $encoded);
    }

    /**
     * Runs a read-modify-write of the database exclusively, so two requests cannot drop each other's entries.
     *
     * @template T
     * @param callable(): T $callback
     * @return T
     */
    private function withLock(callable $callback): mixed
    {
        if ($this->lockDepth > 0) {
            return $callback();
        }
        $handle = @fopen($this->databaseFile . '.lock', 'c');
        if ($handle === false) {
            return $callback();
        }
        $this->lockDepth++;
        try {
            flock($handle, LOCK_EX);
            return $callback();
        } finally {
            $this->lockDepth--;
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * All JPEG files in the image directory, oldest first.
     *
     * @return string[]
     */
    private function scanImageDirectory(): array
    {
        $output = [];
        if (!is_dir($this->imageDirectory)) {
            return [];
        }
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->imageDirectory, \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::UNIX_PATHS)) as $value) {
            if ($value->isFile() && strtolower(pathinfo($value->getFilename(), PATHINFO_EXTENSION)) === 'jpg') {
                $output[] = [$value->getMTime(), $value->getFilename()];
            }
        }

        usort($output, function ($a, $b) {
            return [$a[0], $a[1]] <=> [$b[0], $b[1]];
        });

        return array_column($output, 1);
    }

    /**
     * Get the list of images from the images directory.
     */
    public function getFilesFromDirectory(): array
    {
        // check if the directory is defined and non-empty
        if (!isset($this->imageDirectory) || empty($this->imageDirectory)) {
            throw new \Exception('Directory not defined.');
        }

        try {
            // open the directory
            $dh = opendir($this->imageDirectory);
            if ($dh === false) {
                throw new \Exception('Failed to open directory: ' . $this->imageDirectory);
            }

            // read the files in the directory
            $files = [];
            while (false !== ($filename = readdir($dh))) {
                $files[] = $filename;
            }
            closedir($dh);

            // filter the files to include only images with .jpg or .jpeg extensions
            $images = preg_grep('/\.(jpg|jpeg)$/i', $files);
            if ($images === false) {
                return [];
            }

            return $images;
        } catch (\Exception $e) {
            // do nothing
        }

        return [];
    }

    /**
     * Append a new content by name to the database file.
     */
    public function appendContentToDB(string $content): void
    {
        if (!$content) {
            throw new \Exception('Invalid content.');
        }

        // check if the database file is defined and non-empty
        if (!isset($this->databaseFile) || empty($this->databaseFile)) {
            throw new \Exception('Database not defined.');
        }

        $this->withLock(function () use ($content): void {
            $currContent = $this->getContentFromDB();
            if (!in_array($content, $currContent)) {
                $currContent[] = $content;
                $this->writeDatabase($currContent);
            }
        });
    }

    /**
     * Delete an entry by name from the database file.
     */
    public function deleteContentFromDB(string $content): void
    {
        if (!$content) {
            throw new \Exception('Invalid filename.');
        }

        // check if the database file is defined and non-empty
        if (!isset($this->databaseFile) || empty($this->databaseFile)) {
            throw new \Exception('Database not defined.');
        }
        $this->withLock(function () use ($content): void {
            $currContent = $this->getContentFromDB();

            if (in_array($content, $currContent)) {
                unset($currContent[array_search($content, $currContent)]);
                $this->writeDatabase($currContent);
            }

            if (file_exists($this->databaseFile) && empty($currContent)) {
                unlink($this->databaseFile);
            }
        });
    }

    /**
     * Check if an content exists in the database file.
     */
    public function isInDB(string $content): bool
    {
        if (!$content) {
            throw new \Exception('Invalid filename.');
        }

        // check if the database file is defined and non-empty
        if (!isset($this->databaseFile) || empty($this->databaseFile)) {
            throw new \Exception('Database not defined.');
        }

        $currContent = $this->getContentFromDB();

        return in_array($content, $currContent);
    }

    /**
     * Returns the size of the database file in bytes.
     */
    public function getDBSize(): int
    {
        if (file_exists($this->databaseFile)) {
            return (int) filesize($this->databaseFile);
        }
        return 0;
    }

    /**
     * Rebuilds the image database by scanning the image directory and creating a new database
     * file with the names of all files sorted by modification time.
     *
     * @return string The string "success" if the database was rebuilt successfully, or "error"
     *                if an error occurred during the rebuilding process.
     */
    public function rebuildDB(): string
    {
        // check if the database file is defined and non-empty
        if (!isset($this->databaseFile) || empty($this->databaseFile)) {
            throw new \Exception('Database not defined.');
        }

        // check if the file directory is defined and non-empty
        if (!isset($this->imageDirectory) || empty($this->imageDirectory)) {
            throw new \Exception('File directory not defined.');
        }

        try {
            $this->withLock(function (): void {
                $this->writeDatabase($this->scanImageDirectory());
            });

            return 'success';
        } catch (\Exception $e) {
            return 'error';
        }
    }

    public static function getInstance(): self
    {
        if (!isset($GLOBALS[self::class])) {
            $GLOBALS[self::class] = new self();
        }

        return $GLOBALS[self::class];
    }
}
