/**
 * Unit tests for MemberMinimalPartitionService.
 *
 * Verifies that all calls are correctly delegated to the wrapped partition service.
 */
import { describe, it, expect } from 'bun:test';
import { MemberMinimalPartitionService } from '@zenystx/core/map/impl/nearcache/MemberMinimalPartitionService';

function makePartitionService(count = 271) {
    return {
        getPartitionCount: () => count,
        getPartitionId: (key: unknown) => {
            if (typeof key === 'number') return key % count;
            return 5; // fixed fallback
        },
    };
}

describe('MemberMinimalPartitionService', () => {
    it('getPartitionCount delegates to wrapped service', () => {
        const wrapped = makePartitionService(99);
        const mps = new MemberMinimalPartitionService(wrapped);
        expect(mps.getPartitionCount()).toBe(99);
    });

    it('getPartitionId(key) delegates to wrapped service', () => {
        const wrapped = makePartitionService(271);
        const mps = new MemberMinimalPartitionService(wrapped);
        expect(mps.getPartitionId(10)).toBe(10 % 271);
        expect(mps.getPartitionId(100)).toBe(100 % 271);
    });

    it('getPartitionId with non-number key returns wrapped result', () => {
        const wrapped = makePartitionService(271);
        const mps = new MemberMinimalPartitionService(wrapped);
        expect(mps.getPartitionId('someString')).toBe(5);
    });

    it('uses 271 partition count by default in TestPartitionService', () => {
        const wrapped = makePartitionService(271);
        const mps = new MemberMinimalPartitionService(wrapped);
        expect(mps.getPartitionCount()).toBe(271);
    });
});
