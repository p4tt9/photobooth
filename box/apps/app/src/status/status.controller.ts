// Gesamtzustand der Box (Modul status): Grundlage für Übersicht und Selbsttest.

import { BadGatewayException, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { AgentStatus, BoxStatus } from '@snaphora/contracts';
import { Access } from '../access/access.guard.js';
import { SettingsService } from '../config/settings.service.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../environment.js';
import { AgentLink } from '../agent-link/agent-link.service.js';
import { PrintService } from '../print/print.service.js';
import { StatusService } from './status.service.js';

@Controller()
export class StatusController {
    private readonly startedAt = Date.now();

    constructor(
        @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
        private readonly settings: SettingsService,
        private readonly print: PrintService,
        private readonly agentLink: AgentLink,
        private readonly state: StatusService,
    ) {}

    @Get('health')
    @Access('public')
    health() {
        return { status: 'ok', version: this.environment.appVersion };
    }

    @Get('status')
    @Access('setup')
    async status(): Promise<BoxStatus> {
        const [event, print, photos, disk, agent] = await Promise.all([this.settings.activeEvent(), this.print.status(), this.state.photoCount(), this.state.disk(), this.agentLink.status()]);
        return { version: this.environment.appVersion, uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), event, print, photos, disk, agent };
    }

    /** Sofort mit dem Server abgleichen (sonst jede Minute) */
    @Post('maintenance/sync')
    @Access('setup')
    @HttpCode(200)
    async syncNow(): Promise<AgentStatus> {
        const agent = await this.agentLink.syncNow();
        if (!agent.reachable) {
            throw new BadGatewayException({ error: `Agent nicht erreichbar: ${agent.reason}` });
        }
        return agent;
    }
}
