// Looks (Bearbeitungs-Presets), die der Render-Dienst kennt. Beim Speichern einer Look-Einstellung prüft app,
// ob es den Look gibt – sonst würde jedes Foto mit einem Fehler im Render-Dienst enden.

import { Inject, Injectable } from '@nestjs/common';
import type { LookInfo } from '@snaphora/contracts';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';

export class LooksUnavailableError extends Error {}

@Injectable()
export class LooksService {
    constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

    async list(): Promise<LookInfo[]> {
        if (!this.environment.renderUrl) {
            throw new LooksUnavailableError('Bildpipeline nicht eingerichtet');
        }
        try {
            const response = await fetch(`${this.environment.renderUrl}/v1/looks`, { signal: AbortSignal.timeout(3000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const looks = (await response.json()) as unknown;
            return Array.isArray(looks)
                ? looks
                      .filter((look): look is LookInfo => typeof look?.id === 'string' && typeof look?.name === 'string')
                      .map((look) => ({ id: look.id, name: look.name.slice(0, 80) }))
                : [];
        } catch (error) {
            throw new LooksUnavailableError(`Bildpipeline nicht erreichbar (${(error as Error).message})`);
        }
    }
}
