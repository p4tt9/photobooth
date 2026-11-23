// PIN-Hashes (scrypt, Format in @snaphora/contracts/access.ts). Nur Node-Bordmittel.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PIN_HASH_PATTERN } from '@snaphora/contracts';

const KEY_LENGTH = 32;

function scrypt(pin: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        // maxmem großzügig, aber begrenzt: Parameter vom Server sind ohnehin geprüft (höchstens N=131072, r=16)
        scryptCallback(pin, salt, KEY_LENGTH, { ...options, maxmem: 512 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
    });
}

export async function hashPin(pin: string, cost = { N: 16384, r: 8, p: 1 }): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(pin, salt, cost);
    return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Vergleich in konstanter Zeit; ein kaputter Hash passt nie */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
    const match = PIN_HASH_PATTERN.exec(hash);
    if (!match) {
        return false;
    }
    const [, n, r, p, salt, expected] = match;
    try {
        const key = await scrypt(pin, Buffer.from(salt ?? '', 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
        const wanted = Buffer.from(expected ?? '', 'base64');
        return wanted.length === key.length && timingSafeEqual(key, wanted);
    } catch {
        return false;
    }
}
