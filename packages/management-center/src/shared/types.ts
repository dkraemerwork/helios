/**
 * Shared type definitions for the Helios Management Center.
 *
 * All domain models, protocol types, and shared interfaces are defined here
 * to ensure consistency across the backend modules.
 */

// ── User & Session ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  roles: Array<'viewer' | 'operator' | 'admin'>;
  clusterScopes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  refreshHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: number;
  expiresAt: number;
  refreshedAt: number;
  revokedAt: number | null;
}

// ── Cluster ─────────────────────────────────────────────────────────────────

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

export interface ClusterRecord {
  id: string;
  displayName: string;
  configJson: string;
  createdAt: number;
  updatedAt: number;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricSample {
  id?: number;
  clusterId: string;
  memberAddr: string;
  timestamp: number;
  elMeanMs: number | null;
  elP50Ms: number | null;
  elP99Ms: number | null;
  elMaxMs: number | null;
  heapUsed: number | null;
  heapTotal: number | null;
  rss: number | null;
  cpuPercent: number | null;
  bytesRead: number | null;
  bytesWritten: number | null;
  migrationCompleted: number | null;
  opCompleted: number | null;
  invTimeoutFailures: number | null;
  invMemberLeftFailures: number | null;
  blitzJobsSubmitted: number | null;
  blitzJobsSucceeded: number | null;
  blitzJobsFailed: number | null;
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

// ── Alerts ──────────────────────────────────────────────────────────────────

export type MetricPath =
  | 'cpu.percentUsed'
  | 'memory.heapUsed'
  | 'memory.heapTotal'
  | 'memory.heapUsedPercent'
  | 'memory.rss'
  | 'eventLoop.p99Ms'
  | 'eventLoop.maxMs'
  | 'transport.bytesRead'
  | 'transport.bytesWritten'
  | 'migration.migrationQueueSize'
  | 'migration.activeMigrations'
  | 'migration.completedMigrations'
  | 'operation.queueSize'
  | 'operation.completedCount'
  | 'invocation.pendingCount'
  | 'invocation.usedPercentage'
  | 'invocation.timeoutFailures'
  | 'invocation.memberLeftFailures'
  | 'blitz.runningPipelines'
  | 'blitz.jobCounters.submitted'
  | 'blitz.jobCounters.completedSuccessfully'
  | 'blitz.jobCounters.completedWithFailure';

export type AlertOperator = '>' | '>=' | '<' | '<=' | '==';
export type AlertSeverity = 'warning' | 'critical';
export type AlertScope = 'any_member' | 'all_members' | 'cluster_aggregate';

export type AlertAction =
  | { type: 'email'; to: string[]; subjectTemplate: string; bodyTemplate: string }
  | { type: 'webhook'; url: string; method: 'POST' | 'PUT'; headers?: Record<string, string>; bodyTemplate: string };

export interface AlertRule {
  id: string;
  clusterId: string;
  name: string;
  severity: AlertSeverity;
  enabled: boolean;
  metric: MetricPath;
  operator: AlertOperator;
  threshold: number;
  durationSec: number;
  cooldownSec: number;
  deltaMode: boolean;
  scope: AlertScope;
  stalenessWindowMs: number;
  runbookUrl?: string;
  actions: AlertAction[];
  createdAt: number;
  updatedAt: number;
}

export interface AlertHistoryRecord {
  id?: number;
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
}

export interface NotificationDelivery {
  id?: number;
  alertHistoryId: number;
  channelType: string;
  destination: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'dead_letter' | 'suppressed_rate_limit';
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
  sentAt: number | null;
  createdAt: number;
}

// ── System Events ───────────────────────────────────────────────────────────

export interface SystemEvent {
  id?: number;
  clusterId: string;
  memberAddr: string;
  timestamp: number;
  eventType: string;
  message: string;
  detailsJson: string | null;
}

// ── Jobs ────────────────────────────────────────────────────────────────────

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

// ── Audit ───────────────────────────────────────────────────────────────────

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

// ── Password Reset ──────────────────────────────────────────────────────────

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

// ── SSE Types (from Helios members) ─────────────────────────────────────────

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

// ── Monitor Payload (from Helios member SSE) ────────────────────────────────

export interface MonitorPayload {
  instanceName: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  members: MemberInfo[];
  partitions: PartitionInfo;
  distributedObjects: DistributedObjectInfo[];
  samples: unknown[];
  blitz?: BlitzInfo;
  mapStats?: Record<string, unknown>;
  queueStats?: Record<string, unknown>;
  topicStats?: Record<string, unknown>;
  mapStoreLatency?: unknown;
  systemEvents?: unknown[];
}

export interface MemberInfo {
  address: string;
  /** REST port advertised by the member (0 = unknown / not reported). */
  restPort: number;
  /** Authoritative REST base URL advertised by the member, when known. */
  restAddress: string | null;
  liteMember: boolean;
  localMember: boolean;
  uuid: string;
  memberVersion: string;
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

export interface DistributedObjectInfo {
  serviceName: string;
  name: string;
}

export interface BlitzInfo {
  clusterSize: number;
  readiness: string;
  runningPipelines: number;
  jetStreamConnected: boolean;
  jobCounters?: {
    submitted: number;
    executionsStarted: number;
    completedSuccessfully: number;
    completedWithFailure: number;
  };
}

// ── Member Metrics Sample ───────────────────────────────────────────────────

export interface MemberMetricsSample {
  timestamp: number;
  eventLoop: {
    meanMs: number;
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  cpu: {
    userMicroseconds: number;
    systemMicroseconds: number;
    percentUsed: number;
  };
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    arrayBuffers: number;
  };
  transport: {
    bytesRead: number;
    bytesWritten: number;
    openChannels: number;
    connectedPeers: number;
  };
  threads: {
    activeCount: number;
    poolSize: number;
  };
  migration: {
    migrationQueueSize: number;
    activeMigrations: number;
    completedMigrations: number;
  };
  operation: {
    queueSize: number;
    runningCount: number;
    completedCount: number;
  };
  invocation: {
    pendingCount: number;
    usedPercentage: number;
    timeoutFailures: number;
    memberLeftFailures: number;
  };
  gc?: {
    usedHeapSize: number;
    totalHeapSize: number;
    heapSizeLimit: number;
  };
  blitz?: {
    runningPipelines: number;
    jobCounters: {
      submitted: number;
      executionsStarted: number;
      completedSuccessfully: number;
      completedWithFailure: number;
    };
  };
}

// ── In-Memory Cluster State ─────────────────────────────────────────────────

export interface ClusterState {
  clusterId: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  members: Map<string, MemberState>;
  distributedObjects: DistributedObjectInfo[];
  partitions: PartitionInfo;
  blitz?: BlitzInfo;
  mapStats: Record<string, unknown>;
  queueStats: Record<string, unknown>;
  topicStats: Record<string, unknown>;
  lastUpdated: number;
}

export interface MemberState {
  address: string;
  restAddress: string;
  connected: boolean;
  lastSeen: number;
  latestSample: MemberMetricsSample | null;
  recentSamples: MemberMetricsSample[];
  info: MemberInfo | null;
  error: string | null;
}

// ── Connector Events ────────────────────────────────────────────────────────

export type ConnectorEventType =
  | 'member.connected'
  | 'member.disconnected'
  | 'sample.received'
  | 'payload.received'
  | 'jobs.received'
  | 'cluster.stateChanged'
  | 'admin.action.completed'
  | 'alert.fired'
  | 'alert.resolved';

// ── WebSocket Protocol ──────────────────────────────────────────────────────

export type ClientMessageEvent = 'subscribe' | 'unsubscribe' | 'query:history';

export interface WsSubscribeData {
  clusterId: string;
  scope?: 'all' | string;
}

export interface WsUnsubscribeData {
  clusterId: string;
}

export interface WsHistoryQueryData {
  requestId: string;
  clusterId: string;
  memberAddr: string | null;
  from: number;
  to: number;
  maxPoints: number;
}

export type ClientMessage =
  | { event: 'subscribe'; data: WsSubscribeData }
  | { event: 'unsubscribe'; data: WsUnsubscribeData }
  | { event: 'query:history'; data: WsHistoryQueryData };

export type ServerMessageEvent =
  | 'cluster:update'
  | 'member:sample'
  | 'data:update'
  | 'jobs:update'
  | 'alert:fired'
  | 'alert:resolved'
  | 'history:result'
  | 'admin:result'
  | 'ws:ping';

// ── Pagination ──────────────────────────────────────────────────────────────

export interface CursorPaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OffsetPaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ── Self Metrics ────────────────────────────────────────────────────────────

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

// ── Alert Template Context ──────────────────────────────────────────────────

export interface AlertTemplateContext {
  'alert.id': string;
  'alert.name': string;
  'alert.severity': string;
  'alert.clusterId': string;
  'alert.memberAddr': string;
  'alert.metric': string;
  'alert.metricValue': string;
  'alert.threshold': string;
  'alert.operator': string;
  'alert.scope': string;
  'alert.firedAtIso': string;
  'alert.resolvedAtIso': string;
  'alert.message': string;
  'alert.runbookUrl': string;
}
