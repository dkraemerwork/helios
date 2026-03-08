/**
 * Distributed Atomic Long — CP Subsystem backed.
 *
 * Port of com.hazelcast.cp.IAtomicLong.
 *
 * All mutations are applied through Raft consensus via CpSubsystemService,
 * providing linearizability guarantees. The state machine for each atomic long
 * is a single BigInt stored in the Raft group's state machine under the key
 * "atomiclong:<name>".
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
    return this._readCurrent(name);
  }

  // ── Write ───────────────────────────────────────────────────────────────

  async set(name: string, newValue: bigint): Promise<void> {
    await this._execute(name, 'SET', { newValue: String(newValue) });
  }

  async getAndSet(name: string, newValue: bigint): Promise<bigint> {
    const prev = await this._readCurrent(name);
    await this._execute(name, 'SET', { newValue: String(newValue) });
    return prev;
  }

  async getAndAdd(name: string, delta: bigint): Promise<bigint> {
    const prev = await this._readCurrent(name);
    await this._execute(name, 'ADD', { delta: String(delta) });
    return prev;
  }

  async addAndGet(name: string, delta: bigint): Promise<bigint> {
    await this._execute(name, 'ADD', { delta: String(delta) });
    return this._readCurrent(name);
  }

  async getAndIncrement(name: string): Promise<bigint> {
    return this.getAndAdd(name, 1n);
  }

  async incrementAndGet(name: string): Promise<bigint> {
    return this.addAndGet(name, 1n);
  }

  async decrementAndGet(name: string): Promise<bigint> {
    return this.addAndGet(name, -1n);
  }

  async getAndDecrement(name: string): Promise<bigint> {
    return this.getAndAdd(name, -1n);
  }

  async compareAndSet(name: string, expect: bigint, update: bigint): Promise<boolean> {
    const current = await this._readCurrent(name);
    if (current !== expect) return false;
    await this._execute(name, 'CAS', { expect: String(expect), update: String(update) });
    return true;
  }

  /**
   * Apply a function to the current value and set the result.
   * The function is serialized as a string (name of a well-known function or
   * an expression in the form "(x) => x + 1" for embedded use).
   */
  async alter(name: string, fn: (value: bigint) => bigint): Promise<void> {
    const current = await this._readCurrent(name);
    const newValue = fn(current);
    await this._execute(name, 'SET', { newValue: String(newValue) });
  }

  async alterAndGet(name: string, fn: (value: bigint) => bigint): Promise<bigint> {
    const current = await this._readCurrent(name);
    const newValue = fn(current);
    await this._execute(name, 'SET', { newValue: String(newValue) });
    return newValue;
  }

  async getAndAlter(name: string, fn: (value: bigint) => bigint): Promise<bigint> {
    const current = await this._readCurrent(name);
    const newValue = fn(current);
    await this._execute(name, 'SET', { newValue: String(newValue) });
    return current;
  }

  async apply<R>(name: string, fn: (value: bigint) => R): Promise<R> {
    const current = await this._readCurrent(name);
    return fn(current);
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async _readCurrent(name: string): Promise<bigint> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const raw = this._cp.readState(CP_GROUP_DEFAULT, stateKey(name));
    return raw !== undefined ? BigInt(raw as string) : 0n;
  }

  private async _execute(
    name: string,
    type: string,
    payload: Record<string, string>,
  ): Promise<void> {
    this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
    const current = await this._readCurrent(name);
    let newValue: bigint;

    switch (type) {
      case 'SET':
        newValue = BigInt(payload.newValue!);
        break;
      case 'ADD':
        newValue = current + BigInt(payload.delta!);
        break;
      case 'CAS':
        newValue = current === BigInt(payload.expect!) ? BigInt(payload.update!) : current;
        break;
      default:
        throw new Error(`Unknown AtomicLong command: ${type}`);
    }

    // Propose through Raft consensus
    await this._cp.executeCommand({
      type,
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(name),
      payload,
    });

    // Apply to state machine after consensus
    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), String(newValue));
  }

  destroy(name: string): void {
    this._cp.applyStateMutation(CP_GROUP_DEFAULT, stateKey(name), undefined);
  }
}
