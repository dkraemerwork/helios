import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { EvictionConfig } from '@helios/config/EvictionConfig';
import { NearCachePreloaderConfig } from '@helios/config/NearCachePreloaderConfig';

export enum LocalUpdatePolicy {
    INVALIDATE = 'INVALIDATE',
    CACHE_ON_UPDATE = 'CACHE_ON_UPDATE',
}

export class NearCacheConfig {
    static readonly DEFAULT_MEMORY_FORMAT = InMemoryFormat.BINARY;
    static readonly DEFAULT_SERIALIZE_KEYS = false;
    static readonly DEFAULT_INVALIDATE_ON_CHANGE = true;
    static readonly DEFAULT_LOCAL_UPDATE_POLICY = LocalUpdatePolicy.INVALIDATE;
    static readonly DEFAULT_TTL_SECONDS = 0;
    static readonly DEFAULT_MAX_IDLE_SECONDS = 0;
    static readonly DEFAULT_NAME = 'default';

    private _name: string = NearCacheConfig.DEFAULT_NAME;
    private _inMemoryFormat: InMemoryFormat = NearCacheConfig.DEFAULT_MEMORY_FORMAT;
    private _serializeKeys: boolean = NearCacheConfig.DEFAULT_SERIALIZE_KEYS;
    private _invalidateOnChange: boolean = NearCacheConfig.DEFAULT_INVALIDATE_ON_CHANGE;
    private _timeToLiveSeconds: number = NearCacheConfig.DEFAULT_TTL_SECONDS;
    private _maxIdleSeconds: number = NearCacheConfig.DEFAULT_MAX_IDLE_SECONDS;
    private _cacheLocalEntries: boolean = false;
    private _localUpdatePolicy: LocalUpdatePolicy = NearCacheConfig.DEFAULT_LOCAL_UPDATE_POLICY;
    private _evictionConfig: EvictionConfig = new EvictionConfig();
    private _preloaderConfig: NearCachePreloaderConfig = new NearCachePreloaderConfig();

    constructor(name?: string | null) {
        if (name !== undefined) {
            if (name === null) {
                throw new Error('name cannot be null');
            }
            this._name = name;
        }
    }

    getName(): string {
        return this._name;
    }

    setName(name: string): this {
        if (name === null || name === undefined) {
            throw new Error('name cannot be null');
        }
        this._name = name;
        return this;
    }

    getInMemoryFormat(): InMemoryFormat {
        return this._inMemoryFormat;
    }

    setInMemoryFormat(inMemoryFormat: InMemoryFormat): this {
        this._inMemoryFormat = inMemoryFormat;
        return this;
    }

    setInMemoryFormatFromString(inMemoryFormatStr: string): this {
        if (inMemoryFormatStr === null || inMemoryFormatStr === undefined) {
            throw new Error('inMemoryFormat cannot be null');
        }
        const fmt = InMemoryFormat[inMemoryFormatStr as keyof typeof InMemoryFormat];
        if (fmt === undefined) {
            throw new Error(`Unknown InMemoryFormat: ${inMemoryFormatStr}`);
        }
        this._inMemoryFormat = fmt;
        return this;
    }

    isSerializeKeys(): boolean {
        // NATIVE format always serializes keys
        if (this._inMemoryFormat === InMemoryFormat.NATIVE) {
            return true;
        }
        return this._serializeKeys;
    }

    setSerializeKeys(serializeKeys: boolean): this {
        this._serializeKeys = serializeKeys;
        return this;
    }

    isInvalidateOnChange(): boolean {
        return this._invalidateOnChange;
    }

    setInvalidateOnChange(invalidateOnChange: boolean): this {
        this._invalidateOnChange = invalidateOnChange;
        return this;
    }

    getTimeToLiveSeconds(): number {
        return this._timeToLiveSeconds;
    }

    setTimeToLiveSeconds(timeToLiveSeconds: number): this {
        this._timeToLiveSeconds = timeToLiveSeconds;
        return this;
    }

    getMaxIdleSeconds(): number {
        return this._maxIdleSeconds;
    }

    setMaxIdleSeconds(maxIdleSeconds: number): this {
        this._maxIdleSeconds = maxIdleSeconds;
        return this;
    }

    isCacheLocalEntries(): boolean {
        return this._cacheLocalEntries;
    }

    setCacheLocalEntries(cacheLocalEntries: boolean): this {
        this._cacheLocalEntries = cacheLocalEntries;
        return this;
    }

    getLocalUpdatePolicy(): LocalUpdatePolicy {
        return this._localUpdatePolicy;
    }

    setLocalUpdatePolicy(localUpdatePolicy: LocalUpdatePolicy): this {
        this._localUpdatePolicy = localUpdatePolicy;
        return this;
    }

    getEvictionConfig(): EvictionConfig {
        return this._evictionConfig;
    }

    setEvictionConfig(evictionConfig: EvictionConfig): this {
        if (evictionConfig === null || evictionConfig === undefined) {
            throw new Error('evictionConfig cannot be null');
        }
        this._evictionConfig = evictionConfig;
        return this;
    }

    getPreloaderConfig(): NearCachePreloaderConfig {
        return this._preloaderConfig;
    }

    setPreloaderConfig(preloaderConfig: NearCachePreloaderConfig): this {
        if (preloaderConfig === null || preloaderConfig === undefined) {
            throw new Error('preloaderConfig cannot be null');
        }
        this._preloaderConfig = preloaderConfig;
        return this;
    }
}
