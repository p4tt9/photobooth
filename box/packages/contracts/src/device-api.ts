// Typen aus contracts/device-api.yaml (von Hand gepflegt, bis der Vertrag eingefroren wird).

import type { StaffMember } from './access.js';
import type { Checklist } from './setup.js';

export interface RegistrationRequest {
    token: string;
    installationId: string;
    agentVersion?: string;
    hardware?: { model?: string; hostname?: string };
}

export interface RegistrationResponse {
    deviceId: string;
    name?: string;
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    wireguard?: unknown;
}

export interface AssetRef {
    sha256: string;
    contentType: 'image/png' | 'image/jpeg' | 'font/ttf';
    size?: number;
    name?: string;
}

export interface DeviceSettings {
    deviceId: string;
    name?: string;
    version: number;
    ringlight?: { enabled?: boolean; url?: string };
    buzzer?: { photoKey?: number | null; collageKey?: number | null };
    /** Personen mit dauerhaftem Zugang zu dieser Box (in der Regel Admins) */
    staff?: StaffMember[];
}

export interface EventProfile {
    eventId: string;
    version: number;
    name?: string;
    validFrom: string;
    validUntil: string;
    startScreen?: { title?: string; subtitle?: string };
    colors?: { primary?: string; secondary?: string; highlight?: string; font?: string; countdownBackground?: string };
    background?: AssetRef;
    logo?: AssetRef;
    photo?: { enabled?: boolean; countdown?: number; frame?: AssetRef; text?: string[] };
    collage?: { enabled?: boolean; layout?: string; countdown?: number; frame?: AssetRef; text?: string[] };
    print?: { enabled?: boolean; quota?: number; frame?: AssetRef; text?: string[]; qrCode?: boolean };
    gallery?: { enabled: boolean; photoUrlPrefix?: string };
    look?: string | null;
    /** Der Buchung zugewiesene Mitarbeitende; ihr Zugang gilt nur im Zeitfenster des Events */
    staff?: StaffMember[];
    /** Aufbau-Checkliste aus der Vorlage des Pakets */
    checklist?: Checklist;
}

export interface DeviceConfig {
    device: DeviceSettings;
    event: EventProfile | null;
}

export interface StatusReport {
    time: string;
    agentVersion: string;
    appVersion?: string;
    config: { deviceVersion: number | null; eventId: string | null; eventVersion: number | null; lastSync: string | null };
    localChanges?: Record<string, unknown>;
    uploads: { pending: number; failed: number; uploaded: number };
    prints?: number | null;
    /** Aufbau-Berichte, die noch auf die Übertragung warten */
    setupReports?: { pending: number };
}
