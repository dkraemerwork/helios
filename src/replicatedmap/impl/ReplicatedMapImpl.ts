import type { ReplicatedMap } from '@zenystx/helios-core/replicatedmap/ReplicatedMap';

/**
 * In-memory ReplicatedMap implementation for single-node use.
 * Port of com.hazelcast.replicatedmap.impl.record.AbstractReplicatedRecordStore
 * (single-node, no replication).
 */
export class ReplicatedMapImpl<K, V> implements ReplicatedMap<K, V> {
    private readonly _name: string;
    private readonly _storage = new Map<K, V>();

    constructor(name: string) {
        this._name = name;
    }

    getName(): string {
        return this._name;
    }

    put(key: K, value: V): V | null {
        const old = this._storage.get(key) ?? null;
        this._storage.set(key, value);
        return old;
    }

    get(key: K): V | null {
        return this._storage.get(key) ?? null;
    }

    remove(key: K): V | null {
        const old = this._storage.get(key) ?? null;
        this._storage.delete(key);
        return old;
    }

    containsKey(key: K): boolean {
        return this._storage.has(key);
    }

    containsValue(value: V): boolean {
        for (const v of this._storage.values()) {
            if (v === value) return true;
        }
        return false;
    }

    size(): number {
        return this._storage.size;
    }

    isEmpty(): boolean {
        return this._storage.size === 0;
    }

    clear(): void {
        this._storage.clear();
    }

    keySet(): K[] {
        return [...this._storage.keys()];
    }

    values(): V[] {
        return [...this._storage.values()];
    }

    entrySet(): [K, V][] {
        return [...this._storage.entries()];
    }

    destroy(): void {
        this._storage.clear();
    }
}
