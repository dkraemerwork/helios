/**
 * Block D.3 — Near-Cache Invalidation Event
 *
 * Wire-level event published by the server to all clients that have
 * a near-cache for a given map whenever an entry is mutated.
 *
 * Corresponds to Hazelcast's {@code com.hazelcast.map.impl.nearcache.invalidation}
 * family of event types.
 *
 * Two variants:
 *   - SINGLE  — one key was changed (put, remove, set, delete, evict, …).
 *   - BATCH   — several keys changed in one batch (putAll).
 *   - CLEAR   — the map was cleared / all keys invalidated.
 *
 * Sequence numbers and partition UUIDs allow the client-side RepairingTask to
 * detect missed events and trigger anti-entropy reconciliation.
 */

// ── Event kind ────────────────────────────────────────────────────────────────

export enum NearCacheInvalidationKind {
    /** A single key was invalidated. */
    SINGLE = 'SINGLE',
    /** Multiple keys were invalidated in a batch. */
    BATCH = 'BATCH',
    /** The entire map was cleared (all keys invalid). */
    CLEAR = 'CLEAR',
}

// ── Mutation trigger ──────────────────────────────────────────────────────────

/** The map operation that triggered the invalidation. */
export enum MutationTrigger {
    PUT = 'PUT',
    PUT_ALL = 'PUT_ALL',
    PUT_IF_ABSENT = 'PUT_IF_ABSENT',
    PUT_TRANSIENT = 'PUT_TRANSIENT',
    SET = 'SET',
    REMOVE = 'REMOVE',
    REMOVE_IF_SAME = 'REMOVE_IF_SAME',
    DELETE = 'DELETE',
    EVICT = 'EVICT',
    EVICT_ALL = 'EVICT_ALL',
    CLEAR = 'CLEAR',
    REPLACE = 'REPLACE',
    REPLACE_IF_SAME = 'REPLACE_IF_SAME',
    MERGE = 'MERGE',
    EXPIRY = 'EXPIRY',
    UNKNOWN = 'UNKNOWN',
}

// ── Per-key entry for batch events ────────────────────────────────────────────

export interface InvalidatedKeyEntry {
    /**
     * Serialized key bytes (binary Hazelcast Data encoding).
     * The client deserialises this back to the typed key using its
     * SerializationService.
     */
    readonly keyBytes: Buffer;
    /** Partition ID this key belongs to. */
    readonly partitionId: number;
    /** Partition UUID at the time of mutation. */
    readonly partitionUuid: string;
    /** Monotonically increasing sequence number for this partition. */
    readonly sequence: number;
    /** Source member UUID that performed the mutation. */
    readonly sourceUuid: string;
}

// ── Base event ────────────────────────────────────────────────────────────────

interface NearCacheInvalidationEventBase {
    readonly kind: NearCacheInvalidationKind;
    /** Name of the IMap whose near-cache must be invalidated. */
    readonly mapName: string;
    /** Wall-clock epoch-ms when the mutation was applied. */
    readonly timestamp: number;
    /** The operation that caused this invalidation. */
    readonly trigger: MutationTrigger;
}

// ── Concrete event shapes ─────────────────────────────────────────────────────

export interface SingleNearCacheInvalidationEvent extends NearCacheInvalidationEventBase {
    readonly kind: NearCacheInvalidationKind.SINGLE;
    /** Serialized key bytes, or null when the key is unknown (shouldn't happen for SINGLE). */
    readonly keyBytes: Buffer;
    /** Partition ID of the invalidated key. */
    readonly partitionId: number;
    /** Partition UUID that was current at mutation time. */
    readonly partitionUuid: string;
    /** Monotonically increasing per-partition sequence number. */
    readonly sequence: number;
    /** UUID of the member that performed the mutation. */
    readonly sourceUuid: string;
}

export interface BatchNearCacheInvalidationEvent extends NearCacheInvalidationEventBase {
    readonly kind: NearCacheInvalidationKind.BATCH;
    /** All keys invalidated in this batch (one entry per mutated key). */
    readonly keys: InvalidatedKeyEntry[];
}

export interface ClearNearCacheInvalidationEvent extends NearCacheInvalidationEventBase {
    readonly kind: NearCacheInvalidationKind.CLEAR;
    /**
     * Partition UUIDs at time of clear.  Clients use this to bump all their
     * MetaDataContainer UUIDs so that subsequent events are correctly sequenced.
     * Map: partitionId → uuid.
     */
    readonly partitionUuids: ReadonlyMap<number, string>;
    /**
     * Per-partition sequences at time of clear.
     * Map: partitionId → sequence.
     */
    readonly sequences: ReadonlyMap<number, number>;
    /** UUID of the member that performed the clear. */
    readonly sourceUuid: string;
}

// ── Discriminated union ───────────────────────────────────────────────────────

export type NearCacheInvalidationEvent =
    | SingleNearCacheInvalidationEvent
    | BatchNearCacheInvalidationEvent
    | ClearNearCacheInvalidationEvent;

// ── Factory helpers ───────────────────────────────────────────────────────────

export function makeSingleInvalidation(
    mapName: string,
    keyBytes: Buffer,
    partitionId: number,
    partitionUuid: string,
    sequence: number,
    sourceUuid: string,
    trigger: MutationTrigger = MutationTrigger.UNKNOWN,
): SingleNearCacheInvalidationEvent {
    return {
        kind: NearCacheInvalidationKind.SINGLE,
        mapName,
        timestamp: Date.now(),
        trigger,
        keyBytes,
        partitionId,
        partitionUuid,
        sequence,
        sourceUuid,
    };
}

export function makeBatchInvalidation(
    mapName: string,
    keys: InvalidatedKeyEntry[],
    trigger: MutationTrigger = MutationTrigger.PUT_ALL,
): BatchNearCacheInvalidationEvent {
    return {
        kind: NearCacheInvalidationKind.BATCH,
        mapName,
        timestamp: Date.now(),
        trigger,
        keys,
    };
}

export function makeClearInvalidation(
    mapName: string,
    partitionUuids: ReadonlyMap<number, string>,
    sequences: ReadonlyMap<number, number>,
    sourceUuid: string,
    trigger: MutationTrigger = MutationTrigger.CLEAR,
): ClearNearCacheInvalidationEvent {
    return {
        kind: NearCacheInvalidationKind.CLEAR,
        mapName,
        timestamp: Date.now(),
        trigger,
        partitionUuids,
        sequences,
        sourceUuid,
    };
}
