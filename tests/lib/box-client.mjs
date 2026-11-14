// Kleiner HTTP-Client für die Fotobox-API, wie ihn die Kiosk-Oberfläche nutzt
// (Session-Cookie + CSRF-Token). Gemeinsam genutzt von Smoke- und Absturztests.

import { setTimeout as sleep } from 'node:timers/promises';

export class BoxClient {
    constructor(baseUrl = process.env.BASE_URL ?? 'http://localhost:8080') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.cookies = '';
        this.token = '';
    }

    async request(path, options = {}) {
        try {
            return await this.requestOnce(path, options);
        } catch (error) {
            // Apache closes idle keep-alive connections after a few seconds. If a test paused that long,
            // the reused connection may already be gone – repeat GET requests once on a fresh connection.
            // POST requests (e.g. capture) are never repeated, so nothing is triggered twice.
            const method = options.method ?? 'GET';
            if (method === 'GET' && error?.cause?.code === 'UND_ERR_SOCKET') {
                return this.requestOnce(path, options);
            }
            throw error;
        }
    }

    async requestOnce(path, { method = 'GET', form, signal } = {}) {
        const response = await fetch(this.baseUrl + path, {
            method,
            headers: {
                ...(this.cookies ? { Cookie: this.cookies } : {}),
                ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            },
            body: form ? new URLSearchParams(form).toString() : undefined,
            redirect: 'manual',
            signal,
        });
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length > 0) {
            this.cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
        }
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`${method} ${path} → HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${method} ${path} → keine JSON-Antwort: ${text.slice(0, 300)}`);
        }
    }

    async waitUntilReady(timeoutMs = 90_000) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                await this.refreshToken();
                return;
            } catch (error) {
                if (Date.now() > deadline) {
                    throw new Error(`Fotobox unter ${this.baseUrl} nicht erreichbar: ${error.message}`);
                }
                await sleep(1000);
            }
        }
    }

    async refreshToken() {
        const { token } = await this.request('/api/csrf.php');
        if (!token) {
            throw new Error('Kein CSRF-Token erhalten');
        }
        this.token = token;
    }

    async capture({ signal } = {}) {
        const result = await this.request('/api/capture.php', {
            method: 'POST',
            form: { style: 'photo', csrf: this.token },
            signal,
        });
        if (result.error || !result.file) {
            throw new Error(`Auslösen fehlgeschlagen: ${JSON.stringify(result)}`);
        }
        return result;
    }

    async process(file, { signal } = {}) {
        const result = await this.request('/api/applyEffects.php', {
            method: 'POST',
            form: { file, style: 'photo', filter: '', csrf: this.token },
            signal,
        });
        if (result.error) {
            throw new Error(`Verarbeitung fehlgeschlagen: ${JSON.stringify(result)}`);
        }
        return result;
    }

    async print(file, { signal } = {}) {
        const query = new URLSearchParams({ filename: file, copies: '1', csrf: this.token });
        const result = await this.request(`/api/print.php?${query}`, { signal });
        if (result.error) {
            throw new Error(`Druck fehlgeschlagen: ${JSON.stringify(result)}`);
        }
        return result;
    }
}
