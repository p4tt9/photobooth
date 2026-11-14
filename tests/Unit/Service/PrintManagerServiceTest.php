<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\PrintManagerService;
use PHPUnit\Framework\TestCase;

final class PrintManagerServiceTest extends TestCase
{
    private string $directory;
    private PrintManagerService $printManager;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/snaphora-print-test-' . bin2hex(random_bytes(4));
        mkdir($this->directory);

        $this->printManager = new PrintManagerService();
        $this->printManager->printDb = $this->directory . '/printed.csv';
        $this->printManager->printCounter = $this->directory . '/print.count';
        $this->printManager->printLockFile = $this->directory . '/print.lock';
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->directory));
    }

    public function testEveryPrintIsCounted(): void
    {
        $this->assertTrue($this->printManager->addToPrintDb('a.jpg', 'a'));
        $this->assertTrue($this->printManager->addToPrintDb('b.jpg', 'b'));

        $this->assertSame(2, $this->printManager->getPrintCountFromDB());
    }

    public function testPrintCutOffByPowerLossStillCounts(): void
    {
        file_put_contents($this->printManager->printDb, "2026-11-14,12:00:00,a.jpg,a\n2026-11-14,12:01");

        $this->printManager->addToPrintDb('c.jpg', 'c');

        $this->assertSame(3, $this->printManager->getPrintCountFromDB());
    }

    public function testCounterIsStoredAndRead(): void
    {
        $this->printManager->setPrintCounter(42);

        $this->assertSame(42, $this->printManager->getPrintCountFromCounter());
    }

    /**
     * Before: an empty counter file read as 0 – after a power loss the print quota started over.
     */
    public function testDamagedCounterFallsBackToPrintDatabase(): void
    {
        $this->printManager->addToPrintDb('a.jpg', 'a');
        $this->printManager->addToPrintDb('b.jpg', 'b');
        $this->printManager->addToPrintDb('c.jpg', 'c');
        file_put_contents($this->printManager->printCounter, '');

        $this->assertSame(3, $this->printManager->getPrintCountFromCounter());

        file_put_contents($this->printManager->printCounter, "\0\0");
        $this->assertSame(3, $this->printManager->getPrintCountFromCounter());
    }
}
