/**
 * NestJS guard that validates CSRF tokens on state-changing requests.
 *
 * Skips validation for safe HTTP methods (GET, HEAD, OPTIONS). For all
 * other methods, extracts the token from the X-CSRF-Token header and
 * validates it against the session-bound HMAC.
 */

import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { CSRF_HEADER, SESSION_COOKIE } from '../shared/constants.js';
import { AuthorizationError } from '../shared/errors.js';
import { SessionService } from './SessionService.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  constructor(private readonly sessionService: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method?.toUpperCase() ?? '';

    if (SAFE_METHODS.has(method)) {
      return true;
    }

    const sessionId: string | undefined = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) {
      throw new AuthorizationError('Missing session for CSRF validation');
    }

    const csrfToken: string | undefined = request.headers?.[CSRF_HEADER];
    if (!csrfToken) {
      throw new AuthorizationError('Missing CSRF token');
    }

    const valid = this.sessionService.validateCsrfToken(sessionId, csrfToken);
    if (!valid) {
      this.logger.warn(`Invalid CSRF token for session ${sessionId.slice(0, 8)}...`);
      throw new AuthorizationError('Invalid CSRF token');
    }

    return true;
  }
}
