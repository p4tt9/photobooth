<?php

/** @var array $config */

require_once '../lib/boot.php';

use Photobooth\Enum\FolderEnum;
use Photobooth\Image;
use Photobooth\PhotoboothCapture;
use Photobooth\Service\LoggerService;

header('Content-Type: application/json');

checkCsrfOrFail($_POST);

$logger = LoggerService::getInstance()->getLogger('main');
$logger->debug(basename($_SERVER['PHP_SELF']));

try {
    if (!isset($_POST['style'])) {
        throw new \Exception('No style provided');
    }

    if (isset($_POST['collageLimit'])) {
        $config['collage']['limit'] = $_POST['collageLimit'];
    }

    if (!empty($_POST['file']) && preg_match('/^[a-z0-9_]+\.jpg$/', $_POST['file'])) {
        $file = $_POST['file'];
    } else {
        $file = Image::createNewFilename($config['picture']['naming']);
        if ($config['database']['file'] != 'db') {
            $file = $config['database']['file'] . '_' . $file;
        }
    }

    $filename_tmp = FolderEnum::TEMP->absolute() . DIRECTORY_SEPARATOR . $file;
    if (file_exists($filename_tmp)) {
        $random = Image::createNewFilename('random');
        $filename_random = FolderEnum::TEMP->absolute() . DIRECTORY_SEPARATOR . $random;
        rename($filename_tmp, $filename_random);
    }

    $captureHandler = new PhotoboothCapture();
    $captureHandler->debugLevel = $config['dev']['loglevel'];
    $captureHandler->fileName = $file;
    $captureHandler->tmpFile = $filename_tmp;

    switch ($_POST['style']) {
        case 'photo':
            $captureHandler->style = 'image';
            break;
        case 'collage':
            if (!is_numeric($_POST['collageNumber'])) {
                throw new \Exception('No or invalid collage number provided.');
            }

            $number = $_POST['collageNumber'] + 0;

            if ($number > $config['collage']['limit']) {
                throw new \Exception('Collage consists only of ' . $config['collage']['limit'] . ' pictures');
            }

            $captureHandler->collageSubFile = substr($file, 0, -4) . '-' . $number . '.jpg';
            $captureHandler->tmpFile = substr($filename_tmp, 0, -4) . '-' . $number . '.jpg';
            $captureHandler->style = 'collage';
            $captureHandler->collageNumber = intval($number);
            $captureHandler->collageLimit = $config['collage']['limit'];
            break;
        case 'custom':
            $captureHandler->style = 'image';
            break;
        default:
            throw new \Exception('Invalid style provided.');
    }

    if ($config['dev']['demo_images']) {
        $captureHandler->captureDemo();
    } elseif ($config['preview']['mode'] === 'device_cam' && $config['preview']['camTakesPic']) {
        if (!isset($_POST['canvasimg'])) {
            throw new \Exception('No canvas data provided!');
        }
        $captureHandler->flipImage = $config['preview']['flip'];
        $captureHandler->captureCanvas($_POST['canvasimg']);
    } else {
        if ($_POST['style'] === 'custom') {
            $captureHandler->captureCmd = $config['commands']['take_custom'];
        } elseif ($_POST['style'] === 'collage' && !empty($config['commands']['take_collage'])) {
            $captureHandler->captureCmd = $config['commands']['take_collage'];
        } else {
            $captureHandler->captureCmd = $config['commands']['take_picture'];
        }
        $captureHandler->captureWithCmd();
    }
    // send image to frontend
    echo json_encode($captureHandler->returnData());
    exit();
} catch (\Exception $e) {
    $data = ['error' => $e->getMessage()];
    $logger->error($e->getMessage(), $data);
    echo json_encode($data);
    exit();
}
