/**
 * Repository for metric samples, aggregates, and system events.
 *
 * All reads go directly through TursoConnectionFactory. All writes are
 * serialized through AsyncSerialQueue to prevent SQLITE_BUSY errors.
 * Cursor-based pagination is used for system events to enable efficient
 * forward-only traversal of large result sets.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { InValue } from '@libsql/client';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { AsyncSerialQueue } from './AsyncSerialQueue.js';
import type {
  MetricSample,
  MetricAggregate,
  SystemEvent,
  CursorPaginatedResult,
} from '../shared/types.js';

@Injectable()
export class MetricsRepository {
  private readonly logger = new Logger(MetricsRepository.name);

  constructor(
    private readonly connectionFactory: TursoConnectionFactory,
    private readonly queue: AsyncSerialQueue,
  ) {}

  // ── Metric Samples ──────────────────────────────────────────────────────

  async insertSamples(samples: MetricSample[]): Promise<void> {
    if (samples.length === 0) return;

    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const stmts = samples.map((s) => ({
        sql: `INSERT INTO metric_samples (
          cluster_id, member_addr, timestamp,
          el_mean_ms, el_p50_ms, el_p99_ms, el_max_ms,
          heap_used, heap_total, rss, cpu_percent,
          bytes_read, bytes_written,
          migration_completed, op_completed,
          inv_timeout_failures, inv_member_left_failures,
          blitz_jobs_submitted, blitz_jobs_succeeded, blitz_jobs_failed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          s.clusterId,
          s.memberAddr,
          s.timestamp,
          s.elMeanMs,
          s.elP50Ms,
          s.elP99Ms,
          s.elMaxMs,
          s.heapUsed,
          s.heapTotal,
          s.rss,
          s.cpuPercent,
          s.bytesRead,
          s.bytesWritten,
          s.migrationCompleted,
          s.opCompleted,
          s.invTimeoutFailures,
          s.invMemberLeftFailures,
          s.blitzJobsSubmitted,
          s.blitzJobsSucceeded,
          s.blitzJobsFailed,
        ],
      }));

      await client.batch(stmts, 'write');
    });
  }

  async querySamples(
    clusterId: string,
    memberAddr: string | null,
    from: number,
    to: number,
    limit: number,
  ): Promise<MetricSample[]> {
    const client = await this.connectionFactory.getClient();
    const args: InValue[] = [clusterId];
    let memberClause = '';

    if (memberAddr) {
      memberClause = ' AND member_addr = ?';
      args.push(memberAddr);
    }

    args.push(from, to, limit);

    const result = await client.execute({
      sql: `SELECT * FROM metric_samples
            WHERE cluster_id = ?${memberClause}
              AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp DESC
            LIMIT ?`,
      args,
    });

    return result.rows.map(rowToSample);
  }

  // ── Metric Aggregates ───────────────────────────────────────────────────

  async insertAggregate(agg: MetricAggregate): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT INTO metric_aggregates (
          cluster_id, member_addr, resolution, bucket_start, sample_count,
          cpu_percent_avg, cpu_percent_max,
          heap_used_avg, heap_used_max,
          el_p99_avg, el_p99_max,
          bytes_read_delta, bytes_written_delta,
          op_completed_delta, migration_completed_delta,
          inv_timeout_failures_delta, blitz_jobs_failed_delta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (cluster_id, member_addr, resolution, bucket_start)
        DO UPDATE SET
          sample_count = excluded.sample_count,
          cpu_percent_avg = excluded.cpu_percent_avg,
          cpu_percent_max = excluded.cpu_percent_max,
          heap_used_avg = excluded.heap_used_avg,
          heap_used_max = excluded.heap_used_max,
          el_p99_avg = excluded.el_p99_avg,
          el_p99_max = excluded.el_p99_max,
          bytes_read_delta = excluded.bytes_read_delta,
          bytes_written_delta = excluded.bytes_written_delta,
          op_completed_delta = excluded.op_completed_delta,
          migration_completed_delta = excluded.migration_completed_delta,
          inv_timeout_failures_delta = excluded.inv_timeout_failures_delta,
          blitz_jobs_failed_delta = excluded.blitz_jobs_failed_delta`,
        args: [
          agg.clusterId,
          agg.memberAddr,
          agg.resolution,
          agg.bucketStart,
          agg.sampleCount,
          agg.cpuPercentAvg,
          agg.cpuPercentMax,
          agg.heapUsedAvg,
          agg.heapUsedMax,
          agg.elP99Avg,
          agg.elP99Max,
          agg.bytesReadDelta,
          agg.bytesWrittenDelta,
          agg.opCompletedDelta,
          agg.migrationCompletedDelta,
          agg.invTimeoutFailuresDelta,
          agg.blitzJobsFailedDelta,
        ],
      });
    });
  }

  async queryAggregates(
    clusterId: string,
    memberAddr: string | null,
    resolution: string,
    from: number,
    to: number,
    limit: number,
  ): Promise<MetricAggregate[]> {
    const client = await this.connectionFactory.getClient();
    const args: InValue[] = [clusterId];
    let memberClause = '';

    if (memberAddr) {
      memberClause = ' AND member_addr = ?';
      args.push(memberAddr);
    }

    args.push(resolution, from, to, limit);

    const result = await client.execute({
      sql: `SELECT * FROM metric_aggregates
            WHERE cluster_id = ?${memberClause}
              AND resolution = ?
              AND bucket_start >= ? AND bucket_start <= ?
            ORDER BY bucket_start DESC
            LIMIT ?`,
      args,
    });

    return result.rows.map(rowToAggregate);
  }

  async deleteOldSamples(olderThanMs: number): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM metric_samples WHERE timestamp < ?',
        args: [olderThanMs],
      });
      return Number(result.rowsAffected);
    });
  }

  async deleteOldAggregates(resolution: string, olderThanMs: number): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM metric_aggregates WHERE resolution = ? AND bucket_start < ?',
        args: [resolution, olderThanMs],
      });
      return Number(result.rowsAffected);
    });
  }

  /** Returns the most recent bucket_start for a given cluster/member/resolution. */
  async getLatestBucketStart(
    clusterId: string,
    memberAddr: string,
    resolution: string,
  ): Promise<number | null> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT MAX(bucket_start) as max_bucket
            FROM metric_aggregates
            WHERE cluster_id = ? AND member_addr = ? AND resolution = ?`,
      args: [clusterId, memberAddr, resolution],
    });

    const row = result.rows[0];
    if (!row || row['max_bucket'] === null) return null;
    return Number(row['max_bucket']);
  }

  /** Retrieves raw samples in a time range for aggregation. */
  async getSamplesForAggregation(
    clusterId: string,
    memberAddr: string,
    from: number,
    to: number,
  ): Promise<MetricSample[]> {
    const client = await this.connectionFactory.getClient();
    const result = await client.execute({
      sql: `SELECT * FROM metric_samples
            WHERE cluster_id = ? AND member_addr = ?
              AND timestamp >= ? AND timestamp < ?
            ORDER BY timestamp ASC`,
      args: [clusterId, memberAddr, from, to],
    });

    return result.rows.map(rowToSample);
  }

  // ── System Events ─────────────────────────────────────────────────────

  async insertSystemEvent(event: SystemEvent): Promise<void> {
    await this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      await client.execute({
        sql: `INSERT OR IGNORE INTO system_events (
          cluster_id, member_addr, timestamp, event_type, message, details_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          event.clusterId,
          event.memberAddr,
          event.timestamp,
          event.eventType,
          event.message,
          event.detailsJson,
        ],
      });
    });
  }

  async querySystemEvents(
    clusterId: string,
    from?: number,
    to?: number,
    eventType?: string,
    limit = 100,
    cursor?: string,
  ): Promise<CursorPaginatedResult<SystemEvent>> {
    const client = await this.connectionFactory.getClient();
    const conditions: string[] = ['cluster_id = ?'];
    const args: InValue[] = [clusterId];

    if (from !== undefined) {
      conditions.push('timestamp >= ?');
      args.push(from);
    }
    if (to !== undefined) {
      conditions.push('timestamp <= ?');
      args.push(to);
    }
    if (eventType) {
      conditions.push('event_type = ?');
      args.push(eventType);
    }
    if (cursor) {
      conditions.push('id < ?');
      args.push(parseInt(cursor, 10));
    }

    args.push(limit + 1);

    const result = await client.execute({
      sql: `SELECT * FROM system_events
            WHERE ${conditions.join(' AND ')}
            ORDER BY id DESC
            LIMIT ?`,
      args,
    });

    const rows = result.rows.map(rowToSystemEvent);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? String(items[items.length - 1]!.id) : null;

    return { items, nextCursor };
  }

  async deleteOldEvents(olderThanMs: number): Promise<number> {
    return this.queue.enqueue(async () => {
      const client = await this.connectionFactory.getClient();
      const result = await client.execute({
        sql: 'DELETE FROM system_events WHERE timestamp < ?',
        args: [olderThanMs],
      });
      return Number(result.rowsAffected);
    });
  }
}

