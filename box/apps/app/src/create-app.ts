import 'reflect-metadata';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { serveAdminUi } from './admin-ui.js';
import { AppModule } from './app.module.js';
import type { AppEnvironment } from './environment.js';

export const API_PREFIX = 'api/v1';

/** Baut die Anwendung (Start und Tests verwenden dieselbe Konfiguration) */
export async function createApp(environment: AppEnvironment, options: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
    const adapter = new FastifyAdapter({
        // Anfragen kommen über den Apache-Proxy (bis Paket 9) – für Protokoll (Secure-Cookie) und Absender-IP
        trustProxy: true,
        // Die Schnittstelle nimmt nur kleine JSON-Anfragen an; Uploads bekommen später eigene Grenzen
        bodyLimit: 64 * 1024,
    });
    const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(environment), adapter, {
        logger: options.logger === false ? false : ['log', 'warn', 'error'],
    });
    await app.register(cookie);
    // Uploads (Bibliothek): eine Datei je Anfrage; die Größe begrenzt jede Schnittstelle selbst
    await app.register(multipart, { limits: { files: 1, fields: 0, fileSize: 25 * 1024 * 1024 } });
    app.setGlobalPrefix(API_PREFIX);
    await serveAdminUi(app, environment.adminDir);
    app.enableShutdownHooks();
    await app.init();
    return app;
}
