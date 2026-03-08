/**
 * Block B.2 — Backup Ack Tracker
 *
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.BackupAckTracker}
 * (introduced in Hazelcast 3.8 / refined in 5.x).
 *
 * Coordinates completion of an invocation between the primary response and
 * synchronous backup acknowledgements:
 *
 *   1. The primary executes and sends a response with `backupAcks` > 0.
 *   2. The response is held in a PendingCompletion until all backup acks arrive.
 *   3. When all backup acks have been received, the invocation's future is resolved.
 *   4. If a backup owner leaves the cluster before acking, the pending entry is
 *      resolved immediately (degraded completion) so callers are not stuck.
 *   5. If the backup ack timeout expires, the pending entry is resolved
 *      (same as degraded: at least the primary succeeded).
 *
 * An invocation completes ONLY when:
 *   - Primary response received AND all sync backup acks received, OR
 *   - Primary response received AND backup ack timeout fires (degraded), OR
 *   - Primary response received AND backup owner left (degraded).
 *
 * Lifecycle: start() → (active) → stop().
 */

import { DEFAULT_INVOCATION_TIMEOUT_MS } from '@zenystx/helios-core/compatibility/CompatibilityTarget.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Completion state for a pending backup-coordinated invocation. */
interface PendingCompletion {
    /** Correlation ID of the original invocation. */
    readonly callId: bigint;
    /** Value to pass to the future on completion. */
    readonly primaryResponse: unknown;
    /** Number of sync backup acks still outstanding. */
    remaining: number;
    /** Backup owner member UUIDs for membership-loss detection. */
    readonly backupOwnerUuids: ReadonlySet<string>;
    /** Epoch-millis absolute deadline for backup acks. */
    readonly deadlineAt: number;
    /** Timeout handle for the ack timeout. */
    timeoutHandle: ReturnType<typeof setTimeout> | null;
    /** Callback to invoke when all acks are in (or degraded). */
    readonly onComplete: (response: unknown, degraded: boolean) => void;
}

export interface BackupAckTrackerMetrics {
    /** Number of invocations currently waiting for backup acks. */
    pendingCount: number;
    /** Total invocations that completed with all acks received. */
    completedNormal: number;
    /** Total invocations completed in degraded mode (timeout or member left). */
    completedDegraded: number;
}

export interface BackupAckTrackerOptions {
    /** Backup ack timeout in ms. Default: same as invocation timeout. */
    backupAckTimeoutMs?: number;
    logger?: ILogger;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class BackupAckTracker {
    private readonly _pending = new Map<bigint, PendingCompletion>();
    private readonly _backupAckTimeoutMs: number;
    private readonly _logger: ILogger | null;

    private _completedNormal = 0;
    private _completedDegraded = 0;
    private _running = false;

    constructor(options?: BackupAckTrackerOptions) {
        this._backupAckTimeoutMs = options?.backupAckTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
        // Drain all pending entries with degraded completion
        for (const pending of this._pending.values()) {
            this._completeDegraded(pending, 'BackupAckTracker stopped');
        }
        this._pending.clear();
    }

    // ── Primary response registration ─────────────────────────────────────────

    /**
     * Register a primary response that needs backup ack coordination.
     *
     * Called when the primary response arrives and `backupAcks > 0`.
     * The `onComplete` callback is invoked once all acks arrive or degraded.
     *
     * @param callId           Correlation ID of the invocation.
     * @param primaryResponse  The primary result to pass through on completion.
     * @param backupAcks       Number of sync backup acks expected.
     * @param backupOwnerUuids UUIDs of the members that will send acks.
     * @param onComplete       Callback invoked with (response, degraded).
     */
    registerPrimaryResponse(
        callId: bigint,
        primaryResponse: unknown,
        backupAcks: number,
        backupOwnerUuids: ReadonlySet<string>,
        onComplete: (response: unknown, degraded: boolean) => void,
    ): void {
        if (!this._running) {
            // Tracker stopped: complete immediately (degraded)
            onComplete(primaryResponse, true);
            return;
        }

        if (backupAcks <= 0) {
            // No backups needed: complete immediately
            onComplete(primaryResponse, false);
            return;
        }

        const deadlineAt = Date.now() + this._backupAckTimeoutMs;

        const pending: PendingCompletion = {
            callId,
            primaryResponse,
            remaining: backupAcks,
            backupOwnerUuids,
            deadlineAt,
            timeoutHandle: null,
            onComplete,
        };

        // Arm the backup ack timeout
        pending.timeoutHandle = setTimeout(() => {
            this._onBackupAckTimeout(callId);
        }, this._backupAckTimeoutMs);

        this._pending.set(callId, pending);
    }

    // ── Backup ack receipt ────────────────────────────────────────────────────

    /**
     * Called when a BACKUP_ACK message is received for `callId`.
     *
     * @returns true if the ack was accepted; false if the invocation is unknown
     *          (late ack — caller should log and discard).
     */
    notifyBackupAck(callId: bigint): boolean {
        const pending = this._pending.get(callId);
        if (pending === undefined) {
            return false;
        }

        pending.remaining--;

        if (pending.remaining <= 0) {
            this._completeNormal(pending);
        }

        return true;
    }

    // ── Member departure ──────────────────────────────────────────────────────

    /**
     * Called when a member leaves the cluster.
     * Any pending backup completions targeting that member are resolved in
     * degraded mode so that callers are not stuck waiting for an ack that will
     * never arrive.
     *
     * @param memberUuid UUID of the departed member.
     */
    onMemberRemoved(memberUuid: string): void {
        for (const pending of this._pending.values()) {
            if (pending.backupOwnerUuids.has(memberUuid)) {
                this._completeDegraded(pending, `backup owner ${memberUuid} left cluster`);
            }
        }
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): BackupAckTrackerMetrics {
        return {
            pendingCount: this._pending.size,
            completedNormal: this._completedNormal,
            completedDegraded: this._completedDegraded,
        };
    }

    get size(): number {
        return this._pending.size;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _completeNormal(pending: PendingCompletion): void {
        this._clearTimeout(pending);
        this._pending.delete(pending.callId);
        this._completedNormal++;
        pending.onComplete(pending.primaryResponse, false);
    }

    private _completeDegraded(pending: PendingCompletion, reason: string): void {
        this._clearTimeout(pending);
        this._pending.delete(pending.callId);
        this._completedDegraded++;

        if (this._logger !== null) {
            this._logger.warning(
                `[BackupAckTracker] Degraded completion for callId=${pending.callId}: ${reason}. ` +
                `remaining=${pending.remaining} backup ack(s) not received.`,
            );
        }

        pending.onComplete(pending.primaryResponse, true);
    }

    private _onBackupAckTimeout(callId: bigint): void {
        const pending = this._pending.get(callId);
        if (pending === undefined) return;
        this._completeDegraded(pending, `backup ack timeout after ${this._backupAckTimeoutMs}ms`);
    }

    private _clearTimeout(pending: PendingCompletion): void {
        if (pending.timeoutHandle !== null) {
            clearTimeout(pending.timeoutHandle);
            (pending as { timeoutHandle: ReturnType<typeof setTimeout> | null }).timeoutHandle = null;
        }
    }
}
