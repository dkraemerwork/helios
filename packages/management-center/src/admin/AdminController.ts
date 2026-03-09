/**
 * HTTP controller for administrative actions on clusters, jobs, maps, and GC.
 *
 * All endpoints require CSRF validation and role-based access control.
 * Cluster state changes require the 'admin' role; all other operations
 * require 'operator'. Each request generates a unique requestId for
 * audit correlation.
 */

import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { CsrfGuard } from '../auth/CsrfGuard.js';
import { RbacGuard, RequireRoles } from '../auth/RbacGuard.js';
import { ValidationError } from '../shared/errors.js';
import { ClusterAdminService } from './ClusterAdminService.js';
import { JobAdminService } from './JobAdminService.js';
import { ObjectAdminService } from './ObjectAdminService.js';

interface AdminActionResult {
  success: boolean;
  error?: string;
  requestId: string;
}

@Controller('api/admin')
@UseGuards(CsrfGuard, RbacGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly clusterAdmin: ClusterAdminService,
    private readonly jobAdmin: JobAdminService,
    private readonly objectAdmin: ObjectAdminService,
  ) {}

  // ── POST /api/admin/cluster-state ────────────────────────────────────

  @Post('cluster-state')
  @HttpCode(200)
  @RequireRoles('admin')
  async setClusterState(
    @Body() body: { clusterId?: string; state?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;
    const state = body.state;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }
    if (!state || !isValidClusterState(state)) {
      throw new ValidationError('state must be one of: ACTIVE, PASSIVE, FROZEN');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} requesting cluster state change: ${clusterId} -> ${state}`);

    const result = await this.clusterAdmin.setClusterState(
      clusterId,
      state as 'ACTIVE' | 'PASSIVE' | 'FROZEN',
      actorUserId,
      requestId,
    );

    return { ...result, requestId };
  }

  // ── POST /api/admin/jobs/:id/cancel ──────────────────────────────────

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @RequireRoles('operator')
  async cancelJob(
    @Param('id') jobId: string,
    @Body() body: { clusterId?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} cancelling job ${jobId} in cluster ${clusterId}`);

    const result = await this.jobAdmin.cancelJob(clusterId, jobId, actorUserId, requestId);

    return { ...result, requestId };
  }

  // ── POST /api/admin/jobs/:id/restart ─────────────────────────────────

  @Post('jobs/:id/restart')
  @HttpCode(200)
  @RequireRoles('operator')
  async restartJob(
    @Param('id') jobId: string,
    @Body() body: { clusterId?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} restarting job ${jobId} in cluster ${clusterId}`);

    const result = await this.jobAdmin.restartJob(clusterId, jobId, actorUserId, requestId);

    return { ...result, requestId };
  }

  // ── POST /api/admin/maps/:name/clear ─────────────────────────────────

  @Post('maps/:name/clear')
  @HttpCode(200)
  @RequireRoles('operator')
  async clearMap(
    @Param('name') mapName: string,
    @Body() body: { clusterId?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} clearing map '${mapName}' in cluster ${clusterId}`);

    const result = await this.objectAdmin.clearMap(clusterId, mapName, actorUserId, requestId);

    return { ...result, requestId };
  }

  // ── POST /api/admin/maps/:name/evict ─────────────────────────────────

  @Post('maps/:name/evict')
  @HttpCode(200)
  @RequireRoles('operator')
  async evictMap(
    @Param('name') mapName: string,
    @Body() body: { clusterId?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} evicting map '${mapName}' in cluster ${clusterId}`);

    const result = await this.objectAdmin.evictMap(clusterId, mapName, actorUserId, requestId);

    return { ...result, requestId };
  }

  // ── POST /api/admin/gc ───────────────────────────────────────────────

  @Post('gc')
  @HttpCode(200)
  @RequireRoles('operator')
  async triggerGc(
    @Body() body: { clusterId?: string },
    @Req() req: any,
  ): Promise<AdminActionResult> {
    const clusterId = body.clusterId;

    if (!clusterId) {
      throw new ValidationError('clusterId is required');
    }

    const requestId = generateRequestId();
    const actorUserId = extractUserId(req);

    this.logger.log(`Admin ${actorUserId} triggering GC in cluster ${clusterId}`);

    const result = await this.objectAdmin.triggerGc(clusterId, actorUserId, requestId);

    return { ...result, requestId };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_CLUSTER_STATES = new Set(['ACTIVE', 'PASSIVE', 'FROZEN']);

function isValidClusterState(state: string): boolean {
  return VALID_CLUSTER_STATES.has(state);
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Extracts the authenticated user ID from the request.
 * The mcUser property is populated by the auth middleware/guard chain.
 */
function extractUserId(req: any): string {
  return req.mcUser?.id ?? 'system';
}
