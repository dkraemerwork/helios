/**
 * EntryView implementation for ReplicatedMap entries.
 * Java source: com.hazelcast.replicatedmap.impl.record.ReplicatedMapEntryView
 */
export class ReplicatedMapEntryView<K, V> {
  private static readonly NOT_AVAILABLE = -1;

  private _key: K | null = null;
  private _value: V | null = null;
  private _creationTime: number = 0;
  private _hits: number = 0;
  private _lastAccessTime: number = 0;
  private _lastUpdateTime: number = 0;
  private _ttl: number = 0;
  private _maxIdle: number = 0;

  getKey(): K {
    return this._key as K;
  }

  setKey(key: K): this {
    this._key = key;
    return this;
  }

  getValue(): V {
    return this._value as V;
  }

  setValue(value: V): this {
    this._value = value;
    return this;
  }

  getCost(): number {
    return ReplicatedMapEntryView.NOT_AVAILABLE;
  }

  getCreationTime(): number {
    return this._creationTime;
  }

  setCreationTime(creationTime: number): this {
    this._creationTime = creationTime;
    return this;
  }

  getExpirationTime(): number {
    return ReplicatedMapEntryView.NOT_AVAILABLE;
  }

  getHits(): number {
    return this._hits;
  }

  setHits(hits: number): this {
    this._hits = hits;
    return this;
  }

  getLastAccessTime(): number {
    return this._lastAccessTime;
  }

  setLastAccessTime(lastAccessTime: number): this {
    this._lastAccessTime = lastAccessTime;
    return this;
  }

  getLastStoredTime(): number {
    return ReplicatedMapEntryView.NOT_AVAILABLE;
  }

  getLastUpdateTime(): number {
    return this._lastUpdateTime;
  }

  setLastUpdateTime(lastUpdateTime: number): this {
    this._lastUpdateTime = lastUpdateTime;
    return this;
  }

  getVersion(): number {
    return ReplicatedMapEntryView.NOT_AVAILABLE;
  }

  getTtl(): number {
    return this._ttl;
  }

  setTtl(ttl: number): this {
    this._ttl = ttl;
    return this;
  }

  getMaxIdle(): number {
    return this._maxIdle;
  }

  setMaxIdle(maxIdle: number): this {
    this._maxIdle = maxIdle;
    return this;
  }

  toString(): string {
    return `ReplicatedMapEntryView{key=${this._key}, value=${this._value}, creationTime=${this._creationTime}, hits=${this._hits}, lastAccessTime=${this._lastAccessTime}, lastUpdateTime=${this._lastUpdateTime}, ttl=${this._ttl}, maxIdle=${this._maxIdle}}`;
  }
}
