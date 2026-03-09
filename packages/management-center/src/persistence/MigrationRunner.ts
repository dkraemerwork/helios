/**
 * SQL migration runner with advisory locking and checksum verification.
 *
 * Reads numbered .sql files from the migrations/ directory, computes
 * SHA-256 checksums, acquires a row-level advisory lock to prevent
 * concurrent runners, and applies any pending migrations inside
 * transactions. On failure the process exits non-zero to prevent
 * partially-migrated databases from serving traffic.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { MIGRATION_LOCK_TIMEOUT_MS } from '../shared/constants.js';
import { nowMs } from '../shared/time.js';
import { DatabaseError } from '../shared/errors.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

const LOCK_NAME = 'migration';

@Injectable()
export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);
  private readonly ownerId = crypto.randomUUID();

  constructor(private readonly connectionFactory: TursoConnectionFactory) {}

  /** Runs all pending migrations. Exits the process on failure. */
  async run(): Promise<void> {
    const client = await this.connectionFactory.getClient();

    // Bootstrap the tracking tables (idempotent)
    await this.bootstrapTables(client);

    // Acquire advisory lock
    const lockAcquired = await this.acquireLock(client);
    if (!lockAcquired) {
      this.logger.error('Failed to acquire migration lock within timeout — another instance may be running');
      process.exit(1);
    }

    try {
      const files = this.loadMigrationFiles();
      if (files.length === 0) {
        this.logger.log('No migration files found');
        return;
      }

      const applied = await this.getAppliedVersions(client);
      this.verifyChecksums(files, applied);

      const pending = files.filter((f) => !applied.has(f.version));
      if (pending.length === 0) {
        this.logger.log('Database schema is up to date');
        return;
      }

      this.logger.log(`Found ${pending.length} pending migration(s)`);

      for (const migration of pending) {
        await this.applyMigration(client, migration);
      }

      this.logger.log(`Successfully applied ${pending.length} migration(s)`);
    } catch (err) {
      this.logger.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await this.releaseLock(client);
    }
  }

  /** Creates schema_migrations and schema_migrations_lock if they don't exist. */
  private async bootstrapTables(client: import('@libsql/client').Client): Promise<void> {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        checksum    TEXT    NOT NULL,
        applied_at  INTEGER NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations_lock (
        lock_name   TEXT    PRIMARY KEY DEFAULT 'migration',
        owner_id    TEXT    NOT NULL,
        acquired_at INTEGER NOT NULL
      )
    `);
  }

  /** Attempts to acquire the migration lock with exponential backoff. */
  private async acquireLock(client: import('@libsql/client').Client): Promise<boolean> {
    const deadline = nowMs() + MIGRATION_LOCK_TIMEOUT_MS;
    let attempt = 0;

    while (nowMs() < deadline) {
      try {
        // Try to insert the lock row
        const result = await client.execute({
          sql: `INSERT INTO schema_migrations_lock (lock_name, owner_id, acquired_at)
                VALUES (?, ?, ?)
                ON CONFLICT (lock_name) DO UPDATE
                SET owner_id = excluded.owner_id, acquired_at = excluded.acquired_at
                WHERE schema_migrations_lock.acquired_at < ?`,
          args: [LOCK_NAME, this.ownerId, nowMs(), nowMs() - MIGRATION_LOCK_TIMEOUT_MS],
        });

        if (result.rowsAffected > 0) {
          this.logger.log(`Migration lock acquired (owner: ${this.ownerId})`);
          return true;
        }

        // Check if we already own the lock
        const check = await client.execute({
          sql: 'SELECT owner_id FROM schema_migrations_lock WHERE lock_name = ?',
          args: [LOCK_NAME],
        });

        if (check.rows.length > 0 && check.rows[0]!['owner_id'] === this.ownerId) {
          return true;
        }
      } catch (err) {
        this.logger.warn(`Lock acquisition attempt failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      attempt++;
      const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 5000);
      const remaining = deadline - nowMs();
      if (remaining <= 0) break;

      await new Promise((resolve) => setTimeout(resolve, Math.min(backoffMs, remaining)));
    }

    return false;
  }

  /** Releases the migration lock. */
  private async releaseLock(client: import('@libsql/client').Client): Promise<void> {
    try {
      await client.execute({
        sql: 'DELETE FROM schema_migrations_lock WHERE lock_name = ? AND owner_id = ?',
        args: [LOCK_NAME, this.ownerId],
      });
      this.logger.log('Migration lock released');
    } catch (err) {
      this.logger.warn(`Failed to release migration lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Loads and sorts all .sql migration files from the migrations directory. */
  private loadMigrationFiles(): MigrationFile[] {
    const migrationsDir = this.getMigrationsDir();

    if (!fs.existsSync(migrationsDir)) {
      this.logger.warn(`Migrations directory does not exist: ${migrationsDir}`);
      return [];
    }

    const entries = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const files: MigrationFile[] = [];

    for (const entry of entries) {
      const match = entry.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        this.logger.warn(`Skipping non-matching migration file: ${entry}`);
        continue;
      }

      const version = parseInt(match[1]!, 10);
      const name = match[2]!;
      const filePath = path.join(migrationsDir, entry);
      const sql = fs.readFileSync(filePath, 'utf-8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      files.push({ version, name, sql, checksum });
    }

    files.sort((a, b) => a.version - b.version);
    return files;
  }

  /** Returns the absolute path to the migrations directory. */
  private getMigrationsDir(): string {
    // Resolve relative to the package root, not the compiled output
    const currentFile = fileURLToPath(import.meta.url);
    const srcDir = path.dirname(currentFile);
    // src/persistence/ -> go up two levels to package root
    const packageRoot = path.resolve(srcDir, '..', '..');
    return path.join(packageRoot, 'migrations');
  }

  /** Returns a map of already-applied migration versions to their checksums. */
  private async getAppliedVersions(
    client: import('@libsql/client').Client,
  ): Promise<Map<number, string>> {
    const result = await client.execute('SELECT version, checksum FROM schema_migrations ORDER BY version');
    const map = new Map<number, string>();

    for (const row of result.rows) {
      const version = Number(row['version']);
      const checksum = String(row['checksum']);
      map.set(version, checksum);
    }

    return map;
  }

  /** Verifies that already-applied migrations haven't been modified. */
  private verifyChecksums(files: MigrationFile[], applied: Map<number, string>): void {
    for (const file of files) {
      const existingChecksum = applied.get(file.version);
      if (existingChecksum !== undefined && existingChecksum !== file.checksum) {
        throw new DatabaseError(
          `Migration ${file.version}_${file.name} checksum mismatch: ` +
            `expected ${existingChecksum}, got ${file.checksum}. ` +
            `Applied migrations must not be modified.`,
        );
      }
    }
  }

  /** Applies a single migration within a transaction. */
  private async applyMigration(
    client: import('@libsql/client').Client,
    migration: MigrationFile,
  ): Promise<void> {
    this.logger.log(`Applying migration ${migration.version}_${migration.name}...`);

    // Split the SQL into individual statements (libsql doesn't support multi-statement execute)
    const statements = this.splitStatements(migration.sql);

    // Execute within a transaction
    const tx = await client.transaction('write');
    try {
      for (const stmt of statements) {
        await tx.execute(stmt);
      }

      // Record the migration
      await tx.execute({
        sql: 'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        args: [migration.version, migration.name, migration.checksum, nowMs()],
      });

      await tx.commit();
      this.logger.log(`Migration ${migration.version}_${migration.name} applied successfully`);
    } catch (err) {
      await tx.rollback();
      throw new DatabaseError(
        `Migration ${migration.version}_${migration.name} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Splits a SQL file into individual executable statements.
   * Handles comments and semicolons within string literals.
   */
  private splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inLineComment = false;

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i]!;
      const next = sql[i + 1];

      if (inLineComment) {
        if (char === '\n') {
          inLineComment = false;
        }
        continue;
      }

      if (char === '-' && next === '-' && !inSingleQuote) {
        inLineComment = true;
        continue;
      }

      if (char === "'" && !inLineComment) {
        // Handle escaped quotes ('') inside strings
        if (inSingleQuote && next === "'") {
          current += "''";
          i++;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        current += char;
        continue;
      }

      if (char === ';' && !inSingleQuote) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          statements.push(trimmed);
        }
        current = '';
        continue;
      }

      current += char;
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) {
      statements.push(trimmed);
    }

    return statements;
  }
}
