/**
 * Main alert processing engine.
 *
 * Listens to 'sample.received' and 'cluster.stateChanged' events, evaluates
 * all enabled rules for the affected cluster, and manages alert lifecycle:
 *
 *   - Fires when a condition is breached continuously for rule.durationSec.
 *   - Resolves when the condition is no longer breached.
 *   - Enforces cooldown to prevent re-firing within cooldownSec after resolution.
 *
 * Alert state is tracked in memory with persistence to the alert_history table.
 * Rules are loaded from the database on startup and refreshed on CRUD events.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { RuleEvaluator, type EvaluationResult } from './RuleEvaluator.js';
import { NotificationService } from './NotificationService.js';
import {
  alertFiredEmailSubject,
  alertFiredEmailBody,
  alertResolvedEmailSubject,
  alertResolvedEmailBody,
  alertFiredWebhookBody,
  alertResolvedWebhookBody,
} from './AlertTemplates.js';
import { renderTemplate } from '../shared/formatters.js';
import { nowMs, isoFromMs } from '../shared/time.js';
import { MC_SELF_CLUSTER_ID } from '../shared/constants.js';
import type {
  AlertRule,
  AlertSeverity,
  AlertAction,
  AlertTemplateContext,
  MemberMetricsSample,
} from '../shared/types.js';

interface ActiveAlertState {
  /** Timestamp of the first continuous breach. */
  firstBreachAt: number;
  /** Timestamp of the most recent breach. */
  lastBreachAt: number;
  /** Count of consecutive evaluation cycles where the condition was breached. */
  consecutiveBreachCount: number;
  /** Whether the alert has actually fired (breach sustained for durationSec). */
  fired: boolean;
  /** The alert_history row id once the alert fires. */
  alertHistoryId: number | null;
  /** Metric value when the alert fired. */
  firedMetricValue: number;
  /** Timestamp when the alert was resolved (for cooldown tracking). */
  resolvedAt: number | null;
}

@Injectable()
export class AlertEngine implements OnModuleInit {
  private readonly logger = new Logger(AlertEngine.name);

  /** Rules indexed by cluster ID for fast lookup on events. */
  private readonly rulesByCluster = new Map<string, AlertRule[]>();

