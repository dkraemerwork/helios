/**
 * REST controller for data-structure-specific metric history.
 *
 * Provides per-map, per-queue, and per-topic metric history endpoints.
 * Uses the same underlying MetricsRepository but filters by the specific
 * data structure name encoded in the member address field.
 */

import {
  Controller,
  Get,
  Logger,
  Param,
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

interface DataStructureHistoryResponse {
  source: 'samples' | 'aggregates';
  resolution: string;
  data: MetricSample[] | MetricAggregate[];
}

function selectResolution(rangeMs: number): { source: 'samples' | 'aggregates'; resolution: string } {
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

@Controller('api')
@UseGuards(RbacGuard)
export class DataStructuresController {
  private readonly logger = new Logger(DataStructuresController.name);

  constructor(private readonly metricsRepo: MetricsRepository) {}

  // ── GET /api/maps/:name/history ────────────────────────────────────────

  @Get('maps/:name/history')
  @RequireRoles('viewer')
  async mapHistory(
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('maxPoints') maxPointsStr?: string,
  ): Promise<DataStructureHistoryResponse> {
    return this.queryStructureHistory('map', name, clusterId, fromStr, toStr, maxPointsStr);
  }

  // ── GET /api/queues/:name/history ──────────────────────────────────────

  @Get('queues/:name/history')
  @RequireRoles('viewer')
  async queueHistory(
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('maxPoints') maxPointsStr?: string,
  ): Promise<DataStructureHistoryResponse> {
    return this.queryStructureHistory('queue', name, clusterId, fromStr, toStr, maxPointsStr);
  }

  // ── GET /api/topics/:name/history ──────────────────────────────────────

  @Get('topics/:name/history')
  @RequireRoles('viewer')
  async topicHistory(
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('maxPoints') maxPointsStr?: string,
  ): Promise<DataStructureHistoryResponse> {
    return this.queryStructureHistory('topic', name, clusterId, fromStr, toStr, maxPointsStr);
  }

  // ── Shared Query Logic ─────────────────────────────────────────────────

  private async queryStructureHistory(
    structureType: string,
    name: string,
    clusterId: string | undefined,
    fromStr: string | undefined,
    toStr: string | undefined,
    maxPointsStr: string | undefined,
  ): Promise<DataStructureHistoryResponse> {
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

    // Data structure metrics are stored with a composite member address:
    // e.g. "map:myMap", "queue:myQueue", "topic:myTopic"
    const memberAddr = `${structureType}:${name}`;
    const rangeMs = to - from;
    const selected = selectResolution(rangeMs);

    if (selected.source === 'samples') {
      const samples = await this.metricsRepo.querySamples(clusterId, memberAddr, from, to, maxPoints);
      return { source: 'samples', resolution: 'raw', data: samples };
    }

    const aggregates = await this.metricsRepo.queryAggregates(
      clusterId,
      memberAddr,
      selected.resolution,
      from,
      to,
      maxPoints,
    );
    return { source: 'aggregates', resolution: selected.resolution, data: aggregates };
  }
}
