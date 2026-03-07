/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.NearCacheTest}.
 *
 * Tests DefaultNearCache delegating to a wrapped NearCacheRecordStore.
 */
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { NearCacheStatsImpl } from '@zenystx/helios-core/internal/monitor/impl/NearCacheStatsImpl';
import { DefaultNearCache } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCache';
import type { StaleReadDetector } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/StaleReadDetector';
import { NoOpTaskScheduler } from '@zenystx/helios-core/internal/nearcache/impl/TaskScheduler';
import type { UpdateSemantic } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheRecord } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { NOT_RESERVED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { NearCacheRecordStore } from '@zenystx/helios-core/internal/nearcache/NearCacheRecordStore';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import { describe, expect, it } from 'bun:test';

const DEFAULT_RECORD_COUNT = 100;
const DEFAULT_NEAR_CACHE_NAME = 'TestNearCache';

function createNearCacheConfig(name: string, fmt: InMemoryFormat = InMemoryFormat.BINARY): NearCacheConfig {
    return new NearCacheConfig(name).setInMemoryFormat(fmt);
}

function makeKeyValueMap(): Map<number, string> {
    const m = new Map<number, string>();
    for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
        m.set(i, `Record-${i}`);
    }
    return m;
}

/** Managed (mock) record store that records calls and delegates to an in-memory map. */
class ManagedNearCacheRecordStore implements NearCacheRecordStore<number, string> {
    readonly nearCacheStats: NearCacheStatsImpl = new NearCacheStatsImpl();
    private _map: Map<number, string> | null;
    private _reservationIdGen = 0;

    latestKeyOnGet: number | null = null;
    latestValueOnGet: string | null = null;
    latestKeyOnPut: number | null = null;
    latestValueOnPut: string | null = null;
    latestKeyOnRemove: number | null = null;
    latestResultOnRemove = false;
    latestSize = 0;
    clearCalled = false;
    destroyCalled = false;
    doEvictionIfRequiredCalled = false;
    doExpirationCalled = false;

    constructor(map: Map<number, string>) {
        this._map = map;
    }

    initialize(): void {}

    get(key: number): string | null {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        const v = this._map.get(key) ?? null;
        this.latestKeyOnGet = key;
        this.latestValueOnGet = v;
        return v;
    }

    getRecord(_key: number): NearCacheRecord | null { return null; }

    put(key: number, keyData: Data | null, value: string | null, _vd: Data | null): void {
        const rid = this.tryReserveForUpdate(key, keyData, 'READ_UPDATE');
        if (rid !== NOT_RESERVED) {
            this.tryPublishReserved(key, value, rid, false);
        }
    }

    invalidate(key: number): void {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        const existed = this._map.delete(key);
        this.latestKeyOnRemove = key;
        this.latestResultOnRemove = existed;
    }

    clear(): void {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this._map.clear();
        this.clearCalled = true;
    }

    destroy(): void {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this._map.clear();
        this._map = null;
        this.destroyCalled = true;
    }

    getNearCacheStats(): NearCacheStats { return this.nearCacheStats; }

    size(): number {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this.latestSize = this._map.size;
        return this.latestSize;
    }

    doExpiration(): void {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this.doExpirationCalled = true;
    }

    doEviction(_withoutMaxSizeCheck: boolean): boolean {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this.doEvictionIfRequiredCalled = true;
        return true;
    }

    storeKeys(): void {}
    loadKeys(_adapter: unknown): void {}
    setStaleReadDetector(_d: StaleReadDetector): void {}

    tryReserveForUpdate(_key: number, _kd: Data | null, _sem: UpdateSemantic): number {
        return ++this._reservationIdGen;
    }

    tryPublishReserved(key: number, value: string | null, _rid: number, _deser: boolean): string | null {
        if (this._map === null) throw new Error('Near Cache is already destroyed');
        this._map.set(key, value as string);
        this.latestKeyOnPut = key;
        this.latestValueOnPut = value;
        return value;
    }
}

