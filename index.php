<?php

require_once 'lib/boot.php';

use Photobooth\Service\ApplicationService;
use Photobooth\Service\AssetService;
use Photobooth\Service\ProcessService;
use Photobooth\Utility\PathUtility;

$assetService = AssetService::getInstance();
$noCacheFlag = !empty($_GET['refresh']);

if (!isset($_SESSION['asset_extra_version'])) {
    $_SESSION['asset_extra_version'] = '';
}

if ($noCacheFlag) {
    $_SESSION['asset_extra_version'] = (string) time();
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
}

$assetService->setExtraVersion($_SESSION['asset_extra_version'] ?: null);

// Die Gäste-Oberfläche ist immer offen (Kiosk); geschützt ist die Verwaltung unter /admin/ (PIN, app)
$pageTitle = ApplicationService::getInstance()->getTitle();
$photoswipe = true;
$randomImage = false;
$remoteBuzzer = true;

include PathUtility::getAbsolutePath('template/components/main.head.php');
?>

<body class="gallery-mode--overlay ">
<?php include PathUtility::getAbsolutePath('template/components/video.background.php'); ?>
<?php include PathUtility::getAbsolutePath('template/components/preview.php'); ?>

<?php
$privateStageStart = PathUtility::getAbsolutePath('private/components/stage.start.php');
$stageStart = PathUtility::getAbsolutePath('template/components/stage.start.php');

include file_exists($privateStageStart) ? $privateStageStart : $stageStart;
include PathUtility::getAbsolutePath('template/components/stage.loader.php');
include PathUtility::getAbsolutePath('template/components/stage.results.php');

if ($config['gallery']['enabled']) {
    include PathUtility::getAbsolutePath('template/components/gallery.php');
}

include PathUtility::getAbsolutePath('template/components/main.footer.php');

?>

<script src="<?=$assetService->getUrl('resources/js/preview.js')?>"></script>
    <script src="<?=$assetService->getUrl('resources/js/screensaver.js')?>"></script>
    <script src="<?=$assetService->getUrl('resources/js/core.js')?>"></script>

<?php include PathUtility::getAbsolutePath('template/components/start.adminshortcut.php'); ?>
<?php ProcessService::getInstance()->boot(); ?>

<?php if ($noCacheFlag): ?>
<script>
    (function () {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('refresh');
            window.history.replaceState(null, '', url.toString());
        } catch (e) {
            // ignore
        }
    })();
</script>
<?php endif; ?>
</body>
</html>
