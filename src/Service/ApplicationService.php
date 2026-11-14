<?php

namespace Photobooth\Service;

use Photobooth\Utility\PathUtility;

class ApplicationService
{
    private const DEV_PLACEHOLDER_VERSION = '4.99.0';

    protected string $version;

    public function __construct()
    {
        $this->version = $this->calculatePhotoboothVersion();
    }

    public function getTitle(): string
    {
        return 'Photobooth';
    }

    public function getVersion(): string
    {
        return $this->version;
    }

    protected function calculatePhotoboothVersion(): string
    {
        // Im Container-Image gibt es kein .git; die Version wird beim Bauen gesetzt.
        $imageVersion = getenv('APP_VERSION');
        if (is_string($imageVersion) && $imageVersion !== '') {
            return $imageVersion;
        }

        $packageJsonPath = PathUtility::getRootPath() . DIRECTORY_SEPARATOR . 'package.json';
        if (!is_file($packageJsonPath)) {
            throw new \Exception('Package file not found.');
        }
        $packageContent = file_get_contents($packageJsonPath);
        if ($packageContent === false) {
            throw new \Exception('Error loading package file: ' . $packageJsonPath);
        }
        $package = json_decode($packageContent, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \Exception('Error decoding package file: ' . json_last_error_msg());
        }

        $gitVersion = '';
        $version = '';
        if ($package['version'] === self::DEV_PLACEHOLDER_VERSION) {
            $gitVersion = $this->getGitVersion();
        } else {
            $version = $package['version'] ?? 'unknown';
        }

        return $gitVersion ? $version . ' ' . $gitVersion : $version;
    }

    private function getGitVersion(): string
    {
        if (!is_dir(PathUtility::getRootPath() . DIRECTORY_SEPARATOR . '.git')) {
            return '';
        }

        $hash = trim(shell_exec('git rev-parse --short HEAD') ?: '');
        $date = trim(shell_exec('git log -1 --format=%cd --date=short') ?: '');

        if ($hash && $date) {
            return sprintf('%s-dev %s', $hash, $date);
        }

        return $hash ? sprintf('%s-dev', $hash) : '';
    }

    /**
     * Snaphora-Fork: Es wird nicht mehr beim Original-Projekt nach Updates gefragt.
     * Welche Version die Box nutzt, gibt künftig der Snaphora-Server vor (Agent),
     * daher gilt die installierte Version immer als die aktuelle.
     */
    public function getLatestRelease(): string
    {
        return $this->getVersion();
    }

    /**
     * Check whether an update to the photobooth software is available.
     */
    public function checkUpdate(): bool
    {
        try {
            $remoteVersion = $this->getLatestRelease();
            $localVersion = $this->getVersion();
            $updateAvailable = version_compare($localVersion, $remoteVersion, '<');

            return $updateAvailable;
        } catch (\Exception $e) {
            return false;
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
