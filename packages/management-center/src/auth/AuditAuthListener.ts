/**
 * Listens to authentication events and writes audit log entries.
 *
 * All auth-related actions (login, logout, password reset, session management)
 * are captured via NestJS EventEmitter and persisted to the audit log for
 * compliance and forensic analysis.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { nowMs } from '../shared/time.js';

export interface AuthEvent {
  type:
    | 'auth.login.success'
    | 'auth.login.failure'
    | 'auth.session.refresh'
    | 'auth.logout'
    | 'auth.password_reset.request'
    | 'auth.password_reset.complete'
    | 'auth.user.created'
    | 'auth.user.updated'
    | 'auth.session.revoked';
  userId: string | null;
  sessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
  email?: string;
  targetUserId?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditAuthListener {
  private readonly logger = new Logger(AuditAuthListener.name);

  constructor(private readonly auditRepo: AuditRepository) {}

  @OnEvent('auth.login.success')
  async onLoginSuccess(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.login.success', 'session', event.sessionId ?? null);
  }

  @OnEvent('auth.login.failure')
  async onLoginFailure(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.login.failure', null, null);
  }

  @OnEvent('auth.session.refresh')
  async onSessionRefresh(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.session.refresh', 'session', event.sessionId ?? null);
  }

  @OnEvent('auth.logout')
  async onLogout(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.logout', 'session', event.sessionId ?? null);
  }

  @OnEvent('auth.password_reset.request')
  async onPasswordResetRequest(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.password_reset.request', 'user', event.targetUserId ?? event.userId);
  }

  @OnEvent('auth.password_reset.complete')
  async onPasswordResetComplete(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.password_reset.complete', 'user', event.targetUserId ?? event.userId);
  }

  @OnEvent('auth.user.created')
  async onUserCreated(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.user.created', 'user', event.targetUserId ?? event.userId);
  }

  @OnEvent('auth.user.updated')
  async onUserUpdated(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.user.updated', 'user', event.targetUserId ?? event.userId);
  }

  @OnEvent('auth.session.revoked')
  async onSessionRevoked(event: AuthEvent): Promise<void> {
    await this.writeEntry(event, 'auth.session.revoked', 'session', event.sessionId ?? null);
  }

  private async writeEntry(
    event: AuthEvent,
    actionType: string,
    targetType: string | null,
    targetId: string | null,
  ): Promise<void> {
    try {
      await this.auditRepo.insertAuditEntry({
        actorUserId: event.userId,
        actionType,
        clusterId: null,
        targetType,
        targetId,
        requestId: null,
        detailsJson: JSON.stringify({
          ip: event.ip ?? null,
          userAgent: event.userAgent ?? null,
          email: event.email ?? null,
          ...event.details,
        }),
        createdAt: nowMs(),
      });
    } catch (err) {
      this.logger.error(`Failed to write audit entry for ${actionType}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
