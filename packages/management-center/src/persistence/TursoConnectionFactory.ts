/**
 * Factory service that creates and manages a single @libsql/client connection.
 *
 * Handles both local file-based SQLite (file: URL) and remote Turso/libSQL
 * (libsql:// or https:// URL) modes. Enables WAL journal mode and foreign key
 * enforcement for file-based databases, and retries connection with exponential
 * backoff for up to two minutes on startup.
 */

import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createClient, type Client } from '@libsql/client';
import { ConfigService } from '../config/ConfigService.js';
import { DB_CONNECT_RETRY_MAX_MS } from '../shared/constants.js';
import { DatabaseError } from '../shared/errors.js';

@Injectable()
export class TursoConnectionFactory implements OnModuleDestroy {
  private readonly logger = new Logger(TursoConnectionFactory.name);
  private client: Client | null = null;
  private readonly url: string;
  private readonly authToken: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.url = configService.databaseUrl;
    this.authToken = configService.databaseAuthToken;
  }

  /**
   * Returns the active database client, creating and configuring it on first
   * access. The connection is retried with exponential backoff until either
   * successful or the two-minute deadline elapses.
   */
  async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const deadline = Date.now() + DB_CONNECT_RETRY_MAX_MS;
    let attempt = 0;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        this.client = createClient({
          url: this.url,
          authToken: this.authToken,
          intMode: 'bigint',
        });

        // Verify the connection is alive
        await this.client.execute('SELECT 1');

        // Configure pragmas for file-mode databases
        if (this.isFileMode()) {
          await this.client.execute('PRAGMA journal_mode = WAL');
          await this.client.execute('PRAGMA foreign_keys = ON');
          this.logger.log('File-mode database: WAL and foreign_keys enabled');
        }

        this.logger.log(`Connected to database: ${this.sanitizeUrl(this.url)}`);
        return this.client;
      } catch (err) {
        lastError = err;
        attempt++;

        // Destroy the failed client reference
        if (this.client) {
          this.client.close();
          this.client = null;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
        const remaining = deadline - Date.now();

        if (remaining <= 0) {
          break;
        }

        const waitMs = Math.min(backoffMs, remaining);
        this.logger.warn(
          `Database connection attempt ${attempt} failed, retrying in ${waitMs}ms ` +
            `(${Math.round(remaining / 1000)}s remaining): ${errorMessage(lastError)}`,
        );

        await sleep(waitMs);
      }
    }

    throw new DatabaseError(
      `Failed to connect to database after ${attempt} attempts ` +
        `over ${DB_CONNECT_RETRY_MAX_MS / 1000}s: ${errorMessage(lastError)}`,
    );
  }

  /** Returns true when the configured URL points to a local file. */
  isFileMode(): boolean {
    return this.url.startsWith('file:');
  }

  /** Returns the raw database URL (for backup scheduler). */
  getDatabaseUrl(): string {
    return this.url;
  }

  /** Extracts the file path from a file: URL for backup operations. */
  getFilePath(): string | null {
    if (!this.isFileMode()) {
      return null;
    }
    return this.url.slice('file:'.length);
  }

  /** Closes the client connection during module teardown. */
  async close(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.logger.log('Database connection closed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Strips auth tokens from URLs for safe logging. */
  private sanitizeUrl(url: string): string {
    if (url.startsWith('file:')) {
      return url;
    }
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url.replace(/authToken=[^&]+/g, 'authToken=***');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
