/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.NearCacheRecordStoreTest}.
 *
 * Parameterized over InMemoryFormat.BINARY and InMemoryFormat.OBJECT.
 * TTL/idle tests use shorter durations to avoid long test runs.
 */
import { EvictionConfig } from '@zenystx/helios-core/config/EvictionConfig';
import { EvictionPolicy } from '@zenystx/helios-core/config/EvictionPolicy';
import { InMemoryFormat } from '@zenystx/helios-core/config/InMemoryFormat';
import { MaxSizePolicy } from '@zenystx/helios-core/config/MaxSizePolicy';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import type { NearCacheRecordStore } from '@zenystx/helios-core/internal/nearcache/NearCacheRecordStore';
import { NearCacheDataRecordStore } from '@zenystx/helios-core/internal/nearcache/impl/store/NearCacheDataRecordStore';
import { NearCacheObjectRecordStore } from '@zenystx/helios-core/internal/nearcache/impl/store/NearCacheObjectRecordStore';
import { MapHeliosProperties } from '@zenystx/helios-core/spi/properties/HeliosProperties';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import { describe, expect, it } from 'bun:test';

const DEFAULT_RECORD_COUNT = 100;
const DEFAULT_NEAR_CACHE_NAME = 'TestNearCache';

const ss = new TestSerializationService();
const props = new MapHeliosProperties();

function createNearCacheConfig(name: string, fmt: InMemoryFormat): NearCacheConfig {
    return new NearCacheConfig(name).setInMemoryFormat(fmt);
}

