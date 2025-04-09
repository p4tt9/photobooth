<?php

namespace Photobooth\Service;

use Photobooth\Logger\NamedLogger;

class TelegramService
{
    private string $apiUrl;
    protected int $chatId;
    protected string $api_token;
    protected $config;

    public function __construct()
    {
        $this->config = ConfigurationService::getInstance()->getConfiguration();
        $this->chatId = $config['debug']['telegram_chat_id'] ?? 0;
        $this->api_token = $config['debug']['telegram_api_token'] ?? 0;
        $this->apiUrl = "https://api.telegram.org/bot{$this->api_token}/";
    }

    private function request(string $method, array $params = []): array
    {
        $url = $this->apiUrl . $method;
        $options = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $params
        ];

        $ch = curl_init();
        curl_setopt_array($ch, $options);
        $response = curl_exec($ch);
        curl_close($ch);

        return json_decode($response, true) ?? [];
    }

    public function sendMessage(string $message): array
    {
        $this->chatId = $this->config['debug']['telegram_chat_id'];
        $this->api_token = $this->config['debug']['telegram_api_token'];
        //$this->chatId = 7192965685;
        //$this->api_token = '7624684504:AAHj3sqb-bAPCFKkpfR8E5MDaFEyRRFJ9xs';
        $this->apiUrl = "https://api.telegram.org/bot{$this->api_token}/";

        return $this->request("sendMessage", [
            "chat_id" => $this->chatId,
            "text" => $message,
            "parse_mode" => "HTML"
        ]);
    }

    public function getUpdates(): array
    {
        return $this->request("getUpdates");
    }

    public static function getInstance(): self
    {
        if (!isset($GLOBALS[self::class])) {
            $GLOBALS[self::class] = new self();
        }

        return $GLOBALS[self::class];
    }
}
