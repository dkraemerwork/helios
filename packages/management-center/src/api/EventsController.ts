/**
 * REST controller for system events scoped to a specific cluster.
 *
 * Provides cursor-paginated access to system events such as member
 * connect/disconnect, auto-discovery, state changes, and other
 * operational events recorded by the connector service.
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
import { AuthRepository } from '../persistence/AuthRepository.js';
import { MetricsRepository } from '../persistence/MetricsRepository.js';
import { NotFoundError } from '../shared/errors.js';
import { clampPageSize } from '../shared/formatters.js';
import { MAX_HISTORY_PAGE_SIZE } from '../shared/constants.js';
import type { SystemEvent, CursorPaginatedResult } from '../shared/types.js';

@Controller('api/clusters/:clusterId/events')
@UseGuards(RbacGuard)
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly metricsRepo: MetricsRepository,
  ) {}

  // ── GET /api/clusters/:clusterId/events ────────────────────────────────

  @Get()
  @RequireRoles('viewer')
  async listEvents(
    @Param('clusterId') clusterId: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('eventType') eventType?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<CursorPaginatedResult<SystemEvent>> {
    const record = await this.authRepo.getClusterById(clusterId);
    if (!record) {
      throw new NotFoundError(`Cluster ${clusterId} not found`);
    }

    const limit = clampPageSize(parseInt(limitStr ?? '100', 10) || 100, MAX_HISTORY_PAGE_SIZE);
    const from = fromStr ? parseInt(fromStr, 10) : undefined;
    const to = toStr ? parseInt(toStr, 10) : undefined;

    return this.metricsRepo.querySystemEvents(clusterId, from, to, eventType, limit, cursor);
  }
}
