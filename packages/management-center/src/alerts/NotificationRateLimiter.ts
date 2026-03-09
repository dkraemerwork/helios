/**
 * Rate limiter for notification deliveries.
 *
 * Prevents notification storms by limiting the number of deliveries
 * per destination within a sliding time window. When the limit is
 * exceeded, a suppressed_rate_limit record is inserted instead of
 * sending the notification.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { nowMs } from '../shared/time.js';
import {
  NOTIFICATION_RATE_LIMIT_MAX,
  NOTIFICATION_RATE_LIMIT_WINDOW_MS,
} from '../shared/constants.js';

@Injectable()
export class NotificationRateLimiter {
  private readonly logger = new Logger(NotificationRateLimiter.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
  ) {}

  /**
   * Checks whether a destination has exceeded the rate limit within
   * the sliding window (last 5 minutes).
   *
   * Returns true if the delivery is allowed, false if rate-limited.
   */
  async checkLimit(destination: string): Promise<boolean> {
    const client = await this.connectionFactory.getClient();
    const windowStart = nowMs() - NOTIFICATION_RATE_LIMIT_WINDOW_MS;

    const result = await client.execute({
      sql: `SELECT COUNT(*) as cnt
            FROM notification_deliveries
            WHERE destination = ?
              AND created_at >= ?
              AND status NOT IN ('suppressed_rate_limit')`,
      args: [destination, windowStart],
    });

    const count = Number(result.rows[0]?.['cnt'] ?? 0);
    return count < NOTIFICATION_RATE_LIMIT_MAX;
  }

  /**
   * Records a suppressed delivery due to rate limiting.
   */
  async recordSuppression(
    alertHistoryId: number,
    channelType: string,
    destination: string,
  ): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO notification_deliveries
              (alert_history_id, channel_type, destination, status, attempts, last_error, next_attempt_at, sent_at, created_at)
              VALUES (?, ?, ?, 'suppressed_rate_limit', 0, 'Rate limit exceeded', NULL, NULL, ?)`,
        args: [alertHistoryId, channelType, destination, nowMs()],
      });
    });

    this.logger.warn(
      `Rate limit exceeded for destination ${destination} — suppressed delivery for alert_history_id=${alertHistoryId}`,
    );
  }
}
