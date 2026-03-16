/**
 * Distributed FencedLock — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.lock.FencedLock.
 *
 * A FencedLock is a reentrant distributed mutex. Each successful lock
 * acquisition returns a monotonically increasing fence token that callers
 * can use to detect stale operations after a lock has been stolen.
 *
 * Features:
 *  - Reentrancy: the same session+thread can re-acquire without blocking.
 *  - Waiter queuing: competing acquirers are queued and served in FIFO order.
 *  - Session expiry: a lock is automatically released when the owning CP
 *    session is closed (preventing deadlocks from failed clients).
 *  - Fence tokens: strictly monotone per lock instance, surviving owner changes.
 *
 * The special fence value -1n (INVALID_FENCE) is returned when a tryLock
 * times out without acquiring the lock.
 */

import type { CpSubsystemService } from './CpSubsystemService.js';

/** Returned from tryLock when the lock cannot be acquired within the timeout. */
export const INVALID_FENCE = -1n;

interface LockWaiter {
    sessionId: bigint;
    threadId: bigint;
    invocationUid: string;
    resolve: (fence: bigint) => void;
    timeoutId: ReturnType<typeof setTimeout> | null;
}

interface FencedLockState {
    /** Current owner session, or null when unlocked. */
    owner: { sessionId: bigint; threadId: bigint } | null;
    /** Monotonically increasing token; bumped on every new acquisition. */
    fence: bigint;
    /** Reentrant lock depth (0 when unlocked). */
    lockCount: number;
    /** FIFO queue of callers waiting to acquire. */
    waiters: LockWaiter[];
}

function lockKey(groupName: string, lockName: string): string {
    return `flock:${groupName}:${lockName}`;
}

export class FencedLockService {
    static readonly SERVICE_NAME = 'hz:impl:fencedLockService';

    /** In-memory lock states, keyed by lockKey(). */
    private readonly _locks = new Map<string, FencedLockState>();

