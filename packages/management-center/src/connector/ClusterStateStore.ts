/**
 * In-memory store for cluster and member state.
 *
 * Maintains a Map<clusterId, ClusterState> that is continuously updated
 * from SSE payloads and metric samples. Provides the current view of
 * all monitored clusters for the WebSocket gateway, REST API, and
 * aggregation engine. Not persisted — rebuilt from SSE streams on startup.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MAX_SAMPLES_IN_MEMORY } from '../shared/constants.js';
import { nowMs } from '../shared/time.js';
import type {
  ClusterState,
  MemberState,
  MemberMetricsSample,
  MonitorPayload,
  MemberInfo,
  DistributedObjectInfo,
  PartitionInfo,
  BlitzInfo,
} from '../shared/types.js';

@Injectable()
export class ClusterStateStore {
  private readonly logger = new Logger(ClusterStateStore.name);
  private readonly clusters = new Map<string, ClusterState>();

  /** Returns the state for a single cluster, or undefined if not tracked. */
  getClusterState(clusterId: string): ClusterState | undefined {
    return this.clusters.get(clusterId);
  }

  /** Returns the full map of all cluster states. */
  getAllClusterStates(): Map<string, ClusterState> {
    return this.clusters;
  }

  /** Initializes a new cluster entry with empty state. */
  initCluster(clusterId: string, clusterName: string): void {
    if (this.clusters.has(clusterId)) {
      this.logger.debug(`Cluster ${clusterId} already initialized, skipping`);
      return;
    }

    this.clusters.set(clusterId, {
      clusterId,
      clusterName,
      clusterState: 'UNKNOWN',
      clusterSize: 0,
      members: new Map(),
      distributedObjects: [],
      partitions: { partitionCount: 0, memberPartitions: {} },
      mapStats: {},
      queueStats: {},
      topicStats: {},
      lastUpdated: nowMs(),
    });

    this.logger.log(`Initialized cluster state for ${clusterId} (${clusterName})`);
  }

  /** Removes a cluster and all its member state from the store. */
  removeCluster(clusterId: string): void {
    this.clusters.delete(clusterId);
    this.logger.log(`Removed cluster state for ${clusterId}`);
  }

  /**
   * Updates cluster-level and member-level state from a MonitorPayload.
   *
   * This merges cluster metadata (state, size, objects, partitions, blitz,
   * stats) and upserts member info. Members present in the payload but not
   * yet tracked are auto-created. Payload.samples are intentionally ignored
   * — samples arrive via the dedicated onSample callback.
   */
  updateFromPayload(
    clusterId: string,
    memberAddr: string,
    payload: MonitorPayload,
  ): void {
    const state = this.getOrCreateCluster(clusterId, payload.clusterName);
    const now = nowMs();

    // Update cluster-level fields
    state.clusterState = payload.clusterState;
    state.clusterSize = payload.clusterSize;
    state.distributedObjects = payload.distributedObjects;
    state.partitions = payload.partitions;
    state.lastUpdated = now;

    if (payload.blitz) {
      state.blitz = payload.blitz;
    }
    if (payload.mapStats) {
      state.mapStats = payload.mapStats;
    }
    if (payload.queueStats) {
      state.queueStats = payload.queueStats;
    }
    if (payload.topicStats) {
      state.topicStats = payload.topicStats;
    }

    // Update member info from the payload's member list
    for (const memberInfo of payload.members) {
      const addr = memberInfo.address;
      const existing = state.members.get(addr);

      if (existing) {
        existing.info = memberInfo;
        existing.lastSeen = now;
      } else {
        // Auto-discovered member — create entry without REST address
        // (the connector service will populate restAddress separately)
        state.members.set(addr, {
          address: addr,
          restAddress: '',
          connected: false,
          lastSeen: now,
          latestSample: null,
          recentSamples: [],
          info: memberInfo,
          error: null,
        });
      }
    }

    // Update the reporting member's lastSeen
    const reporter = state.members.get(memberAddr);
    if (reporter) {
      reporter.lastSeen = now;
    }
  }

  /**
   * Updates a member's latest sample and appends to the recent samples ring.
   * Caps recentSamples at MAX_SAMPLES_IN_MEMORY.
   */
  updateFromSample(
    clusterId: string,
    memberAddr: string,
    sample: MemberMetricsSample,
  ): void {
    const state = this.clusters.get(clusterId);
    if (!state) return;

    const member = state.members.get(memberAddr);
    if (!member) return;

    member.latestSample = sample;
    member.lastSeen = nowMs();

    member.recentSamples.push(sample);
    if (member.recentSamples.length > MAX_SAMPLES_IN_MEMORY) {
      member.recentSamples = member.recentSamples.slice(
        member.recentSamples.length - MAX_SAMPLES_IN_MEMORY,
      );
    }
  }

  /** Marks a member as connected and records its REST address. */
  setMemberConnected(
    clusterId: string,
    memberAddr: string,
    restAddr: string,
  ): void {
    const state = this.getOrCreateCluster(clusterId, clusterId);
    let member = state.members.get(memberAddr);

    if (!member) {
      member = createEmptyMember(memberAddr, restAddr);
      state.members.set(memberAddr, member);
    }

    member.connected = true;
    member.restAddress = restAddr;
    member.error = null;
    member.lastSeen = nowMs();
  }

  /** Marks a member as disconnected. */
  setMemberDisconnected(clusterId: string, memberAddr: string): void {
    const state = this.clusters.get(clusterId);
    if (!state) return;

    const member = state.members.get(memberAddr);
    if (!member) return;

    member.connected = false;
  }

  /** Records an error for a specific member. */
  setMemberError(clusterId: string, memberAddr: string, error: string): void {
    const state = this.clusters.get(clusterId);
    if (!state) return;

    const member = state.members.get(memberAddr);
    if (!member) return;

    member.error = error;
  }

  /**
   * Marks members whose lastSeen is older than the staleness window.
   * Stale members have their connected flag set to false.
   */
  markStaleMembers(clusterId: string, stalenessWindowMs: number): void {
    const state = this.clusters.get(clusterId);
    if (!state) return;

    const cutoff = nowMs() - stalenessWindowMs;

    for (const [addr, member] of state.members) {
      if (member.connected && member.lastSeen < cutoff) {
        member.connected = false;
        this.logger.warn(
          `Member ${addr} in cluster ${clusterId} marked stale ` +
            `(last seen ${Math.round((nowMs() - member.lastSeen) / 1000)}s ago)`,
        );
      }
    }
  }

  private getOrCreateCluster(clusterId: string, clusterName: string): ClusterState {
    let state = this.clusters.get(clusterId);

    if (!state) {
      this.initCluster(clusterId, clusterName);
      state = this.clusters.get(clusterId)!;
    }

    return state;
  }
}

function createEmptyMember(address: string, restAddress: string): MemberState {
  return {
    address,
    restAddress,
    connected: false,
    lastSeen: nowMs(),
    latestSample: null,
    recentSamples: [],
    info: null,
    error: null,
  };
}