// ── Row Mappers ─────────────────────────────────────────────────────────────

function rowToSample(row: Record<string, unknown>): MetricSample {
  return {
    id: toNumberOrUndef(row['id']),
    clusterId: String(row['cluster_id']),
    memberAddr: String(row['member_addr']),
    timestamp: toNumber(row['timestamp']),
    elMeanMs: toNumberOrNull(row['el_mean_ms']),
    elP50Ms: toNumberOrNull(row['el_p50_ms']),
    elP99Ms: toNumberOrNull(row['el_p99_ms']),
    elMaxMs: toNumberOrNull(row['el_max_ms']),
    heapUsed: toNumberOrNull(row['heap_used']),
    heapTotal: toNumberOrNull(row['heap_total']),
    rss: toNumberOrNull(row['rss']),
    cpuPercent: toNumberOrNull(row['cpu_percent']),
    bytesRead: toNumberOrNull(row['bytes_read']),
    bytesWritten: toNumberOrNull(row['bytes_written']),
    migrationCompleted: toNumberOrNull(row['migration_completed']),
    opCompleted: toNumberOrNull(row['op_completed']),
    invTimeoutFailures: toNumberOrNull(row['inv_timeout_failures']),
    invMemberLeftFailures: toNumberOrNull(row['inv_member_left_failures']),
    blitzJobsSubmitted: toNumberOrNull(row['blitz_jobs_submitted']),
    blitzJobsSucceeded: toNumberOrNull(row['blitz_jobs_succeeded']),
    blitzJobsFailed: toNumberOrNull(row['blitz_jobs_failed']),
  };
}

