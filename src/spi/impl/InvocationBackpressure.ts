/**
 * Block B.4 — Invocation Backpressure
 *
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.BackpressureRegulator}
 * (per-member variant, extended with three admission policies).
 *
 * Caps in-flight remote invocations per member with three policies:
 *
 *   REJECT  — Immediately throw BackpressureRejectException when at capacity.
 *   WAIT    — Queue the caller asynchronously up to `waitTimeoutMs`.
 *             Throws BackpressureWaitTimeoutException on timeout.
 *   SHED    — Drop the oldest pending invocation to make room (fire-and-forget
 *             rejection of the displaced waiter).
 *
 * Default: WAIT with a 120s timeout.
 *
 * Metrics per member: queued count, rejected count, shed count.
 * Aggregate metrics: total across all members.
 *
 * Lifecycle: start() → active → stop().
 */

import { BackpressureRejectException, BackpressureWaitTimeoutException } from '@zenystx/helios-core/core/errors/ClusterErrors.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';

// ── Policy enum ───────────────────────────────────────────────────────────────

export enum BackpressurePolicy {
    /** Immediately reject with BackpressureRejectException. */
    REJECT = 'REJECT',
    /** Async wait up to waitTimeoutMs, then throw BackpressureWaitTimeoutException. */
    WAIT = 'WAIT',
    /** Drop the oldest queued waiter to make room for the new one. */
    SHED = 'SHED',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Waiter {
    resolve: () => void;
    reject: (err: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface MemberBackpressureStats {
    memberUuid: string;
    inFlight: number;
    queued: number;
    rejected: number;
    shed: number;
    waitTimeouts: number;
}

export interface BackpressureMetrics {
    totalInFlight: number;
    totalQueued: number;
    totalRejected: number;
    totalShed: number;
    totalWaitTimeouts: number;
    memberStats: MemberBackpressureStats[];
}

export interface InvocationBackpressureOptions {
    /** Max concurrent in-flight invocations per member. Default: 100. */
    maxConcurrentPerMember?: number;
    /** Admission policy. Default: WAIT. */
    policy?: BackpressurePolicy;
    /** Max wait time for WAIT policy (ms). Default: 120_000. */
    waitTimeoutMs?: number;
    logger?: ILogger;
}

// ── Per-member state ──────────────────────────────────────────────────────────

class MemberSlot {
    readonly memberUuid: string;
    readonly maxConcurrent: number;

    inFlight = 0;
    rejected = 0;
    shed = 0;
    waitTimeouts = 0;

    readonly waiters: Waiter[] = [];

    constructor(memberUuid: string, maxConcurrent: number) {
        this.memberUuid = memberUuid;
        this.maxConcurrent = maxConcurrent;
    }

    get queued(): number {
        return this.waiters.length;
    }

    hasCapacity(): boolean {
        return this.inFlight < this.maxConcurrent;
    }

    acquire(): void {
        this.inFlight++;
    }

    release(): void {
        this.inFlight = Math.max(0, this.inFlight - 1);
    }

    enqueueWaiter(waiter: Waiter): void {
        this.waiters.push(waiter);
    }

    shiftWaiter(): Waiter | undefined {
        return this.waiters.shift();
    }

    popOldestWaiter(): Waiter | undefined {
        return this.waiters.shift();
    }

    getStats(): MemberBackpressureStats {
        return {
            memberUuid: this.memberUuid,
            inFlight: this.inFlight,
            queued: this.queued,
            rejected: this.rejected,
            shed: this.shed,
            waitTimeouts: this.waitTimeouts,
        };
    }
}

// ── Implementation ────────────────────────────────────────────────────────────

export class InvocationBackpressure {
    private readonly _memberSlots = new Map<string, MemberSlot>();
    private readonly _maxConcurrentPerMember: number;
    private readonly _policy: BackpressurePolicy;
    private readonly _waitTimeoutMs: number;
    private readonly _logger: ILogger | null;

    private _running = false;

    constructor(options?: InvocationBackpressureOptions) {
        this._maxConcurrentPerMember = options?.maxConcurrentPerMember ?? 100;
        this._policy = options?.policy ?? BackpressurePolicy.WAIT;
        this._waitTimeoutMs = options?.waitTimeoutMs ?? 120_000;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
        // Drain all waiters
        const cause = new Error('InvocationBackpressure stopped');
        for (const slot of this._memberSlots.values()) {
            for (const waiter of slot.waiters) {
                clearTimeout(waiter.timeoutHandle);
                waiter.reject(cause);
            }
            slot.waiters.length = 0;
        }
    }

    // ── Admission ─────────────────────────────────────────────────────────────

    /**
     * Request an invocation slot for the given member.
     *
     * Returns a Promise<release> where `release()` must be called when the
     * invocation completes (normal, error, or timeout).
     *
     * Policy determines what happens when at capacity:
     *   REJECT  → immediately rejects the returned Promise.
     *   WAIT    → queues the caller and resolves when a slot opens.
     *   SHED    → evicts the oldest waiter to make room.
     *
     * @param memberUuid  UUID of the target member.
     * @returns Promise that resolves to a `release` callback.
     */
    async acquire(memberUuid: string): Promise<() => void> {
        const slot = this._getOrCreateSlot(memberUuid);

        if (slot.hasCapacity()) {
            slot.acquire();
            return () => this._release(slot);
        }

        // At capacity — apply policy
        switch (this._policy) {
            case BackpressurePolicy.REJECT:
                return this._applyRejectPolicy(slot);

            case BackpressurePolicy.SHED:
                return this._applyShedPolicy(slot);

            case BackpressurePolicy.WAIT:
            default:
                return this._applyWaitPolicy(slot);
        }
    }

    // ── Member departure ──────────────────────────────────────────────────────

    /**
     * Called when a member leaves the cluster.
     * Releases all in-flight slots and drains all waiters for that member.
     */
    onMemberRemoved(memberUuid: string): void {
        const slot = this._memberSlots.get(memberUuid);
        if (slot === undefined) return;

        // Drain waiters with a cause error
        const cause = new BackpressureRejectException(memberUuid, slot.maxConcurrent, slot.inFlight);
        for (const waiter of slot.waiters) {
            clearTimeout(waiter.timeoutHandle);
            waiter.reject(cause);
        }
        slot.waiters.length = 0;

        // Remove the slot entirely — the member is gone
        this._memberSlots.delete(memberUuid);
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): BackpressureMetrics {
        let totalInFlight = 0;
        let totalQueued = 0;
        let totalRejected = 0;
        let totalShed = 0;
        let totalWaitTimeouts = 0;
        const memberStats: MemberBackpressureStats[] = [];

        for (const slot of this._memberSlots.values()) {
            const stats = slot.getStats();
            totalInFlight += stats.inFlight;
            totalQueued += stats.queued;
            totalRejected += stats.rejected;
            totalShed += stats.shed;
            totalWaitTimeouts += stats.waitTimeouts;
            memberStats.push(stats);
        }

        return { totalInFlight, totalQueued, totalRejected, totalShed, totalWaitTimeouts, memberStats };
    }

    getMemberStats(memberUuid: string): MemberBackpressureStats | null {
        return this._memberSlots.get(memberUuid)?.getStats() ?? null;
    }

    // ── Policy implementations ────────────────────────────────────────────────

    private _applyRejectPolicy(slot: MemberSlot): Promise<() => void> {
        slot.rejected++;
        if (this._logger !== null) {
            this._logger.warning(
                `[InvocationBackpressure] REJECT for member ${slot.memberUuid}: ` +
                `inFlight=${slot.inFlight}/${slot.maxConcurrent}`,
            );
        }
        return Promise.reject(
            new BackpressureRejectException(slot.memberUuid, slot.maxConcurrent, slot.inFlight),
        );
    }

    private _applyWaitPolicy(slot: MemberSlot): Promise<() => void> {
        return new Promise<() => void>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                const idx = slot.waiters.indexOf(waiter);
                if (idx >= 0) slot.waiters.splice(idx, 1);
                slot.waitTimeouts++;
                reject(new BackpressureWaitTimeoutException(slot.memberUuid, this._waitTimeoutMs));
            }, this._waitTimeoutMs);

            const waiter: Waiter = {
                resolve: () => {
                    slot.acquire();
                    resolve(() => this._release(slot));
                },
                reject,
                timeoutHandle,
            };

            slot.enqueueWaiter(waiter);
        });
    }

    private _applyShedPolicy(slot: MemberSlot): Promise<() => void> {
        // Evict the oldest waiting caller to make room
        const oldest = slot.popOldestWaiter();
        if (oldest !== undefined) {
            clearTimeout(oldest.timeoutHandle);
            slot.shed++;
            oldest.reject(
                new BackpressureRejectException(slot.memberUuid, slot.maxConcurrent, slot.inFlight),
            );

            if (this._logger !== null) {
                this._logger.fine(
                    `[InvocationBackpressure] SHED oldest waiter for member ${slot.memberUuid}.`,
                );
            }
        }

        // Now we have one free slot — take it
        slot.acquire();
        return Promise.resolve(() => this._release(slot));
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _release(slot: MemberSlot): void {
        slot.release();
        this._drainWaiters(slot);
    }

    private _drainWaiters(slot: MemberSlot): void {
        while (slot.hasCapacity() && slot.waiters.length > 0) {
            const waiter = slot.shiftWaiter();
            if (waiter === undefined) break;
            clearTimeout(waiter.timeoutHandle);
            waiter.resolve();
        }
    }

    private _getOrCreateSlot(memberUuid: string): MemberSlot {
        let slot = this._memberSlots.get(memberUuid);
        if (slot === undefined) {
            slot = new MemberSlot(memberUuid, this._maxConcurrentPerMember);
            this._memberSlots.set(memberUuid, slot);
        }
        return slot;
    }
}
