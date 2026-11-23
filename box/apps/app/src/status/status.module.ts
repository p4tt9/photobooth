import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PrintModule } from '../print/print.module.js';
import { StatusController } from './status.controller.js';

/** Gesamtzustand der Box */
@Module({
    imports: [ConfigModule, PrintModule],
    controllers: [StatusController],
})
export class StatusModule {}
