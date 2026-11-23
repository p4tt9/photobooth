<?php

namespace Photobooth\Service;

use Photobooth\Config\Loader\PhpArrayLoader;
use Photobooth\Configuration\PhotoboothConfiguration;
use Photobooth\Environment;
use Photobooth\Utility\ArrayUtility;
use Photobooth\Utility\FileUtility;
use Photobooth\Utility\PathUtility;
use Symfony\Component\Config\Definition\Processor;
use Symfony\Component\Config\FileLocator;
use Symfony\Component\Config\Loader\LoaderResolver;
use Symfony\Component\Config\Loader\DelegatingLoader;

class ConfigurationService
{
    /**
     * Configuration layers (concept 4.4, planning/ARCHITEKTUR.md), applied from bottom to top:
     *   defaults → device (server) → box (local, box-wide) → event (server) → local-event
     * The agent writes device.json and event.json. box.json and local-event.json belong to the new app
     * (box/apps/app); this class still writes them for the old admin panel until it is removed (package 7e).
     * local-event.json holds changes made on the box to settings the event controls; they apply only while
     * that event is active.
     */
    public const LAYER_DIRECTORY = 'layers';
    public const LAYER_DEVICE = 'device';
    public const LAYER_BOX = 'box';
    public const LAYER_EVENT = 'event';
    public const LAYER_LOCAL_EVENT = 'local-event';

    /**
     * Until package 7 the box settings were PHP code in config/my.config.inc.php. They are migrated once into
     * layers/box.json; the old files are kept as *.migrated.
     */
    public const LEGACY_CONFIGURATION_FILE = 'my.config.inc.php';
    public const LEGACY_BACKUP_FILE = 'my.config.inc.php.bak';

    /**
     * Sections no layer may set: they come from the image or the provisioning (environment variables
     * SNAPHORA_COMMAND_<NAME>). Shell commands in a savable setting would allow anyone who can save settings
     * to run code on the box.
     */
    public const PROTECTED_SECTIONS = ['commands'];

    protected array $defaultConfiguration;
    protected array $configuration;
    protected array $processedConfiguration;
    protected string $configDirectory;

    /**
     * File the box layer was loaded from (null = none, only defaults and server layers).
     */
    protected ?string $loadedFrom = null;

    /**
     * Box-wide local settings (layers/box.json).
     */
    protected array $userConfiguration = [];

    /**
     * Layer files: {"config": {...}} plus deviceId/eventId, version, name.
     *
     * @var array<string, mixed>|null
     */
    protected ?array $deviceLayer = null;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $eventLayer = null;

    protected array $localEventConfiguration = [];

    public function __construct(?string $configDirectory = null)
    {
        $this->configDirectory = $configDirectory ?? PathUtility::getAbsolutePath('config');
        $this->load();
    }

    public function load(): void
    {
        $fileLocator = new FileLocator($this->configDirectory);
        $loaderResolver = new LoaderResolver([
            new PhpArrayLoader($fileLocator),
        ]);
        $loader = new DelegatingLoader($loaderResolver);

        // default configuration
        $this->defaultConfiguration = (new Processor())->processConfiguration(new PhotoboothConfiguration(), [[]]);

        // configuration layers
        $this->migrateLegacyConfiguration($loader);
        $this->userConfiguration = $this->loadBoxLayer();
        $this->deviceLayer = $this->loadLayer(self::LAYER_DEVICE);
        $this->eventLayer = $this->loadLayer(self::LAYER_EVENT);
        if ($this->eventLayer !== null && !is_string($this->eventLayer['eventId'] ?? null)) {
            error_log('Configuration layer event.json has no eventId, ignoring it');
            $this->eventLayer = null;
        }
        $this->localEventConfiguration = [];
        if ($this->eventLayer !== null) {
            $localEvent = $this->loadLayer(self::LAYER_LOCAL_EVENT);
            // Local changes belong to one event: after a switch they no longer apply.
            if ($localEvent !== null && ($localEvent['eventId'] ?? null) === $this->eventLayer['eventId']) {
                $this->localEventConfiguration = $localEvent['config'];
            }
        }

        $configuration = (new Processor())->processConfiguration(new PhotoboothConfiguration(), [
            array_replace($this->mergedLayers(), ['commands' => $this->commandsFromEnvironment()]),
        ]);
        $configuration = $this->addDefaults($configuration);
        $this->configuration = $configuration;
    }

