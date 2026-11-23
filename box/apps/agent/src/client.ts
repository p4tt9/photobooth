// Verbindung zum Snaphora-Backend (contracts/device-api.yaml). Nur ausgehend, jede Anfrage mit Zeitlimit.
// Fehler werden unterschieden in „offline“ (Netz, Zeitüberschreitung, 5xx – später erneut versuchen)
// und „abgelehnt“ (4xx – Wiederholen ändert nichts).

import type { DeviceConfig, RegistrationRequest, RegistrationResponse, StatusReport } from '@snaphora/contracts';
import { validateDeviceConfig, validateRegistration } from '@snaphora/contracts';

export interface Credentials {
    deviceId: string;
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
}

/** Server nicht erreichbar oder vorübergehend gestört – später erneut versuchen. */
export class OfflineError extends Error {}

/** Server hat die Anfrage abgelehnt. */
export class RejectedError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 180_000;

export class ServerClient {
    private token: { value: string; expires: number } | null = null;

    /**
     * @param allowHttp Verbindung ohne TLS erlauben – nur für das Mock-Backend in der Entwicklung.
     *     Im Betrieb muss der Server per https:// erreichbar sein (Konzept 4.7).
     */
    constructor(
        private readonly baseUrl: string,
        private readonly credentials: () => Credentials | null,
        private readonly allowHttp = false,
    ) {
        const protocol = new URL(baseUrl).protocol;
        if (protocol !== 'https:' && !(allowHttp && protocol === 'http:')) {
            throw new Error(`Server-Adresse ${baseUrl} muss mit https:// beginnen`);
        }
    }

    async register(request: RegistrationRequest): Promise<RegistrationResponse> {
        const response = await this.fetch('/device/v1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        }, false);
        return validateRegistration(await response.json(), this.allowHttp) as RegistrationResponse;
    }

    async getConfig(etag: string | null): Promise<{ changed: false } | { changed: true; etag: string | null; config: DeviceConfig }> {
        const response = await this.fetch('/device/v1/config', { headers: etag ? { 'If-None-Match': etag } : {} });
        if (response.status === 304) {
            return { changed: false };
        }
        // Ungültige Konfiguration → Fehler, die zuletzt gute bleibt aktiv
        const config: DeviceConfig = validateDeviceConfig(await response.json(), this.allowHttp);
        return { changed: true, etag: response.headers.get('etag'), config };
    }

    async getAsset(sha256: string): Promise<Buffer> {
        const response = await this.fetch(`/device/v1/assets/${sha256}`, {});
        return Buffer.from(await response.arrayBuffer());
    }

    async putPhoto(eventId: string, photoId: string, data: Buffer, headers: { sha256: string; capturedAt: string; kind?: string }): Promise<void> {
        await this.fetch(`/device/v1/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(photoId)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'image/jpeg',
                'X-Content-SHA256': headers.sha256,
                'X-Captured-At': headers.capturedAt,
                ...(headers.kind ? { 'X-Photo-Kind': headers.kind } : {}),
            },
            body: new Uint8Array(data),
        }, true, UPLOAD_TIMEOUT_MS);
    }

    async postStatus(report: StatusReport): Promise<void> {
        await this.fetch('/device/v1/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report),
        });
    }

    private async fetch(path: string, init: RequestInit, authenticated = true, timeoutMs = TIMEOUT_MS, retried = false): Promise<Response> {
        const headers = new Headers(init.headers);
        if (authenticated) {
            headers.set('Authorization', `Bearer ${await this.accessToken()}`);
        }
        let response: Response;
        try {
            response = await fetch(this.baseUrl.replace(/\/$/, '') + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            throw new OfflineError(`${path}: ${describe(error)}`);
        }
        if (response.status === 401 && authenticated && !retried) {
            // Token abgelaufen oder vom Server verworfen: einmal mit neuem Token
            this.token = null;
            await response.body?.cancel();
            return this.fetch(path, init, authenticated, timeoutMs, true);
        }
        if (response.ok || response.status === 304) {
            return response;
        }
        const text = (await response.text().catch(() => '')).slice(0, 300);
        if (response.status >= 500 || response.status === 408 || response.status === 429) {
            throw new OfflineError(`${path}: HTTP ${response.status} ${text}`);
        }
        throw new RejectedError(`${path}: HTTP ${response.status} ${text}`, response.status);
    }

    private async accessToken(): Promise<string> {
        if (this.token && this.token.expires > Date.now()) {
            return this.token.value;
        }
        const credentials = this.credentials();
        if (!credentials) {
            throw new RejectedError('Box ist nicht registriert', 401);
        }
        let response: Response;
        try {
            response = await fetch(credentials.tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: credentials.clientId,
                    client_secret: credentials.clientSecret,
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            throw new OfflineError(`Token: ${describe(error)}`);
        }
        if (!response.ok) {
            const text = (await response.text().catch(() => '')).slice(0, 300);
            if (response.status >= 500) {
                throw new OfflineError(`Token: HTTP ${response.status} ${text}`);
            }
            throw new RejectedError(`Token: HTTP ${response.status} ${text}`, response.status);
        }
        const body = (await response.json()) as { access_token: string; expires_in?: number };
        // 30 s vor Ablauf erneuern, damit kein Upload mit einem gerade abgelaufenen Token startet
        this.token = { value: body.access_token, expires: Date.now() + Math.max(10, (body.expires_in ?? 300) - 30) * 1000 };
        return this.token.value;
    }
}

function describe(error: unknown): string {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? (error as Error).message ?? String(error);
}
