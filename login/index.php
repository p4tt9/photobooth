<?php

// Die Anmeldung gehört zur neuen Verwaltung (box/apps/admin). Alte Lesezeichen führen dorthin.

use Photobooth\Utility\PathUtility;

require_once '../lib/boot.php';

header('Location: ' . PathUtility::getPublicPath('admin/'), true, 301);
exit();
