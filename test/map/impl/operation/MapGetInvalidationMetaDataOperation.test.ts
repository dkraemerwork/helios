import { describe, it, expect } from 'bun:test';
import { MapGetInvalidationMetaDataOperation } from '@zenystx/core/map/impl/operation/MapGetInvalidationMetaDataOperation';
import { MetaDataGenerator } from '@zenystx/core/internal/nearcache/impl/invalidation/MetaDataGenerator';

describe('MapGetInvalidationMetaDataOperation', () => {
    it('run() includes partition UUIDs for each owned partition', () => {
        const gen = new MetaDataGenerator(8);
        // pre-create UUIDs for partitions 0 and 3
        const uuid0 = gen.getOrCreateUuid(0);
        const uuid3 = gen.getOrCreateUuid(3);

        const op = new MapGetInvalidationMetaDataOperation(['myMap'], [0, 3], gen);
        op.run();

        const response = op.getResponse();
        expect(response.partitionUuidList.get(0)).toBe(uuid0);
        expect(response.partitionUuidList.get(3)).toBe(uuid3);
    });

    it('run() returns only non-zero sequences in namePartitionSequenceList', () => {
        const gen = new MetaDataGenerator(8);
        gen.nextSequence('mapA', 1);
        gen.nextSequence('mapA', 1);
        // partition 2 has sequence 0 for mapA → must be omitted

        const op = new MapGetInvalidationMetaDataOperation(['mapA'], [1, 2], gen);
        op.run();

        const response = op.getResponse();
        const seqs = response.namePartitionSequenceList.get('mapA')!;
        expect(seqs).toBeDefined();
        // only partition 1 has non-zero sequence
        expect(seqs.length).toBe(1);
        expect(seqs[0]![0]).toBe(1);  // partitionId
        expect(seqs[0]![1]).toBe(2);  // sequence value
    });

    it('run() returns an entry for each requested map name even if all sequences are zero', () => {
        const gen = new MetaDataGenerator(4);
        const op = new MapGetInvalidationMetaDataOperation(['emptyMap'], [0, 1], gen);
        op.run();

        const response = op.getResponse();
        expect(response.namePartitionSequenceList.has('emptyMap')).toBe(true);
        expect(response.namePartitionSequenceList.get('emptyMap')!.length).toBe(0);
    });
});
