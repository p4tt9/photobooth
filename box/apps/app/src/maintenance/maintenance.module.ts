import { Module } from '@nestjs/common';
import { LogsService } from './logs.service.js';
import { MaintenanceController } from './maintenance.controller.js';

/** Wartung: Protokolle (Abgleich mit dem Server liegt beim Status-Modul) */
@Module({
    controllers: [MaintenanceController],
    providers: [LogsService],
})
export class MaintenanceModule {}
