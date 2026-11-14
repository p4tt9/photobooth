<?php

/**
 * Prüft die gespeicherten Daten der Fotobox auf Schäden, z. B. nach einem harten Abbruch.
 * Läuft im App-Container:  docker compose exec -T photobooth php < tests/crash/check-consistency.php
 *
 * Ausgabe: JSON {"errors": [...], "warnings": [...], "stats": {...}}
 */
$root = '/app';
$data = $root . '/data';
$errors = [];
$warnings = [];

function isCompleteJpeg(string $file): bool
{
    $size = filesize($file);
    if ($size === false || $size < 4) {
        return false;
    }
    $handle = fopen($file, 'rb');
    if ($handle === false) {
        return false;
    }
    $start = fread($handle, 2);
    fseek($handle, -2, SEEK_END);
    $end = fread($handle, 2);
    fclose($handle);

    // JPEG beginnt mit FFD8 und endet mit FFD9 – eine abgeschnittene Datei hat kein Ende-Kennzeichen.
    return $start === "\xFF\xD8" && $end === "\xFF\xD9";
}

// Bilder und Vorschaubilder müssen vollständig sein
$images = [];
foreach (['images', 'thumbs'] as $folder) {
    foreach (glob("$data/$folder/*.jpg") ?: [] as $file) {
        if (!isCompleteJpeg($file)) {
            $errors[] = "Unvollständiges Bild: $folder/" . basename($file);
        } elseif ($folder === 'images') {
            $images[] = basename($file);
        }
    }
}

// Bild-Datenbank muss gültig sein und darf nur auf vorhandene Bilder zeigen
$databaseEntries = [];
foreach (glob("$data/*.txt") ?: [] as $databaseFile) {
    $content = (string) file_get_contents($databaseFile);
    $decoded = json_decode($content, true);
    if (!is_array($decoded)) {
        $errors[] = 'Beschädigte Datenbank: ' . basename($databaseFile) . ' (' . strlen($content) . ' Bytes)';
        continue;
    }
    foreach ($decoded as $entry) {
        if (!is_string($entry) || !is_file("$data/images/$entry")) {
            $errors[] = 'Datenbank-Eintrag ohne Bild: ' . json_encode($entry);
        }
        $databaseEntries[] = $entry;
    }
}
$missing = array_diff($images, $databaseEntries);
if (count($missing) > 0) {
    $warnings[] = count($missing) . ' vollständige(s) Bild(er) nicht in der Galerie: ' . implode(', ', $missing);
}

// Druckzähler muss eine Zahl sein
$counterFile = "$data/print.count";
if (is_file($counterFile)) {
    $counter = trim((string) file_get_contents($counterFile));
    if (!ctype_digit($counter)) {
        $errors[] = 'Druckzähler ungültig: ' . json_encode($counter);
    }
}

// Benutzer-Konfiguration muss ladbar sein
$configFile = "$root/config/my.config.inc.php";
if (is_file($configFile)) {
    try {
        $config = require $configFile;
        if (!is_array($config)) {
            $errors[] = 'Konfiguration liefert kein Array';
        }
    } catch (\Throwable $e) {
        $errors[] = 'Konfiguration nicht ladbar: ' . $e->getMessage();
    }
}

echo json_encode([
    'errors' => $errors,
    'warnings' => $warnings,
    'stats' => ['images' => count($images), 'databaseEntries' => count($databaseEntries)],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
