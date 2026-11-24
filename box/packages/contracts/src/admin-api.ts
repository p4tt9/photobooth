// Schnittstelle von app für die Oberflächen (/api/v1/…): Antworten, die Server und Angular teilen.
// Wie ein gemeinsames DTO-Modul – ändert sich ein Feld, meldet der Compiler beide Seiten.

import type { ConfigValue, LayerName } from './layers.js';
import type { Role, SettingDefinition, SettingSection } from './settings.js';

export interface PersonInfo {
    personId: string;
    name: string;
    role: Role;
    kiosk: boolean;
}

export interface SessionInfo {
    person: PersonInfo | null;
}

/** Omit für jeden Fall einer Union einzeln (das normale Omit behielte nur die gemeinsamen Felder) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Einstellung, wie die Oberfläche sie bekommt (ohne RegExp) */
export type SettingDescription = DistributiveOmit<SettingDefinition, 'pattern' | 'role'> & { role: Role };

export interface SettingState {
    value: ConfigValue;
    /** Aus welcher Ebene der wirksame Wert kommt */
    source: LayerName;
    /** Das aktive Event gibt die Einstellung vor; eine Änderung gilt nur für dieses Event */
    eventManaged: boolean;
}

export interface ActiveEvent {
    eventId: string;
    name: string | null;
    version: number | null;
}

export interface SettingsResponse {
    sections: Record<SettingSection, string>;
    definitions: SettingDescription[];
    values: Record<string, SettingState>;
    event: ActiveEvent | null;
}

export interface SettingChange {
    path: string;
    from: ConfigValue;
    to: ConfigValue;
    layer: 'box' | 'local-event';
}

export interface SettingsUpdateResponse {
    changes: SettingChange[];
    values: Record<string, SettingState>;
}

export interface PrintStatus {
    limit: number;
    printed: number | null;
    remaining: number | null;
    locked: boolean;
}

export interface AgentStatus {
    reachable: boolean;
    reason?: string;
    server?: string | null;
    registered?: boolean;
    deviceId?: string | null;
    lastSync?: string | null;
    lastSyncError?: string | null;
    uploads?: { pending: number; failed: number; uploaded: number; local: number };
}

export interface BoxStatus {
    version: string;
    uptimeSeconds: number;
    event: ActiveEvent | null;
    print: PrintStatus;
    photos: number | null;
    disk: { freeBytes: number; totalBytes: number } | null;
    agent: AgentStatus;
}

export interface AuditEntry {
    at: string;
    action: string;
    personId: string | null;
    name: string | null;
    details?: Record<string, unknown>;
}

export interface AccessLog {
    lock: { failures: number; lockedUntil: string | null };
    sessions: PersonInfo[];
    entries: AuditEntry[];
}

/** Fehlerantwort (400/401/403/429) */
export interface ApiError {
    error?: string;
    message?: string;
    path?: string;
    retryAfterSeconds?: number;
}

export interface LookInfo {
    id: string;
    name: string;
}

export interface RinglightTest {
    ok: boolean;
    url: string | null;
    status?: number;
    milliseconds?: number;
    error?: string;
}
