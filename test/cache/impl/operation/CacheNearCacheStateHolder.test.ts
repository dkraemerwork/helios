import { describe, it, expect } from 'bun:test';
import { CacheNearCacheStateHolder } from '@zenystx/core/cache/impl/operation/CacheNearCacheStateHolder';
import { MetaDataGenerator } from '@zenystx/core/internal/nearcache/impl/invalidation/MetaDataGenerator';

describe('CacheNearCacheStateHolder', () => {
    it('prepare() captures partitionUuid from MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        const uuid = gen.getOrCreateUuid(0);

        const holder = new CacheNearCacheStateHolder();
        holder.prepare(0, ['myCache'], gen);

        expect(holder.partitionUuid).toBe(uuid);
    });

    it('prepare() captures cacheNameSequencePairs from MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        gen.nextSequence('myCache', 2);
        gen.nextSequence('myCache', 2);
        gen.nextSequence('myCache', 2);

        const holder = new CacheNearCacheStateHolder();
        holder.prepare(2, ['myCache'], gen);

        expect(holder.cacheNameSequencePairs.length).toBe(2);
        expect(holder.cacheNameSequencePairs[0]).toBe('myCache');
        expect(holder.cacheNameSequencePairs[1]).toBe(3);
    });

    it('applyState() restores partitionUuid to MetaDataGenerator', () => {
        const holder = new CacheNearCacheStateHolder();
        holder.partitionUuid = 'cache-uuid-5678';
        holder.cacheNameSequencePairs = [];

        const target = new MetaDataGenerator(4);
        holder.applyState(1, target);

        expect(target.getOrCreateUuid(1)).toBe('cache-uuid-5678');
    });

    it('applyState() restores cacheNameSequencePairs to MetaDataGenerator', () => {
        const holder = new CacheNearCacheStateHolder();
        holder.partitionUuid = null;
        holder.cacheNameSequencePairs = ['cacheA', 7, 'cacheB', 3];

        const target = new MetaDataGenerator(4);
        holder.applyState(0, target);

        expect(target.currentSequence('cacheA', 0)).toBe(7);
        expect(target.currentSequence('cacheB', 0)).toBe(3);
    });
});
