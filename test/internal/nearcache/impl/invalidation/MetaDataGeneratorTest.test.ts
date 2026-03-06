/**
 * Unit tests for MetaDataGenerator.
 * Port of the generator contract from com.hazelcast.internal.nearcache.impl.invalidation.MetaDataGenerator.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MetaDataGenerator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MetaDataGenerator';

describe('MetaDataGeneratorTest', () => {
    let generator: MetaDataGenerator;

    beforeEach(() => {
        generator = new MetaDataGenerator(271);
    });

    it('nextSequence_incrementsPerPartition', () => {
        const seq1 = generator.nextSequence('testMap', 0);
        const seq2 = generator.nextSequence('testMap', 0);
        expect(seq1).toBe(1);
        expect(seq2).toBe(2);
    });

    it('nextSequence_independentPerPartition', () => {
        const seq0 = generator.nextSequence('testMap', 0);
        const seq1 = generator.nextSequence('testMap', 1);
        expect(seq0).toBe(1);
        expect(seq1).toBe(1);
    });

    it('nextSequence_independentPerDataStructure', () => {
        const seqA = generator.nextSequence('mapA', 0);
        const seqB = generator.nextSequence('mapB', 0);
        expect(seqA).toBe(1);
        expect(seqB).toBe(1);
    });

    it('currentSequence_returnsZeroForUnknownName', () => {
        expect(generator.currentSequence('unknownMap', 0)).toBe(0);
    });

    it('currentSequence_returnsLastGeneratedSequence', () => {
        generator.nextSequence('myMap', 5);
        generator.nextSequence('myMap', 5);
        expect(generator.currentSequence('myMap', 5)).toBe(2);
    });

    it('getOrCreateUuid_returnsSameUuidForSamePartition', () => {
        const uuid1 = generator.getOrCreateUuid(3);
        const uuid2 = generator.getOrCreateUuid(3);
        expect(uuid1).toBe(uuid2);
        expect(typeof uuid1).toBe('string');
    });

    it('getOrCreateUuid_returnsDifferentUuidForDifferentPartitions', () => {
        const uuid0 = generator.getOrCreateUuid(0);
        const uuid1 = generator.getOrCreateUuid(1);
        expect(uuid0).not.toBe(uuid1);
    });

    it('getUuidOrNull_returnsNullForUnknownPartition', () => {
        expect(generator.getUuidOrNull(99)).toBeNull();
    });

    it('destroyMetaDataFor_removesSequenceGenerator', () => {
        generator.nextSequence('myMap', 0);
        generator.destroyMetaDataFor('myMap');
        // After destroy, sequence restarts from 0
        expect(generator.currentSequence('myMap', 0)).toBe(0);
    });

    it('removeUuidAndSequence_resetsSequencesForPartition', () => {
        generator.nextSequence('myMap', 2);
        generator.nextSequence('myMap', 2);
        generator.getOrCreateUuid(2);
        generator.removeUuidAndSequence(2);
        expect(generator.getUuidOrNull(2)).toBeNull();
        expect(generator.currentSequence('myMap', 2)).toBe(0);
    });
});
