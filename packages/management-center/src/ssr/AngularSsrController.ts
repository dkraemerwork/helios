/**
 * NestJS controller that handles Angular SSR catch-all rendering.
 *
 * Intercepts all non-API, non-static routes and renders the Angular
 * application on the server. Handles authentication checks, CSP nonce
 * injection, transfer state hydration, and graceful degradation when
 * the Angular bundle is not yet built.
 *
 * The controller is registered at the lowest priority (no prefix) so
 * that API, WebSocket, and health routes take precedence.
 */

import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CspService } from './CspService.js';
import { SsrStateService } from './SsrStateService.js';
import { SsrErrorRenderer } from './SsrErrorRenderer.js';
import { createRequestContext } from './CookieRequestContext.js';
import { SessionService } from '../auth/SessionService.js';
import { SESSION_COOKIE, API_PREFIX, WS_PATH, HEALTH_PREFIX } from '../shared/constants.js';
import { nowMs } from '../shared/time.js';

/** File extensions that indicate a static asset request. */
const STATIC_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.html', '.json', '.map',
  '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.xml', '.txt', '.webmanifest',
]);

/** Routes that are publicly accessible without authentication. */
const PUBLIC_SSR_ROUTES = new Set([
  '/login',
  '/forgot-password',
  '/reset-password',
]);

/** Prefix patterns to skip for SSR rendering. */
const SKIP_PREFIXES: readonly string[] = [
  `${API_PREFIX}/`,
  `${WS_PATH}`,
  `${HEALTH_PREFIX}/`,
  `${HEALTH_PREFIX}`,
];

interface SsrSelfMetrics {
  totalRenders: number;
  totalFailures: number;
  lastRenderDurationMs: number;
}

@Controller()
export class AngularSsrController {
  private readonly logger = new Logger(AngularSsrController.name);

  /** Cached Angular server bundle module. null = not yet loaded, undefined = unavailable. */
  private angularBundle: Record<string, unknown> | null | undefined = null;

  /** Cached index.html template. */
  private indexHtml: string | null = null;

  /** Path to the Angular browser output directory. */
  private readonly browserDistPath: string;

  /** Path to the Angular server bundle. */
  private readonly serverBundlePath: string;

  /** Path to the browser index.html file. */
  private readonly indexHtmlPath: string;

  /** Self-metrics for SSR monitoring. */
  private readonly metrics: SsrSelfMetrics = {
    totalRenders: 0,
    totalFailures: 0,
    lastRenderDurationMs: 0,
  };

  constructor(
    private readonly cspService: CspService,
    private readonly ssrStateService: SsrStateService,
    private readonly ssrErrorRenderer: SsrErrorRenderer,
    private readonly sessionService: SessionService,
  ) {
    // Resolve paths relative to this file's compiled location
    // In production: dist/src/ssr/AngularSsrController.js
    // Frontend dist: frontend/dist/
    const ssrDir = path.dirname(new URL(import.meta.url).pathname);
    const packageRoot = path.resolve(ssrDir, '..', '..', '..');

    this.browserDistPath = path.join(packageRoot, 'frontend', 'dist', 'browser');
    this.serverBundlePath = path.join(packageRoot, 'frontend', 'dist', 'server', 'main.server.mjs');
    this.indexHtmlPath = path.join(this.browserDistPath, 'index.html');
  }

  /** Exposes SSR self-metrics for the internal monitoring endpoint. */
  getSsrMetrics(): { renderDurationMs: number; renderFailures: number } {
    return {
      renderDurationMs: this.metrics.lastRenderDurationMs,
      renderFailures: this.metrics.totalFailures,
    };
  }

