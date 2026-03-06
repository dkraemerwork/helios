/**
 * Tests for {@link MapReplicationStateHolder}.
 *
 * Block 16.F1 — record capture + apply during partition replication.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MapReplicationStateHolder } from '@zenystx/helios-core/map/impl/operation/MapReplicationStateHolder';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

/** Create a minimal Data stub with a unique payload derived from a string. */
function data(s: string): Data {
    const payload = Buffer.from(s, 'utf8');
    const buf = Buffer.allocUnsafe(8 + payload.length);
    buf.writeInt32BE(0, 0);   // partition hash
    buf.writeInt32BE(1, 4);   // type = 1
    payload.copy(buf, 8);
    return new HeapData(buf);
}

describe('MapReplicationStateHolder', () => {
    let holder: MapReplicationStateHolder;

    beforeEach(() => {
        holder = new MapReplicationStateHolder();
    });

    test('prepare captures records from all maps in partition', () => {
        const container = new PartitionContainer(0);
        const store1 = container.getRecordStore('map1');
        store1.put(data('k1'), data('v1'), -1, -1);
        store1.put(data('k2'), data('v2'), -1, -1);

        const store2 = container.getRecordStore('map2');
        store2.put(data('k3'), data('v3'), -1, -1);

        holder.prepare(container, 0, 0);

        expect(holder.mapData.size).toBe(2);
        expect(holder.mapData.has('map1')).toBe(true);
        expect(holder.mapData.has('map2')).toBe(true);
        expect(holder.mapData.get('map1')!.length).toBe(2);
        expect(holder.mapData.get('map2')!.length).toBe(1);
    });

    test('prepare captures empty maps', () => {
        const container = new PartitionContainer(0);
        container.getRecordStore('emptyMap');

        holder.prepare(container, 0, 0);

        expect(holder.mapData.has('emptyMap')).toBe(true);
        expect(holder.mapData.get('emptyMap')!.length).toBe(0);
    });

    test('prepare with no maps produces empty state', () => {
        const container = new PartitionContainer(0);

        holder.prepare(container, 0, 0);

        expect(holder.mapData.size).toBe(0);
    });

    test('applyState restores records to destination partition', () => {
        const srcContainer = new PartitionContainer(0);
        const srcStore = srcContainer.getRecordStore('myMap');
        srcStore.put(data('k1'), data('v1'), -1, -1);
        srcStore.put(data('k2'), data('v2'), -1, -1);

        holder.prepare(srcContainer, 0, 0);

        const dstContainer = new PartitionContainer(0);
        holder.applyState(dstContainer);

        const dstStore = dstContainer.getRecordStore('myMap');
        expect(dstStore.size()).toBe(2);
        expect(dstStore.get(data('k1'))!.equals(data('v1'))).toBe(true);
        expect(dstStore.get(data('k2'))!.equals(data('v2'))).toBe(true);
    });

    test('applyState clears destination before applying', () => {
        const srcContainer = new PartitionContainer(0);
        srcContainer.getRecordStore('myMap').put(data('k1'), data('newVal'), -1, -1);

        holder.prepare(srcContainer, 0, 0);

        const dstContainer = new PartitionContainer(0);
        const dstStore = dstContainer.getRecordStore('myMap');
        dstStore.put(data('k1'), data('oldVal'), -1, -1);
        dstStore.put(data('k99'), data('willBeCleared'), -1, -1);

        holder.applyState(dstContainer);

        expect(dstStore.size()).toBe(1);
        expect(dstStore.get(data('k1'))!.equals(data('newVal'))).toBe(true);
        expect(dstStore.get(data('k99'))).toBeNull();
    });

    test('applyState restores multiple maps', () => {
        const srcContainer = new PartitionContainer(0);
        srcContainer.getRecordStore('map1').put(data('a'), data('1'), -1, -1);
        srcContainer.getRecordStore('map2').put(data('b'), data('2'), -1, -1);
        srcContainer.getRecordStore('map3').put(data('c'), data('3'), -1, -1);

        holder.prepare(srcContainer, 0, 0);

        const dstContainer = new PartitionContainer(0);
        holder.applyState(dstContainer);

        expect(dstContainer.getRecordStore('map1').get(data('a'))!.equals(data('1'))).toBe(true);
        expect(dstContainer.getRecordStore('map2').get(data('b'))!.equals(data('2'))).toBe(true);
        expect(dstContainer.getRecordStore('map3').get(data('c'))!.equals(data('3'))).toBe(true);
    });
});
