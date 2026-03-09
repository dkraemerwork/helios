/**
 * Scheduled retention cleanup for expired data.
 *
 * Runs every hour at minute 15, deleting data older than the configured
 * retention periods. Uses the ConfigService for retention settings and
 * the appropriate repositories for deletion.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetricsRepository } from './MetricsRepository.js';
import { AuditRepository } from './AuditRepository.js';
import { ConfigService } from '../config/ConfigService.js';
import { nowMs } from '../shared/time.js';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

@Injectable()
export class RetentionScheduler {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(
    private readonly metricsRepository: MetricsRepository,
    private readonly auditRepository: AuditRepository,
    private readonly configService: ConfigService,
  ) {}

  /** Runs every hour at minute 15. */
  @Cron('0 15 * * * *')
  async runRetention(): Promise<void> {
    this.logger.log('Starting retention cleanup...');
    const now = nowMs();
    let totalDeleted = 0;

    try {
      // Raw samples
      const rawCutoff = now - this.configService.retentionRawSamplesHours * MS_PER_HOUR;
      const rawDeleted = await this.metricsRepository.deleteOldSamples(rawCutoff);
      if (rawDeleted > 0) {
        this.logger.log(`Deleted ${rawDeleted} raw samples older than ${this.configService.retentionRawSamplesHours}h`);
      }
      totalDeleted += rawDeleted;

      // 1m aggregates
      const minuteCutoff = now - this.configService.retentionMinuteAggregatesHours * MS_PER_HOUR;
      const minuteDeleted = await this.metricsRepository.deleteOldAggregates('1m', minuteCutoff);
      if (minuteDeleted > 0) {
        this.logger.log(`Deleted ${minuteDeleted} 1m aggregates older than ${this.configService.retentionMinuteAggregatesHours}h`);
      }
      totalDeleted += minuteDeleted;

      // 5m aggregates
      const fiveMinCutoff = now - this.configService.retentionFiveMinuteAggregatesDays * MS_PER_DAY;
      const fiveMinDeleted = await this.metricsRepository.deleteOldAggregates('5m', fiveMinCutoff);
      if (fiveMinDeleted > 0) {
        this.logger.log(`Deleted ${fiveMinDeleted} 5m aggregates older than ${this.configService.retentionFiveMinuteAggregatesDays}d`);
      }
      totalDeleted += fiveMinDeleted;

      // 1h aggregates
      const hourCutoff = now - this.configService.retentionHourlyAggregatesDays * MS_PER_DAY;
      const hourDeleted = await this.metricsRepository.deleteOldAggregates('1h', hourCutoff);
      if (hourDeleted > 0) {
        this.logger.log(`Deleted ${hourDeleted} 1h aggregates older than ${this.configService.retentionHourlyAggregatesDays}d`);
      }
      totalDeleted += hourDeleted;

      // 1d aggregates
      const dayCutoff = now - this.configService.retentionDailyAggregatesDays * MS_PER_DAY;
      const dayDeleted = await this.metricsRepository.deleteOldAggregates('1d', dayCutoff);
      if (dayDeleted > 0) {
        this.logger.log(`Deleted ${dayDeleted} 1d aggregates older than ${this.configService.retentionDailyAggregatesDays}d`);
      }
      totalDeleted += dayDeleted;

      // System events
      const eventCutoff = now - this.configService.retentionEventDays * MS_PER_DAY;
      const eventDeleted = await this.metricsRepository.deleteOldEvents(eventCutoff);
      if (eventDeleted > 0) {
        this.logger.log(`Deleted ${eventDeleted} system events older than ${this.configService.retentionEventDays}d`);
      }
      totalDeleted += eventDeleted;

      // Audit entries
      const auditCutoff = now - this.configService.retentionAuditDays * MS_PER_DAY;
      const auditDeleted = await this.auditRepository.deleteOldAuditEntries(auditCutoff);
      if (auditDeleted > 0) {
        this.logger.log(`Deleted ${auditDeleted} audit entries older than ${this.configService.retentionAuditDays}d`);
      }
      totalDeleted += auditDeleted;

      this.logger.log(`Retention cleanup complete: ${totalDeleted} total records deleted`);
    } catch (err) {
      this.logger.error(
        `Retention cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
