/**
 * Distributed FencedLock — CP Subsystem backed via Raft consensus.
 *
 * Port of com.hazelcast.cp.lock.FencedLock.
 *
 * A FencedLock is a reentrant distributed mutex. Each successful lock
 * acquisition returns a monotonically increasing fence token that callers
 * can use to detect stale operations after a lock has been stolen.
 *
 * All mutations (lock, tryLock, unlock, forceUnlock) go through Raft consensus
 * via executeRaftCommand(). Read-only queries use linearizableRead().
 *
 * When the Raft state machine returns { wait: true }, the caller is registered
 * in a local pending-waiter queue and a WaitKey promise is created via
 * CpSubsystemService.awaitWaitKey / awaitWaitKeyWithTimeout. After each
 * successful unlock/forceUnlock the service drains the queue by attempting
 * FLOCK_LOCK for the next waiter.
 */

import type { CpSubsystemService } from './CpSubsystemService.js';

/** Returned from tryLock when the lock cannot be acquired within the timeout. */
export const INVALID_FENCE = -1n;

// ── Pending-waiter tracking ──────────────────────────────────────────────────

interface PendingWaiter {
    sessionId: bigint;
    threadId: bigint;
    invocationUid: string;
    /** Resolve the outer lock() / tryLock() promise. */
    complete: (fence: bigint) => void;
    /** Timeout handle set only for timed tryLock; null for indefinite lock(). */
    timeoutId: ReturnType<typeof setTimeout> | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function lockKey(groupName: string, lockName: string): string {
    return `flock:${groupName}:${lockName}`;
}

interface FlockRawState {
    owner: { sessionId: string; threadId: string } | null;
    fence: string;
    lockCount: number;
}

function readFlockState(raw: unknown): FlockRawState {
    if (raw === null || raw === undefined) {
        return { owner: null, fence: '0', lockCount: 0 };
    }
    const s = raw as Partial<FlockRawState>;
    return {
        owner: s.owner ?? null,
        fence: typeof s.fence === 'string' ? s.fence : '0',
        lockCount: typeof s.lockCount === 'number' ? s.lockCount : 0,
    };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class FencedLockService {
    static readonly SERVICE_NAME = 'hz:impl:fencedLockService';

    /**
     * Local pending-waiter queues keyed by lockKey().
     * Entries are added when the state machine returns { wait: true } and removed
     * when the lock is granted or the caller times out.
     */
    private readonly _pendingWaiters = new Map<string, PendingWaiter[]>();

    constructor(private readonly _cp: CpSubsystemService) {}

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
        const groupId = this._cp.resolveGroupId(groupName);

        // Check for an idempotent in-flight waiter first
        const existingWaiter = this._findWaiter(key, sessionId, threadId, invocationUid);
        if (existingWaiter !== null) {
            return new Promise<bigint>((resolve) => {
                const prev = existingWaiter.complete;
                existingWaiter.complete = (fence) => {
                    prev(fence);
                    resolve(fence);
                };
            });
        }

        const result = await this._cp.executeRaftCommand(groupName, {
            type: 'FLOCK_LOCK',
            groupId,
            key,
            payload: {
                sessionId: String(sessionId),
                threadId: String(threadId),
            },
            invocationUid,
        }) as { fence: string } | { wait: true };

        if ('fence' in result) {
            return BigInt(result.fence);
        }

        // Lock held by someone else — register as a waiter and block indefinitely
        return new Promise<bigint>((resolve) => {
            const waiter: PendingWaiter = {
                sessionId,
                threadId,
                invocationUid,
                complete: resolve,
                timeoutId: null,
            };
            this._enqueueWaiter(key, waiter);

            // The WaitKey promise drives notification when the lock becomes free.
            // We don't await it here — _drainWaiters() will pick it up after unlock.
            void this._cp.awaitWaitKey(groupName, lockName, sessionId, threadId, invocationUid)
                .then((fence) => {
                    this._removeWaiter(key, waiter);
                    resolve(fence);
                });
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
        const groupId = this._cp.resolveGroupId(groupName);

        // Check for an idempotent in-flight waiter first
        const existingWaiter = this._findWaiter(key, sessionId, threadId, invocationUid);
        if (existingWaiter !== null) {
            return new Promise<bigint>((resolve) => {
                const prev = existingWaiter.complete;
                existingWaiter.complete = (fence) => {
                    prev(fence);
                    resolve(fence);
                };
            });
        }

        const result = await this._cp.executeRaftCommand(groupName, {
            type: 'FLOCK_TRY_LOCK',
            groupId,
            key,
            payload: {
                sessionId: String(sessionId),
                threadId: String(threadId),
                timeoutMs: String(timeoutMs),
            },
            invocationUid,
        }) as { fence: string } | { timeout: true } | { wait: true };

        if ('fence' in result) {
            return BigInt(result.fence);
        }

        if ('timeout' in result) {
            return INVALID_FENCE;
        }

        // Lock is held and caller has a positive timeout — wait
        return new Promise<bigint>((resolve) => {
            const waiter: PendingWaiter = {
                sessionId,
                threadId,
                invocationUid,
                complete: resolve,
                timeoutId: null,
            };

            this._enqueueWaiter(key, waiter);

            // Timed wait: resolve with INVALID_FENCE on timeout
            void this._cp.awaitWaitKeyWithTimeout(
                groupName,
                lockName,
                sessionId,
                threadId,
                invocationUid,
                Number(timeoutMs),
            ).then((fence) => {
                this._removeWaiter(key, waiter);
                if (fence === -1n) {
                    resolve(INVALID_FENCE);
                } else {
                    resolve(fence);
                }
            });
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
        invocationUid: string,
    ): Promise<boolean> {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);

        const released = await this._cp.executeRaftCommand(groupName, {
            type: 'FLOCK_UNLOCK',
            groupId,
            key,
            payload: {
                sessionId: String(sessionId),
                threadId: String(threadId),
            },
            invocationUid,
        }) as boolean;

        if (!released) {
            throw new Error(
                `IllegalMonitorStateException: Session ${sessionId} / thread ${threadId} does not hold lock '${lockName}' in group '${groupName}'`,
            );
        }

        // After a full release (lockCount reached 0), the state machine clears the owner.
        // Check if the lock is now free and grant it to the next waiter.
        await this._drainWaiters(groupName, lockName, key);
        return true;
    }

    /**
     * Forcibly release the lock regardless of ownership.
     * Returns true if the lock was held (and released), false if it was already free.
     */
    async forceUnlock(
        groupName: string,
        lockName: string,
        invocationUid: string,
    ): Promise<boolean> {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);

        const released = await this._cp.executeRaftCommand(groupName, {
            type: 'FLOCK_FORCE_UNLOCK',
            groupId,
            key,
            payload: {},
            invocationUid,
        }) as boolean;

        // Whether or not there was an owner, drain pending waiters
        await this._drainWaiters(groupName, lockName, key);
        return released;
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
        const groupId = this._cp.resolveGroupId(groupName);
        const raw = this._cp.linearizableRead(groupId, key);
        const state = readFlockState(raw);

        if (state.owner === null) {
            return { fence: 0n, lockCount: 0, sessionId: -1n, threadId: -1n };
        }

        return {
            fence: BigInt(state.fence),
            lockCount: state.lockCount,
            sessionId: BigInt(state.owner.sessionId),
            threadId: BigInt(state.owner.threadId),
        };
    }

    /**
     * Returns true if the lock is currently held by anyone.
     */
    isLocked(groupName: string, lockName: string): boolean {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);
        const raw = this._cp.linearizableRead(groupId, key);
        const state = readFlockState(raw);
        return state.owner !== null;
    }

    /**
     * Returns true if the lock is currently held by the given session+thread.
     */
    isLockedByCurrentThread(
        groupName: string,
        lockName: string,
        sessionId: bigint,
        threadId: bigint,
    ): boolean {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);
        const raw = this._cp.linearizableRead(groupId, key);
        const state = readFlockState(raw);
        return (
            state.owner !== null &&
            state.owner.sessionId === String(sessionId) &&
            state.owner.threadId === String(threadId)
        );
    }

    /**
     * Returns the reentrant lock depth for the current holder, or 0 if unlocked.
     */
    getLockCount(groupName: string, lockName: string): number {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);
        const raw = this._cp.linearizableRead(groupId, key);
        const state = readFlockState(raw);
        return state.lockCount;
    }

