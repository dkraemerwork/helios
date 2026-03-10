/**
 * REST controller for cluster lifecycle management, member status,
 * summary views, events, and live configuration retrieval.
 *
 * All state-changing endpoints require CSRF validation and appropriate
 * role-based access. Read endpoints require at least the 'viewer' role.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { CsrfGuard } from '../auth/CsrfGuard.js';
import { RbacGuard, RequireRoles } from '../auth/RbacGuard.js';
import { AuthRepository } from '../persistence/AuthRepository.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { AggregationEngine, type ClusterAggregate } from '../connector/AggregationEngine.js';
import { ClusterConnectorService } from '../connector/ClusterConnectorService.js';
import { MemberRestClient } from '../connector/MemberRestClient.js';
import { countConnectedMonitorCapableMembers, countMonitorCapableMembers, isAdminCapableMemberState, isMonitorCapableMemberState } from '../shared/memberCapabilities.js';
import { ValidationError, NotFoundError } from '../shared/errors.js';
import { nowMs } from '../shared/time.js';
import type {
  ClusterConfig,
  ClusterRecord,
  ClusterState,
  MemberState,
} from '../shared/types.js';

interface ClusterSummary {
  clusterId: string;
  displayName: string;
  clusterState: string;
  clusterSize: number;
  memberCount: number;
  connectedMembers: number;
  distributedObjectCount: number;
  partitionCount: number;
  blitz: ClusterState['blitz'] | null;
  aggregate: ClusterAggregate;
  lastUpdated: number;
}

interface MemberView {
  address: string;
  connected: boolean;
  lastSeen: number;
  info: MemberState['info'];
  error: string | null;
  latestSample: MemberState['latestSample'];
}

interface ClusterListItem {
  id: string;
  displayName: string;
  config: ClusterConfig;
  createdAt: number;
  updatedAt: number;
}

/** Matches the frontend's expected `ClusterSummary` type. */
interface ClusterSummaryView {
  clusterId: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  connectedMembers: number;
  totalMembers: number;
  lastUpdated: number;
  hasBlitz: boolean;
}

