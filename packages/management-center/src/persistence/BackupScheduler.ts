/**
 * Scheduled daily backup for file-mode SQLite databases.
 *
 * Creates a copy of the database file using the SQLite VACUUM INTO command
 * (ensuring a consistent snapshot), then delegates upload to BackupUploader.
 * Only active when the database URL starts with "file:".
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { BackupUploader } from './BackupUploader.js';
import { AuditRepository } from './AuditRepository.js';
import { isoFromMs, nowMs } from '../shared/time.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly uploader: BackupUploader,
    private readonly auditRepository: AuditRepository,
  ) {}

  /**
   * Daily backup at 02:00 UTC.
   * Only runs when using a local file database and backup is configured.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async performBackup(): Promise<void> {
    if (!this.connectionFactory.isFileMode()) {
      return;
    }

    if (!this.uploader.isConfigured()) {
      this.logger.debug('Backup skipped: no backup bucket configured');
      return;
    }

    const dbPath = this.connectionFactory.getFilePath();
    if (!dbPath || !fs.existsSync(dbPath)) {
      this.logger.warn(`Backup skipped: database file not found at ${dbPath}`);
      return;
    }

    const timestamp = isoFromMs(nowMs()).replace(/[:.]/g, '-');
    const snapshotName = `helios-mc-backup-${timestamp}.db`;
    const snapshotPath = path.join(os.tmpdir(), snapshotName);

    try {
      // Use VACUUM INTO for a consistent snapshot
      const client = await this.connectionFactory.getClient();
      await client.execute({ sql: `VACUUM INTO ?`, args: [snapshotPath] });

      this.logger.log(`Database snapshot created: ${snapshotPath}`);

      // Upload the snapshot
      const objectKey = `backups/${snapshotName}`;
      await this.uploader.upload(snapshotPath, objectKey);

      // Log success to audit
      await this.auditRepository.insertAuditEntry({
        actorUserId: null,
        actionType: 'backup.completed',
        clusterId: null,
        targetType: 'database',
        targetId: objectKey,
        requestId: null,
        detailsJson: JSON.stringify({
          snapshotSize: fs.statSync(snapshotPath).size,
          objectKey,
        }),
        createdAt: nowMs(),
      });

      this.logger.log(`Backup completed: ${objectKey}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Backup failed: ${message}`);

      // Log failure to audit
      await this.auditRepository.insertAuditEntry({
        actorUserId: null,
        actionType: 'backup.failed',
        clusterId: null,
        targetType: 'database',
        targetId: null,
        requestId: null,
        detailsJson: JSON.stringify({ error: message }),
        createdAt: nowMs(),
      }).catch((auditErr) => {
        this.logger.warn(`Failed to log backup failure to audit: ${auditErr}`);
      });
    } finally {
      // Clean up the temporary snapshot
      try {
        if (fs.existsSync(snapshotPath)) {
          fs.unlinkSync(snapshotPath);
        }
      } catch {
        this.logger.warn(`Failed to clean up snapshot: ${snapshotPath}`);
      }
    }
  }
}
