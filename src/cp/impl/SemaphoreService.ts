/**
 * Distributed Semaphore — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.ISemaphore.
 *
 * Provides a distributed counting semaphore. Permits acquired by a CP session
 * are automatically released if the session times out, preventing deadlocks
 * from failed clients. All mutations go through Raft consensus via
 * executeRaftCommand(). The local waiter queue manages blocking acquires.
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'sem:';

function stateKey(name: string): string {
  return KEY_PREFIX + name;
}

interface SemaphoreState {
  /** Available permits. */
  available: number;
  /** Permits held per session: sessionId -> count */
  sessionPermits: Record<string, number>;
  /** Idempotent results keyed by invocation UUID. */
  invocationResults: Record<string, number | true>;
}

function defaultState(available: number): SemaphoreState {
  return { available, sessionPermits: {}, invocationResults: {} };
}

function deserializeState(raw: unknown): SemaphoreState {
  if (raw === undefined || raw === null) return defaultState(0);
  const value = raw as Partial<SemaphoreState>;
  return {
    available: typeof value.available === 'number' ? value.available : 0,
    sessionPermits: value.sessionPermits ?? {},
    invocationResults: value.invocationResults ?? {},
  };
}

export class SemaphoreService {
  static readonly SERVICE_NAME = 'hz:impl:semaphoreService';

  /** Queued acquire waiters: {permits, sessionId, resolve, reject, timeoutHandle} */
  private readonly _waitQueues = new Map<
    string,
    Array<{
      permits: number;
      sessionId: string | null;
      invocationUuid?: string;
      resolve: () => void;
      reject: (err: Error) => void;
      timeoutHandle: ReturnType<typeof setTimeout> | null;
    }>
  >();

  constructor(private readonly _cp: CpSubsystemService) {
    this._cp.onSessionClosed((sessionId) => {
      void this._releaseAllSessionPermits(sessionId);
    });
  }

  // ── Initialisation ───────────────────────────────────────────────────────

  /**
   * Initialize the semaphore with the given permit count.
   * Returns true if initialization was successful, false if already initialised.
   */
  async init(name: string, permits: number): Promise<boolean> {
    if (permits < 0) throw new Error('Initial permits cannot be negative');
    const result = await this._cp.executeRaftCommand(name, {
      type: 'SEM_INIT',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { permits },
    });
    return result as boolean;
  }

  // ── Acquire ──────────────────────────────────────────────────────────────

  /**
   * Acquire `permits` permits, blocking indefinitely until available.
   * @param sessionId Optional CP session ID for session-aware tracking.
   */
  async acquire(
    name: string,
    permits = 1,
    sessionId: string | null = null,
    invocationUuid?: string,
    timeoutMs?: number,
  ): Promise<boolean> {
    if (permits <= 0) throw new Error('Permits must be positive');
    return this._doAcquire(name, permits, sessionId, timeoutMs, invocationUuid);
  }

  /**
   * Try to acquire `permits` permits within `timeoutMs` milliseconds.
   * Returns true if acquired, false if timeout elapsed.
   */
  async tryAcquire(
    name: string,
    permits = 1,
    timeoutMs?: number,
    sessionId: string | null = null,
    invocationUuid?: string,
  ): Promise<boolean> {
    if (permits <= 0) throw new Error('Permits must be positive');
    return this._doAcquire(name, permits, sessionId, timeoutMs ?? 0, invocationUuid);
  }

  // ── Release ──────────────────────────────────────────────────────────────

