/**
 * Distributed Semaphore — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.ISemaphore.
 *
 * Provides a distributed counting semaphore. Permits acquired by a CP session
 * are automatically released if the session times out, preventing deadlocks
 * from failed clients. Backed by Raft consensus for linearizability.
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
    const current = this._readState(name);
    if (current.available !== 0 || Object.keys(current.sessionPermits).length > 0) {
      return false;
    }
    await this._writeState(name, defaultState(permits));
    return true;
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
   * Release `permits` permits.
   * @param sessionId If provided, decrements that session's tracked permit count.
   */
  async release(
    name: string,
    permits = 1,
    sessionId: string | null = null,
    invocationUuid?: string,
  ): Promise<void> {
    if (permits <= 0) throw new Error('Permits must be positive');
    const state = this._readState(name);
    if (invocationUuid !== undefined && state.invocationResults[invocationUuid] === true) {
      return;
    }
    if (sessionId !== null) {
      const held = state.sessionPermits[sessionId] ?? 0;
      if (held < permits) {
        throw new Error(
          `Session ${sessionId} does not hold enough permits: held=${held}, releasing=${permits}`,
        );
      }
      state.sessionPermits[sessionId] = held - permits;
      if (state.sessionPermits[sessionId] === 0) {
        delete state.sessionPermits[sessionId];
      }
    }
    state.available += permits;
    if (invocationUuid !== undefined) {
      state.invocationResults[invocationUuid] = true;
    }
    await this._writeState(name, state);
    this._drainWaitQueue(name);
  }

  // ── Query ────────────────────────────────────────────────────────────────

  async availablePermits(name: string): Promise<number> {
    return this._readState(name).available;
  }

  /**
   * Drain all available permits, returning the number drained.
   */
  async drain(name: string, sessionId: string | null = null, invocationUuid?: string): Promise<number> {
    const state = this._readState(name);
    if (invocationUuid !== undefined) {
      const previous = state.invocationResults[invocationUuid];
      if (typeof previous === 'number') {
        return previous;
      }
    }
    const drained = state.available;
    state.available = 0;
    if (sessionId !== null && drained > 0) {
      state.sessionPermits[sessionId] = (state.sessionPermits[sessionId] ?? 0) + drained;
    }
    if (invocationUuid !== undefined) {
      state.invocationResults[invocationUuid] = drained;
    }
    await this._writeState(name, state);
    return drained;
  }

  /**
   * Reduce available permits by `reduction`.
   * If available < reduction, available is set to 0 (permits do not go negative).
   */
  async reducePermits(name: string, reduction: number): Promise<void> {
    if (reduction < 0) throw new Error('Reduction must be >= 0');
    const state = this._readState(name);
    state.available = Math.max(0, state.available - reduction);
    await this._writeState(name, state);
  }

  /**
   * Increase available permits by `increase`.
   */
  async increasePermits(name: string, increase: number): Promise<void> {
    if (increase < 0) throw new Error('Increase must be >= 0');
    const state = this._readState(name);
    state.available += increase;
    await this._writeState(name, state);
    this._drainWaitQueue(name);
  }

  async change(name: string, permits: number, invocationUuid?: string): Promise<void> {
    const state = this._readState(name);
    if (invocationUuid !== undefined && state.invocationResults[invocationUuid] === true) {
      return;
    }
    state.available = permits >= 0
      ? state.available + permits
      : Math.max(0, state.available + permits);
    if (invocationUuid !== undefined) {
      state.invocationResults[invocationUuid] = true;
    }
    await this._writeState(name, state);
    if (permits > 0) {
      this._drainWaitQueue(name);
    }
  }

  /**
   * Release all permits held by the given session (called on session expiry).
   */
  async releaseSessionPermits(name: string, sessionId: string): Promise<void> {
    const state = this._readState(name);
    const held = state.sessionPermits[sessionId];
    if (held === undefined || held === 0) return;
    delete state.sessionPermits[sessionId];
    state.available += held;
    await this._writeState(name, state);
    this._drainWaitQueue(name);
  }

  destroy(name: string): void {
    const waiters = this._waitQueues.get(name);
    if (waiters !== undefined) {
      for (const w of waiters) {
        if (w.timeoutHandle !== null) clearTimeout(w.timeoutHandle);
        w.reject(new Error(`Semaphore '${name}' destroyed`));
      }
      this._waitQueues.delete(name);
    }
    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), undefined);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private _readState(name: string): SemaphoreState {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const raw = this._cp.readState(CP_GROUP_DEFAULT, stateKey(name));
    return deserializeState(raw);
  }

  private async _writeState(name: string, state: SemaphoreState): Promise<void> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);

    await this._cp.executeCommand({
      type: 'SEM_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: state,
    });

    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), state);
  }

  /**
   * Attempt to acquire permits, with optional timeout.
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
    const state = this._readState(name);
    if (invocationUuid !== undefined && state.invocationResults[invocationUuid] === true) {
      return true;
    }
    if (state.available >= permits) {
      state.available -= permits;
      if (sessionId !== null) {
        state.sessionPermits[sessionId] = (state.sessionPermits[sessionId] ?? 0) + permits;
      }
      if (invocationUuid !== undefined) {
        state.invocationResults[invocationUuid] = true;
      }
      await this._writeState(name, state);
      return true;
    }

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
        const state = this._readState(name);
        for (let i = 0; i < queue.length; ) {
          const waiter = queue[i]!;
          if (state.available >= waiter.permits) {
            state.available -= waiter.permits;
            if (waiter.sessionId !== null) {
              state.sessionPermits[waiter.sessionId] =
                (state.sessionPermits[waiter.sessionId] ?? 0) + waiter.permits;
            }
            if (waiter.invocationUuid !== undefined) {
              state.invocationResults[waiter.invocationUuid] = true;
            }
            await this._writeState(name, state);
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

  private async _releaseAllSessionPermits(sessionId: string): Promise<void> {
    for (const groupName of this._cp.listGroups()) {
      const group = this._cp.getGroup(groupName);
      if (group === null) {
        continue;
      }

      for (const key of group.stateMachine.keys()) {
        if (!key.startsWith(KEY_PREFIX)) {
          continue;
        }

        const name = key.slice(KEY_PREFIX.length);
        await this.releaseSessionPermits(name, sessionId);
      }
    }
  }
}
