import { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator';
import { MapNearCacheStateHolder } from '@zenystx/helios-core/map/impl/operation/MapNearCacheStateHolder';
import { describe, expect, it } from 'bun:test';

describe('MapNearCacheStateHolder', () => {
    it('prepare() captures partitionUuid from MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        const uuid = gen.getOrCreateUuid(2);

        const holder = new MapNearCacheStateHolder();
        holder.prepare(2, ['myMap'], gen);

        expect(holder.partitionUuid).toBe(uuid);
    });

    it('prepare() captures nameSequencePairs from MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        gen.nextSequence('myMap', 1);
        gen.nextSequence('myMap', 1);

        const holder = new MapNearCacheStateHolder();
        holder.prepare(1, ['myMap'], gen);

        // nameSequencePairs is interleaved [name, seq, name, seq, ...]
        expect(holder.nameSequencePairs.length).toBe(2);
        expect(holder.nameSequencePairs[0]).toBe('myMap');
        expect(holder.nameSequencePairs[1]).toBe(2);
    });

    it('applyState() restores partitionUuid to MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        const holder = new MapNearCacheStateHolder();
        holder.partitionUuid = 'test-uuid-1234';
        holder.nameSequencePairs = [];

        const target = new MetaDataGenerator(4);
        holder.applyState(0, target);

        expect(target.getOrCreateUuid(0)).toBe('test-uuid-1234');
    });

    it('applyState() restores nameSequencePairs to MetaDataGenerator', () => {
        const gen = new MetaDataGenerator(4);
        const holder = new MapNearCacheStateHolder();
        holder.partitionUuid = null;
        holder.nameSequencePairs = ['mapA', 5, 'mapB', 10];

        const target = new MetaDataGenerator(4);
        holder.applyState(3, target);

        expect(target.currentSequence('mapA', 3)).toBe(5);
        expect(target.currentSequence('mapB', 3)).toBe(10);
    });
});
