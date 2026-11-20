<?php

namespace Photobooth\Utility;

use Exception;

class ImageUtility
{
    public const supportedFileExtensionsProcessing = [
        'gif',
        'png',
        'jpeg',
        'jpg',
    ];

    public const supportedMimeTypesSelect = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/svg+xml',
        'image/bmp',
        'image/webp',
    ];

    public const supportedFileExtensionsSelect = [
        'gif',
        'png',
        'jpeg',
        'jpg',
        'svg',
        'bmp',
        'webp',
    ];

    public const resourcePaths = [
        'resources/img/background',
        'resources/img/frames',
        'resources/img/demo',
        'data/images',
    ];

    /**
     * @throws Exception
     */
    public static function getImagesFromPath(string $path, bool $processing = true): array
    {
        $allowedExtensions = $processing ? self::supportedFileExtensionsProcessing : self::supportedFileExtensionsSelect;

        return FileUtility::getFilesFromPath($path, $allowedExtensions);
    }

    public static function getRandomImageFromPath(string $path): string
    {
        if ($path === '' || $path === 'demoframes') {
            $path = 'resources/img/frames';
        }

        if (!in_array($path, self::resourcePaths) && !str_starts_with($path, 'private/')) {
            $path = 'private/' . $path;
        }

        $files = self::getImagesFromPath($path);
        if (count($files) === 0) {
            throw new Exception('Path ' . $path . ' does not contain images.');
        }

        return $files[array_rand($files)];
    }

    public static function getDemoImages(int $filecount = 0): array
    {
        $folders = [
            'private/images/demo',
            'data/tmp',
            'resources/img/demo',
        ];
        $demoImages = [];

        foreach ($folders as $folder) {
            try {
                $demoImages = self::getImagesFromPath($folder);
            } catch (Exception) {
                $demoImages = [];
            }

            if (!empty($demoImages)) {
                break;
            }
        }

        if (empty($demoImages)) {
            throw new Exception('No images found in any of the demo folders.');
        }

        if ($filecount > 0) {
            $demoCounted = [];
            for ($i = 0; $i < $filecount; $i++) {
                if (empty($demoImages)) {
                    $demoImages = $demoCounted;
                }

                $randomIndex = array_rand($demoImages);
                $demoCounted[] = $demoImages[$randomIndex];
                unset($demoImages[$randomIndex]);
                $demoImages = array_values($demoImages);
            }

            return $demoCounted;
        } else {

            return $demoImages;
        }
    }
}
