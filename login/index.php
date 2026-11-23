<?php

// PIN-Anmeldung über app (Übergang bis zur neuen Admin-Oberfläche, planning/ADMIN.md 7b).
// Die alte Anmeldung (Benutzername/Passwort, Admin- und Vermiet-PIN aus den Einstellungen) gibt es nicht mehr.

use Photobooth\Service\AppAccessService;
use Photobooth\Service\ApplicationService;
use Photobooth\Utility\PathUtility;

require_once '../lib/boot.php';

$person = AppAccessService::getInstance()->currentPerson();
$back = (string) ($_GET['zurueck'] ?? '');
// Nur Pfade dieser Box als Rücksprung, keine fremden Adressen
if (!preg_match('#^/[A-Za-z0-9/_.\-?=&%]*$#', $back) || str_starts_with($back, '//')) {
    $back = '';
}

if ($person !== null && $person['role'] === 'admin') {
    if ($back !== '') {
        header('Location: ' . $back);
        exit();
    }
    // Menü der alten Verwaltung (bis die neue Oberfläche sie ersetzt)
    $pageTitle = 'Menü - ' . ApplicationService::getInstance()->getTitle();
    include PathUtility::getAbsolutePath('admin/components/head.admin.php');
    include PathUtility::getAbsolutePath('admin/helper/index.php');
    echo '<body><div class="w-full h-screen grid place-items-center absolute bg-brand-2 px-6 py-12 overflow-x-hidden overflow-y-auto">';
    echo '<div class="w-full flex items-center justify-center flex-col">';
    include PathUtility::getAbsolutePath('login/menu.php');
    echo '</div></div>';
    include PathUtility::getAbsolutePath('admin/components/footer.scripts.php');
    include PathUtility::getAbsolutePath('admin/components/footer.admin.php');
    exit();
}
?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Anmelden – Snaphora</title>
    <link rel="icon" href="data:,">
    <style>
        :root { color-scheme: light; --brand: #1b3faa; --error: #b3261e; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #eef1f8; color: #1a1a1a; }
        main { width: min(22rem, 100% - 2rem); background: #fff; border-radius: 1rem; padding: 2rem 1.5rem; box-shadow: 0 8px 32px rgb(0 0 0 / 12%); text-align: center; }
        h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
        p { margin: 0 0 1.25rem; color: #555; }
        label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        input { width: 100%; font-size: 2rem; letter-spacing: .5rem; text-align: center; padding: .5rem; border: 2px solid #c5cbe0; border-radius: .75rem; }
        input:focus-visible, button:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
        .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin-top: 1.25rem; }
        button { min-height: 3.5rem; font-size: 1.5rem; border: 0; border-radius: .75rem; background: #e3e8f6; color: #1a1a1a; cursor: pointer; }
        button.ok { background: var(--brand); color: #fff; font-size: 1.1rem; font-weight: 600; }
        #message { min-height: 1.5rem; margin-top: 1rem; color: var(--error); font-weight: 600; }
    </style>
</head>
<body>
<main>
    <h1>Anmelden</h1>
    <p>Persönliche PIN eingeben</p>
    <form id="login" autocomplete="off">
        <label for="pin">PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" required autofocus>
        <div class="keys" aria-label="Ziffernblock">
            <?php foreach ([1, 2, 3, 4, 5, 6, 7, 8, 9] as $digit): ?>
                <button type="button" data-digit="<?= $digit ?>"><?= $digit ?></button>
            <?php endforeach; ?>
            <button type="button" data-action="delete" aria-label="Letzte Ziffer löschen">⌫</button>
            <button type="button" data-digit="0">0</button>
            <button type="submit" class="ok">Anmelden</button>
        </div>
        <div id="message" role="alert" aria-live="assertive"></div>
    </form>
</main>
<script>
    const pin = document.getElementById('pin');
    const message = document.getElementById('message');
    document.querySelectorAll('[data-digit]').forEach((key) => key.addEventListener('click', () => {
        if (pin.value.length < 12) pin.value += key.dataset.digit;
    }));
    document.querySelector('[data-action="delete"]').addEventListener('click', () => { pin.value = pin.value.slice(0, -1); });
    document.getElementById('login').addEventListener('submit', async (event) => {
        event.preventDefault();
        message.textContent = '';
        const response = await fetch('<?= PathUtility::getPublicPath('api/v1/access/login') ?>', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Snaphora-Request': '1' },
            // Der Kiosk-Browser der Box öffnet immer localhost (kürzere Sitzung); Handy/Laptop kommen über die IP der Box
            body: JSON.stringify({ pin: pin.value, kiosk: ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) }),
        }).catch(() => null);
        pin.value = '';
        if (response?.ok) {
            window.location.reload();
        } else if (response?.status === 429) {
            const body = await response.json().catch(() => ({}));
            message.textContent = `Zu viele Fehlversuche – bitte ${body.retryAfterSeconds ?? 60} s warten`;
        } else if (response?.status === 401) {
            message.textContent = 'PIN falsch';
        } else {
            message.textContent = 'Anmeldung gerade nicht möglich';
        }
    });
</script>
</body>
</html>
