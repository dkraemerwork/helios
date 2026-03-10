/**
 * NestJS module for Angular Server-Side Rendering integration.
 *
 * Configures static file serving for the Angular browser build output
 * with appropriate cache headers (immutable for fingerprinted assets,
 * no-cache for index.html), and provides the SSR controller, CSP service,
 * state preparation, and error rendering.
 *
 * Static assets are served from frontend/dist/browser/ via
 * @nestjs/serve-static, while the catch-all SSR controller handles
 * all remaining routes at the lowest priority.
 */

import { Module } from '@nestjs/common';
import { existsSync } from 'fs';
import * as path from 'path';
import { ServeStaticModule } from '@nestjs/serve-static/index.js';
import { AuthModule } from '../auth/AuthModule.js';
import { PersistenceModule } from '../persistence/PersistenceModule.js';
import { ClusterConnectorModule } from '../connector/ClusterConnectorModule.js';
import { JobsModule } from '../jobs/JobsModule.js';
import { CspService } from './CspService.js';
import { SsrStateService } from './SsrStateService.js';
import { SsrErrorRenderer } from './SsrErrorRenderer.js';
import { AngularSsrController } from './AngularSsrController.js';

/**
 * Resolves the absolute path to the frontend browser distribution directory.
 * Uses import.meta.url for ESM compatibility with the bundler module resolution.
 */
function resolveBrowserDistPath(): string {
  const moduleDir = path.dirname(new URL(import.meta.url).pathname);
  // When Bun runs TS directly: src/ssr/SsrModule.ts → 2 levels up
  // When compiled:            dist/src/ssr/SsrModule.js → 3 levels up
  const packageRoot = moduleDir.includes(path.sep + 'dist' + path.sep)
    ? path.resolve(moduleDir, '..', '..', '..')
    : path.resolve(moduleDir, '..', '..');
  return path.resolve(packageRoot, 'frontend', 'dist', 'browser');
}

/**
 * Builds the ServeStaticModule imports array.
 * Only configures static file serving if the browser dist directory exists,
 * preventing startup failures during development when the frontend isn't built.
 */
function buildStaticImports(): Array<ReturnType<typeof ServeStaticModule.forRoot>> {
  const browserDistPath = resolveBrowserDistPath();

  if (!existsSync(browserDistPath)) {
    return [];
  }

  return [
    ServeStaticModule.forRoot({
      rootPath: browserDistPath,
      serveRoot: '/',
      exclude: ['/api/(.*)', '/ws', '/ws/(.*)', '/health', '/health/(.*)'],
      serveStaticOptions: {
        cacheControl: true,
        maxAge: '1y',
        immutable: true,
        index: false,
        dotfiles: 'ignore',
        lastModified: true,
        etag: true,
      },
    }),
  ];
}

@Module({
  imports: [
    AuthModule,
    PersistenceModule,
    ClusterConnectorModule,
    JobsModule,
    ...buildStaticImports(),
  ],
  controllers: [AngularSsrController],
  providers: [
    CspService,
    SsrStateService,
    SsrErrorRenderer,
  ],
  exports: [CspService],
})
export class SsrModule {}
