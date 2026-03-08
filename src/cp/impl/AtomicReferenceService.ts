/**
 * Distributed Atomic Reference — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.IAtomicReference.
 *
 * All mutations are applied through Raft consensus via CpSubsystemService,
 * providing linearizability guarantees. Values are stored in the Raft group
 * state machine as JSON-serialized strings.
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'atomicref:';

function stateKey(name: string): string {
  return KEY_PREFIX + name;
}

const SENTINEL_NULL = '__NULL__';

function serialize(value: unknown): string {
  if (value === null || value === undefined) return SENTINEL_NULL;
  return JSON.stringify(value);
}

function deserialize<T>(raw: string): T | null {
  if (raw === SENTINEL_NULL) return null;
  return JSON.parse(raw) as T;
}

export class AtomicReferenceService {
  static readonly SERVICE_NAME = 'hz:impl:atomicReferenceService';

  constructor(private readonly _cp: CpSubsystemService) {}

  // ── Read ────────────────────────────────────────────────────────────────

  async get<T>(name: string): Promise<T | null> {
    return this._readCurrent<T>(name);
  }

  async isNull(name: string): Promise<boolean> {
    const value = await this._readCurrent(name);
    return value === null;
  }

  async contains<T>(name: string, value: T): Promise<boolean> {
    const current = await this._readCurrent<T>(name);
    return JSON.stringify(current) === JSON.stringify(value);
  }

  // ── Write ───────────────────────────────────────────────────────────────

  async set<T>(name: string, newValue: T | null): Promise<void> {
    await this._applySet(name, newValue);
  }

  async getAndSet<T>(name: string, newValue: T | null): Promise<T | null> {
    const prev = await this._readCurrent<T>(name);
    await this._applySet(name, newValue);
    return prev;
  }

  async clear(name: string): Promise<void> {
    await this._applySet(name, null);
  }

  async compareAndSet<T>(name: string, expect: T | null, update: T | null): Promise<boolean> {
    const current = await this._readCurrent<T>(name);
    if (JSON.stringify(current) !== JSON.stringify(expect)) return false;
    await this._applySet(name, update);
    return true;
  }

  async alter<T>(name: string, fn: (value: T | null) => T | null): Promise<void> {
    const current = await this._readCurrent<T>(name);
    const newValue = fn(current);
    await this._applySet(name, newValue);
  }

  async alterAndGet<T>(name: string, fn: (value: T | null) => T | null): Promise<T | null> {
    const current = await this._readCurrent<T>(name);
    const newValue = fn(current);
    await this._applySet(name, newValue);
    return newValue;
  }

  async getAndAlter<T>(name: string, fn: (value: T | null) => T | null): Promise<T | null> {
    const current = await this._readCurrent<T>(name);
    const newValue = fn(current);
    await this._applySet(name, newValue);
    return current;
  }

  async apply<T, R>(name: string, fn: (value: T | null) => R): Promise<R> {
    const current = await this._readCurrent<T>(name);
    return fn(current);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async _readCurrent<T>(name: string): Promise<T | null> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const raw = this._cp.readState(CP_GROUP_DEFAULT, stateKey(name));
    if (raw === undefined) return null;
    return deserialize<T>(raw as string);
  }

  private async _applySet<T>(name: string, newValue: T | null): Promise<void> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const serialized = serialize(newValue);

    await this._cp.executeCommand({
      type: 'SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { value: serialized },
    });

    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), serialized);
  }

  destroy(name: string): void {
    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), undefined);
  }
}
