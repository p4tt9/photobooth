// Ersatz für das Snaphora-Backend (Konzept E17): implementiert contracts/device-api.yaml, damit Agent,
// Konfiguration und Galerie-Upload ohne echtes Backend entwickelt und getestet werden können.
// Dient später als Referenz für den Backend-Agenten.
//
// Geräte-API (wie das echte Backend):
//   POST /device/v1/register, GET /device/v1/config, GET /device/v1/assets/{sha256},
//   PUT /device/v1/events/{eventId}/photos/{photoId}, POST /device/v1/status
//   POST /realms/snaphora/protocol/openid-connect/token   (Ersatz für Keycloak, Client Credentials)
//
// Steuerung für Tests und zum Ausprobieren (gibt es im echten Backend nicht):
//   GET    /                                 Übersicht im Browser (Geräte, Events, hochgeladene Fotos)
//   POST   /_mock/tokens          {deviceId}  Registrierungs-Token anlegen
//   PUT    /_mock/devices/{id}    {device?, event?}  Konfiguration eines Geräts setzen
//   POST   /_mock/assets          (Bilddaten) Bild ablegen → {sha256, contentType, size}
//   GET    /_mock/photos                     hochgeladene Fotos
//   GET    /_mock/photos/{eventId}/{photoId} Foto-Datei
//   GET    /_mock/status                     letzte Statusmeldungen
//   PUT    /_mock/network         {offline}  Funkloch simulieren (Verbindungen werden abgebrochen)
//   POST   /_mock/events/{id}/close          Event abschließen (Uploads → 409)
//   DELETE /_mock                            Fotos, Events, Status leeren (Registrierungen bleiben)
//
// Seed: MOCK_SEED_TOKEN (z. B. DEV-TOKEN) registriert das Gerät MOCK_SEED_DEVICE (Standard box-dev), ohne Event.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const port = Number(process.env.PORT ?? 8082);
const publicUrl = (process.env.MOCK_PUBLIC_URL ?? `http://mock-backend:${port}`).replace(/\/$/, '');
const dataDir = process.env.MOCK_DATA_DIR ?? '/tmp/snaphora-mock-backend';
const stateFile = path.join(dataDir, 'state.json');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PHOTO_ID = /^[A-Za-z0-9_-]{1,100}\.jpg$/;

mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
mkdirSync(path.join(dataDir, 'photos'), { recursive: true });

function emptyState() {
    return { tokens: {}, devices: {}, accessTokens: {}, assets: {}, photos: {}, closedEvents: [], status: [] };
}

let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : emptyState();
let offline = false;

