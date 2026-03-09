/**
 * History query handler for WebSocket-initiated metric queries.
 *
 * Validates RBAC entitlements, selects the appropriate metric resolution
 * based on the requested time range, queries the persistence layer, and
 * downsamples results to the requested maxPoints if necessary.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MetricsRepository } from '../persistence/MetricsRepository.js';
import type { MetricAggregate, MetricSample, WsHistoryQueryData } from '../shared/types.js';

/** Time range thresholds (in milliseconds) for resolution selection. */
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type HistoryResult = MetricAggregate[] | MetricSample[];

@Injectable()
export class HistoryQueryService {
  private readonly logger = new Logger(HistoryQueryService.name);

  constructor(private readonly metricsRepository: MetricsRepository) {}

  /**
   * Executes a history query after validating the user's RBAC entitlements.
   *
   * @param params       - The query parameters from the WebSocket message.
   * @param userRoles    - The authenticated user's roles.
   * @param userClusterScopes - Cluster IDs the user is allowed to access (empty = all).
   * @returns Raw samples or pre-aggregated data depending on the time range.
   */
  async queryHistory(
    params: WsHistoryQueryData,
    userRoles: string[],
    userClusterScopes: string[],
  ): Promise<HistoryResult> {
    // RBAC: if user has cluster scopes, the requested cluster must be in scope
    if (userClusterScopes.length > 0 && !userClusterScopes.includes(params.clusterId)) {
      this.logger.warn(
        `User denied access to cluster ${params.clusterId} (scopes: [${userClusterScopes.join(', ')}])`,
      );
      return [];
    }

    const rangeMs = params.to - params.from;
    const resolution = selectResolution(rangeMs);

    if (resolution === 'raw') {
      const samples = await this.metricsRepository.querySamples(
        params.clusterId,
        params.memberAddr,
        params.from,
        params.to,
        params.maxPoints,
      );

      return downsampleArray(samples, params.maxPoints);
    }

    const aggregates = await this.metricsRepository.queryAggregates(
      params.clusterId,
      params.memberAddr,
      resolution,
      params.from,
      params.to,
      params.maxPoints,
    );

    return downsampleArray(aggregates, params.maxPoints);
  }
}

/**
 * Selects the metric resolution based on the query time range:
 *   - < 2h  -> raw samples
 *   - < 12h -> 1m aggregates
 *   - < 3d  -> 5m aggregates
 *   - < 30d -> 1h aggregates
 *   - >= 30d -> 1d aggregates
 */
function selectResolution(rangeMs: number): string {
  if (rangeMs < TWO_HOURS_MS) return 'raw';
  if (rangeMs < TWELVE_HOURS_MS) return '1m';
  if (rangeMs < THREE_DAYS_MS) return '5m';
  if (rangeMs < THIRTY_DAYS_MS) return '1h';
  return '1d';
}

/**
 * Uniformly downsamples an array to at most maxPoints by selecting
 * evenly-spaced indices. If the array is already within bounds it is
 * returned as-is.
 */
function downsampleArray<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;

  const result: T[] = [];
  const step = items.length / maxPoints;

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.min(Math.floor(i * step), items.length - 1);
    result.push(items[index]!);
  }

  return result;
}
