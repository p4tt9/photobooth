import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Patch, ServiceUnavailableException } from '@nestjs/common';
import { describeSettings, InvalidSettingError, requiredRole, roleAllows, SETTING_SECTIONS, validateSettingValues } from '@snaphora/contracts';
import { Access, CurrentSession } from '../access/access.guard.js';
import type { Session } from '../access/access.service.js';
import { AuditService } from '../access/audit.service.js';
import { LooksService, LooksUnavailableError } from './looks.service.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
    constructor(
        private readonly settings: SettingsService,
        private readonly looks: LooksService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @Access('setup')
    async list() {
        return { sections: SETTING_SECTIONS, definitions: describeSettings(), values: await this.settings.values(), event: await this.settings.activeEvent() };
    }

    /** Body: `{ "values": { "print.limit": 8 } }` – alles oder nichts: ein ungültiger Wert lehnt die ganze Anfrage ab */
    @Patch()
    @Access('setup')
    async update(@Body() body: { values?: unknown } | undefined, @CurrentSession() session: Session) {
        let values;
        try {
            values = validateSettingValues(body?.values);
        } catch (error) {
            if (error instanceof InvalidSettingError) {
                throw new BadRequestException({ error: error.message, path: error.path });
            }
            throw error;
        }
        for (const setting of values.keys()) {
            if (!roleAllows(session.role, requiredRole(setting))) {
                throw new ForbiddenException({ error: `${setting.label}: nur für Admins`, path: setting.path });
            }
        }
        for (const [setting, value] of values) {
            if (setting.type === 'look' && value !== '') {
                let known: string[];
                try {
                    known = (await this.looks.list()).map((look) => look.id);
                } catch (error) {
                    if (error instanceof LooksUnavailableError) {
                        throw new ServiceUnavailableException({ error: `${error.message} – Look kann gerade nicht geprüft werden`, path: setting.path });
                    }
                    throw error;
                }
                if (!known.includes(String(value))) {
                    throw new BadRequestException({ error: `${setting.label}: Look „${String(value)}“ gibt es auf der Box nicht`, path: setting.path });
                }
            }
        }
        const changes = await this.settings.update(values);
        if (changes.length > 0) {
            await this.audit.record('Einstellungen geändert', session, { changes });
        }
        return { changes, values: await this.settings.values() };
    }

    @Delete('event-changes')
    @HttpCode(200)
    async resetEventChanges(@CurrentSession() session: Session) {
        const reset = await this.settings.resetEventChanges();
        if (reset) {
            await this.audit.record('Änderungen am Gerät für das Event verworfen', session, { event: (await this.settings.activeEvent())?.eventId });
        }
        return { reset, values: await this.settings.values() };
    }
}
