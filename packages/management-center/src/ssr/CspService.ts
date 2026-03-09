/**
 * Content Security Policy and security header management for SSR responses.
 *
 * Generates per-request cryptographic nonces and assembles strict CSP directives
 * that allow Angular's inline styles while preventing XSS via script injection.
 * Also provides a complete set of HTTP security headers (X-Content-Type-Options,
 * X-Frame-Options, Referrer-Policy, Permissions-Policy, etc.).
 */

import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '../config/ConfigService.js';

@Injectable()
export class CspService {
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProduction = !this.configService.publicUrl.startsWith('http://localhost');
  }

  /** Generates a cryptographically random nonce for CSP script-src. */
  generateNonce(): string {
    return crypto.randomBytes(16).toString('base64');
  }

  /** Builds a complete Content-Security-Policy header value with the given nonce. */
  buildCspHeader(nonce: string): string {
    const directives: string[] = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ];

    if (this.isProduction) {
      directives.push('upgrade-insecure-requests');
    }

    return directives.join('; ');
  }

  /** Returns a map of standard security headers to apply to every SSR response. */
  buildSecurityHeaders(nonce: string): Record<string, string> {
    return {
      'Content-Security-Policy': this.buildCspHeader(nonce),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '0',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': [
        'accelerometer=()',
        'camera=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'payment=()',
        'usb=()',
      ].join(', '),
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
  }
}
