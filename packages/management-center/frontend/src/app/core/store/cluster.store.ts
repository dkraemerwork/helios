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
  connectedMembers: number;
  totalMembers: number;
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
  monitorCapable: boolean;
  adminCapable: boolean;
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

  readonly monitorMembers = computed((): MemberStoreState[] => {
    return this.members().filter(member => member.monitorCapable);
  });

  /** Computed: summary array of all clusters for navigation. */
  readonly clusterList = computed((): ClusterSummary[] => {
    const result: ClusterSummary[] = [];
    for (const [, state] of this._clusters()) {
      const connectedMembers = state.members.size > 0
        ? Array.from(state.members.values()).filter(member => member.monitorCapable && member.connected).length
        : state.connectedMembers;
      const totalMembers = state.members.size > 0
        ? Array.from(state.members.values()).filter(member => member.monitorCapable).length
        : state.totalMembers;
      result.push({
        clusterId: state.clusterId,
        clusterName: state.clusterName,
        clusterState: state.clusterState,
        clusterSize: state.clusterSize,
        connectedMembers,
        totalMembers,
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
      const map = new Map(this._clusters());
      for (const cluster of clusters) {
        const state = deserializeClusterSummary(cluster);
        const existing = map.get(state.clusterId);
        map.set(state.clusterId, existing ? mergeClusterState(existing, state) : state);
      }
      this._clusters.set(map);
    }

    const cluster = data['cluster'] as Record<string, unknown> | undefined;
    if (cluster && typeof cluster === 'object') {
      const members = data['members'] as Array<Record<string, unknown>> | undefined;
      const clusterWithMembers = Array.isArray(members)
        ? { ...cluster, members }
        : cluster;
      const state = deserializeClusterDetail(clusterWithMembers);
      const map = new Map(this._clusters());
      const existing = map.get(state.clusterId);
      map.set(state.clusterId, existing ? mergeClusterState(existing, state) : state);
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

    // The WS message wraps cluster state inside a `clusterState` property:
    // { clusterId, clusterState: { clusterName, clusterState, members, ... } }
    // Unwrap it so we can read fields directly.
    const nested = data['clusterState'] as Record<string, unknown> | undefined;
    const source = nested && typeof nested === 'object' ? nested : data;

    const current = this._clusters();
    const existing = current.get(clusterId);

    const updated: ClusterStoreState = {
      clusterId,
      clusterName: (source['clusterName'] as string) ?? existing?.clusterName ?? '',
      clusterState: (source['clusterState'] as string) ?? existing?.clusterState ?? 'UNKNOWN',
      clusterSize: (source['clusterSize'] as number) ?? existing?.clusterSize ?? 0,
      connectedMembers: existing?.connectedMembers ?? 0,
      totalMembers: existing?.totalMembers ?? 0,
      members: existing?.members ?? new Map(),
      distributedObjects: (source['distributedObjects'] as ClusterStoreState['distributedObjects'])
        ?? existing?.distributedObjects ?? [],
      mapStats: (source['mapStats'] as Record<string, unknown>) ?? existing?.mapStats ?? {},
      queueStats: (source['queueStats'] as Record<string, unknown>) ?? existing?.queueStats ?? {},
      topicStats: (source['topicStats'] as Record<string, unknown>) ?? existing?.topicStats ?? {},
      blitz: source['blitz'] ?? existing?.blitz ?? null,
      lastUpdated: Date.now(),
      activeAlertCount: existing?.activeAlertCount ?? 0,
    };

    // Merge member updates if provided (expects an array of member objects)
    const memberUpdates = source['members'] as Array<Record<string, unknown>> | undefined;
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
          monitorCapable: (memberData['info'] as Record<string, unknown> | undefined)?.['monitorCapable'] as boolean
            ?? existingMember?.monitorCapable
            ?? true,
          adminCapable: (memberData['info'] as Record<string, unknown> | undefined)?.['adminCapable'] as boolean
            ?? existingMember?.adminCapable
            ?? true,
          lastSeen: (memberData['lastSeen'] as number) ?? Date.now(),
          latestSample: (memberData['latestSample'] as MemberMetricsSample)
            ?? existingMember?.latestSample ?? null,
          recentSamples: existingMember?.recentSamples ?? [],
          info: (memberData['info'] as MemberStoreState['info']) ?? existingMember?.info ?? null,
          error: (memberData['error'] as string) ?? existingMember?.error ?? null,
        });
      }
      updated.members = newMembers;
      updated.totalMembers = Array.from(newMembers.values()).filter(member => member.monitorCapable).length;
      updated.connectedMembers = Array.from(newMembers.values()).filter(member => member.monitorCapable && member.connected).length;
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
      monitorCapable: member?.monitorCapable ?? true,
      adminCapable: member?.adminCapable ?? true,
      lastSeen: sample.timestamp ?? Date.now(),
      latestSample: sample,
      recentSamples: newSamples,
      info: member?.info ?? null,
      error: null,
    };

    const newMembers = new Map(cluster.members);
    newMembers.set(memberAddr, updatedMember);

    const updatedCluster = { ...cluster, members: newMembers, lastUpdated: Date.now() };
    updatedCluster.totalMembers = Array.from(newMembers.values()).filter(existingMember => existingMember.monitorCapable).length;
    updatedCluster.connectedMembers = Array.from(newMembers.values()).filter(existingMember => existingMember.monitorCapable && existingMember.connected).length;
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
    connectedMembers: Number(data['connectedMembers'] ?? 0),
    totalMembers: Number(data['totalMembers'] ?? 0),
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
        monitorCapable: Boolean((m['info'] as Record<string, unknown> | undefined)?.['monitorCapable'] ?? true),
        adminCapable: Boolean((m['info'] as Record<string, unknown> | undefined)?.['adminCapable'] ?? true),
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
    connectedMembers: Array.from(members.values()).filter(member => member.monitorCapable && member.connected).length,
    totalMembers: Array.from(members.values()).filter(member => member.monitorCapable).length,
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

function mergeClusterState(existing: ClusterStoreState, incoming: ClusterStoreState): ClusterStoreState {
  return {
    ...existing,
    ...incoming,
    connectedMembers: incoming.members.size > 0 ? incoming.connectedMembers : existing.connectedMembers,
    totalMembers: incoming.members.size > 0 ? incoming.totalMembers : existing.totalMembers,
    members: incoming.members.size > 0 ? incoming.members : existing.members,
    distributedObjects: incoming.distributedObjects.length > 0 ? incoming.distributedObjects : existing.distributedObjects,
    mapStats: Object.keys(incoming.mapStats).length > 0 ? incoming.mapStats : existing.mapStats,
    queueStats: Object.keys(incoming.queueStats).length > 0 ? incoming.queueStats : existing.queueStats,
    topicStats: Object.keys(incoming.topicStats).length > 0 ? incoming.topicStats : existing.topicStats,
    blitz: incoming.blitz ?? existing.blitz,
    lastUpdated: Math.max(existing.lastUpdated, incoming.lastUpdated),
  };
}
