import { ReplicatedRecord } from './ReplicatedRecord';

/**
 * Encapsulates the actual storage system for ReplicatedMap.
 * Java source: com.hazelcast.replicatedmap.impl.record.InternalReplicatedMapStorage
 */
export class InternalReplicatedMapStorage<K, V> {
  private readonly _storage = new Map<K, ReplicatedRecord<K, V>>();
  private _version: number = 0;
  private _stale: boolean = false;

  getVersion(): number {
    return this._version;
  }

  syncVersion(version: number): void {
    this._stale = false;
    this._version = version;
  }

  setVersion(version: number): void {
    if (!this._stale) {
      this._stale = version !== (this._version + 1);
    }
    this._version = version;
  }

  incrementVersion(): number {
    return this._version++;
  }

  get(key: K): ReplicatedRecord<K, V> | undefined {
    return this._storage.get(key);
  }

  put(key: K, record: ReplicatedRecord<K, V>): ReplicatedRecord<K, V> | undefined {
    const old = this._storage.get(key);
    this._storage.set(key, record);
    return old;
  }

  remove(key: K, record: ReplicatedRecord<K, V>): boolean {
    const existing = this._storage.get(key);
    if (existing === record) {
      this._storage.delete(key);
      return true;
    }
    return false;
  }

  containsKey(key: K): boolean {
    return this._storage.has(key);
  }

  entrySet(): IterableIterator<[K, ReplicatedRecord<K, V>]> {
    return this._storage.entries();
  }

  values(): IterableIterator<ReplicatedRecord<K, V>> {
    return this._storage.values();
  }

  keySet(): IterableIterator<K> {
    return this._storage.keys();
  }

  clear(): void {
    this._storage.clear();
  }

  isEmpty(): boolean {
    return this._storage.size === 0;
  }

  size(): number {
    return this._storage.size;
  }

  isStale(version: number): boolean {
    return this._stale || version > this._version;
  }
}
