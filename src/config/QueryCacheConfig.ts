/**
 * Port of {@code com.hazelcast.config.QueryCacheConfig}.
 */
import type { Predicate } from '@zenystx/helios-core/query/Predicate';

export class QueryCacheConfig {
    static readonly DEFAULT_BATCH_SIZE = 1;
    static readonly DEFAULT_BUFFER_SIZE = 16;
    static readonly DEFAULT_DELAY_SECONDS = 0;
    static readonly DEFAULT_IN_MEMORY_FORMAT = 'BINARY';
    static readonly DEFAULT_POPULATE = true;
    static readonly DEFAULT_COALESCE = false;
    static readonly DEFAULT_SERIALIZE_KEYS = false;
    static readonly DEFAULT_INCLUDE_VALUE = true;
    static readonly DEFAULT_EVICTION_MAX_SIZE = 10000;

    private _name = '';
    private _predicate: Predicate | null = null;
    private _batchSize: number = QueryCacheConfig.DEFAULT_BATCH_SIZE;
    private _bufferSize: number = QueryCacheConfig.DEFAULT_BUFFER_SIZE;
    private _delaySeconds: number = QueryCacheConfig.DEFAULT_DELAY_SECONDS;
    private _inMemoryFormat: string = QueryCacheConfig.DEFAULT_IN_MEMORY_FORMAT;
    private _populate: boolean = QueryCacheConfig.DEFAULT_POPULATE;
    private _coalesce: boolean = QueryCacheConfig.DEFAULT_COALESCE;
    private _serializeKeys: boolean = QueryCacheConfig.DEFAULT_SERIALIZE_KEYS;
    private _includeValue: boolean = QueryCacheConfig.DEFAULT_INCLUDE_VALUE;
    private _evictionMaxSize: number = QueryCacheConfig.DEFAULT_EVICTION_MAX_SIZE;

    getName(): string { return this._name; }
    setName(name: string): this { this._name = name; return this; }

    getPredicate(): Predicate | null { return this._predicate; }
    setPredicate(predicate: Predicate): this { this._predicate = predicate; return this; }

    getBatchSize(): number { return this._batchSize; }
    setBatchSize(batchSize: number): this { this._batchSize = batchSize; return this; }

    getBufferSize(): number { return this._bufferSize; }
    setBufferSize(bufferSize: number): this { this._bufferSize = bufferSize; return this; }

    getDelaySeconds(): number { return this._delaySeconds; }
    setDelaySeconds(delaySeconds: number): this { this._delaySeconds = delaySeconds; return this; }

    getInMemoryFormat(): string { return this._inMemoryFormat; }
    setInMemoryFormat(format: string): this { this._inMemoryFormat = format; return this; }

    isPopulate(): boolean { return this._populate; }
    setPopulate(populate: boolean): this { this._populate = populate; return this; }

    isCoalesce(): boolean { return this._coalesce; }
    setCoalesce(coalesce: boolean): this { this._coalesce = coalesce; return this; }

    isSerializeKeys(): boolean { return this._serializeKeys; }
    setSerializeKeys(serializeKeys: boolean): this { this._serializeKeys = serializeKeys; return this; }

    isIncludeValue(): boolean { return this._includeValue; }
    setIncludeValue(includeValue: boolean): this { this._includeValue = includeValue; return this; }

    getEvictionMaxSize(): number { return this._evictionMaxSize; }
    setEvictionMaxSize(maxSize: number): this { this._evictionMaxSize = maxSize; return this; }
}
