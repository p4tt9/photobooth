// Auslieferung der Verwaltungsoberfläche (Angular, box/apps/admin) unter /admin/.
//
// - Dateien mit Prüfsumme im Namen dürfen lange im Cache bleiben, index.html nie (neue Version sofort sichtbar).
// - Unbekannte Pfade unter /admin/ bekommen index.html: Angular übernimmt das Routing (z. B. /admin/druck).
// - Strenge Content-Security-Policy: nur Skripte aus eigenen Dateien, keine fremden Quellen, nicht einbettbar.

import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';

export const ADMIN_PREFIX = '/admin/';

export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    // Angular setzt die Stile der Komponenten als <style>-Elemente
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
].join('; ');

function secure(reply: FastifyReply): void {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
}

export async function serveAdminUi(app: NestFastifyApplication, directory: string | null): Promise<void> {
    if (!directory || !existsSync(path.join(directory, 'index.html'))) {
        console.warn(`Verwaltungsoberfläche nicht gefunden (${directory ?? 'ADMIN_DIR nicht gesetzt'}) – nur die Schnittstelle läuft`);
        return;
    }
    await app.register(fastifyStatic, {
        root: directory,
        prefix: ADMIN_PREFIX,
        // Jede Datei als eigene Route; alles andere unter /admin/ fängt die Route unten ab
        wildcard: false,
        index: false,
        setHeaders: (reply, file) => {
            secure(reply);
            reply.header('Cache-Control', /-[A-Z0-9]{8}\.(js|css)$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
    });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get('/admin', (_request, reply) => reply.redirect(ADMIN_PREFIX, 301));
    fastify.get('/admin/*', (_request, reply) => {
        secure(reply);
        reply.header('Cache-Control', 'no-cache');
        return reply.sendFile('index.html', directory);
    });
}
