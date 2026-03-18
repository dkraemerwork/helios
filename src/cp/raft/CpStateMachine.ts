import type { RaftCommand, RaftEndpoint } from './types.js';
import type { RaftStateMachine } from './RaftStateMachine.js';

// ── Internal state types ────────────────────────────────────────────────────

interface SemaphoreState {
  available: number;
  sessionPermits: Record<string, number>;
  invocationResults: Record<string, number | boolean>;
}

interface CountDownLatchState {
  count: number;
  round: number;
  invocationUuids: string[];
}

interface FencedLockState {
  owner: { sessionId: string; threadId: string } | null;
  fence: string;
  lockCount: number;
}

interface SessionState {
  sessionId: string;
  memberId: string;
  createdAt: number;
  ttlMs: number;
  lastHeartbeatAt: number;
}

// ── Serialization helpers ───────────────────────────────────────────────────

/**
 * For snapshot serialization, Maps stored under `cpmap:*` keys need special
 * handling to convert to/from plain objects since JSON cannot encode Maps.
 */
const CPMAP_PREFIX = 'cpmap:';

function serializeState(state: Map<string, unknown>): Uint8Array {
  const plain: Record<string, unknown> = {};
  for (const [k, v] of state) {
    if (k.startsWith(CPMAP_PREFIX) && v instanceof Map) {
      plain[k] = { __type: 'Map', entries: Object.fromEntries(v) };
    } else {
      plain[k] = v;
    }
  }
  return new TextEncoder().encode(JSON.stringify(plain));
}

function deserializeState(data: Uint8Array): Map<string, unknown> {
  const plain = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
  const result = new Map<string, unknown>();
  for (const [k, v] of Object.entries(plain)) {
    if (k.startsWith(CPMAP_PREFIX) && v !== null && typeof v === 'object' && (v as Record<string, unknown>)['__type'] === 'Map') {
      const entries = (v as { __type: string; entries: Record<string, string> }).entries;
      result.set(k, new Map(Object.entries(entries)));
    } else {
      result.set(k, v);
    }
  }
  return result;
}

// ── BigInt arithmetic helpers ───────────────────────────────────────────────

function readBigInt(state: Map<string, unknown>, key: string): bigint {
  const raw = state.get(key);
  return raw !== undefined && raw !== null ? BigInt(raw as string) : 0n;
}

// ── Semaphore helpers ───────────────────────────────────────────────────────

function readSemaphore(state: Map<string, unknown>, key: string): SemaphoreState {
  const raw = state.get(key);
  if (raw === undefined || raw === null) {
    return { available: 0, sessionPermits: {}, invocationResults: {} };
  }
  const s = raw as Partial<SemaphoreState>;
  return {
    available: typeof s.available === 'number' ? s.available : 0,
    sessionPermits: s.sessionPermits ?? {},
    invocationResults: s.invocationResults ?? {},
  };
}

// ── CountDownLatch helpers ──────────────────────────────────────────────────

function readCdl(state: Map<string, unknown>, key: string): CountDownLatchState {
  const raw = state.get(key);
  if (raw === undefined || raw === null) {
    return { count: 0, round: 0, invocationUuids: [] };
  }
  if (typeof raw === 'number') {
    return { count: raw, round: raw > 0 ? 1 : 0, invocationUuids: [] };
  }
  const s = raw as Partial<CountDownLatchState>;
  return {
    count: typeof s.count === 'number' ? s.count : 0,
    round: typeof s.round === 'number' ? s.round : 0,
    invocationUuids: Array.isArray(s.invocationUuids) ? [...s.invocationUuids] : [],
  };
}

// ── FencedLock helpers ──────────────────────────────────────────────────────

function readFlock(state: Map<string, unknown>, key: string): FencedLockState {
  const raw = state.get(key);
  if (raw === undefined || raw === null) {
    return { owner: null, fence: '0', lockCount: 0 };
  }
  const s = raw as Partial<FencedLockState>;
  return {
    owner: s.owner ?? null,
    fence: typeof s.fence === 'string' ? s.fence : '0',
    lockCount: typeof s.lockCount === 'number' ? s.lockCount : 0,
  };
}

