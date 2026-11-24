import { Controller, Get, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { Access, CurrentSession } from '../access/access.guard.js';
import type { Session } from '../access/access.service.js';
import { AuditService } from '../access/audit.service.js';
import type { LookInfo } from '@snaphora/contracts';
import { LooksService, LooksUnavailableError } from '../config/looks.service.js';
import { DevicesService, type RinglightTest } from './devices.service.js';

@Controller()
export class DevicesController {
    constructor(
        private readonly devices: DevicesService,
        private readonly looks: LooksService,
        private readonly audit: AuditService,
    ) {}

    /** Ringlicht einmal auslösen (Aufbau prüft damit die Verbindung zum ESP) */
    @Post('devices/ringlight/test')
    @Access('setup')
    @HttpCode(200)
    async testRinglight(@CurrentSession() session: Session): Promise<RinglightTest> {
        const result = await this.devices.testRinglight();
        await this.audit.record('Ringlicht getestet', session, { ok: result.ok, ...(result.error ? { error: result.error } : {}) });
        return result;
    }

    @Get('looks')
    @Access('setup')
    async listLooks(): Promise<LookInfo[]> {
        try {
            return await this.looks.list();
        } catch (error) {
            if (error instanceof LooksUnavailableError) throw new ServiceUnavailableException({ error: error.message });
            throw error;
        }
    }
}
