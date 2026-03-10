import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// ── Shared API types ─────────────────────────────────────────────────────────

export interface CursorPaginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OffsetPaginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ClusterSummary {
  clusterId: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  connectedMembers: number;
  totalMembers: number;
  lastUpdated: number;
  hasBlitz: boolean;
}

export interface ClusterDetail {
  clusterId: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  members: MemberSummary[];
  distributedObjects: DistributedObject[];
  partitions: PartitionInfo;
  blitz: BlitzInfo | null;
  mapStats: Record<string, unknown>;
  queueStats: Record<string, unknown>;
  topicStats: Record<string, unknown>;
  lastUpdated: number;
}

export interface MemberSummary {
  address: string;
  restAddress: string;
  connected: boolean;
  lastSeen: number;
  latestSample: MemberMetricsSample | null;
  info: MemberInfo | null;
  error: string | null;
}

export interface MemberInfo {
  address: string;
  monitorCapable?: boolean;
  adminCapable?: boolean;
  liteMember: boolean;
  localMember: boolean;
  uuid: string;
  memberVersion: string;
}

export interface MemberMetricsSample {
  timestamp: number;
  eventLoop: { meanMs: number; p50Ms: number; p99Ms: number; maxMs: number };
  cpu: { userMicroseconds: number; systemMicroseconds: number; percentUsed: number };
  memory: { heapUsed: number; heapTotal: number; rss: number; external: number; arrayBuffers: number };
  transport: { bytesRead: number; bytesWritten: number; openChannels: number; connectedPeers: number };
  threads: { activeCount: number; poolSize: number };
  migration: { migrationQueueSize: number; activeMigrations: number; completedMigrations: number };
  operation: { queueSize: number; runningCount: number; completedCount: number };
  invocation: { pendingCount: number; usedPercentage: number; timeoutFailures: number; memberLeftFailures: number };
  gc?: { usedHeapSize: number; totalHeapSize: number; heapSizeLimit: number };
  blitz?: { runningPipelines: number; jobCounters: { submitted: number; executionsStarted: number; completedSuccessfully: number; completedWithFailure: number } };
}

export interface DistributedObject {
  serviceName: string;
  name: string;
}

export interface PartitionInfo {
  partitionCount: number;
  memberPartitions: Record<string, MemberPartitionInfo>;
}

export interface MemberPartitionInfo {
  address: string;
  primaryPartitions: number[];
  backupPartitions: number[];
}

export interface BlitzInfo {
  clusterSize: number;
  readiness: string;
  runningPipelines: number;
  jetStreamConnected: boolean;
  jobCounters?: { submitted: number; executionsStarted: number; completedSuccessfully: number; completedWithFailure: number };
}

export interface MetricAggregate {
  id?: number;
  clusterId: string;
  memberAddr: string;
  resolution: string;
  bucketStart: number;
  sampleCount: number;
  cpuPercentAvg: number | null;
  cpuPercentMax: number | null;
  heapUsedAvg: number | null;
  heapUsedMax: number | null;
  elP99Avg: number | null;
  elP99Max: number | null;
  bytesReadDelta: number | null;
  bytesWrittenDelta: number | null;
  opCompletedDelta: number | null;
  migrationCompletedDelta: number | null;
  invTimeoutFailuresDelta: number | null;
  blitzJobsFailedDelta: number | null;
}

export interface AlertRule {
  id: string;
  clusterId: string;
  name: string;
  severity: 'warning' | 'critical';
  enabled: boolean;
  metric: string;
  operator: string;
  threshold: number;
  durationSec: number;
  cooldownSec: number;
  deltaMode: boolean;
  scope: string;
  stalenessWindowMs: number;
  runbookUrl?: string;
  actions: AlertAction[];
  createdAt: number;
  updatedAt: number;
}

export type AlertAction =
  | { type: 'email'; to: string[]; subjectTemplate: string; bodyTemplate: string }
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT'; headers?: Record<string, string>; bodyTemplate: string };

export interface AlertHistoryRecord {
  id?: number;
  ruleId: string | null;
  clusterId: string;
  memberAddr: string | null;
  firedAt: number;
  resolvedAt: number | null;
  severity: 'warning' | 'critical';
  message: string;
  metricValue: number;
  threshold: number;
}

export interface SystemEvent {
  id?: number;
  clusterId: string;
  memberAddr: string;
  timestamp: number;
  eventType: string;
  message: string;
  detailsJson: string | null;
}

export interface AuditLogEntry {
  id?: number;
  actorUserId: string | null;
  actionType: string;
  clusterId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  detailsJson: string;
  createdAt: number;
}

export interface JobSnapshot {
  id?: number;
  clusterId: string;
  jobId: string;
  jobName: string;
  status: string;
  timestamp: number;
  executionStartTime: number | null;
  completionTime: number | null;
  metricsJson: string;
  verticesJson: string;
  edgesJson: string;
}

