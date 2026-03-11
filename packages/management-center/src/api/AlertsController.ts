/**
 * REST controller for alert rule CRUD, active alerts, and alert history.
 *
 * Alert rules control when and how alerts fire based on metric thresholds.
 * Active alerts represent currently unresolved conditions. Alert history
 * provides a time-ordered audit trail of all past alert events.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { InValue } from '@libsql/client';
import { CsrfGuard } from '../auth/CsrfGuard.js';
import { RbacGuard, RequireRoles } from '../auth/RbacGuard.js';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { ValidationError, NotFoundError } from '../shared/errors.js';
import { clampPageSize } from '../shared/formatters.js';
import { nowMs } from '../shared/time.js';
import { MAX_HISTORY_PAGE_SIZE, MC_SELF_CLUSTER_ID } from '../shared/constants.js';
import type {
  AlertRule,
  AlertSeverity,
  AlertOperator,
  AlertScope,
  AlertAction,
  AlertHistoryRecord,
  CursorPaginatedResult,
} from '../shared/types.js';

@Controller('api/alerts')
@UseGuards(RbacGuard)
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
    private readonly auditRepo: AuditRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── GET /api/alerts/rules ──────────────────────────────────────────────

  @Get('rules')
  @RequireRoles('viewer')
  async listRules(
    @Query('clusterId') clusterId?: string,
  ): Promise<{ rules: AlertRule[] }> {
    const client = await this.connectionFactory.getClient();

    if (clusterId) {
      const result = await client.execute({
        sql: 'SELECT * FROM alert_rules WHERE cluster_id = ? ORDER BY name ASC',
        args: [clusterId],
      });
      return { rules: result.rows.map(rowToAlertRule) };
    }

    const result = await client.execute('SELECT * FROM alert_rules ORDER BY name ASC');
    return { rules: result.rows.map(rowToAlertRule) };
  }

  // ── POST /api/alerts/rules ─────────────────────────────────────────────

  @Post('rules')
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @RequireRoles('operator')
  async createRule(
    @Body() body: Partial<AlertRule>,
    @Req() req: any,
  ): Promise<{ id: string }> {
    const rule = validateAlertRule(body);
    const now = nowMs();
    const ruleId = crypto.randomUUID();

    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO alert_rules (
          id, cluster_id, name, severity, enabled, metric, operator, threshold,
          duration_sec, cooldown_sec, delta_mode, scope, staleness_window_ms,
          runbook_url, actions_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          ruleId,
          rule.clusterId,
          rule.name,
          rule.severity,
          rule.enabled ? 1 : 0,
          rule.metric,
          rule.operator,
          rule.threshold,
          rule.durationSec,
          rule.cooldownSec,
          rule.deltaMode ? 1 : 0,
          rule.scope,
          rule.stalenessWindowMs,
          rule.runbookUrl ?? null,
          JSON.stringify(rule.actions),
          now,
          now,
        ],
      });
    });

    // Notify AlertEngine to reload
    this.eventEmitter.emit('alert.rule.changed', { ruleId, action: 'created' });

    // Audit log
    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'alert_rule.created',
      clusterId: rule.clusterId,
      targetType: 'alert_rule',
      targetId: ruleId,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ name: rule.name, metric: rule.metric }),
      createdAt: now,
    });

    return { id: ruleId };
  }

  // ── PUT /api/alerts/rules/:id ──────────────────────────────────────────

  @Put('rules/:id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequireRoles('operator')
  async updateRule(
    @Param('id') id: string,
    @Body() body: Partial<AlertRule>,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    const client = await this.connectionFactory.getClient();
    const existing = await client.execute({
      sql: 'SELECT * FROM alert_rules WHERE id = ?',
      args: [id],
    });

    if (existing.rows.length === 0) {
      throw new NotFoundError(`Alert rule ${id} not found`);
    }

    const existingRule = rowToAlertRule(existing.rows[0]!);
    const merged: AlertRule = {
      ...existingRule,
      ...body,
      id, // Cannot change ID
      updatedAt: nowMs(),
    };

    // Re-validate the merged rule
    validateAlertRule(merged);

    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `UPDATE alert_rules SET
          cluster_id = ?, name = ?, severity = ?, enabled = ?, metric = ?,
          operator = ?, threshold = ?, duration_sec = ?, cooldown_sec = ?,
          delta_mode = ?, scope = ?, staleness_window_ms = ?, runbook_url = ?,
          actions_json = ?, updated_at = ?
          WHERE id = ?`,
        args: [
          merged.clusterId,
          merged.name,
          merged.severity,
          merged.enabled ? 1 : 0,
          merged.metric,
          merged.operator,
          merged.threshold,
          merged.durationSec,
          merged.cooldownSec,
          merged.deltaMode ? 1 : 0,
          merged.scope,
          merged.stalenessWindowMs,
          merged.runbookUrl ?? null,
          JSON.stringify(merged.actions),
          merged.updatedAt,
          id,
        ],
      });
    });

    this.eventEmitter.emit('alert.rule.changed', { ruleId: id, action: 'updated' });

    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'alert_rule.updated',
      clusterId: merged.clusterId,
      targetType: 'alert_rule',
      targetId: id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ name: merged.name }),
      createdAt: nowMs(),
    });

    return { ok: true };
  }

  // ── DELETE /api/alerts/rules/:id ───────────────────────────────────────

  @Delete('rules/:id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequireRoles('operator')
  async deleteRule(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    const client = await this.connectionFactory.getClient();
    const existing = await client.execute({
      sql: 'SELECT * FROM alert_rules WHERE id = ?',
      args: [id],
    });

    if (existing.rows.length === 0) {
      throw new NotFoundError(`Alert rule ${id} not found`);
    }

    const rule = rowToAlertRule(existing.rows[0]!);

    // Built-in MC self-health rules can be disabled but not deleted
    if (rule.clusterId === MC_SELF_CLUSTER_ID) {
      throw new ValidationError(
        'Built-in MC self-health rules cannot be deleted. Disable them instead.',
      );
    }

    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'DELETE FROM alert_rules WHERE id = ?',
        args: [id],
      });
    });

    this.eventEmitter.emit('alert.rule.changed', { ruleId: id, action: 'deleted' });

    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'alert_rule.deleted',
      clusterId: rule.clusterId,
      targetType: 'alert_rule',
      targetId: id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ name: rule.name }),
      createdAt: nowMs(),
    });

    return { ok: true };
  }

  // ── GET /api/alerts/active ─────────────────────────────────────────────

  @Get('active')
  @RequireRoles('viewer')
  async activeAlerts(
    @Query('clusterId') clusterId?: string,
  ): Promise<{ alerts: AlertHistoryRecord[] }> {
    const client = await this.connectionFactory.getClient();
    const conditions = ['resolved_at IS NULL'];
    const args: InValue[] = [];

    if (clusterId) {
      conditions.push('cluster_id = ?');
      args.push(clusterId);
    }

    const result = await client.execute({
      sql: `SELECT * FROM alert_history WHERE ${conditions.join(' AND ')} ORDER BY fired_at DESC`,
      args,
    });

    return { alerts: result.rows.map(rowToAlertHistory) };
  }

  // ── GET /api/alerts/history ────────────────────────────────────────────

  @Get('history')
  @RequireRoles('viewer')
  async alertHistory(
    @Query('clusterId') clusterId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<CursorPaginatedResult<AlertHistoryRecord>> {
    const client = await this.connectionFactory.getClient();
    const limit = clampPageSize(parseInt(limitStr ?? '50', 10) || 50, MAX_HISTORY_PAGE_SIZE);
    const conditions: string[] = [];
    const args: InValue[] = [];

    if (clusterId) {
      conditions.push('cluster_id = ?');
      args.push(clusterId);
    }
    if (fromStr) {
      conditions.push('fired_at >= ?');
      args.push(parseInt(fromStr, 10));
    }
    if (toStr) {
      conditions.push('fired_at <= ?');
      args.push(parseInt(toStr, 10));
    }
    if (cursor) {
      conditions.push('id < ?');
      args.push(parseInt(cursor, 10));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    args.push(limit + 1);

    const result = await client.execute({
      sql: `SELECT * FROM alert_history ${whereClause} ORDER BY id DESC LIMIT ?`,
      args,
    });

    const rows = result.rows.map(rowToAlertHistory);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? String(items[items.length - 1]!.id) : null;

    return { items, nextCursor };
  }

  // ── POST /api/alerts/:id/acknowledge ───────────────────────────────────

  @Post(':id/acknowledge')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequireRoles('operator')
  async acknowledgeAlert(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    const alertId = parseInt(id, 10);
    if (Number.isNaN(alertId)) {
      throw new ValidationError('Invalid alert ID');
    }

    const client = await this.connectionFactory.getClient();
    const existing = await client.execute({
      sql: 'SELECT * FROM alert_history WHERE id = ?',
      args: [alertId],
    });

    if (existing.rows.length === 0) {
      throw new NotFoundError(`Alert ${id} not found`);
    }

    const alert = rowToAlertHistory(existing.rows[0]!);
    if (alert.resolvedAt !== null) {
      throw new ValidationError('Alert is already resolved');
    }

    const now = nowMs();

    // Mark as resolved (acknowledged)
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: 'UPDATE alert_history SET resolved_at = ? WHERE id = ?',
        args: [now, alertId],
      });
    });

    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'alert.acknowledged',
      clusterId: alert.clusterId,
      targetType: 'alert',
      targetId: id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ ruleId: alert.ruleId, severity: alert.severity }),
      createdAt: now,
    });

    this.eventEmitter.emit('alert.resolved', {
      clusterId: alert.clusterId,
      ruleId: alert.ruleId,
      memberAddr: alert.memberAddr,
      message: alert.message,
    });

    return { ok: true };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractUserId(req: any): string {
  return req.mcUser?.id ?? 'system';
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['warning', 'critical']);
const VALID_OPERATORS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=', '==']);
const VALID_SCOPES: ReadonlySet<string> = new Set(['any_member', 'all_members', 'cluster_aggregate']);

function validateAlertRule(body: Partial<AlertRule>): AlertRule {
  if (!body.clusterId || typeof body.clusterId !== 'string') {
    throw new ValidationError('clusterId is required');
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    throw new ValidationError('name is required');
  }
  if (!body.severity || !VALID_SEVERITIES.has(body.severity)) {
    throw new ValidationError('severity must be "warning" or "critical"');
  }
  if (!body.metric || typeof body.metric !== 'string') {
    throw new ValidationError('metric is required');
  }
  if (!body.operator || !VALID_OPERATORS.has(body.operator)) {
    throw new ValidationError('operator must be one of: >, >=, <, <=, ==');
  }
  if (body.threshold === undefined || typeof body.threshold !== 'number') {
    throw new ValidationError('threshold must be a number');
  }
  if (body.durationSec === undefined || typeof body.durationSec !== 'number' || body.durationSec < 0) {
    throw new ValidationError('durationSec must be a non-negative number');
  }
  if (body.cooldownSec === undefined || typeof body.cooldownSec !== 'number' || body.cooldownSec < 0) {
    throw new ValidationError('cooldownSec must be a non-negative number');
  }
  if (!body.scope || !VALID_SCOPES.has(body.scope)) {
    throw new ValidationError('scope must be one of: any_member, all_members, cluster_aggregate');
  }

  return {
    id: body.id ?? '',
    clusterId: body.clusterId,
    name: body.name.trim(),
    severity: body.severity as AlertSeverity,
    enabled: body.enabled ?? true,
    metric: body.metric as AlertRule['metric'],
    operator: body.operator as AlertOperator,
    threshold: body.threshold,
    durationSec: body.durationSec,
    cooldownSec: body.cooldownSec,
    deltaMode: body.deltaMode ?? false,
    scope: body.scope as AlertScope,
    stalenessWindowMs: body.stalenessWindowMs ?? 30000,
    runbookUrl: body.runbookUrl,
    actions: body.actions ?? [],
    createdAt: body.createdAt ?? 0,
    updatedAt: body.updatedAt ?? 0,
  };
}

function rowToAlertRule(row: Record<string, unknown>): AlertRule {
  let actions: AlertAction[] = [];
  try {
    actions = JSON.parse(String(row['actions_json'] ?? '[]')) as AlertAction[];
  } catch {
    // Invalid JSON — default to empty
  }

  return {
    id: String(row['id']),
    clusterId: String(row['cluster_id']),
    name: String(row['name']),
    severity: String(row['severity']) as AlertSeverity,
    enabled: Number(row['enabled']) === 1,
    metric: String(row['metric']) as AlertRule['metric'],
    operator: String(row['operator']) as AlertOperator,
    threshold: Number(row['threshold']),
    durationSec: Number(row['duration_sec']),
    cooldownSec: Number(row['cooldown_sec']),
    deltaMode: Number(row['delta_mode']) === 1,
    scope: String(row['scope']) as AlertScope,
    stalenessWindowMs: Number(row['staleness_window_ms']),
    runbookUrl: row['runbook_url'] !== null ? String(row['runbook_url']) : undefined,
    actions,
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  };
}

function rowToAlertHistory(row: Record<string, unknown>): AlertHistoryRecord {
  return {
    id: row['id'] === null || row['id'] === undefined ? undefined : Number(row['id']),
    ruleId: row['rule_id'] === null ? null : String(row['rule_id']),
    clusterId: String(row['cluster_id']),
    memberAddr: row['member_addr'] === null ? null : String(row['member_addr']),
    firedAt: Number(row['fired_at']),
    resolvedAt: row['resolved_at'] === null ? null : Number(row['resolved_at']),
    severity: String(row['severity']) as AlertSeverity,
    message: String(row['message']),
    metricValue: Number(row['metric_value']),
    threshold: Number(row['threshold']),
    deliveryStatusJson: String(row['delivery_status_json'] ?? '{}'),
  };
}
