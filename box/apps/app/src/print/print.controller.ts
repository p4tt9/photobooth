import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { InvalidSettingError } from '@snaphora/contracts';
import { Access, CurrentSession } from '../access/access.guard.js';
import type { Session } from '../access/access.service.js';
import { AuditService } from '../access/audit.service.js';
import { PrintService } from './print.service.js';

@Controller('print')
export class PrintController {
    constructor(
        private readonly print: PrintService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @Access('setup')
    status() {
        return this.print.status();
    }

    /** Body: `{ "add": 50 }` */
    @Post('quota')
    @Access('setup')
    @HttpCode(200)
    async increase(@Body() body: { add?: unknown } | undefined, @CurrentSession() session: Session) {
        const add = body?.add;
        if (typeof add !== 'number' || !Number.isInteger(add) || add < 1 || add > 1000) {
            throw new BadRequestException({ error: 'Erhöhung muss eine ganze Zahl von 1 bis 1000 sein' });
        }
        try {
            const result = await this.print.increaseQuota(add);
            await this.audit.record('Druckkontingent erhöht', session, { add, limit: result.status.limit, printed: result.status.printed });
            return result.status;
        } catch (error) {
            if (error instanceof InvalidSettingError) {
                throw new BadRequestException({ error: error.message });
            }
            throw error;
        }
    }
}