function save() {
    const temporary = `${stateFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2));
    renameSync(temporary, stateFile);
}

function seed() {
    const token = process.env.MOCK_SEED_TOKEN;
    const deviceId = process.env.MOCK_SEED_DEVICE ?? 'box-dev';
    if (token && !state.tokens[token]) {
        state.tokens[token] = { deviceId, usedBy: null, expires: null, reusable: true };
    }
    state.devices[deviceId] ??= { name: 'Fotobox (Dev)', clientSecret: null, installationId: null, config: { device: { deviceId, name: 'Fotobox (Dev)', version: 1 }, event: null } };
    save();
}
seed();

// --- Hilfen ---
async function body(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function json(response, status, value, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    response.end(JSON.stringify(value));
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function deviceFor(request) {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
    const token = match && state.accessTokens[match[1]];
    if (!token || token.expires < Date.now()) {
        return null;
    }
    return token.deviceId;
}

function eventsOf(deviceId) {
    const device = state.devices[deviceId];
    return new Set([...(device?.pastEvents ?? []), device?.config.event?.eventId].filter(Boolean));
}

function assetsOf(event) {
    if (!event) {
        return [];
    }
    return [event.background, event.logo, event.photo?.frame, event.collage?.frame, event.print?.frame].filter(Boolean).map((asset) => asset.sha256);
}

// --- Geräte-API ---
async function deviceApi(request, response, url) {
    if (request.method === 'POST' && url.pathname === '/device/v1/register') {
        const input = JSON.parse((await body(request)).toString() || '{}');
        const entry = state.tokens[input.token];
        if (!entry || (entry.expires && entry.expires < Date.now())) {
            return json(response, 403, { error: 'Token unbekannt oder abgelaufen' });
        }
        if (!/^[0-9a-f]{32}$/.test(input.installationId ?? '')) {
            return json(response, 400, { error: 'installationId fehlt' });
        }
        if (entry.usedBy && entry.usedBy !== input.installationId && !entry.reusable) {
            return json(response, 403, { error: 'Token wurde bereits von einem anderen Gerät verwendet' });
        }
        const device = state.devices[entry.deviceId];
        // Wiederholung (verlorene Antwort): gleiche Zugangsdaten; sonst neue
        if (!device.clientSecret || device.installationId !== input.installationId) {
            device.clientSecret = randomBytes(24).toString('hex');
            device.installationId = input.installationId;
        }
        device.agentVersion = input.agentVersion ?? null;
        entry.usedBy = input.installationId;
        save();
        console.log(`Gerät ${entry.deviceId} registriert`);
        return json(response, 200, { deviceId: entry.deviceId, name: device.name, clientId: entry.deviceId, clientSecret: device.clientSecret, tokenUrl: `${publicUrl}/realms/snaphora/protocol/openid-connect/token`, wireguard: null });
    }

    if (request.method === 'POST' && url.pathname === '/realms/snaphora/protocol/openid-connect/token') {
        const form = new URLSearchParams((await body(request)).toString());
        const device = state.devices[form.get('client_id') ?? ''];
        if (form.get('grant_type') !== 'client_credentials' || !device?.clientSecret || device.clientSecret !== form.get('client_secret')) {
            return json(response, 401, { error: 'invalid_client' });
        }
        const token = randomBytes(24).toString('hex');
        state.accessTokens[token] = { deviceId: form.get('client_id'), expires: Date.now() + 300_000 };
        save();
        return json(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 300 });
    }

    const deviceId = deviceFor(request);
    if (!deviceId) {
        response.writeHead(401).end();
        return;
    }
    const device = state.devices[deviceId];

    if (request.method === 'GET' && url.pathname === '/device/v1/config') {
        const etag = `"${sha256(JSON.stringify(device.config)).slice(0, 20)}"`;
        if (request.headers['if-none-match'] === etag) {
            response.writeHead(304).end();
            return;
        }
        return json(response, 200, device.config, { ETag: etag });
    }

    const asset = /^\/device\/v1\/assets\/([0-9a-f]{64})$/.exec(url.pathname);
    if (request.method === 'GET' && asset) {
        if (!assetsOf(device.config.event).includes(asset[1]) || !state.assets[asset[1]]) {
            return json(response, 404, { error: 'Bild unbekannt' });
        }
        response.writeHead(200, { 'Content-Type': state.assets[asset[1]].contentType });
        response.end(readFileSync(path.join(dataDir, 'assets', asset[1])));
        return;
    }

    const photo = /^\/device\/v1\/events\/([^/]+)\/photos\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && photo) {
        const [, eventId, photoId] = photo.map(decodeURIComponent);
        const data = await body(request);
        if (!ID.test(eventId) || !PHOTO_ID.test(photoId)) {
            return json(response, 400, { error: 'Ungültige Kennung' });
        }
        if (!eventsOf(deviceId).has(eventId)) {
            return json(response, 403, { error: 'Event gehört nicht zu diesem Gerät' });
        }
        if (state.closedEvents.includes(eventId)) {
            return json(response, 409, { error: 'Event ist abgeschlossen' });
        }
        const hash = sha256(data);
        if (request.headers['x-content-sha256'] !== hash) {
            return json(response, 400, { error: 'Prüfsumme stimmt nicht' });
        }
        const key = `${eventId}/${photoId}`;
        const previous = state.photos[key];
        mkdirSync(path.join(dataDir, 'photos', eventId), { recursive: true });
        writeFileSync(path.join(dataDir, 'photos', eventId, photoId), data);
        state.photos[key] = {
            eventId, photoId, sha256: hash, size: data.length,
            capturedAt: request.headers['x-captured-at'] ?? null,
            uploads: (previous?.uploads ?? 0) + (previous?.sha256 === hash ? 0 : 1),
            requests: (previous?.requests ?? 0) + 1,
            receivedAt: new Date().toISOString(),
        };
        save();
        return json(response, 200, { photoId, sha256: hash, url: `${publicUrl}/_mock/photos/${eventId}/${photoId}` });
    }

    if (request.method === 'POST' && url.pathname === '/device/v1/status') {
        state.status.push({ deviceId, received: new Date().toISOString(), report: JSON.parse((await body(request)).toString() || '{}') });
        state.status = state.status.slice(-50);
        save();
        response.writeHead(204).end();
        return;
    }

    json(response, 404, { error: 'Unbekannte Anfrage' });
}

// --- Steuerung ---
async function control(request, response, url) {
    if (request.method === 'DELETE' && url.pathname === '/_mock') {
        // Registrierte Geräte bleiben (sonst müsste sich der Agent neu registrieren), alles andere wird geleert
        const devices = state.devices;
        state = { ...emptyState(), tokens: state.tokens, accessTokens: state.accessTokens, devices };
        for (const device of Object.values(devices)) {
            device.config.event = null;
            device.pastEvents = [];
        }
        rmSync(path.join(dataDir, 'photos'), { recursive: true, force: true });
        mkdirSync(path.join(dataDir, 'photos'), { recursive: true });
        offline = false;
        seed();
        return json(response, 200, { ok: true });
    }
    if (request.method === 'PUT' && url.pathname === '/_mock/network') {
        offline = Boolean(JSON.parse((await body(request)).toString() || '{}').offline);
        console.log(offline ? 'Netz simuliert: AUS' : 'Netz simuliert: AN');
        return json(response, 200, { offline });
    }
    if (request.method === 'POST' && url.pathname === '/_mock/tokens') {
        const input = JSON.parse((await body(request)).toString() || '{}');
        const deviceId = input.deviceId ?? `box-${randomBytes(3).toString('hex')}`;
        const token = randomBytes(12).toString('base64url');
        state.tokens[token] = { deviceId, usedBy: null, expires: Date.now() + 24 * 3600_000 };
        state.devices[deviceId] ??= { name: input.name ?? deviceId, clientSecret: null, installationId: null, config: { device: { deviceId, version: 1 }, event: null } };
        save();
        return json(response, 200, { token, deviceId });
    }
    const device = /^\/_mock\/devices\/([^/]+)$/.exec(url.pathname);
    if (device && request.method === 'PUT') {
        const input = JSON.parse((await body(request)).toString() || '{}');
        const entry = state.devices[device[1]];
        if (!entry) {
            return json(response, 404, { error: 'Gerät unbekannt' });
        }
        if (input.device) {
            entry.config.device = { ...input.device, deviceId: device[1] };
        }
        if ('event' in input) {
            const previous = entry.config.event?.eventId;
            if (previous && previous !== input.event?.eventId) {
                entry.pastEvents = [...new Set([...(entry.pastEvents ?? []), previous])];
            }
            entry.config.event = input.event;
        }
        save();
        return json(response, 200, entry.config);
    }
    if (request.method === 'GET' && url.pathname === '/_mock/devices') {
        return json(response, 200, Object.fromEntries(Object.entries(state.devices).map(([id, d]) => [id, { name: d.name, registered: Boolean(d.clientSecret), config: d.config }])));
    }
    if (request.method === 'POST' && url.pathname === '/_mock/assets') {
        const data = await body(request);
        const hash = sha256(data);
        const contentType = request.headers['content-type'] ?? 'image/png';
        writeFileSync(path.join(dataDir, 'assets', hash), data);
        state.assets[hash] = { contentType, size: data.length };
        save();
        return json(response, 200, { sha256: hash, contentType, size: data.length });
    }
    if (request.method === 'GET' && url.pathname === '/_mock/photos') {
        return json(response, 200, Object.values(state.photos));
    }
    const photoFile = /^\/_mock\/photos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && photoFile && ID.test(photoFile[1]) && PHOTO_ID.test(photoFile[2])) {
        const file = path.join(dataDir, 'photos', photoFile[1], photoFile[2]);
        if (!existsSync(file)) {
            return json(response, 404, { error: 'Foto noch nicht hochgeladen' });
        }
        response.writeHead(200, { 'Content-Type': 'image/jpeg' });
        response.end(readFileSync(file));
        return;
    }
    if (request.method === 'GET' && url.pathname === '/_mock/status') {
        return json(response, 200, state.status);
    }
    const close = /^\/_mock\/events\/([^/]+)\/close$/.exec(url.pathname);
    if (request.method === 'POST' && close) {
        state.closedEvents.push(close[1]);
        save();
        return json(response, 200, { closed: close[1] });
    }
    json(response, 404, { error: 'Unbekannte Steuer-Anfrage' });
}

function overview(response) {
    const escape = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const devices = Object.entries(state.devices).map(([id, d]) => {
        const event = d.config.event;
        const last = state.status.filter((s) => s.deviceId === id).at(-1);
        return `<tr><td>${escape(id)}</td><td>${d.clientSecret ? 'ja' : 'nein'}</td><td>${event ? `${escape(event.eventId)} v${event.version} – ${escape(event.name)}` : '–'}</td>` +
            `<td>${last ? `${escape(last.received)}: ${last.report.uploads?.pending ?? '?'} ausstehend, ${last.report.prints ?? '–'} Drucke` : '–'}</td></tr>`;
    }).join('');
    const photos = Object.values(state.photos).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 60)
        .map((p) => `<figure><img loading="lazy" src="/_mock/photos/${escape(p.eventId)}/${escape(p.photoId)}"><figcaption>${escape(p.eventId)}/${escape(p.photoId)}</figcaption></figure>`).join('');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Snaphora Mock-Backend</title>
<style>body{font:15px system-ui;margin:24px;color:#222}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:6px 12px;text-align:left}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}img{width:100%;border-radius:6px}figure{margin:0}figcaption{font-size:12px;color:#666}
.off{background:#fee;padding:8px;border-radius:6px}</style>
<h1>Snaphora Mock-Backend</h1>${offline ? '<p class="off">Funkloch simuliert – Geräte erreichen den Server nicht.</p>' : ''}
<h2>Geräte</h2><table><tr><th>Gerät</th><th>registriert</th><th>Event</th><th>letzter Status</th></tr>${devices}</table>
<h2>Hochgeladene Fotos (${Object.keys(state.photos).length})</h2><div class="grid">${photos}</div>`);
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://mock');
    try {
        if (url.pathname.startsWith('/_mock')) {
            await control(request, response, url);
        } else if (url.pathname === '/') {
            overview(response);
        } else if (offline) {
            // Wie ein Funkloch: keine Antwort, Verbindung bricht ab
            request.socket.destroy();
        } else {
            await deviceApi(request, response, url);
        }
    } catch (error) {
        console.error(error);
        json(response, 500, { error: error.message });
    }
});

server.listen(port, () => console.log(`Mock-Backend auf Port ${port} (öffentliche Adresse ${publicUrl})`));
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
