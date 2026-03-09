import { Injectable, computed, signal } from '@angular/core';
import type {
  ClusterSummary,
  ClusterDetail,
  MemberSummary,
  MemberMetricsSample,
} from '../services/api.service';

// ── Store Types ──────────────────────────────────────────────────────────────

export interface ClusterStoreState {
  clusterId: string;
  clusterName: string;
  clusterState: string;
  clusterSize: number;
  members: Map<string, MemberStoreState>;
  distributedObjects: Array<{ serviceName: string; name: string }>;
  mapStats: Record<string, unknown>;
  queueStats: Record<string, unknown>;
  topicStats: Record<string, unknown>;
  blitz: unknown | null;
  lastUpdated: number;
  activeAlertCount: number;
}

export interface MemberStoreState {
  address: string;
  restAddress: string;
  connected: boolean;
  lastSeen: number;
  latestSample: MemberMetricsSample | null;
  recentSamples: MemberMetricsSample[];
  info: MemberSummary['info'];
  error: string | null;
}

const MAX_SAMPLES = 300;

/**
 * Signal-based reactive store for cluster state.
 *
 * Manages the in-memory representation of all connected clusters and their
 * members. Merges WebSocket live updates with SSR baseline state. Immutable
 * updates: never mutates Map in place, always produces new references.
 */
@Injectable({ providedIn: 'root' })
export class ClusterStore {
  /** Map of all cluster states keyed by cluster ID. */
  private readonly _clusters = signal<Map<string, ClusterStoreState>>(new Map());

  /** ID of the currently active/viewed cluster. */
  private readonly _activeClusterId = signal<string | null>(null);

  /** Public readonly signals. */
  readonly clusters = this._clusters.asReadonly();
  readonly activeClusterId = this._activeClusterId.asReadonly();

  /** Computed: the currently active cluster, or null. */
  readonly activeCluster = computed((): ClusterStoreState | null => {
    const id = this._activeClusterId();
    if (!id) return null;
    return this._clusters().get(id) ?? null;
  });

  /** Computed: members of the active cluster as a sorted array. */
  readonly members = computed((): MemberStoreState[] => {
    const cluster = this.activeCluster();
    if (!cluster) return [];
    return Array.from(cluster.members.values()).sort(
      (a, b) => a.address.localeCompare(b.address),
    );
  });

  /** Computed: summary array of all clusters for navigation. */
  readonly clusterList = computed((): ClusterSummary[] => {
    const result: ClusterSummary[] = [];
    for (const [, state] of this._clusters()) {
      let connectedMembers = 0;
      for (const [, member] of state.members) {
        if (member.connected) connectedMembers++;
      }
      result.push({
        clusterId: state.clusterId,
        clusterName: state.clusterName,
        clusterState: state.clusterState,
        clusterSize: state.clusterSize,
        connectedMembers,
        totalMembers: state.members.size,
        lastUpdated: state.lastUpdated,
        hasBlitz: state.blitz !== null && state.blitz !== undefined,
      });
    }
    return result;
  });

  // ── Setters ────────────────────────────────────────────────────────────

  setActiveCluster(clusterId: string | null): void {
    this._activeClusterId.set(clusterId);
  }

  /**
   * Initializes the store from SSR transfer state data.
   */
  initFromTransferState(data: Record<string, unknown>): void {
    const clusters = data['clusters'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(clusters)) {
      const map = new Map<string, ClusterStoreState>();
      for (const cluster of clusters) {
        const state = deserializeClusterSummary(cluster);
        map.set(state.clusterId, state);
      }
      this._clusters.set(map);
    }

    const cluster = data['cluster'] as Record<string, unknown> | undefined;
    if (cluster && typeof cluster === 'object') {
      const state = deserializeClusterDetail(cluster);
      const map = new Map(this._clusters());
      map.set(state.clusterId, state);
      this._clusters.set(map);
    }
  }

