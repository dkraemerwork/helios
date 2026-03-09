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
  private readonly memberClusterData = new Map<string, Map<string, MemberClusterData>>();

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
    this.memberClusterData.delete(clusterId);
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
    state.partitions = payload.partitions;
    state.lastUpdated = now;
    state.blitz = payload.blitz ?? state.blitz;

    this.storeMemberClusterData(clusterId, memberAddr, payload);
    const aggregatedData = this.aggregateClusterData(clusterId);
    state.distributedObjects = aggregatedData.distributedObjects;
    state.mapStats = aggregatedData.mapStats;
    state.queueStats = aggregatedData.queueStats;
    state.topicStats = aggregatedData.topicStats;

    // Update member info from the payload's member list
    for (const memberInfo of payload.members) {
      const addr = memberInfo.address;
      const existing = state.members.get(addr);

      if (existing) {
        existing.info = mergeMemberInfo(existing.info, memberInfo);
        if (memberInfo.restAddress) {
          existing.restAddress = memberInfo.restAddress;
        }
        existing.lastSeen = now;
      } else {
        state.members.set(addr, {
          address: addr,
          restAddress: memberInfo.restAddress ?? '',
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

  canonicalizeMemberAddress(
    clusterId: string,
    currentAddr: string,
    canonicalAddr: string,
    restAddress?: string | null,
  ): void {
    const state = this.clusters.get(clusterId);
    if (!state || currentAddr === canonicalAddr) {
      if (restAddress) {
        this.setMemberConnected(clusterId, canonicalAddr, restAddress);
      }
      return;
    }

    const current = state.members.get(currentAddr);
    const canonical = state.members.get(canonicalAddr);
    const merged = mergeMemberState(current, canonical, restAddress ?? null);
    const currentData = this.memberClusterData.get(clusterId)?.get(currentAddr);
    const canonicalData = this.memberClusterData.get(clusterId)?.get(canonicalAddr);
    const clusterData = this.memberClusterData.get(clusterId);

    state.members.set(canonicalAddr, merged);
    state.members.delete(currentAddr);

    if (clusterData && currentData) {
      clusterData.set(canonicalAddr, canonicalData ? mergeMemberClusterData(canonicalData, currentData) : currentData);
      clusterData.delete(currentAddr);
      const aggregatedData = this.aggregateClusterData(clusterId);
      state.distributedObjects = aggregatedData.distributedObjects;
      state.mapStats = aggregatedData.mapStats;
      state.queueStats = aggregatedData.queueStats;
      state.topicStats = aggregatedData.topicStats;
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
    this.pruneMemberClusterData(clusterId, memberAddr);
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
        this.pruneMemberClusterData(clusterId, addr);
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

  private storeMemberClusterData(
    clusterId: string,
    memberAddr: string,
    payload: MonitorPayload,
  ): void {
    let clusterData = this.memberClusterData.get(clusterId);
    if (!clusterData) {
      clusterData = new Map();
      this.memberClusterData.set(clusterId, clusterData);
    }

    clusterData.set(memberAddr, {
      distributedObjects: payload.distributedObjects,
      mapStats: normalizeStats(payload.mapStats),
      queueStats: normalizeStats(payload.queueStats),
      topicStats: normalizeStats(payload.topicStats),
    });
  }

  private aggregateClusterData(clusterId: string): AggregatedClusterData {
    const clusterData = this.memberClusterData.get(clusterId);
    if (!clusterData) {
      return EMPTY_AGGREGATED_CLUSTER_DATA;
    }

    const distributedObjects = new Map<string, DistributedObjectInfo>();
    let mapStats: Record<string, unknown> = {};
    let queueStats: Record<string, unknown> = {};
    let topicStats: Record<string, unknown> = {};

    for (const memberData of clusterData.values()) {
      for (const distributedObject of memberData.distributedObjects) {
        distributedObjects.set(
          `${distributedObject.serviceName}:${distributedObject.name}`,
          distributedObject,
        );
      }

      mapStats = mergeStatsRecord(mapStats, memberData.mapStats);
      queueStats = mergeStatsRecord(queueStats, memberData.queueStats);
      topicStats = mergeStatsRecord(topicStats, memberData.topicStats);
    }

    return {
      distributedObjects: Array.from(distributedObjects.values()).sort(compareDistributedObjects),
      mapStats,
      queueStats,
      topicStats,
    };
  }

  private pruneMemberClusterData(clusterId: string, memberAddr: string): void {
    const clusterData = this.memberClusterData.get(clusterId);
    const state = this.clusters.get(clusterId);
    if (!clusterData || !state) {
      return;
    }

    if (!clusterData.delete(memberAddr)) {
      return;
    }

    const aggregatedData = this.aggregateClusterData(clusterId);
    state.distributedObjects = aggregatedData.distributedObjects;
    state.mapStats = aggregatedData.mapStats;
    state.queueStats = aggregatedData.queueStats;
    state.topicStats = aggregatedData.topicStats;

    if (clusterData.size === 0) {
      this.memberClusterData.delete(clusterId);
    }
  }
}

interface MemberClusterData {
  distributedObjects: DistributedObjectInfo[];
  mapStats: Record<string, unknown>;
  queueStats: Record<string, unknown>;
  topicStats: Record<string, unknown>;
}

interface AggregatedClusterData {
  distributedObjects: DistributedObjectInfo[];
  mapStats: Record<string, unknown>;
  queueStats: Record<string, unknown>;
  topicStats: Record<string, unknown>;
}

const EMPTY_AGGREGATED_CLUSTER_DATA: AggregatedClusterData = {
  distributedObjects: [],
  mapStats: {},
  queueStats: {},
  topicStats: {},
};

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

function mergeMemberInfo(existing: MemberInfo | null, incoming: MemberInfo): MemberInfo {
  return {
    ...incoming,
    restAddress: incoming.restAddress ?? existing?.restAddress ?? null,
  };
}

function mergeMemberState(
  current: MemberState | undefined,
  canonical: MemberState | undefined,
  restAddress: string | null,
): MemberState {
  const address = canonical?.address ?? current?.address ?? '';
  const latestSample = pickLatestSample(current?.latestSample ?? null, canonical?.latestSample ?? null);
  const recentSamples = [...(current?.recentSamples ?? []), ...(canonical?.recentSamples ?? [])]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-MAX_SAMPLES_IN_MEMORY);

  return {
    address,
    restAddress: restAddress ?? canonical?.restAddress ?? current?.restAddress ?? '',
    connected: (canonical?.connected ?? false) || (current?.connected ?? false),
    lastSeen: Math.max(canonical?.lastSeen ?? 0, current?.lastSeen ?? 0, nowMs()),
    latestSample,
    recentSamples,
    info: canonical?.info ?? current?.info ?? null,
    error: canonical?.error ?? current?.error ?? null,
  };
}

function pickLatestSample(
  left: MemberMetricsSample | null,
  right: MemberMetricsSample | null,
): MemberMetricsSample | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left.timestamp >= right.timestamp ? left : right;
}

function normalizeStats(stats: Record<string, unknown> | undefined): Record<string, unknown> {
  return isRecord(stats) ? stats : {};
}

function mergeStatsRecord(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(incoming).length === 0) {
    return current;
  }

  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = mergeStatsValue(key, merged[key], value);
  }
  return merged;
}

function mergeStatsValue(key: string, left: unknown, right: unknown): unknown {
  if (left === undefined) {
    return cloneStatsValue(right);
  }
  if (right === undefined) {
    return left;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return shouldUseMaxForNumericField(key) ? Math.max(left, right) : left + right;
  }
  if (isRecord(left) && isRecord(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [nestedKey, nestedValue] of Object.entries(right)) {
      merged[nestedKey] = mergeStatsValue(nestedKey, merged[nestedKey], nestedValue);
    }
    return merged;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return [...left, ...right];
  }
  return cloneStatsValue(right);
}

function cloneStatsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => cloneStatsValue(entry));
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneStatsValue(entry);
    }
    return clone;
  }
  return value;
}

function shouldUseMaxForNumericField(key: string): boolean {
  return /(time|timestamp)$/i.test(key) || /^last[A-Z_]/.test(key) || /^creationTime$/i.test(key);
}

function compareDistributedObjects(left: DistributedObjectInfo, right: DistributedObjectInfo): number {
  return left.name.localeCompare(right.name) || left.serviceName.localeCompare(right.serviceName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeMemberClusterData(
  existing: MemberClusterData,
  incoming: MemberClusterData,
): MemberClusterData {
  return {
    distributedObjects: Array.from(
      new Map(
        [...existing.distributedObjects, ...incoming.distributedObjects].map(distributedObject => [
          `${distributedObject.serviceName}:${distributedObject.name}`,
          distributedObject,
        ]),
      ).values(),
    ),
    mapStats: mergeStatsRecord(existing.mapStats, incoming.mapStats),
    queueStats: mergeStatsRecord(existing.queueStats, incoming.queueStats),
    topicStats: mergeStatsRecord(existing.topicStats, incoming.topicStats),
  };
}
