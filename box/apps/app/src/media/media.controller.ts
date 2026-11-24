import { BadRequestException, Controller, Delete, Get, HttpCode, Param, PayloadTooLargeException, Post, Req } from '@nestjs/common';
import { isMediaKind, MEDIA_KINDS, type MediaItem, type MediaKind, type MediaLibrary } from '@snaphora/contracts';
import type { FastifyRequest } from 'fastify';
import { Access, CurrentSession } from '../access/access.guard.js';
import type { Session } from '../access/access.service.js';
import { AuditService } from '../access/audit.service.js';
import { RejectedFileError } from './file-check.js';
import { MediaService } from './media.service.js';

function kindOf(value: string): MediaKind {
    if (!isMediaKind(value)) throw new BadRequestException({ error: `Unbekannte Art: ${value}` });
    return value;
}

@Controller('media')
export class MediaController {
    constructor(
        private readonly media: MediaService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @Access('setup')
    list(): Promise<MediaLibrary> {
        return this.media.list();
    }

    /** Eine Datei als multipart/form-data (Feld `file`) */
    @Post(':kind')
    @HttpCode(201)
    async upload(@Param('kind') kindParam: string, @Req() request: FastifyRequest, @CurrentSession() session: Session): Promise<MediaItem> {
        const kind = kindOf(kindParam);
        if (!request.isMultipart()) throw new BadRequestException({ error: 'Erwartet wird ein Datei-Upload (multipart/form-data)' });
        const file = await request.file({ limits: { fileSize: MEDIA_KINDS[kind].maxBytes, files: 1, fields: 0 } });
        if (!file) throw new BadRequestException({ error: 'Keine Datei erhalten' });
        let data: Buffer;
        try {
            data = await file.toBuffer();
        } catch {
            throw new PayloadTooLargeException({ error: `Die Datei ist größer als ${Math.round(MEDIA_KINDS[kind].maxBytes / 1024 / 1024)} MB` });
        }
        try {
            const item = await this.media.upload(kind, file.filename, data);
            await this.audit.record('Datei hochgeladen', session, { kind, name: item.name, size: item.size });
            return item;
        } catch (error) {
            if (error instanceof RejectedFileError) throw new BadRequestException({ error: error.message });
            throw error;
        }
    }

    @Delete(':kind/:name')
    @HttpCode(204)
    async remove(@Param('kind') kindParam: string, @Param('name') name: string, @CurrentSession() session: Session): Promise<void> {
        const kind = kindOf(kindParam);
        await this.media.remove(kind, name);
        await this.audit.record('Datei gelöscht', session, { kind, name });
    }
}
