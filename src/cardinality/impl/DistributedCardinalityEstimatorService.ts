/**
 * Distributed Cardinality Estimator Service — partition-owned HyperLogLog with backup.
 *
 * Port of com.hazelcast.cardinality.impl.CardinalityEstimatorService.
 *
 * Operations:
 *  - add(name, hash): add a 32-bit hash to the estimator
 *  - estimate(name): return the estimated cardinality
 *
 * Distributed model:
 *  - Each estimator is owned by a single partition (partition-local).
 *  - Backups: on mutation, sync state to backup replicas.
 *  - Merge: union of all HyperLogLog registers (element-wise max via dense merge).
 *  - Cluster-wide estimate: merge HLL from all partitions that hold state for a name.
 *
 * Error bound: standard HyperLogLog ±1.04/√m where m = 2^p (default p=14, m=16384).
 *   At p=14: error ≈ ±0.81%
 */

import type { HyperLogLog } from '../HyperLogLog.js';
import { HyperLogLogImpl } from './HyperLogLogImpl.js';

/** Wire representation for backup/migration. */
export interface HllSnapshot {
  p: number;
  /** Dense register array as base64-encoded Int8Array. */
  denseRegisters: string | null;
}

function encodeRegisters(arr: Int8Array): string {
  return Buffer.from(arr.buffer).toString('base64');
}

