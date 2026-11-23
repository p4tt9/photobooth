<?php

declare(strict_types=1);

namespace Photobooth\Tests\Unit\Service;

use Photobooth\Service\EventArchiveService;
use PHPUnit\Framework\TestCase;

final class EventArchiveServiceTest extends TestCase
{
    private string $data;

    protected function setUp(): void
    {
        $this->data = sys_get_temp_dir() . '/snaphora-archive-test-' . bin2hex(random_bytes(4));
        foreach (['images', 'thumbs', 'tmp', 'print'] as $directory) {
            mkdir($this->data . '/' . $directory, 0777, true);
        }
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->data));
    }

    private function service(): EventArchiveService
    {
        return new EventArchiveService($this->data, $this->data . '/db.txt');
    }

    private function takePhoto(string $name): void
    {
        foreach (['images', 'thumbs', 'tmp'] as $directory) {
            file_put_contents($this->data . '/' . $directory . '/' . $name, 'jpeg');
        }
        file_put_contents($this->data . '/db.txt', json_encode([$name]));
        file_put_contents($this->data . '/printed.csv', "1,{$name}\n", FILE_APPEND);
        file_put_contents($this->data . '/print.count', '1');
    }

    public function testWithoutEventNothingHappens(): void
    {
        $this->takePhoto('a.jpg');
        $this->assertNull($this->service()->ensureEvent(null));
        $this->assertFileExists($this->data . '/images/a.jpg');
    }

    public function testSwitchingEventsArchivesGalleryAndPrintCounter(): void
    {
        $service = $this->service();
        $service->ensureEvent('evt-1');
        $this->takePhoto('a.jpg');
        file_put_contents($this->data . '/print.lock', '');

        $this->assertNull($service->ensureEvent('evt-1'), 'gleiches Event: nichts zu tun');
        $this->assertSame('evt-1', $service->ensureEvent('evt-2'));

        $this->assertFileExists($this->data . '/archive/evt-1/images/a.jpg');
        $this->assertFileExists($this->data . '/archive/evt-1/tmp/a.jpg');
        $this->assertFileExists($this->data . '/archive/evt-1/printed.csv');
        $this->assertFileExists($this->data . '/archive/evt-1/db.txt');
        $this->assertDirectoryExists($this->data . '/images');
        $this->assertFileDoesNotExist($this->data . '/images/a.jpg', 'neue Galerie ist leer');
        $this->assertFileDoesNotExist($this->data . '/print.count', 'Druckzähler beginnt bei 0');
        $this->assertFileDoesNotExist($this->data . '/print.lock', 'Druck wieder freigegeben');
        $this->assertSame('evt-2', $service->currentEventId());
    }

    public function testPhotosFromBeforeTheFirstEventAreArchived(): void
    {
        $this->takePhoto('alt.jpg');
        $archive = $this->service()->ensureEvent('evt-1');

        $this->assertNotNull($archive);
        $this->assertStringStartsWith('ohne-event-', $archive);
        $this->assertFileExists($this->data . '/archive/' . $archive . '/images/alt.jpg');
    }

    public function testInterruptedSwitchIsCompleted(): void
    {
        $service = $this->service();
        $service->ensureEvent('evt-1');
        $this->takePhoto('a.jpg');
        $this->takePhoto('b.jpg');
        // Stromausfall mitten im Wechsel: images schon verschoben, ein Foto danach noch angekommen, Markierung alt
        mkdir($this->data . '/archive/evt-1', 0777, true);
        rename($this->data . '/images', $this->data . '/archive/evt-1/images');
        mkdir($this->data . '/images');
        file_put_contents($this->data . '/images/c.jpg', 'jpeg');

        $service->ensureEvent('evt-2');

        foreach (['a.jpg', 'b.jpg', 'c.jpg'] as $file) {
            $this->assertFileExists($this->data . '/archive/evt-1/images/' . $file);
        }
        $this->assertFileExists($this->data . '/archive/evt-1/thumbs/a.jpg');
        $this->assertSame([], array_values(array_diff(scandir($this->data . '/images') ?: [], ['.', '..'])));
    }
}