function createNearCache(
    name: string,
    nearCacheRecordStore: ManagedNearCacheRecordStore,
    config?: NearCacheConfig,
): DefaultNearCache<number, string> {
    const cfg = config ?? createNearCacheConfig(name);
    const nc = new DefaultNearCache<number, string>(
        name, cfg, new TestSerializationService(),
        new NoOpTaskScheduler(), null, new MapHeliosProperties(),
        nearCacheRecordStore,
    );
    nc.initialize();
    return nc;
}

describe('NearCacheTest', () => {
    it('getNearCacheName', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);
        expect(nc.getName()).toBe(DEFAULT_NEAR_CACHE_NAME);
    });

    it('getFromNearCache', () => {
        const map = makeKeyValueMap();
        const store = new ManagedNearCacheRecordStore(map);
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(nc.size()).toBe(store.latestSize);

        for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
            const value = nc.get(i);
            expect(store.latestKeyOnGet).toBe(i);
            expect(value).toBe(store.latestValueOnGet);
        }
    });

    it('putToNearCache', () => {
        const store = new ManagedNearCacheRecordStore(new Map());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
            const value = `Record-${i}`;
            nc.put(i, null, value, null);
            expect(store.latestKeyOnPut).toBe(i);
            expect(store.latestValueOnPut).toBe(value);
        }

        expect(nc.size()).toBe(store.latestSize);
    });

    it('removeFromNearCache', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(nc.size()).toBe(store.latestSize);

        for (let i = 0; i < 2 * DEFAULT_RECORD_COUNT; i++) {
            nc.invalidate(i);
            expect(store.latestKeyOnRemove).toBe(i);
            expect(store.latestResultOnRemove).toBe(i < DEFAULT_RECORD_COUNT);
        }

        expect(nc.size()).toBe(store.latestSize);
    });

    it('invalidateFromNearCache', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(nc.size()).toBe(store.latestSize);

        for (let i = 0; i < 2 * DEFAULT_RECORD_COUNT; i++) {
            nc.invalidate(i);
            expect(store.latestKeyOnRemove).toBe(i);
            expect(store.latestResultOnRemove).toBe(i < DEFAULT_RECORD_COUNT);
        }

        expect(nc.size()).toBe(store.latestSize);
    });

    it('clearNearCache', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(store.clearCalled).toBe(false);
        expect(nc.size()).toBe(store.latestSize);

        nc.clear();
        expect(store.clearCalled).toBe(true);
        expect(nc.size()).toBe(store.latestSize);
    });

    it('destroyNearCache', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(store.destroyCalled).toBe(false);
        nc.destroy();
        expect(store.destroyCalled).toBe(true);
    });

    it('configureInMemoryFormatForNearCache', () => {
        const cfg1 = createNearCacheConfig(`${DEFAULT_NEAR_CACHE_NAME}-1`);
        const cfg2 = createNearCacheConfig(`${DEFAULT_NEAR_CACHE_NAME}-2`);

        cfg1.setInMemoryFormat(InMemoryFormat.OBJECT);
        cfg2.setInMemoryFormat(InMemoryFormat.BINARY);

        expect(cfg1.getInMemoryFormat()).toBe(InMemoryFormat.OBJECT);
        expect(cfg2.getInMemoryFormat()).toBe(InMemoryFormat.BINARY);
    });

    it('getNearCacheStatsFromNearCache', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        expect(nc.getNearCacheStats()).toBe(store.nearCacheStats);
    });

    it('putToNearCacheStatsAndSeeEvictionCheckIsDone', () => {
        const store = new ManagedNearCacheRecordStore(makeKeyValueMap());
        const nc = createNearCache(DEFAULT_NEAR_CACHE_NAME, store);

        nc.put(1, null, '1', null);
        expect(store.doEvictionIfRequiredCalled).toBe(true);
    });
});
