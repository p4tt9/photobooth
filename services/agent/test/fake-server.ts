// Kleiner Ersatz-Server für die Unit-Tests (der vollständige Mock liegt in deploy/dev/mock-backend).

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DeviceConfig } from '../src/contract.js';

export interface FakeServer {
    url: string;
    config: DeviceConfig;
    assets: Map<string, Buffer>;
    photos: Map<string, { sha256: string; size: number; count: number }>;
    /** Antwortet mit 503, als wäre das Netz weg */
    offline: boolean;
    /** Antwort für Foto-Uploads erzwingen (z. B. 409) */
    photoStatus: number | null;
    requests: string[];
    close(): Promise<void>;
}

export async function startFakeServer(config: DeviceConfig): Promise<FakeServer> {
    const state = {
        config,
        assets: new Map<string, Buffer>(),
        photos: new Map<string, { sha256: string; size: number; count: number }>(),
        offline: false,
        photoStatus: null as number | null,
        requests: [] as string[],
    };
    const server: Server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
            chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks);
        const url = new URL(request.url ?? '/', 'http://fake');
        state.requests.push(`${request.method} ${url.pathname}`);
        if (state.offline) {
            response.writeHead(503).end();
            return;
        }
        if (url.pathname === '/token') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'token', expires_in: 300 }));
            return;
        }
        if (request.headers.authorization !== 'Bearer token') {
            response.writeHead(401).end();
            return;
        }
        if (url.pathname === '/device/v1/config') {
            const etag = `"${createHash('sha256').update(JSON.stringify(state.config)).digest('hex').slice(0, 16)}"`;
            if (request.headers['if-none-match'] === etag) {
                response.writeHead(304).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': 'application/json', ETag: etag }).end(JSON.stringify(state.config));
            return;
        }
        const asset = /^\/device\/v1\/assets\/([0-9a-f]{64})$/.exec(url.pathname);
        if (asset?.[1]) {
            const data = state.assets.get(asset[1]);
            response.writeHead(data ? 200 : 404).end(data);
            return;
        }
        const photo = /^\/device\/v1\/events\/([^/]+)\/photos\/([^/]+)$/.exec(url.pathname);
        if (photo && request.method === 'PUT') {
            if (state.photoStatus) {
                response.writeHead(state.photoStatus, { 'Content-Type': 'application/json' }).end('{"error":"abgelehnt"}');
                return;
            }
            const key = `${photo[1]}/${photo[2]}`;
            const sha256 = createHash('sha256').update(body).digest('hex');
            const previous = state.photos.get(key);
            state.photos.set(key, { sha256, size: body.length, count: (previous?.count ?? 0) + 1 });
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ photoId: photo[2], sha256 }));
            return;
        }
        if (url.pathname === '/device/v1/status') {
            response.writeHead(204).end();
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return Object.assign(state, {
        url,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    });
}

export const credentialsFor = (server: FakeServer) => () => ({ deviceId: 'box-1', clientId: 'box-1', clientSecret: 'geheim', tokenUrl: `${server.url}/token` });