@Controller('api/clusters')
@UseGuards(RbacGuard)
export class ClustersController {
  private readonly logger = new Logger(ClustersController.name);

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly auditRepo: AuditRepository,
    private readonly stateStore: ClusterStateStore,
    private readonly aggregationEngine: AggregationEngine,
    private readonly connectorService: ClusterConnectorService,
    private readonly restClient: MemberRestClient,
  ) {}

  // ── GET /api/clusters ──────────────────────────────────────────────────

  /**
   * Returns a list of all clusters with live state from the state store,
   * enriched with DB record metadata. The frontend expects `ClusterSummary[]`
   * with live fields like `clusterState`, `connectedMembers`, etc.
   */
  @Get()
  @RequireRoles('viewer')
  async listClusters(): Promise<ClusterSummaryView[]> {
    const records = await this.authRepo.listClusters();
    const allStates = this.stateStore.getAllClusterStates();

    // Merge DB records with live state — DB is the source of truth for
    // which clusters exist, state store provides live operational data.
    const result: ClusterSummaryView[] = [];

    for (const record of records) {
      const state = allStates.get(record.id);
      let connectedMembers = 0;
      let totalMembers = 0;

      if (state) {
        totalMembers = countMonitorCapableMembers(state);
        connectedMembers = countConnectedMonitorCapableMembers(state);
      }

      result.push({
        clusterId: record.id,
        clusterName: state?.clusterName ?? record.displayName,
        clusterState: state?.clusterState ?? 'UNKNOWN',
        clusterSize: state?.clusterSize ?? 0,
        connectedMembers,
        totalMembers,
        lastUpdated: state?.lastUpdated ?? record.updatedAt,
        hasBlitz: state?.blitz !== undefined && state?.blitz !== null,
      });
    }

    // Also include any live clusters not yet in the DB
    // (e.g. programmatically connected via extension before DB persist)
    for (const [clusterId, state] of allStates) {
      if (result.some(r => r.clusterId === clusterId)) continue;

      result.push({
        clusterId,
        clusterName: state.clusterName,
        clusterState: state.clusterState,
        clusterSize: state.clusterSize,
        connectedMembers: countConnectedMonitorCapableMembers(state),
        totalMembers: countMonitorCapableMembers(state),
        lastUpdated: state.lastUpdated,
        hasBlitz: state.blitz !== undefined && state.blitz !== null,
      });
    }

    return result;
  }

  // ── POST /api/clusters ─────────────────────────────────────────────────

  @Post()
  @HttpCode(201)
  @UseGuards(CsrfGuard)
  @RequireRoles('admin')
  async createCluster(
    @Body() body: Partial<ClusterConfig>,
    @Req() req: any,
  ): Promise<{ id: string }> {
    const config = validateClusterConfig(body);
    const now = nowMs();

    const record: ClusterRecord = {
      id: config.id,
      displayName: config.displayName,
      configJson: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    };

    await this.authRepo.upsertCluster(record);

    // Connect to the cluster
    this.connectorService.connectCluster(config.id, config);

    // Audit log
    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'cluster.created',
      clusterId: config.id,
      targetType: 'cluster',
      targetId: config.id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ displayName: config.displayName, memberAddresses: config.memberAddresses }),
      createdAt: now,
    });

    this.logger.log(`Cluster ${config.id} created by ${extractUserId(req)}`);

    return { id: config.id };
  }

  // ── PUT /api/clusters/:id ──────────────────────────────────────────────

  @Put(':id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequireRoles('admin')
  async updateCluster(
    @Param('id') id: string,
    @Body() body: Partial<ClusterConfig>,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    const existing = await this.authRepo.getClusterById(id);
    if (!existing) {
      throw new NotFoundError(`Cluster ${id} not found`);
    }

    const existingConfig = JSON.parse(existing.configJson) as ClusterConfig;
    const updated: ClusterConfig = {
      ...existingConfig,
      ...body,
      id, // Ensure ID cannot be changed
    };

    validateClusterConfig(updated);

    await this.authRepo.updateCluster(id, updated.displayName, JSON.stringify(updated));

    // Check if addresses changed — reconnect if so
    const addressesChanged =
      JSON.stringify(existingConfig.memberAddresses.sort()) !==
      JSON.stringify(updated.memberAddresses.sort());

    if (addressesChanged) {
      this.connectorService.disconnectCluster(id);
      this.connectorService.connectCluster(id, updated);
      this.logger.log(`Cluster ${id} reconnected due to address changes`);
    }

    // Audit log
    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'cluster.updated',
      clusterId: id,
      targetType: 'cluster',
      targetId: id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ displayName: updated.displayName, addressesChanged }),
      createdAt: nowMs(),
    });

    return { ok: true };
  }

  // ── DELETE /api/clusters/:id ───────────────────────────────────────────

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @RequireRoles('admin')
  async deleteCluster(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ ok: true }> {
    const existing = await this.authRepo.getClusterById(id);
    if (!existing) {
      throw new NotFoundError(`Cluster ${id} not found`);
    }

    // Disconnect SSE clients first
    this.connectorService.disconnectCluster(id);

    // Remove from DB
    await this.authRepo.deleteCluster(id);

    // Audit log
    await this.auditRepo.insertAuditEntry({
      actorUserId: extractUserId(req),
      actionType: 'cluster.deleted',
      clusterId: id,
      targetType: 'cluster',
      targetId: id,
      requestId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ displayName: existing.displayName }),
      createdAt: nowMs(),
    });

    this.logger.log(`Cluster ${id} deleted by ${extractUserId(req)}`);

    return { ok: true };
  }

  // ── GET /api/clusters/:id/summary ──────────────────────────────────────

  @Get(':id/summary')
  @RequireRoles('viewer')
  async clusterSummary(@Param('id') id: string): Promise<ClusterSummary> {
    const state = this.stateStore.getClusterState(id);
    if (!state) {
      // Fall back to DB to check if cluster exists
      const record = await this.authRepo.getClusterById(id);
      if (!record) {
        throw new NotFoundError(`Cluster ${id} not found`);
      }

      // Cluster exists but no live state — return empty summary
      return {
        clusterId: id,
        displayName: record.displayName,
        clusterState: 'UNKNOWN',
        clusterSize: 0,
        memberCount: 0,
        connectedMembers: 0,
        distributedObjectCount: 0,
        partitionCount: 0,
        blitz: null,
        aggregate: this.aggregationEngine.computeClusterAggregate({
          ...state!,
          clusterId: id,
          clusterName: record.displayName,
          clusterState: 'UNKNOWN',
          clusterSize: 0,
          members: new Map(),
          distributedObjects: [],
          partitions: { partitionCount: 0, memberPartitions: {} },
          mapStats: {},
          queueStats: {},
          topicStats: {},
          lastUpdated: 0,
        }),
        lastUpdated: 0,
      };
    }

    const aggregate = this.aggregationEngine.computeClusterAggregate(state);

    return {
      clusterId: state.clusterId,
      displayName: state.clusterName,
      clusterState: state.clusterState,
      clusterSize: state.clusterSize,
      memberCount: countMonitorCapableMembers(state),
      connectedMembers: countConnectedMonitorCapableMembers(state),
      distributedObjectCount: state.distributedObjects.length,
      partitionCount: state.partitions.partitionCount,
      blitz: state.blitz ?? null,
      aggregate,
      lastUpdated: state.lastUpdated,
    };
  }

  // ── GET /api/clusters/:id/members ──────────────────────────────────────

  @Get(':id/members')
  @RequireRoles('viewer')
  async listMembers(@Param('id') id: string): Promise<{ members: MemberView[] }> {
    const state = this.stateStore.getClusterState(id);
    if (!state) {
      const record = await this.authRepo.getClusterById(id);
      if (!record) {
        throw new NotFoundError(`Cluster ${id} not found`);
      }
      return { members: [] };
    }

    const members: MemberView[] = [];
    for (const member of state.members.values()) {
      if (!isMonitorCapableMemberState(member)) {
        continue;
      }

      members.push({
        address: member.address,
        connected: member.connected,
        lastSeen: member.lastSeen,
        info: member.info,
        error: member.error,
        latestSample: member.latestSample,
      });
    }

    // Sort by address for stable ordering
    members.sort((a, b) => a.address.localeCompare(b.address));

    return { members };
  }

  // NOTE: GET /api/clusters/:id/events is handled by EventsController.

  // ── GET /api/clusters/:id/config ───────────────────────────────────────

  @Get(':id/config')
  @RequireRoles('viewer')
  async clusterConfig(@Param('id') id: string): Promise<{ config: unknown }> {
    const state = this.stateStore.getClusterState(id);
    if (!state) {
      const record = await this.authRepo.getClusterById(id);
      if (!record) {
        throw new NotFoundError(`Cluster ${id} not found`);
      }
      return { config: null };
    }

    // Find a connected member to fetch live config from
    const record = await this.authRepo.getClusterById(id);
    const clusterConfig = record ? (JSON.parse(record.configJson) as ClusterConfig) : null;

    for (const member of state.members.values()) {
      if (member.connected && member.restAddress && isAdminCapableMemberState(member)) {
        const liveConfig = await this.restClient.fetchConfig(
          member.restAddress,
          clusterConfig?.authToken,
        );
        return { config: liveConfig };
      }
    }

    return { config: null };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractUserId(req: any): string {
  return req.mcUser?.id ?? 'system';
}

function validateClusterConfig(body: Partial<ClusterConfig>): ClusterConfig {
  if (!body.id || typeof body.id !== 'string' || body.id.trim().length === 0) {
    throw new ValidationError('id is required');
  }
  if (!body.displayName || typeof body.displayName !== 'string' || body.displayName.trim().length === 0) {
    throw new ValidationError('displayName is required');
  }
  if (!Array.isArray(body.memberAddresses) || body.memberAddresses.length === 0) {
    throw new ValidationError('memberAddresses must be a non-empty array');
  }
  for (const addr of body.memberAddresses) {
    if (typeof addr !== 'string' || addr.trim().length === 0) {
      throw new ValidationError('Each memberAddress must be a non-empty string');
    }
  }
  if (body.restPort !== undefined && (typeof body.restPort !== 'number' || body.restPort < 1 || body.restPort > 65535)) {
    throw new ValidationError('restPort must be a valid port number (1-65535)');
  }

  return {
    id: body.id.trim(),
    displayName: body.displayName.trim(),
    memberAddresses: body.memberAddresses.map((a) => a.trim()),
    restPort: body.restPort ?? 2702,
    sslEnabled: body.sslEnabled ?? false,
    authToken: body.authToken,
    autoDiscover: body.autoDiscover ?? true,
    requestTimeoutMs: body.requestTimeoutMs ?? 5000,
    stalenessWindowMs: body.stalenessWindowMs ?? 30000,
  };
}
