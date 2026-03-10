/**
 * Unit tests for map Operations (Get/Put/Remove/ContainsKey/PutIfAbsent/Set/Delete).
 * Each operation runs through the NodeEngine + MapContainerService + DefaultRecordStore stack.
 * Ported from com.hazelcast.map.impl.operation (Block 3.2b).
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import { ContainsKeyOperation } from '@zenystx/helios-core/map/impl/operation/ContainsKeyOperation';
import { DeleteOperation } from '@zenystx/helios-core/map/impl/operation/DeleteOperation';
import { GetOperation } from '@zenystx/helios-core/map/impl/operation/GetOperation';
import { PutIfAbsentOperation } from '@zenystx/helios-core/map/impl/operation/PutIfAbsentOperation';
import { PutOperation } from '@zenystx/helios-core/map/impl/operation/PutOperation';
import { RemoveOperation } from '@zenystx/helios-core/map/impl/operation/RemoveOperation';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { beforeEach, describe, expect, test } from 'bun:test';

describe('Map Operations via NodeEngine', () => {
    const MAP_NAME = 'testMap';
    const PARTITION = 0;

    let nodeEngine: TestNodeEngine;
    let store: DefaultRecordStore;

    function d(x: unknown): Data { return nodeEngine.toData(x)!; }
    function o(data: Data | null): unknown { return nodeEngine.toObject(data); }

    async function invoke<T>(op: Operation): Promise<T> {
        const future = nodeEngine.getOperationService()
            .invokeOnPartition<T>(MapService.SERVICE_NAME, op, PARTITION);
        return await future.get();
    }

    beforeEach(() => {
        nodeEngine = new TestNodeEngine();
        store = new DefaultRecordStore();
        const svc = new MapContainerService();
        svc.setRecordStore(MAP_NAME, PARTITION, store);
        nodeEngine.registerService(MapService.SERVICE_NAME, svc);
    });

    test('GetOperation returns null for missing key', async () => {
        const result = await invoke<Data | null>(new GetOperation(MAP_NAME, d('k')));
        expect(result).toBeNull();
    });

    test('GetOperation returns stored value', async () => {
        store.put(d('k'), d(42), -1, -1);
        const result = await invoke<Data | null>(new GetOperation(MAP_NAME, d('k')));
        expect(o(result)).toBe(42);
    });

    test('PutOperation stores value and returns null for new key', async () => {
        const old = await invoke<Data | null>(new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1));
        expect(old).toBeNull();
        expect(o(store.get(d('k')))).toBe('v');
    });

    test('PutOperation returns old value on overwrite', async () => {
        store.put(d('k'), d('old'), -1, -1);
        const result = await invoke<Data | null>(new PutOperation(MAP_NAME, d('k'), d('new'), -1, -1));
        expect(o(result)).toBe('old');
    });

    test('RemoveOperation returns old value and removes entry', async () => {
        store.put(d('k'), d('val'), -1, -1);
        const old = await invoke<Data | null>(new RemoveOperation(MAP_NAME, d('k')));
        expect(o(old)).toBe('val');
        expect(store.containsKey(d('k'))).toBe(false);
    });

    test('ContainsKeyOperation returns true for present key', async () => {
        store.put(d('k'), d(1), -1, -1);
        expect(await invoke<boolean>(new ContainsKeyOperation(MAP_NAME, d('k')))).toBe(true);
    });

    test('ContainsKeyOperation returns false for absent key', async () => {
        expect(await invoke<boolean>(new ContainsKeyOperation(MAP_NAME, d('missing')))).toBe(false);
    });

    test('PutIfAbsentOperation inserts when key absent', async () => {
        const r = await invoke<Data | null>(new PutIfAbsentOperation(MAP_NAME, d('k'), d('v'), -1, -1));
        expect(r).toBeNull();
        expect(o(store.get(d('k')))).toBe('v');
    });

    test('PutIfAbsentOperation returns existing value and does not overwrite', async () => {
        store.put(d('k'), d('orig'), -1, -1);
        const r = await invoke<Data | null>(new PutIfAbsentOperation(MAP_NAME, d('k'), d('new'), -1, -1));
        expect(o(r)).toBe('orig');
        expect(o(store.get(d('k')))).toBe('orig');
    });

    test('SetOperation stores value (no return value)', async () => {
        await invoke<void>(new SetOperation(MAP_NAME, d('k'), d('val'), -1, -1));
        expect(o(store.get(d('k')))).toBe('val');
    });

    test('DeleteOperation returns true when key existed', async () => {
        store.put(d('k'), d(1), -1, -1);
        expect(await invoke<boolean>(new DeleteOperation(MAP_NAME, d('k')))).toBe(true);
        expect(store.containsKey(d('k'))).toBe(false);
    });

    test('DeleteOperation returns false when key missing', async () => {
        expect(await invoke<boolean>(new DeleteOperation(MAP_NAME, d('k')))).toBe(false);
    });

    test('owner-routed operations update map stats in the container service', async () => {
        const mapService = nodeEngine.getService<MapContainerService>(MapService.SERVICE_NAME);

        await invoke<Data | null>(new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1));
        await invoke<Data | null>(new GetOperation(MAP_NAME, d('k')));
        await invoke<void>(new SetOperation(MAP_NAME, d('k'), d('v2'), -1, -1));
        await invoke<boolean>(new DeleteOperation(MAP_NAME, d('k')));

        const stats = mapService.getAllMapStats().get(MAP_NAME);
        expect(stats).toBeDefined();
        expect(stats).toEqual(expect.objectContaining({
            putCount: 1,
            getCount: 1,
            setCount: 1,
            removeCount: 1,
        }));
    });
});
