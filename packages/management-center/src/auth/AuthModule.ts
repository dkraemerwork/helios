/**
 * NestJS module aggregating all authentication and authorization services.
 *
 * Provides session management, CSRF protection, RBAC guards, password
 * hashing, breach-checking, rate limiting, WebSocket ticket issuance,
 * audit event listeners, and the HTTP auth controller.
 */

import { forwardRef, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { PasswordHasher } from './PasswordHasher.js';
import { PasswordDenylistService } from './PasswordDenylistService.js';
import { SessionService } from './SessionService.js';
import { WsTicketService } from './WsTicketService.js';
import { CsrfGuard } from './CsrfGuard.js';
import { RbacGuard } from './RbacGuard.js';
import { AuthController } from './AuthController.js';
import { AuthMailTemplates } from './AuthMailTemplates.js';
import { AuditAuthListener } from './AuditAuthListener.js';
import { RateLimitMiddleware } from './RateLimitMiddleware.js';

@Module({
  imports: [
    forwardRef(() => PersistenceModule),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    PasswordDenylistService,
    SessionService,
    WsTicketService,
    CsrfGuard,
    RbacGuard,
    AuthMailTemplates,
    AuditAuthListener,
    RateLimitMiddleware,
  ],
  exports: [
    SessionService,
    WsTicketService,
    CsrfGuard,
    RbacGuard,
    PasswordHasher,
    PasswordDenylistService,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
