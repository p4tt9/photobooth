// Snaphora-Agent: verbindet die Box mit dem Backend (contracts/device-api.yaml).
//
//   - Registrierung mit Einmal-Token → eigene Zugangsdaten (Keycloak-Client)
//   - Konfiguration vom Server in Ebenen für die App (config-sync.ts)
//   - Galerie-Upload mit Warteschlange (uploads.ts)
//   - Kurzer Status an den Server
//
// Die Box funktioniert auch ganz ohne Agent oder Server (Konzept: autark). Ohne SERVER_URL bleibt der Agent untätig.
// Lokale Schnittstelle (nur im internen Docker-Netz bzw. über `docker compose exec`):
//   GET  /health        Lebenszeichen
//   GET  /v1/status     Registrierung, Konfiguration, Upload-Warteschlange
//   POST /v1/sync       sofort mit dem Server abgleichen
//   POST /v1/register   {"token": "..."} Box registrieren

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import path from 'node:path';
import { OfflineError, ServerClient, type Credentials } from './client.js';
import type { StatusReport } from '@snaphora/contracts';
import { ConfigSync } from './config-sync.js';
import { readJson, writeAtomic, writeJson } from '@snaphora/platform';
import { UploadQueue } from './uploads.js';

const AGENT_DIR = process.env.AGENT_DIR ?? '/agent';
const DATA_DIR = process.env.DATA_DIR ?? '/data';
const CONFIG_DIR = process.env.CONFIG_DIR ?? '/config';
const PRIVATE_DIR = process.env.PRIVATE_DIR ?? '/private';
const SERVER_URL = (process.env.SERVER_URL ?? '').trim();
const PORT = Number(process.env.PORT ?? 3001);
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL ?? 60) * 1000;
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL ?? 5) * 1000;
const AGENT_VERSION = process.env.APP_VERSION ?? 'dev';

const log = (message: string) => console.log(`[agent] ${message}`);

const credentialsFile = path.join(AGENT_DIR, 'credentials.json');
let credentials: Credentials | null = await readJson<Credentials>(credentialsFile);
// Nur für das Mock-Backend in der Entwicklung: Verbindung ohne TLS
const ALLOW_INSECURE_HTTP = process.env.ALLOW_INSECURE_HTTP === '1';
let client: ServerClient | null = null;
try {
    client = SERVER_URL ? new ServerClient(SERVER_URL, () => credentials, ALLOW_INSECURE_HTTP) : null;
} catch (error) {
    // Falsche Adresse darf die Box nicht lahmlegen: Agent läuft weiter, ohne Server
    log(`${(error as Error).message} – Agent arbeitet ohne Server`);
}

const configSync = new ConfigSync({ agentDir: AGENT_DIR, configDir: CONFIG_DIR, privateDir: PRIVATE_DIR, log });
const uploads = new UploadQueue({ dataDir: DATA_DIR, agentDir: AGENT_DIR, log, activeEvent: () => configSync.activeEvent() });
let lastStatusError: string | null = null;
let registrationError: string | null = null;

async function installationId(): Promise<string> {
    const file = path.join(AGENT_DIR, 'installation-id');
    const existing = (await readFile(file, 'utf8').catch(() => '')).trim();
    if (/^[0-9a-f]{32}$/.test(existing)) {
        return existing;
    }
    const id = randomBytes(16).toString('hex');
    await writeAtomic(file, id);
    return id;
}

async function register(token: string): Promise<void> {
    if (!client) {
        throw new Error('Kein Server eingestellt (SERVER_URL)');
    }
    const response = await client.register({
        token,
        installationId: await installationId(),
        agentVersion: AGENT_VERSION,
        hardware: { hostname: hostname() },
    });
    credentials = { deviceId: response.deviceId, clientId: response.clientId, clientSecret: response.clientSecret, tokenUrl: response.tokenUrl };
    // Zugangsdaten nur für den Agent lesbar; das Volume ist nicht in der App eingebunden
    await writeJson(credentialsFile, credentials, 0o600);
    registrationError = null;
    log(`Registriert als ${response.name ?? response.deviceId}`);
}

async function localChanges(): Promise<Record<string, unknown>> {
    const event = configSync.activeEvent();
    const layer = await readJson<{ eventId?: string; config?: Record<string, unknown> }>(path.join(CONFIG_DIR, 'layers', 'local-event.json'));
    return event && layer?.eventId === event.eventId ? (layer.config ?? {}) : {};
}

