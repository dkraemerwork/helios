/**
 * Tests for Block 16.E3 — Replica sync (full state transfer with per-namespace chunking).
 */
import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { PartitionReplicaSyncRequest, collectNamespaceStates } from '@helios/internal/partition/operation/PartitionReplicaSyncRequest';
import { PartitionReplicaSyncResponse } from '@helios/internal/partition/operation/PartitionReplicaSyncResponse';
import type { ReplicationNamespaceState } from '@helios/internal/partition/operation/PartitionReplicaSyncResponse';
import { PartitionReplicaManager } from '@helios/internal/partition/impl/PartitionReplicaManager';
import { PartitionContainer } from '@helios/internal/partition/impl/PartitionContainer';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';

/** Create a valid HeapData with 8+ bytes (4 partition hash + 4 type + payload). */
function makeData(id: number): HeapData {
    const buf = Buffer.alloc(12);
    buf.writeInt32BE(0, 0);     // partition hash
    buf.writeInt32BE(-1, 4);    // type id
    buf.writeInt32BE(id, 8);    // payload
    return new HeapData(buf);
}

describe('PartitionReplicaSyncRequest', () => {
    let replicaManager: PartitionReplicaManager;

    beforeEach(() => {
        replicaManager = new PartitionReplicaManager(10, 3);
    });

    test('creates request with correct partitionId and replicaIndex', () => {
        const req = new PartitionReplicaSyncRequest(5, 1);
        expect(req.partitionId).toBe(5);
        expect(req.replicaIndex).toBe(1);
    });

    test('canExecute returns true when permits available', () => {
        const req = new PartitionReplicaSyncRequest(0, 1);
        expect(req.canExecute(replicaManager)).toBe(true);
    });

    test('canExecute returns false when no permits available', () => {
        replicaManager.tryAcquireReplicaSyncPermits(3);
        const req = new PartitionReplicaSyncRequest(0, 1);
        expect(req.canExecute(replicaManager)).toBe(false);
    });

    test('execute acquires permit and returns container namespaces', () => {
        const container = new PartitionContainer(2);
        container.getRecordStore('map1');
        container.getRecordStore('map2');

        const req = new PartitionReplicaSyncRequest(2, 1);
        const result = req.execute(replicaManager, container);

        expect(result.namespaces).toEqual(['map1', 'map2']);
        expect(result.partitionId).toBe(2);
        expect(result.replicaIndex).toBe(1);
        expect(replicaManager.availableReplicaSyncPermits()).toBe(2);
    });

    test('execute returns empty namespaces for empty container', () => {
        const container = new PartitionContainer(0);
        const req = new PartitionReplicaSyncRequest(0, 1);
        const result = req.execute(replicaManager, container);
        expect(result.namespaces).toEqual([]);
        expect(replicaManager.availableReplicaSyncPermits()).toBe(2);
    });

    test('execute throws when no permits', () => {
        replicaManager.tryAcquireReplicaSyncPermits(3);
        const container = new PartitionContainer(0);
        const req = new PartitionReplicaSyncRequest(0, 1);
        expect(() => req.execute(replicaManager, container)).toThrow('No sync permits available');
    });
});

