import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AccessEntry, ConfigLayer } from '@snaphora/contracts';
import { hashPin } from '../src/access/pin.js';
import { createApp } from '../src/create-app.js';
import type { AppEnvironment } from '../src/environment.js';

// Niedrige Kosten nur im Test, damit viele Anmeldungen schnell gehen
const cheap = { N: 1024, r: 8, p: 1 };

export interface TestBox {
    root: string;
    app: NestFastifyApplication;
    environment: AppEnvironment;
    clock: { now: number };
    request(method: string, url: string, options?: { body?: unknown; cookie?: string; csrf?: boolean; file?: { name: string; data: Buffer } }): Promise<{ status: number; body: any; cookie?: string; headers: Record<string, unknown> }>;
    login(pin: string, kiosk?: boolean): Promise<string>;
    writeLayer(name: string, layer: ConfigLayer): Promise<void>;
    writeAccess(people: AccessEntry[]): Promise<void>;
    restart(): Promise<void>;
    close(): Promise<void>;
}

export const EMERGENCY_PIN = '908172';

export async function startBox(options: { adminDir?: string; renderUrl?: string } = {}): Promise<TestBox> {
    const root = await mkdtemp(path.join(tmpdir(), 'app-'));
    const clock = { now: Date.parse('2026-11-23T12:00:00Z') };
    const environment: AppEnvironment = {
        configDir: path.join(root, 'config'),
        dataDir: path.join(root, 'data'),
        stateDir: path.join(root, 'state'),
        agentUrl: null,
        adminDir: options.adminDir ?? null,
        privateDir: path.join(root, 'private'),
        renderUrl: options.renderUrl ?? null,
        emergencyPinHash: await hashPin(EMERGENCY_PIN, cheap),
        host: '127.0.0.1',
        port: 0,
        appVersion: 'test',
        now: () => new Date(clock.now),
    };
    await mkdir(environment.dataDir, { recursive: true });
    let app = await createApp(environment, { logger: false });

    const box: TestBox = {
        root,
        get app() {
            return app;
        },
        environment,
        clock,
        async request(method, url, options = {}) {
            const headers: Record<string, string> = {};
            if (options.cookie) headers.cookie = options.cookie;
            if (options.csrf !== false && method !== 'GET') headers['x-snaphora-request'] = '1';
            let payload: object | Buffer | undefined = options.body as object | undefined;
            if (options.file) {
                // multipart/form-data von Hand, wie ihn ein Browser schickt
                const boundary = '----snaphora-test';
                headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
                payload = Buffer.concat([
                    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
                    options.file.data,
                    Buffer.from(`\r\n--${boundary}--\r\n`),
                ]);
            }
            const response = await app.getHttpAdapter().getInstance().inject({ method: method as 'GET', url, headers, ...(payload !== undefined ? { payload } : {}) });
            const setCookie = response.cookies.find((c: { name: string }) => c.name === 'snaphora_session') as { name: string; value: string } | undefined;
            return {
                status: response.statusCode,
                body: response.body ? safeJson(response.body) : null,
                cookie: setCookie?.value ? `snaphora_session=${setCookie.value}` : undefined,
                headers: response.headers as Record<string, unknown>,
            };
        },
        async login(pin, kiosk = false) {
            const response = await box.request('POST', '/api/v1/access/login', { body: { pin, kiosk } });
            if (response.status !== 200 || !response.cookie) {
                throw new Error(`Anmeldung fehlgeschlagen: ${response.status} ${JSON.stringify(response.body)}`);
            }
            return response.cookie;
        },
        async writeLayer(name, layer) {
            await mkdir(path.join(environment.configDir, 'layers'), { recursive: true });
            await writeFile(path.join(environment.configDir, 'layers', `${name}.json`), JSON.stringify(layer));
        },
        async writeAccess(people) {
            await mkdir(path.join(environment.configDir, 'access'), { recursive: true });
            await writeFile(path.join(environment.configDir, 'access', 'staff.json'), JSON.stringify({ updated: new Date().toISOString(), people }));
        },
        async restart() {
            await app.close();
            app = await createApp(environment, { logger: false });
        },
        async close() {
            await app.close();
        },
    };
    return box;
}

export const person = async (personId: string, role: 'admin' | 'setup', pin: string, extra: Partial<AccessEntry> = {}): Promise<AccessEntry> => ({
    personId,
    name: personId,
    role,
    pinHash: await hashPin(pin, cheap),
    ...extra,
});

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/** Kleinstes gültiges PNG mit beliebiger Größe im Kopf (Inhalt egal: geprüft wird nur der Kopf) */
export function png(width = 10, height = 10): Buffer {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
}
