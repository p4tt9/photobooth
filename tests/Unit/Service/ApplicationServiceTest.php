<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\ApplicationService;
use PHPUnit\Framework\TestCase;

final class ApplicationServiceTest extends TestCase
{
    private string|false $previousVersion;

    protected function setUp(): void
    {
        $this->previousVersion = getenv('APP_VERSION');
    }

    protected function tearDown(): void
    {
        putenv($this->previousVersion === false ? 'APP_VERSION' : 'APP_VERSION=' . $this->previousVersion);
    }

    public function testVersionComesFromImageWhenSet(): void
    {
        putenv('APP_VERSION=1.2.3 (abc1234)');

        $this->assertSame('1.2.3 (abc1234)', (new ApplicationService())->getVersion());
    }

    public function testNoUpdateIsReportedFromUpstream(): void
    {
        putenv('APP_VERSION=1.2.3');
        $service = new ApplicationService();

        $this->assertSame('1.2.3', $service->getLatestRelease());
        $this->assertFalse($service->checkUpdate());
    }
}
