import type { CPSubsystemConfig } from '../../config/CPSubsystemConfig.js';
import { CpStateMachine } from './CpStateMachine.js';
import { InMemoryRaftStateStore } from './InMemoryRaftStateStore.js';
import { RaftMessageRouter } from './RaftMessageRouter.js';
import { RaftNode, type RaftMessageSender, type RaftNodeConfig } from './RaftNode.js';
import type { RaftEndpoint, RaftGroupId } from './types.js';

/**
 * Deterministic FNV-1a 32-bit hash of a string, returned as a BigInt.
 * Ensures all nodes derive the same seed for a given group name.
 */
function deterministicSeed(name: string): bigint {
  let hash = 2166136261n; // FNV offset basis
  for (let i = 0; i < name.length; i++) {
    hash ^= BigInt(name.charCodeAt(i));
    hash = (hash * 16777619n) & 0xFFFFFFFFn; // FNV prime, keep 32-bit
  }
  return hash;
}

export interface CpGroupInfo {
  readonly groupId: RaftGroupId;
  readonly members: readonly RaftEndpoint[];
  readonly raftNode: RaftNode;
  readonly stateMachine: CpStateMachine;
  status: 'ACTIVE' | 'DESTROYING' | 'DESTROYED';
}

/**
 * Manages the lifecycle of CP groups — creation, retrieval, and destruction.
 *
 * Each CP group is backed by a {@link RaftNode} + {@link CpStateMachine} pair.
 * The METADATA group (created during {@link initialize}) tracks all other groups
 * and is the root of the CP subsystem.
 *
 * Group member selection uses round-robin assignment so that load is spread
 * across CP members when the configured group size is smaller than the total
 * number of CP members.
 */
export class CpGroupManager {
  static readonly METADATA_GROUP = 'METADATA';
  static readonly DEFAULT_GROUP = 'default';

  private readonly _groups = new Map<string, CpGroupInfo>();
  private readonly _router: RaftMessageRouter;
  private _metadataNode: RaftNode | null = null;
  private _nextGroupId = 1n;

  constructor(
    private readonly _localEndpoint: RaftEndpoint,
    private readonly _cpMembers: readonly RaftEndpoint[],
    private readonly _cpConfig: CPSubsystemConfig,
    private readonly _messageSender: RaftMessageSender,
    router: RaftMessageRouter,
  ) {
    this._router = router;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Creates and starts the METADATA group using all configured CP members.
   * Must be awaited before any other operation.
   */
  async initialize(): Promise<void> {
    const info = await this._createAndStartGroup(CpGroupManager.METADATA_GROUP, this._cpMembers);
    this._metadataNode = info.raftNode;
  }

  /**
   * Shuts down all managed groups and unregisters them from the router.
   */
  shutdown(): void {
    for (const [groupId, info] of this._groups) {
      info.raftNode.shutdown();
      this._router.unregisterNode(groupId);
    }
    this._groups.clear();
    this._metadataNode = null;
  }

  // ── Group access ───────────────────────────────────────────────────────────

  /**
   * Returns the existing active group with the given name, or creates a new
   * one with round-robin–selected members and starts it.
   */
  async getOrCreateGroup(groupName: string): Promise<CpGroupInfo> {
    const existing = this._groups.get(groupName);
    if (existing !== undefined && existing.status === 'ACTIVE') return existing;

    const members = this._selectGroupMembers();
    return this._createAndStartGroup(groupName, members);
  }

  /**
   * Destroys the group with the given name, shutting down its RaftNode and
   * removing it from the router. Idempotent if the group does not exist.
   */
  async destroyGroup(groupId: string): Promise<void> {
    const info = this._groups.get(groupId);
    if (info === undefined) return;
    info.status = 'DESTROYING';
    info.raftNode.shutdown();
    this._router.unregisterNode(groupId);
    info.status = 'DESTROYED';
    this._groups.delete(groupId);
  }

  /**
   * Returns the {@link CpGroupInfo} for the given group name, or null if not found.
   */
  getGroup(groupId: string): CpGroupInfo | null {
    return this._groups.get(groupId) ?? null;
  }

  /**
   * Returns the names of all currently managed groups.
   */
  listGroups(): string[] {
    return Array.from(this._groups.keys());
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Selects `groupSize` members from the CP member list using round-robin
   * based on the current group counter, so that groups are spread evenly.
   *
   * When `groupSize >= cpMembers.length`, all CP members are included.
   */
  private _selectGroupMembers(): RaftEndpoint[] {
    const groupSize = this._cpConfig.getGroupSize();
    if (groupSize >= this._cpMembers.length) return [...this._cpMembers];

    const selected: RaftEndpoint[] = [];
    const startIdx = Number(this._nextGroupId % BigInt(this._cpMembers.length));
    for (let i = 0; i < groupSize; i++) {
      selected.push(this._cpMembers[(startIdx + i) % this._cpMembers.length]!);
    }
    return selected;
  }

  /**
   * Creates a new {@link RaftNode} + {@link CpStateMachine} for the given group,
   * registers it with the router, starts it, and records it in the internal map.
   */
  private async _createAndStartGroup(
    groupName: string,
    members: readonly RaftEndpoint[],
  ): Promise<CpGroupInfo> {
    const groupId: RaftGroupId = {
      name: groupName,
      seed: deterministicSeed(groupName),
      id: this._nextGroupId++,
    };

    const stateMachine = new CpStateMachine();
    const stateStore = new InMemoryRaftStateStore();

    const nodeConfig: RaftNodeConfig = {
      groupId: groupName,
      localEndpoint: this._localEndpoint,
      initialMembers: members,
      config: this._cpConfig.getRaftAlgorithmConfig(),
      stateStore,
      stateMachine,
    };

    const node = new RaftNode(nodeConfig);
    node.setSender(this._messageSender);

    const info: CpGroupInfo = {
      groupId,
      members,
      raftNode: node,
      stateMachine,
      status: 'ACTIVE',
    };

    this._groups.set(groupName, info);
    this._router.registerNode(groupName, node);

    await node.start();

    return info;
  }
}
