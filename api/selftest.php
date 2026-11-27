<?php

// Hardware-Prüfungen für den Selbsttest (Kamera, Testfoto, Drucker) – nur für app, nur mit PIN-Sitzung.
// Übergang bis zum Kamera-Dienst (Paket 8) und Druck in app (Paket 9), siehe planning/ADMIN.md (7d).

/** @var array $config */
require_once '../lib/boot.php';

use Photobooth\Service\SelftestService;

header('Content-Type: application/json');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Nur POST']);
    exit();
}

$service = new SelftestService($config);
$checks = [$service->camera(), $service->printer()];
$testPhoto = null;
if (($_GET['photo'] ?? '') === '1' && $checks[0]['level'] !== 'error') {
    $result = $service->testPhoto();
    $checks[] = $result['check'];
    $testPhoto = $result['file'];
}

echo json_encode(['checks' => $checks, 'testPhoto' => $testPhoto], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