    /**
     * All layers merged from bottom to top (unprocessed). $userConfiguration replaces my.config.inc.php.
     */
    protected function mergedLayers(?array $userConfiguration = null, bool $withEvent = true): array
    {
        $merged = ArrayUtility::replaceLayer([], $this->deviceLayer['config'] ?? []);
        $merged = ArrayUtility::replaceLayer($merged, $userConfiguration ?? $this->userConfiguration);
        if ($withEvent && $this->eventLayer !== null) {
            $merged = ArrayUtility::replaceLayer($merged, $this->eventLayer['config']);
            $merged = ArrayUtility::replaceLayer($merged, $this->localEventConfiguration);
        }

        return $merged;
    }

    /**
     * Reads config/layers/<name>.json. A missing, damaged or invalid layer is skipped – the box must
     * always start, in the worst case with its local settings.
     *
     * @return array<string, mixed>|null
     */
    protected function loadLayer(string $name): ?array
    {
        return $this->loadLayerFile($this->getLayerFile($name));
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function loadLayerFile(string $file): ?array
    {
        if (!file_exists($file)) {
            return null;
        }
        $content = @file_get_contents($file);
        $layer = is_string($content) ? json_decode($content, true) : null;
        if (!is_array($layer) || !is_array($layer['config'] ?? null)) {
            error_log('Configuration layer ' . $file . ' is damaged, ignoring it');

            return null;
        }
        $layer['config'] = self::withoutProtectedSections($layer['config']);
        try {
            (new Processor())->processConfiguration(new PhotoboothConfiguration(), [$layer['config']]);
        } catch (\Throwable $e) {
            error_log('Configuration layer ' . $file . ' is invalid, ignoring it: ' . $e->getMessage());

            return null;
        }

        return $layer;
    }

    public function getLayerFile(string $name): string
    {
        return $this->configDirectory . DIRECTORY_SEPARATOR . self::LAYER_DIRECTORY . DIRECTORY_SEPARATOR . $name . '.json';
    }

    /**
     * The event whose settings are active (from the server), or null if the box runs on its local settings.
     *
     * @return array{eventId: string, version: int|null, name: string|null}|null
     */
    public function getActiveEvent(): ?array
    {
        if ($this->eventLayer === null) {
            return null;
        }

        return [
            'eventId' => $this->eventLayer['eventId'],
            'version' => isset($this->eventLayer['version']) ? (int) $this->eventLayer['version'] : null,
            'name' => isset($this->eventLayer['name']) ? (string) $this->eventLayer['name'] : null,
        ];
    }

    /**
     * Settings changed on the box for the active event (empty without event).
     */
    public function getLocalEventConfiguration(): array
    {
        return $this->localEventConfiguration;
    }

    /**
     * Loads layers/box.json, or the backup of the last good version if it is damaged – a power loss while
     * saving never costs the box its settings.
     */
    protected function loadBoxLayer(): array
    {
        $this->loadedFrom = null;
        $file = $this->getLayerFile(self::LAYER_BOX);
        foreach ([$file, $file . '.bak'] as $candidate) {
            $layer = $this->loadLayerFile($candidate);
            if ($layer !== null) {
                if ($candidate !== $file) {
                    error_log('Configuration layer ' . $file . ' is damaged or missing, using the backup ' . $candidate);
                }
                $this->loadedFrom = $candidate;

                return $layer['config'];
            }
        }

        return [];
    }

    /**
     * One-time migration of my.config.inc.php into layers/box.json (package 7). Shell commands are not taken
     * over (PROTECTED_SECTIONS); custom ones are logged so they can be moved to the provisioning.
     */
    protected function migrateLegacyConfiguration(DelegatingLoader $loader): void
    {
        $boxFile = $this->getLayerFile(self::LAYER_BOX);
        if (file_exists($boxFile) || file_exists($boxFile . '.bak')) {
            return;
        }
        foreach ([self::LEGACY_CONFIGURATION_FILE, self::LEGACY_BACKUP_FILE] as $file) {
            $path = $this->configDirectory . DIRECTORY_SEPARATOR . $file;
            if (!file_exists($path)) {
                continue;
            }
            try {
                $raw = $loader->load($file, 'php_array');
                // Only what the old file really contained (path normalization adds empty placeholders)
                $legacy = ArrayUtility::intersectPaths($this->processMigration($raw), $raw);
                (new Processor())->processConfiguration(new PhotoboothConfiguration(), [$legacy]);
            } catch (\Throwable $e) {
                error_log('Configuration ' . $file . ' could not be migrated: ' . $e->getMessage());
                continue;
            }
            $config = self::withoutProtectedSections($legacy);
            foreach (self::PROTECTED_SECTIONS as $section) {
                if (!empty($legacy[$section])) {
                    error_log('Migration: settings in "' . $section . '" are no longer taken from the configuration, set them in the provisioning instead: ' . json_encode($legacy[$section]));
                }
            }
            $this->writeLayerFile($boxFile, ['migratedFrom' => $file, 'updated' => date(DATE_ATOM), 'config' => $config]);
            foreach ([self::LEGACY_CONFIGURATION_FILE, self::LEGACY_BACKUP_FILE] as $old) {
                $oldPath = $this->configDirectory . DIRECTORY_SEPARATOR . $old;
                if (file_exists($oldPath)) {
                    rename($oldPath, $oldPath . '.migrated');
                }
            }
            error_log('Configuration ' . $file . ' migrated to ' . $boxFile);

            return;
        }
    }

    /**
     * Commands come from the image defaults, overridable only by the provisioning: SNAPHORA_COMMAND_PRINT etc.
     *
     * @return array<string, string>
     */
    protected function commandsFromEnvironment(): array
    {
        $commands = [];
        foreach (array_keys($this->defaultConfiguration['commands'] ?? []) as $name) {
            $name = (string) $name;
            $value = getenv('SNAPHORA_COMMAND_' . strtoupper($name));
            // Empty = not set (compose passes unset variables as empty strings)
            if ($value !== false && $value !== '') {
                $commands[$name] = $value;
            }
        }

        return $commands;
    }

    public static function withoutProtectedSections(array $config): array
    {
        foreach (self::PROTECTED_SECTIONS as $section) {
            unset($config[$section]);
        }

        return $config;
    }

    /**
     * @param array<string, mixed> $layer
     */
    protected function writeLayerFile(string $file, array $layer): void
    {
        FileUtility::createDirectory(dirname($file));
        // An empty config must stay an object in JSON
        $layer['config'] = (object) $layer['config'];
        FileUtility::writeAtomic($file, (string) json_encode($layer, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    public function update(array $data): void
    {
        $processor = new Processor();
        $data = $processor->processConfiguration(new PhotoboothConfiguration(), [$data]);

        // box.json keeps only what differs from defaults + device settings of the server.
        $below = $processor->processConfiguration(new PhotoboothConfiguration(), [$this->mergedLayers([], false)]);
        $userConfiguration = ArrayUtility::diffRecursive($data, $below);

        $localEvent = null;
        if ($this->eventLayer !== null) {
            // Settings the event controls: changes on the box are stored for this event only, and the
            // box-wide values in box.json stay as they were.
            $managed = $this->eventLayer['config'];
            $userConfiguration = ArrayUtility::replaceLayer(
                ArrayUtility::removePaths($userConfiguration, $managed),
                ArrayUtility::intersectPaths($this->userConfiguration, $managed)
            );
            $eventBase = $processor->processConfiguration(new PhotoboothConfiguration(), [
                ArrayUtility::replaceLayer(ArrayUtility::replaceLayer(
                    ArrayUtility::replaceLayer([], $this->deviceLayer['config'] ?? []),
                    $userConfiguration
                ), $managed),
            ]);
            $localEvent = ArrayUtility::intersectPaths(ArrayUtility::diffRecursive($data, $eventBase), $managed);
        }

        $userConfiguration = self::withoutProtectedSections($userConfiguration);
        $boxFile = $this->getUserConfigurationFile();
        try {
            // Keep the current file as the fallback – but only if it is known to be good.
            if ($this->loadedFrom === $boxFile && file_exists($boxFile)) {
                FileUtility::copyAtomic($boxFile, $boxFile . '.bak');
            }
            $this->writeLayerFile($boxFile, ['updated' => date(DATE_ATOM), 'config' => $userConfiguration]);
        } catch (\RuntimeException $e) {
            throw new \RuntimeException('Config can not be saved!', 0, $e);
        }

        $this->loadedFrom = $boxFile;
        $this->userConfiguration = $userConfiguration;

        if ($this->eventLayer !== null && $localEvent !== null) {
            $layer = ['eventId' => $this->eventLayer['eventId'], 'updated' => date(DATE_ATOM), 'config' => $localEvent];
            try {
                $this->writeLayerFile($this->getLayerFile(self::LAYER_LOCAL_EVENT), $layer);
            } catch (\RuntimeException $e) {
                throw new \RuntimeException('Config can not be saved!', 0, $e);
            }
            $this->localEventConfiguration = $localEvent;
        }
    }

    /**
     * The box-wide local settings (layers/box.json).
     */
    public function getUserConfigurationFile(): string
    {
        return $this->getLayerFile(self::LAYER_BOX);
    }

    /**
     * Removes the user configuration and its backup (reset to defaults).
     */
    public function reset(): void
    {
        foreach ([$this->getUserConfigurationFile(), $this->getUserConfigurationFile() . '.bak'] as $path) {
            if (file_exists($path)) {
                unlink($path);
            }
        }
        // Local changes for the event go, too. The layers of the server (device, event) stay.
        if (file_exists($this->getLayerFile(self::LAYER_LOCAL_EVENT))) {
            unlink($this->getLayerFile(self::LAYER_LOCAL_EVENT));
        }
        $this->loadedFrom = null;
        $this->userConfiguration = [];
        $this->localEventConfiguration = [];
    }

    protected function addDefaults(array $config): array
    {
        $default_font  = 'resources/fonts/GreatVibes-Regular.ttf';
        $default_frame = 'resources/img/frames/frame.png';
        $random_frame  = 'api/randomImg.php?dir=demoframes';

        if (empty($config['picture']['frame'])) {
            $config['picture']['frame'] = $random_frame;
        }

        if (empty($config['textonpicture']['font'])) {
            $config['textonpicture']['font'] = $default_font;
        }

        if (empty($config['collage']['frame'])) {
            $config['collage']['frame'] = $default_frame;
        }

        if (empty($config['collage']['placeholderpath'])) {
            $config['collage']['placeholderpath'] = 'resources/img/background/01.jpg';
        }

        if (empty($config['textoncollage']['font'])) {
            $config['textoncollage']['font'] = $default_font;
        }

        if (empty($config['print']['frame'])) {
            $config['print']['frame'] = $default_frame;
        }

        if (empty($config['textonprint']['font'])) {
            $config['textonprint']['font'] = $default_font;
        }

        if (empty($config['collage']['limit'])) {
            $config['collage']['limit'] = 4;
        }

        $bg_path = 'resources/img/background.png';
        $logo_url = 'resources/img/logo/logo-qrcode-text.png';
        if (empty($config['logo']['path'])) {
            $config['logo']['path'] = $logo_url;
        }

        if (empty($config['background']['defaults'])) {
            $config['background']['defaults'] = $bg_path;
        }

        if (empty($config['background']['admin'])) {
            $config['background']['admin'] = $bg_path;
        }

        if (empty($config['remotebuzzer']['serverip'])) {
            $config['remotebuzzer']['serverip'] = Environment::getIp();
        }

        if (empty($config['qr']['url'])) {
            $config['qr']['url'] = 'view.php?image=';
        }

        return $config;
    }

    protected function processMigration(array $config): array
    {
        // Normalize legacy paths that may contain absolute URLs or subfolder prefixes (e.g. /photobooth/)
        $baseUrl  = PathUtility::getBaseUrl();
        $hostBase = '';
        if (isset($_SERVER['HTTP_HOST'])) {
            $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] != 'off') ? 'https' : 'http';
            $hostBase = $scheme . '://' . $_SERVER['HTTP_HOST'] . $baseUrl;
        }

        $normalizePath = static function (?string $path) use ($baseUrl, $hostBase): ?string {
            if ($path === null || $path === '') {
                return $path;
            }

            $value = (string)$path;

            // Strip surrounding url("...") / url('...') / url(...)
            if (substr($value, 0, 4) === 'url(' && substr($value, -1) === ')') {
                $value = trim(substr($value, 4, -1), '"\'');
            }

            // Strip project root based absolute paths
            try {
                $rootPath = PathUtility::getRootPath();
                if (str_starts_with($value, $rootPath)) {
                    $value = substr($value, strlen($rootPath));
                }
            } catch (\InvalidArgumentException) {
                // ignore if root path can't be resolved in this context
            }

            // Remove full host+base prefix, e.g. "https://host/photobooth/"
            if ($hostBase !== '' && str_starts_with($value, $hostBase)) {
                $value = substr($value, strlen($hostBase));
            }

            // Remove base URL prefix, e.g. "/photobooth/"
            if ($baseUrl !== '' && str_starts_with($value, $baseUrl)) {
                $value = substr($value, strlen($baseUrl));
            }

            // If path still contains a known project-relative marker, strip everything before it
            foreach (['/private/', '/resources/'] as $marker) {
                $pos = strpos($value, $marker);
                if ($pos !== false) {
                    $value = substr($value, $pos);
                    break;
                }
            }

            return $value;
        };

        // Migrate Commands
        $commands = [
            'take_picture',
            'take_custom',
            'print',
            'exiftool',
            'preview',
            'nodebin',
            'pre_photo',
            'post_photo',
            'reboot',
            'shutdown',
        ];
        foreach ($commands as $command) {
            if (isset($config[$command]['cmd'])) {
                $config['commands'][$command] = $config[$command]['cmd'];
                unset($config[$command]['cmd']);
                if (count($config[$command]) === 0) {
                    unset($config[$command]);
                }
            }
        }
        if (isset($config['preview']['killcmd']) && trim($config['preview']['killcmd']) !== '') {
            $config['commands']['preview_kill'] = trim($config['preview']['killcmd']);
        }

        // Migrate Preview Mode
        if (isset($config['preview']['mode']) && $config['preview']['mode'] === 'gphoto') {
            $config['preview']['mode'] = 'device_cam';
        }

        // Migrate Preview URL, remove surrounding url("...")
        if (isset($config['preview']['url']) && substr($config['preview']['url'], 0, 4) === 'url(' && substr($config['preview']['url'], -1) === ')') {
            $config['preview']['url'] = trim(substr($config['preview']['url'], 4, -1), '"\'');
        }

        // Migrate screensaver switch interval from minutes to seconds
        if (isset($config['screensaver'])) {
            if (isset($config['screensaver']['switch_minutes']) && !isset($config['screensaver']['switch_seconds'])) {
                $config['screensaver']['switch_seconds'] = (int)$config['screensaver']['switch_minutes'] * 60;
            }
            unset($config['screensaver']['switch_minutes']);
        }

        // Migrate button font color from old colors config
        if (!empty($config['colors']['button_font']) && empty($config['fonts']['button_font_color'])) {
            $config['fonts']['button_font_color'] = $config['colors']['button_font'];
        }

        // Migrate countdown color from colors to fonts section
        if (!empty($config['colors']['countdown']) && empty($config['fonts']['countdown_text_color'])) {
            $config['fonts']['countdown_text_color'] = $config['colors']['countdown'];
        }

        // Migrate start font color to new font slots if empty
        if (!empty($config['colors']['start_font'])) {
            if (empty($config['fonts']['start_screen_title_color'])) {
                $config['fonts']['start_screen_title_color'] = $config['colors']['start_font'];
            }
            if (empty($config['fonts']['event_text_color'])) {
                $config['fonts']['event_text_color'] = $config['colors']['start_font'];
            }
        }

        // Migrate general font color to default font color
        if (!empty($config['colors']['font']) && empty($config['fonts']['default_color'])) {
            $config['fonts']['default_color'] = $config['colors']['font'];
        }

        // Migrate Background URLs
        if (isset($config['background']) && is_array($config['background'])) {
            $baseUrl = PathUtility::getBaseUrl();
            foreach (['defaults', 'admin'] as $backgroundKey) {
                if (!isset($config['background'][$backgroundKey]) || $config['background'][$backgroundKey] === '') {
                    continue;
                }

                $value = (string)$config['background'][$backgroundKey];

                // Strip surrounding url("...") / url('...') / url(...)
                if (substr($value, 0, 4) === 'url(' && substr($value, -1) === ')') {
                    $value = trim(substr($value, 4, -1), '"\'');
                }

                // Strip document root based absolute paths
                if (isset($_SERVER['DOCUMENT_ROOT']) && str_starts_with($value, $_SERVER['DOCUMENT_ROOT'])) {
                    $value = substr($value, strlen($_SERVER['DOCUMENT_ROOT']));
                }

                // Strip leading base URL so only a relative path is stored
                if ($baseUrl !== '' && str_starts_with($value, $baseUrl)) {
                    $value = substr($value, strlen($baseUrl));
                }

                // Normalize leading slash
                $value = ltrim($value, '/');

                $config['background'][$backgroundKey] = $value;
            }
        }

        // Normalize various media and font paths to be project-relative
        $config['logo']['path']               = $normalizePath($config['logo']['path'] ?? null);
        $config['ui']['shutter_cheese_img']   = $normalizePath($config['ui']['shutter_cheese_img'] ?? null);
        $config['picture']['frame']           = $normalizePath($config['picture']['frame'] ?? null);
        $config['collage']['frame']           = $normalizePath($config['collage']['frame'] ?? null);
        $config['collage']['placeholderpath'] = $normalizePath($config['collage']['placeholderpath'] ?? null);
        $config['background']['defaults']     = $normalizePath($config['background']['defaults'] ?? null);
        $config['background']['admin']        = $normalizePath($config['background']['admin'] ?? null);
        $config['textonpicture']['font']      = $normalizePath($config['textonpicture']['font'] ?? null);
        $config['textoncollage']['font']      = $normalizePath($config['textoncollage']['font'] ?? null);
        $config['textonprint']['font']        = $normalizePath($config['textonprint']['font'] ?? null);
        $config['print']['frame']             = $normalizePath($config['print']['frame'] ?? null);

        // Hash legacy plain-text login pins
        $hashPinIfNeeded = static function (?string $pin): ?string {
            if ($pin === null || $pin === '') {
                return $pin;
            }
            $info = password_get_info($pin);
            if (($info['algo'] ?? 0) !== 0) {
                return $pin;
            }

            return password_hash($pin, PASSWORD_DEFAULT);
        };

        if (array_key_exists('login', $config)) {
            if (array_key_exists('pin', $config['login'])) {
                $config['login']['pin'] = $hashPinIfNeeded($config['login']['pin']);
            }
            if (array_key_exists('rental_pin', $config['login'])) {
                $config['login']['rental_pin'] = $hashPinIfNeeded($config['login']['rental_pin']);
            }
        }

        return $config;
    }

    public function getDefaultConfiguration(): array
    {
        return $this->defaultConfiguration;
    }

    public function getConfiguration(): array
    {
        return $this->configuration;
    }

    public static function getInstance(): self
    {
        if (!isset($GLOBALS[self::class])) {
            $GLOBALS[self::class] = new self();
        }

        return $GLOBALS[self::class];
    }
}
