/**
 * A ReplicatedRecord is the actual data holding entity. It also collects statistic metadata.
 * Java source: com.hazelcast.replicatedmap.impl.record.ReplicatedRecord
 */
export class ReplicatedRecord<K, V> {
  private _key: K;
  private _value: V;
  private _ttlMillis: number;
  private _hits: number = 0;
  private _lastAccessTime: number = Date.now();
  private _updateTime: number = Date.now();
  private _creationTime: number = Date.now();

  constructor(key: K, value: V, ttlMillis: number) {
    this._key = key;
    this._value = value;
    this._ttlMillis = ttlMillis;
  }

  getKey(): K {
    this._access();
    return this._key;
  }

  getKeyInternal(): K {
    return this._key;
  }

  getValue(): V {
    this._access();
    return this._value;
  }

  getValueInternal(): V {
    return this._value;
  }

  getTtlMillis(): number {
    return this._ttlMillis;
  }

  setValue(value: V, ttlMillis: number): V {
    this._access();
    return this.setValueInternal(value, ttlMillis);
  }

  setValueInternal(value: V, ttlMillis: number): V {
    const oldValue = this._value;
    this._value = value;
    this._updateTime = Date.now();
    this._ttlMillis = ttlMillis;
    return oldValue;
  }

  getUpdateTime(): number {
    return this._updateTime;
  }

  setUpdateTime(updateTime: number): void {
    this._updateTime = updateTime;
  }

  getHits(): number {
    return this._hits;
  }

  setHits(hits: number): void {
    this._hits = hits;
  }

  getLastAccessTime(): number {
    return this._lastAccessTime;
  }

  setLastAccessTime(lastAccessTime: number): void {
    this._lastAccessTime = lastAccessTime;
  }

  getCreationTime(): number {
    return this._creationTime;
  }

  setCreationTime(creationTime: number): void {
    this._creationTime = creationTime;
  }

  private _access(): void {
    this._hits++;
    this._lastAccessTime = Date.now();
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof ReplicatedRecord)) return false;
    const that = o as ReplicatedRecord<unknown, unknown>;
    if (this._ttlMillis !== that._ttlMillis) return false;
    if (this._key !== that._key) return false;
    return this._value === that._value;
  }

  hashCode(): number {
    const keyHash = typeof this._key === 'string'
      ? hashString(this._key)
      : (this._key != null ? (this._key as any).hashCode?.() ?? 0 : 0);
    const valHash = typeof this._value === 'string'
      ? hashString(this._value as string)
      : (this._value != null ? (this._value as any).hashCode?.() ?? 0 : 0);
    // Java: (int)(ttlMillis ^ (ttlMillis >>> 32)) — XOR lower+upper 32 bits of a long
    // JS: >>> 32 is a no-op (32 mod 32 = 0), so use BigInt for correctness
    const ttlBig = BigInt(this._ttlMillis);
    const ttlHash = Number((ttlBig ^ (ttlBig >> 32n)) & 0xFFFFFFFFn) | 0;
    let result = keyHash;
    result = (31 * result + valHash) | 0;
    result = (31 * result + ttlHash) | 0;
    return result;
  }

  toString(): string {
    return `ReplicatedRecord{key=${this._key}, value=${this._value}, ttlMillis=${this._ttlMillis}, hits=${this._hits}, creationTime=${this._creationTime}, lastAccessTime=${this._lastAccessTime}, updateTime=${this._updateTime}}`;
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
