/**
 * CPMap server-side state machine.
 *
 * Port of the server-side CPMap state machine from Hazelcast.
 *
 * Stores key-value pairs per named CPMap instance. All mutations go through
 * CpSubsystemService for linearizability. Keys are serialized as JSON strings
 * (using the serialization service) and stored per-map in simple Maps.
 *
 * Linearizability guarantee: state is only mutated AFTER the Raft proposal
 * succeeds. If the proposal fails, the in-memory state remains unchanged.
 */

import { CpSubsystemService } from './CpSubsystemService.js';

const CP_GROUP_DEFAULT = 'default';
const KEY_PREFIX = 'cpmap:';

function stateKey(mapName: string): string {
    return KEY_PREFIX + mapName;
}

const SENTINEL_NULL = '__CPMAP_NULL__';

function serializeEntry(value: unknown): string {
    if (value === null || value === undefined) return SENTINEL_NULL;
    return JSON.stringify(value);
}

function deserializeEntry<T>(raw: string): T | null {
    if (raw === SENTINEL_NULL) return null;
    return JSON.parse(raw) as T;
}

export class CPMapService {
    static readonly SERVICE_NAME = 'hz:raft:cpMapService';

    /** Per-map key-value stores. Key is the serialized key, value is the serialized entry. */
    private readonly _maps = new Map<string, Map<string, string>>();

    constructor(private readonly _cp: CpSubsystemService) {}

    // ── Internal helpers ────────────────────────────────────────────────────

    private _getOrCreateMap(mapName: string): Map<string, string> {
        let map = this._maps.get(mapName);
        if (!map) {
            map = new Map();
            this._maps.set(mapName, map);
        }
        return map;
    }

    private async _execute(mapName: string, type: string, payload: Record<string, string>): Promise<void> {
        this._cp.getOrCreateGroup(CP_GROUP_DEFAULT);
        await this._cp.executeCommand({
            type,
            groupId: CP_GROUP_DEFAULT,
            key: stateKey(mapName),
            payload,
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────

    async put<K, V>(mapName: string, key: K, value: V): Promise<V | null> {
        const keyStr = serializeEntry(key);
        const valueStr = serializeEntry(value);
        await this._execute(mapName, 'CPMAP_PUT', { key: keyStr, value: valueStr });
        const map = this._getOrCreateMap(mapName);
        const prev = map.get(keyStr);
        map.set(keyStr, valueStr);
        return prev !== undefined ? deserializeEntry<V>(prev) : null;
    }

    async set<K, V>(mapName: string, key: K, value: V): Promise<void> {
        const keyStr = serializeEntry(key);
        const valueStr = serializeEntry(value);
        await this._execute(mapName, 'CPMAP_SET', { key: keyStr, value: valueStr });
        const map = this._getOrCreateMap(mapName);
        map.set(keyStr, valueStr);
    }

    async get<K, V>(mapName: string, key: K): Promise<V | null> {
        const keyStr = serializeEntry(key);
        const map = this._getOrCreateMap(mapName);
        const raw = map.get(keyStr);
        return raw !== undefined ? deserializeEntry<V>(raw) : null;
    }

    async remove<K, V>(mapName: string, key: K): Promise<V | null> {
        const keyStr = serializeEntry(key);
        await this._execute(mapName, 'CPMAP_REMOVE', { key: keyStr });
        const map = this._getOrCreateMap(mapName);
        const prev = map.get(keyStr);
        map.delete(keyStr);
        return prev !== undefined ? deserializeEntry<V>(prev) : null;
    }

    async delete<K>(mapName: string, key: K): Promise<void> {
        const keyStr = serializeEntry(key);
        await this._execute(mapName, 'CPMAP_DELETE', { key: keyStr });
        const map = this._getOrCreateMap(mapName);
        map.delete(keyStr);
    }

    async putIfAbsent<K, V>(mapName: string, key: K, value: V): Promise<V | null> {
        const keyStr = serializeEntry(key);
        const valueStr = serializeEntry(value);
        const map = this._getOrCreateMap(mapName);
        const existing = map.get(keyStr);
        if (existing !== undefined) {
            return deserializeEntry<V>(existing);
        }
        await this._execute(mapName, 'CPMAP_PUT_IF_ABSENT', { key: keyStr, value: valueStr });
        map.set(keyStr, valueStr);
        return null;
    }

    async compareAndSet<K, V>(mapName: string, key: K, expectedValue: V, newValue: V): Promise<boolean> {
        const keyStr = serializeEntry(key);
        const expectedStr = serializeEntry(expectedValue);
        const newStr = serializeEntry(newValue);
        const map = this._getOrCreateMap(mapName);
        const current = map.get(keyStr);
        const currentStr = current !== undefined ? current : SENTINEL_NULL;
        if (currentStr !== expectedStr) {
            return false;
        }
        await this._execute(mapName, 'CPMAP_COMPARE_AND_SET', { key: keyStr, expectedValue: expectedStr, newValue: newStr });
        map.set(keyStr, newStr);
        return true;
    }

    destroy(mapName: string): void {
        this._maps.delete(mapName);
    }
}