async function printsInEvent(): Promise<number | null> {
    // Gleiche Zählung wie die App beim Druckkontingent: eine Zeile im Druckprotokoll je Druck
    const content = await readFile(path.join(DATA_DIR, 'printed.csv'), 'utf8').catch(() => null);
    return content === null ? 0 : content.split('\n').filter((line) => line.trim() !== '').length;
}

async function statusReport(): Promise<StatusReport> {
    const event = configSync.activeEvent();
    const counts = uploads.counts();
    return {
        time: new Date().toISOString(),
        agentVersion: AGENT_VERSION,
        appVersion: process.env.APP_VERSION,
        config: { deviceVersion: configSync.deviceVersion, eventId: event?.eventId ?? null, eventVersion: event?.version ?? null, lastSync: configSync.lastSync },
        localChanges: await localChanges(),
        uploads: { pending: counts.pending, failed: counts.failed, uploaded: counts.uploaded },
        prints: event ? await printsInEvent() : null,
    };
}

let syncing: Promise<void> | null = null;
function syncNow(): Promise<void> {
    syncing ??= (async () => {
        try {
            if (!client) {
                return;
            }
            if (!credentials) {
                const token = (process.env.REGISTRATION_TOKEN ?? '').trim();
                if (!token) {
                    return;
                }
                try {
                    await register(token);
                } catch (error) {
                    registrationError = (error as Error).message;
                    log(`Registrierung fehlgeschlagen: ${registrationError}`);
                    return;
                }
            }
            try {
                await configSync.sync(client);
            } catch (error) {
                log(`Abgleich ${error instanceof OfflineError ? 'nicht möglich (offline)' : 'fehlgeschlagen'}: ${(error as Error).message}`);
                return;
            }
            try {
                await client.postStatus(await statusReport());
                lastStatusError = null;
            } catch (error) {
                lastStatusError = (error as Error).message;
            }
        } finally {
            syncing = null;
        }
    })();
    return syncing;
}

async function uploadTick(): Promise<void> {
    try {
        await uploads.scan();
        if (client && credentials) {
            const count = await uploads.uploadDue(client);
            if (count > 0) {
                log(`Upload: ${count} Foto(s) hochgeladen, ${uploads.counts().pending} ausstehend`);
            }
        }
    } catch (error) {
        log(`Upload-Durchlauf fehlgeschlagen: ${(error as Error).message}`);
    }
}

async function status(): Promise<Record<string, unknown>> {
    const event = configSync.activeEvent();
    return {
        server: SERVER_URL || null,
        registered: credentials !== null,
        deviceId: credentials?.deviceId ?? null,
        registrationError,
        lastSync: configSync.lastSync,
        lastSyncError: configSync.lastError,
        lastStatusError,
        deviceVersion: configSync.deviceVersion,
        event: event ? { eventId: event.eventId, version: event.version, name: event.name ?? null, validUntil: event.validUntil } : null,
        uploads: { ...uploads.counts(), entries: uploads.list().filter((entry) => entry.state !== 'local').slice(-50) },
    };
}

// --- Lokale Schnittstelle ---
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function send(response: ServerResponse, code: number, body: unknown): void {
    response.writeHead(code, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url ?? '/', 'http://agent');
        if (request.method === 'GET' && url.pathname === '/health') {
            send(response, 200, { ok: true });
        } else if (request.method === 'GET' && url.pathname === '/v1/status') {
            send(response, 200, await status());
        } else if (request.method === 'POST' && url.pathname === '/v1/sync') {
            await syncNow();
            await uploadTick();
            send(response, 200, await status());
        } else if (request.method === 'POST' && url.pathname === '/v1/register') {
            const token = String((await readBody(request)).token ?? '').trim();
            if (!token) {
                send(response, 400, { error: 'Token fehlt' });
                return;
            }
            await register(token);
            await syncNow();
            send(response, 200, await status());
        } else {
            send(response, 404, { error: 'Unbekannte Anfrage' });
        }
    } catch (error) {
        log(`Fehler bei ${request.method} ${request.url}: ${(error as Error).message}`);
        send(response, 500, { error: (error as Error).message });
    }
});

// --- Start ---
await configSync.start();
await uploads.start();
log(client ? `Server ${SERVER_URL}, ${credentials ? `registriert als ${credentials.deviceId}` : 'noch nicht registriert'}` : 'Kein Server eingestellt – Box läuft nur mit lokalen Einstellungen');

const timers = [
    setInterval(() => void syncNow(), SYNC_INTERVAL_MS),
    setInterval(() => void uploadTick(), SCAN_INTERVAL_MS),
];
void syncNow().then(uploadTick);
server.listen(PORT, () => log(`Agent bereit auf Port ${PORT}`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        timers.forEach(clearInterval);
        server.close(() => process.exit(0));
    });
}
