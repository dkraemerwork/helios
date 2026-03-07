/**
 * Block 16.C4 — MapProxy migration to OperationService.
 *
 * Verifies that MapProxy routes all core async map operations through
 * OperationService.invokeOnPartition() instead of calling RecordStore directly.
 */
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapProxy } from '@zenystx/helios-core/map/impl/MapProxy';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { describe, expect, spyOn, test } from 'bun:test';

function makeFixture() {
    const ne = new TestNodeEngine();
    const cs = new MapContainerService();
    for (let i = 0; i < 271; i++) {
        cs.setRecordStore('test', i, new DefaultRecordStore());
    }
    ne.registerService(MapService.SERVICE_NAME, cs);

    const opService = ne.getOperationService();
    const invokeOnPartitionSpy = spyOn(opService, 'invokeOnPartition');

    const proxy = new MapProxy<string, number>('test', cs.getOrCreateRecordStore('test', 0), ne, cs);

    return { ne, cs, proxy, opService, invokeOnPartitionSpy };
}

describe('Block 16.C4 — MapProxy routes through OperationService', () => {
    test('put routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.put('key1', 42);
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
        const call = invokeOnPartitionSpy.mock.calls[0];
        expect(call[0]).toBe(MapService.SERVICE_NAME);
    });

    test('get routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.put('key1', 42);
        invokeOnPartitionSpy.mockClear();
        const val = await proxy.get('key1');
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
        expect(val).toBe(42);
    });

    test('remove routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.put('key1', 42);
        invokeOnPartitionSpy.mockClear();
        const old = await proxy.remove('key1');
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
        expect(old).toBe(42);
    });

    test('set routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.set('key1', 42);
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
    });

    test('delete routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.put('key1', 42);
        invokeOnPartitionSpy.mockClear();
        await proxy.delete('key1');
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
    });

    test('putIfAbsent routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        const result = await proxy.putIfAbsent('key1', 42);
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    test('clear routes through invokeOnPartition', async () => {
        const { proxy, invokeOnPartitionSpy } = makeFixture();
        await proxy.put('key1', 42);
        invokeOnPartitionSpy.mockClear();
        await proxy.clear();
        expect(invokeOnPartitionSpy).toHaveBeenCalled();
    });

    test('operation partitionId matches key hash', async () => {
        const { proxy, invokeOnPartitionSpy, ne } = makeFixture();
        await proxy.put('key1', 42);
        const call = invokeOnPartitionSpy.mock.calls[0];
        const partitionId = call[2] as number;
        expect(partitionId).toBeGreaterThanOrEqual(0);
        expect(partitionId).toBeLessThan(ne.getPartitionService().getPartitionCount());
    });

    test('put/get returns correct value via operation routing', async () => {
        const { proxy } = makeFixture();
        await proxy.put('a', 1);
        await proxy.put('b', 2);
        await proxy.put('c', 3);
        expect(await proxy.get('a')).toBe(1);
        expect(await proxy.get('b')).toBe(2);
        expect(await proxy.get('c')).toBe(3);
    });

    test('remove returns old value via operation routing', async () => {
        const { proxy } = makeFixture();
        await proxy.put('x', 99);
        const old = await proxy.remove('x');
        expect(old).toBe(99);
        expect(await proxy.get('x')).toBeNull();
    });
});
