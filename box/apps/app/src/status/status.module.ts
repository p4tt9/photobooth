import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PrintModule } from '../print/print.module.js';
import { StatusController } from './status.controller.js';
import { StatusService } from './status.service.js';

/** Gesamtzustand der Box */
@Module({
    imports: [ConfigModule, PrintModule],
    controllers: [StatusController],
    providers: [StatusService],
    exports: [StatusService],
})
export class StatusModule {}
