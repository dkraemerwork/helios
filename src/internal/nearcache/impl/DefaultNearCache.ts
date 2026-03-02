/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.DefaultNearCache}.
 *
 * Default NearCache implementation that delegates to a NearCacheRecordStore.
 */
import type { NearCache, UpdateSemantic } from '@helios/internal/nearcache/NearCache';
import type { NearCacheRecordStore } from '@helios/internal/nearcache/NearCacheRecordStore';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { Data } from '@helios/internal/serialization/Data';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';
import type { TaskScheduler, ScheduledTask } from '@helios/internal/nearcache/impl/TaskScheduler';
import type { HeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { InMemoryFormat } from '@helios/config/InMemoryFormat';
import { NearCacheDataRecordStore } from '@helios/internal/nearcache/impl/store/NearCacheDataRecordStore';
import { NearCacheObjectRecordStore } from '@helios/internal/nearcache/impl/store/NearCacheObjectRecordStore';
import { NOT_RESERVED } from '@helios/internal/nearcache/NearCacheRecord';
import { NOT_CACHED } from '@helios/internal/nearcache/NearCache';
import { MapHeliosProperties } from '@helios/spi/properties/HeliosProperties';
import { NoOpTaskScheduler } from '@helios/internal/nearcache/impl/TaskScheduler';

export class DefaultNearCache<K, V> implements NearCache<K, V> {

    private readonly _name: string;
    private readonly _nearCacheConfig: NearCacheConfig;
    private readonly _serializationService: SerializationService;
    private readonly _scheduler: TaskScheduler;
    private readonly _properties: HeliosProperties;
    private readonly _serializeKeys: boolean;

    private _nearCacheRecordStore: NearCacheRecordStore<K, V> | null;
    private _expirationTaskHandle: ScheduledTask | null = null;
    private _preloadDone = false;

    constructor(
        name: string,
        nearCacheConfig: NearCacheConfig,
        serializationService: SerializationService,
        scheduler: TaskScheduler = new NoOpTaskScheduler(),
        _classLoader: unknown = null,
        properties: HeliosProperties = new MapHeliosProperties(),
        nearCacheRecordStore: NearCacheRecordStore<K, V> | null = null,
    ) {
        this._name = name;
        this._nearCacheConfig = nearCacheConfig;
        this._serializationService = serializationService;
        this._scheduler = scheduler;
        this._properties = properties;
        this._serializeKeys = nearCacheConfig.isSerializeKeys();
        this._nearCacheRecordStore = nearCacheRecordStore;
    }

    initialize(): void {
        if (this._nearCacheRecordStore === null) {
            this._nearCacheRecordStore = this.createNearCacheRecordStore(this._name, this._nearCacheConfig);
        }
        this._nearCacheRecordStore.initialize();
        this._expirationTaskHandle = this.createAndScheduleExpirationTask();
    }

    private createNearCacheRecordStore(name: string, config: NearCacheConfig): NearCacheRecordStore<K, V> {
        const fmt = config.getInMemoryFormat() ?? InMemoryFormat.BINARY;
        switch (fmt) {
            case InMemoryFormat.BINARY:
                return new NearCacheDataRecordStore<K, V>(name, config, this._serializationService, null, this._properties);
            case InMemoryFormat.OBJECT:
                return new NearCacheObjectRecordStore<K, V>(name, config, this._serializationService, null, this._properties);
            default:
                throw new Error(`Invalid in memory format: ${fmt}`);
        }
    }

    private createAndScheduleExpirationTask(): ScheduledTask | null {
        if (this._nearCacheConfig.getMaxIdleSeconds() > 0 || this._nearCacheConfig.getTimeToLiveSeconds() > 0) {
            let inProgress = false;
            return this._scheduler.scheduleWithRepetition(
                () => {
                    if (!inProgress) {
                        inProgress = true;
                        try { this._nearCacheRecordStore!.doExpiration(); }
                        finally { inProgress = false; }
                    }
                },
                5, // DEFAULT_EXPIRATION_TASK_INITIAL_DELAY_SECONDS
                5, // DEFAULT_EXPIRATION_TASK_PERIOD_SECONDS
            );
        }
        return null;
    }

    getName(): string { return this._name; }
    getNearCacheConfig(): NearCacheConfig { return this._nearCacheConfig; }

    get(key: K): V | null {
        const result = this._nearCacheRecordStore!.get(key);
        // NearCacheRecordStore.get() returns null for a miss; translate to NOT_CACHED
        // so callers (NearCachedClientMapProxy etc.) can distinguish miss from null value.
        return result === null ? NOT_CACHED as unknown as V : result;
    }

    put(key: K, keyData: Data | null, value: V | null, valueData: Data | null): void {
        this._nearCacheRecordStore!.doEviction(false);
        this._nearCacheRecordStore!.put(key, keyData, value, valueData);
    }

    invalidate(key: K): void {
        this._nearCacheRecordStore!.invalidate(key);
    }

    clear(): void {
        this._nearCacheRecordStore!.clear();
    }

    destroy(): void {
        if (this._expirationTaskHandle !== null) {
            this._expirationTaskHandle.cancel();
        }
        this._nearCacheRecordStore!.destroy();
    }

    size(): number {
        return this._nearCacheRecordStore!.size();
    }

    getNearCacheStats(): NearCacheStats {
        return this._nearCacheRecordStore!.getNearCacheStats();
    }

    isSerializeKeys(): boolean {
        return this._serializeKeys;
    }

    preload(adapter: unknown): void {
        this._nearCacheRecordStore!.loadKeys(adapter);
        this._preloadDone = true;
    }

    storeKeys(): void {
        if (this._preloadDone) {
            this._nearCacheRecordStore!.storeKeys();
        }
    }

    isPreloadDone(): boolean {
        return this._preloadDone;
    }

    unwrap<T>(clazz: new (...args: unknown[]) => T): T {
        if (this instanceof clazz) return this as unknown as T;
        throw new Error(`Unwrapping to ${clazz.name} is not supported`);
    }

    tryReserveForUpdate(key: K, keyData: Data | null, updateSemantic: UpdateSemantic): number {
        this._nearCacheRecordStore!.doEviction(false);
        return this._nearCacheRecordStore!.tryReserveForUpdate(key, keyData, updateSemantic);
    }

    tryPublishReserved(key: K, value: V | null, reservationId: number, deserialize: boolean): V | null {
        return this._nearCacheRecordStore!.tryPublishReserved(key, value, reservationId, deserialize);
    }

    getNearCacheRecordStore(): NearCacheRecordStore<K, V> {
        return this._nearCacheRecordStore!;
    }

    toString(): string {
        return `DefaultNearCache{name='${this._name}', preloadDone=${this._preloadDone}}`;
    }
}
