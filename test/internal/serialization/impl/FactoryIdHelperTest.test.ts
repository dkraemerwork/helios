/**
 * Port of {@code com.hazelcast.internal.serialization.impl.FactoryIdHelperTest}.
 */
import { FactoryIdHelper } from '@zenystx/helios-core/internal/serialization/impl/FactoryIdHelper';
import { afterEach, describe, expect, test } from 'bun:test';

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