// ── CPMap helpers ───────────────────────────────────────────────────────────

function readCpMap(state: Map<string, unknown>, key: string): Map<string, string> {
  const raw = state.get(key);
  if (raw instanceof Map) return raw as Map<string, string>;
  return new Map<string, string>();
}

const CPMAP_NULL = '__CPMAP_NULL__';

// ── Session helpers ─────────────────────────────────────────────────────────

let _nextSessionId = 1n;

function nextSessionId(): string {
  return String(_nextSessionId++);
}

// ── CpStateMachine ──────────────────────────────────────────────────────────

/**
 * Unified deterministic state machine for all CP subsystem data structures.
 *
 * All state is stored in a single `_state` Map keyed by data-structure prefixes:
 *   - `atomiclong:<name>`  → string (BigInt serialized)
 *   - `atomicref:<name>`   → string (JSON-serialized or "__NULL__")
 *   - `cpmap:<name>`       → Map<string, string>
 *   - `sem:<name>`         → SemaphoreState
 *   - `cdl:<name>`         → CountDownLatchState
 *   - `flock:<group>:<name>` → FencedLockState
 *   - `session:<id>`       → SessionState
 *
 * CRITICAL: apply() must be deterministic — no I/O, no Math.random(), no Date.now().
 * The only exception is SESSION_CREATE, which uses a monotone counter for IDs and
 * accepts `createdAt` from the payload (provided by the caller).
 */
export class CpStateMachine implements RaftStateMachine {
  private readonly _state = new Map<string, unknown>();

  // ── RaftStateMachine interface ─────────────────────────────────────────────

  apply(command: RaftCommand): unknown {
    switch (command.type) {
      // ── AtomicLong ───────────────────────────────────────────────────────
      case 'ATOMIC_LONG_GET':
        return this._atomicLongGet(command.key);

      case 'ATOMIC_LONG_SET':
        return this._atomicLongSet(command.key, command.payload as { newValue: string; returnOld?: boolean });

      case 'ATOMIC_LONG_ADD':
        return this._atomicLongAdd(command.key, command.payload as { delta: string; returnOld?: boolean; returnNew?: boolean });

      case 'ATOMIC_LONG_CAS':
        return this._atomicLongCas(command.key, command.payload as { expect: string; update: string });

      // ── AtomicReference ──────────────────────────────────────────────────
      case 'ATOMIC_REF_GET':
        return this._atomicRefGet(command.key);

      case 'ATOMIC_REF_SET':
        return this._atomicRefSet(command.key, command.payload as { value: string });

      case 'ATOMIC_REF_CAS':
        return this._atomicRefCas(command.key, command.payload as { expect: string; update: string });

      // ── CPMap ────────────────────────────────────────────────────────────
      case 'CPMAP_PUT':
        return this._cpmapPut(command.key, command.payload as { key: string; value: string });

      case 'CPMAP_SET':
        return this._cpmapSet(command.key, command.payload as { key: string; value: string });

      case 'CPMAP_REMOVE':
        return this._cpmapRemove(command.key, command.payload as { key: string });

      case 'CPMAP_DELETE':
        return this._cpmapDelete(command.key, command.payload as { key: string });

      case 'CPMAP_PUT_IF_ABSENT':
        return this._cpmapPutIfAbsent(command.key, command.payload as { key: string; value: string });

      case 'CPMAP_COMPARE_AND_SET':
        return this._cpmapCompareAndSet(command.key, command.payload as { key: string; expectedValue: string; newValue: string });

      // ── Semaphore ────────────────────────────────────────────────────────
      case 'SEM_INIT':
        return this._semInit(command.key, command.payload as { permits: number });

      case 'SEM_ACQUIRE':
        return this._semAcquire(command.key, command.payload as { permits: number; sessionId?: string; invocationUuid?: string });

      case 'SEM_RELEASE':
        return this._semRelease(command.key, command.payload as { permits: number; sessionId?: string; invocationUuid?: string });

      case 'SEM_DRAIN':
        return this._semDrain(command.key, command.payload as { sessionId?: string; invocationUuid?: string });

      case 'SEM_CHANGE':
        return this._semChange(command.key, command.payload as { permits: number; invocationUuid?: string });

      case 'SEM_SET':
        return this._semSet(command.key, command.payload as SemaphoreState);

      // ── CountDownLatch ───────────────────────────────────────────────────
      case 'CDL_TRY_SET_COUNT':
        return this._cdlTrySetCount(command.key, command.payload as { count: number });

      case 'CDL_COUNT_DOWN':
        return this._cdlCountDown(command.key, command.payload as { expectedRound?: number; invocationUuid?: string });

      case 'CDL_GET_COUNT':
        return this._cdlGetCount(command.key);

      case 'CDL_SET':
        return this._cdlSet(command.key, command.payload as CountDownLatchState);

      // ── FencedLock ───────────────────────────────────────────────────────
      case 'FLOCK_LOCK':
        return this._flockLock(command.key, command.payload as { sessionId: string; threadId: string });

      case 'FLOCK_TRY_LOCK':
        return this._flockTryLock(command.key, command.payload as { sessionId: string; threadId: string; timeoutMs: string });

      case 'FLOCK_UNLOCK':
        return this._flockUnlock(command.key, command.payload as { sessionId: string; threadId: string });

      // ── Session ──────────────────────────────────────────────────────────
      case 'SESSION_CREATE':
        return this._sessionCreate(command.payload as { memberId: string; ttlMs: number; createdAt?: number });

      case 'SESSION_HEARTBEAT':
        return this._sessionHeartbeat(command.payload as { sessionId: string; timestamp?: number });

      case 'SESSION_CLOSE':
        return this._sessionClose(command.payload as { sessionId: string });

      // ── Membership / protocol ────────────────────────────────────────────
      case 'RAFT_UPDATE_MEMBERS': {
        // Membership tracking is handled by RaftNode. No state change needed.
        return undefined;
      }

      case 'NOP':
      case 'LINEARIZABLE_READ':
        return null;

      default:
        return null;
    }
  }

