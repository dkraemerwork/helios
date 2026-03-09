/**
 * ManagementCenterExtension — the primary entry point for embedding the
 * Helios Management Center into a Helios instance.
 *
 * Implements the HeliosExtension interface: bootstraps a NestJS application
 * with Fastify adapter on `start()`, and performs graceful shutdown on `stop()`.
 */

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ManagementCenterExtensionConfig } from './ManagementCenterExtensionConfig.js';

/**
 * Logger interface expected by the HeliosExtension contract.
 * Matches the Helios core Logger API surface used by extensions.
 */
export interface ExtensionLogger {
  info(message: string, ctx?: Record<string, unknown>): void;
  warn(message: string, ctx?: Record<string, unknown>): void;
  error(message: string, ctx?: Record<string, unknown>): void;
  debug(message: string, ctx?: Record<string, unknown>): void;
}

/**
 * MetricsRegistry interface expected by the HeliosExtension contract.
 * The Management Center reads samples from the host instance's registry.
 */
export interface ExtensionMetricsRegistry {
  getSamples(): readonly unknown[];
  getLatest(): unknown | null;
  readonly size: number;
}

/**
 * Context provided by the Helios instance when starting an extension.
 */
export interface ExtensionContext {
  logger: ExtensionLogger;
  env: Record<string, string | undefined>;
  metricsRegistry: ExtensionMetricsRegistry;
}

/**
 * The HeliosExtension interface that all extensions must implement.
 */
export interface HeliosExtension {
  readonly id: string;
  start(context: ExtensionContext): Promise<void>;
  stop(): Promise<void>;
}

/** DI token for the extension context provided by the host Helios instance. */
export const EXTENSION_CONTEXT = Symbol('EXTENSION_CONTEXT');

export class ManagementCenterExtension implements HeliosExtension {
  readonly id = 'management-center';

  private _app: NestFastifyApplication | null = null;
  private _context: ExtensionContext | null = null;
  private readonly _config: ManagementCenterExtensionConfig;

  constructor(config: ManagementCenterExtensionConfig = {}) {
    this._config = config;
  }

  async start(context: ExtensionContext): Promise<void> {
    this._context = context;
    const logger = context.logger;

    // Merge extension config into environment variables for ConfigService
    this._applyConfigToEnv(context.env);

    logger.info('Management Center extension starting');

    // Lazy-import the root module to avoid circular dependency at declaration time.
    const { ManagementCenterModule } = await import('../app/ManagementCenterModule.js');

    const adapter = new FastifyAdapter({
      trustProxy: this._config.trustProxy ?? false,
    });

    this._app = await NestFactory.create<NestFastifyApplication>(
      ManagementCenterModule,
      adapter,
      {
        logger: ['error', 'warn', 'log'],
        abortOnError: false,
      },
    );

    this._app.enableShutdownHooks();

    const host = this._config.host ?? '0.0.0.0';
    const port = this._config.port ?? 8080;

    await this._app.listen(port, host);

    logger.info(`Management Center listening on ${host}:${port}`);
  }

  async stop(): Promise<void> {
    if (this._app) {
      this._context?.logger.info('Management Center extension stopping');
      await this._app.close();
      this._app = null;
      this._context?.logger.info('Management Center extension stopped');
    }
  }

  /** Returns the underlying NestJS application instance, or null if not started. */
  get app(): NestFastifyApplication | null {
    return this._app;
  }

  /**
   * Projects the typed extension config onto MC_ environment variables so the
   * NestJS ConfigService can pick them up through its standard env parsing.
   */
  private _applyConfigToEnv(env: Record<string, string | undefined>): void {
    const set = (key: string, value: string | undefined): void => {
      if (value !== undefined) {
        process.env[key] = value;
        env[key] = value;
      }
    };

    set('MC_SERVER_HOST', this._config.host);
    set('MC_SERVER_PORT', this._config.port?.toString());
    set('MC_SERVER_PUBLIC_URL', this._config.publicUrl);
    set('MC_SERVER_TRUST_PROXY', this._config.trustProxy?.toString());
    set('MC_SERVER_SECURE_COOKIES', this._config.secureCookies?.toString());
    set('MC_DATABASE_URL', this._config.databaseUrl);
    set('MC_DATABASE_AUTH_TOKEN', this._config.databaseAuthToken);
    set('MC_AUTH_CSRF_SECRET', this._config.csrfSecret);
    set('MC_AUTH_BOOTSTRAP_ADMIN_EMAIL', this._config.bootstrapAdminEmail);
    set('MC_AUTH_BOOTSTRAP_ADMIN_PASSWORD', this._config.bootstrapAdminPassword);
    set('MC_AUTH_BOOTSTRAP_ADMIN_NAME', this._config.bootstrapAdminDisplayName);

    if (this._config.smtp) {
      set('MC_SMTP_HOST', this._config.smtp.host);
      set('MC_SMTP_PORT', this._config.smtp.port.toString());
      set('MC_SMTP_SECURE', this._config.smtp.secure.toString());
      set('MC_SMTP_USERNAME', this._config.smtp.username);
      set('MC_SMTP_PASSWORD', this._config.smtp.password);
      set('MC_SMTP_FROM', this._config.smtp.from);
    }

    if (this._config.clusters && this._config.clusters.length > 0) {
      set('MC_CLUSTERS', JSON.stringify(this._config.clusters));
    }

    // Apply arbitrary env overrides last
    if (this._config.env) {
      for (const [key, value] of Object.entries(this._config.env)) {
        set(key, value);
      }
    }
  }
}
