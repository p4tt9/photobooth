<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;
use Photobooth\Utility\FileUtility;

class PrintManagerService
{
    /**
     * Path to the print database file.
     */
    public string $printDb = '';

    /**
     * Path to the print counter file.
     */
    public string $printCounter = '';

    public function __construct()
    {
        $this->printDb = FolderEnum::DATA->absolute() . DIRECTORY_SEPARATOR . 'printed.csv';
        $this->printCounter = FolderEnum::DATA->absolute() . DIRECTORY_SEPARATOR . 'print.count';
    }

    /**
     * Add a new entry to the print database.
     *
     * @param string $filename The filename associated with the print.
     * @param string $uniquename The unique name associated with the print.
     */
    public function addToPrintDb(string $filename, string $uniquename): bool
    {
        try {
            $csvData = [];
            $csvData[] = date('Y-m-d');
            $csvData[] = date('H:i:s');
            $csvData[] = $filename;
            $csvData[] = $uniquename;

            $buffer = fopen('php://memory', 'r+');
            if ($buffer === false || fputcsv($buffer, $csvData, ',', '"', '\\') === false) {
                throw new \Exception('Failed to encode print database entry.');
            }
            rewind($buffer);
            $line = (string) stream_get_contents($buffer);
            fclose($buffer);

            // Each print is one line; a line cut off by a power loss stays countable.
            FileUtility::appendLine($this->printDb, $line);
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Get the total count of prints from the print database.
     */
    public function getPrintCountFromDB(): ?int
    {
        try {
            if (file_exists($this->printDb) && is_readable($this->printDb)) {
                $handle = fopen($this->printDb, 'r');
                if (!$handle) {
                    throw new \Exception('Failed to open print database.');
                }
                $linecount = 0;
                while (!feof($handle)) {
                    $line = (string) fgets($handle, 4096);
                    $linecount += substr_count($line, PHP_EOL);
                }
                fclose($handle);
                return $linecount;
            }
            return intval(0);
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * Get the total count of prints from either the print counter file or the print database.
     */
    public function getPrintCountFromCounter(): ?int
    {
        try {
            if (file_exists($this->printCounter)) {
                $counterContent = file_get_contents($this->printCounter);
                if ($counterContent === false) {
                    throw new \Exception('Failed to read print counter.');
                }
                $counterContent = trim($counterContent);
                // A damaged counter must never read as 0 – that would reset the print quota.
                if ($counterContent !== '' && ctype_digit($counterContent)) {
                    return (int) $counterContent;
                }
                error_log('Print counter ' . $this->printCounter . ' is damaged, repairing it from the print database');
                $count = $this->getPrintCountFromDB();
                if ($count !== null) {
                    $this->setPrintCounter($count);
                }

                return $count;
            }
        } catch (\Exception $e) {
            // do nothing
        }

        return $this->getPrintCountFromDB();
    }

    /**
     * Stores the print counter atomically.
     */
    public function setPrintCounter(int $count): void
    {
        FileUtility::writeAtomic($this->printCounter, (string) $count);
    }

    /**
     * Printing is locked once the print quota of the event is used up (print.limit > 0 and prints >= limit).
     * It is derived from the counter instead of a lock file: raising the quota – only possible with a PIN in the
     * admin interface of app – unlocks it, and there is nothing a guest could reset.
     */
    public function isPrintLocked(?int $limit = null): bool
    {
        return $this->remainingPrints($limit) === 0;
    }

    /**
     * Prints left in the quota, null = no quota.
     */
    public function remainingPrints(?int $limit = null): ?int
    {
        $limit ??= (int) (ConfigurationService::getInstance()->getConfiguration()['print']['limit'] ?? 0);
        if ($limit <= 0) {
            return null;
        }
        $count = $this->getPrintCountFromCounter();
        if ($count === null) {
            // Unknown count: better no print than an unlimited one
            error_log('Print count unknown, printing stays locked until the counter is readable');

            return 0;
        }

        return max(0, $limit - $count);
    }

    /**
     * Remove the print database file.
     */
    public function removePrintDb(): bool
    {
        try {
            if (file_exists($this->printDb) && unlink($this->printDb)) {
                return true;
            }
            throw new \Exception('Failed to remove print database.');
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Remove the print counter file.
     */
    public function removePrintCounter(): bool
    {
        try {
            if (file_exists($this->printCounter) && unlink($this->printCounter)) {
                return true;
            }
            throw new \Exception('Failed to remove print counter.');
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Reset the print system by removing the print database and the print counter.
     */
    public function resetPrint(): void
    {
        try {
            $this->removePrintDb();
            $this->removePrintCounter();
        } catch (\Exception $e) {
            return;
        }
    }

    public static function getInstance(): self
    {
        if (!isset($GLOBALS[self::class])) {
            $GLOBALS[self::class] = new self();
        }

        return $GLOBALS[self::class];
    }
}
