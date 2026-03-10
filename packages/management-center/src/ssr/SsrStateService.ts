/**
 * Prepares route-specific initial state for Angular SSR rendering.
 *
 * Inspects the requested URL, determines which data is needed for the
 * server-rendered page, and fetches it from the appropriate repositories
 * and in-memory stores. The resulting state object is serialized as JSON
 * transfer state so the Angular client can hydrate without redundant
 * API calls on first load.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { InValue } from '@libsql/client';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { countConnectedMonitorCapableMembers, countMonitorCapableMembers, isMonitorCapableMemberState } from '../shared/memberCapabilities.js';
import { MetricsRepository } from '../persistence/MetricsRepository.js';
import { AuthRepository } from '../persistence/AuthRepository.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { JobsService } from '../jobs/JobsService.js';
import { nowMs } from '../shared/time.js';
import type {
  AlertHistoryRecord,
  AlertRule,
  AlertSeverity,
  AlertAction,
  AlertOperator,
  ClusterState,
  MemberState,
  User,
} from '../shared/types.js';

/** Duration of recent metrics window for dashboard views (1 hour). */
const RECENT_WINDOW_MS = 60 * 60 * 1000;

/** Maximum items to include in transfer state per collection. */
const TRANSFER_STATE_LIMIT = 50;

@Injectable()
export class SsrStateService {
  private readonly logger = new Logger(SsrStateService.name);

  constructor(
    private readonly clusterStateStore: ClusterStateStore,
    private readonly metricsRepo: MetricsRepository,
    private readonly authRepo: AuthRepository,
    private readonly auditRepo: AuditRepository,
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly jobsService: JobsService,
  ) {}

  /**
   * Returns the initial transfer state for the given route and user context.
   * Each route segment is parsed to determine the appropriate data to prefetch.
   */
  async getStateForRoute(
    url: string,
    user: User | null,
    clusterScopes: string[],
  ): Promise<Record<string, unknown>> {
    const path = url.split('?')[0]!;
    const segments = path.split('/').filter(Boolean);

    // Public / auth routes — minimal state
    if (this.isAuthRoute(segments)) {
      return this.getMinimalState();
    }

    // No user — return minimal state (controller will handle redirect)
    if (!user) {
      return this.getMinimalState();
    }

    const isAdmin = user.roles.includes('admin');
    const now = nowMs();

    // /clusters/:id/...
    if (segments[0] === 'clusters' && segments.length >= 2) {
      const clusterId = segments[1]!;

      // Verify user has access to this cluster
      if (!isAdmin && clusterScopes.length > 0 && !clusterScopes.includes(clusterId)) {
        return this.getMinimalState();
      }

      return this.getClusterRouteState(segments, clusterId, isAdmin, now);
    }

    // /users — admin only
    if (segments[0] === 'users') {
      if (!isAdmin) return this.getMinimalState();
      return this.getUsersState();
    }

    // /settings
    if (segments[0] === 'settings') {
      return this.getSettingsState(user);
    }

    // Dashboard root — cluster list overview
    return this.getDashboardState(clusterScopes, isAdmin);
  }

  // ── Route Handlers ──────────────────────────────────────────────────────

  private getMinimalState(): Record<string, unknown> {
    return { _ssrTimestamp: nowMs() };
  }

  private async getDashboardState(
    clusterScopes: string[],
    isAdmin: boolean,
  ): Promise<Record<string, unknown>> {
    const allStates = this.clusterStateStore.getAllClusterStates();
    const clusters: Record<string, unknown>[] = [];

    for (const [clusterId, state] of allStates) {
      if (!isAdmin && clusterScopes.length > 0 && !clusterScopes.includes(clusterId)) {
        continue;
      }
      clusters.push(serializeClusterSummary(state));
    }

    return {
      _ssrTimestamp: nowMs(),
      clusters,
    };
  }

  private async getClusterRouteState(
    segments: string[],
    clusterId: string,
    isAdmin: boolean,
    now: number,
  ): Promise<Record<string, unknown>> {
    const subRoute = segments[2];

    switch (subRoute) {
      case 'members':
        return this.getClusterMembersState(clusterId, now);
      case 'jobs':
        return this.getClusterJobsState(clusterId);
      case 'alerts':
        return this.getClusterAlertsState(clusterId);
      case 'events':
        return this.getClusterEventsState(clusterId);
      case 'audit':
        if (!isAdmin) return this.getMinimalState();
        return this.getClusterAuditState(clusterId);
      default:
        // /clusters/:id — main cluster dashboard
        return this.getClusterDashboardState(clusterId, now);
    }
  }

  private async getClusterDashboardState(
    clusterId: string,
    now: number,
  ): Promise<Record<string, unknown>> {
    const state = this.clusterStateStore.getClusterState(clusterId);
    if (!state) {
      return { _ssrTimestamp: now, cluster: null };
    }

    const from = now - RECENT_WINDOW_MS;
    const aggregates = await this.metricsRepo.queryAggregates(
      clusterId,
      null,
      '1m',
      from,
      now,
      TRANSFER_STATE_LIMIT,
    );

    return {
      _ssrTimestamp: now,
      cluster: serializeClusterDetail(state),
      recentAggregates: aggregates,
    };
  }

  private async getClusterMembersState(
    clusterId: string,
    now: number,
  ): Promise<Record<string, unknown>> {
    const state = this.clusterStateStore.getClusterState(clusterId);
    if (!state) {
      return { _ssrTimestamp: now, cluster: null, members: [] };
    }

    const from = now - RECENT_WINDOW_MS;
    const members: Record<string, unknown>[] = [];

    for (const [addr, member] of state.members) {
      const memberAggregates = await this.metricsRepo.queryAggregates(
        clusterId,
        addr,
        '1m',
        from,
        now,
        TRANSFER_STATE_LIMIT,
      );

      members.push({
        ...serializeMember(member),
        recentAggregates: memberAggregates,
      });
    }

    return {
      _ssrTimestamp: now,
      cluster: serializeClusterSummary(state),
      members,
    };
  }

