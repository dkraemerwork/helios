/**
 * Batches metric sample writes for efficient database insertion.
 *
 * Buffers incoming rows and flushes them either when the buffer reaches
 * WRITE_BATCH_MAX_ROWS (100) or after WRITE_BATCH_MAX_WAIT_MS (5 s),
 * whichever comes first. All writes are serialized through AsyncSerialQueue
 * to avoid SQLITE_BUSY. Transient failures are retried with exponential
 * backoff — no writes are ever silently dropped.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AsyncSerialQueue } from './AsyncSerialQueue.js';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import { WRITE_BATCH_MAX_ROWS, WRITE_BATCH_MAX_WAIT_MS } from '../shared/constants.js';
import type { MetricSample } from '../shared/types.js';

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 500;

@Injectable()
export class WriteBatcher implements OnModuleDestroy {
  private readonly logger = new Logger(WriteBatcher.name);
  private buffer: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _bufferDepth = 0;
  private shuttingDown = false;

  constructor(
    private readonly queue: AsyncSerialQueue,
    private readonly connectionFactory: TursoConnectionFactory,
  ) {}

  /** Current number of samples buffered (for self-metrics). */
  get bufferDepth(): number {
    return this._bufferDepth;
  }

  /** Adds a sample to the buffer. Triggers a flush if the buffer is full. */
  add(sample: MetricSample): void {
    this.buffer.push(sample);
    this._bufferDepth = this.buffer.length;

    if (this.buffer.length >= WRITE_BATCH_MAX_ROWS) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, WRITE_BATCH_MAX_WAIT_MS);
    }
  }

  /** Adds multiple samples to the buffer. */
  addAll(samples: MetricSample[]): void {
    for (const sample of samples) {
      this.add(sample);
    }
  }

  /** Immediately flushes all buffered samples to the database. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    // Capture and reset the buffer atomically
    const batch = this.buffer;
    this.buffer = [];
    this._bufferDepth = 0;

    // Enqueue the write with retries
    this.queue.enqueue(() => this.writeBatch(batch)).catch((err) => {
      this.logger.error(`Batch write permanently failed (${batch.length} samples lost): ${errorMsg(err)}`);
    });
  }

  /** Flushes remaining buffer and prevents new writes during shutdown. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.flush();

    // Wait for the queue to drain (best-effort)
    const deadline = Date.now() + 10_000;
    while (this.queue.depth > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Writes a batch of samples using a multi-row INSERT with retry.
   * On transient failure, re-enqueues the batch with exponential backoff.
   */
  private async writeBatch(batch: MetricSample[], attempt = 0): Promise<void> {
    try {
      const client = await this.connectionFactory.getClient();

      // Build batch insert using parameterized statements
      const stmts = batch.map((s) => ({
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
      this.logger.debug(`Flushed ${batch.length} metric samples`);
    } catch (err) {
      if (attempt < MAX_RETRIES && isTransient(err)) {
        const backoff = BASE_RETRY_MS * Math.pow(2, attempt);
        this.logger.warn(
          `Batch write attempt ${attempt + 1} failed (${batch.length} samples), ` +
            `retrying in ${backoff}ms: ${errorMsg(err)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        return this.writeBatch(batch, attempt + 1);
      }

      throw err;
    }
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('sqlite_busy') ||
      msg.includes('database is locked') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('timeout')
    );
  }
  return false;
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
