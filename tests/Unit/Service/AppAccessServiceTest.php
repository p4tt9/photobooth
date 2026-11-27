<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\AppAccessService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class AppAccessServiceTest extends TestCase
{
    /**
     * @return array<string, array{string, bool}>
     */
    public static function pathProvider(): array
    {
        return [
            'Ordner der früheren Verwaltung' => ['admin/index.php', true],
            'Ordner der früheren Testseiten' => ['test/photo.php', true],
            'Befehl vor/nach dem Foto (Gäste-Ablauf)' => ['api/shellCommand.php', false],
            'Startseite' => ['index.php', false],
            'Aufnahme' => ['api/capture.php', false],
            'Druck' => ['api/print.php', false],
            'Galerie' => ['gallery/index.php', false],
            'unbekannter Ort' => ['', true],
        ];
    }

    #[DataProvider('pathProvider')]
    public function testOnlyAdminPathsNeedAnAdminSession(string $path, bool $protected): void
    {
        $this->assertSame($protected, AppAccessService::requiresAdmin($path === '' ? null : $path));
    }

    public function testSelftestIsOpenToSetupStaffButNotToGuests(): void
    {
        $this->assertTrue(AppAccessService::requiresSetup('api/selftest.php'));
        $this->assertFalse(AppAccessService::requiresSetup('api/capture.php'));
        $this->assertFalse(AppAccessService::requiresSetup(null));
    }

    public function testScriptOutsideTheRootCountsAsProtected(): void
    {
        $root = dirname(__DIR__, 3);
        $this->assertSame('tests/Unit/Service/AppAccessServiceTest.php', AppAccessService::relativePath(__FILE__, $root));
        $this->assertNull(AppAccessService::relativePath('/etc/hosts', $root));
        $this->assertNull(AppAccessService::relativePath(__FILE__, ''), 'leere Wurzel heißt nicht „alles erlaubt“');
        $this->assertNull(AppAccessService::relativePath('', $root));
    }
}
