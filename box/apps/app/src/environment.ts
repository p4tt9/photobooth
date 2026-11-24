// Laufzeit-Einstellungen von app aus Umgebungsvariablen (Provisionierung, docker compose).
// Werden einmal beim Start gelesen und als Provider bereitgestellt – kein Modul liest process.env selbst.

import { readFileSync } from 'node:fs';
import { PIN_HASH_PATTERN } from '@snaphora/contracts';

export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

export interface AppEnvironment {
    /** Einstellungs-Ebenen und Zugänge (gemeinsames Volume `config`) */
    configDir: string;
    /** Fotos, Druckzähler (Volume `data`, gehört bis Paket 9 noch photobooth) */
    dataDir: string;
    /** Bilder und Schriften der Gestaltung (Volume `private`; app besitzt die Upload-Ordner) */
    privateDir: string;
    /** Render-Dienst (Looks), `null` = ohne */
    renderUrl: string | null;
    /** Eigener Zustand: Zugriffsprotokoll, Sperre (Volume `app`) */
    stateDir: string;
    /** Lokale Schnittstelle des Agents, `null` = ohne Agent */
    agentUrl: string | null;
    /** Hash der Not-PIN aus der Provisionierung, `null` = keine */
    emergencyPinHash: string | null;
    /** Gebaute Verwaltungsoberfläche (box/apps/admin/dist), `null` = nicht ausliefern */
    adminDir: string | null;
    host: string;
    port: number;
    appVersion: string;
    now: () => Date;
}

/** Not-PIN: auf der Box als Datei (Compose-Secret, nicht in `docker inspect` sichtbar), in der Entwicklung als Variable */
function readEmergencyPinHash(env: NodeJS.ProcessEnv): string | null {
    if (env.ADMIN_PIN_HASH_FILE) {
        try {
            return readFileSync(env.ADMIN_PIN_HASH_FILE, 'utf8').trim() || null;
        } catch (error) {
            console.error(`Not-PIN nicht lesbar (${(error as Error).message}) – Zugang nur über PINs vom Server`);
            return null;
        }
    }
    return env.ADMIN_PIN_HASH?.trim() || null;
}

export function environmentFromProcess(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
    const emergencyPinHash = readEmergencyPinHash(env);
    if (emergencyPinHash && !PIN_HASH_PATTERN.test(emergencyPinHash)) {
        // Lieber ohne Not-PIN starten als gar nicht: Zugang dann über die PINs vom Server
        console.error('ADMIN_PIN_HASH hat kein gültiges Format (scrypt$N$r$p$salt$hash) – Not-PIN deaktiviert');
    }
    return {
        configDir: env.CONFIG_DIR ?? '/config',
        dataDir: env.DATA_DIR ?? '/data',
        stateDir: env.STATE_DIR ?? '/state',
        privateDir: env.PRIVATE_DIR ?? '/private',
        renderUrl: env.RENDER_URL?.trim() || null,
        agentUrl: env.AGENT_URL?.trim() || null,
        emergencyPinHash: emergencyPinHash && PIN_HASH_PATTERN.test(emergencyPinHash) ? emergencyPinHash : null,
        adminDir: env.ADMIN_DIR ?? null,
        host: env.HOST ?? '0.0.0.0',
        port: Number(env.PORT ?? 3002),
        appVersion: env.APP_VERSION ?? 'dev',
        now: () => new Date(),
    };
}
