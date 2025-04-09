<?php

namespace Photobooth\Logger;

use Monolog\Formatter\LineFormatter;
use Monolog\Handler\StreamHandler;
use Monolog\Level;
use Monolog\Logger;
use Photobooth\Utility\PathUtility;
use Photobooth\Service\TelegramService;
use Photobooth\Service\ConfigurationService;

class NamedLogger
{
    protected int $level;
    protected string $file;
    protected Logger $logger;
    protected TelegramService $telegramService;
    protected array $config;

    public function __construct(string $name, int $level)
    {
        $this->level = $level;
        $this->file = PathUtility::getAbsolutePath('var/log/' . $name . '.log');

        switch ($this->level) {
            case 1:
                $logLevel = Level::Info;
                break;
            case 2:
                $logLevel = Level::Debug;
                break;
            default:
                $logLevel = Level::Error;
                break;
        }

        $dateFormat = 'Y-m-d H:i:s';
        $output = "[%datetime%][%channel%][%level_name%] %message% %context%\n";
        $formatter = new LineFormatter($output, $dateFormat);
        $stream = new StreamHandler($this->file, $logLevel);
        $stream->setFormatter($formatter);

        $this->logger = new Logger($name);
        $this->logger->pushHandler($stream);

        $this->telegramService = TelegramService::getInstance();
        $this->config = ConfigurationService::getInstance()->getConfiguration();
    }

    public function debug(string $message, array $context = []): void
    {
        $this->logger->debug($message, $context);
        if ($this->config['debug']['telegram'] && in_array($this->config['debug']['telegram_debug_level'], ['debug', 'info'])) {
            $this->telegramService->sendMessage($message . " " . implode(',', $context));
        }
    }

    public function info(string $message, array $context = []): void
    {
        $this->logger->info($message, $context);
        if ($this->config['debug']['telegram'] && in_array($this->config['debug']['telegram_debug_level'], ['info'])) {
            $this->telegramService->sendMessage($message . " " . implode(',', $context));
        }
    }

    public function error(string $message, array $context = []): void
    {
        $this->logger->error($message, $context);
        if ($this->config['debug']['telegram'] && in_array($this->config['debug']['telegram_debug_level'], ['error', 'debug', 'info'])) {
            $this->telegramService->sendMessage($message . " " . implode(',', $context));
        }
    }

    public function getLevel(): int
    {
        return $this->level;
    }

    public function getFile(): string
    {
        return $this->file;
    }

    public function close(): void
    {
        $this->logger->close();
    }
}
