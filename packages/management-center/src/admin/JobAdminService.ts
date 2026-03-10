/**
 * Job administration service for cancellation and restart operations.
 *
 * Delegates to MemberRestClient for job control, writes audit log entries,
 * and emits events for downstream consumers.
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
export class JobAdminService {
  private readonly logger = new Logger(JobAdminService.name);

  constructor(
    private readonly stateStore: ClusterStateStore,
    private readonly restClient: MemberRestClient,
    private readonly auditRepository: AuditRepository,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Cancels a running job on the specified cluster. */
  async cancelJob(
    clusterId: string,
    jobId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { restUrl, authToken } = this.resolveClusterTarget(clusterId);

      await this.restClient.postJobCancel(restUrl, jobId, authToken);

      await this.writeAudit({
        actorUserId,
        actionType: 'job.cancel',
        clusterId,
        targetType: 'job',
        targetId: jobId,
        requestId,
        detailsJson: JSON.stringify({ jobId, action: 'cancel' }),
        createdAt: nowMs(),
      });

      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'cancelJob',
        jobId,
        actorUserId,
        requestId,
      });

      this.logger.log(`Job ${jobId} cancelled in cluster ${clusterId} by ${actorUserId}`);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to cancel job ${jobId} in cluster ${clusterId}: ${message}`);
      return { success: false, error: message };
    }
  }

  /** Restarts a job on the specified cluster. */
  async restartJob(
    clusterId: string,
    jobId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { restUrl, authToken } = this.resolveClusterTarget(clusterId);

      await this.restClient.postJobRestart(restUrl, jobId, authToken);

      await this.writeAudit({
        actorUserId,
        actionType: 'job.restart',
        clusterId,
        targetType: 'job',
        targetId: jobId,
        requestId,
        detailsJson: JSON.stringify({ jobId, action: 'restart' }),
        createdAt: nowMs(),
      });

      this.eventEmitter.emit('admin.action.completed', {
        clusterId,
        action: 'restartJob',
        jobId,
        actorUserId,
        requestId,
      });

      this.logger.log(`Job ${jobId} restarted in cluster ${clusterId} by ${actorUserId}`);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to restart job ${jobId} in cluster ${clusterId}: ${message}`);
      return { success: false, error: message };
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
