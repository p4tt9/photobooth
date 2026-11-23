import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Einstellungs-Ebenen lesen, Katalog, Speichern mit Aufteilung auf box.json / local-event.json */
@Module({
    controllers: [SettingsController],
    providers: [SettingsService],
    exports: [SettingsService],
})
export class ConfigModule {}