function rowToAggregate(row: Record<string, unknown>): MetricAggregate {
  return {
    id: toNumberOrUndef(row['id']),
    clusterId: String(row['cluster_id']),
    memberAddr: String(row['member_addr']),
    resolution: String(row['resolution']),
    bucketStart: toNumber(row['bucket_start']),
    sampleCount: toNumber(row['sample_count']),
    cpuPercentAvg: toNumberOrNull(row['cpu_percent_avg']),
    cpuPercentMax: toNumberOrNull(row['cpu_percent_max']),
    heapUsedAvg: toNumberOrNull(row['heap_used_avg']),
    heapUsedMax: toNumberOrNull(row['heap_used_max']),
    elP99Avg: toNumberOrNull(row['el_p99_avg']),
    elP99Max: toNumberOrNull(row['el_p99_max']),
    bytesReadDelta: toNumberOrNull(row['bytes_read_delta']),
    bytesWrittenDelta: toNumberOrNull(row['bytes_written_delta']),
    opCompletedDelta: toNumberOrNull(row['op_completed_delta']),
    migrationCompletedDelta: toNumberOrNull(row['migration_completed_delta']),
    invTimeoutFailuresDelta: toNumberOrNull(row['inv_timeout_failures_delta']),
    blitzJobsFailedDelta: toNumberOrNull(row['blitz_jobs_failed_delta']),
  };
}

function rowToSystemEvent(row: Record<string, unknown>): SystemEvent {
  return {
    id: toNumberOrUndef(row['id']),
    clusterId: String(row['cluster_id']),
    memberAddr: String(row['member_addr']),
    timestamp: toNumber(row['timestamp']),
    eventType: String(row['event_type']),
    message: String(row['message']),
    detailsJson: row['details_json'] === null ? null : String(row['details_json']),
  };
}

function toNumber(val: unknown): number {
  if (typeof val === 'bigint') return Number(val);
  return Number(val);
}

function toNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return Number(val);
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function toNumberOrUndef(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'bigint') return Number(val);
  return Number(val);
}
