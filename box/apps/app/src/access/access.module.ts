import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessController } from './access.controller.js';
import { AccessGuard } from './access.guard.js';
import { AccessService } from './access.service.js';
import { AuditService } from './audit.service.js';

/** Anmeldung, Rollen, Zugriffsprotokoll. Der Guard gilt global für jede Schnittstelle. */
@Global()
@Module({
    controllers: [AccessController],
    providers: [AccessService, AuditService, { provide: APP_GUARD, useClass: AccessGuard }],
    exports: [AccessService, AuditService],
})
export class AccessModule {}