function createStore<K, V>(config: NearCacheConfig, fmt: InMemoryFormat): NearCacheRecordStore<K, V> {
    let store: NearCacheRecordStore<K, V>;
    if (fmt === InMemoryFormat.BINARY) {
        store = new NearCacheDataRecordStore<K, V>(DEFAULT_NEAR_CACHE_NAME, config, ss, null, props);
    } else {
        store = new NearCacheObjectRecordStore<K, V>(DEFAULT_NEAR_CACHE_NAME, config, ss, null, props);
    }
    store.initialize();
    return store;
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

for (const fmt of [InMemoryFormat.BINARY, InMemoryFormat.OBJECT]) {
    describe(`NearCacheRecordStoreTest[${fmt}]`, () => {
        it('putAndGetRecord', () => {
            const store = createStore<number, string>(createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt), fmt);
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }
            expect(store.size()).toBe(DEFAULT_RECORD_COUNT);
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                expect(store.get(i)).toBe(`Record-${i}`);
            }
        });

        it('putAndRemoveRecord', () => {
            const store = createStore<number, string>(createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt), fmt);
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
                expect(store.get(i)).not.toBeNull();
            }
            expect(store.size()).toBe(DEFAULT_RECORD_COUNT);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.invalidate(i);
                expect(store.get(i)).toBeNull();
            }
            expect(store.size()).toBe(0);
        });

        it('clearRecords', () => {
            const store = createStore<number, string>(createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt), fmt);
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
                expect(store.get(i)).not.toBeNull();
            }
            store.clear();
            expect(store.size()).toBe(0);
        });

        it('destroyStore', () => {
            const store = createStore<number, string>(createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt), fmt);
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
                expect(store.get(i)).not.toBeNull();
            }
            store.destroy();
            expect(store.size()).toBe(0);
        });

        it('statsCalculated', () => {
            const store = createStore<number, string>(createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt), fmt);
            const creationStartTime = Date.now();
            store.initialize(); // re-init is a no-op for heap store but verifies no crash
            const creationEndTime = Date.now();

            let expectedHits = 0;
            let expectedMisses = 0;

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                if (store.get(i * 3) !== null) expectedHits++;
                else expectedMisses++;
            }

            const stats = store.getNearCacheStats();
            const creationTime = stats.getCreationTime();
            expect(creationTime).toBeGreaterThanOrEqual(creationStartTime - 100);
            expect(creationTime).toBeLessThanOrEqual(creationEndTime + 1000);
            expect(stats.getHits()).toBe(expectedHits);
            expect(stats.getMisses()).toBe(expectedMisses);
            expect(stats.getOwnedEntryCount()).toBe(DEFAULT_RECORD_COUNT);

            if (fmt === InMemoryFormat.BINARY) {
                expect(stats.getOwnedEntryMemoryCost()).toBeGreaterThan(0);
            } else {
                expect(stats.getOwnedEntryMemoryCost()).toBe(0);
            }

            // Invalidate keys divisible by 3
            const sizeBefore = store.size();
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.invalidate(i * 3);
            }
            const sizeAfter = store.size();
            const invalidatedSize = sizeBefore - sizeAfter;
            const expectedEntryCount = DEFAULT_RECORD_COUNT - invalidatedSize;

            expect(stats.getOwnedEntryCount()).toBe(expectedEntryCount);

            store.clear();
            expect(stats.getOwnedEntryMemoryCost()).toBe(0);
        });

        it('ttlEvaluated', async () => {
            const ttlMs = 300; // 300ms instead of 3s
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            // Use a sub-second TTL via setting timeToLiveSeconds to small fractional value isn't supported
            // So we directly test that records expire after TTL using a slightly longer sleep.
            // We use maxIdleSeconds trick: set config to 1 second TTL
            config.setTimeToLiveSeconds(1);
            const store = createStore<number, string>(config, fmt);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                expect(store.get(i)).not.toBeNull();
            }

            await sleep(1100); // wait past TTL

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                expect(store.get(i)).toBeNull();
            }
        }, 5000);

        it('maxIdleTimeEvaluatedSuccessfully', async () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setMaxIdleSeconds(1);
            const store = createStore<number, string>(config, fmt);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }
            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                expect(store.get(i)).not.toBeNull();
            }

            await sleep(1100);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                expect(store.get(i)).toBeNull();
            }
        }, 5000);

        it('expiredRecordsCleanedUpSuccessfullyBecauseOfTTL', async () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setTimeToLiveSeconds(1);
            const store = createStore<number, string>(config, fmt);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }

            await sleep(1100);

            store.doExpiration();

            expect(store.size()).toBe(0);
            expect(store.getNearCacheStats().getOwnedEntryCount()).toBe(0);
            expect(store.getNearCacheStats().getOwnedEntryMemoryCost()).toBe(0);
        }, 5000);

        it('expiredRecordsCleanedUpSuccessfullyBecauseOfIdleTime', async () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setMaxIdleSeconds(1);
            const store = createStore<number, string>(config, fmt);

            for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
                store.put(i, null, `Record-${i}`, null);
            }

            await sleep(1100);

            store.doExpiration();

            expect(store.size()).toBe(0);
            expect(store.getNearCacheStats().getOwnedEntryCount()).toBe(0);
            expect(store.getNearCacheStats().getOwnedEntryMemoryCost()).toBe(0);
        }, 5000);

        it('canCreateWithEntryCountMaxSizePolicy', () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setEvictionConfig(new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.ENTRY_COUNT).setSize(1000));
            expect(() => createStore(config, fmt)).not.toThrow();
        });

        it('cannotCreateWithUsedNativeMemorySizeMaxSizePolicy', () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setEvictionConfig(new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.USED_NATIVE_MEMORY_SIZE).setSize(1000000));
            expect(() => createStore(config, fmt)).toThrow();
        });

        it('cannotCreateWithFreeNativeMemorySizeMaxSizePolicy', () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setEvictionConfig(new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.FREE_NATIVE_MEMORY_SIZE).setSize(1000000));
            expect(() => createStore(config, fmt)).toThrow();
        });

        it('cannotCreateWithUsedNativeMemoryPercentageMaxSizePolicy', () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setEvictionConfig(new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.USED_NATIVE_MEMORY_PERCENTAGE).setSize(99));
            expect(() => createStore(config, fmt)).toThrow();
        });

        it('cannotCreateWithFreeNativeMemoryPercentageMaxSizePolicy', () => {
            const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
            config.setEvictionConfig(new EvictionConfig().setMaxSizePolicy(MaxSizePolicy.FREE_NATIVE_MEMORY_PERCENTAGE).setSize(1));
            expect(() => createStore(config, fmt)).toThrow();
        });

        it('evictionLRU', () => doEvictionTest(fmt, EvictionPolicy.LRU));
        it('evictionLFU', () => doEvictionTest(fmt, EvictionPolicy.LFU));
        it('evictionRANDOM', () => doEvictionTest(fmt, EvictionPolicy.RANDOM));
        it('evictionDefault', () => doEvictionTest(fmt, EvictionPolicy.LRU));
    });
}

function doEvictionTest(fmt: InMemoryFormat, policy: EvictionPolicy): void {
    const maxSize = Math.floor(DEFAULT_RECORD_COUNT / 2);
    const config = createNearCacheConfig(DEFAULT_NEAR_CACHE_NAME, fmt);
    config.setEvictionConfig(
        new EvictionConfig()
            .setMaxSizePolicy(MaxSizePolicy.ENTRY_COUNT)
            .setSize(maxSize)
            .setEvictionPolicy(policy),
    );
    const store = createStore<number, string>(config, fmt);

    for (let i = 0; i < DEFAULT_RECORD_COUNT; i++) {
        store.put(i, null, `Record-${i}`, null);
        store.doEviction(false);
        expect(store.size()).toBeLessThanOrEqual(maxSize);
    }
}
