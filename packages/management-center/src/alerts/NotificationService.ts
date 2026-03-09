/**
 * Orchestrates alert notification delivery with retry, circuit breaking,
 * and rate limiting.
 *
 * The delivery pipeline:
 *   1. For each action on a rule, check the rate limiter.
 *   2. Render templates with the alert context.
 *   3. Create a 'pending' notification_deliveries record (outbox pattern).
 *   4. Attempt delivery via the appropriate channel.
 *   5. Mark 'sent' on success or 'failed' with a scheduled retry on failure.
 *   6. After NOTIFICATION_MAX_ATTEMPTS, mark 'dead_letter'.
 *
 * Circuit breaker protects against cascading failures when a channel is
 * consistently failing: closed -> open -> half_open -> closed/open.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { NotificationRateLimiter } from './NotificationRateLimiter.js';
import { EmailNotificationChannel } from './EmailNotificationChannel.js';
import { WebhookNotificationChannel } from './WebhookNotificationChannel.js';
import { renderTemplate } from '../shared/formatters.js';
import { nowMs } from '../shared/time.js';
import {
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_RETRY_BACKOFF_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_SAMPLE_SIZE,
  CIRCUIT_BREAKER_OPEN_DURATION_MS,
  CIRCUIT_BREAKER_PROBE_COUNT,
  CIRCUIT_BREAKER_PROBE_SUCCESS_THRESHOLD,
} from '../shared/constants.js';
import type {
  AlertRule,
  AlertAction,
  AlertTemplateContext,
} from '../shared/types.js';

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerState {
  state: CircuitState;
  /** Ring buffer of recent delivery results: true = success, false = failure. */
  results: boolean[];
  /** Timestamp when the circuit was opened. */
  openedAt: number;
  /** Number of probe deliveries attempted in half_open state. */
  probeAttempts: number;
  /** Number of successful probes in half_open state. */
  probeSuccesses: number;
}

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  private readonly circuitBreaker: CircuitBreakerState = {
    state: 'closed',
    results: [],
    openedAt: 0,
    probeAttempts: 0,
    probeSuccesses: 0,
  };

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
    private readonly auditRepository: AuditRepository,
    private readonly rateLimiter: NotificationRateLimiter,
    private readonly emailChannel: EmailNotificationChannel,
    private readonly webhookChannel: WebhookNotificationChannel,
  ) {}

  async onModuleInit(): Promise<void> {
    // Resume any unsent deliveries from a previous process lifecycle
    await this.retryPendingDeliveries();
  }

  /** Returns the current circuit breaker state for self-metrics reporting. */
  get circuitBreakerState(): CircuitState {
    return this.circuitBreaker.state;
  }

  // ── Primary Delivery Entrypoint ────────────────────────────────────────

  /**
   * Delivers notifications for a fired or resolved alert.
   * Creates outbox records and attempts immediate delivery for each action.
   */
  async deliverAlert(
    alertHistoryId: number,
    rule: AlertRule,
    context: AlertTemplateContext,
  ): Promise<void> {
    for (const action of rule.actions) {
      try {
        await this.processAction(alertHistoryId, action, context);
      } catch (err) {
        this.logger.error(
          `Failed to process action for alert_history_id=${alertHistoryId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── Retry Loop ─────────────────────────────────────────────────────────

  /**
   * Retries pending/failed deliveries that are due for their next attempt.
   * Called on startup and every 30 seconds via @Interval.
   */
  @Interval(30_000)
  async retryPendingDeliveries(): Promise<void> {
    const client = await this.connectionFactory.getClient();
    const now = nowMs();

    const result = await client.execute({
      sql: `SELECT id, alert_history_id, channel_type, destination, status, attempts, last_error
            FROM notification_deliveries
            WHERE status IN ('pending', 'failed')
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY next_attempt_at ASC
            LIMIT 50`,
      args: [now],
    });

    for (const row of result.rows) {
      const deliveryId = Number(row['id']);
      const channelType = String(row['channel_type']);
      const destination = String(row['destination']);
      const attempts = Number(row['attempts']);
      const alertHistoryId = Number(row['alert_history_id']);

      // Claim the delivery by setting status to 'sending'
      const claimed = await this.claimDelivery(deliveryId);
      if (!claimed) continue;

      try {
        await this.executeDelivery(channelType, destination, alertHistoryId);
        await this.markSent(deliveryId);
        this.recordCircuitResult(true);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newAttempts = attempts + 1;

        if (newAttempts >= NOTIFICATION_MAX_ATTEMPTS) {
          await this.markDeadLetter(deliveryId, errorMsg, newAttempts);
          this.logger.error(
            `Delivery ${deliveryId} dead-lettered after ${newAttempts} attempts: ${errorMsg}`,
          );
        } else {
          const backoffMs = NOTIFICATION_RETRY_BACKOFF_MS[newAttempts - 1] ?? 600_000;
          await this.markFailed(deliveryId, errorMsg, newAttempts, now + backoffMs);
        }

        this.recordCircuitResult(false);
      }
    }
  }

  // ── Action Processing ──────────────────────────────────────────────────

  private async processAction(
    alertHistoryId: number,
    action: AlertAction,
    context: AlertTemplateContext,
  ): Promise<void> {
    const channelType = action.type;
    const destination = this.getDestination(action);

    // Check rate limit
    const allowed = await this.rateLimiter.checkLimit(destination);
    if (!allowed) {
      await this.rateLimiter.recordSuppression(alertHistoryId, channelType, destination);
      return;
    }

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      this.logger.warn(
        `Circuit breaker OPEN — suppressing ${channelType} delivery to ${destination}`,
      );
      await this.rateLimiter.recordSuppression(alertHistoryId, channelType, destination);
      return;
    }

    // Create the outbox record
    const deliveryId = await this.createDeliveryRecord(alertHistoryId, channelType, destination);

    // Attempt immediate delivery
    try {
      await this.executeChannelDelivery(action, context);
      await this.markSent(deliveryId);
      this.recordCircuitResult(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const backoffMs = NOTIFICATION_RETRY_BACKOFF_MS[0] ?? 1000;
      await this.markFailed(deliveryId, errorMsg, 1, nowMs() + backoffMs);
      this.recordCircuitResult(false);

      this.logger.warn(
        `Delivery ${deliveryId} failed (attempt 1), scheduled retry: ${errorMsg}`,
      );
    }
  }

  private getDestination(action: AlertAction): string {
    if (action.type === 'email') return action.to.join(',');
    return action.url;
  }

  private async executeChannelDelivery(
    action: AlertAction,
    context: AlertTemplateContext,
  ): Promise<void> {
    const contextRecord = context as unknown as Record<string, string>;

    if (action.type === 'email') {
      const subject = renderTemplate(action.subjectTemplate, contextRecord);
      const body = renderTemplate(action.bodyTemplate, contextRecord);
      // For email, bodyTemplate contains HTML; create a text fallback by stripping tags
      const text = body.replace(/<[^>]+>/g, '');
      await this.emailChannel.send(action.to, subject, body, text);
      return;
    }

    if (action.type === 'webhook') {
      const renderedBody = renderTemplate(action.bodyTemplate, contextRecord);
      await this.webhookChannel.send(
        action.url,
        action.method,
        action.headers ?? {},
        renderedBody,
      );
    }
  }

  /**
   * Executes a delivery from the retry loop where we only have the channel
   * type, destination, and alert_history_id (the original action templates
   * are not stored per delivery). This re-fetches the alert history to
   * reconstruct context, then looks up the rule's matching action.
   */
  private async executeDelivery(
    channelType: string,
    destination: string,
    alertHistoryId: number,
  ): Promise<void> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT ah.rule_id, ah.cluster_id, ah.member_addr, ah.severity,
                   ah.message, ah.metric_value, ah.threshold, ah.fired_at, ah.resolved_at
            FROM alert_history ah
            WHERE ah.id = ?`,
      args: [alertHistoryId],
    });

    if (result.rows.length === 0) {
      throw new Error(`Alert history record ${alertHistoryId} not found`);
    }

    const row = result.rows[0]!;
    const ruleId = row['rule_id'] !== null ? String(row['rule_id']) : null;

    // If the rule no longer exists, we can still attempt a basic delivery
    // with the information we have from the alert history
    if (channelType === 'email') {
      const recipients = destination.split(',');
      const subject = `[Alert] ${String(row['severity']).toUpperCase()} — cluster ${String(row['cluster_id'])}`;
      const text = String(row['message']);
      const html = `<p>${text}</p>`;
      await this.emailChannel.send(recipients, subject, html, text);
      return;
    }

    if (channelType === 'webhook') {
      const body = JSON.stringify({
        event: row['resolved_at'] !== null ? 'alert.resolved' : 'alert.fired',
        ruleId,
        clusterId: String(row['cluster_id']),
        memberAddr: row['member_addr'] !== null ? String(row['member_addr']) : null,
        severity: String(row['severity']),
        message: String(row['message']),
        metricValue: Number(row['metric_value']),
        threshold: Number(row['threshold']),
      });

      // Default to POST for retries
      await this.webhookChannel.send(destination, 'POST', {}, body);
    }
  }

  // ── Database Operations ────────────────────────────────────────────────

  private async createDeliveryRecord(
    alertHistoryId: number,
    channelType: string,
    destination: string,
  ): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: `INSERT INTO notification_deliveries
              (alert_history_id, channel_type, destination, status, attempts, created_at)
              VALUES (?, ?, ?, 'pending', 0, ?)`,
        args: [alertHistoryId, channelType, destination, nowMs()],
      });
      return Number(result.lastInsertRowid);
    });
  }

  private async claimDelivery(deliveryId: number): Promise<boolean> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: `UPDATE notification_deliveries
              SET status = 'sending'
              WHERE id = ? AND status IN ('pending', 'failed')`,
        args: [deliveryId],
      });
      return Number(result.rowsAffected) > 0;
    });
  }

  private async markSent(deliveryId: number): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `UPDATE notification_deliveries
              SET status = 'sent', sent_at = ?
              WHERE id = ?`,
        args: [nowMs(), deliveryId],
      });
    });
  }

  private async markFailed(
    deliveryId: number,
    error: string,
    attempts: number,
    nextAttemptAt: number,
  ): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `UPDATE notification_deliveries
              SET status = 'failed', last_error = ?, attempts = ?, next_attempt_at = ?
              WHERE id = ?`,
        args: [error.slice(0, 2048), attempts, nextAttemptAt, deliveryId],
      });
    });
  }

  private async markDeadLetter(
    deliveryId: number,
    error: string,
    attempts: number,
  ): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `UPDATE notification_deliveries
              SET status = 'dead_letter', last_error = ?, attempts = ?
              WHERE id = ?`,
        args: [error.slice(0, 2048), attempts, deliveryId],
      });
    });
  }

  // ── Circuit Breaker ────────────────────────────────────────────────────

  private recordCircuitResult(success: boolean): void {
    const cb = this.circuitBreaker;

    if (cb.state === 'half_open') {
      cb.probeAttempts++;
      if (success) cb.probeSuccesses++;

      if (cb.probeAttempts >= CIRCUIT_BREAKER_PROBE_COUNT) {
        if (cb.probeSuccesses >= CIRCUIT_BREAKER_PROBE_SUCCESS_THRESHOLD) {
          this.transitionCircuit('closed');
        } else {
          this.transitionCircuit('open');
        }
      }
      return;
    }

    // In closed state, track results in the ring buffer
    cb.results.push(success);
    if (cb.results.length > CIRCUIT_BREAKER_SAMPLE_SIZE) {
      cb.results.shift();
    }

    // Only evaluate once the buffer is full
    if (cb.results.length >= CIRCUIT_BREAKER_SAMPLE_SIZE) {
      const failures = cb.results.filter((r) => !r).length;
      const failureRate = failures / cb.results.length;

      if (failureRate > CIRCUIT_BREAKER_THRESHOLD) {
        this.transitionCircuit('open');
      }
    }
  }

  private isCircuitOpen(): boolean {
    const cb = this.circuitBreaker;

    if (cb.state === 'closed') return false;

    if (cb.state === 'open') {
      // Check if the open duration has elapsed — transition to half_open
      if (nowMs() - cb.openedAt >= CIRCUIT_BREAKER_OPEN_DURATION_MS) {
        this.transitionCircuit('half_open');
        return false; // Allow probe deliveries
      }
      return true;
    }

    // half_open — allow deliveries (probes)
    return false;
  }

  private transitionCircuit(newState: CircuitState): void {
    const cb = this.circuitBreaker;
    const prevState = cb.state;

    cb.state = newState;

    switch (newState) {
      case 'open':
        cb.openedAt = nowMs();
        cb.probeAttempts = 0;
        cb.probeSuccesses = 0;
        this.logger.warn('Circuit breaker OPENED — suppressing all notification deliveries');
        this.recordCircuitBreakerAudit(prevState, newState);
        break;

      case 'half_open':
        cb.probeAttempts = 0;
        cb.probeSuccesses = 0;
        this.logger.log('Circuit breaker HALF_OPEN — allowing probe deliveries');
        break;

      case 'closed':
        cb.results = [];
        cb.probeAttempts = 0;
        cb.probeSuccesses = 0;
        this.logger.log('Circuit breaker CLOSED — normal delivery resumed');
        break;
    }
  }

  private recordCircuitBreakerAudit(fromState: CircuitState, toState: CircuitState): void {
    this.auditRepository
      .insertAuditEntry({
        actorUserId: null,
        actionType: 'notification.circuit_breaker',
        clusterId: null,
        targetType: 'notification_system',
        targetId: null,
        requestId: null,
        detailsJson: JSON.stringify({ fromState, toState, timestamp: nowMs() }),
        createdAt: nowMs(),
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to audit circuit breaker transition: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