function decodeRegisters(b64: string): Int8Array {
  const buf = Buffer.from(b64, 'base64');
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Per-partition estimator container. */
class EstimatorContainer {
  private _hll: HyperLogLogImpl;

  constructor(private readonly _p: number = 14) {
    this._hll = new HyperLogLogImpl(this._p);
  }

  add(hash: number): void {
    this._hll.add(hash);
  }

  estimate(): number {
    return this._hll.estimate();
  }

  merge(other: HyperLogLog): void {
    this._hll.merge(other);
  }

  getHll(): HyperLogLogImpl {
    return this._hll;
  }

  /**
   * Export state for backup/migration.
   * Forces conversion to dense for portable serialization.
   */
  snapshot(): HllSnapshot {
    // Access the internal encoder via the dense conversion
    const dense = (this._hll as unknown as {
      encoder: { getEncodingType(): string; asDense?(): { getRegister(): Int8Array }; getRegister?(): Int8Array };
    }).encoder;

    let registers: Int8Array | null = null;
    if (dense.getEncodingType() === 'DENSE') {
      registers = dense.getRegister?.() ?? null;
    } else if (dense.asDense !== undefined) {
      registers = dense.asDense().getRegister();
    }

    return {
      p: this._p,
      denseRegisters: registers !== null ? encodeRegisters(registers) : null,
    };
  }

  /**
   * Restore from a snapshot.
   */
  static fromSnapshot(snapshot: HllSnapshot): EstimatorContainer {
    const container = new EstimatorContainer(snapshot.p);
    if (snapshot.denseRegisters !== null) {
      const registers = decodeRegisters(snapshot.denseRegisters);
      // Apply each non-zero register entry via the public add() API
      // by synthesising hashes that map to those register positions.
      // Since we can't reverse engineer the exact hashes, we use a direct
      // register-injection approach via the HLL merge path.
      const other = new HyperLogLogImpl(snapshot.p);
      // Add synthetic hashes to build an equivalent dense HLL:
      // we inject each bit position as a separate hash run.
      for (let i = 0; i < registers.length; i++) {
        const rho = registers[i];
        if (rho > 0) {
          // Synthesise a 32-bit hash that maps to bucket i with run-of-zeros = rho.
          // Low p bits = bucket index, bits[p..p+rho-1] = 0, bit[p+rho] = 1.
          const hash = (i & ((1 << snapshot.p) - 1)) | (1 << (snapshot.p + rho - 1));
          other.add(hash);
        }
      }
      container._hll.merge(other);
    }
    return container;
  }
}

export class DistributedCardinalityEstimatorService {
  static readonly SERVICE_NAME = 'hz:impl:cardinalityEstimatorService';

  private static readonly DEFAULT_P = 14;

  /** Local estimator containers keyed by name. */
  private readonly _estimators = new Map<string, EstimatorContainer>();

  /** Backup snapshots received from owner replicas. */
  private readonly _backupSnapshots = new Map<string, HllSnapshot>();

  /** Backup change listeners: called after each mutation for backup replication. */
  private readonly _backupListeners: Array<
    (name: string, snapshot: HllSnapshot) => void
  > = [];

  /** Merge change listeners: called when a cluster-wide merge is requested. */
  private readonly _mergeListeners: Array<
    (name: string) => HllSnapshot[]
  > = [];

  constructor(private readonly _p: number = DistributedCardinalityEstimatorService.DEFAULT_P) {}

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Add a 32-bit hash value to the estimator for the given name.
   * In distributed mode, only the partition owner writes; backups receive a snapshot.
   */
  add(name: string, hash: number): void {
    const container = this._getOrCreate(name);
    container.add(hash);
    this._notifyBackupListeners(name, container.snapshot());
  }

  /**
   * Add a string by hashing it to a 32-bit value and adding the hash.
   */
  addString(name: string, value: string): void {
    this.add(name, murmur3_32(value));
  }

  /**
   * Return the estimated cardinality for this partition's local state.
   * For a cluster-wide estimate, call estimateGlobal().
   */
  estimate(name: string): number {
    const container = this._estimators.get(name);
    return container?.estimate() ?? 0;
  }

  /**
   * Return a cluster-wide cardinality estimate by merging all replica states.
   * In single-node mode this is identical to estimate().
   * In multi-node mode, collects HLL state from all members holding data for this name.
   */
  estimateGlobal(name: string): number {
    const localContainer = this._getOrCreate(name);
    const merged = new HyperLogLogImpl(this._p);
    merged.merge(localContainer.getHll());

    // Merge in any backup snapshots we've received
    const backupSnapshot = this._backupSnapshots.get(name);
    if (backupSnapshot !== undefined) {
      const backupContainer = EstimatorContainer.fromSnapshot(backupSnapshot);
      merged.merge(backupContainer.getHll());
    }

    // Collect remote estimates via registered merge listeners
    for (const listener of this._mergeListeners) {
      const snapshots = listener(name);
      for (const snapshot of snapshots) {
        const remote = EstimatorContainer.fromSnapshot(snapshot);
        merged.merge(remote.getHll());
      }
    }

    return merged.estimate();
  }

  // ── Backup & Replication ─────────────────────────────────────────────────

  /**
   * Register a listener that is called after each add() mutation.
   * Used by the distributed layer to push snapshots to backup replicas.
   */
  onBackupNeeded(listener: (name: string, snapshot: HllSnapshot) => void): void {
    this._backupListeners.push(listener);
  }

  /**
   * Apply a backup snapshot from the owner replica.
   * Called on backup replicas when the primary pushes its state.
   */
  applyBackupSnapshot(name: string, snapshot: HllSnapshot): void {
    this._backupSnapshots.set(name, snapshot);
    // Also merge into the local container so backups can serve reads
    const container = this._getOrCreate(name);
    const restored = EstimatorContainer.fromSnapshot(snapshot);
    container.merge(restored.getHll());
  }

  /**
   * Export the local snapshot for replication or migration.
   */
  exportSnapshot(name: string): HllSnapshot | null {
    const container = this._estimators.get(name);
    return container?.snapshot() ?? null;
  }

  /**
   * Import a snapshot (e.g. on migration from another partition owner).
   */
  importSnapshot(name: string, snapshot: HllSnapshot): void {
    const container = EstimatorContainer.fromSnapshot(snapshot);
    this._estimators.set(name, container);
  }

  /**
   * Register a merge listener that provides HLL snapshots from remote members.
   * Used by the cluster-aware layer to collect all partitions' state.
   */
  onMergeRequested(listener: (name: string) => HllSnapshot[]): void {
    this._mergeListeners.push(listener);
  }

  destroy(name: string): void {
    this._estimators.delete(name);
    this._backupSnapshots.delete(name);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _getOrCreate(name: string): EstimatorContainer {
    if (!this._estimators.has(name)) {
      this._estimators.set(name, new EstimatorContainer(this._p));
    }
    return this._estimators.get(name)!;
  }

  private _notifyBackupListeners(name: string, snapshot: HllSnapshot): void {
    for (const listener of this._backupListeners) {
      listener(name, snapshot);
    }
  }
}

// ── MurmurHash3 (32-bit) ──────────────────────────────────────────────────

/**
 * MurmurHash3 32-bit hash for string inputs.
 * Used for addString() to convert arbitrary strings to uniform 32-bit hashes.
 * Error bound of HLL is independent of hash function as long as it is
 * approximately uniform — MurmurHash3 satisfies this requirement.
 */
function murmur3_32(str: string, seed = 0): number {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  let h1 = seed >>> 0;

  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Process 4-byte chunks
  const nblocks = Math.floor(len / 4);
  for (let i = 0; i < nblocks; i++) {
    const offset = i * 4;
    let k1 =
      (bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 24)) >>>
      0;

    k1 = Math.imul(k1, c1);
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  // Tail bytes
  const tail = len & 3;
  const tailOffset = nblocks * 4;
  let k1 = 0;
  if (tail >= 3) k1 ^= bytes[tailOffset + 2]! << 16;
  if (tail >= 2) k1 ^= bytes[tailOffset + 1]! << 8;
  if (tail >= 1) {
    k1 ^= bytes[tailOffset]!;
    k1 = Math.imul(k1, c1);
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  // Finalization (avalanche)
  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}
