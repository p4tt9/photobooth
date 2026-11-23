// Anmeldung mit persönlicher PIN, Sitzungen und Sperre nach Fehlversuchen (Konzept 4.5).
//
// - Zugänge: config/access/staff.json (vom Agent, nur Hashes) und die Not-PIN aus der Provisionierung.
//   Aufbau-Zugänge eines Events gelten nur in dessen Zeitfenster.
// - Sperre gilt für die ganze Box (nicht pro Browser) und übersteht Neustarts: nach 5 Fehlversuchen 1 min,
//   danach jeweils doppelt so lang, höchstens 15 min.
// - Sitzungen liegen nur im Speicher: Nach einem Neustart muss man sich neu anmelden, das ist gewollt.
//   Im Browser steht nur ein zufälliges Token; gespeichert wird dessen Hash.

import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ACCESS_DIRECTORY, ACCESS_FILE, EMERGENCY_PERSON, PIN_HASH_PATTERN, PIN_PATTERN, type AccessEntry, type Role } from '@snaphora/contracts';
import { readJson, writeJson } from '@snaphora/platform';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { AuditService } from './audit.service.js';
import { verifyPin } from './pin.js';

export interface Person {
    personId: string;
    name: string;
    role: Role;
}

export interface Session extends Person {
    kiosk: boolean;
    createdAt: number;
    lastSeen: number;
}

export type LoginResult = { ok: true; token: string; session: Session } | { ok: false; reason: 'locked' | 'wrong'; retryAfterSeconds?: number };

interface LockState {
    failures: number;
    lockedUntil: number;
}

export const SESSION_IDLE_MS = { kiosk: 2 * 60_000, other: 15 * 60_000 };
export const SESSION_MAX_MS = 12 * 3600_000;
const FREE_ATTEMPTS = 5;
const FIRST_LOCK_MS = 60_000;
const MAX_LOCK_MS = 15 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AccessService {
    private readonly logger = new Logger('Zugang');
    private readonly sessions = new Map<string, Session>();
    private lock: LockState | null = null;
    /** Anmeldungen nacheinander prüfen – parallele Versuche dürfen die Sperre nicht umgehen */
    private checking: Promise<unknown> = Promise.resolve();

    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly audit: AuditService,
    ) {}

    private get lockFile(): string {
        return path.join(this.environment.stateDir, 'access-lock.json');
    }

    private now(): number {
        return this.environment.now().getTime();
    }

    /** Alle Zugänge, die jetzt gelten. Ungültige Einträge werden übergangen, nie übernommen. */
    async people(): Promise<AccessEntry[]> {
        const file = await readJson<{ people?: unknown }>(path.join(this.environment.configDir, ACCESS_DIRECTORY, ACCESS_FILE));
        const now = this.now();
        const people = (Array.isArray(file?.people) ? file.people : []).filter((entry: unknown): entry is AccessEntry => {
            const e = entry as Partial<AccessEntry>;
            const valid =
                typeof e === 'object' &&
                e !== null &&
                typeof e.personId === 'string' &&
                ID.test(e.personId) &&
                typeof e.name === 'string' &&
                (e.role === 'admin' || e.role === 'setup') &&
                typeof e.pinHash === 'string' &&
                PIN_HASH_PATTERN.test(e.pinHash);
            if (!valid) {
                return false;
            }
            if (e.validFrom !== undefined || e.validUntil !== undefined) {
                const from = Date.parse(e.validFrom ?? '');
                const until = Date.parse(e.validUntil ?? '');
                return from <= now && now < until;
            }
            return true;
        });
        if (this.environment.emergencyPinHash) {
            people.push({ ...EMERGENCY_PERSON, pinHash: this.environment.emergencyPinHash });
        }
        return people;
    }

    private async lockState(): Promise<LockState> {
        if (!this.lock) {
            const stored = await readJson<LockState>(this.lockFile);
            this.lock = { failures: Number(stored?.failures) || 0, lockedUntil: Number(stored?.lockedUntil) || 0 };
        }
        return this.lock;
    }

    login(pin: unknown, kiosk: boolean): Promise<LoginResult> {
        const run = this.checking.then(() => this.check(pin, kiosk));
        this.checking = run.catch(() => undefined);
        return run;
    }

    private async check(pin: unknown, kiosk: boolean): Promise<LoginResult> {
        const lock = await this.lockState();
        const now = this.now();
        if (lock.lockedUntil > now) {
            return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((lock.lockedUntil - now) / 1000) };
        }
        let person: AccessEntry | undefined;
        if (typeof pin === 'string' && PIN_PATTERN.test(pin)) {
            // Alle prüfen statt beim ersten Treffer aufzuhören: gleiche Dauer, egal welche PIN passt
            const people = await this.people();
            const matches = await Promise.all(people.map((candidate) => verifyPin(pin, candidate.pinHash)));
            person = people.find((_, index) => matches[index]);
        }
        if (!person) {
            lock.failures += 1;
            if (lock.failures >= FREE_ATTEMPTS) {
                lock.lockedUntil = now + Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** (lock.failures - FREE_ATTEMPTS));
            }
            await writeJson(this.lockFile, lock, 0o600);
            await this.audit.record('Anmeldung fehlgeschlagen', null, { failures: lock.failures, ...(lock.lockedUntil > now ? { lockedUntil: new Date(lock.lockedUntil).toISOString() } : {}) });
            return lock.lockedUntil > now ? { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((lock.lockedUntil - now) / 1000) } : { ok: false, reason: 'wrong' };
        }
        if (lock.failures > 0) {
            this.lock = { failures: 0, lockedUntil: 0 };
            await writeJson(this.lockFile, this.lock, 0o600);
        }
        const token = randomBytes(32).toString('base64url');
        const session: Session = { personId: person.personId, name: person.name, role: person.role, kiosk, createdAt: now, lastSeen: now };
        this.sessions.set(tokenHash(token), session);
        await this.audit.record('Angemeldet', session, { role: session.role, kiosk });
        return { ok: true, token, session };
    }

    /** Sitzung zum Token, sofern noch gültig; verlängert die Leerlaufzeit */
    session(token: string | undefined): Session | null {
        if (!token) {
            return null;
        }
        const key = tokenHash(token);
        const session = this.sessions.get(key);
        if (!session) {
            return null;
        }
        const now = this.now();
        const idle = session.kiosk ? SESSION_IDLE_MS.kiosk : SESSION_IDLE_MS.other;
        if (now - session.lastSeen > idle || now - session.createdAt > SESSION_MAX_MS) {
            this.sessions.delete(key);
            void this.audit.record('Sitzung abgelaufen', session);
            return null;
        }
        session.lastSeen = now;
        return session;
    }

    async logout(token: string | undefined): Promise<void> {
        const session = token ? this.sessions.get(tokenHash(token)) : undefined;
        if (token && session) {
            this.sessions.delete(tokenHash(token));
            await this.audit.record('Abgemeldet', session);
        }
    }

    async lockStatus(): Promise<{ failures: number; lockedUntil: string | null }> {
        const lock = await this.lockState();
        return { failures: lock.failures, lockedUntil: lock.lockedUntil > this.now() ? new Date(lock.lockedUntil).toISOString() : null };
    }

    activeSessions(): Session[] {
        return [...this.sessions.values()];
    }
}