  @Get('*')
  async handleSsr(
    @Req() req: { url: string; headers: Record<string, string | string[] | undefined>; raw?: { url?: string } },
    @Res() res: {
      status: (code: number) => { send: (body: string) => void };
      redirect: (code: number, url: string) => void;
      header: (name: string, value: string) => void;
      type: (contentType: string) => void;
    },
  ): Promise<void> {
    const url = req.url ?? req.raw?.url ?? '/';
    const pathname = url.split('?')[0]!;

    // Skip API, WebSocket, and health routes
    if (this.shouldSkip(pathname)) {
      return;
    }

    // Skip static asset requests (they are served by @fastify/static)
    if (this.isStaticAsset(pathname)) {
      return;
    }

    const requestId = crypto.randomUUID();
    const nonce = this.cspService.generateNonce();
    const startMs = nowMs();

    try {
      // Apply security headers
      const securityHeaders = this.cspService.buildSecurityHeaders(nonce);
      for (const [headerName, headerValue] of Object.entries(securityHeaders)) {
        res.header(headerName, headerValue);
      }

      // Resolve session from cookie
      const sessionId = this.extractSessionCookie(req);
      const sessionResult = sessionId
        ? await this.sessionService.getSession(sessionId)
        : null;

      const session = sessionResult?.session ?? null;
      const user = sessionResult?.user ?? null;

      // Redirect to login for protected routes without auth
      if (!user && !this.isPublicRoute(pathname)) {
        const returnUrl = encodeURIComponent(url);
        res.redirect(302, `/login?returnUrl=${returnUrl}`);
        return;
      }

      // Get route-specific transfer state
      const transferState = await this.ssrStateService.getStateForRoute(
        url,
        user,
        user?.clusterScopes ?? [],
      );

      // Attempt SSR rendering
      const html = await this.renderWithAngular(url, nonce, req, session, user, transferState);

      if (html !== null) {
        this.metrics.totalRenders++;
        this.metrics.lastRenderDurationMs = nowMs() - startMs;

        res.type('text/html');
        res.status(200).send(html);
        return;
      }

      // Angular SSR not available — serve fallback HTML with client-side rendering
      const fallbackHtml = this.buildFallbackHtml(nonce, transferState);
      res.type('text/html');
      res.status(200).send(fallbackHtml);
    } catch (err) {
      this.metrics.totalFailures++;
      this.logger.error(
        `SSR render failed for ${pathname}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );

      const errorHtml = this.ssrErrorRenderer.renderErrorPage(
        500,
        'An unexpected error occurred while rendering this page.',
        requestId,
      );

      res.type('text/html');
      res.status(500).send(errorHtml);
    }
  }

  // ── Angular Bundle Loading ──────────────────────────────────────────────

  /**
   * Lazily loads and caches the Angular server bundle.
   * Returns null if the bundle doesn't exist (development mode without build).
   */
  private async loadAngularBundle(): Promise<Record<string, unknown> | null> {
    if (this.angularBundle !== null) {
      return this.angularBundle === undefined ? null : this.angularBundle;
    }

    if (!existsSync(this.serverBundlePath)) {
      this.logger.warn(
        `Angular SSR bundle not found at ${this.serverBundlePath} — SSR disabled, using CSR fallback`,
      );
      this.angularBundle = undefined;
      return null;
    }

    try {
      const bundleModule = await import(this.serverBundlePath) as Record<string, unknown>;
      this.angularBundle = bundleModule;
      this.logger.log('Angular SSR bundle loaded successfully');
      return bundleModule;
    } catch (err) {
      this.logger.error(
        `Failed to load Angular SSR bundle: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.angularBundle = undefined;
      return null;
    }
  }

  /**
   * Loads and caches the browser index.html template.
   * Falls back to a minimal HTML shell if the file doesn't exist.
   */
  private loadIndexHtml(): string {
    if (this.indexHtml !== null) {
      return this.indexHtml;
    }

    if (!existsSync(this.indexHtmlPath)) {
      this.logger.warn(
        `Browser index.html not found at ${this.indexHtmlPath} — using minimal fallback template`,
      );
      this.indexHtml = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        '  <title>Helios Management Center</title>',
        '</head>',
        '<body>',
        '  <app-root></app-root>',
        '</body>',
        '</html>',
      ].join('\n');
      return this.indexHtml;
    }

    this.indexHtml = readFileSync(this.indexHtmlPath, 'utf-8');
    return this.indexHtml;
  }

  // ── SSR Rendering ───────────────────────────────────────────────────────

