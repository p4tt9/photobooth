<?php

namespace Photobooth\Service;

use Photobooth\Utility\PathUtility;

/**
 * Bridge to the sign-in of app (box/apps/app, planning/ADMIN.md) – transitional until package 7e/9.
 *
 * The old PHP admin pages, test pages and maintenance endpoints no longer have their own login. They require a
 * PIN session of app with the role "admin". The session is checked with app on every request (fail closed: if app
 * cannot be reached, access is denied). $_SESSION['auth'] is derived from it so the remaining legacy checks keep
 * working, and is never trusted on its own.
 */
final class AppAccessService
{
    public const SESSION_COOKIE = 'snaphora_session';

    /**
     * Paths (relative to the app root) that need an admin session. Everything a guest uses stays open.
     */
    public const PROTECTED_PATHS = [
        '#^admin/#',
        '#^test/#',
        '#^api/(admin|shellCommand|rebuildImageDB|serverInfo|checkVersion|testFtpConnection|themes)\.php$#',
    ];

    /**
     * Paths the setup staff may use as well (role "setup" or "admin").
     */
    public const SETUP_PATHS = [
        '#^api/selftest\.php$#',
    ];

    /**
     * @var array{personId: string, name: string, role: string}|null|false false = not asked yet
     */
    private array|null|false $person = false;

    public function __construct(private readonly string $appUrl)
    {
    }

    /**
     * The person signed in with app, or null.
     *
     * @return array{personId: string, name: string, role: string}|null
     */
    public function currentPerson(): ?array
    {
        if ($this->person !== false) {
            return $this->person;
        }
        $this->person = null;
        $token = $_COOKIE[self::SESSION_COOKIE] ?? '';
        if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{20,100}$/', $token)) {
            return null;
        }
        $context = stream_context_create(['http' => [
            'method' => 'GET',
            'header' => 'Cookie: ' . self::SESSION_COOKIE . '=' . $token,
            'timeout' => 2,
            'ignore_errors' => true,
        ]]);
        $response = @file_get_contents($this->appUrl . '/api/v1/access/session', false, $context);
        $status = isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m) ? (int) $m[1] : 0;
        if ($response === false || $status !== 200) {
            return null;
        }
        $person = json_decode($response, true)['person'] ?? null;
        if (!is_array($person) || !is_string($person['personId'] ?? null) || !is_string($person['role'] ?? null)) {
            return null;
        }
        $this->person = ['personId' => $person['personId'], 'name' => (string) ($person['name'] ?? ''), 'role' => $person['role']];

        return $this->person;
    }

    /**
     * Ends the session at app and removes the cookie.
     */
    public function logout(): void
    {
        $token = $_COOKIE[self::SESSION_COOKIE] ?? '';
        if (is_string($token) && preg_match('/^[A-Za-z0-9_-]{20,100}$/', $token)) {
            @file_get_contents($this->appUrl . '/api/v1/access/logout', false, stream_context_create(['http' => [
                'method' => 'POST',
                'header' => 'Cookie: ' . self::SESSION_COOKIE . '=' . $token . "\r\nX-Snaphora-Request: 1",
                'timeout' => 2,
                'ignore_errors' => true,
            ]]));
        }
        setcookie(self::SESSION_COOKIE, '', ['expires' => 1, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict']);
        $this->person = null;
    }

    public function isAdmin(): bool
    {
        return ($this->currentPerson()['role'] ?? null) === 'admin';
    }

    /**
     * Called from lib/boot.php for every web request.
     */
    public function enforce(): void
    {
        if (PHP_SAPI === 'cli') {
            return;
        }
        // Legacy flags only from the app session
        unset($_SESSION['rental']);
        $_SESSION['auth'] = $this->isAdmin();

        $path = self::relativePath((string) ($_SERVER['SCRIPT_FILENAME'] ?? ''), PathUtility::getRootPath());
        if (self::requiresSetup($path)) {
            if (!in_array($this->currentPerson()['role'] ?? null, ['setup', 'admin'], true)) {
                self::deny((string) $path);
            }

            return;
        }
        if (self::requiresAdmin($path) && !$_SESSION['auth']) {
            self::deny((string) $path);
        }
    }

    /**
     * Fail closed: a script that cannot be placed below the app root (null) counts as protected.
     */
    public static function requiresAdmin(?string $relativePath): bool
    {
        if ($relativePath === null) {
            return true;
        }
        foreach (self::PROTECTED_PATHS as $pattern) {
            if (preg_match($pattern, $relativePath)) {
                return true;
            }
        }

        return false;
    }

    public static function requiresSetup(?string $relativePath): bool
    {
        foreach (self::SETUP_PATHS as $pattern) {
            if ($relativePath !== null && preg_match($pattern, $relativePath)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Path of the script relative to the app root ("admin/index.php"), null if it is not below the root.
     */
    public static function relativePath(string $scriptFilename, string $root): ?string
    {
        $root = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        $script = realpath($scriptFilename);
        if ($root === DIRECTORY_SEPARATOR || $script === false || !str_starts_with($script, $root)) {
            return null;
        }

        return str_replace(DIRECTORY_SEPARATOR, '/', substr($script, strlen($root)));
    }

    private static function deny(string $path): never
    {
        if (str_starts_with($path, 'api/')) {
            http_response_code(401);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Bitte mit PIN anmelden']);
        } else {
            header('Location: ' . PathUtility::getPublicPath('admin/anmelden') . '?zurueck=' . rawurlencode((string) ($_SERVER['REQUEST_URI'] ?? '')));
        }
        exit();
    }

    public static function getInstance(): self
    {
        if (!isset($GLOBALS[self::class])) {
            $GLOBALS[self::class] = new self(rtrim((string) (getenv('SNAPHORA_APP_URL') ?: 'http://app:3002'), '/'));
        }

        return $GLOBALS[self::class];
    }
}
