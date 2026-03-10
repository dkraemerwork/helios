/**
 * Cluster administration service for state transitions.
 *
 * Manages ACTIVE/PASSIVE/FROZEN cluster state changes by delegating to the
 * REST API of a connected member. Prevents duplicate in-flight transitions
 * per cluster, writes audit log entries with before/after state, and verifies
 * post-action state via the health endpoint.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClusterStateStore } from '../connector/ClusterStateStore.js';
import { MemberRestClient } from '../connector/MemberRestClient.js';
import { AuditRepository } from '../persistence/AuditRepository.js';
import { ConfigService } from '../config/ConfigService.js';
import { NotFoundError, ConnectorError, ConflictError } from '../shared/errors.js';
import { isAdminCapableMemberState } from '../shared/memberCapabilities.js';
import { nowMs } from '../shared/time.js';
import type { AuditLogEntry, ClusterConfig } from '../shared/types.js';

type ClusterAdminState = 'ACTIVE' | 'PASSIVE' | 'FROZEN';

@Injectable()
export class ClusterAdminService {
  private readonly logger = new Logger(ClusterAdminService.name);

  /** Tracks in-flight cluster state transitions to prevent duplicates. */
  private readonly inFlightTransitions = new Set<string>();

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly restClient: MemberRestClient,
    private readonly auditRepository: AuditRepository,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Transitions a cluster to the specified state.
   *
   * Prevents duplicate concurrent transitions for the same cluster.
   * Writes an audit entry with before/after state and verifies the
   * post-action state via the member's health endpoint.
   */
  async setClusterState(
    clusterId: string,
    state: ClusterAdminState,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Guard against duplicate in-flight transitions
    if (this.inFlightTransitions.has(clusterId)) {
      return { success: false, error: 'A state transition is already in progress for this cluster' };
    }

    this.inFlightTransitions.add(clusterId);

    try {
      const { restUrl, authToken, previousState } = this.resolveClusterTarget(clusterId);

      // Execute state transition
      await this.restClient.postClusterState(restUrl, state, authToken);

      // Verify post-action state
      let verifiedState: string | null = null;
      try {
        const health = await this.restClient.fetchHealth(restUrl);
        verifiedState = (health as Record<string, unknown>)['clusterState'] as string ?? null;
      } catch {
        this.logger.warn(`Could not verify post-transition state for cluster ${clusterId}`);
      }

      // Write audit entry
      await this.writeAudit({
        actorUserId,
        actionType: 'cluster.state.change',
        clusterId,
        targetType: 'cluster',
        targetId: clusterId,
        requestId,
        detailsJson: JSON.stringify({
          previousState,
          requestedState: state,
          verifiedState,
        }),
        createdAt: nowMs(),
      });

      // Emit events
      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'setClusterState',
        state,
        actorUserId,
        requestId,
      });

      this.eventEmitter.emit('cluster.stateChanged', {
        clusterId,
        previousState,
        newState: state,
        verifiedState,
      });

      this.logger.log(
        `Cluster ${clusterId} state changed: ${previousState} -> ${state} (verified: ${verifiedState ?? 'unknown'})`,
      );

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to set cluster state for ${clusterId}: ${message}`);

      return { success: false, error: message };
    } finally {
      this.inFlightTransitions.delete(clusterId);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private resolveClusterTarget(clusterId: string): { restUrl: string; authToken: string | undefined; previousState: string } {
    const clusterState = this.stateStore.getClusterState(clusterId);
    if (!clusterState) {
      throw new NotFoundError(`Cluster ${clusterId} not found`);
    }

    const previousState = clusterState.clusterState;
    const authToken = this.getClusterAuthToken(clusterId);

    for (const [, member] of clusterState.members) {
      if (member.connected && member.restAddress && isAdminCapableMemberState(member)) {
        return { restUrl: member.restAddress, authToken, previousState };
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