  takeSnapshot(): Uint8Array {
    return serializeState(this._state);
  }

  restoreFromSnapshot(data: Uint8Array): void {
    this._state.clear();
    for (const [k, v] of deserializeState(data)) {
      this._state.set(k, v);
    }
  }

  onGroupMembersChanged(_members: readonly RaftEndpoint[]): void {
    // No-op: membership tracking is done by RaftNode.
  }

  // ── State accessor (for snapshot/restore from external code) ──────────────

  getState(): Map<string, unknown> {
    return this._state;
  }

  // ── AtomicLong implementations ────────────────────────────────────────────

  private _atomicLongGet(key: string): string {
    return String(readBigInt(this._state, key));
  }

  private _atomicLongSet(key: string, payload: { newValue: string; returnOld?: boolean }): string {
    const oldValue = readBigInt(this._state, key);
    this._state.set(key, payload.newValue);
    return payload.returnOld === true ? String(oldValue) : payload.newValue;
  }

  private _atomicLongAdd(key: string, payload: { delta: string; returnOld?: boolean; returnNew?: boolean }): string {
    const current = readBigInt(this._state, key);
    const delta = BigInt(payload.delta);
    const next = current + delta;
    this._state.set(key, String(next));
    if (payload.returnOld === true) return String(current);
    return String(next);
  }

  private _atomicLongCas(key: string, payload: { expect: string; update: string }): boolean {
    const current = readBigInt(this._state, key);
    const expect = BigInt(payload.expect);
    if (current !== expect) return false;
    this._state.set(key, payload.update);
    return true;
  }

  // ── AtomicReference implementations ──────────────────────────────────────

  private _atomicRefGet(key: string): string | null {
    const raw = this._state.get(key);
    return raw !== undefined ? (raw as string) : null;
  }

  private _atomicRefSet(key: string, payload: { value: string }): string | null {
    const prev = this._state.get(key);
    this._state.set(key, payload.value);
    return prev !== undefined ? (prev as string) : null;
  }

