/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationUtilsTest}.
 */
import { describe, it, expect } from 'bun:test';
import { InvalidationUtils } from '@zenystx/core/internal/nearcache/impl/invalidation/InvalidationUtils';

describe('InvalidationUtilsTest', () => {
    it('testConstructor', () => {
        // Utility class should not be instantiable — just verify the constants exist
        expect(InvalidationUtils.NO_SEQUENCE).toBe(-1);
        expect(typeof InvalidationUtils.TRUE_FILTER).toBe('function');
    });
});