  /**
   * Release `permits` permits atomically via SEM_RELEASE Raft command.
   * @param sessionId If provided, decrements that session's tracked permit count.
   */
  async release(
    name: string,
    permits = 1,
    sessionId: string | null = null,
    invocationUuid?: string,
  ): Promise<void> {
    if (permits <= 0) throw new Error('Permits must be positive');
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_RELEASE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: {
        permits,
        sessionId: sessionId !== null ? sessionId : undefined,
        invocationUuid,
      },
    });
    this._drainWaitQueue(name);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  async availablePermits(name: string): Promise<number> {
    return (await this._readState(name)).available;
  }

  /**
   * Drain all available permits atomically via SEM_DRAIN Raft command,
   * returning the number drained.
   */
  async drain(name: string, sessionId: string | null = null, invocationUuid?: string): Promise<number> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'SEM_DRAIN',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: {
        sessionId: sessionId !== null ? sessionId : undefined,
        invocationUuid,
      },
    });
    return result as number;
  }

  /**
   * Reduce available permits by `reduction` atomically via SEM_CHANGE Raft command.
   * If available < reduction, available is set to 0 (permits do not go negative).
   */
  async reducePermits(name: string, reduction: number): Promise<void> {
    if (reduction < 0) throw new Error('Reduction must be >= 0');
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_CHANGE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { permits: -reduction },
    });
  }

  /**
   * Increase available permits by `increase` atomically via SEM_CHANGE Raft command.
   */
  async increasePermits(name: string, increase: number): Promise<void> {
    if (increase < 0) throw new Error('Increase must be >= 0');
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_CHANGE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { permits: increase },
    });
    this._drainWaitQueue(name);
  }

  async change(name: string, permits: number, invocationUuid?: string): Promise<void> {
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_CHANGE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { permits, invocationUuid },
    });
    if (permits > 0) {
      this._drainWaitQueue(name);
    }
  }

  /**
   * Release all permits held by the given session (called on session expiry).
   */
  async releaseSessionPermits(name: string, sessionId: string): Promise<void> {
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_RELEASE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: {
        permits: 0,
        sessionId,
      },
    });
    this._drainWaitQueue(name);
  }

  async destroy(name: string): Promise<void> {
    const waiters = this._waitQueues.get(name);
    if (waiters !== undefined) {
      for (const w of waiters) {
        if (w.timeoutHandle !== null) clearTimeout(w.timeoutHandle);
        w.reject(new Error(`Semaphore '${name}' destroyed`));
      }
      this._waitQueues.delete(name);
    }
    const groupId = this._cp.resolveGroupId(name);
    const objectName = this._cp.resolveObjectName(name);
    await this._cp.executeRaftCommand(name, {
      type: 'SEM_DESTROY',
      groupId,
      key: `sem:${objectName}`,
      payload: null,
    });
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async _readState(name: string): Promise<SemaphoreState> {
    const raw = await this._cp.linearizableRead(CP_GROUP_DEFAULT, stateKey(name));
    return deserializeState(raw);
  }

  /**
   * Attempt to acquire permits atomically via SEM_ACQUIRE, with optional timeout.
   * @param timeoutMs undefined = block forever, 0 = non-blocking, >0 = timed wait.
   * Returns true if acquired, false if timeout.
   */
  private async _doAcquire(
    name: string,
    permits: number,
    sessionId: string | null,
    timeoutMs: number | undefined,
    invocationUuid?: string,
  ): Promise<boolean> {
    const acquired = await this._cp.executeRaftCommand(name, {
      type: 'SEM_ACQUIRE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: {
        permits,
        sessionId: sessionId !== null ? sessionId : undefined,
        invocationUuid,
      },
    });

    if (acquired === true) return true;

    // Non-blocking: return false immediately
    if (timeoutMs === 0) return false;

    // Blocking/timed: enqueue
    return new Promise<boolean>((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const waiter: {
        permits: number;
        sessionId: string | null;
        invocationUuid?: string;
        resolve: () => void;
        reject: (err: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout> | null;
      } = {
        permits,
        sessionId,
        invocationUuid,
        resolve: () => resolve(true),
        reject,
        timeoutHandle: null,
      };

      if (timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          const queue = this._waitQueues.get(name) ?? [];
          const idx = queue.indexOf(waiter);
          if (idx !== -1) queue.splice(idx, 1);
          resolve(false);
        }, timeoutMs);
        waiter.timeoutHandle = timeoutHandle;
      }

      const queue = this._waitQueues.get(name) ?? [];
      queue.push(waiter);
      this._waitQueues.set(name, queue);
    });
  }

  private _drainWaitQueue(name: string): void {
    const queue = this._waitQueues.get(name);
    if (queue === undefined || queue.length === 0) return;

    void (async () => {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < queue.length; ) {
          const waiter = queue[i]!;
          const acquired = await this._cp.executeRaftCommand(name, {
            type: 'SEM_ACQUIRE',
            groupId: CP_GROUP_DEFAULT,
            key: stateKey(name),
            payload: {
              permits: waiter.permits,
              sessionId: waiter.sessionId !== null ? waiter.sessionId : undefined,
              invocationUuid: waiter.invocationUuid,
            },
          });
          if (acquired === true) {
            if (waiter.timeoutHandle !== null) clearTimeout(waiter.timeoutHandle);
            queue.splice(i, 1);
            waiter.resolve();
            changed = true;
          } else {
            i++;
          }
        }
      }
    })();
  }

  private _releaseAllSessionPermits(sessionId: string): void {
    // The CpStateMachine._sessionClose handler already releases all semaphore
    // permits held by this session in the replicated state machine (both
    // single-node and multi-node modes). Here we only need to drain any
    // in-memory waiters that were queued under this session so that pending
    // acquire promises are rejected cleanly rather than hanging forever.
    for (const [name, queue] of this._waitQueues) {
      const remaining: typeof queue = [];
      for (const waiter of queue) {
        if (waiter.sessionId === sessionId) {
          if (waiter.timeoutHandle !== null) clearTimeout(waiter.timeoutHandle);
          waiter.reject(new Error(`CP session ${sessionId} closed`));
        } else {
          remaining.push(waiter);
        }
      }
      if (remaining.length === 0) {
        this._waitQueues.delete(name);
      } else {
        this._waitQueues.set(name, remaining);
      }
    }
  }
}
