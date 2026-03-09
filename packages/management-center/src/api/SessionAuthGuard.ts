/**
 * Global authentication guard that validates session cookies.
 *
 * Reads the mc_session cookie from each request, validates it through
 * SessionService, and attaches the authenticated user and session to
 * the request object. Skips authentication for public endpoints such
 * as login, health checks, and password reset flows.
 */

import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { SessionService } from '../auth/SessionService.js';
import { AuthenticationError } from '../shared/errors.js';
import { SESSION_COOKIE } from '../shared/constants.js';

/** Routes that do not require authentication. */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/me',
  '/health',
  '/health/ready',
  '/health/live',
  '/health/startup',
]);

/** Route prefixes that do not require authentication. */
const PUBLIC_PREFIXES: readonly string[] = ['/health'];

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url: string = request.url ?? request.raw?.url ?? '';

    // Strip query string for route matching
    const path = url.split('?')[0]!;

    if (this.isPublicRoute(path)) {
      return true;
    }

    const sessionId: string | undefined = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) {
      throw new AuthenticationError('Authentication required');
    }

    const result = await this.sessionService.getSession(sessionId);
    if (!result) {
      throw new AuthenticationError('Invalid or expired session');
    }

    // Attach user and session to request for downstream guards and handlers
    request.mcUser = result.user;
    request.mcSession = result.session;

    return true;
  }

  private isPublicRoute(path: string): boolean {
    if (PUBLIC_ROUTES.has(path)) {
      return true;
    }

    for (const prefix of PUBLIC_PREFIXES) {
      if (path.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }
}
