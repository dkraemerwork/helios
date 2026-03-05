/**
 * Tests for MapReplicationOperation — Block 16.F3.
 *
 * MapReplicationOperation composes MapReplicationStateHolder,
 * WriteBehindStateHolder, and MapNearCacheStateHolder to perform
 * full partition replication for maps.
 */
import { describe, test, expect, mock } from 'bun:test';
import { MapReplicationOperation } from '@helios/map/impl/operation/MapReplicationOperation';
import { MapReplicationStateHolder } from '@helios/map/impl/operation/MapReplicationStateHolder';
import { WriteBehindStateHolder } from '@helios/map/impl/operation/WriteBehindStateHolder';
import { MapNearCacheStateHolder } from '@helios/map/impl/operation/MapNearCacheStateHolder';
import { PartitionContainer } from '@helios/internal/partition/impl/PartitionContainer';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';
import type { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';
import type { WriteBehindStore } from '@helios/map/impl/mapstore/writebehind/WriteBehindStore';
import type { Data } from '@helios/internal/serialization/Data';

function data(val: string): Data {
    // HeapData requires an 8-byte header + payload; build a minimal valid buffer.
    const payload = Buffer.from(val);
    const buf = Buffer.alloc(8 + payload.length);
    buf.writeInt32BE(0, 0); // partition hash
    buf.writeInt32BE(-1, 4); // type id
    payload.copy(buf, 8);
    return new HeapData(buf);
}

describe('MapReplicationOperation', () => {
    test('run() applies mapReplicationStateHolder state', () => {
        const source = new PartitionContainer(0);
        const dest = new PartitionContainer(0);

        // Populate source
        const store = source.getRecordStore('myMap');
        store.put(data('k1'), data('v1'), -1, -1);
        store.put(data('k2'), data('v2'), -1, -1);

        // Prepare holders
        const mapHolder = new MapReplicationStateHolder();
        mapHolder.prepare(source, 0, 0);

        const wbHolder = new WriteBehindStateHolder();
        const ncHolder = new MapNearCacheStateHolder();

        const op = new MapReplicationOperation(0, 0, mapHolder, wbHolder, ncHolder);
        op.run(dest, new Map(), null);

        // Verify records applied
        const destStore = dest.getRecordStore('myMap');
        expect(destStore.get(data('k1'))).toEqual(data('v1'));
        expect(destStore.get(data('k2'))).toEqual(data('v2'));
    });

    test('run() applies writeBehindStateHolder state', () => {
        const dest = new PartitionContainer(0);

        const mapHolder = new MapReplicationStateHolder();
        const wbHolder = new WriteBehindStateHolder();

        // Manually set captured delayed entries
        const fakeEntry = { key: 'k1', value: 'v1', storeTime: Date.now(), expirationTime: -1 };
        wbHolder.delayedEntries.set('myMap', [fakeEntry as any]);
        wbHolder.flushSequences.set('myMap', new Map([['seq1', 42]]));

        // Create mock WriteBehindStore
        const mockQueue = { addForcibly: mock(() => {}) };
        const mockWorker = { start: mock(() => {}) };
        const mockStore = {
            reset: mock(() => {}),
            setFlushSequences: mock(() => {}),
            getFlushSequences: mock(() => new Map()),
            asList: mock(() => []),
            queue: mockQueue,
            worker: mockWorker,
        } as unknown as WriteBehindStore<unknown, unknown>;

        const stores = new Map<string, WriteBehindStore<unknown, unknown>>([['myMap', mockStore]]);

        const ncHolder = new MapNearCacheStateHolder();
        const op = new MapReplicationOperation(0, 0, mapHolder, wbHolder, ncHolder);
        op.run(dest, stores, null);

        expect(mockStore.reset).toHaveBeenCalledTimes(1);
        expect(mockStore.setFlushSequences).toHaveBeenCalledTimes(1);
        expect(mockQueue.addForcibly).toHaveBeenCalledTimes(1);
        expect(mockWorker.start).toHaveBeenCalledTimes(1);
    });

    test('run() applies nearCacheStateHolder only for replicaIndex 0 (primary)', () => {
        const dest = new PartitionContainer(0);
        const mapHolder = new MapReplicationStateHolder();
        const wbHolder = new WriteBehindStateHolder();
        const ncHolder = new MapNearCacheStateHolder();

        // Set up some near cache state
        ncHolder.partitionUuid = 'test-uuid';
        ncHolder.nameSequencePairs = ['myMap', 5];

        const mockMetaDataGen = {
            setUuid: mock(() => {}),
            setCurrentSequence: mock(() => {}),
        } as unknown as MetaDataGenerator;

        // replicaIndex = 0 → should apply near cache state
        const op = new MapReplicationOperation(0, 0, mapHolder, wbHolder, ncHolder);
        op.run(dest, new Map(), mockMetaDataGen);

        expect(mockMetaDataGen.setUuid).toHaveBeenCalledWith(0, 'test-uuid');
        expect(mockMetaDataGen.setCurrentSequence).toHaveBeenCalledWith('myMap', 0, 5);
    });

    test('run() does NOT apply nearCacheStateHolder for replicaIndex > 0 (backup)', () => {
        const dest = new PartitionContainer(0);
        const mapHolder = new MapReplicationStateHolder();
        const wbHolder = new WriteBehindStateHolder();
        const ncHolder = new MapNearCacheStateHolder();

        ncHolder.partitionUuid = 'test-uuid';
        ncHolder.nameSequencePairs = ['myMap', 5];

        const mockMetaDataGen = {
            setUuid: mock(() => {}),
            setCurrentSequence: mock(() => {}),
        } as unknown as MetaDataGenerator;

        // replicaIndex = 1 → should NOT apply near cache state
        const op = new MapReplicationOperation(0, 1, mapHolder, wbHolder, ncHolder);
        op.run(dest, new Map(), mockMetaDataGen);

        expect(mockMetaDataGen.setUuid).not.toHaveBeenCalled();
        expect(mockMetaDataGen.setCurrentSequence).not.toHaveBeenCalled();
    });
});
