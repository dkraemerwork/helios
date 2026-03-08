/**
 * PN Counter Service — CRDT (Conflict-free Replicated Data Type) distributed counter.
 *
 * Port of com.hazelcast.crdt.pncounter.PNCounter.
 *
 * State:
 *   - P-counters: per-member positive increment vector
 *   - N-counters: per-member negative decrement vector
 *   - Logical value = sum(P) - sum(N)
 *
 * Merge: element-wise max of both P and N vectors.
 * Replica timestamps: VectorClock per replica for consistency tracking.
 * Reads: eventually consistent from any replica.
 * Writes: go to any replica (client picks nearest).
 */

/** Replica timestamp vector for consistency tracking. */
export interface ReplicaTimestampVector {
  /** Map from replicaId -> logical timestamp (monotone counter). */
  timestamps: Map<string, number>;
}

/** Per-counter vector clock state. */
export interface PNCounterVectorState {
  /** Positive increment vector: replicaId -> positive increment on this replica. */
  pVector: Map<string, bigint>;
  /** Negative decrement vector: replicaId -> decrement magnitude on this replica. */
  nVector: Map<string, bigint>;
  /** Replica timestamps for consistency tracking. */
  replicaTimestamp: ReplicaTimestampVector;
}

function emptyState(): PNCounterVectorState {
  return {
    pVector: new Map(),
    nVector: new Map(),
    replicaTimestamp: { timestamps: new Map() },
  };
}

function computeValue(state: PNCounterVectorState): bigint {
  let total = 0n;
  for (const v of state.pVector.values()) total += v;
  for (const v of state.nVector.values()) total -= v;
  return total;
}

/**
 * Merge two PN Counter states using element-wise max (CRDT merge).
 * Non-destructive: returns a new merged state.
 */
function mergeStates(
  local: PNCounterVectorState,
  remote: PNCounterVectorState,
): PNCounterVectorState {
  const pVector = new Map(local.pVector);
  const nVector = new Map(local.nVector);
  const timestamps = new Map(local.replicaTimestamp.timestamps);

  for (const [replicaId, value] of remote.pVector) {
    const current = pVector.get(replicaId) ?? 0n;
    if (value > current) pVector.set(replicaId, value);
  }

  for (const [replicaId, value] of remote.nVector) {
    const current = nVector.get(replicaId) ?? 0n;
    if (value > current) nVector.set(replicaId, value);
  }

  for (const [replicaId, ts] of remote.replicaTimestamp.timestamps) {
    const current = timestamps.get(replicaId) ?? 0;
    if (ts > current) timestamps.set(replicaId, ts);
  }

  return { pVector, nVector, replicaTimestamp: { timestamps } };
}

export class PNCounterService {
  static readonly SERVICE_NAME = 'hz:impl:pnCounterService';

  private static readonly DEFAULT_REPLICA_COUNT = 3;

  private readonly _counters = new Map<string, PNCounterVectorState>();
  private readonly _replicaCount: number;

  constructor(
    private readonly _localReplicaId: string,
    replicaCount?: number,
  ) {
    this._replicaCount = replicaCount ?? PNCounterService.DEFAULT_REPLICA_COUNT;
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Returns the current value of the counter (sum of all P minus sum of all N vectors).
   * Eventually consistent — reads local replica state.
   */
  get(name: string): bigint {
    return computeValue(this._getOrCreate(name));
  }

  /**
   * Returns the configured replica count.
   */
  getReplicaCount(): number {
    return this._replicaCount;
  }

  /**
   * Returns the current replica timestamp vector for a given counter.
   * Used by clients to track consistency.
   */
  getReplicaTimestampVector(name: string): ReplicaTimestampVector {
    const state = this._getOrCreate(name);
    return { timestamps: new Map(state.replicaTimestamp.timestamps) };
  }

  // ── Increment ────────────────────────────────────────────────────────────

  /**
   * Atomically adds the given delta to this counter and returns the updated value.
   * Negative delta performs a decrement.
   */
  addAndGet(name: string, delta: bigint): bigint {
    const state = this._getOrCreate(name);
    this._applyDelta(name, state, delta);
    return computeValue(state);
  }

  getAndAdd(name: string, delta: bigint): bigint {
    const state = this._getOrCreate(name);
    const prev = computeValue(state);
    this._applyDelta(name, state, delta);
    return prev;
  }

  incrementAndGet(name: string): bigint {
    return this.addAndGet(name, 1n);
  }

  getAndIncrement(name: string): bigint {
    return this.getAndAdd(name, 1n);
  }

  decrementAndGet(name: string): bigint {
    return this.addAndGet(name, -1n);
  }

  getAndDecrement(name: string): bigint {
    return this.getAndAdd(name, -1n);
  }

  subtractAndGet(name: string, delta: bigint): bigint {
    return this.addAndGet(name, -delta);
  }

  getAndSubtract(name: string, delta: bigint): bigint {
    return this.getAndAdd(name, -delta);
  }

  // ── Replication ──────────────────────────────────────────────────────────

  /**
   * Apply a remote state from another replica.
   * Uses CRDT merge (element-wise max of P and N vectors).
   */
  mergeRemoteState(name: string, remoteState: PNCounterVectorState): void {
    const local = this._getOrCreate(name);
    const merged = mergeStates(local, remoteState);
    this._counters.set(name, merged);
  }

  /**
   * Export local state for replication to other replicas.
   */
  exportState(name: string): PNCounterVectorState {
    const state = this._getOrCreate(name);
    return {
      pVector: new Map(state.pVector),
      nVector: new Map(state.nVector),
      replicaTimestamp: { timestamps: new Map(state.replicaTimestamp.timestamps) },
    };
  }

  /**
   * Reset the counter (remove all state).
   */
  reset(name: string): void {
    this._counters.delete(name);
  }

  destroy(name: string): void {
    this._counters.delete(name);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _getOrCreate(name: string): PNCounterVectorState {
    if (!this._counters.has(name)) {
      this._counters.set(name, emptyState());
    }
    return this._counters.get(name)!;
  }

  private _applyDelta(name: string, state: PNCounterVectorState, delta: bigint): void {
    if (delta === 0n) return;

    if (delta > 0n) {
      const current = state.pVector.get(this._localReplicaId) ?? 0n;
      state.pVector.set(this._localReplicaId, current + delta);
    } else {
      const magnitude = -delta;
      const current = state.nVector.get(this._localReplicaId) ?? 0n;
      state.nVector.set(this._localReplicaId, current + magnitude);
    }

    // Increment local replica's logical timestamp
    const ts = state.replicaTimestamp.timestamps.get(this._localReplicaId) ?? 0;
    state.replicaTimestamp.timestamps.set(this._localReplicaId, ts + 1);

    this._counters.set(name, state);
  }
}
