/**
 * Unit tests for MetaDataContainer — port of the metadata container contract from
 * com.hazelcast.internal.nearcache.impl.invalidation.MetaDataContainer.
 */
import { describe, it, expect } from 'bun:test';
import { MetaDataContainer } from '@zenystx/core/internal/nearcache/impl/invalidation/MetaDataContainer';

describe('MetaDataContainerTest', () => {
    it('initialStateIsZero', () => {
        const container = new MetaDataContainer();
        expect(container.getSequence()).toBe(0);
        expect(container.getStaleSequence()).toBe(0);
        expect(container.getMissedSequenceCount()).toBe(0);
        expect(container.getUuid()).toBeNull();
    });

    it('setAndGetSequence', () => {
        const container = new MetaDataContainer();
        container.setSequence(42);
        expect(container.getSequence()).toBe(42);
    });

    it('casSequence_successOnMatch', () => {
        const container = new MetaDataContainer();
        container.setSequence(10);
        const result = container.casSequence(10, 20);
        expect(result).toBe(true);
        expect(container.getSequence()).toBe(20);
    });

    it('casSequence_failsOnMismatch', () => {
        const container = new MetaDataContainer();
        container.setSequence(10);
        const result = container.casSequence(5, 20);
        expect(result).toBe(false);
        expect(container.getSequence()).toBe(10);
    });

    it('resetSequence', () => {
        const container = new MetaDataContainer();
        container.setSequence(100);
        container.resetSequence();
        expect(container.getSequence()).toBe(0);
    });

    it('missedSequenceCount_addAndGet', () => {
        const container = new MetaDataContainer();
        const result = container.addAndGetMissedSequenceCount(5);
        expect(result).toBe(5);
        expect(container.getMissedSequenceCount()).toBe(5);
        const result2 = container.addAndGetMissedSequenceCount(-3);
        expect(result2).toBe(2);
    });

    it('casStaleSequence_successOnMatch', () => {
        const container = new MetaDataContainer();
        const result = container.casStaleSequence(0, 10);
        expect(result).toBe(true);
        expect(container.getStaleSequence()).toBe(10);
    });

    it('setAndGetUuid', () => {
        const container = new MetaDataContainer();
        const uuid = 'test-uuid-1234';
        container.setUuid(uuid);
        expect(container.getUuid()).toBe(uuid);
    });

    it('casUuid_successOnMatch', () => {
        const container = new MetaDataContainer();
        const uuid1 = 'uuid-one';
        const uuid2 = 'uuid-two';
        container.setUuid(uuid1);
        const result = container.casUuid(uuid1, uuid2);
        expect(result).toBe(true);
        expect(container.getUuid()).toBe(uuid2);
    });

    it('casUuid_failsOnMismatch', () => {
        const container = new MetaDataContainer();
        const uuid1 = 'uuid-one';
        const uuid2 = 'uuid-two';
        container.setUuid(uuid1);
        const result = container.casUuid('wrong-uuid', uuid2);
        expect(result).toBe(false);
        expect(container.getUuid()).toBe(uuid1);
    });
});