  private _atomicRefCas(key: string, payload: { expect: string; update: string }): boolean {
    const current = this._state.get(key);
    const currentStr = current !== undefined ? (current as string) : '__NULL__';
    if (currentStr !== payload.expect) return false;
    this._state.set(key, payload.update);
    return true;
  }

  // ── CPMap implementations ─────────────────────────────────────────────────

  private _cpmapPut(key: string, payload: { key: string; value: string }): string | null {
    const map = readCpMap(this._state, key);
    const prev = map.get(payload.key);
    map.set(payload.key, payload.value);
    this._state.set(key, map);
    return prev !== undefined ? prev : null;
  }

  private _cpmapSet(key: string, payload: { key: string; value: string }): undefined {
    const map = readCpMap(this._state, key);
    map.set(payload.key, payload.value);
    this._state.set(key, map);
    return undefined;
  }

  private _cpmapRemove(key: string, payload: { key: string }): string | null {
    const map = readCpMap(this._state, key);
    const prev = map.get(payload.key);
    map.delete(payload.key);
    this._state.set(key, map);
    return prev !== undefined ? prev : null;
  }

  private _cpmapDelete(key: string, payload: { key: string }): undefined {
    const map = readCpMap(this._state, key);
    map.delete(payload.key);
    this._state.set(key, map);
    return undefined;
  }

  private _cpmapPutIfAbsent(key: string, payload: { key: string; value: string }): string | null {
    const map = readCpMap(this._state, key);
    const existing = map.get(payload.key);
    if (existing !== undefined) {
      this._state.set(key, map);
      return existing;
    }
    map.set(payload.key, payload.value);
    this._state.set(key, map);
    return null;
  }

  private _cpmapCompareAndSet(key: string, payload: { key: string; expectedValue: string; newValue: string }): boolean {
    const map = readCpMap(this._state, key);
    const current = map.get(payload.key);
    const currentStr = current !== undefined ? current : CPMAP_NULL;
    if (currentStr !== payload.expectedValue) return false;
    map.set(payload.key, payload.newValue);
    this._state.set(key, map);
    return true;
  }

  // ── Semaphore implementations ─────────────────────────────────────────────

  private _semInit(key: string, payload: { permits: number }): boolean {
    const current = readSemaphore(this._state, key);
    const alreadyInitialized = current.available !== 0 || Object.keys(current.sessionPermits).length > 0;
    if (alreadyInitialized) return false;
    this._state.set(key, { available: payload.permits, sessionPermits: {}, invocationResults: {} });
    return true;
  }

  private _semAcquire(key: string, payload: { permits: number; sessionId?: string; invocationUuid?: string }): boolean {
    const state = readSemaphore(this._state, key);

    // Idempotency check
    if (payload.invocationUuid !== undefined && state.invocationResults[payload.invocationUuid] === true) {
      return true;
    }

    if (state.available < payload.permits) return false;

    state.available -= payload.permits;

    if (payload.sessionId !== undefined) {
      state.sessionPermits[payload.sessionId] = (state.sessionPermits[payload.sessionId] ?? 0) + payload.permits;
    }

    if (payload.invocationUuid !== undefined) {
      state.invocationResults[payload.invocationUuid] = true;
    }

    this._state.set(key, state);
    return true;
  }

  private _semRelease(key: string, payload: { permits: number; sessionId?: string; invocationUuid?: string }): undefined {
    const state = readSemaphore(this._state, key);

    // Idempotency check
    if (payload.invocationUuid !== undefined && state.invocationResults[payload.invocationUuid] === true) {
      return undefined;
    }

    if (payload.sessionId !== undefined) {
      const held = state.sessionPermits[payload.sessionId] ?? 0;
      const newHeld = held - payload.permits;
      if (newHeld <= 0) {
        delete state.sessionPermits[payload.sessionId];
      } else {
        state.sessionPermits[payload.sessionId] = newHeld;
      }
    }

    state.available += payload.permits;

    if (payload.invocationUuid !== undefined) {
      state.invocationResults[payload.invocationUuid] = true;
    }

    this._state.set(key, state);
    return undefined;
  }

