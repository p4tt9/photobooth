import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PrintController } from './print.controller.js';
import { PrintService } from './print.service.js';

/** Druckkontingent; ab Paket 9 auch die Druckaufträge selbst */
@Module({
    imports: [ConfigModule],
    controllers: [PrintController],
    providers: [PrintService],
    exports: [PrintService],
})
export class PrintModule {}
