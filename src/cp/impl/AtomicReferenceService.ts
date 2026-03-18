/**
 * Distributed Atomic Reference — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.IAtomicReference.
 *
 * All mutations are applied through Raft consensus via CpSubsystemService.
 * The CpStateMachine handles all state logic; this service only constructs
 * typed RaftCommand objects and delegates to executeRaftCommand().
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'atomicref:';
const SENTINEL_NULL = '__NULL__';

function stateKey(name: string): string {
  return KEY_PREFIX + name;
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return SENTINEL_NULL;
  return JSON.stringify(value);
}

function deserialize<T>(raw: unknown): T | null {
  if (raw === undefined || raw === null) return null;
  const str = raw as string;
  if (str === SENTINEL_NULL) return null;
  return JSON.parse(str) as T;
}

export class AtomicReferenceService {
  static readonly SERVICE_NAME = 'hz:impl:atomicReferenceService';

  constructor(private readonly _cp: CpSubsystemService) {}

  // ── Read ────────────────────────────────────────────────────────────────

  async get<T>(name: string): Promise<T | null> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_REF_GET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: null,
    });
    return deserialize<T>(result);
  }

  async isNull(name: string): Promise<boolean> {
    return (await this.get(name)) === null;
  }

  async contains<T>(name: string, value: T): Promise<boolean> {
    const current = await this.get<T>(name);
    return JSON.stringify(current) === JSON.stringify(value);
  }

  // ── Write ───────────────────────────────────────────────────────────────

  async set<T>(name: string, newValue: T | null): Promise<void> {
    await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_REF_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { value: serialize(newValue) },
    });
  }

  async getAndSet<T>(name: string, newValue: T | null): Promise<T | null> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_REF_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { value: serialize(newValue) },
    });
    // ATOMIC_REF_SET returns the previous value
    return deserialize<T>(result);
  }

  async clear(name: string): Promise<void> {
    await this.set(name, null);
  }

  async compareAndSet<T>(name: string, expect: T | null, update: T | null): Promise<boolean> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_REF_CAS',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { expect: serialize(expect), update: serialize(update) },
    });
    return result as boolean;
  }

  async alter<T>(name: string, fn: (value: T | null) => T | null): Promise<void> {
    const current = await this.get<T>(name);
    const newValue = fn(current);
    await this.set(name, newValue);
  }

  async alterAndGet<T>(name: string, fn: (value: T | null) => T | null): Promise<T | null> {
    const current = await this.get<T>(name);
    const newValue = fn(current);
    await this.set(name, newValue);
    return newValue;
  }

  async getAndAlter<T>(name: string, fn: (value: T | null) => T | null): Promise<T | null> {
    const current = await this.get<T>(name);
    const newValue = fn(current);
    await this.set(name, newValue);
    return current;
  }

  async apply<T, R>(name: string, fn: (value: T | null) => R): Promise<R> {
    const current = await this.get<T>(name);
    return fn(current);
  }

  destroy(name: string): void {
    void this.set(name, null);
  }
}