  private _semDrain(key: string, payload: { sessionId?: string; invocationUuid?: string }): number {
    const state = readSemaphore(this._state, key);

    // Idempotency check
    if (payload.invocationUuid !== undefined) {
      const previous = state.invocationResults[payload.invocationUuid];
      if (typeof previous === 'number') return previous;
    }

    const drained = state.available;
    state.available = 0;

    if (payload.sessionId !== undefined && drained > 0) {
      state.sessionPermits[payload.sessionId] = (state.sessionPermits[payload.sessionId] ?? 0) + drained;
    }

    if (payload.invocationUuid !== undefined) {
      state.invocationResults[payload.invocationUuid] = drained;
    }

    this._state.set(key, state);
    return drained;
  }

  private _semChange(key: string, payload: { permits: number; invocationUuid?: string }): undefined {
    const state = readSemaphore(this._state, key);

    // Idempotency check
    if (payload.invocationUuid !== undefined && state.invocationResults[payload.invocationUuid] === true) {
      return undefined;
    }

    if (payload.permits >= 0) {
      state.available += payload.permits;
    } else {
      state.available = Math.max(0, state.available + payload.permits);
    }

    if (payload.invocationUuid !== undefined) {
      state.invocationResults[payload.invocationUuid] = true;
    }

    this._state.set(key, state);
    return undefined;
  }

  private _semSet(key: string, payload: SemaphoreState): undefined {
    this._state.set(key, {
      available: payload.available,
      sessionPermits: { ...payload.sessionPermits },
      invocationResults: { ...payload.invocationResults },
    });
    return undefined;
  }

  // ── CountDownLatch implementations ────────────────────────────────────────

  private _cdlTrySetCount(key: string, payload: { count: number }): boolean {
    const current = readCdl(this._state, key);
    if (current.count > 0) return false;
    this._state.set(key, {
      count: payload.count,
      round: current.round + (payload.count > 0 ? 1 : 0),
      invocationUuids: [],
    });
    return true;
  }

  private _cdlCountDown(key: string, payload: { expectedRound?: number; invocationUuid?: string }): number {
    const current = readCdl(this._state, key);

    // Already at zero, nothing to do
    if (current.count <= 0) return current.count;

    // Round mismatch: already in a new round
    if (payload.expectedRound !== undefined && current.round !== payload.expectedRound) {
      return current.count;
    }

    // Idempotency check
    if (payload.invocationUuid !== undefined && current.invocationUuids.includes(payload.invocationUuid)) {
      return current.count;
    }

    const nextCount = current.count - 1;
    const nextState: CountDownLatchState = {
      count: nextCount,
      round: current.round,
      invocationUuids: payload.invocationUuid !== undefined
        ? [...current.invocationUuids, payload.invocationUuid]
        : current.invocationUuids,
    };

    this._state.set(key, nextState);
    return nextCount;
  }

  private _cdlGetCount(key: string): number {
    return readCdl(this._state, key).count;
  }

  private _cdlSet(key: string, payload: CountDownLatchState): undefined {
    this._state.set(key, {
      count: payload.count,
      round: payload.round,
      invocationUuids: Array.isArray(payload.invocationUuids) ? [...payload.invocationUuids] : [],
    });
    return undefined;
  }

  // ── FencedLock implementations ────────────────────────────────────────────

  private _flockLock(key: string, payload: { sessionId: string; threadId: string }): { fence: string } | { wait: true } {
    const state = readFlock(this._state, key);

    // Reentrant: same session+thread already holds it
    if (
      state.owner !== null &&
      state.owner.sessionId === payload.sessionId &&
      state.owner.threadId === payload.threadId
    ) {
      state.lockCount++;
      this._state.set(key, state);
      return { fence: state.fence };
    }

    // Lock is free — acquire it
    if (state.owner === null) {
      const newFence = String(BigInt(state.fence) + 1n);
      state.fence = newFence;
      state.owner = { sessionId: payload.sessionId, threadId: payload.threadId };
      state.lockCount = 1;
      this._state.set(key, state);
      return { fence: newFence };
    }

    // Lock is held by someone else — waiter must be managed by the service layer
    return { wait: true };
  }

