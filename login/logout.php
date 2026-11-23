<?php

// Abmelden: beendet die Sitzung bei app (Übergang bis zur neuen Admin-Oberfläche).

use Photobooth\Service\AppAccessService;
use Photobooth\Utility\PathUtility;

require_once '../lib/boot.php';

AppAccessService::getInstance()->logout();
session_destroy();

header('Location: ' . PathUtility::getPublicPath());
exit;
