/**
 * Manages job snapshot polling, persistence, and querying.
 *
 * Periodically fetches job data from all connected clusters via
 * ClusterConnectorService, serializes topology, and persists snapshots
 * to the database. Provides query methods for active jobs, job history
 * with cursor pagination, and single-job lookup.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { InValue } from '@libsql/client';
import { ClusterConnectorService } from '../connector/ClusterConnectorService.js';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { TursoConnectionFactory } from '../persistence/TursoConnectionFactory.js';
import { AsyncSerialQueue } from '../persistence/AsyncSerialQueue.js';
import { ConfigService } from '../config/ConfigService.js';
import { TopologySerializer } from './TopologySerializer.js';
import { nowMs } from '../shared/time.js';
import type { JobSnapshot, CursorPaginatedResult } from '../shared/types.js';

const JOB_POLL_INTERVAL_MS = 10_000;
const MS_PER_DAY = 86_400_000;

/** Statuses that indicate a job is still active. */
const ACTIVE_STATUSES = new Set(['RUNNING', 'STARTING', 'SUBMITTED', 'SUSPENDED']);

/** Statuses that indicate a job has reached a terminal state. */
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Tracks the last-known status per job to detect transitions to terminal state
   * and ensure final snapshots are stored.
   */
  private readonly lastKnownStatus = new Map<string, string>();

  constructor(
    private readonly connectorService: ClusterConnectorService,
    private readonly stateStore: ClusterStateStore,
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
    private readonly configService: ConfigService,
    private readonly topologySerializer: TopologySerializer,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Starting job polling');

    this.pollTimer = setInterval(() => {
      this.pollAllClusters().catch((err) => {
        this.logger.warn(`Job poll cycle failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, JOB_POLL_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.log('Job polling stopped');
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  /** Polls jobs from all connected clusters. */
  private async pollAllClusters(): Promise<void> {
    const allStates = this.stateStore.getAllClusterStates();

    for (const [clusterId] of allStates) {
      try {
        await this.fetchAndStoreJobs(clusterId);
      } catch (err) {
        this.logger.debug(
          `Failed to fetch jobs for cluster ${clusterId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Run retention cleanup periodically (piggyback on poll cycle)
    await this.deleteOldSnapshots().catch((err) => {
      this.logger.warn(`Job snapshot retention failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Fetches jobs from a cluster, serializes topology, and persists snapshots.
   * Detects job completion transitions to store final snapshots before
   * the cluster purges the data.
   */
  async fetchAndStoreJobs(clusterId: string): Promise<void> {
    const rawJobs = await this.connectorService.fetchJobs(clusterId);
    if (!rawJobs) return;

    const jobs = normalizeJobsResponse(rawJobs);
    if (jobs.length === 0) return;

    const now = nowMs();
    const snapshots: JobSnapshot[] = [];

    for (const job of jobs) {
      const jobId = String(job['id'] ?? job['jobId'] ?? '');
      const jobName = String(job['name'] ?? job['jobName'] ?? jobId);
      const status = String(job['status'] ?? 'UNKNOWN');
      const statusKey = `${clusterId}:${jobId}`;

      const previousStatus = this.lastKnownStatus.get(statusKey);
      this.lastKnownStatus.set(statusKey, status);

      // If transitioned to terminal, ensure we capture the final snapshot
      if (TERMINAL_STATUSES.has(status) && previousStatus && !TERMINAL_STATUSES.has(previousStatus)) {
        this.logger.log(`Job ${jobId} in cluster ${clusterId} transitioned to ${status}`);
      }

      const dag = job['dag'] as Record<string, unknown> | undefined;
      const vertices = job['vertices'] ?? dag?.['vertices'] ?? [];
      const edges = job['edges'] ?? dag?.['edges'] ?? [];
      const metrics = job['metrics'] ?? {};

      snapshots.push({
        clusterId,
        jobId,
        jobName,
        status,
        timestamp: now,
        executionStartTime: toTimestampOrNull(job['executionStartTime'] ?? job['startTime']),
        completionTime: toTimestampOrNull(job['completionTime'] ?? job['endTime']),
        metricsJson: JSON.stringify(metrics),
        verticesJson: this.topologySerializer.serializeVertices(vertices),
        edgesJson: this.topologySerializer.serializeEdges(edges),
      });
    }

    if (snapshots.length > 0) {
      await this.insertSnapshots(snapshots);
      this.eventEmitter.emit('jobs.received', { clusterId, count: snapshots.length });
    }

    // Clean up status tracking for jobs that are terminal and have been stored
    for (const [key, status] of this.lastKnownStatus) {
      if (key.startsWith(`${clusterId}:`) && TERMINAL_STATUSES.has(status)) {
        // Keep terminal entries for one more poll cycle, then remove
        // to prevent unbounded growth. We mark them with a deletion flag.
        const jobId = key.slice(clusterId.length + 1);
        const stillPresent = jobs.some(
          (j) => String(j['id'] ?? j['jobId'] ?? '') === jobId,
        );
        if (!stillPresent) {
          this.lastKnownStatus.delete(key);
        }
      }
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /**
   * Returns the latest snapshot for each active (non-terminal) job in a cluster.
   * Uses a subquery to find the max timestamp per job, then joins to get full rows.
   */
  async getActiveJobs(clusterId: string): Promise<JobSnapshot[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT js.* FROM job_snapshots js
            INNER JOIN (
              SELECT job_id, MAX(timestamp) AS max_ts
              FROM job_snapshots
              WHERE cluster_id = ?
              GROUP BY job_id
            ) latest ON js.job_id = latest.job_id AND js.timestamp = latest.max_ts
            WHERE js.cluster_id = ? AND js.status IN ('RUNNING', 'STARTING', 'SUBMITTED', 'SUSPENDED')
            ORDER BY js.timestamp DESC`,
      args: [clusterId, clusterId],
    });

    return result.rows.map(rowToJobSnapshot);
  }

  /**
   * Returns paginated snapshot history for a specific job, ordered by
   * timestamp descending. Uses cursor-based pagination via the snapshot id.
   */
  async getJobHistory(
    clusterId: string,
    jobId: string,
    limit = 50,
    cursor?: string,
  ): Promise<CursorPaginatedResult<JobSnapshot>> {
    const client = await this.connectionFactory.getClient();
    const conditions = ['cluster_id = ?', 'job_id = ?'];
    const args: InValue[] = [clusterId, jobId];

    if (cursor) {
      conditions.push('id < ?');
      args.push(parseInt(cursor, 10));
    }

    args.push(limit + 1);

    const result = await client.execute({
      sql: `SELECT * FROM job_snapshots
            WHERE ${conditions.join(' AND ')}
            ORDER BY id DESC
            LIMIT ?`,
      args,
    });

    const rows = result.rows.map(rowToJobSnapshot);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? String(items[items.length - 1]!.id) : null;

    return { items, nextCursor };
  }

  /** Returns the most recent snapshot for a specific job, or null if not found. */
  async getJobById(clusterId: string, jobId: string): Promise<JobSnapshot | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM job_snapshots
            WHERE cluster_id = ? AND job_id = ?
            ORDER BY timestamp DESC
            LIMIT 1`,
      args: [clusterId, jobId],
    });

    if (result.rows.length === 0) return null;
    return rowToJobSnapshot(result.rows[0]!);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private async insertSnapshots(snapshots: JobSnapshot[]): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const stmts = snapshots.map((s) => ({
        sql: `INSERT INTO job_snapshots (
          cluster_id, job_id, job_name, status, timestamp,
          execution_start_time, completion_time,
          metrics_json, vertices_json, edges_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          s.clusterId,
          s.jobId,
          s.jobName,
          s.status,
          s.timestamp,
          s.executionStartTime,
          s.completionTime,
          s.metricsJson,
          s.verticesJson,
          s.edgesJson,
        ] as InValue[],
      }));

      await client.batch(stmts, 'write');
    });
  }

  /** Deletes job snapshots older than the configured retention period. */
  private async deleteOldSnapshots(): Promise<void> {
    const retentionDays = this.configService.retentionJobDays;
    const cutoff = nowMs() - retentionDays * MS_PER_DAY;

    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM job_snapshots WHERE timestamp < ?',
        args: [cutoff],
      });

      const deleted = Number(result.rowsAffected);
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} old job snapshots (retention: ${retentionDays}d)`);
      }
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Normalizes the raw jobs response from the REST API into an array of job records. */
function normalizeJobsResponse(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw as Array<Record<string, unknown>>;
  }

  const obj = raw as Record<string, unknown>;

  // Some members return { jobs: [...] }
  if (Array.isArray(obj['jobs'])) {
    return obj['jobs'] as Array<Record<string, unknown>>;
  }

  // Single job object
  if (obj['id'] || obj['jobId']) {
    return [obj];
  }

  return [];
}

function toTimestampOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function rowToJobSnapshot(row: Record<string, unknown>): JobSnapshot {
  return {
    id: row['id'] === null || row['id'] === undefined ? undefined : Number(row['id']),
    clusterId: String(row['cluster_id']),
    jobId: String(row['job_id']),
    jobName: String(row['job_name']),
    status: String(row['status']),
    timestamp: Number(row['timestamp']),
    executionStartTime: row['execution_start_time'] === null ? null : Number(row['execution_start_time']),
    completionTime: row['completion_time'] === null ? null : Number(row['completion_time']),
    metricsJson: String(row['metrics_json']),
    verticesJson: String(row['vertices_json']),
    edgesJson: String(row['edges_json']),
  };
}
