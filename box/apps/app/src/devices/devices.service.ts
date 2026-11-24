// Geräte (Modul devices): Ringlicht prüfen.
//
// Das Ringlicht schaltet im Betrieb weiterhin der Kiosk-Browser direkt beim Countdown (Konzept 4.10, E16).
// Der Test hier ruft dieselbe Adresse von der Box aus auf – so sieht man beim Aufbau, ob der ESP erreichbar ist.

import { Injectable } from '@nestjs/common';
import type { RinglightTest } from '@snaphora/contracts';
import { SettingsService } from '../config/settings.service.js';

export type { RinglightTest } from '@snaphora/contracts';

@Injectable()
export class DevicesService {
    constructor(
        private readonly settings: SettingsService,
    ) {}

    async testRinglight(): Promise<RinglightTest> {
        const values = await this.settings.values();
        const server = values['get_request.server']?.value;
        if (typeof server !== 'string' || server === '') {
            return { ok: false, url: null, error: 'Keine Adresse für das Ringlicht eingestellt' };
        }
        // Gleicher Aufruf wie beim Countdown eines Einzelfotos (assets/js/core.js); Pfad ist im Image fest
        const url = `${server}/CNTDWNPHOTO`;
        const started = Date.now();
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
            await response.body?.cancel();
            return { ok: response.ok, url, status: response.status, milliseconds: Date.now() - started, ...(response.ok ? {} : { error: `Ringlicht antwortet mit HTTP ${response.status}` }) };
        } catch (error) {
            const reason = (error as Error).name === 'TimeoutError' ? 'keine Antwort innerhalb von 3 s' : ((error as Error & { cause?: { code?: string } }).cause?.code ?? (error as Error).message);
            return { ok: false, url, milliseconds: Date.now() - started, error: `Ringlicht nicht erreichbar (${reason})` };
        }
    }
}
