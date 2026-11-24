import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

/** Bilder und Schriften für die Gestaltung (Rahmen, Hintergründe, Logos, Schriften) */
@Module({
    imports: [ConfigModule],
    controllers: [MediaController],
    providers: [MediaService],
})
export class MediaModule {}