  private async getClusterJobsState(
    clusterId: string,
  ): Promise<Record<string, unknown>> {
    const activeJobs = await this.jobsService.getActiveJobs(clusterId);

    return {
      _ssrTimestamp: nowMs(),
      activeJobs,
    };
  }

  private async getClusterAlertsState(
    clusterId: string,
  ): Promise<Record<string, unknown>> {
    const [activeAlerts, rules] = await Promise.all([
      this.queryActiveAlerts(clusterId),
      this.queryAlertRules(clusterId),
    ]);

    return {
      _ssrTimestamp: nowMs(),
      activeAlerts,
      alertRules: rules,
    };
  }

  private async getClusterEventsState(
    clusterId: string,
  ): Promise<Record<string, unknown>> {
    const events = await this.metricsRepo.querySystemEvents(
      clusterId,
      undefined,
      undefined,
      undefined,
      TRANSFER_STATE_LIMIT,
    );

    return {
      _ssrTimestamp: nowMs(),
      events: events.items,
    };
  }

  private async getClusterAuditState(
    clusterId: string,
  ): Promise<Record<string, unknown>> {
    const audit = await this.auditRepo.queryAuditLog(
      { clusterId },
      TRANSFER_STATE_LIMIT,
    );

    return {
      _ssrTimestamp: nowMs(),
      auditLog: audit.items,
    };
  }

  private async getUsersState(): Promise<Record<string, unknown>> {
    const users = await this.authRepo.listUsers(1, TRANSFER_STATE_LIMIT);

    // Strip password hashes from user list
    const sanitizedUsers = users.items.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      roles: u.roles,
      clusterScopes: u.clusterScopes,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    return {
      _ssrTimestamp: nowMs(),
      users: sanitizedUsers,
      userCount: users.total,
    };
  }

  private getSettingsState(user: User): Record<string, unknown> {
    return {
      _ssrTimestamp: nowMs(),
      currentUser: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        clusterScopes: user.clusterScopes,
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private isAuthRoute(segments: string[]): boolean {
    const authRoutes = new Set(['login', 'forgot-password', 'reset-password']);
    return segments.length >= 1 && authRoutes.has(segments[0]!);
  }

  private async queryActiveAlerts(clusterId: string): Promise<AlertHistoryRecord[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM alert_history
            WHERE cluster_id = ? AND resolved_at IS NULL
            ORDER BY fired_at DESC
            LIMIT ?`,
      args: [clusterId, TRANSFER_STATE_LIMIT],
    });

    return result.rows.map(rowToAlertHistory);
  }

  private async queryAlertRules(clusterId: string): Promise<AlertRule[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: 'SELECT * FROM alert_rules WHERE cluster_id = ? ORDER BY name ASC',
      args: [clusterId],
    });

    return result.rows.map(rowToAlertRule);
  }
}

// ── Serialization Helpers ─────────────────────────────────────────────────

/**
 * Serializes a ClusterState to a summary suitable for dashboard listings.
 * Converts the Map<string, MemberState> to a plain object for JSON transfer.
 */
function serializeClusterSummary(state: ClusterState): Record<string, unknown> {
  const connectedCount = countConnectedMonitorCapableMembers(state);

  return {
    clusterId: state.clusterId,
    clusterName: state.clusterName,
    clusterState: state.clusterState,
    clusterSize: state.clusterSize,
    connectedMembers: connectedCount,
    totalMembers: countMonitorCapableMembers(state),
    lastUpdated: state.lastUpdated,
    hasBlitz: state.blitz !== undefined,
  };
}

/**
 * Serializes a ClusterState with full member and partition details.
 */
function serializeClusterDetail(state: ClusterState): Record<string, unknown> {
  const members: Record<string, unknown>[] = [];

  for (const [, member] of state.members) {
    if (!isMonitorCapableMemberState(member)) {
      continue;
    }

    members.push(serializeMember(member));
  }

  return {
    clusterId: state.clusterId,
    clusterName: state.clusterName,
    clusterState: state.clusterState,
    clusterSize: state.clusterSize,
    members,
    distributedObjects: state.distributedObjects,
    partitions: {
      partitionCount: state.partitions.partitionCount,
      memberPartitions: state.partitions.memberPartitions,
    },
    blitz: state.blitz ?? null,
    mapStats: state.mapStats,
    queueStats: state.queueStats,
    topicStats: state.topicStats,
    lastUpdated: state.lastUpdated,
  };
}

/**
 * Serializes a MemberState to a plain object.
 * Strips the full recentSamples array (too large for transfer state)
 * and includes only the latest sample.
 */
function serializeMember(member: MemberState): Record<string, unknown> {
  return {
    address: member.address,
    restAddress: member.restAddress,
    connected: member.connected,
    lastSeen: member.lastSeen,
    latestSample: member.latestSample,
    info: member.info,
    error: member.error,
  };
}

// ── Row Mappers (duplicated locally to avoid circular imports) ─────────────

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
    scope: String(row['scope']) as AlertRule['scope'],
    stalenessWindowMs: Number(row['staleness_window_ms']),
    runbookUrl: row['runbook_url'] !== null ? String(row['runbook_url']) : undefined,
    actions,
    createdAt: Number(row['created_at']),
    updatedAt: Number(row['updated_at']),
  };
}
