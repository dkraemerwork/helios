/**
 * Core session lifecycle management.
 *
 * Handles login authentication, session creation with refresh-token rotation,
 * CSRF token generation/validation, and scheduled cleanup of expired sessions
 * and consumed password-reset tokens.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { AuthRepository } from '../persistence/AuthRepository.js';
import { ConfigService } from '../config/ConfigService.js';
import { PasswordHasher } from './PasswordHasher.js';
import { AuthenticationError } from '../shared/errors.js';
import { nowMs } from '../shared/time.js';
import {
  MAX_SESSIONS_PER_USER,
  SESSION_CLEANUP_INTERVAL_MS,
  SESSION_REVOKED_CLEANUP_INTERVAL_MS,
} from '../shared/constants.js';
import type { Session, User } from '../shared/types.js';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly configService: ConfigService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  // ── Login ────────────────────────────────────────────────────────────

  async login(
    email: string,
    password: string,
    userAgent: string | null,
    ip: string | null,
  ): Promise<{ sessionId: string; refreshToken: string; user: User }> {
    const user = await this.authRepo.getUserByEmail(email);
    if (!user) {
      throw new AuthenticationError('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new AuthenticationError('Account is disabled');
    }

    const valid = await this.passwordHasher.verify(password, user.passwordHash);
    if (!valid) {
      throw new AuthenticationError('Invalid email or password');
    }

    const activeSessions = await this.authRepo.getActiveSessionsForUser(user.id);
    if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
      const sessionsToRevoke = activeSessions
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, activeSessions.length - MAX_SESSIONS_PER_USER + 1);

      for (const s of sessionsToRevoke) {
        await this.authRepo.revokeSession(s.id);
      }
    }

    const sessionId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshHash = this.hashToken(refreshToken);
    const now = nowMs();

    const session: Session = {
      id: sessionId,
      userId: user.id,
      refreshHash,
      userAgent,
      ipAddress: ip,
      createdAt: now,
      expiresAt: now + this.configService.sessionTtlMs,
      refreshedAt: now,
      revokedAt: null,
    };

    await this.authRepo.createSession(session);

    return { sessionId, refreshToken, user };
  }

  // ── Refresh ──────────────────────────────────────────────────────────

  async refresh(
    sessionId: string,
    refreshToken: string,
  ): Promise<{ newSessionId: string; newRefreshToken: string; csrfToken: string }> {
    const session = await this.authRepo.getSessionById(sessionId);
    if (!session || session.revokedAt !== null) {
      throw new AuthenticationError('Invalid session');
    }

    const refreshHash = this.hashToken(refreshToken);
    if (!crypto.timingSafeEqual(Buffer.from(session.refreshHash), Buffer.from(refreshHash))) {
      await this.authRepo.revokeSession(sessionId);
      throw new AuthenticationError('Invalid refresh token');
    }

    await this.authRepo.revokeSession(sessionId);

    const newSessionId = crypto.randomUUID();
    const newRefreshToken = crypto.randomBytes(48).toString('base64url');
    const newRefreshHash = this.hashToken(newRefreshToken);
    const now = nowMs();

    const newSession: Session = {
      id: newSessionId,
      userId: session.userId,
      refreshHash: newRefreshHash,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: now,
      expiresAt: now + this.configService.sessionTtlMs,
      refreshedAt: now,
      revokedAt: null,
    };

    await this.authRepo.createSession(newSession);

    const csrfToken = this.generateCsrfToken(newSessionId);

    return { newSessionId, newRefreshToken, csrfToken };
  }

  // ── Logout ───────────────────────────────────────────────────────────

  async logout(sessionId: string): Promise<void> {
    await this.authRepo.revokeSession(sessionId);
  }

  // ── Session Retrieval ────────────────────────────────────────────────

  async getSession(sessionId: string): Promise<{ session: Session; user: User } | null> {
    const session = await this.authRepo.getSessionById(sessionId);
    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (nowMs() > session.expiresAt) return null;

    const user = await this.authRepo.getUserById(session.userId);
    if (!user) return null;
    if (user.status !== 'active') return null;

    return { session, user };
  }

  // ── Revocation ───────────────────────────────────────────────────────

  async revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.authRepo.revokeAllSessionsForUser(userId, exceptSessionId);
  }

  async getActiveSessions(userId: string): Promise<Session[]> {
    return this.authRepo.getActiveSessionsForUser(userId);
  }

  // ── CSRF ─────────────────────────────────────────────────────────────

  generateCsrfToken(sessionId: string): string {
    const hmac = crypto.createHmac('sha256', this.configService.csrfSecret);
    hmac.update(sessionId);
    return hmac.digest('base64url');
  }

  validateCsrfToken(sessionId: string, token: string): boolean {
    const expected = this.generateCsrfToken(sessionId);
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  // ── Scheduled Cleanup ────────────────────────────────────────────────

  @Interval(SESSION_CLEANUP_INTERVAL_MS)
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const deletedSessions = await this.authRepo.deleteExpiredSessions();
      const deletedTokens = await this.authRepo.deleteExpiredResetTokens();
      if (deletedSessions > 0 || deletedTokens > 0) {
        this.logger.log(`Session cleanup: removed ${deletedSessions} expired sessions, ${deletedTokens} expired reset tokens`);
      }
    } catch (err) {
      this.logger.error(`Session cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Interval(SESSION_REVOKED_CLEANUP_INTERVAL_MS)
  async cleanupRevokedSessions(): Promise<void> {
    try {
      const deleted = await this.authRepo.deleteRevokedSessionsOlderThan(SESSION_REVOKED_CLEANUP_INTERVAL_MS);
      if (deleted > 0) {
        this.logger.log(`Revoked session cleanup: removed ${deleted} old revoked sessions`);
      }
    } catch (err) {
      this.logger.error(`Revoked session cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
