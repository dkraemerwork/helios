/**
 * Flake ID Generator Service — cluster-wide unique, roughly-ordered ID generator.
 *
 * Port of com.hazelcast.flakeidgen.impl.FlakeIdGeneratorService.
 *
 * ID format (64-bit):
 *   bits[63..22] — timestamp (42 bits) = milliseconds since epoch
 *   bits[21.. 6] — node ID   (16 bits) = assigned node identifier
 *   bits[ 5.. 0] — sequence  ( 6 bits) = per-millisecond counter
 *
 * Batch support: server returns (base, increment, batchSize).
 *   - base: first ID in the batch
 *   - increment: node-ID spacing (1 << SEQUENCE_BITS)
 *   - batchSize: how many IDs are in the batch
 *
 * k-ordering: IDs from the same node at different times are strictly ordered.
 * IDs from different nodes at the same timestamp are not ordered w.r.t. each other,
 * but are unique due to the node ID embedding.
 *
 * Configuration knobs:
 *   - prefetchCount (default 100): how many IDs to batch-prefetch
 *   - prefetchValidityMs (default 600_000): max age before re-fetching
 *   - epochStart (default 2025-01-01T00:00:00Z): custom epoch offset
 *   - nodeIdOffset: base offset added to the Hazelcast member ID to derive node ID
 *   - bitsNodeId (default 16): bits reserved for node ID
 *   - bitsSequence (default 6): bits reserved for sequence
 */

// ── ID Bit layout constants ────────────────────────────────────────────

const DEFAULT_BITS_NODE_ID = 16;
const DEFAULT_BITS_SEQUENCE = 6;
const DEFAULT_EPOCH_START = new Date('2025-01-01T00:00:00Z').getTime();
const DEFAULT_PREFETCH_COUNT = 100;
const DEFAULT_PREFETCH_VALIDITY_MS = 600_000;

// ── Configuration ────────────────────────────────────────────────────────

export interface FlakeIdGeneratorConfig {
  prefetchCount?: number;
  prefetchValidityMs?: number;
  epochStart?: number;
  nodeIdOffset?: number;
  bitsNodeId?: number;
  bitsSequence?: number;
}

// ── Batch ────────────────────────────────────────────────────────────────

export interface FlakeIdBatch {
  /** First ID in the batch. */
  base: bigint;
  /** Spacing between consecutive IDs from the same batch (= 1 << bitsSequence). */
  increment: bigint;
  /** Number of IDs in the batch. */
  batchSize: number;
  /** Wall-clock time at which this batch was issued. */
  issuedAtMs: number;
}

// ── Generator state ──────────────────────────────────────────────────────

interface GeneratorState {
  /** Sequentially incremented per-ms counter. */
  sequence: number;
  /** Timestamp of the last ID issued. */
  lastTimestampMs: number;
}

// ── Service ──────────────────────────────────────────────────────────────

export class FlakeIdGeneratorService {
  static readonly SERVICE_NAME = 'hz:impl:flakeIdGeneratorService';

  private readonly _bitsNodeId: number;
  private readonly _bitsSequence: number;
  private readonly _maxNodeId: number;
  private readonly _maxSequence: number;
  private readonly _epochStart: number;
  private readonly _prefetchCount: number;
  private readonly _prefetchValidityMs: number;
  private readonly _nodeIdOffset: number;
  private readonly _nodeId: number;

  /** Per-generator internal state. */
  private readonly _states = new Map<string, GeneratorState>();

  /** Per-generator pre-fetched batch. */
  private readonly _batches = new Map<string, FlakeIdBatch>();
  private readonly _batchIndices = new Map<string, number>();

