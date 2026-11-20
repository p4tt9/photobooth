<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\ConfigurationService;
use Photobooth\Service\RenderService;
use PHPUnit\Framework\TestCase;

final class RenderServiceTest extends TestCase
{
    private function config(array $overrides = []): array
    {
        $directory = sys_get_temp_dir() . '/snaphora-render-test-' . bin2hex(random_bytes(4));
        mkdir($directory);
        $service = new ConfigurationService($directory);
        $config = array_replace_recursive($service->getConfiguration(), $overrides);
        rmdir($directory);

        return $config;
    }

    public function testDefaultSettingsUseThePipeline(): void
    {
        $service = new RenderService($this->config());

        $this->assertNull($service->photoFallbackReason(), 'Standard-Einstellungen inkl. Rahmen-Erweiterung');
        $this->assertNull($service->printFallbackReason());
    }

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function unsupportedPhotoSettings(): array
    {
        return [
            'Text auf dem Foto' => [['textonpicture' => ['enabled' => true]], 'Text'],
            'Polaroid' => [['picture' => ['polaroid_effect' => true]], 'Polaroid'],
            'Drehung' => [['picture' => ['rotation' => 90]], 'Drehung'],
            'Spiegeln' => [['picture' => ['flip' => 'flip-horizontal']], 'Spiegeln'],
            'ausgeschaltet' => [['render' => ['enabled' => false]], 'ausgeschaltet'],
        ];
    }

    /**
     * Was die Pipeline noch nicht kann, muss über GD laufen – sonst fehlt etwas auf dem Foto.
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('unsupportedPhotoSettings')]
    public function testUnsupportedPhotoSettingsFallBackToGd(array $overrides, string $reason): void
    {
        $this->assertStringContainsString($reason, (string) (new RenderService($this->config($overrides)))->photoFallbackReason());
    }

    public function testTextOnPrintFallsBackToGd(): void
    {
        $service = new RenderService($this->config(['textonprint' => ['enabled' => true]]));

        $this->assertNotNull($service->printFallbackReason());
    }

    public function testUnreachableServiceReportsFailureInsteadOfThrowing(): void
    {
        $service = new RenderService($this->config(['render' => ['url' => 'http://127.0.0.1:9']]));

        $this->assertNull($service->preparePrint('20261120_120000.jpg'));
        $this->assertSame([], $service->listLooks());
    }
}
