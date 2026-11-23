// Zugang an der Box: persönliche PINs (Konzept 4.5).
//
// PINs kommen vom Server, auf der Box liegen nur Hashes. Format eines Hashes (auch für das Backend):
//   scrypt$<N>$<r>$<p>$<Salt base64>$<Schlüssel base64>     Schlüssel 32 Byte, Salt mindestens 16 Byte
// Beispiel-Parameter: N=16384, r=8, p=1 (≈ 50 ms auf der Box, Fehlversuche bremst zusätzlich die Sperre).

import type { Role } from './settings.js';

export const PIN_PATTERN = /^[0-9]{4,12}$/;
export const PIN_HASH_PATTERN = /^scrypt\$(\d{4,7})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9+/]{22,}={0,2})\$([A-Za-z0-9+/]{43}=)$/;

export interface StaffMember {
    personId: string;
    name: string;
    role: Role;
    pinHash: string;
}

/** Eine Person mit Zugang zur Box. Aufbau-Zugänge gehören zu einem Event und gelten nur in dessen Zeitfenster. */
export interface AccessEntry extends StaffMember {
    eventId?: string;
    validFrom?: string;
    validUntil?: string;
}

/** config/access/staff.json – schreibt der Agent, liest app */
export interface AccessFile {
    updated: string;
    people: AccessEntry[];
}

export const ACCESS_DIRECTORY = 'access';
export const ACCESS_FILE = 'staff.json';

/** Not-PIN der Box (aus der Provisionierung), falls nie ein Server erreichbar war */
export const EMERGENCY_PERSON: Omit<StaffMember, 'pinHash'> = { personId: 'box-notzugang', name: 'Notzugang', role: 'admin' };
