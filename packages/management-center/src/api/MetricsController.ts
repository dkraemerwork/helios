/**
 * REST controller for querying metric history.
 *
 * Automatically selects the appropriate data source (raw samples vs.
 * pre-computed aggregates) based on the requested time range. Short
 * ranges return raw samples; longer ranges use minute, 5-minute,
 * hourly, or daily aggregates for efficient retrieval.
 */

import {
  Controller,
  Get,
  Logger,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RbacGuard, RequireRoles } from '../auth/RbacGuard.js';
import { MetricsRepository } from '../persistence/MetricsRepository.js';
import { ValidationError } from '../shared/errors.js';
import { clampPageSize } from '../shared/formatters.js';
import { MAX_HISTORY_PAGE_SIZE } from '../shared/constants.js';
import type { MetricSample, MetricAggregate } from '../shared/types.js';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

interface MetricHistoryResponse {
  source: 'samples' | 'aggregates';
  resolution: string;
  data: MetricSample[] | MetricAggregate[];
}

/**
 * Selects the optimal resolution based on the requested time range.
 *
 * - <= 2 hours: raw samples
 * - <= 12 hours: 1-minute aggregates
 * - <= 3 days: 5-minute aggregates
 * - <= 30 days: hourly aggregates
 * - > 30 days: daily aggregates
 */
function selectResolution(rangeMs: number, requested?: string): { source: 'samples' | 'aggregates'; resolution: string } {
  if (requested) {
    const validResolutions = ['raw', '1m', '5m', '1h', '1d'];
    if (!validResolutions.includes(requested)) {
      throw new ValidationError(`Invalid resolution. Valid values: ${validResolutions.join(', ')}`);
    }
    if (requested === 'raw') {
      return { source: 'samples', resolution: 'raw' };
    }
    return { source: 'aggregates', resolution: requested };
  }

  if (rangeMs <= 2 * MS_PER_HOUR) {
    return { source: 'samples', resolution: 'raw' };
  }
  if (rangeMs <= 12 * MS_PER_HOUR) {
    return { source: 'aggregates', resolution: '1m' };
  }
  if (rangeMs <= 3 * MS_PER_DAY) {
    return { source: 'aggregates', resolution: '5m' };
  }
  if (rangeMs <= 30 * MS_PER_DAY) {
    return { source: 'aggregates', resolution: '1h' };
  }
  return { source: 'aggregates', resolution: '1d' };
}

@Controller('api/metrics')
@UseGuards(RbacGuard)
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsRepo: MetricsRepository) {}

  // ── GET /api/metrics/history ───────────────────────────────────────────

  @Get('history')
  @RequireRoles('viewer')
  async history(
    @Query('clusterId') clusterId?: string,
    @Query('memberAddr') memberAddr?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('resolution') resolution?: string,
    @Query('maxPoints') maxPointsStr?: string,
  ): Promise<MetricHistoryResponse> {
    if (!clusterId) {
      throw new ValidationError('clusterId query parameter is required');
    }

    const now = Date.now();
    const from = fromStr ? parseInt(fromStr, 10) : now - MS_PER_HOUR;
    const to = toStr ? parseInt(toStr, 10) : now;

    if (Number.isNaN(from) || Number.isNaN(to)) {
      throw new ValidationError('from and to must be valid timestamps in milliseconds');
    }
    if (from >= to) {
      throw new ValidationError('from must be less than to');
    }

    const maxPoints = clampPageSize(
      parseInt(maxPointsStr ?? '500', 10) || 500,
      MAX_HISTORY_PAGE_SIZE,
    );

    const rangeMs = to - from;
    const selected = selectResolution(rangeMs, resolution);

    if (selected.source === 'samples') {
      const samples = await this.metricsRepo.querySamples(
        clusterId,
        memberAddr ?? null,
        from,
        to,
        maxPoints,
      );
      return { source: 'samples', resolution: 'raw', data: samples };
    }

    const aggregates = await this.metricsRepo.queryAggregates(
      clusterId,
      memberAddr ?? null,
      selected.resolution,
      from,
      to,
      maxPoints,
    );
    return { source: 'aggregates', resolution: selected.resolution, data: aggregates };
  }
}
