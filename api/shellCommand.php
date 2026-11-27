<?php

/** @var array $config */

require_once '../lib/boot.php';

use Photobooth\Service\LoggerService;

header('Content-Type: application/json');
checkCsrfOrFail($_POST);

$logger = LoggerService::getInstance()->getLogger('main');
$logger->debug(basename($_SERVER['PHP_SELF']));

$mode = $_POST['mode'] ?? '';

if (empty($mode)) {
    $data = [
        'success' => 'false',
        'mode' => 'No mode defined.',
    ];
    $logger->debug('message', $data);
    echo json_encode($data);
    die();
}

// Only the commands around a capture (from the provisioning, never from settings). Reboot and shutdown are not
// possible here: they belong to the admin interface with PIN (package 8, via the host).
switch ($mode) {
    case 'pre-command':
        $cmd = (string) $config['commands']['pre_photo'];
        if ($cmd === '') {
            echo json_encode(['success' => 'false', 'mode' => 'No command configured']);
            die();
        }
        break;
    case 'post-command':
        $filename = $_POST['filename'] ?? '';
        $filename = basename(str_replace(['\\', '/'], '_', $filename));
        if ($filename === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $filename)) {
            $data = [
                'success' => 'false',
                'mode' => 'Invalid filename',
            ];
            $logger->debug('message', $data);
            echo json_encode($data);
            die();
        }
        if ((string) $config['commands']['post_photo'] === '') {
            echo json_encode(['success' => 'false', 'mode' => 'No command configured']);
            die();
        }
        $cmd = sprintf($config['commands']['post_photo'], escapeshellarg($filename));
        break;
    default:
        $data = [
            'success' => 'false',
            'mode' => 'Unknown mode ' . $mode,
        ];
        $logger->debug('message', $data);
        echo json_encode($data);
        die();
}

exec($cmd . ' 2>&1', $output, $retval);
$data = [
    'success' => $retval === 0,
    'output' => $output,
    'retval' => $retval,
    'command' => $cmd,
];

$logger->debug('data', $data);
echo json_encode($data);
exit();
