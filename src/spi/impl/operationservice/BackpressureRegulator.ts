/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.BackpressureRegulator}
 * and {@code com.hazelcast.spi.impl.sequence.CallIdSequenceWithBackpressure}.
 *
 * Regulates remote invocation pressure on the Helios clustered runtime by:
 *
 * 1. **Admission control** — caps the number of concurrent in-flight remote
 *    invocations. When the limit is reached, callers wait (with exponential
 *    backoff) up to a configurable timeout before being rejected with an
 *    OverloadError.
 *
 * 2. **Forced sync coercion** — periodically forces async-backup operations
 *    to behave synchronously, draining the backup pipeline and preventing
 *    unbounded queue growth.
 *
 * 3. **Observability** — exposes admission stats (admitted, rejected, waited,
 *    current in-flight count) for monitoring and debugging.
 *
 * Single-threaded (Bun event loop) — no atomics or locks needed.
 *
 * @see BackpressureConfig for configuration knobs.
 */
import type { BackpressureConfig } from '@zenystx/helios-core/config/BackpressureConfig';

/**
 * Error thrown when in-flight invocation pressure exceeds the configured limit
 * and the backoff timeout expires. Callers should catch this to detect overload.
 */
export class OverloadError extends Error {
    readonly maxConcurrentInvocations: number;
    readonly backoffTimeoutMs: number;
    readonly inFlightCount: number;

    constructor(
        maxConcurrentInvocations: number,
        backoffTimeoutMs: number,
        inFlightCount: number,
    ) {
        super(
            `Backpressure: timed out acquiring invocation slot. ` +
            `maxConcurrentInvocations=${maxConcurrentInvocations}, ` +
            `backoffTimeoutMs=${backoffTimeoutMs}, ` +
            `inFlight=${inFlightCount}`,
        );
        this.name = 'OverloadError';
        this.maxConcurrentInvocations = maxConcurrentInvocations;
        this.backoffTimeoutMs = backoffTimeoutMs;
        this.inFlightCount = inFlightCount;
    }
}

/** Snapshot of the regulator's observable admission statistics. */
export interface BackpressureStats {
    /** Whether backpressure is enabled. */
    enabled: boolean;
    /** Configured max concurrent invocations. */
    maxConcurrentInvocations: number;
    /** Current number of in-flight invocations consuming admission slots. */
    inFlightCount: number;
    /** Total number of invocations admitted without waiting. */
    admittedImmediate: number;
    /** Total number of invocations admitted after waiting. */
    admittedAfterWait: number;
    /** Total number of invocations rejected due to backpressure timeout. */
    rejected: number;
    /** Total number of async backups coerced to sync by the sync window. */
    forcedSyncs: number;
}

/**
 * Max delay between spins during backoff, in milliseconds.
 * Matches Hazelcast's MAX_DELAY_MS = 500.
 */
const MAX_BACKOFF_DELAY_MS = 500;

/**
 * Initial minimum spin delay (ms).
 */
const MIN_BACKOFF_DELAY_MS = 1;

export class BackpressureRegulator {
    private readonly _enabled: boolean;
    private readonly _maxConcurrentInvocations: number;
    private readonly _backoffTimeoutMs: number;
    private readonly _syncWindow: number;

    /** Current count of in-flight invocations holding admission. */
    private _inFlight = 0;

    /** Sync countdown — decremented on each async-backup op. Reset when it reaches 0. */
    private _syncCountdown: number;

    /** Monotonically increasing call ID sequence. */
    private _callIdHead = 0;

    // Stats
    private _admittedImmediate = 0;
    private _admittedAfterWait = 0;
    private _rejected = 0;
    private _forcedSyncs = 0;

    /** Waiters queued behind a full admission gate, FIFO. */
    private readonly _waiters: Array<{
        resolve: (callId: number) => void;
        reject: (error: Error) => void;
        deadline: number;
        timeoutHandle: ReturnType<typeof setTimeout>;
    }> = [];

    constructor(config: BackpressureConfig, partitionCount: number) {
        this._enabled = config.isEnabled();
        this._maxConcurrentInvocations =
            config.computeMaxConcurrentInvocations(partitionCount);
        this._backoffTimeoutMs = config.getBackoffTimeoutMs();
        this._syncWindow = config.getSyncWindow();
        this._syncCountdown = this._syncWindow;
    }

    /** Whether backpressure is enabled. */
    get enabled(): boolean {
        return this._enabled;
    }

    /** Configured max concurrent invocations. */
    get maxConcurrentInvocations(): number {
        return this._maxConcurrentInvocations;
    }

    /** Current count of in-flight invocations. */
    get inFlightCount(): number {
        return this._inFlight;
    }

    /** Whether there is space for a new invocation. */
    hasSpace(): boolean {
        if (!this._enabled) return true;
        return this._inFlight < this._maxConcurrentInvocations;
    }

