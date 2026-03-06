/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.AbstractNearCacheRecordStoreTest}.
 *
 * Tests the reservation / publish mechanism.
 */
import { describe, it, expect } from 'bun:test';
import { NearCacheConfig } from '@zenystx/core/config/NearCacheConfig';
import { InMemoryFormat } from '@zenystx/core/config/InMemoryFormat';
import { NearCacheDataRecordStore } from '@zenystx/core/internal/nearcache/impl/store/NearCacheDataRecordStore';
import { NOT_RESERVED } from '@zenystx/core/internal/nearcache/NearCacheRecord';
import { TestSerializationService } from '@zenystx/core/test-support/TestSerializationService';
import { MapHeliosProperties } from '@zenystx/core/spi/properties/HeliosProperties';

const ss = new TestSerializationService();
const props = new MapHeliosProperties();
const NAME = 'TestStore';

function createStore() {
    const config = new NearCacheConfig(NAME).setInMemoryFormat(InMemoryFormat.BINARY);
    const store = new NearCacheDataRecordStore(NAME, config, ss, null, props);
    store.initialize();
    return store;
}

describe('AbstractNearCacheRecordStoreTest', () => {
    it('reserveForUpdate_returnsValidId', () => {
        const store = createStore();
        const id = store.tryReserveForUpdate(1, null);
        expect(id).not.toBe(NOT_RESERVED);
        expect(id).toBeGreaterThanOrEqual(0);
    });

    it('secondReserveForSameKey_returnsNOT_RESERVED', () => {
        const store = createStore();
        store.tryReserveForUpdate(1, null);
        const id2 = store.tryReserveForUpdate(1, null);
        expect(id2).toBe(NOT_RESERVED);
    });

    it('publishReserved_withWrongId_returnsCurrentValue', () => {
        const store = createStore();
        const id = store.tryReserveForUpdate(1, null);
        expect(id).not.toBe(NOT_RESERVED);

        // Use a bogus reservation id — should return null (key still reserved, value not published)
        const result = store.tryPublishReserved(1, 'value', id + 1);
        expect(result).toBeNull();
    });

    it('publishReserved_withCorrectId_publishesValue', () => {
        const store = createStore();
        const id = store.tryReserveForUpdate(1, null);
        const result = store.tryPublishReserved(1, 'hello', id);
        expect(result).toBe('hello');
        expect(store.get(1)).toBe('hello');
    });

    it('publishReserved_afterPublished_returnsCurrentValue', () => {
        const store = createStore();
        const id = store.tryReserveForUpdate(1, null);
        store.tryPublishReserved(1, 'hello', id);

        // Trying to publish again with any id returns the already-published value
        const result = store.tryPublishReserved(1, 'world', id);
        expect(result).toBe('hello');
    });
});