describe('PartitionReplicaSyncResponse', () => {
    let replicaManager: PartitionReplicaManager;

    beforeEach(() => {
        replicaManager = new PartitionReplicaManager(10, 3);
    });

    test('creates response with partitionId, replicaIndex, namespace state', () => {
        const state: ReplicationNamespaceState = {
            namespace: 'map1',
            entries: [],
            estimatedSizeBytes: 0,
        };
        const resp = new PartitionReplicaSyncResponse(3, 1, [state], [0n, 5n, 0n, 0n, 0n, 0n, 0n]);
        expect(resp.partitionId).toBe(3);
        expect(resp.replicaIndex).toBe(1);
        expect(resp.namespaceStates).toHaveLength(1);
        expect(resp.versions[1]).toBe(5n);
    });

    test('apply writes entries into target container for each namespace', () => {
        const container = new PartitionContainer(2);
        const key1 = makeData(1);
        const val1 = makeData(10);
        const key2 = makeData(2);
        const val2 = makeData(20);

        const state: ReplicationNamespaceState = {
            namespace: 'myMap',
            entries: [[key1, val1], [key2, val2]],
            estimatedSizeBytes: 100,
        };

        const resp = new PartitionReplicaSyncResponse(2, 1, [state], [0n, 3n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        const store = container.getRecordStore('myMap');
        expect(store.get(key1)?.equals(val1)).toBe(true);
        expect(store.get(key2)?.equals(val2)).toBe(true);
    });

    test('apply does not clear unmentioned namespaces', () => {
        const container = new PartitionContainer(2);
        const oldKey = makeData(99);
        const oldVal = makeData(99);
        container.getRecordStore('myMap').put(oldKey, oldVal, -1, -1);

        const resp = new PartitionReplicaSyncResponse(2, 1, [], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        expect(container.getRecordStore('myMap').size()).toBe(1);
    });

    test('apply finalizes replica versions', () => {
        const container = new PartitionContainer(4);
        const versions = [0n, 7n, 0n, 0n, 0n, 0n, 0n];
        const resp = new PartitionReplicaSyncResponse(4, 1, [], versions);
        resp.apply(container, replicaManager);

        const updated = replicaManager.getPartitionReplicaVersions(4);
        expect(updated[1]).toBe(7n);
    });

    test('apply releases sync permit', () => {
        replicaManager.tryAcquireReplicaSyncPermits(1);
        expect(replicaManager.availableReplicaSyncPermits()).toBe(2);

        const container = new PartitionContainer(0);
        const resp = new PartitionReplicaSyncResponse(0, 1, [], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        expect(replicaManager.availableReplicaSyncPermits()).toBe(3);
    });

    test('apply handles multiple namespaces (per-namespace chunking)', () => {
        const container = new PartitionContainer(1);
        const k1 = makeData(1);
        const v1 = makeData(10);
        const k2 = makeData(2);
        const v2 = makeData(20);

        const states: ReplicationNamespaceState[] = [
            { namespace: 'mapA', entries: [[k1, v1]], estimatedSizeBytes: 50 },
            { namespace: 'mapB', entries: [[k2, v2]], estimatedSizeBytes: 50 },
        ];

        const resp = new PartitionReplicaSyncResponse(1, 1, states, [0n, 2n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        expect(container.getRecordStore('mapA').size()).toBe(1);
        expect(container.getRecordStore('mapB').size()).toBe(1);
    });

    test('apply clears store before writing entries for a namespace', () => {
        const container = new PartitionContainer(1);
        const oldKey = makeData(50);
        const oldVal = makeData(50);
        container.getRecordStore('myMap').put(oldKey, oldVal, -1, -1);
        expect(container.getRecordStore('myMap').size()).toBe(1);

        const newKey = makeData(1);
        const newVal = makeData(1);
        const states: ReplicationNamespaceState[] = [
            { namespace: 'myMap', entries: [[newKey, newVal]], estimatedSizeBytes: 10 },
        ];

        const resp = new PartitionReplicaSyncResponse(1, 1, states, [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        expect(container.getRecordStore('myMap').size()).toBe(1);
        expect(container.getRecordStore('myMap').get(oldKey)).toBeNull();
        expect(container.getRecordStore('myMap').get(newKey)?.equals(newVal)).toBe(true);
    });
});

describe('PartitionReplicaSyncResponse — OOM prevention', () => {
    let replicaManager: PartitionReplicaManager;

    beforeEach(() => {
        replicaManager = new PartitionReplicaManager(10, 3);
    });

    test('logs warning when namespace exceeds maxSingleSyncSizeBytes', () => {
        const container = new PartitionContainer(0);
        const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

        const largeState: ReplicationNamespaceState = {
            namespace: 'bigMap',
            entries: [],
            estimatedSizeBytes: 60_000_000,
        };

        const resp = new PartitionReplicaSyncResponse(0, 1, [largeState], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager, { maxSingleSyncSizeBytes: 50_000_000 });

        expect(warnSpy).toHaveBeenCalled();
        const warnMsg = warnSpy.mock.calls[0]![0] as string;
        expect(warnMsg).toContain('bigMap');
        expect(warnMsg).toContain('60000000');

        warnSpy.mockRestore();
    });

    test('does not warn when namespace is within size limit', () => {
        const container = new PartitionContainer(0);
        const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

        const state: ReplicationNamespaceState = {
            namespace: 'smallMap',
            entries: [],
            estimatedSizeBytes: 1000,
        };

        const resp = new PartitionReplicaSyncResponse(0, 1, [state], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test('maxSingleSyncSizeBytes defaults to 50MB', () => {
        const container = new PartitionContainer(0);
        const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

        const state: ReplicationNamespaceState = {
            namespace: 'medMap',
            entries: [],
            estimatedSizeBytes: 49_999_999,
        };
        const resp = new PartitionReplicaSyncResponse(0, 1, [state], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp.apply(container, replicaManager);
        expect(warnSpy).not.toHaveBeenCalled();

        const state2: ReplicationNamespaceState = {
            namespace: 'bigMap',
            entries: [],
            estimatedSizeBytes: 50_000_001,
        };
        const resp2 = new PartitionReplicaSyncResponse(0, 1, [state2], [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        resp2.apply(container, replicaManager);
        expect(warnSpy).toHaveBeenCalled();

        warnSpy.mockRestore();
    });
});

describe('PartitionReplicaSyncRequest — bounded parallelism', () => {
    test('multiple requests respect permit limit', () => {
        const mgr = new PartitionReplicaManager(10, 2);

        const c1 = new PartitionContainer(0);
        const c2 = new PartitionContainer(1);
        const c3 = new PartitionContainer(2);

        const r1 = new PartitionReplicaSyncRequest(0, 1);
        const r2 = new PartitionReplicaSyncRequest(1, 1);
        const r3 = new PartitionReplicaSyncRequest(2, 1);

        expect(r1.canExecute(mgr)).toBe(true);
        r1.execute(mgr, c1);
        expect(mgr.availableReplicaSyncPermits()).toBe(1);

        expect(r2.canExecute(mgr)).toBe(true);
        r2.execute(mgr, c2);
        expect(mgr.availableReplicaSyncPermits()).toBe(0);

        expect(r3.canExecute(mgr)).toBe(false);
        expect(() => r3.execute(mgr, c3)).toThrow('No sync permits available');
    });
});

describe('collectNamespaceStates (on primary)', () => {
    test('collects entries from all namespaces in container', () => {
        const container = new PartitionContainer(0);
        const k = makeData(1);
        const v = makeData(10);
        container.getRecordStore('testMap').put(k, v, -1, -1);

        const states = collectNamespaceStates(container);
        expect(states).toHaveLength(1);
        expect(states[0].namespace).toBe('testMap');
        expect(states[0].entries).toHaveLength(1);
    });

    test('returns empty array for empty container', () => {
        const container = new PartitionContainer(0);
        const states = collectNamespaceStates(container);
        expect(states).toEqual([]);
    });

    test('collects from multiple namespaces independently', () => {
        const container = new PartitionContainer(0);
        const k1 = makeData(1);
        const v1 = makeData(10);
        container.getRecordStore('map1').put(k1, v1, -1, -1);

        const k2 = makeData(2);
        const v2 = makeData(20);
        const k3 = makeData(3);
        const v3 = makeData(30);
        container.getRecordStore('map2').put(k2, v2, -1, -1);
        container.getRecordStore('map2').put(k3, v3, -1, -1);

        const states = collectNamespaceStates(container);
        expect(states).toHaveLength(2);

        const map1State = states.find((s: ReplicationNamespaceState) => s.namespace === 'map1')!;
        const map2State = states.find((s: ReplicationNamespaceState) => s.namespace === 'map2')!;
        expect(map1State.entries).toHaveLength(1);
        expect(map2State.entries).toHaveLength(2);
    });

    test('estimated size reflects entry byte sizes', () => {
        const container = new PartitionContainer(0);
        const k = makeData(1);  // 12 bytes
        const v = makeData(10); // 12 bytes
        container.getRecordStore('sizedMap').put(k, v, -1, -1);

        const states = collectNamespaceStates(container);
        expect(states[0].estimatedSizeBytes).toBe(24); // 12 + 12
    });
});
