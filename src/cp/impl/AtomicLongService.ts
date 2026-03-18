/**
 * Distributed Atomic Long — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.IAtomicLong.
 *
 * All mutations are applied through Raft consensus via CpSubsystemService.
 * The CpStateMachine handles all arithmetic; this service only constructs
 * typed RaftCommand objects and delegates to executeRaftCommand().
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'atomiclong:';

function stateKey(name: string): string {
  return KEY_PREFIX + name;
}

export class AtomicLongService {
  static readonly SERVICE_NAME = 'hz:impl:atomicLongService';

  constructor(private readonly _cp: CpSubsystemService) {}

  // ── Read ────────────────────────────────────────────────────────────────

  async get(name: string): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_GET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: null,
    });
    return result !== undefined && result !== null ? BigInt(result as string) : 0n;
  }

  // ── Write ───────────────────────────────────────────────────────────────

  async set(name: string, newValue: bigint): Promise<void> {
    await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { newValue: String(newValue) },
    });
  }

  async getAndSet(name: string, newValue: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { newValue: String(newValue), returnOld: true },
    });
    return result !== undefined && result !== null ? BigInt(result as string) : 0n;
  }

  async addAndGet(name: string, delta: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_ADD',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { delta: String(delta), returnNew: true },
    });
    return BigInt(result as string);
  }

  async getAndAdd(name: string, delta: bigint): Promise<bigint> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_ADD',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { delta: String(delta), returnOld: true },
    });
    return BigInt(result as string);
  }

  async compareAndSet(name: string, expect: bigint, update: bigint): Promise<boolean> {
    const result = await this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_CAS',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: { expect: String(expect), update: String(update) },
    });
    return result as boolean;
  }

  async incrementAndGet(name: string): Promise<bigint> {
    return this.addAndGet(name, 1n);
  }

  async getAndIncrement(name: string): Promise<bigint> {
    return this.getAndAdd(name, 1n);
  }

  async decrementAndGet(name: string): Promise<bigint> {
    return this.addAndGet(name, -1n);
  }

  async getAndDecrement(name: string): Promise<bigint> {
    return this.getAndAdd(name, -1n);
  }

  async alter(name: string, fn: (value: bigint) => bigint): Promise<void> {
    while (true) {
      const current = await this.get(name);
      const newValue = fn(current);
      const success = await this.compareAndSet(name, current, newValue);
      if (success) return;
      // CAS failed — another writer committed first; retry with a fresh read.
    }
  }

  async alterAndGet(name: string, fn: (value: bigint) => bigint): Promise<bigint> {
    while (true) {
      const current = await this.get(name);
      const newValue = fn(current);
      const success = await this.compareAndSet(name, current, newValue);
      if (success) return newValue;
      // CAS failed — another writer committed first; retry with a fresh read.
    }
  }

  async getAndAlter(name: string, fn: (value: bigint) => bigint): Promise<bigint> {
    while (true) {
      const current = await this.get(name);
      const newValue = fn(current);
      const success = await this.compareAndSet(name, current, newValue);
      if (success) return current;
      // CAS failed — another writer committed first; retry with a fresh read.
    }
  }

  async apply<R>(name: string, fn: (value: bigint) => R): Promise<R> {
    // apply() is read-only — reads the current value and maps it; no mutation, no CAS needed.
    const current = await this.get(name);
    return fn(current);
  }

  destroy(name: string): void {
    void this._cp.executeRaftCommand(name, {
      type: 'ATOMIC_LONG_DESTROY',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload: null,
    });
  }
}
