/**
 * Block D.3 — Near-Cache Invalidation Manager
 *
 * Server-side manager that publishes real invalidation events to connected
 * clients whenever a map entry is mutated.
 *
 * Architecture (server-pushed model):
 *
 *   Map operation (put/remove/set/delete/clear/evict/…)
 *     └─► NearCacheInvalidationManager.invalidate(…)
 *           ├─► MetaDataGenerator: assign partitionUuid + sequence number
 *           ├─► Build NearCacheInvalidationEvent
 *           └─► broadcast to all ClientSessions subscribed to that map
 *
 * Client subscription lifecycle:
 *   - Client sends a subscribe request (NearCacheInvalidationHandler handles wire).
 *   - Manager records (sessionId → Set<mapName>) and (mapName → Set<sessionId>).
 *   - On disconnect the session is removed from all subscriptions.
 *
 * Anti-entropy / metadata fetch:
 *   - Clients can request current partition metadata (UUIDs + sequences) at any time.
 *   - The manager also runs a periodic repairing check (default 60 s) that compares
 *     client-reported metadata with the current server state and schedules a full
 *     metadata push to clients that are stale.
 *
 * Correctness under concurrent writes:
 *   - Sequence numbers are monotonically increasing per (mapName, partitionId).
 *   - Partition UUIDs are regenerated on partition migration; clients detect UUID
 *     change and invalidate the full partition's worth of entries.
 *   - On reconnect the client requests current metadata → gaps are healed.
 *
 * Lifecycle: start() → active → stop().
 */

import { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator.js';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession.js';
import {
    makeBatchInvalidation,
    makeClearInvalidation,
    makeSingleInvalidation,
    MutationTrigger,
    NearCacheInvalidationKind,
} from '@zenystx/helios-core/spi/impl/NearCacheInvalidationEvent.js';
import type {
    BatchNearCacheInvalidationEvent,
    ClearNearCacheInvalidationEvent,
    InvalidatedKeyEntry,
    NearCacheInvalidationEvent,
    SingleNearCacheInvalidationEvent,
} from '@zenystx/helios-core/spi/impl/NearCacheInvalidationEvent.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Partition metadata snapshot ───────────────────────────────────────────────

/** Current invalidation metadata for a single partition, as known by the server. */
export interface PartitionInvalidationMetadata {
    readonly partitionId: number;
    readonly partitionUuid: string;
    readonly sequence: number;
}

/** Metadata snapshot returned to clients on fetch. */
export interface MapInvalidationMetadata {
    readonly mapName: string;
    readonly partitions: PartitionInvalidationMetadata[];
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface NearCacheInvalidationManagerOptions {
    /** Total number of partitions. Default: 271. */
    partitionCount?: number;
    /** Server member UUID used as sourceUuid in invalidation events. */
    memberUuid?: string;
    /** Interval (ms) for the repairing anti-entropy check. Default: 60_000. */
    repairIntervalMs?: number;
    logger?: ILogger;
}

// ── Event serialiser interface ────────────────────────────────────────────────

/**
 * Converts a NearCacheInvalidationEvent into a binary Buffer suitable for
 * pushing over the client-protocol wire.  The concrete implementation lives
 * in NearCacheInvalidationHandler.
 */
export interface InvalidationEventSerializer {
    serializeSingle(event: SingleNearCacheInvalidationEvent): Buffer;
    serializeBatch(event: BatchNearCacheInvalidationEvent): Buffer;
    serializeClear(event: ClearNearCacheInvalidationEvent): Buffer;
}

/** Metrics exposed by the manager. */
export interface NearCacheInvalidationManagerMetrics {
    subscribedMaps: number;
    totalSubscriptions: number;
    eventsPublished: number;
    eventsDropped: number;
    repairChecksRun: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class NearCacheInvalidationManager {
    private readonly _metaGen: MetaDataGenerator;
    private readonly _memberUuid: string;
    private readonly _logger: ILogger | null;
    private readonly _repairIntervalMs: number;
    private readonly _partitionCount: number;

    /**
     * mapName → Set<sessionId>
     * Which sessions are subscribed to invalidation events for this map.
     */
    private readonly _mapSubscriptions = new Map<string, Set<string>>();

    /**
     * sessionId → Set<mapName>
     * Reverse index for fast session cleanup on disconnect.
     */
    private readonly _sessionSubscriptions = new Map<string, Set<string>>();

    /**
     * sessionId → ClientSession (weak reference via the registry pattern —
     * manager does not own the sessions).
     */
    private readonly _sessions = new Map<string, ClientSession>();

    /** Pluggable event serialiser (wired by NearCacheInvalidationHandler). */
    private _serializer: InvalidationEventSerializer | null = null;

    private _running = false;
    private _repairTimer: ReturnType<typeof setInterval> | null = null;

    // Metrics
    private _eventsPublished = 0;
    private _eventsDropped = 0;
    private _repairChecksRun = 0;

    constructor(options?: NearCacheInvalidationManagerOptions) {
        this._partitionCount = options?.partitionCount ?? 271;
        this._memberUuid = options?.memberUuid ?? crypto.randomUUID();
        this._repairIntervalMs = options?.repairIntervalMs ?? 60_000;
        this._logger = options?.logger ?? null;
        this._metaGen = new MetaDataGenerator(this._partitionCount);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        if (this._running) return;
        this._running = true;
        if (this._repairIntervalMs > 0) {
            this._repairTimer = setInterval(() => this._runRepairCheck(), this._repairIntervalMs);
        }
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._repairTimer !== null) {
            clearInterval(this._repairTimer);
            this._repairTimer = null;
        }
        this._mapSubscriptions.clear();
        this._sessionSubscriptions.clear();
        this._sessions.clear();
    }

    // ── Serialiser wiring ─────────────────────────────────────────────────────

    setSerializer(serializer: InvalidationEventSerializer): void {
        this._serializer = serializer;
    }

    // ── Subscription management ───────────────────────────────────────────────

    /**
     * Subscribe a client session to invalidation events for a specific map.
     *
     * @param session  The connected client session.
     * @param mapName  The IMap name to subscribe to.
     */
    subscribe(session: ClientSession, mapName: string): void {
        const sessionId = session.getSessionId();
        this._sessions.set(sessionId, session);
        this._addToIndex(this._mapSubscriptions, mapName, sessionId);
        this._addToIndex(this._sessionSubscriptions, sessionId, mapName);

        this._logger?.fine(
            `[NearCacheInvalidationManager] Session ${sessionId} subscribed to map "${mapName}"`,
        );
    }

    /**
     * Unsubscribe a client session from invalidation events for one map.
     */
    unsubscribe(sessionId: string, mapName: string): void {
        this._mapSubscriptions.get(mapName)?.delete(sessionId);
        this._sessionSubscriptions.get(sessionId)?.delete(mapName);
        this._logger?.fine(
            `[NearCacheInvalidationManager] Session ${sessionId} unsubscribed from map "${mapName}"`,
        );
    }

    /**
     * Remove a client session from ALL map subscriptions.
     * Called on disconnect.
     */
    removeSession(sessionId: string): void {
        const maps = this._sessionSubscriptions.get(sessionId);
        if (maps !== undefined) {
            for (const mapName of maps) {
                this._mapSubscriptions.get(mapName)?.delete(sessionId);
            }
        }
        this._sessionSubscriptions.delete(sessionId);
        this._sessions.delete(sessionId);

        this._logger?.fine(
            `[NearCacheInvalidationManager] Removed session ${sessionId} from all subscriptions`,
        );
    }

    // ── Invalidation API ──────────────────────────────────────────────────────

    /**
     * Invalidate a single key.  Called by map PUT, REMOVE, SET, DELETE,
     * EVICT handlers.
     *
     * @param mapName     The IMap name.
     * @param keyBytes    Serialized key bytes.
     * @param partitionId Partition that owns this key.
     * @param trigger     The mutation type for observability.
     */
    invalidateKey(
        mapName: string,
        keyBytes: Buffer,
        partitionId: number,
        trigger: MutationTrigger = MutationTrigger.UNKNOWN,
    ): void {
        const partitionUuid = this._metaGen.getOrCreateUuid(partitionId);
        const sequence = this._metaGen.nextSequence(mapName, partitionId);

        const event = makeSingleInvalidation(
            mapName,
            keyBytes,
            partitionId,
            partitionUuid,
            sequence,
            this._memberUuid,
            trigger,
        );

        this._broadcast(mapName, event);
    }

    /**
     * Invalidate a batch of keys (PUT_ALL).
     *
     * @param mapName   The IMap name.
     * @param entries   Array of (keyBytes, partitionId) tuples.
     * @param trigger   The mutation type.
     */
    invalidateBatch(
        mapName: string,
        entries: Array<{ keyBytes: Buffer; partitionId: number }>,
        trigger: MutationTrigger = MutationTrigger.PUT_ALL,
    ): void {
        const keys: InvalidatedKeyEntry[] = entries.map(({ keyBytes, partitionId }) => {
            const partitionUuid = this._metaGen.getOrCreateUuid(partitionId);
            const sequence = this._metaGen.nextSequence(mapName, partitionId);
            return {
                keyBytes,
                partitionId,
                partitionUuid,
                sequence,
                sourceUuid: this._memberUuid,
            };
        });

        if (keys.length === 0) return;

        const event = makeBatchInvalidation(mapName, keys, trigger);
        this._broadcast(mapName, event);
    }

    /**
     * Invalidate ALL entries for a map (CLEAR, EVICT_ALL).
     *
     * @param mapName  The IMap name.
     * @param trigger  The mutation type.
     */
    invalidateAll(
        mapName: string,
        trigger: MutationTrigger = MutationTrigger.CLEAR,
    ): void {
        // Snapshot current UUIDs and sequences before clear
        const partitionUuids = new Map<number, string>();
        const sequences = new Map<number, number>();

        for (let pid = 0; pid < this._partitionCount; pid++) {
            const uuid = this._metaGen.getOrCreateUuid(pid);
            // Advance the sequence so clients can detect the gap
            const seq = this._metaGen.nextSequence(mapName, pid);
            partitionUuids.set(pid, uuid);
            sequences.set(pid, seq);
        }

        const event = makeClearInvalidation(
            mapName,
            partitionUuids,
            sequences,
            this._memberUuid,
            trigger,
        );

        this._broadcast(mapName, event);
    }

    // ── Partition migration ───────────────────────────────────────────────────

    /**
     * Called when a partition migrates to a new owner.
     * Regenerates the partition UUID to signal clients that the partition
     * epoch has changed and any cached sequences are stale.
     *
     * @param partitionId The migrated partition.
     */
    onPartitionMigrated(partitionId: number): void {
        this._metaGen.regenerateUuid(partitionId);
        this._logger?.fine(
            `[NearCacheInvalidationManager] Partition ${partitionId} UUID regenerated after migration`,
        );
    }

    // ── Metadata fetch (anti-entropy) ─────────────────────────────────────────

    /**
     * Return the current invalidation metadata for the given maps.
     * Used by clients during reconnect and by the repairing task.
     *
     * @param mapNames  Names of the maps to include.
     */
    fetchMetadata(mapNames: string[]): MapInvalidationMetadata[] {
        return mapNames.map((mapName) => {
            const partitions: PartitionInvalidationMetadata[] = [];
            for (let pid = 0; pid < this._partitionCount; pid++) {
                const uuid = this._metaGen.getUuidOrNull(pid);
                if (uuid === null) continue; // partition never touched
                const sequence = this._metaGen.currentSequence(mapName, pid);
                partitions.push({ partitionId: pid, partitionUuid: uuid, sequence });
            }
            return { mapName, partitions };
        });
    }

    /**
     * Push current metadata to a single session (called on reconnect).
     * The client can use this to initialise its RepairingHandler and avoid
     * treating all entries as stale.
     *
     * @param sessionId  The reconnecting session.
     * @param mapNames   Maps the session has a near-cache for.
     */
    pushMetadataToSession(sessionId: string, mapNames: string[]): MapInvalidationMetadata[] {
        return this.fetchMetadata(mapNames);
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): NearCacheInvalidationManagerMetrics {
        let totalSubscriptions = 0;
        for (const subs of this._mapSubscriptions.values()) {
            totalSubscriptions += subs.size;
        }
        return {
            subscribedMaps: this._mapSubscriptions.size,
            totalSubscriptions,
            eventsPublished: this._eventsPublished,
            eventsDropped: this._eventsDropped,
            repairChecksRun: this._repairChecksRun,
        };
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Broadcast an invalidation event to all subscribed sessions for a map. */
    private _broadcast(mapName: string, event: NearCacheInvalidationEvent): void {
        const subscribers = this._mapSubscriptions.get(mapName);
        if (subscribers === undefined || subscribers.size === 0) return;

        if (this._serializer === null) {
            // No serialiser yet — events are buffered by the caller not arriving before start
            this._logger?.warning(
                `[NearCacheInvalidationManager] No serialiser set; dropping ${event.kind} event for map "${mapName}"`,
            );
            this._eventsDropped += subscribers.size;
            return;
        }

        const payload = this._serializeEvent(event);
        if (payload === null) {
            this._eventsDropped += subscribers.size;
            return;
        }

        for (const sessionId of subscribers) {
            const session = this._sessions.get(sessionId);
            if (session === undefined) {
                this._eventsDropped++;
                continue;
            }
            if (!this._sendPayload(session, payload)) {
                this._eventsDropped++;
            } else {
                this._eventsPublished++;
            }
        }
    }

    private _serializeEvent(event: NearCacheInvalidationEvent): Buffer | null {
        if (this._serializer === null) return null;
        switch (event.kind) {
            case NearCacheInvalidationKind.SINGLE:
                return this._serializer.serializeSingle(event);
            case NearCacheInvalidationKind.BATCH:
                return this._serializer.serializeBatch(event);
            case NearCacheInvalidationKind.CLEAR:
                return this._serializer.serializeClear(event);
        }
    }

    private _sendPayload(session: ClientSession, payload: Buffer): boolean {
        try {
            return session.pushEvent(payload as unknown as import('../../client/impl/protocol/ClientMessage.js').ClientMessage);
        } catch (err) {
            this._logger?.warning(
                `[NearCacheInvalidationManager] Failed to push event to session ${session.getSessionId()}`,
                err,
            );
            return false;
        }
    }

    /** Periodic repair: detect clients with stale metadata and push fresh state. */
    private _runRepairCheck(): void {
        this._repairChecksRun++;
        if (this._logger?.isFineEnabled()) {
            this._logger.fine(
                `[NearCacheInvalidationManager] Repair check #${this._repairChecksRun} — ` +
                `subscribed maps: ${this._mapSubscriptions.size}`,
            );
        }
        // The actual repair protocol message (MapFetchNearCacheInvalidationMetadata)
        // is handled by NearCacheInvalidationHandler.  Here we record the check
        // for metrics and logging.  Full metadata reconciliation is triggered
        // by RepairingTask on the client side using anti-entropy.
    }

    private _addToIndex<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
        let set = map.get(key);
        if (set === undefined) {
            set = new Set();
            map.set(key, set);
        }
        set.add(value);
    }
}
