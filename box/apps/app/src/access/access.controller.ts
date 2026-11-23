import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Access, CurrentSession, SESSION_COOKIE } from './access.guard.js';
import { AccessService, SESSION_MAX_MS, type Session } from './access.service.js';
import { AuditService } from './audit.service.js';

const publicSession = (session: Session) => ({ personId: session.personId, name: session.name, role: session.role, kiosk: session.kiosk });

@Controller('access')
export class AccessController {
    constructor(
        private readonly access: AccessService,
        private readonly audit: AuditService,
    ) {}

    @Post('login')
    @Access('public')
    @HttpCode(200)
    async login(@Body() body: { pin?: unknown; kiosk?: unknown } | undefined, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
        const result = await this.access.login(body?.pin, body?.kiosk === true);
        if (!result.ok) {
            if (result.reason === 'locked') {
                reply.header('Retry-After', String(result.retryAfterSeconds ?? 60));
                throw new HttpException({ error: 'Zu viele Fehlversuche – Anmeldung gesperrt', retryAfterSeconds: result.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
            }
            throw new UnauthorizedException('PIN falsch');
        }
        reply.setCookie(SESSION_COOKIE, result.token, {
            httpOnly: true,
            sameSite: 'strict',
            // Kiosk und lokales Netz laufen über HTTP (E16); über HTTPS (z. B. WireGuard + Proxy) nur verschlüsselt
            secure: request.protocol === 'https',
            path: '/',
            maxAge: SESSION_MAX_MS / 1000,
        });
        return publicSession(result.session);
    }

    @Post('logout')
    @Access('public')
    @HttpCode(204)
    async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
        await this.access.logout(request.cookies?.[SESSION_COOKIE]);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }

    /** Wer ist angemeldet? Fragt auch die alte PHP-Verwaltung ab, solange es sie gibt. */
    @Get('session')
    @Access('setup')
    session(@CurrentSession() session: Session) {
        return publicSession(session);
    }

    @Get('log')
    async log() {
        return { lock: await this.access.lockStatus(), sessions: this.access.activeSessions().map(publicSession), entries: await this.audit.recent(200) };
    }
}
