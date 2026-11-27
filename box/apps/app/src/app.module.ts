import { Module, type DynamicModule } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { ConfigModule } from './config/config.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { AgentLinkModule } from './agent-link/agent-link.module.js';
import { MediaModule } from './media/media.module.js';
import { SelftestModule } from './selftest/selftest.module.js';
import { APP_ENVIRONMENT, type AppEnvironment } from './environment.js';
import { PrintModule } from './print/print.module.js';
import { StatusModule } from './status/status.module.js';

/**
 * Die Snaphora-Box-Anwendung. Neue Funktionen kommen als eigenes Modul hierher (planning/ARCHITEKTUR.md),
 * nicht als neuer Dienst.
 */
@Module({})
export class AppModule {
    static register(environment: AppEnvironment): DynamicModule {
        const environmentModule: DynamicModule = {
            module: class EnvironmentModule {},
            global: true,
            providers: [{ provide: APP_ENVIRONMENT, useValue: environment }],
            exports: [APP_ENVIRONMENT],
        };
        return {
            module: AppModule,
            imports: [environmentModule, AccessModule, AgentLinkModule, ConfigModule, PrintModule, StatusModule, MediaModule, DevicesModule, SelftestModule],
        };
    }
}