  /**
   * Merges a live WebSocket event into the store.
   * Always produces new Map references for proper signal change detection.
   */
  updateFromWs(event: string, data: unknown): void {
    switch (event) {
      case 'cluster:update':
        this.handleClusterUpdate(data as Record<string, unknown>);
        break;
      case 'member:sample':
        this.handleMemberSample(data as Record<string, unknown>);
        break;
      case 'data:update':
        this.handleDataUpdate(data as Record<string, unknown>);
        break;
      case 'jobs:update':
        this.handleJobsUpdate(data as Record<string, unknown>);
        break;
      case 'alert:fired':
      case 'alert:resolved':
        this.handleAlertEvent(event, data as Record<string, unknown>);
        break;
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────────

  private handleClusterUpdate(data: Record<string, unknown>): void {
    const clusterId = data['clusterId'] as string;
    if (!clusterId) return;

    const current = this._clusters();
    const existing = current.get(clusterId);

    const updated: ClusterStoreState = {
      clusterId,
      clusterName: (data['clusterName'] as string) ?? existing?.clusterName ?? '',
      clusterState: (data['clusterState'] as string) ?? existing?.clusterState ?? 'UNKNOWN',
      clusterSize: (data['clusterSize'] as number) ?? existing?.clusterSize ?? 0,
      members: existing?.members ?? new Map(),
      distributedObjects: (data['distributedObjects'] as ClusterStoreState['distributedObjects'])
        ?? existing?.distributedObjects ?? [],
      mapStats: (data['mapStats'] as Record<string, unknown>) ?? existing?.mapStats ?? {},
      queueStats: (data['queueStats'] as Record<string, unknown>) ?? existing?.queueStats ?? {},
      topicStats: (data['topicStats'] as Record<string, unknown>) ?? existing?.topicStats ?? {},
      blitz: data['blitz'] ?? existing?.blitz ?? null,
      lastUpdated: Date.now(),
      activeAlertCount: existing?.activeAlertCount ?? 0,
    };

    // Merge member updates if provided
    const memberUpdates = data['members'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(memberUpdates)) {
      const newMembers = new Map(updated.members);
      for (const memberData of memberUpdates) {
        const addr = memberData['address'] as string;
        if (!addr) continue;
        const existingMember = newMembers.get(addr);
        newMembers.set(addr, {
          address: addr,
          restAddress: (memberData['restAddress'] as string) ?? existingMember?.restAddress ?? addr,
          connected: (memberData['connected'] as boolean) ?? existingMember?.connected ?? false,
          lastSeen: (memberData['lastSeen'] as number) ?? Date.now(),
          latestSample: (memberData['latestSample'] as MemberMetricsSample)
            ?? existingMember?.latestSample ?? null,
          recentSamples: existingMember?.recentSamples ?? [],
          info: (memberData['info'] as MemberStoreState['info']) ?? existingMember?.info ?? null,
          error: (memberData['error'] as string) ?? existingMember?.error ?? null,
        });
      }
      updated.members = newMembers;
    }

    const newMap = new Map(current);
    newMap.set(clusterId, updated);
    this._clusters.set(newMap);
  }

  private handleMemberSample(data: Record<string, unknown>): void {
    const clusterId = data['clusterId'] as string;
    const memberAddr = data['memberAddr'] as string;
    const sample = data['sample'] as MemberMetricsSample;
    if (!clusterId || !memberAddr || !sample) return;

    const current = this._clusters();
    const cluster = current.get(clusterId);
    if (!cluster) return;

    const member = cluster.members.get(memberAddr);
    const newSamples = member?.recentSamples ? [...member.recentSamples] : [];
    newSamples.push(sample);
    if (newSamples.length > MAX_SAMPLES) {
      newSamples.splice(0, newSamples.length - MAX_SAMPLES);
    }

    const updatedMember: MemberStoreState = {
      address: memberAddr,
      restAddress: member?.restAddress ?? memberAddr,
      connected: true,
      lastSeen: sample.timestamp ?? Date.now(),
      latestSample: sample,
      recentSamples: newSamples,
      info: member?.info ?? null,
      error: null,
    };

    const newMembers = new Map(cluster.members);
    newMembers.set(memberAddr, updatedMember);

    const updatedCluster = { ...cluster, members: newMembers, lastUpdated: Date.now() };
    const newMap = new Map(current);
    newMap.set(clusterId, updatedCluster);
    this._clusters.set(newMap);
  }

  private handleDataUpdate(data: Record<string, unknown>): void {
    const clusterId = data['clusterId'] as string;
    if (!clusterId) return;

    const current = this._clusters();
    const cluster = current.get(clusterId);
    if (!cluster) return;

    const updatedCluster = {
      ...cluster,
      mapStats: (data['mapStats'] as Record<string, unknown>) ?? cluster.mapStats,
      queueStats: (data['queueStats'] as Record<string, unknown>) ?? cluster.queueStats,
      topicStats: (data['topicStats'] as Record<string, unknown>) ?? cluster.topicStats,
      distributedObjects: (data['distributedObjects'] as ClusterStoreState['distributedObjects'])
        ?? cluster.distributedObjects,
      lastUpdated: Date.now(),
    };

    const newMap = new Map(current);
    newMap.set(clusterId, updatedCluster);
    this._clusters.set(newMap);
  }

  private handleJobsUpdate(data: Record<string, unknown>): void {
    const clusterId = data['clusterId'] as string;
    if (!clusterId) return;

    const current = this._clusters();
    const cluster = current.get(clusterId);
    if (!cluster) return;

    const blitz = data['blitz'] ?? cluster.blitz;
    const updatedCluster = { ...cluster, blitz, lastUpdated: Date.now() };

    const newMap = new Map(current);
    newMap.set(clusterId, updatedCluster);
    this._clusters.set(newMap);
  }

  private handleAlertEvent(event: string, data: Record<string, unknown>): void {
    const clusterId = data['clusterId'] as string;
    if (!clusterId) return;

    const current = this._clusters();
    const cluster = current.get(clusterId);
    if (!cluster) return;

    const delta = event === 'alert:fired' ? 1 : -1;
    const updatedCluster = {
      ...cluster,
      activeAlertCount: Math.max(0, cluster.activeAlertCount + delta),
    };

    const newMap = new Map(current);
    newMap.set(clusterId, updatedCluster);
    this._clusters.set(newMap);
  }
}

// ── Deserialization Helpers ──────────────────────────────────────────────────

function deserializeClusterSummary(data: Record<string, unknown>): ClusterStoreState {
  return {
    clusterId: String(data['clusterId'] ?? ''),
    clusterName: String(data['clusterName'] ?? ''),
    clusterState: String(data['clusterState'] ?? 'UNKNOWN'),
    clusterSize: Number(data['clusterSize'] ?? 0),
    members: new Map(),
    distributedObjects: [],
    mapStats: {},
    queueStats: {},
    topicStats: {},
    blitz: data['hasBlitz'] ? {} : null,
    lastUpdated: Number(data['lastUpdated'] ?? 0),
    activeAlertCount: 0,
  };
}

function deserializeClusterDetail(data: Record<string, unknown>): ClusterStoreState {
  const members = new Map<string, MemberStoreState>();
  const memberArray = data['members'] as Array<Record<string, unknown>> | undefined;

  if (Array.isArray(memberArray)) {
    for (const m of memberArray) {
      const addr = String(m['address'] ?? '');
      members.set(addr, {
        address: addr,
        restAddress: String(m['restAddress'] ?? addr),
        connected: Boolean(m['connected']),
        lastSeen: Number(m['lastSeen'] ?? 0),
        latestSample: (m['latestSample'] as MemberMetricsSample) ?? null,
        recentSamples: [],
        info: (m['info'] as MemberStoreState['info']) ?? null,
        error: (m['error'] as string) ?? null,
      });
    }
  }

  return {
    clusterId: String(data['clusterId'] ?? ''),
    clusterName: String(data['clusterName'] ?? ''),
    clusterState: String(data['clusterState'] ?? 'UNKNOWN'),
    clusterSize: Number(data['clusterSize'] ?? 0),
    members,
    distributedObjects: (data['distributedObjects'] as ClusterStoreState['distributedObjects']) ?? [],
    mapStats: (data['mapStats'] as Record<string, unknown>) ?? {},
    queueStats: (data['queueStats'] as Record<string, unknown>) ?? {},
    topicStats: (data['topicStats'] as Record<string, unknown>) ?? {},
    blitz: data['blitz'] ?? null,
    lastUpdated: Number(data['lastUpdated'] ?? 0),
    activeAlertCount: 0,
  };
}
