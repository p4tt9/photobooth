import { Global, Module } from '@nestjs/common';
import { AgentLink } from './agent-link.service.js';

/** Verbindung zum Agent, für alle Module */
@Global()
@Module({ providers: [AgentLink], exports: [AgentLink] })
export class AgentLinkModule {}