  /**
   * Renders the Angular application on the server with full transfer state.
   * Returns the rendered HTML string, or null if SSR is unavailable.
   */
  private async renderWithAngular(
    url: string,
    nonce: string,
    req: { url: string; headers: Record<string, string | string[] | undefined> },
    session: import('../shared/types.js').Session | null,
    user: import('../shared/types.js').User | null,
    transferState: Record<string, unknown>,
  ): Promise<string | null> {
    const bundle = await this.loadAngularBundle();
    if (!bundle) return null;

    const document = this.loadIndexHtml();

    // Try CommonEngine (Angular 17+) or renderApplication/renderModule
    const CommonEngine = bundle['CommonEngine'] as (new (options?: Record<string, unknown>) => {
      render: (options: Record<string, unknown>) => Promise<string>;
    }) | undefined;

    const renderApplication = bundle['renderApplication'] as
      | ((options: Record<string, unknown>) => Promise<string>)
      | undefined;

    const renderModule = bundle['renderModule'] as
      | ((options: Record<string, unknown>) => Promise<string>)
      | undefined;

    const bootstrap = bundle['AppServerModule'] ?? bundle['bootstrap'] ?? bundle['default'];

    const requestContext = createRequestContext(req, session, user);

    const providers = [
      { provide: 'APP_BASE_HREF', useValue: '/' },
      { provide: 'SSR_REQUEST_CONTEXT', useValue: requestContext },
      { provide: 'SSR_TRANSFER_STATE', useValue: transferState },
      { provide: 'SSR_CSP_NONCE', useValue: nonce },
    ];

    let html: string;

    if (CommonEngine) {
      const engine = new CommonEngine();
      html = await engine.render({
        document,
        url,
        bootstrap,
        providers,
      });
    } else if (renderApplication && typeof renderApplication === 'function') {
      html = await renderApplication({
        document,
        url,
        bootstrap,
        platformProviders: providers,
      });
    } else if (renderModule && typeof renderModule === 'function') {
      html = await renderModule({
        document,
        url,
        bootstrap,
        extraProviders: providers,
      });
    } else {
      this.logger.warn(
        'Angular SSR bundle does not export CommonEngine, renderApplication, or renderModule',
      );
      return null;
    }

    // Inject CSP nonce into script tags
    html = this.injectNonce(html, nonce);

    // Inject transfer state as a script tag
    html = this.injectTransferState(html, transferState, nonce);

    return html;
  }

  // ── HTML Post-Processing ────────────────────────────────────────────────

  /**
   * Injects the CSP nonce attribute into all inline <script> tags
   * that don't already have a nonce.
   */
  private injectNonce(html: string, nonce: string): string {
    return html.replace(
      /<script(?![^>]*\bnonce=)([^>]*)>/gi,
      `<script nonce="${nonce}"$1>`,
    );
  }

  /**
   * Injects the server-computed transfer state as a JSON script block
   * before the closing </body> tag for Angular hydration.
   */
  private injectTransferState(
    html: string,
    state: Record<string, unknown>,
    nonce: string,
  ): string {
    const stateJson = JSON.stringify(state)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    const stateScript = `<script nonce="${nonce}" id="mc-transfer-state" type="application/json">${stateJson}</script>`;

    const bodyCloseIndex = html.lastIndexOf('</body>');
    if (bodyCloseIndex === -1) {
      return html + stateScript;
    }

    return html.slice(0, bodyCloseIndex) + stateScript + html.slice(bodyCloseIndex);
  }

  // ── Fallback CSR Shell ──────────────────────────────────────────────────

  /**
   * Builds a fallback HTML page for client-side rendering when Angular SSR
   * is not available. Includes the transfer state for initial data hydration.
   */
  private buildFallbackHtml(nonce: string, transferState: Record<string, unknown>): string {
    let html = this.loadIndexHtml();

    // Inject nonce into existing script tags
    html = this.injectNonce(html, nonce);

    // Inject transfer state
    html = this.injectTransferState(html, transferState, nonce);

    return html;
  }

  // ── Route Matching ──────────────────────────────────────────────────────

  /** Returns true if the path should be skipped (API, WS, health). */
  private shouldSkip(pathname: string): boolean {
    for (const prefix of SKIP_PREFIXES) {
      if (pathname.startsWith(prefix)) return true;
    }
    return false;
  }

  /** Returns true if the path looks like a static asset request. */
  private isStaticAsset(pathname: string): boolean {
    const lastDotIndex = pathname.lastIndexOf('.');
    if (lastDotIndex === -1) return false;

    const extension = pathname.slice(lastDotIndex).toLowerCase();
    return STATIC_EXTENSIONS.has(extension);
  }

  /** Returns true if the route is publicly accessible without auth. */
  private isPublicRoute(pathname: string): boolean {
    // Exact match
    if (PUBLIC_SSR_ROUTES.has(pathname)) return true;

    // Root path redirects to login or dashboard based on auth
    if (pathname === '/') return true;

    // Check if path starts with a public route
    for (const route of PUBLIC_SSR_ROUTES) {
      if (pathname.startsWith(route + '/')) return true;
    }

    return false;
  }

  /** Extracts the session cookie value from the raw request headers. */
  private extractSessionCookie(
    req: { headers: Record<string, string | string[] | undefined> },
  ): string | null {
    const cookieHeader = req.headers['cookie'];
    if (!cookieHeader) return null;

    const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    if (!raw) return null;

    const pairs = raw.split(';');
    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;

      const name = pair.slice(0, eqIndex).trim();
      if (name === SESSION_COOKIE) {
        return pair.slice(eqIndex + 1).trim();
      }
    }

    return null;
  }
}
