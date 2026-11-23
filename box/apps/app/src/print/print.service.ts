// Druckkontingent (Modul print).
//
// Bis Paket 9 druckt noch photobooth (PHP) und führt den Zähler (data/print.count, data/printed.csv).
// app liest ihn nur. Gesperrt ist der Druck, sobald gezählte Drucke ≥ Kontingent – das leitet PHP aus denselben
// Werten ab. Mehr Drucke erlauben heißt also nur: Kontingent erhöhen (Einstellung print.limit).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { findSetting, validateSetting, type PrintStatus, type SettingChange } from '@snaphora/contracts';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { SettingsService } from '../config/settings.service.js';

@Injectable()
export class PrintService {
    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly settings: SettingsService,
    ) {}

    /** Zählerstand; `null`, wenn er nicht lesbar ist (dann lieber nichts behaupten) */
    async printed(): Promise<number | null> {
        try {
            const counter = (await readFile(path.join(this.environment.dataDir, 'print.count'), 'utf8')).trim();
            if (/^\d+$/.test(counter)) {
                return Number(counter);
            }
        } catch {
            // kein Zähler → aus dem Protokoll
        }
        try {
            const log = await readFile(path.join(this.environment.dataDir, 'printed.csv'), 'utf8');
            return log.split('\n').filter((line) => line.trim() !== '').length;
        } catch {
            return 0;
        }
    }

    async status(): Promise<PrintStatus> {
        const limit = Number(await this.settings.value(this.limitSetting()));
        const printed = await this.printed();
        return {
            limit,
            printed,
            remaining: limit > 0 && printed !== null ? Math.max(0, limit - printed) : null,
            locked: limit > 0 && printed !== null && printed >= limit,
        };
    }

    /** Kontingent um `add` erhöhen; gilt während eines Events nur für dieses Event */
    async increaseQuota(add: number): Promise<{ status: PrintStatus; changes: SettingChange[] }> {
        const setting = this.limitSetting();
        const current = Number(await this.settings.value(setting));
        // Kontingent 0 heißt „unbegrenzt“; Erhöhen beginnt dann bei den bereits gedruckten
        const base = current > 0 ? current : ((await this.printed()) ?? 0);
        const changes = await this.settings.update(new Map([[setting, validateSetting(setting, base + add)]]));
        return { status: await this.status(), changes };
    }

    private limitSetting() {
        const setting = findSetting('print.limit');
        if (!setting) {
            throw new Error('print.limit fehlt im Katalog');
        }
        return setting;
    }
}
