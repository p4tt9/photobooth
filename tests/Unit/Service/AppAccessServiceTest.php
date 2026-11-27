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
            'alte Verwaltung' => ['admin/index.php', true],
            'Upload in der Verwaltung' => ['admin/upload/index.php', true],
            'Testseiten' => ['test/photo.php', true],
            'Einstellungen speichern' => ['api/admin.php', true],
            'Neustart' => ['api/shellCommand.php', true],
            'Bild-Datenbank neu aufbauen' => ['api/rebuildImageDB.php', true],
            'Server-Infos' => ['api/serverInfo.php', true],
            'Startseite' => ['index.php', false],
            'Aufnahme' => ['api/capture.php', false],
            'Druck' => ['api/print.php', false],
            'Galerie' => ['gallery/index.php', false],
            'Anmeldung' => ['login/index.php', false],
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