  constructor(
    private readonly _localNodeIdRaw: number,
    config?: FlakeIdGeneratorConfig,
  ) {
    this._bitsNodeId = config?.bitsNodeId ?? DEFAULT_BITS_NODE_ID;
    this._bitsSequence = config?.bitsSequence ?? DEFAULT_BITS_SEQUENCE;
    this._maxNodeId = (1 << this._bitsNodeId) - 1;
    this._maxSequence = (1 << this._bitsSequence) - 1;
    this._epochStart = config?.epochStart ?? DEFAULT_EPOCH_START;
    this._prefetchCount = config?.prefetchCount ?? DEFAULT_PREFETCH_COUNT;
    this._prefetchValidityMs = config?.prefetchValidityMs ?? DEFAULT_PREFETCH_VALIDITY_MS;
    this._nodeIdOffset = config?.nodeIdOffset ?? 0;
    this._nodeId = (this._localNodeIdRaw + this._nodeIdOffset) & this._maxNodeId;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Generate the next unique ID.
   * Draws from the prefetch batch if available and fresh, otherwise requests
   * a new batch from the server (local in single-node mode).
   */
  newId(name: string): bigint {
    let batch = this._batches.get(name);
    let idx = this._batchIndices.get(name) ?? 0;

    const now = Date.now();
    const batchFresh =
      batch !== undefined &&
      idx < batch.batchSize &&
      now - batch.issuedAtMs <= this._prefetchValidityMs;

    if (!batchFresh) {
      batch = this._allocateBatch(name, this._prefetchCount);
      this._batches.set(name, batch);
      idx = 0;
    }

    const id = batch!.base + BigInt(idx) * batch!.increment;
    this._batchIndices.set(name, idx + 1);
    return id;
  }

  /**
   * Request a batch of IDs from the server (or local generator).
   * Returns a FlakeIdBatch descriptor.
   */
  newBatch(name: string, batchSize: number): FlakeIdBatch {
    if (batchSize <= 0) throw new Error('Batch size must be positive');
    return this._allocateBatch(name, batchSize);
  }

  /**
   * Decompose a Flake ID into its constituent fields.
   */
  decompose(id: bigint): { timestampMs: number; nodeId: number; sequence: number } {
    const sequenceMask = BigInt((1 << this._bitsSequence) - 1);
    const nodeIdMask = BigInt((1 << this._bitsNodeId) - 1);

    const sequence = Number(id & sequenceMask);
    const nodeId = Number((id >> BigInt(this._bitsSequence)) & nodeIdMask);
    const timestamp = Number(id >> BigInt(this._bitsSequence + this._bitsNodeId)) + this._epochStart;

    return { timestampMs: timestamp, nodeId, sequence };
  }

  getNodeId(): number {
    return this._nodeId;
  }

  destroy(name: string): void {
    this._states.delete(name);
    this._batches.delete(name);
    this._batchIndices.delete(name);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _allocateBatch(name: string, batchSize: number): FlakeIdBatch {
    const now = Date.now();
    const state = this._states.get(name) ?? { sequence: 0, lastTimestampMs: 0 };

    let timestampMs = now - this._epochStart;
    if (timestampMs < 0) timestampMs = 0;

    // Ensure monotonicity: never go backward relative to last issued time
    if (timestampMs < state.lastTimestampMs) {
      timestampMs = state.lastTimestampMs;
    }

    // Determine the starting sequence for this batch
    const startSeq = timestampMs === state.lastTimestampMs ? state.sequence : 0;

    // Compute how many (timestamp, sequence) slots batchSize IDs require.
    // Each (ts, seq) pair encodes one ID; sequence wraps at maxSequence+1.
    const seqRange = this._maxSequence + 1; // number of sequence values per ms
    const firstSlot = timestampMs * seqRange + startSeq;
    const lastSlot = firstSlot + batchSize - 1;
    const endTs = Math.floor(lastSlot / seqRange);
    const endSeq = lastSlot % seqRange;

    // Advance state to the slot AFTER the last ID in this batch
    const nextSlot = lastSlot + 1;
    state.lastTimestampMs = Math.floor(nextSlot / seqRange);
    state.sequence = nextSlot % seqRange;
    this._states.set(name, state);

    // Build base ID for the first ID in the batch
    const tsShift = BigInt(this._bitsNodeId + this._bitsSequence);
    const nodeShift = BigInt(this._bitsSequence);

    const base =
      (BigInt(timestampMs) << tsShift) |
      (BigInt(this._nodeId) << nodeShift) |
      BigInt(startSeq);

    // Increment = 1: IDs are strictly sequential within a batch.
    // The state is advanced by batchSize slots so the next batch starts
    // immediately after the last ID of this batch, guaranteeing no overlap.
    const increment = 1n;

    return {
      base,
      increment,
      batchSize,
      issuedAtMs: now,
    };
  }
}
