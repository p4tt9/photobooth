import { Controller, Get } from '@nestjs/common';
import { LogsService, type LogLine } from './logs.service.js';

@Controller('maintenance')
export class MaintenanceController {
    constructor(private readonly logs: LogsService) {}

    /** Nur Admins (Standard des Guards): Protokolle können Dateinamen und Abläufe der Gäste enthalten */
    @Get('logs')
    async appLog(): Promise<{ available: boolean; lines: LogLine[] }> {
        const lines = await this.logs.tail();
        return { available: lines !== null, lines: lines ?? [] };
    }
}
