import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { PrintModule } from '../print/print.module.js';
import { StatusModule } from '../status/status.module.js';
import { SelftestController } from './selftest.controller.js';
import { SelftestService } from './selftest.service.js';

/** Selbsttest und Aufbau-Checkliste (Konzept 4.9) */
@Module({
    imports: [ConfigModule, PrintModule, StatusModule, DevicesModule],
    controllers: [SelftestController],
    providers: [SelftestService],
})
export class SelftestModule {}
