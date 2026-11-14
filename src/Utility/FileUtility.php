<?php

namespace Photobooth\Utility;

class FileUtility
{
    public const DIRECTORY_PERMISSIONS = 0755;

    public const FILE_UPLOAD_ERROR_MESSAGES = [
        UPLOAD_ERR_OK => 'file_upload:no_error',
        UPLOAD_ERR_INI_SIZE => 'file_upload:error_ini_size',
        UPLOAD_ERR_FORM_SIZE => 'file_upload:error_form_size',
        UPLOAD_ERR_PARTIAL => 'file_upload:error_partial',
        UPLOAD_ERR_NO_FILE => 'file_upload:error_no_file',
        UPLOAD_ERR_NO_TMP_DIR => 'file_upload:error_no_tmp_dir',
        UPLOAD_ERR_CANT_WRITE => 'file_upload:error_cant_write',
        UPLOAD_ERR_EXTENSION => 'file_upload:error_extension',
    ];

    public static function createDirectory(string $directory): void
    {
        if (!file_exists($directory) && !is_dir($directory)) {
            if (!mkdir($directory, self::DIRECTORY_PERMISSIONS, true)) {
                throw new \Exception('Failed to create directory: ' . $directory);
            }
        } elseif (!is_writable($directory)) {
            if (!chmod($directory, self::DIRECTORY_PERMISSIONS)) {
                throw new \Exception('Failed to change permissions of directory: ' . $directory);
            }
        }
    }

    /**
     * Writes a file so that it is either completely old or completely new – never half written,
     * even if the power is cut in the middle (the box is often simply unplugged).
     *
     * The content goes into a temporary file in the same directory, is flushed to disk and then
     * renamed over the target. A rename within one file system is atomic.
     *
     * @throws \RuntimeException
     */
    public static function writeAtomic(string $path, string $content): void
    {
        $temporaryPath = self::temporaryPathFor($path);
        $handle = @fopen($temporaryPath, 'x');
        if ($handle === false) {
            throw new \RuntimeException('Failed to create temporary file for ' . $path);
        }

        try {
            $written = 0;
            $length = strlen($content);
            while ($written < $length) {
                $result = fwrite($handle, substr($content, $written));
                if ($result === false || $result === 0) {
                    throw new \RuntimeException('Failed to write ' . $path);
                }
                $written += $result;
            }
            fflush($handle);
            fsync($handle);
        } catch (\Throwable $e) {
            fclose($handle);
            @unlink($temporaryPath);
            throw $e;
        }
        fclose($handle);

        self::commitTemporaryFile($temporaryPath, $path);
    }

    /**
     * Copies a file atomically (see writeAtomic()).
     *
     * @throws \RuntimeException
     */
    public static function copyAtomic(string $source, string $destination): void
    {
        $temporaryPath = self::temporaryPathFor($destination);
        if (!@copy($source, $temporaryPath)) {
            @unlink($temporaryPath);
            throw new \RuntimeException('Failed to copy ' . $source . ' to ' . $destination);
        }

        self::commitTemporaryFile($temporaryPath, $destination);
    }

    /**
     * Returns a path for a temporary file next to $path. Temporary files start with a dot and do not
     * keep the original extension, so galleries and directory scans never pick them up.
     */
    public static function temporaryPathFor(string $path): string
    {
        return dirname($path) . DIRECTORY_SEPARATOR . '.' . basename($path) . '.tmp-' . bin2hex(random_bytes(4));
    }

    /**
     * Flushes a completely written temporary file to disk and moves it to its final place.
     *
     * @throws \RuntimeException
     */
    public static function commitTemporaryFile(string $temporaryPath, string $path): void
    {
        $handle = @fopen($temporaryPath, 'r+');
        if ($handle !== false) {
            fsync($handle);
            fclose($handle);
        }

        if (!@rename($temporaryPath, $path)) {
            @unlink($temporaryPath);
            throw new \RuntimeException('Failed to move temporary file to ' . $path);
        }
    }

    /**
     * Appends one line to a file. If an earlier append was cut off by a power loss (no line break at
     * the end), the new line starts on a fresh line so both records stay countable.
     *
     * @throws \RuntimeException
     */
    public static function appendLine(string $path, string $line): void
    {
        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            throw new \RuntimeException('Failed to open ' . $path);
        }

        try {
            flock($handle, LOCK_EX);
            $prefix = '';
            $size = fstat($handle)['size'] ?? 0;
            if ($size > 0) {
                fseek($handle, -1, SEEK_END);
                if (fread($handle, 1) !== "\n") {
                    $prefix = "\n";
                }
            }
            fseek($handle, 0, SEEK_END);
            if (fwrite($handle, $prefix . rtrim($line, "\r\n") . "\n") === false) {
                throw new \RuntimeException('Failed to append to ' . $path);
            }
            fflush($handle);
            fsync($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    public static function getErrorMessage(int $errorCode): string
    {
        if (array_key_exists($errorCode, self::FILE_UPLOAD_ERROR_MESSAGES) === false) {
            return 'file_upload:error_unknown';
        }
        return self::FILE_UPLOAD_ERROR_MESSAGES[$errorCode];
    }

    /**
     * Move a temporary file into data/tmp/deleted for safekeeping.
     *
     * @return bool true if moved, false if no move performed
     */
    public static function moveToDeleted(string $fromFile): bool
    {
        $basename = basename($fromFile);
        $basepath = dirname($fromFile);
        if (!is_file($fromFile)) {
            return false;
        }

        $targetDir = $basepath . DIRECTORY_SEPARATOR . 'deleted';
        self::createDirectory($targetDir);

        $target = $targetDir . DIRECTORY_SEPARATOR . $basename;
        if (file_exists($target)) {
            $target = $targetDir . DIRECTORY_SEPARATOR . pathinfo($basename, PATHINFO_FILENAME) . '-' . uniqid() . '.' . pathinfo($basename, PATHINFO_EXTENSION);
        }

        return @rename($fromFile, $target);
    }

    /**
     * @throws \Exception
     */
    public static function getFilesFromPath(string $path, array $allowedExtensions = []): array
    {
        if (!PathUtility::isAbsolutePath($path)) {
            $path = PathUtility::getAbsolutePath($path);
        }
        if (!PathUtility::isAbsolutePath($path)) {
            throw new \Exception('Path ' . $path . ' does not exist.');
        }

        $files = [];
        foreach (new \DirectoryIterator($path) as $file) {
            if (!$file->isFile() || !in_array(strtolower($file->getExtension()), $allowedExtensions)) {
                continue;
            }
            $files[] = $path . '/' . $file->getFilename();
        }

        return $files;
    }
}