export interface McUserAdmin {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  roles: Array<'viewer' | 'operator' | 'admin'>;
  clusterScopes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ClusterConfig {
  id: string;
  displayName: string;
  memberAddresses: string[];
  restPort: number;
  sslEnabled: boolean;
  authToken?: string;
  autoDiscover: boolean;
  requestTimeoutMs: number;
  stalenessWindowMs: number;
}

export interface SelfMetrics {
  processCpuPercent: number;
  processMemoryMb: number;
  activeHttpRequests: number;
  activeWsSessions: number;
  connectedSseStreams: Record<string, number>;
  reconnectAttempts: Record<string, number>;
  writeBatcherBufferDepth: number;
  asyncWriteQueueDepth: number;
  notificationAttempts: number;
  notificationFailures: number;
  circuitBreakerState: 'closed' | 'open' | 'half_open';
  ssrRenderDurationMs: number;
  ssrRenderFailures: number;
  authLoginFailures: number;
  passwordResetRequests: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * REST API client for all Management Center backend endpoints.
 * All methods return Promises backed by Angular HttpClient.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  // ── Clusters ───────────────────────────────────────────────────────────

  getClusters(): Promise<ClusterSummary[]> {
    return firstValueFrom(this.http.get<ClusterSummary[]>('/api/clusters'));
  }

  createCluster(config: ClusterConfig): Promise<ClusterConfig> {
    return firstValueFrom(this.http.post<ClusterConfig>('/api/clusters', config));
  }

  updateCluster(id: string, config: Partial<ClusterConfig>): Promise<ClusterConfig> {
    return firstValueFrom(this.http.put<ClusterConfig>(`/api/clusters/${enc(id)}`, config));
  }

