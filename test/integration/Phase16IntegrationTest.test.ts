/**
 * Block 16.INT — Integration tests for multi-node resilience.
 *
 * Tests:
 *   - 2-node basic replication
 *   - 3-node write-behind resilience
 *   - Anti-entropy convergence
 *   - ChaosRunner harness
 *   - Partition container migration cleanup
 *   - MapReplicationOperation round-trip
 *   - WriteBehindStateHolder round-trip across nodes
 *   - Replica sync request/response cycle
 *   - Node restart with data preservation
 *   - Multi-map replication
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import { TestCluster } from '@zenystx/helios-core/test-support/TestCluster';
import { ChaosRunner } from '@zenystx/helios-core/test-support/ChaosRunner';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import { AntiEntropyTask } from '@zenystx/helios-core/internal/partition/impl/AntiEntropyTask';
import { PartitionReplicaSyncRequest, collectNamespaceStates } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncRequest';
import { PartitionReplicaSyncResponse } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse';
import { MapReplicationStateHolder } from '@zenystx/helios-core/map/impl/operation/MapReplicationStateHolder';
import { WriteBehindStateHolder } from '@zenystx/helios-core/map/impl/operation/WriteBehindStateHolder';
import { MapNearCacheStateHolder } from '@zenystx/helios-core/map/impl/operation/MapNearCacheStateHolder';
import { MapReplicationOperation } from '@zenystx/helios-core/map/impl/operation/MapReplicationOperation';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { ArrayWriteBehindQueue } from '@zenystx/helios-core/map/impl/mapstore/writebehind/ArrayWriteBehindQueue';
import { WriteBehindProcessor } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { MapStore } from '@zenystx/helios-core/map/MapStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeData(value: string): Data {
    const content = Buffer.from(value, 'utf8');
    const buf = Buffer.alloc(HeapData.DATA_OFFSET + content.length);
    buf.writeInt32BE(0, HeapData.PARTITION_HASH_OFFSET); // partition hash
    buf.writeInt32BE(-1, HeapData.TYPE_OFFSET); // type id
    content.copy(buf, HeapData.DATA_OFFSET);
    return new HeapData(buf);
}

function createMockMapStore<K, V>(): MapStore<K, V> & { stored: Map<K, V>; deleted: K[] } {
    const stored = new Map<K, V>();
    const deleted: K[] = [];
    return {
        stored,
        deleted,
        async load(key: K): Promise<V | null> {
            return stored.get(key) ?? null;
        },
        async loadAll(keys: K[]): Promise<Map<K, V>> {
            const result = new Map<K, V>();
            for (const k of keys) {
                const v = stored.get(k);
                if (v !== undefined) result.set(k, v);
            }
            return result;
        },
        async loadAllKeys(): Promise<MapKeyStream<K>> {
            return MapKeyStream.fromIterable([...stored.keys()]);
        },
        async store(key: K, value: V): Promise<void> {
            stored.set(key, value);
        },
        async storeAll(entries: Map<K, V>): Promise<void> {
            for (const [k, v] of entries) stored.set(k, v);
        },
        async delete(key: K): Promise<void> {
            stored.delete(key);
            deleted.push(key);
        },
        async deleteAll(keys: K[]): Promise<void> {
            for (const k of keys) {
                stored.delete(k);
                deleted.push(k);
            }
        },
    };
}

function createWriteBehindStore<K, V>(
    mockStore: MapStore<K, V>,
    writeDelayMs: number = 5000,
): WriteBehindStore<K, V> {
    const wrapper = new MapStoreWrapper<K, V>(mockStore);
    const queue = new ArrayWriteBehindQueue<K, V>();
    const processor = new WriteBehindProcessor<K, V>(wrapper, 25);
    return new WriteBehindStore<K, V>(wrapper, queue, processor, writeDelayMs);
}

// ── 2-Node Basic Replication ─────────────────────────────────────────────────

describe('2-node basic replication', () => {
    test('records replicated via MapReplicationStateHolder are readable on backup', () => {
        const primary = new PartitionContainer(0);
        const backup = new PartitionContainer(0);

        // Put entries on primary
        const store = primary.getRecordStore('test-map');
        for (let i = 0; i < 10; i++) {
            store.put(makeData(`key-${i}`), makeData(`value-${i}`), -1, -1);
        }
        expect(store.size()).toBe(10);

        // Capture state
        const stateHolder = new MapReplicationStateHolder();
        stateHolder.prepare(primary, 0, 0);

        // Apply to backup
        stateHolder.applyState(backup);

        // Verify backup has all entries
        const backupStore = backup.getRecordStore('test-map');
        expect(backupStore.size()).toBe(10);
        for (let i = 0; i < 10; i++) {
            const val = backupStore.get(makeData(`key-${i}`));
            expect(val).not.toBeNull();
        }
    });

    test('after primary loss, backup has all data (simulated promotion)', () => {
        const primary = new PartitionContainer(0);
        const backup = new PartitionContainer(0);

        // Write data on primary
        const store = primary.getRecordStore('my-map');
        for (let i = 0; i < 50; i++) {
            store.put(makeData(`k${i}`), makeData(`v${i}`), -1, -1);
        }

        // Replicate to backup
        const stateHolder = new MapReplicationStateHolder();
        stateHolder.prepare(primary, 0, 1);
        stateHolder.applyState(backup);

        // "Kill" primary — just discard it
        primary.cleanUpOnMigration();
        expect(primary.getRecordStore('my-map').size()).toBe(0);

        // Backup (now promoted) still has all data
        const promotedStore = backup.getRecordStore('my-map');
        expect(promotedStore.size()).toBe(50);
        expect(promotedStore.get(makeData('k0'))).not.toBeNull();
        expect(promotedStore.get(makeData('k49'))).not.toBeNull();
    });
});

// ── 3-Node Write-Behind Resilience ───────────────────────────────────────────

describe('3-node write-behind resilience', () => {
    test('write-behind entries survive node failure via WriteBehindStateHolder', async () => {
        const mockStore = createMockMapStore<string, string>();
        const primaryWBStore = createWriteBehindStore<string, string>(mockStore, 60_000); // 60s delay — won't flush

        // Add 100 entries to write-behind queue (not yet flushed)
        for (let i = 0; i < 100; i++) {
            await primaryWBStore.add(`key-${i}`, `value-${i}`, Date.now());
        }
        expect(primaryWBStore.hasPendingWrites()).toBe(true);
        expect(mockStore.stored.size).toBe(0); // not flushed yet

        // Capture write-behind state for replication
        const wbStateHolder = new WriteBehindStateHolder();
        const stores = new Map<string, WriteBehindStore<unknown, unknown>>();
        stores.set('wb-map', primaryWBStore as unknown as WriteBehindStore<unknown, unknown>);
        wbStateHolder.prepare(stores);

        expect(wbStateHolder.delayedEntries.get('wb-map')!.length).toBe(100);

        // Create backup write-behind store
        const backupMockStore = createMockMapStore<string, string>();
        const backupWBStore = createWriteBehindStore<string, string>(backupMockStore, 0); // 0 delay for immediate flush
        backupWBStore.reset(); // prepare for applyState

        // Apply state to backup
        const backupStores = new Map<string, WriteBehindStore<unknown, unknown>>();
        backupStores.set('wb-map', backupWBStore as unknown as WriteBehindStore<unknown, unknown>);
        wbStateHolder.applyState(backupStores);

        // "Kill" primary
        primaryWBStore.destroy();

        // Flush the backup's write-behind — should push all 100 entries to the mock store
        await backupWBStore.flush();

        expect(backupMockStore.stored.size).toBe(100);
        for (let i = 0; i < 100; i++) {
            expect(backupMockStore.stored.get(`key-${i}`)).toBe(`value-${i}`);
        }
    });

    test('combined MapReplication + WriteBehind state transfer preserves both records and queue', async () => {
        // Primary partition container with map records
        const primaryContainer = new PartitionContainer(5);
        const recordStore = primaryContainer.getRecordStore('combo-map');
        for (let i = 0; i < 20; i++) {
            recordStore.put(makeData(`rk-${i}`), makeData(`rv-${i}`), -1, -1);
        }

        // Primary write-behind with pending entries
        const mockStore = createMockMapStore<string, string>();
        const primaryWBStore = createWriteBehindStore<string, string>(mockStore, 60_000);
        for (let i = 0; i < 30; i++) {
            await primaryWBStore.add(`wk-${i}`, `wv-${i}`, Date.now());
        }

        // Capture both states
        const mapState = new MapReplicationStateHolder();
        mapState.prepare(primaryContainer, 5, 1);

        const wbState = new WriteBehindStateHolder();
        const wbStores = new Map<string, WriteBehindStore<unknown, unknown>>();
        wbStores.set('combo-map', primaryWBStore as unknown as WriteBehindStore<unknown, unknown>);
        wbState.prepare(wbStores);

        const ncState = new MapNearCacheStateHolder();

        const replicationOp = new MapReplicationOperation(5, 1, mapState, wbState, ncState);

        // Apply to backup
        const backupContainer = new PartitionContainer(5);
        const backupMockStore = createMockMapStore<string, string>();
        const backupWBStore = createWriteBehindStore<string, string>(backupMockStore, 0);
        backupWBStore.reset();

        const backupWBStores = new Map<string, WriteBehindStore<unknown, unknown>>();
        backupWBStores.set('combo-map', backupWBStore as unknown as WriteBehindStore<unknown, unknown>);

        replicationOp.run(backupContainer, backupWBStores, null);

        // Verify map records
        expect(backupContainer.getRecordStore('combo-map').size()).toBe(20);

        // Verify write-behind queue was restored
        expect(backupWBStore.hasPendingWrites()).toBe(true);

        // Flush and verify
        await backupWBStore.flush();
        expect(backupMockStore.stored.size).toBe(30);
    });
});

// ── Anti-Entropy ─────────────────────────────────────────────────────────────

describe('anti-entropy convergence', () => {
    test('anti-entropy detects version mismatch and triggers sync', () => {
        const partitionCount = 10;
        const primaryRM = new PartitionReplicaManager(partitionCount, 5);
        const backupRM = new PartitionReplicaManager(partitionCount, 5);

        // Simulate writes on primary — increment versions for partition 0
        primaryRM.incrementPartitionReplicaVersions(0, 1);
        primaryRM.incrementPartitionReplicaVersions(0, 1);
        primaryRM.incrementPartitionReplicaVersions(0, 1);

        // Backup still at version 0 — stale
        const antiEntropy = new AntiEntropyTask(primaryRM);
        const ops = antiEntropy.generateOps([0], 1);

        expect(ops).toHaveLength(1);
        expect(ops[0].partitionId).toBe(0);
        expect(ops[0].targetReplicaIndex).toBe(1);

        // Execute on backup — should detect mismatch
        const result = ops[0].execute(backupRM);
        expect(result.syncTriggered).toBe(true);

        // After sync triggered, backup should be marked dirty
        expect(backupRM.isPartitionReplicaVersionDirty(0)).toBe(true);
    });

    test('anti-entropy no-op when versions match', () => {
        const partitionCount = 5;
        const primaryRM = new PartitionReplicaManager(partitionCount, 5);
        const backupRM = new PartitionReplicaManager(partitionCount, 5);

        // No writes — versions should match (both 0)
        const antiEntropy = new AntiEntropyTask(primaryRM);
        const ops = antiEntropy.generateOps([0, 1, 2], 1);

        expect(ops).toHaveLength(3);
        for (const op of ops) {
            const result = op.execute(backupRM);
            expect(result.syncTriggered).toBe(false);
        }
    });

    test('full anti-entropy → sync request → response → apply cycle', () => {
        const partitionCount = 10;
        const primaryRM = new PartitionReplicaManager(partitionCount, 5);
        const backupRM = new PartitionReplicaManager(partitionCount, 5);

        // Put data on primary container
        const primaryContainer = new PartitionContainer(3);
        const store = primaryContainer.getRecordStore('ae-map');
        for (let i = 0; i < 5; i++) {
            store.put(makeData(`ae-k${i}`), makeData(`ae-v${i}`), -1, -1);
        }

        // Increment primary versions
        primaryRM.incrementPartitionReplicaVersions(3, 1);
        primaryRM.incrementPartitionReplicaVersions(3, 1);

        // Anti-entropy detects mismatch
        const antiEntropy = new AntiEntropyTask(primaryRM);
        const [aeOp] = antiEntropy.generateOps([3], 1);
        const aeResult = aeOp.execute(backupRM);
        expect(aeResult.syncTriggered).toBe(true);

        // Sync request on backup side
        const syncReq = new PartitionReplicaSyncRequest(3, 1);
        expect(syncReq.canExecute(backupRM)).toBe(true);
        const reqResult = syncReq.execute(backupRM, primaryContainer);
        expect(reqResult.namespaces).toContain('ae-map');

        // Primary collects namespace states
        const nsStates = collectNamespaceStates(primaryContainer);
        expect(nsStates).toHaveLength(1);
        expect(nsStates[0].entries).toHaveLength(5);

        // Primary builds sync response
        const primaryVersions = primaryRM.getPartitionReplicaVersions(3);
        const syncResp = new PartitionReplicaSyncResponse(3, 1, nsStates, primaryVersions);

        // Apply on backup
        const backupContainer = new PartitionContainer(3);
        syncResp.apply(backupContainer, backupRM);

        // Verify backup has the data
        const backupStore = backupContainer.getRecordStore('ae-map');
        expect(backupStore.size()).toBe(5);

        // Verify versions finalized
        backupRM.releaseReplicaSyncPermits(1); // release the permit from execute
        expect(backupRM.availableReplicaSyncPermits()).toBe(5);
    });

    test('anti-entropy with multiple partitions and backup count 2', () => {
        const partitionCount = 10;
        const primaryRM = new PartitionReplicaManager(partitionCount, 5);

        // Increment various partitions
        primaryRM.incrementPartitionReplicaVersions(0, 2);
        primaryRM.incrementPartitionReplicaVersions(3, 2);
        primaryRM.incrementPartitionReplicaVersions(7, 2);

        const antiEntropy = new AntiEntropyTask(primaryRM);
        const ops = antiEntropy.generateOps([0, 3, 7], 2);

        // 3 partitions × 2 backup indices = 6 ops
        expect(ops).toHaveLength(6);

        // Verify correct replica indices
        const indices = ops.map(o => ({ pid: o.partitionId, ri: o.targetReplicaIndex }));
        expect(indices).toContainEqual({ pid: 0, ri: 1 });
        expect(indices).toContainEqual({ pid: 0, ri: 2 });
        expect(indices).toContainEqual({ pid: 3, ri: 1 });
        expect(indices).toContainEqual({ pid: 3, ri: 2 });
        expect(indices).toContainEqual({ pid: 7, ri: 1 });
        expect(indices).toContainEqual({ pid: 7, ri: 2 });
    });
});

// ── Replica Sync ─────────────────────────────────────────────────────────────

describe('replica sync', () => {
    test('sync request respects permit limit', () => {
        const rm = new PartitionReplicaManager(10, 2); // only 2 permits

        const req1 = new PartitionReplicaSyncRequest(0, 1);
        const req2 = new PartitionReplicaSyncRequest(1, 1);
        const req3 = new PartitionReplicaSyncRequest(2, 1);

        const container = new PartitionContainer(0);

        expect(req1.canExecute(rm)).toBe(true);
        req1.execute(rm, container);

        expect(req2.canExecute(rm)).toBe(true);
        req2.execute(rm, container);

        // Third should fail — no permits left
        expect(req3.canExecute(rm)).toBe(false);

        // Release one permit
        rm.releaseReplicaSyncPermits(1);
        expect(req3.canExecute(rm)).toBe(true);
    });

    test('sync response applies multi-namespace state correctly', () => {
        const primaryContainer = new PartitionContainer(0);

        // Create two maps in the partition
        const store1 = primaryContainer.getRecordStore('map-a');
        store1.put(makeData('a1'), makeData('va1'), -1, -1);
        store1.put(makeData('a2'), makeData('va2'), -1, -1);

        const store2 = primaryContainer.getRecordStore('map-b');
        store2.put(makeData('b1'), makeData('vb1'), -1, -1);

        const nsStates = collectNamespaceStates(primaryContainer);
        expect(nsStates).toHaveLength(2);

        const rm = new PartitionReplicaManager(10, 5);
        rm.incrementPartitionReplicaVersions(0, 1);
        const versions = rm.getPartitionReplicaVersions(0);

        const response = new PartitionReplicaSyncResponse(0, 1, nsStates, versions);

        const backupContainer = new PartitionContainer(0);
        response.apply(backupContainer, rm);

        expect(backupContainer.getRecordStore('map-a').size()).toBe(2);
        expect(backupContainer.getRecordStore('map-b').size()).toBe(1);
    });
});

// ── Partition Container Migration ────────────────────────────────────────────

describe('partition container migration', () => {
    test('cleanUpOnMigration clears all record stores', () => {
        const container = new PartitionContainer(0);
        container.getRecordStore('map1').put(makeData('k1'), makeData('v1'), -1, -1);
        container.getRecordStore('map2').put(makeData('k2'), makeData('v2'), -1, -1);

        expect(container.getAllNamespaces()).toHaveLength(2);

        container.cleanUpOnMigration();

        expect(container.getAllNamespaces()).toHaveLength(0);
    });

    test('replication then cleanup then re-replication restores state', () => {
        const primary = new PartitionContainer(0);
        primary.getRecordStore('m').put(makeData('x'), makeData('y'), -1, -1);

        const state1 = new MapReplicationStateHolder();
        state1.prepare(primary, 0, 0);

        const backup = new PartitionContainer(0);
        state1.applyState(backup);
        expect(backup.getRecordStore('m').size()).toBe(1);

        // Cleanup (as if migration happened)
        backup.cleanUpOnMigration();
        expect(backup.getAllNamespaces()).toHaveLength(0);

        // Re-replicate
        const state2 = new MapReplicationStateHolder();
        state2.prepare(primary, 0, 0);
        state2.applyState(backup);
        expect(backup.getRecordStore('m').size()).toBe(1);
    });
});

// ── Multi-Map Replication ────────────────────────────────────────────────────

describe('multi-map replication', () => {
    test('replication preserves data across multiple maps in one partition', () => {
        const primary = new PartitionContainer(7);

        // Create 5 different maps in the same partition
        for (let m = 0; m < 5; m++) {
            const store = primary.getRecordStore(`map-${m}`);
            for (let i = 0; i < (m + 1) * 3; i++) {
                store.put(makeData(`m${m}-k${i}`), makeData(`m${m}-v${i}`), -1, -1);
            }
        }

        expect(primary.getAllNamespaces()).toHaveLength(5);

        // Replicate
        const stateHolder = new MapReplicationStateHolder();
        stateHolder.prepare(primary, 7, 0);
        expect(stateHolder.mapData.size).toBe(5);

        const backup = new PartitionContainer(7);
        stateHolder.applyState(backup);

        // Verify each map has correct entry count: 3, 6, 9, 12, 15
        for (let m = 0; m < 5; m++) {
            expect(backup.getRecordStore(`map-${m}`).size()).toBe((m + 1) * 3);
        }
    });
});

// ── ChaosRunner ──────────────────────────────────────────────────────────────

describe('ChaosRunner', () => {
    let cluster: TestCluster;

    afterEach(async () => {
        if (cluster) await cluster.shutdown();
    });

    test('chaos runner kills nodes while maintaining minimum survivors', async () => {
        cluster = new TestCluster({ clusterName: 'chaos-test', partitionCount: 10 });

        await cluster.startNode();
        await cluster.startNode();
        await cluster.startNode();
        await cluster.startNode();
        await cluster.waitForStable();

        expect(cluster.getNodes()).toHaveLength(4);

        const chaos = new ChaosRunner(cluster, {
            minIntervalMs: 10,
            maxIntervalMs: 30,
            maxActions: 2,
            minSurvivors: 2,
            actions: ['kill'],
        });

        const result = await chaos.run();

        // Should have performed up to 2 kills
        expect(result.actions.length).toBeGreaterThanOrEqual(1);
        expect(result.actions.length).toBeLessThanOrEqual(2);

        // At least minSurvivors nodes remain
        expect(cluster.getNodes().length).toBeGreaterThanOrEqual(2);
    });

    test('chaos runner respects stop signal', async () => {
        cluster = new TestCluster({ clusterName: 'chaos-stop', partitionCount: 10 });

        await cluster.startNode();
        await cluster.startNode();
        await cluster.startNode();
        await cluster.waitForStable();

        const chaos = new ChaosRunner(cluster, {
            minIntervalMs: 50,
            maxIntervalMs: 100,
            maxActions: 10,
            minSurvivors: 1,
            actions: ['kill'],
        });

        // Stop after a short delay
        setTimeout(() => chaos.stop(), 30);

        const result = await chaos.run();
        expect(result.stopped).toBe(true);
        // Should not have completed all 10 actions
        expect(result.actions.length).toBeLessThan(10);
    });
});
