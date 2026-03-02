import { describe, it, expect } from 'bun:test';
import { CacheGetInvalidationMetaDataOperation } from '@helios/cache/impl/operation/CacheGetInvalidationMetaDataOperation';
import { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';

describe('CacheGetInvalidationMetaDataOperation', () => {
    it('run() includes partition UUIDs for each owned partition', () => {
        const gen = new MetaDataGenerator(8);
        const uuid1 = gen.getOrCreateUuid(1);
        const uuid5 = gen.getOrCreateUuid(5);

        const op = new CacheGetInvalidationMetaDataOperation(['myCache'], [1, 5], gen);
        op.run();

        const response = op.getResponse();
        expect(response.partitionUuidList.get(1)).toBe(uuid1);
        expect(response.partitionUuidList.get(5)).toBe(uuid5);
    });

    it('run() returns only non-zero sequences in namePartitionSequenceList', () => {
        const gen = new MetaDataGenerator(8);
        gen.nextSequence('cacheX', 4);

        const op = new CacheGetInvalidationMetaDataOperation(['cacheX'], [4, 7], gen);
        op.run();

        const response = op.getResponse();
        const seqs = response.namePartitionSequenceList.get('cacheX')!;
        expect(seqs.length).toBe(1);
        expect(seqs[0]![0]).toBe(4);  // partitionId
        expect(seqs[0]![1]).toBe(1);  // sequence value
    });
});
