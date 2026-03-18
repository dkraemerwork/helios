/**
 * CPMap server-side state machine.
 *
 * Port of the server-side CPMap state machine from Hazelcast.
 *
 * All mutations go through Raft consensus via executeRaftCommand(). The
 * CpStateMachine handles all state logic, including per-map key tracking.
 * Reads are served directly from the linearizable state machine snapshot.
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'cpmap:';
const SENTINEL_NULL = '__CPMAP_NULL__';

function stateKey(mapName: string): string {
  return KEY_PREFIX + mapName;
}

function serializeEntry(value: unknown): string {
  if (value === null || value === undefined) return SENTINEL_NULL;
  return JSON.stringify(value);
}

function deserializeEntry<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined || raw === SENTINEL_NULL) return null;
  return JSON.parse(raw) as T;
}

export class CPMapService {
  static readonly SERVICE_NAME = 'hz:raft:cpMapService';

  constructor(private readonly _cp: CpSubsystemService) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async put<K, V>(mapName: string, key: K, value: V): Promise<V | null> {
    const result = await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_PUT',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: { key: serializeEntry(key), value: serializeEntry(value) },
    });
    return deserializeEntry<V>(result as string | null);
  }

  async set<K, V>(mapName: string, key: K, value: V): Promise<void> {
    await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: { key: serializeEntry(key), value: serializeEntry(value) },
    });
  }

  async get<K, V>(mapName: string, key: K): Promise<V | null> {
    const mapState = this._cp.linearizableRead(CP_GROUP_DEFAULT, stateKey(mapName));
    if (mapState === undefined || mapState === null) return null;
    const map = mapState as Map<string, string>;
    const raw = map.get(serializeEntry(key));
    return raw !== undefined ? deserializeEntry<V>(raw) : null;
  }

  async remove<K, V>(mapName: string, key: K): Promise<V | null> {
    const result = await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_REMOVE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: { key: serializeEntry(key) },
    });
    return deserializeEntry<V>(result as string | null);
  }

  async delete<K>(mapName: string, key: K): Promise<void> {
    await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_DELETE',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: { key: serializeEntry(key) },
    });
  }

  async putIfAbsent<K, V>(mapName: string, key: K, value: V): Promise<V | null> {
    const result = await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_PUT_IF_ABSENT',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: { key: serializeEntry(key), value: serializeEntry(value) },
    });
    return deserializeEntry<V>(result as string | null);
  }

  async compareAndSet<K, V>(mapName: string, key: K, expectedValue: V, newValue: V): Promise<boolean> {
    const result = await this._cp.executeRaftCommand(mapName, {
      type: 'CPMAP_COMPARE_AND_SET',
      groupId: CP_GROUP_DEFAULT,
      key: stateKey(mapName),
      payload: {
        key: serializeEntry(key),
        expectedValue: serializeEntry(expectedValue),
        newValue: serializeEntry(newValue),
      },
    });
    return result as boolean;
  }

  destroy(_mapName: string): void {
    // Maps are managed by the state machine; no local cleanup needed.
  }
}
