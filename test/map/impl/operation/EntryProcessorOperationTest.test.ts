/**
 * Unit tests for EntryOperation and PartitionWideEntryOperation.
 * Validates entry processor execution, mutation, and deletion semantics.
 * Ported from com.hazelcast.map (EntryProcessorTest — single-node subset, Block 3.2b).
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { EntryProcessor, MapEntry } from '@zenystx/helios-core/map/EntryProcessor';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import { EntryOperation } from '@zenystx/helios-core/map/impl/operation/EntryOperation';
import { PartitionWideEntryOperation } from '@zenystx/helios-core/map/impl/operation/PartitionWideEntryOperation';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { beforeEach, describe, expect, test } from 'bun:test';

describe('Entry Processor Operations', () => {
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

    test('EntryOperation: reads value and returns processor result', async () => {
        store.put(d('k'), d(42), -1, -1);
        const processor: EntryProcessor<string> = {
            process(entry: MapEntry): string | null {
                return entry.exists() ? 'found' : 'not-found';
            },
            getBackupProcessor(): EntryProcessor<string> | null { return null; },
        };
        const result = await invoke<string | null>(new EntryOperation(MAP_NAME, d('k'), processor));
        expect(result).toBe('found');
    });

    test('EntryOperation: updates value via entry.setValue', async () => {
        store.put(d('k'), d(1), -1, -1);
        const processor: EntryProcessor<null> = {
            process(entry: MapEntry): null {
                const val = entry.getValue();
                if (val !== null) entry.setValue(d(999));
                return null;
            },
            getBackupProcessor(): EntryProcessor<null> | null { return null; },
        };

        // Need d() to be accessible in processor — use a closure over nodeEngine
        const dFn = (x: unknown): Data => nodeEngine.toData(x)!;
        const processor2: EntryProcessor<null> = {
            process(entry: MapEntry): null {
                if (entry.exists()) entry.setValue(dFn(999));
                return null;
            },
            getBackupProcessor(): EntryProcessor<null> | null { return null; },
        };
        await invoke<null>(new EntryOperation(MAP_NAME, d('k'), processor2));
        expect(o(store.get(d('k')))).toBe(999);
    });

    test('EntryOperation: delete via setValue(null)', async () => {
        store.put(d('k'), d('val'), -1, -1);
        const processor: EntryProcessor<null> = {
            process(entry: MapEntry): null {
                entry.setValue(null);
                return null;
            },
            getBackupProcessor(): EntryProcessor<null> | null { return null; },
        };
        await invoke<null>(new EntryOperation(MAP_NAME, d('k'), processor));
        expect(store.containsKey(d('k'))).toBe(false);
    });

    test('PartitionWideEntryOperation: visits all entries', async () => {
        store.put(d('a'), d(1), -1, -1);
        store.put(d('b'), d(2), -1, -1);
        store.put(d('c'), d(3), -1, -1);
        let visitCount = 0;
        const processor: EntryProcessor<null> = {
            process(_entry: MapEntry): null {
                visitCount++;
                return null;
            },
            getBackupProcessor(): EntryProcessor<null> | null { return null; },
        };
        await invoke<Map<Data, null>>(new PartitionWideEntryOperation(MAP_NAME, processor));
        expect(visitCount).toBe(3);
    });

    test('PartitionWideEntryOperation: updates all entries via setValue', async () => {
        store.put(d('a'), d(10), -1, -1);
        store.put(d('b'), d(20), -1, -1);
        const dFn = (x: unknown): Data => nodeEngine.toData(x)!;
        const oFn = (data: Data | null): unknown => nodeEngine.toObject(data);
        const processor: EntryProcessor<null> = {
            process(entry: MapEntry): null {
                const val = entry.getValue();
                if (val !== null) {
                    const num = oFn(val) as number;
                    entry.setValue(dFn(num * 2));
                }
                return null;
            },
            getBackupProcessor(): EntryProcessor<null> | null { return null; },
        };
        await invoke<Map<Data, null>>(new PartitionWideEntryOperation(MAP_NAME, processor));
        expect(o(store.get(d('a')))).toBe(20);
        expect(o(store.get(d('b')))).toBe(40);
    });
});
