/**
 * Block D.1 — Invocation Lifecycle Manager
 *
 * Port of Hazelcast's invocation retry/lifecycle logic, extended with:
 *
 *  - Per-invocation deadlines (default 120s from CompatibilityTarget)
 *  - Retry classification: read-only, mutating-idempotent, blocking, listener
 *  - Connection-loss handling: retry eligible ops, fail the rest immediately
 *  - Idempotency tracking: unique invocation IDs, recently-completed set to
 *    detect and drop duplicate retries of already-completed ops
 *  - Configurable exponential backoff with jitter
 *  - Backpressure integration via InvocationBackpressure
 *
 * Wraps InvocationMonitor (Block B) and adds classification/retry on top.
 *
 * Lifecycle: start() → active → stop().
 */

import {
    DEFAULT_INVOCATION_TIMEOUT_MS,
} from '@zenystx/helios-core/compatibility/CompatibilityTarget.js';
import type { InvocationBackpressure } from '@zenystx/helios-core/spi/impl/InvocationBackpressure.js';
import type { InvocationMonitor } from '@zenystx/helios-core/spi/impl/InvocationMonitor.js';
import type { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';
import type { ILogger } from '@zenystx/helios-core/test-support/ILogger.js';

// ── Operation classification ───────────────────────────────────────────────────

/**
 * How an operation behaves with respect to retries.
 *
 * READ_ONLY       — idempotent reads: always retry on connection loss.
 * MUTATING        — writes that are NOT idempotent (put, remove): NOT retried.
 * MUTATING_IDEMPOTENT — writes that are safe to retry (putIfAbsent,
 *                   removeIfValue, replaceIfSame, compareAndSet, etc.).
 * BLOCKING        — queue poll with timeout, blocking take: NOT retried.
 * LISTENER        — listener registration: always retry.
 */
export enum OperationKind {
    READ_ONLY = 'READ_ONLY',
    MUTATING = 'MUTATING',
    MUTATING_IDEMPOTENT = 'MUTATING_IDEMPOTENT',
    BLOCKING = 'BLOCKING',
    LISTENER = 'LISTENER',
}

// ── Registration state ────────────────────────────────────────────────────────

/** State machine for a managed invocation. */
export enum InvocationState {
    PENDING = 'PENDING',
    IN_FLIGHT = 'IN_FLIGHT',
    RETRYING = 'RETRYING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManagedInvocationDescriptor {
    /** Unique invocation ID assigned at submission time. */
    readonly invocationId: string;
    /** Monotonic call ID used by InvocationMonitor correlation. */
    readonly callId: bigint;
    /** Operation classification for retry decisions. */
    readonly kind: OperationKind;
    /** Target member UUID, or null for any member. */
    readonly targetMemberUuid: string | null;
    /** Epoch-millis when the invocation was created. */
    readonly createdAt: number;
    /** Absolute deadline epoch-millis. */
    readonly deadlineAt: number;
    /** Number of retry attempts made so far. */
    retryCount: number;
    /** Current lifecycle state. */
    state: InvocationState;
    /** The future to resolve on completion. */
    readonly future: InvocationFuture<unknown>;
    /** Backpressure release callback from InvocationBackpressure.acquire(). */
    bpRelease: (() => void) | null;
}

export interface InvocationLifecycleManagerOptions {
    /** Default invocation deadline in ms. Default: 120_000. */
    invocationTimeoutMs?: number;
    /** Max retry attempts before permanent failure. Default: 100. */
    maxRetries?: number;
    /** Initial retry backoff in ms. Default: 1_000. */
    initialBackoffMs?: number;
    /** Maximum retry backoff in ms. Default: 30_000. */
    maxBackoffMs?: number;
    /** Jitter fraction [0, 1] applied to backoff. Default: 0.2. */
    jitterFraction?: number;
    /** How many recently-completed invocation IDs to keep for dedup. Default: 1_000. */
    completedIdCacheSize?: number;
    logger?: ILogger;
}

export interface InvocationLifecycleMetrics {
    active: number;
    completed: number;
    failed: number;
    retriedOnConnectionLoss: number;
    failedOnConnectionLoss: number;
    droppedDuplicates: number;
    timedOut: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class InvocationLifecycleManager {
    private readonly _monitor: InvocationMonitor;
    private readonly _backpressure: InvocationBackpressure | null;
    private readonly _logger: ILogger | null;

    private readonly _invocationTimeoutMs: number;
    private readonly _maxRetries: number;
    private readonly _initialBackoffMs: number;
    private readonly _maxBackoffMs: number;
    private readonly _jitterFraction: number;
    private readonly _completedIdCacheSize: number;

    /** Active managed invocations by invocationId. */
    private readonly _active = new Map<string, ManagedInvocationDescriptor>();

    /**
     * Circular buffer of recently-completed invocationIds for idempotency
     * deduplication. When a retry of an already-completed op arrives, we drop it.
     */
    private readonly _completedIds: Set<string> = new Set();
    private readonly _completedIdQueue: string[] = [];

    /** Monotonically increasing callId for InvocationMonitor correlation. */
    private _nextCallId: bigint = 1n;

    private _running = false;
    private _scanTimer: ReturnType<typeof setInterval> | null = null;

    // Metrics
    private _completed = 0;
    private _failed = 0;
    private _retriedOnConnectionLoss = 0;
    private _failedOnConnectionLoss = 0;
    private _droppedDuplicates = 0;
    private _timedOut = 0;

    constructor(
        monitor: InvocationMonitor,
        backpressure: InvocationBackpressure | null = null,
        options?: InvocationLifecycleManagerOptions,
    ) {
        this._monitor = monitor;
        this._backpressure = backpressure;
        this._invocationTimeoutMs = options?.invocationTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
        this._maxRetries = options?.maxRetries ?? 100;
        this._initialBackoffMs = options?.initialBackoffMs ?? 1_000;
        this._maxBackoffMs = options?.maxBackoffMs ?? 30_000;
        this._jitterFraction = options?.jitterFraction ?? 0.2;
        this._completedIdCacheSize = options?.completedIdCacheSize ?? 1_000;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        if (this._running) return;
        this._running = true;
        this._scanTimer = setInterval(() => this._scanDeadlines(), 1_000);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._scanTimer !== null) {
            clearInterval(this._scanTimer);
            this._scanTimer = null;
        }
        const cause = new Error('InvocationLifecycleManager stopped');
        for (const inv of this._active.values()) {
            this._failInvocation(inv, cause);
        }
        this._active.clear();
    }

    // ── Submission ────────────────────────────────────────────────────────────

    /**
     * Submit a new invocation for lifecycle management.
     *
     * Acquires a backpressure slot (if configured), assigns a unique invocationId
     * and callId, registers with InvocationMonitor, and returns the descriptor.
     *
     * @param future          The InvocationFuture to resolve.
     * @param kind            Operation classification for retry decisions.
     * @param targetMemberUuid Target member UUID, or null.
     * @param callTimeoutMs   Override deadline, or 0 for the default.
     */
    async submit(
        future: InvocationFuture<unknown>,
        kind: OperationKind,
        targetMemberUuid: string | null = null,
        callTimeoutMs: number = 0,
    ): Promise<ManagedInvocationDescriptor> {
        const now = Date.now();
        const timeout = callTimeoutMs > 0 ? callTimeoutMs : this._invocationTimeoutMs;
        const invocationId = crypto.randomUUID();
        const callId = this._nextCallId++;

        let bpRelease: (() => void) | null = null;
        if (this._backpressure !== null && targetMemberUuid !== null) {
            bpRelease = await this._backpressure.acquire(targetMemberUuid);
        }

        const inv: ManagedInvocationDescriptor = {
            invocationId,
            callId,
            kind,
            targetMemberUuid,
            createdAt: now,
            deadlineAt: now + timeout,
            retryCount: 0,
            state: InvocationState.IN_FLIGHT,
            future,
            bpRelease,
        };

        this._active.set(invocationId, inv);
        this._monitor.register(callId, future, targetMemberUuid, 0, callTimeoutMs);

        return inv;
    }

    // ── Completion ────────────────────────────────────────────────────────────

    /**
     * Mark an invocation as completed successfully.
     * Records its invocationId for idempotency dedup and releases backpressure.
     */
    complete(invocationId: string): boolean {
        const inv = this._active.get(invocationId);
        if (inv === undefined) return false;

        inv.state = InvocationState.COMPLETED;
        this._active.delete(invocationId);
        this._monitor.deregister(inv.callId);
        this._releaseBackpressure(inv);
        this._recordCompleted(invocationId);
        this._completed++;
        return true;
    }

    /**
     * Check whether an invocation with this ID was recently completed.
     * Used by callers to detect retry duplicates.
     */
    wasRecentlyCompleted(invocationId: string): boolean {
        return this._completedIds.has(invocationId);
    }

    /**
     * Drop a duplicate retry: the operation already completed.
     * Increments the droppedDuplicates counter.
     */
    dropDuplicate(invocationId: string): void {
        this._droppedDuplicates++;
        if (this._logger !== null) {
            this._logger.fine(
                `[InvocationLifecycleManager] Dropping duplicate retry for invocationId=${invocationId} ` +
                `(already completed)`,
            );
        }
    }

    // ── Connection loss ───────────────────────────────────────────────────────

    /**
     * Called when a connection to a member is lost.
     *
     * For each pending invocation targeting that member:
     *   - LISTENER and READ_ONLY: schedule a retry with backoff.
     *   - MUTATING_IDEMPOTENT: schedule a retry if under maxRetries.
     *   - MUTATING and BLOCKING: fail immediately.
     *
     * @param memberUuid UUID of the member whose connection was lost.
     * @param reconnectTarget If provided, the new member to retry against.
     */
    onConnectionLost(memberUuid: string, reconnectTarget: string | null = null): void {
        for (const inv of this._active.values()) {
            if (inv.targetMemberUuid !== memberUuid) continue;
            if (inv.state !== InvocationState.IN_FLIGHT && inv.state !== InvocationState.RETRYING) continue;

            if (this._isRetryableOnConnectionLoss(inv)) {
                if (inv.retryCount < this._maxRetries) {
                    this._scheduleRetry(inv, reconnectTarget);
                    this._retriedOnConnectionLoss++;
                } else {
                    const cause = new Error(
                        `Invocation ${inv.invocationId} exceeded maxRetries=${this._maxRetries} ` +
                        `on connection loss to member ${memberUuid}`,
                    );
                    this._failAndRemove(inv, cause);
                    this._failedOnConnectionLoss++;
                }
            } else {
                const cause = new Error(
                    `Connection lost to member ${memberUuid}; ` +
                    `operation kind=${inv.kind} is not retryable`,
                );
                this._failAndRemove(inv, cause);
                this._failedOnConnectionLoss++;
            }
        }
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): InvocationLifecycleMetrics {
        return {
            active: this._active.size,
            completed: this._completed,
            failed: this._failed,
            retriedOnConnectionLoss: this._retriedOnConnectionLoss,
            failedOnConnectionLoss: this._failedOnConnectionLoss,
            droppedDuplicates: this._droppedDuplicates,
            timedOut: this._timedOut,
        };
    }

    getInvocation(invocationId: string): ManagedInvocationDescriptor | undefined {
        return this._active.get(invocationId);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Determine if an operation kind is retryable on connection loss. */
    private _isRetryableOnConnectionLoss(inv: ManagedInvocationDescriptor): boolean {
        switch (inv.kind) {
            case OperationKind.READ_ONLY:
                return true;
            case OperationKind.LISTENER:
                return true;
            case OperationKind.MUTATING_IDEMPOTENT:
                return true;
            case OperationKind.MUTATING:
                return false;
            case OperationKind.BLOCKING:
                return false;
        }
    }

    /**
     * Schedule a retry attempt for the given invocation with exponential backoff + jitter.
     * The retry runs asynchronously after the computed delay.
     */
    private _scheduleRetry(
        inv: ManagedInvocationDescriptor,
        newTargetMemberUuid: string | null,
    ): void {
        inv.state = InvocationState.RETRYING;
        inv.retryCount++;

        // Deregister from monitor before re-registering with new callId
        this._monitor.deregister(inv.callId);

        const delay = this._computeBackoff(inv.retryCount);

        if (this._logger !== null) {
            this._logger.fine(
                `[InvocationLifecycleManager] Scheduling retry #${inv.retryCount} for ` +
                `invocationId=${inv.invocationId} in ${delay}ms` +
                (newTargetMemberUuid ? ` → member ${newTargetMemberUuid}` : ''),
            );
        }

        setTimeout(() => {
            if (!this._active.has(inv.invocationId)) return; // Completed or failed in the meantime
            if (inv.state !== InvocationState.RETRYING) return;

            // Assign a fresh callId for the retry
            const newCallId = this._nextCallId++;
            (inv as { callId: bigint }).callId = newCallId;

            if (newTargetMemberUuid !== null) {
                (inv as { targetMemberUuid: string | null }).targetMemberUuid = newTargetMemberUuid;
            }

            inv.state = InvocationState.IN_FLIGHT;

            const remainingMs = inv.deadlineAt - Date.now();
            if (remainingMs <= 0) {
                const cause = new Error(
                    `Invocation ${inv.invocationId} deadline exceeded during retry scheduling`,
                );
                this._failAndRemove(inv, cause);
                this._timedOut++;
                return;
            }

            this._monitor.register(newCallId, inv.future, inv.targetMemberUuid, 0, remainingMs);
        }, delay);
    }

    /** Compute exponential backoff with jitter for the given retry count. */
    private _computeBackoff(retryCount: number): number {
        const base = Math.min(
            this._initialBackoffMs * Math.pow(2, retryCount - 1),
            this._maxBackoffMs,
        );
        const jitter = base * this._jitterFraction * (Math.random() * 2 - 1);
        return Math.max(0, Math.round(base + jitter));
    }

    /** Periodic deadline scan for active invocations not tracked by InvocationMonitor. */
    private _scanDeadlines(): void {
        const now = Date.now();
        for (const inv of this._active.values()) {
            if (now >= inv.deadlineAt && inv.state !== InvocationState.RETRYING) {
                const cause = new Error(
                    `Invocation ${inv.invocationId} (kind=${inv.kind}) timed out after ` +
                    `${now - inv.createdAt}ms`,
                );
                this._failAndRemove(inv, cause);
                this._timedOut++;
            }
        }
    }

    private _failAndRemove(inv: ManagedInvocationDescriptor, cause: Error): void {
        this._active.delete(inv.invocationId);
        this._failInvocation(inv, cause);
    }

    private _failInvocation(inv: ManagedInvocationDescriptor, cause: Error): void {
        inv.state = InvocationState.FAILED;
        this._monitor.deregister(inv.callId);
        this._releaseBackpressure(inv);
        inv.future.completeExceptionally(cause);
        this._failed++;
    }

    private _releaseBackpressure(inv: ManagedInvocationDescriptor): void {
        if (inv.bpRelease !== null) {
            inv.bpRelease();
            (inv as { bpRelease: null }).bpRelease = null;
        }
    }

    /** Record an invocationId in the recently-completed dedup cache. */
    private _recordCompleted(invocationId: string): void {
        if (this._completedIds.size >= this._completedIdCacheSize) {
            const oldest = this._completedIdQueue.shift();
            if (oldest !== undefined) {
                this._completedIds.delete(oldest);
            }
        }
        this._completedIds.add(invocationId);
        this._completedIdQueue.push(invocationId);
    }
}
