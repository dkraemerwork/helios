/**
 * Port of {@code com.hazelcast.internal.serialization.impl.DataSerializableHeaderTest}.
 */
import { describe, test, expect } from 'bun:test';
import { DataSerializableHeader } from '@zenystx/core/internal/serialization/impl/DataSerializableHeader';

describe('DataSerializableHeaderTest', () => {
    test('identified', () => {
        const header = DataSerializableHeader.createHeader(true, false);
        expect(DataSerializableHeader.isIdentifiedDataSerializable(header)).toBe(true);
        expect(DataSerializableHeader.isVersioned(header)).toBe(false);
    });

    test('versioned', () => {
        const header = DataSerializableHeader.createHeader(false, true);
        expect(DataSerializableHeader.isIdentifiedDataSerializable(header)).toBe(false);
        expect(DataSerializableHeader.isVersioned(header)).toBe(true);
    });

    test('all', () => {
        const header = DataSerializableHeader.createHeader(true, true);
        expect(DataSerializableHeader.isIdentifiedDataSerializable(header)).toBe(true);
        expect(DataSerializableHeader.isVersioned(header)).toBe(true);
    });
});
