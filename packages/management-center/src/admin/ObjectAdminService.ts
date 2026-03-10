/**
 * Data structure administration service for map operations and GC.
 *
 * Provides map clear/evict and garbage collection trigger via the REST
 * API of connected cluster members. Each action writes an audit entry
 * and emits an event. Handles graceful rejection when a member does
 * not support the requested operation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { MemberRestClient } from '../connector/MemberRestClient.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { ConfigService } from '../config/ConfigService.js';
import { NotFoundError, ConnectorError } from '../shared/errors.js';
import { isAdminCapableMemberState } from '../shared/memberCapabilities.js';
import { nowMs } from '../shared/time.js';
import type { AuditLogEntry } from '../shared/types.js';

@Injectable()
export class ObjectAdminService {
  private readonly logger = new Logger(ObjectAdminService.name);

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly restClient: MemberRestClient,
    private readonly auditRepository: AuditRepository,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Clears all entries from a distributed map. */
  async clearMap(
    clusterId: string,
    mapName: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { restUrl, authToken } = this.resolveClusterTarget(clusterId);

      await this.restClient.postMapClear(restUrl, mapName, authToken);

      await this.writeAudit({
        actorUserId,
        actionType: 'map.clear',
        clusterId,
        targetType: 'map',
        targetId: mapName,
        requestId,
        detailsJson: JSON.stringify({ mapName, action: 'clear' }),
        createdAt: nowMs(),
      });

      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'clearMap',
        mapName,
        actorUserId,
        requestId,
      });

      this.logger.log(`Map '${mapName}' cleared in cluster ${clusterId} by ${actorUserId}`);

      return { success: true };
    } catch (err) {
      return this.handleOperationError('clearMap', mapName, clusterId, err);
    }
  }

  /** Evicts all entries from a distributed map (removes without triggering MapStore delete). */
  async evictMap(
    clusterId: string,
    mapName: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { restUrl, authToken } = this.resolveClusterTarget(clusterId);

      await this.restClient.postMapEvict(restUrl, mapName, authToken);

      await this.writeAudit({
        actorUserId,
        actionType: 'map.evict',
        clusterId,
        targetType: 'map',
        targetId: mapName,
        requestId,
        detailsJson: JSON.stringify({ mapName, action: 'evict' }),
        createdAt: nowMs(),
      });

      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'evictMap',
        mapName,
        actorUserId,
        requestId,
      });

      this.logger.log(`Map '${mapName}' evicted in cluster ${clusterId} by ${actorUserId}`);

      return { success: true };
    } catch (err) {
      return this.handleOperationError('evictMap', mapName, clusterId, err);
    }
  }

  /** Triggers garbage collection on the connected cluster member. */
  async triggerGc(
    clusterId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { restUrl, authToken } = this.resolveClusterTarget(clusterId);

      await this.restClient.postGc(restUrl, authToken);

      await this.writeAudit({
        actorUserId,
        actionType: 'cluster.gc',
        clusterId,
        targetType: 'cluster',
        targetId: clusterId,
        requestId,
        detailsJson: JSON.stringify({ action: 'gc' }),
        createdAt: nowMs(),
      });

      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'triggerGc',
        actorUserId,
        requestId,
      });

      this.logger.log(`GC triggered in cluster ${clusterId} by ${actorUserId}`);

      return { success: true };
    } catch (err) {
      return this.handleOperationError('triggerGc', null, clusterId, err);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private resolveClusterTarget(clusterId: string): { restUrl: string; authToken: string | undefined } {
    const clusterState = this.stateStore.getClusterState(clusterId);
    if (!clusterState) {
      throw new NotFoundError(`Cluster ${clusterId} not found`);
    }

    const authToken = this.getClusterAuthToken(clusterId);

    for (const [, member] of clusterState.members) {
      if (member.connected && member.restAddress && isAdminCapableMemberState(member)) {
        return { restUrl: member.restAddress, authToken };
      }
    }

    throw new ConnectorError(`No connected members available in cluster ${clusterId}`);
  }

  private getClusterAuthToken(clusterId: string): string | undefined {
    for (const config of this.configService.clusters) {
      if (config.id === clusterId) {
        return config.authToken;
      }
    }
    return undefined;
  }

  /**
   * Handles operation errors with graceful degradation.
   * If the error indicates the endpoint is not supported (404), reports
   * it as an unsupported operation rather than a hard failure.
   */
  private handleOperationError(
    operation: string,
    target: string | null,
    clusterId: string,
    err: unknown,
  ): { success: boolean; error: string } {
    const message = err instanceof Error ? err.message : String(err);

    // Check if the member rejected because it doesn't support the operation
    if (message.includes('not found') || message.includes('404')) {
      const detail = target ? ` on '${target}'` : '';
      this.logger.warn(
        `Operation ${operation}${detail} not supported by cluster ${clusterId}`,
      );
      return { success: false, error: `Operation ${operation} is not supported by this cluster member` };
    }

    this.logger.error(
      `Failed to execute ${operation} in cluster ${clusterId}: ${message}`,
    );
    return { success: false, error: message };
  }

  private async writeAudit(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditRepository.insertAuditEntry(entry);
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