    /**
     * Destroy the lock, releasing any pending waiters with an error and clearing
     * all Raft state for this lock.
     */
    async destroy(groupName: string, lockName: string): Promise<void> {
        const key = lockKey(groupName, lockName);
        const groupId = this._cp.resolveGroupId(groupName);

        // Reject all pending local waiters
        const waiters = this._pendingWaiters.get(key);
        if (waiters !== undefined) {
            for (const w of waiters) {
                if (w.timeoutId !== null) {
                    clearTimeout(w.timeoutId);
                }
                // Resolve with INVALID_FENCE to signal the lock is gone
                w.complete(INVALID_FENCE);
            }
            this._pendingWaiters.delete(key);
        }

        await this._cp.executeRaftCommand(groupName, {
            type: 'FLOCK_DESTROY',
            groupId,
            key,
            payload: {},
        });
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private _enqueueWaiter(key: string, waiter: PendingWaiter): void {
        const queue = this._pendingWaiters.get(key) ?? [];
        queue.push(waiter);
        this._pendingWaiters.set(key, queue);
    }

    private _removeWaiter(key: string, waiter: PendingWaiter): void {
        const queue = this._pendingWaiters.get(key);
        if (queue === undefined) return;
        const idx = queue.indexOf(waiter);
        if (idx !== -1) {
            queue.splice(idx, 1);
        }
    }

    private _findWaiter(
        key: string,
        sessionId: bigint,
        threadId: bigint,
        invocationUid: string,
    ): PendingWaiter | null {
        const queue = this._pendingWaiters.get(key);
        if (queue === undefined) return null;
        return (
            queue.find(
                (w) =>
                    w.sessionId === sessionId &&
                    w.threadId === threadId &&
                    w.invocationUid === invocationUid,
            ) ?? null
        );
    }

    /**
     * After a lock is released, attempt to grant it to the next pending waiter by
     * submitting a FLOCK_LOCK command on their behalf. If the state machine
     * confirms the acquisition, complete their WaitKey so their promise resolves.
     */
    private async _drainWaiters(groupName: string, lockName: string, key: string): Promise<void> {
        const groupId = this._cp.resolveGroupId(groupName);
        const queue = this._pendingWaiters.get(key);
        if (queue === undefined || queue.length === 0) return;

        // Try to grant the lock to each waiter in FIFO order until one succeeds
        // (the lock may still be re-acquired reentrant by a different path).
        while (queue.length > 0) {
            const next = queue[0]!;

            const result = await this._cp.executeRaftCommand(groupName, {
                type: 'FLOCK_LOCK',
                groupId,
                key,
                payload: {
                    sessionId: String(next.sessionId),
                    threadId: String(next.threadId),
                },
                invocationUid: next.invocationUid,
            }) as { fence: string } | { wait: true };

            if ('fence' in result) {
                // Acquired — remove from queue, cancel any timeout, complete the waiter
                queue.shift();
                if (next.timeoutId !== null) {
                    clearTimeout(next.timeoutId);
                }
                const fence = BigInt(result.fence);
                // Complete the WaitKey so the awaitWaitKey promise also resolves
                const waitKeyId = `${groupName}:${lockName}:${next.sessionId}:${next.threadId}:${next.invocationUid}`;
                this._cp.completeWaitKey(waitKeyId, fence);
                next.complete(fence);
                // Only grant to one waiter at a time
                break;
            }

            // Lock still held (another thread acquired it concurrently) — stop draining
            break;
        }
    }
}
