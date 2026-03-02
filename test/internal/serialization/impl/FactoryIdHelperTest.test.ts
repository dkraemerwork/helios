/**
 * Port of {@code com.hazelcast.internal.serialization.impl.FactoryIdHelperTest}.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { FactoryIdHelper } from '@helios/internal/serialization/impl/FactoryIdHelper';

const TEST_KEY = 'hazelcast.test.prop';

describe('FactoryIdHelperTest', () => {
    afterEach(() => {
        delete process.env[TEST_KEY];
    });

    test('testPropWithValidNumber', () => {
        process.env[TEST_KEY] = '1';
        const factoryId = FactoryIdHelper.getFactoryId(TEST_KEY, 10);
        expect(factoryId).toBe(1);
    });

    test('testPropWithInValidNumber', () => {
        process.env[TEST_KEY] = 'NaN';
        const factoryId = FactoryIdHelper.getFactoryId(TEST_KEY, 10);
        expect(factoryId).toBe(10);
    });

    test('testPropWithNullNumber', () => {
        delete process.env[TEST_KEY];
        const factoryId = FactoryIdHelper.getFactoryId(TEST_KEY, 10);
        expect(factoryId).toBe(10);
    });
});
