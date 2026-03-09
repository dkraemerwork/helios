import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const CSRF_COOKIE_NAME = 'mc_csrf';

/**
 * Reads the CSRF token from the mc_csrf cookie.
 * SSR-safe: returns null on the server since cookies are not accessible.
 */
@Injectable({ providedIn: 'root' })
export class CsrfService {
  private readonly platformId = inject(PLATFORM_ID);

  getCsrfToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    return this.parseCookie(CSRF_COOKIE_NAME);
  }

  private parseCookie(name: string): string | null {
    const cookies = document.cookie;
    if (!cookies) return null;

    const pairs = cookies.split(';');
    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;

      const key = pair.slice(0, eqIndex).trim();
      if (key === name) {
        return decodeURIComponent(pair.slice(eqIndex + 1).trim());
      }
    }

    return null;
  }
}
