<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\ConfigurationService;
use PHPUnit\Framework\TestCase;

final class ConfigurationServiceTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/snaphora-config-test-' . bin2hex(random_bytes(4));
        mkdir($this->directory);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->directory));
    }

    private function writeConfig(string $file, string $content): void
    {
        file_put_contents($this->directory . '/' . $file, $content);
        if (function_exists('opcache_invalidate')) {
            opcache_invalidate($this->directory . '/' . $file, true);
        }
    }

    public function testWithoutUserConfigurationDefaultsAreUsed(): void
    {
        $service = new ConfigurationService($this->directory);

        $this->assertSame(
            $service->getDefaultConfiguration()['print']['limit'],
            $service->getConfiguration()['print']['limit'],
        );
    }

    public function testSaveKeepsBackupOfPreviousVersion(): void
    {
        $service = new ConfigurationService($this->directory);
        $config = $service->getConfiguration();

        $config['print']['limit'] = 200;
        $service->update($config);
        $config['print']['limit'] = 400;
        $service->update($config);

        $this->assertSame(400, (new ConfigurationService($this->directory))->getConfiguration()['print']['limit']);
        $this->assertFileExists($this->directory . '/' . ConfigurationService::BACKUP_CONFIGURATION_FILE);
        $this->assertStringContainsString("'limit' => 200", (string) file_get_contents($this->directory . '/' . ConfigurationService::BACKUP_CONFIGURATION_FILE));
    }

    /**
     * @return array<string, array{string}>
     */
    public static function damagedConfigurationProvider(): array
    {
        return [
            'empty file' => [''],
            'cut off in the middle' => ["<?php\n\nreturn [\n    'print' => [\n        'lim"],
            'returns no array' => ["<?php\n\nreturn 1;\n"],
        ];
    }

    /**
     * Before: a configuration cut off while saving made every page fail – the box was dead.
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('damagedConfigurationProvider')]
    public function testDamagedConfigurationFallsBackToBackup(string $damagedContent): void
    {
        $this->writeConfig(ConfigurationService::BACKUP_CONFIGURATION_FILE, "<?php\n\nreturn ['print' => ['limit' => 200]];\n");
        $this->writeConfig(ConfigurationService::USER_CONFIGURATION_FILE, $damagedContent);

        $service = new ConfigurationService($this->directory);

        $this->assertSame(200, $service->getConfiguration()['print']['limit']);
    }

    public function testDamagedConfigurationWithoutBackupFallsBackToDefaults(): void
    {
        $this->writeConfig(ConfigurationService::USER_CONFIGURATION_FILE, "<?php\n\nreturn [");

        $service = new ConfigurationService($this->directory);

        $this->assertSame(
            $service->getDefaultConfiguration()['print']['limit'],
            $service->getConfiguration()['print']['limit'],
        );
    }

    public function testDamagedConfigurationDoesNotOverwriteGoodBackup(): void
    {
        $this->writeConfig(ConfigurationService::BACKUP_CONFIGURATION_FILE, "<?php\n\nreturn ['print' => ['limit' => 200]];\n");
        $this->writeConfig(ConfigurationService::USER_CONFIGURATION_FILE, '');

        $service = new ConfigurationService($this->directory);
        $config = $service->getConfiguration();
        $config['print']['limit'] = 400;
        $service->update($config);

        $this->assertStringContainsString("'limit' => 200", (string) file_get_contents($this->directory . '/' . ConfigurationService::BACKUP_CONFIGURATION_FILE));
    }

    public function testBackupIsIgnoredAfterReset(): void
    {
        $this->writeConfig(ConfigurationService::BACKUP_CONFIGURATION_FILE, "<?php\n\nreturn ['print' => ['limit' => 200]];\n");

        $service = new ConfigurationService($this->directory);

        $this->assertSame($service->getDefaultConfiguration()['print']['limit'], $service->getConfiguration()['print']['limit']);
    }
}
