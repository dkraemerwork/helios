/**
 * Resolves MetricPath strings to actual numeric values from a MemberMetricsSample.
 *
 * Each MetricPath maps to a specific field (or computed expression) in the
 * sample object. Blitz fields are null-safe and default to 0 when the
 * blitz subsystem is absent.
 */

import { Injectable } from '@nestjs/common';
import type { MetricPath, MemberMetricsSample } from '../shared/types.js';

type PathResolver = (sample: MemberMetricsSample) => number | null;

const RESOLVERS: Record<MetricPath, PathResolver> = {
  'cpu.percentUsed': (s) => s.cpu.percentUsed,
  'memory.heapUsed': (s) => s.memory.heapUsed,
  'memory.heapTotal': (s) => s.memory.heapTotal,
  'memory.heapUsedPercent': (s) =>
    s.memory.heapTotal === 0
      ? 0
      : (s.memory.heapUsed / s.memory.heapTotal) * 100,
  'memory.rss': (s) => s.memory.rss,
  'eventLoop.p99Ms': (s) => s.eventLoop.p99Ms,
  'eventLoop.maxMs': (s) => s.eventLoop.maxMs,
  'transport.bytesRead': (s) => s.transport.bytesRead,
  'transport.bytesWritten': (s) => s.transport.bytesWritten,
  'migration.migrationQueueSize': (s) => s.migration.migrationQueueSize,
  'migration.activeMigrations': (s) => s.migration.activeMigrations,
  'migration.completedMigrations': (s) => s.migration.completedMigrations,
  'operation.queueSize': (s) => s.operation.queueSize,
  'operation.completedCount': (s) => s.operation.completedCount,
  'invocation.pendingCount': (s) => s.invocation.pendingCount,
  'invocation.usedPercentage': (s) => s.invocation.usedPercentage,
  'invocation.timeoutFailures': (s) => s.invocation.timeoutFailures,
  'invocation.memberLeftFailures': (s) => s.invocation.memberLeftFailures,
  'blitz.runningPipelines': (s) => s.blitz?.runningPipelines ?? 0,
  'blitz.jobCounters.submitted': (s) => s.blitz?.jobCounters.submitted ?? 0,
  'blitz.jobCounters.completedSuccessfully': (s) =>
    s.blitz?.jobCounters.completedSuccessfully ?? 0,
  'blitz.jobCounters.completedWithFailure': (s) =>
    s.blitz?.jobCounters.completedWithFailure ?? 0,
};

@Injectable()
export class MetricPathResolver {
  /**
   * Resolves a MetricPath to its numeric value from the given sample.
   * Returns null if the path is unrecognised.
   */
  resolve(path: MetricPath, sample: MemberMetricsSample): number | null {
    const resolver = RESOLVERS[path];
    if (!resolver) return null;
    return resolver(sample);
  }
}
