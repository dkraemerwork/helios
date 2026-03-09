/**
 * HTTP controller for authentication endpoints.
 *
 * Handles login, token refresh, logout, user info retrieval, password reset
 * flow, and WebSocket ticket issuance. Uses Fastify request/reply for
 * cookie handling with proper security attributes.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { ConfigService } from '../config/ConfigService.js';
import { AuthRepository } from '../persistence/AuthRepository.js';
import { SessionService } from './SessionService.js';
import { WsTicketService } from './WsTicketService.js';
import { PasswordHasher } from './PasswordHasher.js';
import { PasswordDenylistService } from './PasswordDenylistService.js';
import { AuthMailTemplates } from './AuthMailTemplates.js';
import {
  AuthenticationError,
  ValidationError,
} from '../shared/errors.js';
import {
  SESSION_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  RESET_TOKEN_TTL_MS,
} from '../shared/constants.js';
import { nowMs } from '../shared/time.js';
import type { AuthEvent } from './AuditAuthListener.js';
import type { PasswordResetToken } from '../shared/types.js';

interface CookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  domain?: string;
  maxAge?: number;
}

@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly wsTicketService: WsTicketService,
    private readonly passwordHasher: PasswordHasher,
    private readonly denylistService: PasswordDenylistService,
    private readonly mailTemplates: AuthMailTemplates,
    private readonly configService: ConfigService,
    private readonly authRepo: AuthRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── POST /api/auth/login ─────────────────────────────────────────────

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() req: any,
    @Res({ passthrough: true }) reply: any,
  ): Promise<{ user: { id: string; email: string; displayName: string; roles: string[]; clusterScopes: string[] } }> {
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const ip = extractIp(req);
    const userAgent: string | null = req.headers?.['user-agent'] ?? null;

    try {
      const { sessionId, refreshToken, user } = await this.sessionService.login(
        email,
        password,
        userAgent,
        ip,
      );

      const csrfToken = this.sessionService.generateCsrfToken(sessionId);

      this.setSessionCookie(reply, sessionId);
      this.setRefreshCookie(reply, refreshToken);
      this.setCsrfCookie(reply, csrfToken);

      this.emitAuthEvent({
        type: 'auth.login.success',
        userId: user.id,
        sessionId,
        ip,
        userAgent,
        email,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roles: user.roles,
          clusterScopes: user.clusterScopes,
        },
      };
    } catch (err) {
      if (err instanceof AuthenticationError) {
        this.emitAuthEvent({
          type: 'auth.login.failure',
          userId: null,
          ip,
          userAgent,
          email,
          details: { reason: err.message },
        });
      }
      throw err;
    }
  }

  // ── POST /api/auth/refresh ───────────────────────────────────────────

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) reply: any,
  ): Promise<{ ok: true }> {
    const sessionId: string | undefined = req.cookies?.[SESSION_COOKIE];
    const refreshToken: string | undefined = req.cookies?.[REFRESH_COOKIE];

    if (!sessionId || !refreshToken) {
      throw new AuthenticationError('Missing session or refresh token');
    }

    const result = await this.sessionService.refresh(sessionId, refreshToken);

    this.setSessionCookie(reply, result.newSessionId);
    this.setRefreshCookie(reply, result.newRefreshToken);
    this.setCsrfCookie(reply, result.csrfToken);

    this.emitAuthEvent({
      type: 'auth.session.refresh',
      userId: null,
      sessionId: result.newSessionId,
      ip: extractIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
    });

    return { ok: true };
  }

  // ── POST /api/auth/logout ────────────────────────────────────────────

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) reply: any,
  ): Promise<{ ok: true }> {
    const sessionId: string | undefined = req.cookies?.[SESSION_COOKIE];

    if (sessionId) {
      await this.sessionService.logout(sessionId);

      this.emitAuthEvent({
        type: 'auth.logout',
        userId: req.mcUser?.id ?? null,
        sessionId,
        ip: extractIp(req),
        userAgent: req.headers?.['user-agent'] ?? null,
      });
    }

    this.clearAuthCookies(reply);

    return { ok: true };
  }

  // ── GET /api/auth/me ─────────────────────────────────────────────────

  @Get('me')
  async me(
    @Req() req: any,
  ): Promise<{ user: { id: string; email: string; displayName: string; roles: string[]; clusterScopes: string[] } | null }> {
    const sessionId: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (!sessionId) {
      return { user: null };
    }

    const result = await this.sessionService.getSession(sessionId);
    if (!result) {
      return { user: null };
    }

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        roles: result.user.roles,
        clusterScopes: result.user.clusterScopes,
      },
    };
  }

  // ── POST /api/auth/forgot-password ───────────────────────────────────

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body() body: { email?: string },
    @Req() req: any,
  ): Promise<{ message: string }> {
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      throw new ValidationError('Email is required');
    }

    const uniformResponse = { message: 'If an account with that email exists, a password reset link has been sent.' };

    const user = await this.authRepo.getUserByEmail(email);
    if (!user) {
      return uniformResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = nowMs();

    const resetToken: PasswordResetToken = {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: now + RESET_TOKEN_TTL_MS,
      consumedAt: null,
      createdAt: now,
    };

    await this.authRepo.createPasswordResetToken(resetToken);

    const resetUrl = `${this.configService.publicUrl}/reset-password?token=${rawToken}`;
    const _template = this.mailTemplates.passwordResetEmail(resetUrl, user.displayName);

    this.logger.log(`Password reset token issued for ${email} (template ready for SMTP delivery)`);

    this.emitAuthEvent({
      type: 'auth.password_reset.request',
      userId: user.id,
      targetUserId: user.id,
      ip: extractIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
      email,
    });

    return uniformResponse;
  }

  // ── POST /api/auth/reset-password ────────────────────────────────────

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body() body: { token?: string; password?: string },
    @Req() req: any,
  ): Promise<{ message: string }> {
    const rawToken = body.token;
    const newPassword = body.password;

    if (!rawToken || !newPassword) {
      throw new ValidationError('Token and new password are required');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const resetRecord = await this.authRepo.getPasswordResetTokenByHash(tokenHash);

    if (!resetRecord) {
      throw new AuthenticationError('Invalid or expired reset token');
    }

    if (resetRecord.consumedAt !== null) {
      throw new AuthenticationError('This reset token has already been used');
    }

    if (nowMs() > resetRecord.expiresAt) {
      throw new AuthenticationError('This reset token has expired');
    }

    const user = await this.authRepo.getUserById(resetRecord.userId);
    if (!user) {
      throw new AuthenticationError('Invalid or expired reset token');
    }

    const policyResult = this.denylistService.validatePasswordPolicy(
      newPassword,
      user.email,
      user.displayName,
    );
    if (!policyResult.valid) {
      throw new ValidationError(policyResult.reason!);
    }

    const newHash = await this.passwordHasher.hash(newPassword);

    await this.authRepo.consumePasswordResetToken(resetRecord.id);
    await this.authRepo.updateUser(user.id, {
      passwordHash: newHash,
      updatedAt: nowMs(),
    });
    await this.sessionService.revokeUserSessions(user.id);

    this.emitAuthEvent({
      type: 'auth.password_reset.complete',
      userId: user.id,
      targetUserId: user.id,
      ip: extractIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
      email: user.email,
    });

    return { message: 'Password has been reset. Please log in with your new password.' };
  }

  // ── POST /api/auth/ws-ticket ─────────────────────────────────────────

  @Post('ws-ticket')
  @HttpCode(200)
  async wsTicket(
    @Req() req: any,
  ): Promise<{ ticket: string }> {
    const sessionId: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (!sessionId) {
      throw new AuthenticationError('Authentication required');
    }

    const sessionResult = await this.sessionService.getSession(sessionId);
    if (!sessionResult) {
      throw new AuthenticationError('Invalid or expired session');
    }

    const ticket = this.wsTicketService.issueTicket(sessionId, sessionResult.user.id);

    return { ticket };
  }

  // ── Cookie Helpers ───────────────────────────────────────────────────

  private setSessionCookie(reply: any, sessionId: string): void {
    const opts = this.baseCookieOptions('/');
    opts.httpOnly = true;
    opts.maxAge = Math.floor(this.configService.sessionTtlMs / 1000);
    reply.setCookie(SESSION_COOKIE, sessionId, opts);
  }

  private setRefreshCookie(reply: any, refreshToken: string): void {
    const opts = this.baseCookieOptions('/api/auth/refresh');
    opts.httpOnly = true;
    opts.maxAge = Math.floor(this.configService.refreshTtlMs / 1000);
    reply.setCookie(REFRESH_COOKIE, refreshToken, opts);
  }

  private setCsrfCookie(reply: any, csrfToken: string): void {
    const opts = this.baseCookieOptions('/');
    opts.httpOnly = false;
    opts.maxAge = Math.floor(this.configService.sessionTtlMs / 1000);
    reply.setCookie(CSRF_COOKIE, csrfToken, opts);
  }

  private clearAuthCookies(reply: any): void {
    const clearOpts = (path: string): CookieOptions => ({
      path,
      httpOnly: true,
      secure: this.configService.secureCookies,
      sameSite: 'Lax',
      ...(this.configService.cookieDomain ? { domain: this.configService.cookieDomain } : {}),
      maxAge: 0,
    });

    reply.setCookie(SESSION_COOKIE, '', clearOpts('/'));
    reply.setCookie(REFRESH_COOKIE, '', clearOpts('/api/auth/refresh'));
    reply.setCookie(CSRF_COOKIE, '', { ...clearOpts('/'), httpOnly: false });
  }

  private baseCookieOptions(path: string): CookieOptions {
    return {
      path,
      httpOnly: true,
      secure: this.configService.secureCookies,
      sameSite: 'Lax',
      ...(this.configService.cookieDomain ? { domain: this.configService.cookieDomain } : {}),
    };
  }

  private emitAuthEvent(event: AuthEvent): void {
    this.eventEmitter.emit(event.type, event);
  }
}

function extractIp(req: any): string {
  const forwarded: string | undefined = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
