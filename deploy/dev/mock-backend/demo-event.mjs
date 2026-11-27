#!/usr/bin/env node
// Beispiel-Event im Mock-Backend ein- oder ausschalten, um Konfiguration vom Server und Galerie-Upload
// in der Dev-Umgebung auszuprobieren.
//
//   node deploy/dev/mock-backend/demo-event.mjs an     Event „Demo-Hochzeit“ für box-dev (Titel, Farben,
//                                                     Rahmen, Druckkontingent 10, Online-Galerie)
//   node deploy/dev/mock-backend/demo-event.mjs aus    Event beenden – Box läuft wieder mit lokalen Einstellungen
//
// Danach übernimmt der Agent die Änderung innerhalb von 10 s (oder sofort: curl -X POST localhost:8083/v1/sync).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mock = process.env.MOCK_URL ?? 'http://localhost:8082';
const deviceId = process.env.DEVICE_ID ?? 'box-dev';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function upload(file, contentType) {
    const response = await fetch(`${mock}/_mock/assets`, { method: 'POST', headers: { 'Content-Type': contentType }, body: await readFile(path.join(repo, file)) });
    return { ...(await response.json()), name: path.basename(file) };
}

async function setEvent(event) {
    const response = await fetch(`${mock}/_mock/devices/${deviceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
    if (!response.ok) {
        throw new Error(`Mock-Backend: HTTP ${response.status} ${await response.text()}`);
    }
}

const mode = process.argv[2];
if (mode === 'an') {
    const eventId = process.env.EVENT_ID ?? 'demo-hochzeit';
    const now = Date.now();
    await setEvent({
        eventId,
        version: Math.floor(now / 1000),
        name: 'Demo-Hochzeit',
        validFrom: new Date(now - 60_000).toISOString(),
        validUntil: new Date(now + 24 * 3600_000).toISOString(),
        startScreen: { title: 'Anna & Ben', subtitle: '21. November 2026' },
        colors: { primary: '#7a4f2a', secondary: '#b0896a', highlight: '#e9d8c4' },
        background: await upload('resources/img/background/02.jpg', 'image/jpeg'),
        photo: { frame: await upload('resources/img/frames/frame.png', 'image/png'), text: ['Anna & Ben', '21.11.2026'] },
        print: { enabled: true, quota: 10, qrCode: true },
        gallery: { enabled: true, photoUrlPrefix: `${mock}/_mock/photos/${eventId}/` },
        checklist: {
            checklistId: 'aufbau-hochzeit',
            version: 1,
            name: 'Aufbau Hochzeit',
            items: [
                { itemId: 'hintergrund', text: 'Hintergrund aufgebaut und glatt', required: true },
                { itemId: 'requisiten', text: 'Requisiten-Kiste aufgestellt', required: true },
                { itemId: 'gaestebuch', text: 'Gästebuch und Stifte bereitgelegt', required: false },
            ],
        },
    });
    console.log(`Event ${eventId} für ${deviceId} aktiv. Übersicht: ${mock}/`);
} else if (mode === 'aus') {
    await setEvent(null);
    console.log(`Kein Event mehr für ${deviceId}.`);
} else {
    console.error('Aufruf: demo-event.mjs an|aus');
    process.exit(2);
}
