/**
 * Block B.3 — Replica Sync Manager
 *
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionReplicaSyncManager}
 * (abbreviated; key semantics of Hazelcast 5.x).
 *
 * Coordinates replica sync sessions for a single node:
 *
 *  - Assigns stable correlation IDs to outbound sync requests.
 *  - Tracks multi-chunk responses; rejects stale or duplicate chunks.
 *  - Applies chunks deterministically once all have arrived.
 *  - Retries with exponential backoff up to a configurable limit.
 *  - Cleans up timed-out sessions periodically.
 *  - Enforces a maximum chunk size (default 1 MB) for large partition states.
 *
 * Chunked transfer model:
 *   The primary sends N response messages (RECOVERY_SYNC_RESPONSE) with the same
 *   correlationId, sequential chunkIndex [0…chunkCount-1].  The manager collects
 *   chunks until isComplete(), then calls finalize().
 *
 * Lifecycle: start() → active → stop().
 */

import { DEFAULT_INVOCATION_TIMEOUT_MS } from '@zenystx/helios-core/compatibility/CompatibilityTarget.js';
import { DuplicateSyncChunkException, StaleReplicaSyncException } from '@zenystx/helios-core/core/errors/ClusterErrors.js';
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer.js';
import type { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager.js';
import type { ReplicationNamespaceState } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse.js';
import { PartitionReplicaSyncChunkAssembler } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default max chunk size in bytes (1 MB). */
export const DEFAULT_SYNC_CHUNK_SIZE_BYTES = 1024 * 1024;

/** Default max retry attempts before giving up on a sync session. */
const DEFAULT_MAX_RETRIES = 5;

/** Minimum backoff delay on retry (ms). */
const MIN_RETRY_DELAY_MS = 100;

/** Maximum backoff delay on retry (ms). */
const MAX_RETRY_DELAY_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Describes an outbound sync request sent to the primary. */
export interface SyncSession {
    /** Stable correlation ID for this sync session. */
    readonly correlationId: string;
    readonly partitionId: number;
    readonly replicaIndex: number;
    /** UUID of the primary member we're syncing from. */
    readonly targetMemberUuid: string;
    /** Epoch-millis deadline for this session. */
    readonly deadlineAt: number;
    /** Number of retries consumed. */
    retryCount: number;
    /** True when all chunks have been received and finalized. */
    finalized: boolean;
}

/** Internal session state including the chunk assembler. */
interface LiveSyncSession extends SyncSession {
    readonly assembler: PartitionReplicaSyncChunkAssembler;
    /** Epoch counter at the time of creation; used for stale detection. */
    readonly epoch: number;
}

/** Callback interface: the ReplicaSyncManager calls these to dispatch messages. */
export interface SyncRequestDispatcher {
    /**
     * Send a sync request to the primary.
     * @param correlationId  Stable ID for this sync session.
     * @param targetMemberUuid  UUID of the primary.
     * @param partitionId    Partition to sync.
     * @param replicaIndex   Replica index we need.
     */
    sendSyncRequest(
        correlationId: string,
        targetMemberUuid: string,
        partitionId: number,
        replicaIndex: number,
    ): void;
}

export interface ReplicaSyncManagerOptions {
    /** Session timeout in ms. Default: {@link DEFAULT_INVOCATION_TIMEOUT_MS}. */
    sessionTimeoutMs?: number;
    /** Max retry count. Default: 5. */
    maxRetries?: number;
    /** Max chunk size in bytes. Default: 1 MB. */
    chunkSizeBytes?: number;
    /** Periodic cleanup interval in ms. Default: 5_000. */
    cleanupIntervalMs?: number;
    logger?: ILogger;
}

export interface ReplicaSyncManagerMetrics {
    activeSessions: number;
    completedSessions: number;
    timedOutSessions: number;
    retriedSessions: number;
    rejectedDuplicates: number;
    rejectedStale: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class ReplicaSyncManager {
    private readonly _sessions = new Map<string, LiveSyncSession>();
    private readonly _sessionTimeoutMs: number;
    private readonly _maxRetries: number;
    private readonly _chunkSizeBytes: number;
    private readonly _cleanupIntervalMs: number;
    private readonly _logger: ILogger | null;

    /** Monotonically increasing epoch: incremented on membership changes. */
    private _epoch = 0;

    private _cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    // Metrics
    private _completedSessions = 0;
    private _timedOutSessions = 0;
    private _retriedSessions = 0;
    private _rejectedDuplicates = 0;
    private _rejectedStale = 0;

    constructor(options?: ReplicaSyncManagerOptions) {
        this._sessionTimeoutMs = options?.sessionTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
        this._maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
        this._chunkSizeBytes = options?.chunkSizeBytes ?? DEFAULT_SYNC_CHUNK_SIZE_BYTES;
        this._cleanupIntervalMs = options?.cleanupIntervalMs ?? 5_000;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        if (this._running) return;
        this._running = true;
        this._cleanupTimer = setInterval(() => this._cleanup(), this._cleanupIntervalMs);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._cleanupTimer !== null) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this._sessions.clear();
    }

    // ── Session management ────────────────────────────────────────────────────

    /**
     * Create a new sync session and return the correlation ID.
     * Sends the initial request via the dispatcher.
     *
     * @param partitionId       Partition to sync.
     * @param replicaIndex      Replica index we need.
     * @param targetMemberUuid  UUID of the primary.
     * @param dispatcher        Used to send the sync request message.
     * @returns The correlation ID for this session.
     */
    createSession(
        partitionId: number,
        replicaIndex: number,
        targetMemberUuid: string,
        dispatcher: SyncRequestDispatcher,
    ): string {
        const correlationId = crypto.randomUUID();
        const now = Date.now();

        const session: LiveSyncSession = {
            correlationId,
            partitionId,
            replicaIndex,
            targetMemberUuid,
            deadlineAt: now + this._sessionTimeoutMs,
            retryCount: 0,
            finalized: false,
            assembler: new PartitionReplicaSyncChunkAssembler(),
            epoch: this._epoch,
        };

        this._sessions.set(correlationId, session);
        dispatcher.sendSyncRequest(correlationId, targetMemberUuid, partitionId, replicaIndex);

        return correlationId;
    }

    /**
     * Accept a response chunk for an active session.
     *
     * @param correlationId  The session ID.
     * @param chunkIndex     Zero-based index of this chunk.
     * @param chunkCount     Total number of chunks in this response.
     * @param namespaceStates The namespace states in this chunk.
     * @returns true if the chunk was accepted and is the final one (ready to finalize).
     * @throws StaleReplicaSyncException if the session is stale or unknown.
     * @throws DuplicateSyncChunkException if this chunk was already received.
     */
    acceptChunk(
        correlationId: string,
        chunkIndex: number,
        chunkCount: number,
        namespaceStates: readonly ReplicationNamespaceState[],
    ): boolean {
        const session = this._sessions.get(correlationId);
        if (session === undefined) {
            this._rejectedStale++;
            throw new StaleReplicaSyncException(correlationId, 'unknown session (may have expired or been finalized)');
        }

        if (session.epoch !== this._epoch) {
            this._sessions.delete(correlationId);
            this._rejectedStale++;
            throw new StaleReplicaSyncException(correlationId, `epoch mismatch: session=${session.epoch}, current=${this._epoch}`);
        }

        if (session.finalized) {
            this._rejectedStale++;
            throw new StaleReplicaSyncException(correlationId, 'session already finalized');
        }

        const accepted = session.assembler.acceptChunk(chunkIndex, chunkCount, namespaceStates);
        if (!accepted) {
            this._rejectedDuplicates++;
            throw new DuplicateSyncChunkException(correlationId, chunkIndex);
        }

        return session.assembler.isComplete();
    }

    /**
     * Finalize a complete sync session: apply all chunks to the container.
     *
     * Chunks are applied deterministically (sorted by chunkIndex via the assembler).
     * The session is removed from the active map.
     *
     * @param correlationId    The session to finalize.
     * @param container        The backup's partition container to apply state into.
     * @param replicaManager   Used to finalize version stamps and release permits.
     * @param versions         Replica version vector from the primary.
     * @param namespaceVersions Per-namespace version vectors.
     * @returns true if the session was found and finalized.
     */
    finalizeSession(
        correlationId: string,
        container: PartitionContainer,
        replicaManager: PartitionReplicaManager,
        versions: bigint[],
        namespaceVersions?: ReadonlyMap<string, bigint[]>,
    ): boolean {
        const session = this._sessions.get(correlationId);
        if (session === undefined) return false;
        if (!session.assembler.isComplete()) return false;

        session.finalized = true;
        this._sessions.delete(correlationId);

        try {
            const allStates = session.assembler.buildNamespaceStates();

            // Apply each namespace state to the container
            for (const state of allStates) {
                const store = container.getRecordStore(state.namespace);
                store.clear();
                for (const [key, value] of state.entries) {
                    store.put(key, value, -1, -1);
                }
            }

            // Finalize versions
            replicaManager.finalizeReplicaSync(session.partitionId, session.replicaIndex, versions);
            if (namespaceVersions && namespaceVersions.size > 0) {
                replicaManager.finalizeNamespaceReplicaSync(
                    session.partitionId,
                    session.replicaIndex,
                    namespaceVersions,
                );
            }

            // Release sync permit
            replicaManager.releaseReplicaSyncPermits(1);

            this._completedSessions++;
            return true;
        } catch (err) {
            if (this._logger !== null) {
                this._logger.severe(
                    `[ReplicaSyncManager] Failed to finalize session ${correlationId}: ${err}`,
                    err,
                );
            }
            replicaManager.releaseReplicaSyncPermits(1);
            return false;
        }
    }

    /**
     * Retry a timed-out or failed session with exponential backoff.
     *
     * @param correlationId  The old (failed) session ID.
     * @param dispatcher     Used to send the retry request.
     * @returns The new correlation ID, or null if max retries exceeded.
     */
    retrySession(
        correlationId: string,
        dispatcher: SyncRequestDispatcher,
    ): string | null {
        const session = this._sessions.get(correlationId);
        if (session === undefined) return null;

        if (session.retryCount >= this._maxRetries) {
            if (this._logger !== null) {
                this._logger.warning(
                    `[ReplicaSyncManager] Session ${correlationId} exhausted max retries (${this._maxRetries}). ` +
                    `partition=${session.partitionId} replica=${session.replicaIndex}`,
                );
            }
            this._sessions.delete(correlationId);
            return null;
        }

        this._sessions.delete(correlationId);
        this._retriedSessions++;

        const retryCount = session.retryCount + 1;
        const delayMs = Math.min(MIN_RETRY_DELAY_MS * Math.pow(2, retryCount - 1), MAX_RETRY_DELAY_MS);

        if (this._logger !== null) {
            this._logger.fine(
                `[ReplicaSyncManager] Retrying session (${retryCount}/${this._maxRetries}) for ` +
                `partition=${session.partitionId} replica=${session.replicaIndex} ` +
                `in ${delayMs}ms`,
            );
        }

        const newCorrelationId = crypto.randomUUID();
        const now = Date.now();
        const newSession: LiveSyncSession = {
            correlationId: newCorrelationId,
            partitionId: session.partitionId,
            replicaIndex: session.replicaIndex,
            targetMemberUuid: session.targetMemberUuid,
            deadlineAt: now + delayMs + this._sessionTimeoutMs,
            retryCount,
            finalized: false,
            assembler: new PartitionReplicaSyncChunkAssembler(),
            epoch: this._epoch,
        };

        this._sessions.set(newCorrelationId, newSession);

        setTimeout(() => {
            if (this._sessions.has(newCorrelationId)) {
                dispatcher.sendSyncRequest(
                    newCorrelationId,
                    newSession.targetMemberUuid,
                    newSession.partitionId,
                    newSession.replicaIndex,
                );
            }
        }, delayMs);

        return newCorrelationId;
    }

    /**
     * Cancel all sessions targeting a departed member.
     * Called when a member leaves the cluster.
     */
    cancelSessionsForMember(memberUuid: string): string[] {
        const cancelled: string[] = [];
        for (const [correlationId, session] of this._sessions) {
            if (session.targetMemberUuid === memberUuid) {
                this._sessions.delete(correlationId);
                cancelled.push(correlationId);
            }
        }

        if (cancelled.length > 0 && this._logger !== null) {
            this._logger.fine(
                `[ReplicaSyncManager] Cancelled ${cancelled.length} sync session(s) due to member ${memberUuid} departure.`,
            );
        }

        return cancelled;
    }

    /**
     * Increment the epoch. All existing sessions with the old epoch will be
     * treated as stale on the next acceptChunk() call.
     * Call this on membership changes (member added / removed).
     */
    incrementEpoch(): void {
        this._epoch++;
    }

    getSession(correlationId: string): SyncSession | undefined {
        const s = this._sessions.get(correlationId);
        if (s === undefined) return undefined;
        return {
            correlationId: s.correlationId,
            partitionId: s.partitionId,
            replicaIndex: s.replicaIndex,
            targetMemberUuid: s.targetMemberUuid,
            deadlineAt: s.deadlineAt,
            retryCount: s.retryCount,
            finalized: s.finalized,
        };
    }

    getChunkSizeBytes(): number {
        return this._chunkSizeBytes;
    }

    getMetrics(): ReplicaSyncManagerMetrics {
        return {
            activeSessions: this._sessions.size,
            completedSessions: this._completedSessions,
            timedOutSessions: this._timedOutSessions,
            retriedSessions: this._retriedSessions,
            rejectedDuplicates: this._rejectedDuplicates,
            rejectedStale: this._rejectedStale,
        };
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Periodic cleanup: remove sessions that have passed their deadline. */
    private _cleanup(): void {
        const now = Date.now();
        for (const [correlationId, session] of this._sessions) {
            if (now >= session.deadlineAt && !session.finalized) {
                this._sessions.delete(correlationId);
                this._timedOutSessions++;

                if (this._logger !== null) {
                    this._logger.warning(
                        `[ReplicaSyncManager] Session ${correlationId} expired (timeout=${this._sessionTimeoutMs}ms). ` +
                        `partition=${session.partitionId} replica=${session.replicaIndex} ` +
                        `target=${session.targetMemberUuid}`,
                    );
                }
            }
        }
    }
}
