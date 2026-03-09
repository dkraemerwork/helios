/**
 * Scheduled downsampling of raw metric samples into aggregated buckets.
 *
 * Aggregation tiers:
 *   raw  -> 1m   : every minute on the minute
 *   1m   -> 5m   : every 5 minutes
 *   5m   -> 1h   : every hour
 *   1h   -> 1d   : every day at 00:05 UTC
 *
 * For gauge metrics (cpu_percent, heap_used, el_p99) the aggregate computes
 * avg and max. For counter metrics (bytes_read, bytes_written, etc.) the
 * aggregate computes delta (MAX - MIN within the bucket).
 *
 * Uses a watermark (last successful bucket_start) per cluster/member/resolution
 * to avoid re-processing already aggregated data.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetricsRepository } from './MetricsRepository.js';
import { TursoConnectionFactory } from './TursoConnectionFactory.js';
import {
  minuteBoundary,
  fiveMinuteBoundary,
  hourBoundary,
  dayBoundary,
  nowMs,
} from '../shared/time.js';
import type { MetricSample, MetricAggregate } from '../shared/types.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_5_MINUTES = 5 * MS_PER_MINUTE;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

@Injectable()
export class DownsampleScheduler {
  private readonly logger = new Logger(DownsampleScheduler.name);

  constructor(
    private readonly metricsRepository: MetricsRepository,
    private readonly connectionFactory: TursoConnectionFactory,
  ) {}

  /** raw -> 1m: runs every minute at second 0 */
  @Cron('0 * * * * *')
  async downsampleRawTo1m(): Promise<void> {
    await this.downsampleFromRaw('1m', minuteBoundary, MS_PER_MINUTE);
  }

  /** 1m -> 5m: runs at minute 0 and 5 past */
  @Cron('0 */5 * * * *')
  async downsample1mTo5m(): Promise<void> {
    await this.downsampleFromAggregates('1m', '5m', fiveMinuteBoundary, MS_PER_5_MINUTES);
  }

  /** 5m -> 1h: runs at the top of every hour */
  @Cron('0 0 * * * *')
  async downsample5mTo1h(): Promise<void> {
    await this.downsampleFromAggregates('5m', '1h', hourBoundary, MS_PER_HOUR);
  }

  /** 1h -> 1d: runs daily at 00:05 UTC */
  @Cron('0 5 0 * * *')
  async downsample1hTo1d(): Promise<void> {
    await this.downsampleFromAggregates('1h', '1d', dayBoundary, MS_PER_DAY);
  }

  /**
   * Downsamples raw metric_samples into the first aggregation tier.
   * Iterates over all distinct cluster/member pairs that have new data.
   */
  private async downsampleFromRaw(
    targetResolution: string,
    boundaryFn: (ts: number) => number,
    bucketSize: number,
  ): Promise<void> {
    try {
      const client = await this.connectionFactory.getClient();

      // Find distinct cluster/member pairs with raw samples
      const pairsResult = await client.execute(
        'SELECT DISTINCT cluster_id, member_addr FROM metric_samples',
      );

      for (const pairRow of pairsResult.rows) {
        const clusterId = String(pairRow['cluster_id']);
        const memberAddr = String(pairRow['member_addr']);

        await this.processRawBuckets(
          clusterId,
          memberAddr,
          targetResolution,
          boundaryFn,
          bucketSize,
        );
      }
    } catch (err) {
      this.logger.warn(`Downsample raw -> ${targetResolution} failed: ${errMsg(err)}`);
    }
  }

  /**
   * Processes raw samples for a single cluster/member pair, creating
   * aggregate buckets for any time windows that have new data.
   */
  private async processRawBuckets(
    clusterId: string,
    memberAddr: string,
    resolution: string,
    boundaryFn: (ts: number) => number,
    bucketSize: number,
  ): Promise<void> {
    const watermark = await this.metricsRepository.getLatestBucketStart(
      clusterId,
      memberAddr,
      resolution,
    );

    // Start from the watermark or from one bucket ago
    const now = nowMs();
    const currentBucket = boundaryFn(now);
    const startFrom = watermark !== null ? watermark : currentBucket - bucketSize;

    // Process each bucket from startFrom up to (but not including) the current bucket
    for (let bucketStart = startFrom; bucketStart < currentBucket; bucketStart += bucketSize) {
      const bucketEnd = bucketStart + bucketSize;

      const samples = await this.metricsRepository.getSamplesForAggregation(
        clusterId,
        memberAddr,
        bucketStart,
        bucketEnd,
      );

      if (samples.length === 0) continue;

      const aggregate = this.computeAggregateFromSamples(
        clusterId,
        memberAddr,
        resolution,
        bucketStart,
        samples,
      );

      await this.metricsRepository.insertAggregate(aggregate);
    }
  }

  /**
   * Downsamples from one aggregation tier to the next.
   * Reads source aggregates and computes target aggregates.
   */
  private async downsampleFromAggregates(
    sourceResolution: string,
    targetResolution: string,
    boundaryFn: (ts: number) => number,
    bucketSize: number,
  ): Promise<void> {
    try {
      const client = await this.connectionFactory.getClient();

      // Find distinct cluster/member pairs in the source resolution
      const pairsResult = await client.execute({
        sql: `SELECT DISTINCT cluster_id, member_addr FROM metric_aggregates WHERE resolution = ?`,
        args: [sourceResolution],
      });

      for (const pairRow of pairsResult.rows) {
        const clusterId = String(pairRow['cluster_id']);
        const memberAddr = String(pairRow['member_addr']);

        await this.processAggregateBuckets(
          clusterId,
          memberAddr,
          sourceResolution,
          targetResolution,
          boundaryFn,
          bucketSize,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Downsample ${sourceResolution} -> ${targetResolution} failed: ${errMsg(err)}`,
      );
    }
  }

  /**
   * Processes aggregate-to-aggregate downsampling for a single cluster/member pair.
   */
  private async processAggregateBuckets(
    clusterId: string,
    memberAddr: string,
    sourceResolution: string,
    targetResolution: string,
    boundaryFn: (ts: number) => number,
    bucketSize: number,
  ): Promise<void> {
    const watermark = await this.metricsRepository.getLatestBucketStart(
      clusterId,
      memberAddr,
      targetResolution,
    );

    const now = nowMs();
    const currentBucket = boundaryFn(now);
    const startFrom = watermark !== null ? watermark : currentBucket - bucketSize;

    for (let bucketStart = startFrom; bucketStart < currentBucket; bucketStart += bucketSize) {
      const bucketEnd = bucketStart + bucketSize;

      const sourceAggregates = await this.metricsRepository.queryAggregates(
        clusterId,
        memberAddr,
        sourceResolution,
        bucketStart,
        bucketEnd - 1,
        10_000,
      );

      if (sourceAggregates.length === 0) continue;

      const aggregate = this.computeAggregateFromAggregates(
        clusterId,
        memberAddr,
        targetResolution,
        bucketStart,
        sourceAggregates,
      );

      await this.metricsRepository.insertAggregate(aggregate);
    }
  }

  /**
   * Computes an aggregate from raw samples.
   * Gauges: avg and max. Counters: delta (max - min).
   */
  private computeAggregateFromSamples(
    clusterId: string,
    memberAddr: string,
    resolution: string,
    bucketStart: number,
    samples: MetricSample[],
  ): MetricAggregate {
    const count = samples.length;

    return {
      clusterId,
      memberAddr,
      resolution,
      bucketStart,
      sampleCount: count,

      // Gauges: avg/max
      cpuPercentAvg: avgOf(samples, (s) => s.cpuPercent),
      cpuPercentMax: maxOf(samples, (s) => s.cpuPercent),
      heapUsedAvg: avgOf(samples, (s) => s.heapUsed),
      heapUsedMax: maxOf(samples, (s) => s.heapUsed),
      elP99Avg: avgOf(samples, (s) => s.elP99Ms),
      elP99Max: maxOf(samples, (s) => s.elP99Ms),

      // Counters: delta (max - min)
      bytesReadDelta: deltaOf(samples, (s) => s.bytesRead),
      bytesWrittenDelta: deltaOf(samples, (s) => s.bytesWritten),
      opCompletedDelta: deltaOf(samples, (s) => s.opCompleted),
      migrationCompletedDelta: deltaOf(samples, (s) => s.migrationCompleted),
      invTimeoutFailuresDelta: deltaOf(samples, (s) => s.invTimeoutFailures),
      blitzJobsFailedDelta: deltaOf(samples, (s) => s.blitzJobsFailed),
    };
  }

  /**
   * Computes an aggregate from source-tier aggregates.
   * Gauges: weighted avg (by sample_count) and max.
   * Counters: sum of deltas.
   */
  private computeAggregateFromAggregates(
    clusterId: string,
    memberAddr: string,
    resolution: string,
    bucketStart: number,
    sources: MetricAggregate[],
  ): MetricAggregate {
    const totalSamples = sources.reduce((sum, s) => sum + s.sampleCount, 0);

    return {
      clusterId,
      memberAddr,
      resolution,
      bucketStart,
      sampleCount: totalSamples,

      // Gauges: weighted average by sample count, max of maxes
      cpuPercentAvg: weightedAvgAgg(sources, (s) => s.cpuPercentAvg, (s) => s.sampleCount),
      cpuPercentMax: maxOfAgg(sources, (s) => s.cpuPercentMax),
      heapUsedAvg: weightedAvgAgg(sources, (s) => s.heapUsedAvg, (s) => s.sampleCount),
      heapUsedMax: maxOfAgg(sources, (s) => s.heapUsedMax),
      elP99Avg: weightedAvgAgg(sources, (s) => s.elP99Avg, (s) => s.sampleCount),
      elP99Max: maxOfAgg(sources, (s) => s.elP99Max),

      // Counters: sum of deltas
      bytesReadDelta: sumOfAgg(sources, (s) => s.bytesReadDelta),
      bytesWrittenDelta: sumOfAgg(sources, (s) => s.bytesWrittenDelta),
      opCompletedDelta: sumOfAgg(sources, (s) => s.opCompletedDelta),
      migrationCompletedDelta: sumOfAgg(sources, (s) => s.migrationCompletedDelta),
      invTimeoutFailuresDelta: sumOfAgg(sources, (s) => s.invTimeoutFailuresDelta),
      blitzJobsFailedDelta: sumOfAgg(sources, (s) => s.blitzJobsFailedDelta),
    };
  }
}

// ── Aggregation Helpers ─────────────────────────────────────────────────────

function avgOf(samples: MetricSample[], getter: (s: MetricSample) => number | null): number | null {
  const values = samples.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function maxOf(samples: MetricSample[], getter: (s: MetricSample) => number | null): number | null {
  const values = samples.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

function deltaOf(
  samples: MetricSample[],
  getter: (s: MetricSample) => number | null,
): number | null {
  const values = samples.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max - min;
}

function weightedAvgAgg(
  aggregates: MetricAggregate[],
  valueGetter: (a: MetricAggregate) => number | null,
  weightGetter: (a: MetricAggregate) => number,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const agg of aggregates) {
    const val = valueGetter(agg);
    if (val === null) continue;
    const weight = weightGetter(agg);
    weightedSum += val * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

function maxOfAgg(
  aggregates: MetricAggregate[],
  getter: (a: MetricAggregate) => number | null,
): number | null {
  const values = aggregates.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

function sumOfAgg(
  aggregates: MetricAggregate[],
  getter: (a: MetricAggregate) => number | null,
): number | null {
  const values = aggregates.map(getter).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
