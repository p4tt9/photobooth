import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { SelftestRun, SetupOverview, SetupReport } from '@snaphora/contracts';
import type { FastifyRequest } from 'fastify';
import { Access, CurrentSession, SESSION_COOKIE } from '../access/access.guard.js';
import type { Session } from '../access/access.service.js';
import { AuditService } from '../access/audit.service.js';
import { SelftestService, type CompleteInput } from './selftest.service.js';

@Controller('setup')
export class SelftestController {
    constructor(
        private readonly selftest: SelftestService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @Access('setup')
    async overview(): Promise<SetupOverview> {
        await this.selftest.deliverPending();
        return this.selftest.overview();
    }

    /** Automatische Prüfungen; `?photo=1` nimmt zusätzlich ein Testfoto auf */
    @Post('selftest')
    @Access('setup')
    @HttpCode(200)
    async run(@Query('photo') photo: string | undefined, @Req() request: FastifyRequest, @CurrentSession() session: Session): Promise<SelftestRun> {
        const token = request.cookies?.[SESSION_COOKIE];
        // Die bisherige App prüft die Sitzung selbst bei app – deshalb wird das Cookie der Person weitergegeben
        const run = await this.selftest.run(session, token ? `${SESSION_COOKIE}=${token}` : undefined, photo === '1');
        await this.audit.record('Selbsttest', session, { checks: run.checks.map((c) => `${c.id}:${c.level}`) });
        return run;
    }

    /** Body: `{ "runId", "items": ["itemId", …], "note"?, "buzzerKey"? }` */
    @Post('complete')
    @Access('setup')
    @HttpCode(201)
    async complete(@Body() body: CompleteInput | undefined, @CurrentSession() session: Session): Promise<SetupReport> {
        const report = await this.selftest.complete(body ?? {}, session);
        await this.audit.record('Aufbau abgeschlossen', session, { reportId: report.reportId, result: report.result, event: report.eventId });
        return report;
    }
}
