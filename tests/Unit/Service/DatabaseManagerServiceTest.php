<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\DatabaseManagerService;
use PHPUnit\Framework\TestCase;

final class DatabaseManagerServiceTest extends TestCase
{
    private string $directory;
    private DatabaseManagerService $database;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/snaphora-db-test-' . bin2hex(random_bytes(4));
        mkdir($this->directory . '/images', 0777, true);

        $this->database = new DatabaseManagerService();
        $this->database->databaseFile = $this->directory . '/db.txt';
        $this->database->imageDirectory = $this->directory . '/images';
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->directory));
    }

    private function addImage(string $name, int $mtime): void
    {
        $path = $this->directory . '/images/' . $name;
        file_put_contents($path, 'jpeg');
        touch($path, $mtime);
    }

    public function testAppendAndDelete(): void
    {
        $this->database->appendContentToDB('a.jpg');
        $this->database->appendContentToDB('b.jpg');
        $this->database->appendContentToDB('a.jpg');

        $this->assertSame(['a.jpg', 'b.jpg'], $this->database->getContentFromDB());

        $this->database->deleteContentFromDB('a.jpg');
        $this->assertSame(['b.jpg'], $this->database->getContentFromDB());
    }

    public function testMissingDatabaseIsEmpty(): void
    {
        $this->assertSame([], $this->database->getContentFromDB());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function damagedDatabaseProvider(): array
    {
        return [
            'empty file (cut off before writing)' => [''],
            'cut off in the middle' => ['["20261114_120000.jpg","2026111'],
            'not a list' => ['{"a":1}'],
            'garbage' => ["\0\0\0\0"],
        ];
    }

    /**
     * Before: a damaged database counted as empty, and the next photo overwrote it –
     * the gallery forgot all earlier pictures.
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('damagedDatabaseProvider')]
    public function testDamagedDatabaseIsRebuiltFromImages(string $damagedContent): void
    {
        $this->addImage('20261114_120000.jpg', 1000);
        $this->addImage('20261114_120100.jpg', 2000);
        file_put_contents($this->database->databaseFile, $damagedContent);

        $this->assertSame(['20261114_120000.jpg', '20261114_120100.jpg'], $this->database->getContentFromDB());

        // The next photo is added to the rebuilt list instead of replacing it.
        $this->addImage('20261114_120200.jpg', 3000);
        $this->database->appendContentToDB('20261114_120200.jpg');
        $this->assertSame(
            ['20261114_120000.jpg', '20261114_120100.jpg', '20261114_120200.jpg'],
            json_decode((string) file_get_contents($this->database->databaseFile), true),
        );
    }

    public function testRebuildIgnoresTemporaryFiles(): void
    {
        $this->addImage('20261114_120000.jpg', 1000);
        // Left behind by a power loss while saving
        $this->addImage('.20261114_120100.jpg.tmp-1a2b3c4d', 2000);

        $this->assertSame('success', $this->database->rebuildDB());
        $this->assertSame(['20261114_120000.jpg'], $this->database->getContentFromDB());
    }
}
