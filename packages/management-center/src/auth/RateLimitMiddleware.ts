/**
 * In-memory sliding-window rate limiting middleware.
 *
 * Maintains per-IP and per-email counters using a sliding window algorithm.
 * Auth endpoints (login, forgot-password, reset-password) use
 * configurable authPerMinute limits. API endpoints use apiPerMinute.
 * Returns 429 Too Many Requests when limits are exceeded.
 */

import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '../config/ConfigService.js';
import { RateLimitError } from '../shared/errors.js';

const WINDOW_MS = 60_000;

interface SlidingWindow {
  timestamps: number[];
}

const AUTH_PATHS = new Set(['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password']);

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly ipWindows = new Map<string, SlidingWindow>();
  private readonly emailWindows = new Map<string, SlidingWindow>();
  private readonly apiWindows = new Map<string, SlidingWindow>();

  private readonly authLimit: number;
  private readonly apiLimit: number;

  constructor(configService: ConfigService) {
    this.authLimit = configService.rateLimitAuthPerMinute;
    this.apiLimit = configService.rateLimitApiPerMinute;

    setInterval(() => this.gc(), WINDOW_MS * 2);
  }

  use(req: any, _res: any, next: () => void): void {
    const ip = extractIp(req);
    const path: string = req.url?.split('?')[0] ?? '';
    const now = Date.now();

    if (AUTH_PATHS.has(path)) {
      if (this.isLimited(this.ipWindows, `auth:ip:${ip}`, now, this.authLimit)) {
        this.logger.warn(`Auth rate limit exceeded for IP ${ip}`);
        throw new RateLimitError('Too many authentication attempts. Please try again later.');
      }

      const email: string | undefined = req.body?.email;
      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        if (this.isLimited(this.emailWindows, `auth:email:${normalizedEmail}`, now, this.authLimit)) {
          this.logger.warn(`Auth rate limit exceeded for email ${normalizedEmail}`);
          throw new RateLimitError('Too many authentication attempts for this account. Please try again later.');
        }
      }
    } else {
      if (this.isLimited(this.apiWindows, `api:ip:${ip}`, now, this.apiLimit)) {
        this.logger.warn(`API rate limit exceeded for IP ${ip}`);
        throw new RateLimitError('Too many requests. Please slow down.');
      }
    }

    next();
  }

  private isLimited(
    store: Map<string, SlidingWindow>,
    key: string,
    now: number,
    limit: number,
  ): boolean {
    let window = store.get(key);
    if (!window) {
      window = { timestamps: [] };
      store.set(key, window);
    }

    const cutoff = now - WINDOW_MS;
    window.timestamps = window.timestamps.filter((ts) => ts > cutoff);
    window.timestamps.push(now);

    return window.timestamps.length > limit;
  }

  private gc(): void {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    for (const store of [this.ipWindows, this.emailWindows, this.apiWindows]) {
      for (const [key, window] of store) {
        window.timestamps = window.timestamps.filter((ts) => ts > cutoff);
        if (window.timestamps.length === 0) {
          store.delete(key);
        }
      }
    }
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
