/**
 * REST controller for job snapshot queries.
 *
 * Provides access to job history (cursor-paginated snapshots over time)
 * and active jobs per cluster. Job data is collected via periodic polling
 * by the JobsService and stored as time-series snapshots.
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
import { JobsService } from '../jobs/JobsService.js';
import { AuthRepository } from '../persistence/AuthRepository.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { clampPageSize } from '../shared/formatters.js';
import { MAX_HISTORY_PAGE_SIZE } from '../shared/constants.js';
import type { JobSnapshot, CursorPaginatedResult } from '../shared/types.js';

@Controller('api')
@UseGuards(RbacGuard)
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly authRepo: AuthRepository,
  ) {}

  // ── GET /api/jobs/:jobId/history ───────────────────────────────────────

  @Get('jobs/:jobId/history')
  @RequireRoles('viewer')
  async jobHistory(
    @Param('jobId') jobId: string,
    @Query('clusterId') clusterId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ): Promise<CursorPaginatedResult<JobSnapshot>> {
    if (!clusterId) {
      throw new ValidationError('clusterId query parameter is required');
    }

    const limit = clampPageSize(parseInt(limitStr ?? '50', 10) || 50, MAX_HISTORY_PAGE_SIZE);

    return this.jobsService.getJobHistory(clusterId, jobId, limit, cursor);
  }

  // ── GET /api/clusters/:clusterId/jobs ──────────────────────────────────

  @Get('clusters/:clusterId/jobs')
  @RequireRoles('viewer')
  async activeJobs(
    @Param('clusterId') clusterId: string,
  ): Promise<{ jobs: JobSnapshot[] }> {
    const record = await this.authRepo.getClusterById(clusterId);
    if (!record) {
      throw new NotFoundError(`Cluster ${clusterId} not found`);
    }

    const jobs = await this.jobsService.getActiveJobs(clusterId);
    return { jobs };
  }
}