  private _flockTryLock(
    key: string,
    payload: { sessionId: string; threadId: string; timeoutMs: string },
  ): { fence: string } | { timeout: true } | { wait: true } {
    const state = readFlock(this._state, key);

    // Reentrant: same session+thread already holds it
    if (
      state.owner !== null &&
      state.owner.sessionId === payload.sessionId &&
      state.owner.threadId === payload.threadId
    ) {
      state.lockCount++;
      this._state.set(key, state);
      return { fence: state.fence };
    }

    // Lock is free — acquire it
    if (state.owner === null) {
      const newFence = String(BigInt(state.fence) + 1n);
      state.fence = newFence;
      state.owner = { sessionId: payload.sessionId, threadId: payload.threadId };
      state.lockCount = 1;
      this._state.set(key, state);
      return { fence: newFence };
    }

    // Non-blocking attempt (timeout === 0)
    const timeoutMs = BigInt(payload.timeoutMs);
    if (timeoutMs <= 0n) {
      return { timeout: true };
    }

    // Locked by someone else with a non-zero timeout: caller must wait
    return { wait: true };
  }

  private _flockUnlock(key: string, payload: { sessionId: string; threadId: string }): boolean {
    const state = readFlock(this._state, key);

    // Not held by the caller — no-op (or illegal state, handled upstream)
    if (
      state.owner === null ||
      state.owner.sessionId !== payload.sessionId ||
      state.owner.threadId !== payload.threadId
    ) {
      return false;
    }

    state.lockCount--;

    if (state.lockCount > 0) {
      // Still reentrant — update lockCount in state
      this._state.set(key, state);
      return true;
    }

    // Fully released: clear owner. Waiters are managed by the service layer.
    state.owner = null;
    this._state.set(key, state);
    return true;
  }

  // ── Session implementations ───────────────────────────────────────────────

  private _sessionCreate(payload: { memberId: string; ttlMs: number; createdAt?: number }): string {
    const sessionId = nextSessionId();
    // Use caller-supplied timestamp for determinism; fall back to 0 if not provided.
    // Callers should always include a createdAt from their monotone clock.
    const createdAt = payload.createdAt ?? 0;
    const session: SessionState = {
      sessionId,
      memberId: payload.memberId,
      createdAt,
      ttlMs: payload.ttlMs,
      lastHeartbeatAt: createdAt,
    };
    this._state.set(`session:${sessionId}`, session);
    return sessionId;
  }

  private _sessionHeartbeat(payload: { sessionId: string; timestamp?: number }): boolean {
    const key = `session:${payload.sessionId}`;
    const session = this._state.get(key) as SessionState | undefined;
    if (session === undefined) return false;
    // Callers should supply timestamp for determinism; fall back to stored time if missing.
    session.lastHeartbeatAt = payload.timestamp ?? session.lastHeartbeatAt;
    this._state.set(key, session);
    return true;
  }

  private _sessionClose(payload: { sessionId: string }): boolean {
    const key = `session:${payload.sessionId}`;
    const existed = this._state.has(key);
    if (existed) {
      this._state.delete(key);
      // Release semaphore permits held by this session
      this._releaseSessionSemaphorePermits(payload.sessionId);
      // Release fenced locks held by this session
      this._releaseSessionFlocks(payload.sessionId);
    }
    return existed;
  }

  // ── Session resource cleanup ──────────────────────────────────────────────

  private _releaseSessionSemaphorePermits(sessionId: string): void {
    for (const [k, v] of this._state) {
      if (!k.startsWith('sem:')) continue;
      const s = v as SemaphoreState;
      const held = s.sessionPermits[sessionId];
      if (held === undefined || held === 0) continue;
      delete s.sessionPermits[sessionId];
      s.available += held;
      this._state.set(k, s);
    }
  }

  private _releaseSessionFlocks(sessionId: string): void {
    for (const [k, v] of this._state) {
      if (!k.startsWith('flock:')) continue;
      const s = v as FencedLockState;
      if (s.owner === null || s.owner.sessionId !== sessionId) continue;
      // Force-release regardless of reentrant depth
      s.owner = null;
      s.lockCount = 0;
      this._state.set(k, s);
    }
  }
}
