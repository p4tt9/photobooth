<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\ConfigurationService;
use PHPUnit\Framework\TestCase;

/**
 * Konfigurations-Ebenen (Konzept 4.4): Standard → Gerät (Server) → lokal → Event (Server) → lokal fürs Event.
 */
final class ConfigurationLayersTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/snaphora-layers-test-' . bin2hex(random_bytes(4));
        mkdir($this->directory . '/layers', 0777, true);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->directory));
    }

    private function writeLayer(string $name, array $layer): void
    {
        file_put_contents($this->directory . '/layers/' . $name . '.json', json_encode($layer));
    }

    private function service(): ConfigurationService
    {
        if (function_exists('opcache_reset')) {
            opcache_reset();
        }

        return new ConfigurationService($this->directory);
    }

    private function eventLayer(string $eventId = 'evt-1', array $config = []): array
    {
        return ['eventId' => $eventId, 'version' => 3, 'name' => 'Hochzeit', 'config' => $config ?: [
            'start_screen' => ['title' => 'Anna & Ben', 'title_visible' => true],
            'print' => ['limit' => 200],
        ]];
    }

    public function testLayersApplyInOrder(): void
    {
        $this->writeLayer('device', ['deviceId' => 'box-1', 'version' => 1, 'config' => [
            'get_request' => ['countdown' => true, 'server' => 'http://192.168.8.50'],
            'picture' => ['key' => '34'],
        ]]);
        $this->writeLayer('event', $this->eventLayer());
        $service = $this->service();
        $config = $service->getConfiguration();

        $this->assertSame('http://192.168.8.50', $config['get_request']['server'], 'Gerät vom Server');
        $this->assertSame('Anna & Ben', $config['start_screen']['title'], 'Event vom Server');
        $this->assertSame(200, $config['print']['limit']);
        $this->assertSame(['eventId' => 'evt-1', 'version' => 3, 'name' => 'Hochzeit'], $service->getActiveEvent());
    }

    public function testLocalSettingsOverrideDeviceButNotEvent(): void
    {
        $this->writeLayer('device', ['deviceId' => 'box-1', 'version' => 1, 'config' => ['picture' => ['key' => '34']]]);
        file_put_contents($this->directory . '/my.config.inc.php', "<?php return ['picture' => ['key' => '13'], 'start_screen' => ['title' => 'Alt']];");
        $this->writeLayer('event', $this->eventLayer());
        $config = $this->service()->getConfiguration();

        $this->assertSame('13', $config['picture']['key'], 'am Gerät geändert hat Vorrang vor dem Server-Gerätewert');
        $this->assertSame('Anna & Ben', $config['start_screen']['title'], 'Event vom Server gilt vor alten lokalen Werten');
    }

    public function testSavingStoresEventChangesSeparately(): void
    {
        $this->writeLayer('event', $this->eventLayer());
        $service = $this->service();

        $config = $service->getConfiguration();
        $config['print']['limit'] = 400;          // vom Event gesteuert → nur für dieses Event
        $config['picture']['cntdwn_time'] = 3;    // nicht vom Event gesteuert → Box-Einstellung
        $service->update($config);

        $localEvent = json_decode((string) file_get_contents($this->directory . '/layers/local-event.json'), true);
        $this->assertSame('evt-1', $localEvent['eventId']);
        $this->assertSame(['print' => ['limit' => 400]], $localEvent['config']);

        $user = require $this->directory . '/my.config.inc.php';
        $this->assertSame(3, $user['picture']['cntdwn_time']);
        $this->assertArrayNotHasKey('start_screen', $user, 'Event-Werte landen nicht in der Box-Einstellung');
        $this->assertArrayNotHasKey('limit', $user['print'] ?? []);

        $reloaded = $this->service();
        $this->assertSame(400, $reloaded->getConfiguration()['print']['limit']);
        $this->assertSame(['print' => ['limit' => 400]], $reloaded->getLocalEventConfiguration());
    }

    public function testLocalEventChangesDoNotCarryOverToTheNextEvent(): void
    {
        $this->writeLayer('event', $this->eventLayer());
        $service = $this->service();
        $config = $service->getConfiguration();
        $config['print']['limit'] = 400;
        $service->update($config);

        $this->writeLayer('event', $this->eventLayer('evt-2'));
        $this->assertSame(200, $this->service()->getConfiguration()['print']['limit']);
    }

    public function testSavingKeepsLocalValuesOfEventControlledSettings(): void
    {
        file_put_contents($this->directory . '/my.config.inc.php', "<?php return ['start_screen' => ['title' => 'Unsere Box']];");
        $this->writeLayer('event', $this->eventLayer());
        $service = $this->service();
        $service->update($service->getConfiguration());

        $this->writeLayer('event', ['eventId' => 'x', 'config' => []]);
        unlink($this->directory . '/layers/event.json');
        $this->assertSame('Unsere Box', $this->service()->getConfiguration()['start_screen']['title'], 'nach dem Event gilt wieder der eigene Titel');
    }

    public function testDamagedOrInvalidLayersAreIgnored(): void
    {
        file_put_contents($this->directory . '/layers/event.json', '{"eventId": "evt-1", "config": {"print": {"lim');
        $this->writeLayer('device', ['config' => ['picture' => ['cntdwn_time' => 99]]]);
        $service = $this->service();

        $this->assertNull($service->getActiveEvent());
        $this->assertSame($service->getDefaultConfiguration()['picture']['cntdwn_time'], $service->getConfiguration()['picture']['cntdwn_time']);
    }

    public function testListsAreReplacedNotMerged(): void
    {
        file_put_contents($this->directory . '/my.config.inc.php', "<?php return ['collage' => ['layouts_enabled' => ['2+2-2', '2x4', '1+3-1']]];");
        $this->writeLayer('event', $this->eventLayer('evt-1', ['collage' => ['layouts_enabled' => ['2x4']]]));

        $this->assertSame(['2x4'], $this->service()->getConfiguration()['collage']['layouts_enabled']);
    }

    public function testDeviceLayerIsTheBaseForLocalChanges(): void
    {
        $this->writeLayer('device', ['deviceId' => 'box-1', 'version' => 1, 'config' => ['picture' => ['key' => '34']]]);
        $service = $this->service();
        $service->update($service->getConfiguration());

        $user = require $this->directory . '/my.config.inc.php';
        $this->assertArrayNotHasKey('key', $user['picture'] ?? [], 'unveränderter Server-Wert wird nicht lokal festgeschrieben');
    }
}
