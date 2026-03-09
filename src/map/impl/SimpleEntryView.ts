export class SimpleEntryView<K, V> {
    private _key: K;
    private _value: V;
    private _cost = -1;
    private _creationTime = 0;
    private _expirationTime = -1;
    private _hits = 0;
    private _lastAccessTime = 0;
    private _lastStoredTime = -1;
    private _lastUpdateTime = 0;
    private _version = 0;
    private _ttl = -1;
    private _maxIdle = -1;

    constructor(key: K, value: V) {
        this._key = key;
        this._value = value;
    }

    getKey(): K { return this._key; }
    setKey(key: K): this { this._key = key; return this; }
    getValue(): V { return this._value; }
    setValue(value: V): this { this._value = value; return this; }
    getCost(): number { return this._cost; }
    setCost(cost: number): this { this._cost = cost; return this; }
    getCreationTime(): number { return this._creationTime; }
    setCreationTime(creationTime: number): this { this._creationTime = creationTime; return this; }
    getExpirationTime(): number { return this._expirationTime; }
    setExpirationTime(expirationTime: number): this { this._expirationTime = expirationTime; return this; }
    getHits(): number { return this._hits; }
    setHits(hits: number): this { this._hits = hits; return this; }
    getLastAccessTime(): number { return this._lastAccessTime; }
    setLastAccessTime(lastAccessTime: number): this { this._lastAccessTime = lastAccessTime; return this; }
    getLastStoredTime(): number { return this._lastStoredTime; }
    setLastStoredTime(lastStoredTime: number): this { this._lastStoredTime = lastStoredTime; return this; }
    getLastUpdateTime(): number { return this._lastUpdateTime; }
    setLastUpdateTime(lastUpdateTime: number): this { this._lastUpdateTime = lastUpdateTime; return this; }
    getVersion(): number { return this._version; }
    setVersion(version: number): this { this._version = version; return this; }
    getTtl(): number { return this._ttl; }
    setTtl(ttl: number): this { this._ttl = ttl; return this; }
    getMaxIdle(): number { return this._maxIdle; }
    setMaxIdle(maxIdle: number): this { this._maxIdle = maxIdle; return this; }
}