    constructor(private readonly _cp: CpSubsystemService) {
        this._cp.onSessionClosed((sessionId) => {
            this._releaseAllLocksForSession(sessionId);
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Acquire the lock, blocking indefinitely until it is available.
     *
     * If the lock is free, it is granted immediately.
     * If the same session+thread already holds it, the reentrant count is
     * incremented and the current fence is returned unchanged.
     * Otherwise the caller is enqueued and the returned Promise resolves when
     * the lock is eventually granted.
     */
    async lock(
        groupName: string,
        lockName: string,
        sessionId: bigint,
        threadId: bigint,
        invocationUid: string,
    ): Promise<bigint> {
        const key = lockKey(groupName, lockName);
        const state = this._getOrCreate(key);

        // Already owned by the same session+thread — reentrant
        if (state.owner !== null && state.owner.sessionId === sessionId && state.owner.threadId === threadId) {
            state.lockCount++;
            return state.fence;
        }

        // Lock is free — acquire immediately
        if (state.owner === null) {
            return this._doAcquire(state, sessionId, threadId);
        }

        // Idempotency: a previous invocation from this caller already enqueued
        const existing = state.waiters.find(
            (w) => w.sessionId === sessionId && w.threadId === threadId && w.invocationUid === invocationUid,
        );
        if (existing !== undefined) {
            return new Promise<bigint>((resolve) => {
                const originalResolve = existing.resolve;
                existing.resolve = (fence) => {
                    originalResolve(fence);
                    resolve(fence);
                };
            });
        }

        // Enqueue and wait
        return new Promise<bigint>((resolve) => {
            state.waiters.push({ sessionId, threadId, invocationUid, resolve, timeoutId: null });
        });
    }

    /**
     * Try to acquire within `timeoutMs` milliseconds.
     * Returns the fence value on success, INVALID_FENCE (-1n) on timeout.
     * timeoutMs=0n means a non-blocking single attempt.
     */
    async tryLock(
        groupName: string,
        lockName: string,
        sessionId: bigint,
        threadId: bigint,
        invocationUid: string,
        timeoutMs: bigint,
    ): Promise<bigint> {
        const key = lockKey(groupName, lockName);
        const state = this._getOrCreate(key);

        // Already owned by the same session+thread — reentrant
        if (state.owner !== null && state.owner.sessionId === sessionId && state.owner.threadId === threadId) {
            state.lockCount++;
            return state.fence;
        }

        // Lock is free — acquire immediately
        if (state.owner === null) {
            return this._doAcquire(state, sessionId, threadId);
        }

        // Non-blocking: fail immediately
        if (timeoutMs <= 0n) {
            return INVALID_FENCE;
        }

        // Idempotency: re-check if already waiting
        const existing = state.waiters.find(
            (w) => w.sessionId === sessionId && w.threadId === threadId && w.invocationUid === invocationUid,
        );
        if (existing !== undefined) {
            return new Promise<bigint>((resolve) => {
                const originalResolve = existing.resolve;
                existing.resolve = (fence) => {
                    originalResolve(fence);
                    resolve(fence);
                };
            });
        }

        // Timed enqueue
        return new Promise<bigint>((resolve) => {
            const waiter: LockWaiter = {
                sessionId,
                threadId,
                invocationUid,
                resolve,
                timeoutId: null,
            };

            waiter.timeoutId = setTimeout(() => {
                const idx = state.waiters.indexOf(waiter);
                if (idx !== -1) {
                    state.waiters.splice(idx, 1);
                }
                resolve(INVALID_FENCE);
            }, Number(timeoutMs));

            state.waiters.push(waiter);
        });
    }

    /**
     * Release the lock held by the given session+thread.
     * Decrements the reentrant count; fully releases when it reaches 0.
     * On full release, the next waiter (if any) is granted the lock.
     * Returns true if the lock was released (partially or fully).
     * Throws if the caller does not hold the lock.
     */
    async unlock(
        groupName: string,
        lockName: string,
        sessionId: bigint,
        threadId: bigint,
        _invocationUid: string,
    ): Promise<boolean> {
        const key = lockKey(groupName, lockName);
        const state = this._getOrCreate(key);

        if (state.owner === null || state.owner.sessionId !== sessionId || state.owner.threadId !== threadId) {
            throw new Error(
                `IllegalMonitorStateException: Session ${sessionId} / thread ${threadId} does not hold lock '${lockName}' in group '${groupName}'`,
            );
        }

        state.lockCount--;

        if (state.lockCount > 0) {
            // Still held (reentrant)
            return true;
        }

        // Fully released
        state.owner = null;
        this._grantNextWaiter(state);
        return true;
    }

    /**
     * Returns the current lock ownership snapshot.
     * If the lock is free, fence = 0n, lockCount = 0, sessionId = -1n, threadId = -1n.
     */
    getLockOwnership(
        groupName: string,
        lockName: string,
    ): { fence: bigint; lockCount: number; sessionId: bigint; threadId: bigint } {
        const key = lockKey(groupName, lockName);
        const state = this._locks.get(key);

        if (state === undefined || state.owner === null) {
            return { fence: 0n, lockCount: 0, sessionId: -1n, threadId: -1n };
        }

        return {
            fence: state.fence,
            lockCount: state.lockCount,
            sessionId: state.owner.sessionId,
            threadId: state.owner.threadId,
        };
    }

    // ── Internal ────────────────────────────────────────────────────────────

    private _getOrCreate(key: string): FencedLockState {
        let state = this._locks.get(key);
        if (state === undefined) {
            state = { owner: null, fence: 0n, lockCount: 0, waiters: [] };
            this._locks.set(key, state);
        }
        return state;
    }

    private _doAcquire(state: FencedLockState, sessionId: bigint, threadId: bigint): bigint {
        state.fence++;
        state.owner = { sessionId, threadId };
        state.lockCount = 1;
        return state.fence;
    }

    private _grantNextWaiter(state: FencedLockState): void {
        while (state.waiters.length > 0) {
            const next = state.waiters.shift()!;
            if (next.timeoutId !== null) {
                clearTimeout(next.timeoutId);
                next.timeoutId = null;
            }
            const fence = this._doAcquire(state, next.sessionId, next.threadId);
            next.resolve(fence);
            return;
        }
    }

    private _releaseAllLocksForSession(sessionId: string): void {
        const sessionIdBigInt = BigInt(sessionId);
        for (const [_key, state] of this._locks) {
            if (state.owner === null || state.owner.sessionId !== sessionIdBigInt) {
                continue;
            }
            // Force-release the lock regardless of reentrant depth
            state.owner = null;
            state.lockCount = 0;
            this._grantNextWaiter(state);
        }
    }
}
