<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Utility;

use Photobooth\Utility\FileUtility;
use PHPUnit\Framework\TestCase;

final class FileUtilityAtomicTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/snaphora-test-' . bin2hex(random_bytes(4));
        mkdir($this->directory);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->directory . '/{,.}*', GLOB_BRACE) ?: [] as $file) {
            if (is_file($file)) {
                unlink($file);
            }
        }
        rmdir($this->directory);
    }

    /**
     * @return string[] all files including hidden temporary files
     */
    private function filesInDirectory(): array
    {
        return array_values(array_diff(scandir($this->directory) ?: [], ['.', '..']));
    }

    public function testWriteAtomicCreatesAndReplacesFile(): void
    {
        $path = $this->directory . '/db.txt';

        FileUtility::writeAtomic($path, 'first');
        FileUtility::writeAtomic($path, 'second');

        $this->assertSame('second', file_get_contents($path));
        $this->assertSame(['db.txt'], $this->filesInDirectory(), 'no temporary files may remain');
    }

    public function testWriteAtomicFailsLoudlyWhenDirectoryIsMissing(): void
    {
        $path = $this->directory . '/missing-dir/db.txt';

        $this->expectException(\RuntimeException::class);
        FileUtility::writeAtomic($path, 'content');
    }

    public function testCopyAtomic(): void
    {
        $source = $this->directory . '/source.jpg';
        $destination = $this->directory . '/destination.jpg';
        file_put_contents($source, 'jpeg-data');

        FileUtility::copyAtomic($source, $destination);

        $this->assertSame('jpeg-data', file_get_contents($destination));
        $this->assertEqualsCanonicalizing(['source.jpg', 'destination.jpg'], $this->filesInDirectory());
    }

    public function testTemporaryFilesAreHiddenAndHaveNoImageExtension(): void
    {
        $temporary = basename(FileUtility::temporaryPathFor($this->directory . '/20261114_120000.jpg'));

        $this->assertStringStartsWith('.', $temporary);
        $this->assertNotSame('jpg', pathinfo($temporary, PATHINFO_EXTENSION));
    }

    public function testAppendLineRepairsCutOffLine(): void
    {
        $path = $this->directory . '/printed.csv';
        // Power loss in the middle of the second record: no line break at the end.
        file_put_contents($path, "2026-11-14,12:00:00,a.jpg,a\n2026-11-14,12:01:00,b.j");

        FileUtility::appendLine($path, '2026-11-14,12:02:00,c.jpg,c');

        $this->assertSame(
            "2026-11-14,12:00:00,a.jpg,a\n2026-11-14,12:01:00,b.j\n2026-11-14,12:02:00,c.jpg,c\n",
            file_get_contents($path),
        );
    }

    public function testAppendLineCreatesFile(): void
    {
        $path = $this->directory . '/printed.csv';

        FileUtility::appendLine($path, "line\n");

        $this->assertSame("line\n", file_get_contents($path));
    }
}
