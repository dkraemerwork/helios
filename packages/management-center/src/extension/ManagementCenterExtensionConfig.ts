/**
 * Extension configuration interface for ManagementCenterExtension.
 *
 * Follows the HeliosExtension configuration pattern, providing typed
 * configuration that is passed when registering the extension with a
 * Helios instance.
 */

import type { ClusterConfig } from '../shared/types.js';

export interface ManagementCenterExtensionConfig {
  /** Server binding host. Defaults to '0.0.0.0'. */
  host?: string;

  /** Server binding port. Defaults to 8080. */
  port?: number;

  /** Publicly reachable URL used for generating links in emails and callbacks. */
  publicUrl?: string;

  /** Whether to trust proxy headers (X-Forwarded-For, etc.). */
  trustProxy?: boolean;

  /** Whether to set Secure flag on cookies. Should be true in production. */
  secureCookies?: boolean;

  /** Database connection URL (libsql:// or file:). */
  databaseUrl?: string;

  /** Auth token for Turso remote databases. */
  databaseAuthToken?: string;

  /** CSRF secret for cookie signing. Must be at least 16 characters. */
  csrfSecret?: string;

  /** Bootstrap admin email address. */
  bootstrapAdminEmail?: string;

  /** Bootstrap admin password (min 14 chars). */
  bootstrapAdminPassword?: string;

  /** Bootstrap admin display name. */
  bootstrapAdminDisplayName?: string;

  /** SMTP configuration for alert email delivery. */
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
  };

  /** Initial cluster configurations for seeding the database. */
  clusters?: ClusterConfig[];

  /**
   * Additional environment variable overrides.
   *
   * These are merged with the host process environment. Keys should use the
   * MC_ prefix (e.g. MC_RETENTION_RAW_HOURS).
   */
  env?: Record<string, string>;
}
