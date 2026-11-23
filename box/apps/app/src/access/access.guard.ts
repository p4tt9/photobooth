// Zugriffsschutz für jede Schnittstelle von app – standardmäßig gesperrt.
//
// Ohne Angabe verlangt eine Schnittstelle die Rolle Admin. Erleichterungen stehen sichtbar am Controller:
//   @Access('public')  ohne Anmeldung (Gesundheit, Anmeldung selbst)
//   @Access('setup')   Aufbau-Personal und Admin
// Schreibende Anfragen brauchen zusätzlich den Kopf `X-Snaphora-Request: 1`. Den kann eine fremde Seite nicht
// setzen, ohne dass der Browser vorher nachfragt (CORS-Preflight, das app nie erlaubt) – Schutz gegen CSRF,
// zusätzlich zum Cookie mit SameSite=Strict.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleAllows, type Role } from '@snaphora/contracts';
import type { FastifyRequest } from 'fastify';
import { AccessService, type Session } from './access.service.js';

export const SESSION_COOKIE = 'snaphora_session';
export const REQUEST_HEADER = 'x-snaphora-request';

type AccessLevel = 'public' | Role;
const ACCESS_KEY = 'snaphora:access';

export const Access = (level: AccessLevel) => SetMetadata(ACCESS_KEY, level);

type RequestWithSession = FastifyRequest & { session?: Session };

/** Die angemeldete Person im Controller (wie @AuthenticationPrincipal in Spring) */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): Session | undefined => context.switchToHttp().getRequest<RequestWithSession>().session);

@Injectable()
export class AccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly access: AccessService,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        const level = this.reflector.getAllAndOverride<AccessLevel | undefined>(ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? 'admin';
        const request = context.switchToHttp().getRequest<RequestWithSession>();

        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers[REQUEST_HEADER] !== '1') {
            throw new ForbiddenException('Anfrage ohne X-Snaphora-Request abgelehnt');
        }
        const session = this.access.session(request.cookies?.[SESSION_COOKIE]);
        if (session) {
            request.session = session;
        }
        if (level === 'public') {
            return true;
        }
        if (!session) {
            throw new UnauthorizedException('Bitte mit PIN anmelden');
        }
        if (!roleAllows(session.role, level)) {
            throw new ForbiddenException('Dafür reichen die Rechte nicht');
        }
        return true;
    }
}
