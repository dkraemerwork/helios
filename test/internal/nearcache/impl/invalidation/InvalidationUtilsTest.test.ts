/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationUtilsTest}.
 */
import { InvalidationUtils } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/InvalidationUtils';
import { describe, expect, it } from 'bun:test';

describe('InvalidationUtilsTest', () => {
    it('testConstructor', () => {
        // Utility class should not be instantiable — just verify the constants exist
        expect(InvalidationUtils.NO_SEQUENCE).toBe(-1);
        expect(typeof InvalidationUtils.TRUE_FILTER).toBe('function');
    });
});