  /**
   * Active alert state per rule+member combination.
   * Key: `${ruleId}:${memberAddr}`
   */
  private readonly activeAlerts = new Map<string, ActiveAlertState>();

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
    private readonly clusterStateStore: ClusterStateStore,
    private readonly ruleEvaluator: RuleEvaluator,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadRules();
    this.logger.log(
      `Alert engine initialized with ${this.getTotalRuleCount()} rule(s) across ${this.rulesByCluster.size} cluster(s)`,
    );
  }

  // ── Event Listeners ────────────────────────────────────────────────────

  @OnEvent('sample.received')
  async onSampleReceived(payload: {
    clusterId: string;
    memberAddr: string;
    sample: MemberMetricsSample;
  }): Promise<void> {
    await this.evaluateClusterRules(payload.clusterId);
  }

  @OnEvent('cluster.stateChanged')
  async onClusterStateChanged(payload: {
    clusterId: string;
    newState: string;
  }): Promise<void> {
    await this.evaluateClusterRules(payload.clusterId);
  }

  /** Refresh rules when CRUD operations modify them. */
  @OnEvent('alert.rule.changed')
  async onRuleChanged(): Promise<void> {
    await this.loadRules();
    this.logger.log('Alert rules reloaded after CRUD change');
  }

  // ── Core Evaluation Loop ───────────────────────────────────────────────

  private async evaluateClusterRules(clusterId: string): Promise<void> {
    const rules = this.rulesByCluster.get(clusterId);
    if (!rules || rules.length === 0) return;

    const clusterState = this.clusterStateStore.getClusterState(clusterId);
    if (!clusterState) return;

    for (const rule of rules) {
      if (!rule.enabled) continue;

      try {
        const results = this.ruleEvaluator.evaluate(rule, clusterState);
        await this.processResults(rule, results);
      } catch (err) {
        this.logger.error(
          `Error evaluating rule ${rule.id} (${rule.name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async processResults(
    rule: AlertRule,
    results: EvaluationResult[],
  ): Promise<void> {
    const now = nowMs();

    for (const result of results) {
      const key = `${rule.id}:${result.memberAddr}`;
      const existing = this.activeAlerts.get(key);

      if (result.breached) {
        await this.handleBreach(rule, result, key, existing, now);
      } else {
        await this.handleClear(rule, result, key, existing, now);
      }
    }
  }

  // ── Breach Handling ────────────────────────────────────────────────────

  private async handleBreach(
    rule: AlertRule,
    result: EvaluationResult,
    key: string,
    existing: ActiveAlertState | undefined,
    now: number,
  ): Promise<void> {
    // Check cooldown: don't re-enter active tracking if recently resolved
    if (existing?.resolvedAt !== null && existing?.resolvedAt !== undefined) {
      const cooldownEnd = existing.resolvedAt + rule.cooldownSec * 1000;
      if (now < cooldownEnd) return;

      // Cooldown expired — clear the old state so we can start tracking fresh
      this.activeAlerts.delete(key);
    }

    if (!existing || existing.resolvedAt !== null) {
      // Start tracking a new breach
      this.activeAlerts.set(key, {
        firstBreachAt: now,
        lastBreachAt: now,
        consecutiveBreachCount: 1,
        fired: false,
        alertHistoryId: null,
        firedMetricValue: result.metricValue,
        resolvedAt: null,
      });
      return;
    }

    // Update existing breach tracking
    existing.lastBreachAt = now;
    existing.consecutiveBreachCount++;
    existing.firedMetricValue = result.metricValue;

    // Check if the breach has been sustained for durationSec
    if (!existing.fired) {
      const breachDurationMs = now - existing.firstBreachAt;
      if (breachDurationMs >= rule.durationSec * 1000) {
        await this.fireAlert(rule, result, key, existing);
      }
    }
  }

  private async fireAlert(
    rule: AlertRule,
    result: EvaluationResult,
    _key: string,
    state: ActiveAlertState,
  ): Promise<void> {
    state.fired = true;
    const now = nowMs();

    const message = this.buildAlertMessage(rule, result, 'fired');

    // Insert alert_history record
    const alertHistoryId = await this.insertAlertHistory({
      ruleId: rule.id,
      clusterId: rule.clusterId,
      memberAddr: result.memberAddr === '*' ? null : result.memberAddr,
      firedAt: now,
      resolvedAt: null,
      severity: rule.severity,
      message,
      metricValue: result.metricValue,
      threshold: rule.threshold,
      deliveryStatusJson: '{}',
    });

    state.alertHistoryId = alertHistoryId;

    // Emit event for WebSocket gateway
    this.eventEmitter.emit('alert.fired', {
      clusterId: rule.clusterId,
      ruleId: rule.id,
      memberAddr: result.memberAddr,
      severity: rule.severity,
      message,
      metricValue: result.metricValue,
      threshold: rule.threshold,
    });

    this.logger.warn(
      `Alert FIRED: ${rule.name} — ${rule.metric} ${rule.operator} ${rule.threshold} ` +
        `(actual: ${result.metricValue}) on ${result.memberAddr} in ${rule.clusterId}`,
    );

    // Trigger notification delivery
    const context = this.buildTemplateContext(rule, result, now, null, message);
    await this.notificationService.deliverAlert(alertHistoryId, rule, context);
  }

  // ── Clear Handling ─────────────────────────────────────────────────────

  private async handleClear(
    rule: AlertRule,
    result: EvaluationResult,
    key: string,
    existing: ActiveAlertState | undefined,
    now: number,
  ): Promise<void> {
    if (!existing) return;
    if (existing.resolvedAt !== null) return; // Already resolved

    if (!existing.fired) {
      // Condition cleared before durationSec was reached — just remove tracking
      this.activeAlerts.delete(key);
      return;
    }

    // Alert was fired and condition is now clear — resolve it
    existing.resolvedAt = now;

    const message = this.buildAlertMessage(rule, result, 'resolved');

    // Update alert_history.resolved_at
    if (existing.alertHistoryId !== null) {
      await this.updateAlertHistoryResolved(existing.alertHistoryId, now);
    }

    // Emit event for WebSocket gateway
    this.eventEmitter.emit('alert.resolved', {
      clusterId: rule.clusterId,
      ruleId: rule.id,
      memberAddr: result.memberAddr,
      message,
    });

    this.logger.log(
      `Alert RESOLVED: ${rule.name} on ${result.memberAddr} in ${rule.clusterId}`,
    );

    // Send resolution notification
    if (existing.alertHistoryId !== null) {
      const resolvedContext = this.buildTemplateContext(
        rule,
        { ...result, metricValue: existing.firedMetricValue },
        existing.firstBreachAt,
        now,
        message,
      );

      // Build resolution actions from rule — replace templates with resolved versions
      const resolvedRule = this.buildResolvedRule(rule);
      await this.notificationService.deliverAlert(
        existing.alertHistoryId,
        resolvedRule,
        resolvedContext,
      );
    }
  }

  // ── Rule Loading ───────────────────────────────────────────────────────

  private async loadRules(): Promise<void> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute(
      'SELECT * FROM alert_rules WHERE enabled = 1',
    );

    this.rulesByCluster.clear();

    for (const row of result.rows) {
      const rule = this.rowToRule(row);
      const existing = this.rulesByCluster.get(rule.clusterId);
      if (existing) {
        existing.push(rule);
      } else {
        this.rulesByCluster.set(rule.clusterId, [rule]);
      }
    }
  }

  private rowToRule(row: Record<string, unknown>): AlertRule {
    let actions: AlertAction[] = [];
    try {
      const actionsJson = String(row['actions_json'] ?? '[]');
      actions = JSON.parse(actionsJson) as AlertAction[];
    } catch {
      this.logger.warn(`Invalid actions_json for rule ${String(row['id'])}`);
    }

    return {
      id: String(row['id']),
      clusterId: String(row['cluster_id']),
      name: String(row['name']),
      severity: String(row['severity']) as AlertSeverity,
      enabled: Number(row['enabled']) === 1,
      metric: String(row['metric']) as AlertRule['metric'],
      operator: String(row['operator']) as AlertRule['operator'],
      threshold: Number(row['threshold']),
      durationSec: Number(row['duration_sec']),
      cooldownSec: Number(row['cooldown_sec']),
      deltaMode: Number(row['delta_mode']) === 1,
      scope: String(row['scope']) as AlertRule['scope'],
      stalenessWindowMs: Number(row['staleness_window_ms']),
      runbookUrl: row['runbook_url'] !== null ? String(row['runbook_url']) : undefined,
      actions,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  // ── Alert History Persistence ──────────────────────────────────────────

  private async insertAlertHistory(record: {
    ruleId: string | null;
    clusterId: string;
    memberAddr: string | null;
    firedAt: number;
    resolvedAt: number | null;
    severity: AlertSeverity;
    message: string;
    metricValue: number;
    threshold: number;
    deliveryStatusJson: string;
  }): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: `INSERT INTO alert_history
              (rule_id, cluster_id, member_addr, fired_at, resolved_at, severity, message, metric_value, threshold, delivery_status_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.ruleId,
          record.clusterId,
          record.memberAddr,
          record.firedAt,
          record.resolvedAt,
          record.severity,
          record.message,
          record.metricValue,
          record.threshold,
          record.deliveryStatusJson,
        ],
      });
      return Number(result.lastInsertRowid);
    });
  }

  private async updateAlertHistoryResolved(
    alertHistoryId: number,
    resolvedAt: number,
  ): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'UPDATE alert_history SET resolved_at = ? WHERE id = ?',
        args: [resolvedAt, alertHistoryId],
      });
    });
  }

  // ── Template Building ──────────────────────────────────────────────────

  private buildTemplateContext(
    rule: AlertRule,
    result: EvaluationResult,
    firedAt: number,
    resolvedAt: number | null,
    message: string,
  ): AlertTemplateContext {
    return {
      'alert.id': String(rule.id),
      'alert.name': rule.name,
      'alert.severity': rule.severity,
      'alert.clusterId': rule.clusterId,
      'alert.memberAddr': result.memberAddr,
      'alert.metric': rule.metric,
      'alert.metricValue': String(result.metricValue.toFixed(2)),
      'alert.threshold': String(rule.threshold),
      'alert.operator': rule.operator,
      'alert.scope': rule.scope,
      'alert.firedAtIso': isoFromMs(firedAt),
      'alert.resolvedAtIso': resolvedAt ? isoFromMs(resolvedAt) : '',
      'alert.message': message,
      'alert.runbookUrl': rule.runbookUrl ?? '',
    };
  }

  private buildAlertMessage(
    rule: AlertRule,
    result: EvaluationResult,
    phase: 'fired' | 'resolved',
  ): string {
    if (phase === 'fired') {
      return (
        `Alert "${rule.name}" fired: ${rule.metric} is ${result.metricValue.toFixed(2)} ` +
        `(threshold: ${rule.operator} ${rule.threshold}) on member ${result.memberAddr}`
      );
    }
    return (
      `Alert "${rule.name}" resolved on member ${result.memberAddr} ` +
      `in cluster ${rule.clusterId}`
    );
  }

  /**
   * Creates a copy of the rule with actions modified to use resolution templates.
   * This ensures resolution notifications use the correct subject/body.
   */
  private buildResolvedRule(rule: AlertRule): AlertRule {
    const resolvedActions: AlertAction[] = rule.actions.map((action) => {
      if (action.type === 'email') {
        return {
          type: 'email' as const,
          to: action.to,
          subjectTemplate: alertResolvedEmailSubject(),
          bodyTemplate: alertResolvedEmailBody().html,
        };
      }

      return {
        type: 'webhook' as const,
        url: action.url,
        method: action.method,
        headers: action.headers,
        bodyTemplate: alertResolvedWebhookBody(),
      };
    });

    return { ...rule, actions: resolvedActions };
  }

  private getTotalRuleCount(): number {
    let count = 0;
    for (const rules of this.rulesByCluster.values()) {
      count += rules.length;
    }
    return count;
  }
}