    /**
     * Try to acquire an admission slot and return a call ID.
     *
     * - If space is available, returns the call ID immediately (synchronously).
     * - If at capacity, returns a Promise that resolves with a call ID when a
     *   slot becomes available, or rejects with OverloadError after the
     *   configured backoff timeout.
     * - If backpressure is disabled, always returns immediately.
     */
    tryAcquire(): number | Promise<number> {
        if (!this._enabled) {
            return this._admitImmediate();
        }

        if (this._inFlight < this._maxConcurrentInvocations) {
            return this._admitImmediate();
        }

        // At capacity — queue the caller
        if (this._backoffTimeoutMs === 0) {
            this._rejected++;
            throw new OverloadError(
                this._maxConcurrentInvocations,
                this._backoffTimeoutMs,
                this._inFlight,
            );
        }

        return this._waitForSlot();
    }

    /**
     * Release an admission slot. Must be called exactly once per acquired slot
     * (typically when the invocation completes, times out, or is deregistered).
     *
     * After releasing, any queued waiter is admitted FIFO.
     */
    release(): void {
        if (!this._enabled) return;
        this._inFlight = Math.max(0, this._inFlight - 1);
        this._drainWaiters();
    }

    /**
     * Check whether an async-backup operation should be forced to sync.
     *
     * Implements the Hazelcast sync-window pattern: every N async-backup
     * operations, one is coerced to sync to drain the backup pipeline.
     *
     * @param hasAsyncBackups Whether the operation has async backups.
     * @returns true if the caller should treat this as a forced sync.
     */
    isSyncForced(hasAsyncBackups: boolean): boolean {
        if (!this._enabled || !hasAsyncBackups) return false;

        this._syncCountdown--;
        if (this._syncCountdown > 0) return false;

        // Reset with randomized jitter (±25%)
        this._syncCountdown = this._randomizedSyncDelay();
        this._forcedSyncs++;
        return true;
    }

    /** Return a snapshot of admission statistics. */
    getStats(): BackpressureStats {
        return {
            enabled: this._enabled,
            maxConcurrentInvocations: this._maxConcurrentInvocations,
            inFlightCount: this._inFlight,
            admittedImmediate: this._admittedImmediate,
            admittedAfterWait: this._admittedAfterWait,
            rejected: this._rejected,
            forcedSyncs: this._forcedSyncs,
        };
    }

    /**
     * Reject all pending waiters (used during shutdown or reset).
     */
    rejectAll(cause: Error): void {
        for (const waiter of this._waiters) {
            clearTimeout(waiter.timeoutHandle);
            waiter.reject(cause);
        }
        this._waiters.length = 0;
    }

    /**
     * Reset the regulator (used during shutdown).
     */
    reset(): void {
        this.rejectAll(new Error('BackpressureRegulator reset'));
        this._inFlight = 0;
    }

    // ── Internal ────────────────────────────────────────────────────────

    private _admitImmediate(): number {
        this._inFlight++;
        this._admittedImmediate++;
        return ++this._callIdHead;
    }

    private _waitForSlot(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const deadline = Date.now() + this._backoffTimeoutMs;
            const timeoutHandle = setTimeout(() => {
                this._removeWaiter(waiter);
                this._rejected++;
                reject(
                    new OverloadError(
                        this._maxConcurrentInvocations,
                        this._backoffTimeoutMs,
                        this._inFlight,
                    ),
                );
            }, this._backoffTimeoutMs);

            const waiter = { resolve, reject, deadline, timeoutHandle };
            this._waiters.push(waiter);
        });
    }

    private _drainWaiters(): void {
        while (this._waiters.length > 0 && this._inFlight < this._maxConcurrentInvocations) {
            const waiter = this._waiters.shift()!;
            clearTimeout(waiter.timeoutHandle);

            const now = Date.now();
            if (now >= waiter.deadline) {
                // Already past deadline
                this._rejected++;
                waiter.reject(
                    new OverloadError(
                        this._maxConcurrentInvocations,
                        this._backoffTimeoutMs,
                        this._inFlight,
                    ),
                );
                continue;
            }

            this._inFlight++;
            this._admittedAfterWait++;
            waiter.resolve(++this._callIdHead);
        }
    }

    private _removeWaiter(target: object): void {
        const idx = this._waiters.indexOf(target as any);
        if (idx >= 0) {
            this._waiters.splice(idx, 1);
        }
    }

    /**
     * Compute a randomized sync delay (±25% of the configured sync window).
     * Matches Hazelcast RANGE = 0.25f.
     */
    private _randomizedSyncDelay(): number {
        if (this._syncWindow === 1) return 1;
        const range = 0.25;
        const low = Math.round((1 - range) * this._syncWindow);
        const spread = Math.round(2 * range * this._syncWindow);
        return Math.max(1, low + Math.floor(Math.random() * spread));
    }
}
