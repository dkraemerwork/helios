/**
 * Distributed CountDownLatch — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.ICountDownLatch.
 *
 * Provides a distributed synchronization primitive that allows one or more
 * threads to wait until a set of operations being performed by other threads
 * completes. Backed by Raft consensus for linearizability.
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'cdl:';
const WAITERS_PREFIX = 'cdl:waiters:';

function stateKey(name: string): string {
  return KEY_PREFIX + name;
}

function waitersKey(name: string): string {
  return WAITERS_PREFIX + name;
}

export class CountDownLatchService {
  static readonly SERVICE_NAME = 'hz:impl:countDownLatchService';

  /** Local waiters by latch name. Resolved when count reaches 0. */
  private readonly _waiters = new Map<
    string,
    Array<{ resolve: () => void; reject: (err: Error) => void; timeoutHandle: ReturnType<typeof setTimeout> | null }>
  >();

  constructor(private readonly _cp: CpSubsystemService) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Set the count of the latch. Returns true if successful, false if the current
   * count is already > 0 (cannot reset an active latch).
   */
  async trySetCount(name: string, count: number): Promise<boolean> {
    if (count < 0) throw new Error('Count must be >= 0');
    const current = await this._readCount(name);
    if (current > 0) return false;

    await this._applyCount(name, count);
    return true;
  }

  /**
   * Decrement the count of the latch. If count reaches zero, all waiting threads
   * are released.
   */
  async countDown(name: string): Promise<void> {
    const current = await this._readCount(name);
    if (current <= 0) return;
    const newCount = current - 1;
    await this._applyCount(name, newCount);
    if (newCount === 0) {
      this._releaseWaiters(name);
    }
  }

  /** Returns the current count. */
  async getCount(name: string): Promise<number> {
    return this._readCount(name);
  }

  /**
   * Blocks until the count reaches zero or the timeout elapses.
   * Returns true if count reached zero, false if timeout elapsed.
   */
  async await(name: string, timeoutMs?: number): Promise<boolean> {
    const current = await this._readCount(name);
    if (current <= 0) return true;

    return new Promise<boolean>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        const waiters = this._waiters.get(name);
        if (waiters !== undefined) {
          const idx = waiters.findIndex((w) => w.resolve === onResolve);
          if (idx !== -1) waiters.splice(idx, 1);
        }
      };

      const onResolve = (): void => {
        cleanup();
        resolve(true);
      };

      const waiter: { resolve: () => void; reject: (err: Error) => void; timeoutHandle: ReturnType<typeof setTimeout> | null } = {
        resolve: onResolve,
        reject: () => {},
        timeoutHandle: null,
      };

      if (timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
        waiter.timeoutHandle = timeoutHandle;
      }

      const waiters = this._waiters.get(name) ?? [];
      waiters.push(waiter);
      this._waiters.set(name, waiters);
    });
  }

  destroy(name: string): void {
    this._releaseWaiters(name);
    this._waiters.delete(name);
    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), undefined);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async _readCount(name: string): Promise<number> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const raw = this._cp.readState(CP_GROUP_DEFAULT, stateKey(name));
    return raw !== undefined ? (raw as number) : 0;
  }

  private async _applyCount(name: string, count: number): Promise<void> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);

    await this._cp.executeCommand({
      type: 'CDL_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { count },
    });

    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), count);
  }

  private _releaseWaiters(name: string): void {
    const waiters = this._waiters.get(name);
    if (waiters === undefined) return;
    for (const waiter of waiters) {
      if (waiter.timeoutHandle !== null) clearTimeout(waiter.timeoutHandle);
      waiter.resolve();
    }
    this._waiters.set(name, []);
  }
}
