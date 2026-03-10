/**
 * Aggregation engine for computing cluster-level metrics from individual members.
 *
 * Takes a ClusterState and produces aggregate metrics (averages, totals)
 * across all non-stale, connected members with available samples. Handles
 * missing or partial metrics gracefully by excluding members without data.
 */

import { Injectable } from '@nestjs/common';
import { isMonitorCapableMemberState } from '../shared/memberCapabilities.js';
import type { ClusterState, MemberMetricsSample } from '../shared/types.js';

export interface ClusterAggregate {
  /** Number of members contributing to this aggregate. */
  memberCount: number;

  /** Average CPU percentage across all contributing members. */
  cpuAvg: number;

  /** Total heap used across all contributing members (bytes). */
  heapUsedTotal: number;

  /** Total heap capacity across all contributing members (bytes). */
  heapTotalTotal: number;

  /** Total resident set size across all contributing members (bytes). */
  rssTotal: number;

  /** Total bytes read across all contributing members. */
  bytesReadTotal: number;

  /** Total bytes written across all contributing members. */
  bytesWrittenTotal: number;

  /** Average event loop p99 latency across all contributing members (ms). */
  elP99Avg: number;

  /** Maximum event loop p99 latency across all contributing members (ms). */
  elP99Max: number;

  /** Average event loop max latency across all contributing members (ms). */
  elMaxAvg: number;

  /** Total completed operations across all contributing members. */
  opCompletedTotal: number;

  /** Total completed migrations across all contributing members. */
  migrationCompletedTotal: number;

  /** Total invocation timeout failures across all contributing members. */
  invTimeoutFailuresTotal: number;

  /** Total invocation member-left failures across all contributing members. */
  invMemberLeftFailuresTotal: number;

  /** Total running Blitz pipelines across all contributing members. */
  blitzRunningPipelinesTotal: number;

  /** Total Blitz jobs submitted across all contributing members. */
  blitzJobsSubmittedTotal: number;

  /** Total Blitz jobs succeeded across all contributing members. */
  blitzJobsSucceededTotal: number;

  /** Total Blitz jobs failed across all contributing members. */
  blitzJobsFailedTotal: number;
}

@Injectable()
export class AggregationEngine {
  /**
   * Computes an aggregate snapshot from all connected, non-stale members
   * that have a latestSample. Members without samples are excluded from
   * averages and totals.
   */
  computeClusterAggregate(state: ClusterState): ClusterAggregate {
    const samples: MemberMetricsSample[] = [];

    for (const member of state.members.values()) {
      if (member.connected && member.latestSample && isMonitorCapableMemberState(member)) {
        samples.push(member.latestSample);
      }
    }

    if (samples.length === 0) {
      return emptyAggregate();
    }

    let cpuSum = 0;
    let heapUsedSum = 0;
    let heapTotalSum = 0;
    let rssSum = 0;
    let bytesReadSum = 0;
    let bytesWrittenSum = 0;
    let elP99Sum = 0;
    let elP99Max = 0;
    let elMaxSum = 0;
    let opCompletedSum = 0;
    let migrationCompletedSum = 0;
    let invTimeoutSum = 0;
    let invMemberLeftSum = 0;
    let blitzPipelinesSum = 0;
    let blitzSubmittedSum = 0;
    let blitzSucceededSum = 0;
    let blitzFailedSum = 0;

    for (const s of samples) {
      cpuSum += s.cpu.percentUsed;
      heapUsedSum += s.memory.heapUsed;
      heapTotalSum += s.memory.heapTotal;
      rssSum += s.memory.rss;
      bytesReadSum += s.transport.bytesRead;
      bytesWrittenSum += s.transport.bytesWritten;
      elP99Sum += s.eventLoop.p99Ms;
      elP99Max = Math.max(elP99Max, s.eventLoop.p99Ms);
      elMaxSum += s.eventLoop.maxMs;
      opCompletedSum += s.operation.completedCount;
      migrationCompletedSum += s.migration.completedMigrations;
      invTimeoutSum += s.invocation.timeoutFailures;
      invMemberLeftSum += s.invocation.memberLeftFailures;

      if (s.blitz) {
        blitzPipelinesSum += s.blitz.runningPipelines;
        blitzSubmittedSum += s.blitz.jobCounters.submitted;
        blitzSucceededSum += s.blitz.jobCounters.completedSuccessfully;
        blitzFailedSum += s.blitz.jobCounters.completedWithFailure;
      }
    }

    const count = samples.length;

    return {
      memberCount: count,
      cpuAvg: cpuSum / count,
      heapUsedTotal: heapUsedSum,
      heapTotalTotal: heapTotalSum,
      rssTotal: rssSum,
      bytesReadTotal: bytesReadSum,
      bytesWrittenTotal: bytesWrittenSum,
      elP99Avg: elP99Sum / count,
      elP99Max,
      elMaxAvg: elMaxSum / count,
      opCompletedTotal: opCompletedSum,
      migrationCompletedTotal: migrationCompletedSum,
      invTimeoutFailuresTotal: invTimeoutSum,
      invMemberLeftFailuresTotal: invMemberLeftSum,
      blitzRunningPipelinesTotal: blitzPipelinesSum,
      blitzJobsSubmittedTotal: blitzSubmittedSum,
      blitzJobsSucceededTotal: blitzSucceededSum,
      blitzJobsFailedTotal: blitzFailedSum,
    };
  }
}

function emptyAggregate(): ClusterAggregate {
  return {
    memberCount: 0,
    cpuAvg: 0,
    heapUsedTotal: 0,
    heapTotalTotal: 0,
    rssTotal: 0,
    bytesReadTotal: 0,
    bytesWrittenTotal: 0,
    elP99Avg: 0,
    elP99Max: 0,
    elMaxAvg: 0,
    opCompletedTotal: 0,
    migrationCompletedTotal: 0,
    invTimeoutFailuresTotal: 0,
    invMemberLeftFailuresTotal: 0,
    blitzRunningPipelinesTotal: 0,
    blitzJobsSubmittedTotal: 0,
    blitzJobsSucceededTotal: 0,
    blitzJobsFailedTotal: 0,
  };
}