  deleteCluster(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/clusters/${enc(id)}`));
  }

  getClusterSummary(clusterId: string): Promise<ClusterDetail> {
    return firstValueFrom(this.http.get<ClusterDetail>(`/api/clusters/${enc(clusterId)}/summary`));
  }

  getClusterMembers(clusterId: string): Promise<MemberSummary[]> {
    return firstValueFrom(this.http.get<MemberSummary[]>(`/api/clusters/${enc(clusterId)}/members`));
  }

  getClusterEvents(
    clusterId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPaginated<SystemEvent>> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit) params = params.set('limit', String(limit));
    return firstValueFrom(
      this.http.get<CursorPaginated<SystemEvent>>(`/api/clusters/${enc(clusterId)}/events`, { params }),
    );
  }

  getClusterConfig(clusterId: string): Promise<Record<string, unknown>> {
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`/api/clusters/${enc(clusterId)}/config`),
    );
  }

  getClusterJobs(clusterId: string): Promise<JobSnapshot[]> {
    return firstValueFrom(
      this.http.get<{ jobs: JobSnapshot[] }>(`/api/clusters/${enc(clusterId)}/jobs`),
    ).then(response => response.jobs);
  }

  // ── Metrics & History ──────────────────────────────────────────────────

  getMetricsHistory(params: {
    clusterId: string;
    memberAddr?: string;
    resolution?: string;
    from: number;
    to: number;
    limit?: number;
  }): Promise<MetricAggregate[]> {
    let httpParams = new HttpParams()
      .set('clusterId', params.clusterId)
      .set('from', String(params.from))
      .set('to', String(params.to));
    if (params.memberAddr) httpParams = httpParams.set('memberAddr', params.memberAddr);
    if (params.resolution) httpParams = httpParams.set('resolution', params.resolution);
    if (params.limit) httpParams = httpParams.set('limit', String(params.limit));
    return firstValueFrom(
      this.http.get<MetricAggregate[]>('/api/metrics/history', { params: httpParams }),
    );
  }

  getMapHistory(name: string, params?: { from?: number; to?: number }): Promise<unknown[]> {
    let httpParams = new HttpParams();
    if (params?.from) httpParams = httpParams.set('from', String(params.from));
    if (params?.to) httpParams = httpParams.set('to', String(params.to));
    return firstValueFrom(this.http.get<unknown[]>(`/api/maps/${enc(name)}/history`, { params: httpParams }));
  }

  getQueueHistory(name: string, params?: { from?: number; to?: number }): Promise<unknown[]> {
    let httpParams = new HttpParams();
    if (params?.from) httpParams = httpParams.set('from', String(params.from));
    if (params?.to) httpParams = httpParams.set('to', String(params.to));
    return firstValueFrom(this.http.get<unknown[]>(`/api/queues/${enc(name)}/history`, { params: httpParams }));
  }

  getTopicHistory(name: string, params?: { from?: number; to?: number }): Promise<unknown[]> {
    let httpParams = new HttpParams();
    if (params?.from) httpParams = httpParams.set('from', String(params.from));
    if (params?.to) httpParams = httpParams.set('to', String(params.to));
    return firstValueFrom(this.http.get<unknown[]>(`/api/topics/${enc(name)}/history`, { params: httpParams }));
  }

  getJobHistory(jobId: string, params?: { from?: number; to?: number }): Promise<unknown[]> {
    let httpParams = new HttpParams();
    if (params?.from) httpParams = httpParams.set('from', String(params.from));
    if (params?.to) httpParams = httpParams.set('to', String(params.to));
    return firstValueFrom(this.http.get<unknown[]>(`/api/jobs/${enc(jobId)}/history`, { params: httpParams }));
  }

  // ── Alerts ─────────────────────────────────────────────────────────────

  getAlertRules(clusterId?: string): Promise<AlertRule[]> {
    let params = new HttpParams();
    if (clusterId) params = params.set('clusterId', clusterId);
    return firstValueFrom(this.http.get<AlertRule[]>('/api/alerts/rules', { params }));
  }

  createAlertRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<AlertRule> {
    return firstValueFrom(this.http.post<AlertRule>('/api/alerts/rules', rule));
  }

  updateAlertRule(id: string, rule: Partial<AlertRule>): Promise<AlertRule> {
    return firstValueFrom(this.http.put<AlertRule>(`/api/alerts/rules/${enc(id)}`, rule));
  }

  deleteAlertRule(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/alerts/rules/${enc(id)}`));
  }

  getActiveAlerts(clusterId?: string): Promise<AlertHistoryRecord[]> {
    let params = new HttpParams();
    if (clusterId) params = params.set('clusterId', clusterId);
    return firstValueFrom(this.http.get<AlertHistoryRecord[]>('/api/alerts/active', { params }));
  }

  getAlertHistory(
    cursor?: string,
    limit?: number,
    clusterId?: string,
  ): Promise<CursorPaginated<AlertHistoryRecord>> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit) params = params.set('limit', String(limit));
    if (clusterId) params = params.set('clusterId', clusterId);
    return firstValueFrom(
      this.http.get<CursorPaginated<AlertHistoryRecord>>('/api/alerts/history', { params }),
    );
  }

  acknowledgeAlert(id: number): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/alerts/${id}/acknowledge`, {}));
  }

  // ── Users ──────────────────────────────────────────────────────────────

  getUsers(page?: number, pageSize?: number): Promise<OffsetPaginated<McUserAdmin>> {
    let params = new HttpParams();
    if (page) params = params.set('page', String(page));
    if (pageSize) params = params.set('pageSize', String(pageSize));
    return firstValueFrom(this.http.get<OffsetPaginated<McUserAdmin>>('/api/users', { params }));
  }

  createUser(user: {
    email: string;
    displayName: string;
    password: string;
    roles: string[];
    clusterScopes: string[];
  }): Promise<McUserAdmin> {
    return firstValueFrom(this.http.post<McUserAdmin>('/api/users', user));
  }

  updateUser(id: string, updates: Partial<McUserAdmin>): Promise<McUserAdmin> {
    return firstValueFrom(this.http.put<McUserAdmin>(`/api/users/${enc(id)}`, updates));
  }

  resetUserPassword(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/users/${enc(id)}/reset-password`, {}));
  }

  // ── Settings ───────────────────────────────────────────────────────────

  updateNotificationSettings(settings: Record<string, unknown>): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/settings/notifications', settings));
  }

  updateSecuritySettings(settings: Record<string, unknown>): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/settings/security', settings));
  }

  testSmtp(config: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<{ success: boolean; error?: string }>('/api/settings/test-smtp', config),
    );
  }

  testWebhook(config: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<{ success: boolean; error?: string }>('/api/settings/test-webhook', config),
    );
  }

  // ── Audit ──────────────────────────────────────────────────────────────

  getAuditLog(
    cursor?: string,
    limit?: number,
    filters?: { clusterId?: string; userId?: string },
  ): Promise<CursorPaginated<AuditLogEntry>> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit) params = params.set('limit', String(limit));
    if (filters?.clusterId) params = params.set('clusterId', filters.clusterId);
    if (filters?.userId) params = params.set('userId', filters.userId);
    return firstValueFrom(
      this.http.get<CursorPaginated<AuditLogEntry>>('/api/audit', { params }),
    );
  }

  getAuditEntry(id: number): Promise<AuditLogEntry> {
    return firstValueFrom(this.http.get<AuditLogEntry>(`/api/audit/${id}`));
  }

  // ── Admin Actions ──────────────────────────────────────────────────────

  setClusterState(
    clusterId: string,
    state: 'ACTIVE' | 'PASSIVE' | 'FROZEN',
  ): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>('/api/admin/cluster-state', { clusterId, state }),
    );
  }

  cancelJob(jobId: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`/api/admin/jobs/${enc(jobId)}/cancel`, {}),
    );
  }

  restartJob(jobId: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`/api/admin/jobs/${enc(jobId)}/restart`, {}),
    );
  }

  clearMap(name: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`/api/admin/maps/${enc(name)}/clear`, {}),
    );
  }

  evictMap(name: string): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>(`/api/admin/maps/${enc(name)}/evict`, {}),
    );
  }

  triggerGc(): Promise<{ success: boolean }> {
    return firstValueFrom(
      this.http.post<{ success: boolean }>('/api/admin/gc', {}),
    );
  }

  // ── System ─────────────────────────────────────────────────────────────

  getSelfMetrics(): Promise<SelfMetrics> {
    return firstValueFrom(this.http.get<SelfMetrics>('/api/system/self-metrics'));
  }
}

/** URI-encode a path segment. */
function enc(value: string): string {
  return encodeURIComponent(value);
}
