<?php

// Versteckter Zugang zur Verwaltung am Touchscreen (Konzept 4.5): 5× in die Ecke tippen, innerhalb von 3 s.
// Danach PIN-Eingabe der neuen Verwaltung im Kiosk-Modus (kurze Sitzung, zurück zur Fotobox nach 2 min Leerlauf).

use Photobooth\Service\AssetService;
use Photobooth\Utility\PathUtility;

$assetService = AssetService::getInstance();

if ($config['ui']['admin_shortcut'] ?? null) {
    $position = preg_replace('/[^a-z-]/', '', (string) ($config['ui']['admin_shortcut_position'] ?? 'bottom-right'));
    // Kein Knopf: für Gäste unsichtbar und für Screenreader ausgeblendet
    echo '<div class="adminshortcut adminshortcut--' . $position . '" aria-hidden="true" data-target="'
        . htmlspecialchars(PathUtility::getPublicPath('admin/anmelden') . '?kiosk=1') . '"></div>';
    echo '<script src="' . $assetService->getUrl('resources/js/adminshortcut.js') . '"></script>';
}
