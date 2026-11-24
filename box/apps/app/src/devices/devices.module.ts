import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

/** Geräte der Box: Ringlicht, später Buzzer, Fernauslöser, USB-Sync (Paket 9) */
@Module({
    imports: [ConfigModule],
    controllers: [DevicesController],
    providers: [DevicesService],
})
export class DevicesModule {}
