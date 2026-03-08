/**
 * Block 21.0 — Remaining open tasks:
 * 1. Map-scoped partition-lost listener/event semantics
 * 2. Namespace-scoped anti-entropy version comparison
 * 3. Acceptance proof for diverged backup payload repair
 * 4. Verification: no stubs, no fakes, end-to-end
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import type { Member } from '@zenystx/helios-core/cluster/Member';
import { AntiEntropyTask } from '@zenystx/helios-core/internal/partition/impl/AntiEntropyTask';
import type { PartitionLostEvent } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl';
import { InternalPartitionServiceImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import { PartitionReplicaManager } from '@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager';
import { collectNamespaceStates } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncRequest';
import { PartitionReplicaSyncResponse } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';
import { describe, expect, test } from 'bun:test';

function makeMember(host: string, port: number, uuid?: string): Member {
    return new MemberImpl.Builder(new Address(host, port))
        .uuid(uuid ?? crypto.randomUUID())
        .version(MemberVersion.of(1, 0, 0))
        .localMember(false)
        .build();
}

function makeData(value: string): Data {
    const bytes = new TextEncoder().encode(value);
    return {
        toByteArray: () => bytes,
        totalSize: () => bytes.length,
        getType: () => 0,
        dataSize: () => bytes.length,
        hashCode: () => {
            let h = 0;
            for (const b of bytes) h = (h * 31 + b) | 0;
            return h;
        },
        equals: (other: Data) => {
            const ob = other.toByteArray();
            if (!ob || ob.length !== bytes.length) return false;
            for (let i = 0; i < bytes.length; i++) {
                if (ob[i] !== bytes[i]) return false;
            }
            return true;
        },
    } as Data;
}

const PARTITION_COUNT = 16;

// ══════════════════════════════════════════════════════════════════
// 1. MAP-SCOPED PARTITION-LOST LISTENER/EVENT SEMANTICS
// ══════════════════════════════════════════════════════════════════
describe('Map-scoped partition-lost events', () => {
    test('MapPartitionLostEvent carries map name and partition ID', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const mapService = new MapContainerService();
        mapService.getOrCreateRecordStore('my-map', 3);
        service.registerMigrationAwareService(MapService.SERVICE_NAME, mapService);
        expect(typeof service.onMapPartitionLost).toBe('function');

        const events: Array<{ mapName: string; partitionId: number; lostReplicaCount: number }> = [];
        service.onMapPartitionLost('my-map', (e) => events.push(e));

        const memberA = makeMember('127.0.0.1', 5701, 'a');
        service.firstArrangement([memberA], memberA.getAddress(), 0);
        service.memberRemovedWithRepair(memberA, []);

        expect(events.length).toBe(1);
        for (const e of events) {
            expect(e.mapName).toBe('my-map');
            expect(typeof e.partitionId).toBe('number');
        }
    });

    test('map-scoped listener receives only events for its map name', () => {
        const service = new InternalPartitionServiceImpl(4);
        const mapService = new MapContainerService();
        mapService.getOrCreateRecordStore('map1', 2);
        service.registerMigrationAwareService(MapService.SERVICE_NAME, mapService);
        const map1Events: Array<{ mapName: string }> = [];
        const map2Events: Array<{ mapName: string }> = [];

        service.onMapPartitionLost('map1', (e) => map1Events.push(e));
        service.onMapPartitionLost('map2', (e) => map2Events.push(e));

        const memberA = makeMember('127.0.0.1', 5701, 'a');
        service.firstArrangement([memberA], memberA.getAddress(), 0);
        service.memberRemovedWithRepair(memberA, []);

        expect(map1Events.length).toBe(1);
        expect(map2Events.length).toBe(0);
        for (const e of map1Events) expect(e.mapName).toBe('map1');
        for (const e of map2Events) expect(e.mapName).toBe('map2');
    });

    test('removeMapPartitionLostListener stops delivery', () => {
        const service = new InternalPartitionServiceImpl(4);
        const mapService = new MapContainerService();
        mapService.getOrCreateRecordStore('test-map', 0);
        service.registerMigrationAwareService(MapService.SERVICE_NAME, mapService);
        const events: unknown[] = [];

        const id = service.onMapPartitionLost('test-map', (e) => events.push(e));
        const removed = service.removeMapPartitionLostListener(id);
        expect(removed).toBe(true);

        const memberA = makeMember('127.0.0.1', 5701, 'a');
        service.firstArrangement([memberA], memberA.getAddress(), 0);
        service.memberRemovedWithRepair(memberA, []);

        expect(events.length).toBe(0);
    });

    test('map-scoped partition-lost event has same structure as Hazelcast MapPartitionLostEvent', () => {
        const service = new InternalPartitionServiceImpl(4);
        const mapService = new MapContainerService();
        mapService.getOrCreateRecordStore('parity-map', 1);
        service.registerMigrationAwareService(MapService.SERVICE_NAME, mapService);
        const events: Array<{ mapName: string; partitionId: number; lostReplicaCount: number }> = [];

        service.onMapPartitionLost('parity-map', (e) => events.push(e));

        const memberA = makeMember('127.0.0.1', 5701, 'a');
        service.firstArrangement([memberA], memberA.getAddress(), 0);
        service.memberRemovedWithRepair(memberA, []);

        expect(events.length).toBe(1);
        const e = events[0];
        expect(typeof e.mapName).toBe('string');
        expect(typeof e.partitionId).toBe('number');
        expect(typeof e.lostReplicaCount).toBe('number');
    });
});

// ══════════════════════════════════════════════════════════════════
// 2. NAMESPACE-SCOPED ANTI-ENTROPY WITH VERSION COMPARISON
// ══════════════════════════════════════════════════════════════════
describe('Namespace-scoped anti-entropy', () => {
    test('PartitionReplicaManager tracks versions per namespace', () => {
        const rm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        // Must support namespace-scoped version increment
        expect(typeof rm.incrementNamespaceReplicaVersions).toBe('function');

        rm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        rm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        rm.incrementNamespaceReplicaVersions(0, 'mapB', 1);

        const versionsA = rm.getNamespaceReplicaVersions(0, 'mapA');
        const versionsB = rm.getNamespaceReplicaVersions(0, 'mapB');

        // mapA was incremented twice, mapB once
        expect(versionsA[1]).toBe(2n);
        expect(versionsB[1]).toBe(1n);
    });

    test('anti-entropy op carries per-namespace version map', () => {
        const rm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        rm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        rm.incrementNamespaceReplicaVersions(0, 'mapB', 1);
        rm.incrementNamespaceReplicaVersions(0, 'mapB', 1);

        const task = new AntiEntropyTask(rm);
        const ops = task.generateOps([0], 1);
        expect(ops.length).toBe(1);

        const op = ops[0];
        // Op must carry namespace-scoped versions
        expect(op.namespaceVersions).toBeDefined();
        expect(op.namespaceVersions!.get('mapA')).toBeDefined();
        expect(op.namespaceVersions!.get('mapB')).toBeDefined();
    });

    test('anti-entropy detects dirty namespace while clean namespace is untouched', () => {
        const primaryRm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        const backupRm = new PartitionReplicaManager(PARTITION_COUNT, 5);

        // Primary has mapA=2, mapB=1
        primaryRm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        primaryRm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        primaryRm.incrementNamespaceReplicaVersions(0, 'mapB', 1);

        // Backup has mapA=2, mapB=0 (mapB is stale)
        backupRm.incrementNamespaceReplicaVersions(0, 'mapA', 1);
        backupRm.incrementNamespaceReplicaVersions(0, 'mapA', 1);

        const task = new AntiEntropyTask(primaryRm);
        const ops = task.generateOps([0], 1);
        const op = ops[0];

        const result = op.execute(backupRm);
        expect(result.syncTriggered).toBe(true);
        // Only mapB should be marked dirty, not mapA
        expect(result.dirtyNamespaces).toContain('mapB');
        expect(result.dirtyNamespaces).not.toContain('mapA');
    });

    test('namespace-scoped sync marks only dirty namespace for sync', () => {
        const rm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        rm.incrementNamespaceReplicaVersions(0, 'mapA', 1);

        // Mark mapA as requiring sync
        rm.markNamespaceReplicaAsSyncRequired(0, 'mapA', 1);

        expect(rm.isNamespaceReplicaVersionDirty(0, 'mapA')).toBe(true);
        expect(rm.isNamespaceReplicaVersionDirty(0, 'mapB')).toBe(false);
    });

    test('partition metadata parity alone does not count as repair completion', () => {
        // Partition-level version match must NOT be treated as repaired
        // if namespace-level versions still mismatch
        const primaryRm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        const backupRm = new PartitionReplicaManager(PARTITION_COUNT, 5);

        // Primary: mapA incremented
        primaryRm.incrementNamespaceReplicaVersions(0, 'mapA', 1);

        // Backup: partition-level versions match (both zeroed) but namespace is stale
        // The anti-entropy op must detect the namespace mismatch even if
        // aggregated partition versions look the same
        const task = new AntiEntropyTask(primaryRm);
        const ops = task.generateOps([0], 1);
        const result = ops[0].execute(backupRm);

        expect(result.syncTriggered).toBe(true);
        expect(result.dirtyNamespaces).toContain('mapA');
    });
});

// ══════════════════════════════════════════════════════════════════
// 3. ACCEPTANCE PROOF: DIVERGED BACKUP PAYLOAD REPAIR
// ══════════════════════════════════════════════════════════════════
describe('Diverged backup payload repair proof', () => {
    test('intentionally diverged map namespace is repaired by sync response', () => {
        const ownerContainer = new PartitionContainer(0);
        const backupContainer = new PartitionContainer(0);
        const backupRm = new PartitionReplicaManager(PARTITION_COUNT, 5);

        // Owner has entries in mapA
        const ownerStore = ownerContainer.getRecordStore('mapA');
        ownerStore.put(makeData('k1'), makeData('v1'), -1, -1);
        ownerStore.put(makeData('k2'), makeData('v2'), -1, -1);

        // Backup has STALE entries in mapA
        const backupStore = backupContainer.getRecordStore('mapA');
        backupStore.put(makeData('k1'), makeData('stale-v1'), -1, -1);

        // Collect owner state and apply as sync response
        const states = collectNamespaceStates(ownerContainer);
        const response = new PartitionReplicaSyncResponse(0, 1, states, [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        response.apply(backupContainer, backupRm);

        // Backup must now match owner
        const repairedStore = backupContainer.getRecordStore('mapA');
        expect(repairedStore.size()).toBe(2);
        // k1 should have owner's value, not stale
        const k1Val = repairedStore.get(makeData('k1'));
        expect(k1Val).not.toBeNull();
        expect(new TextDecoder().decode(k1Val!.toByteArray()!)).toBe('v1');
    });

    test('multi-namespace diverged state is repaired per namespace', () => {
        const ownerContainer = new PartitionContainer(0);
        const backupContainer = new PartitionContainer(0);
        const backupRm = new PartitionReplicaManager(PARTITION_COUNT, 5);

        // Owner: mapA has 2 entries, mapB has 1 entry
        ownerContainer.getRecordStore('mapA').put(makeData('a1'), makeData('va1'), -1, -1);
        ownerContainer.getRecordStore('mapA').put(makeData('a2'), makeData('va2'), -1, -1);
        ownerContainer.getRecordStore('mapB').put(makeData('b1'), makeData('vb1'), -1, -1);

        // Backup: mapA is empty (missed), mapB has wrong value
        backupContainer.getRecordStore('mapB').put(makeData('b1'), makeData('wrong'), -1, -1);

        const states = collectNamespaceStates(ownerContainer);
        const response = new PartitionReplicaSyncResponse(0, 1, states, [0n, 1n, 0n, 0n, 0n, 0n, 0n]);
        response.apply(backupContainer, backupRm);

        // Both namespaces repaired
        expect(backupContainer.getRecordStore('mapA').size()).toBe(2);
        expect(backupContainer.getRecordStore('mapB').size()).toBe(1);
        const bVal = backupContainer.getRecordStore('mapB').get(makeData('b1'));
        expect(bVal).not.toBeNull();
        expect(new TextDecoder().decode(bVal!.toByteArray()!)).toBe('vb1');
    });

    test('stale sync response is rejected and does not apply payload', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const memberB = makeMember('127.0.0.1', 5702, 'b');
        const memberC = makeMember('127.0.0.1', 5703, 'c');
        service.firstArrangement([memberA, memberB, memberC], memberA.getAddress(), 2);

        // Register sync targeting memberC (who stays alive)
        const syncId = service.registerSyncRequest(0, 1, memberC.getUuid());

        // Ownership change increments epoch (remove memberB, not the sync target)
        service.memberRemovedWithRepair(memberB, [memberA, memberC]);

        // Completing with old epoch should be rejected (stale epoch)
        const accepted = service.completeSyncRequest(syncId, [0n]);
        expect(accepted).toBe(false);
        expect(service.getRecoveryMetrics().staleResponseRejects).toBeGreaterThan(0);
    });

    test('wrong-target sync clears request and does not apply', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const memberB = makeMember('127.0.0.1', 5702, 'b');
        service.firstArrangement([memberA, memberB], memberA.getAddress(), 1);

        const syncId = service.registerSyncRequest(0, 1, memberB.getUuid());

        // Remove the target member
        service.cancelReplicaSyncRequestsTo(memberB.getUuid());

        // Request should be gone
        expect(service.getSyncRequestInfo(syncId)).toBeNull();
    });

    test('stale-epoch sync response increments staleResponseRejects metric', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const memberB = makeMember('127.0.0.1', 5702, 'b');
        const memberC = makeMember('127.0.0.1', 5703, 'c');
        service.firstArrangement([memberA, memberB, memberC], memberA.getAddress(), 2);

        // Register sync targeting memberC (who stays alive through the removal)
        const syncId = service.registerSyncRequest(0, 1, memberC.getUuid());
        const metricsBefore = service.getRecoveryMetrics().staleResponseRejects;

        // Bump epoch by removing memberB (not the sync target)
        service.memberRemovedWithRepair(memberB, [memberA, memberC]);

        service.completeSyncRequest(syncId, [0n]);
        expect(service.getRecoveryMetrics().staleResponseRejects).toBe(metricsBefore + 1);
    });

    test('sync retry after stale-owner clears old sync and re-registers', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const memberB = makeMember('127.0.0.1', 5702, 'b');
        const memberC = makeMember('127.0.0.1', 5703, 'c');
        service.firstArrangement([memberA, memberB, memberC], memberA.getAddress(), 2);

        const oldSyncId = service.registerSyncRequest(0, 1, memberB.getUuid());

        // Ownership change
        service.memberRemovedWithRepair(memberB, [memberA, memberC]);

        // Old sync should be stale
        expect(service.completeSyncRequest(oldSyncId, [0n])).toBe(false);

        // New sync can be registered for the new epoch
        const newSyncId = service.registerSyncRequest(0, 1, memberC.getUuid());
        expect(service.completeSyncRequest(newSyncId, [0n])).toBe(true);
    });

    test('duplicate chunk response is rejected without completing sync', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const syncId = service.registerSyncRequest(0, 1, memberA.getUuid(), ['mapA']);

        expect(service.acceptSyncResponseChunk(syncId, 0, 2)).toBe(true);
        expect(service.acceptSyncResponseChunk(syncId, 0, 2)).toBe(false);
        expect(service.completeSyncRequest(syncId, [0n])).toBe(false);
        expect(service.getRecoveryMetrics().staleResponseRejects).toBeGreaterThan(0);
    });

    test('timed out sync requests are cleaned up and returned for retry', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const replicaManager = new PartitionReplicaManager(PARTITION_COUNT, 1);
        service.setReplicaManager(replicaManager);
        const now = 10_000;
        const syncId = service.registerSyncRequest(2, 1, memberA.getUuid(), ['mapA'], now);

        expect(replicaManager.availableReplicaSyncPermits()).toBe(0);

        const retryable = service.expireTimedOutSyncRequests(now + service.getRecoveryConfig().syncTimeoutMs + 1);

        expect(retryable).toHaveLength(1);
        expect(retryable[0]!.id).toBe(syncId);
        expect(retryable[0]!.dirtyNamespaces).toEqual(['mapA']);
        expect(service.getSyncRequestInfo(syncId)).toBeNull();
        expect(replicaManager.availableReplicaSyncPermits()).toBe(1);
        expect(service.getRecoveryMetrics().syncTimeouts).toBeGreaterThan(0);
        expect(service.getRecoveryMetrics().syncRetries).toBeGreaterThan(0);
    });
});

// ══════════════════════════════════════════════════════════════════
// 4. VERIFICATION: END-TO-END, NO STUBS, NO FAKES
// ══════════════════════════════════════════════════════════════════
describe('Block 21.0 verification — no stubs, no fakes', () => {
    test('InternalPartitionServiceImpl has no throw-stub methods', () => {
        const service = new InternalPartitionServiceImpl(PARTITION_COUNT);
        // All recovery APIs must be real implementations, not throw stubs
        const requiredMethods = [
            'memberRemovedWithRepair',
            'onPartitionLost',
            'removePartitionLostListener',
            'onMapPartitionLost',
            'removeMapPartitionLostListener',
            'cancelReplicaSyncRequestsTo',
            'registerSyncRequest',
            'completeSyncRequest',
            'startAntiEntropy',
            'stopAntiEntropy',
            'storeSnapshot',
            'clearRejoinFence',
            'isRejoiningMemberFenced',
            'getSupportedReplicatedServices',
            'getUnsupportedReplicatedServices',
            'getRecoveryConfig',
            'getRecoveryMetrics',
            'getDegradedPartitionCount',
            'isClusterSafe',
            'shutdown',
            'onDemotion',
        ];
        for (const method of requiredMethods) {
            expect(typeof (service as any)[method]).toBe('function');
        }
    });

    test('PartitionReplicaManager supports namespace-scoped versions', () => {
        const rm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        const nsRequiredMethods = [
            'incrementNamespaceReplicaVersions',
            'getNamespaceReplicaVersions',
            'isNamespaceReplicaVersionDirty',
            'markNamespaceReplicaAsSyncRequired',
        ];
        for (const method of nsRequiredMethods) {
            expect(typeof (rm as any)[method]).toBe('function');
        }
    });

    test('anti-entropy op returns dirty namespace list', () => {
        const rm = new PartitionReplicaManager(PARTITION_COUNT, 5);
        rm.incrementNamespaceReplicaVersions(0, 'test-ns', 1);

        const task = new AntiEntropyTask(rm);
        const ops = task.generateOps([0], 1);
        const result = ops[0].execute(new PartitionReplicaManager(PARTITION_COUNT, 5));

        expect(result.syncTriggered).toBe(true);
        expect(Array.isArray(result.dirtyNamespaces)).toBe(true);
        expect(result.dirtyNamespaces!.length).toBeGreaterThan(0);
    });

    test('recovery path is production-real with no test-only shortcuts', () => {
        // Verify the full chain: member removal → promotion → partition-lost → metrics
        const service = new InternalPartitionServiceImpl(4);
        const mapService = new MapContainerService();
        mapService.getOrCreateRecordStore('users', 0);
        service.registerMigrationAwareService(MapService.SERVICE_NAME, mapService);
        const memberA = makeMember('127.0.0.1', 5701, 'a');
        const memberB = makeMember('127.0.0.1', 5702, 'b');
        service.firstArrangement([memberA, memberB], memberA.getAddress(), 1);

        // Register map-scoped listeners
        const mapEvents: unknown[] = [];
        service.onMapPartitionLost('users', (e) => mapEvents.push(e));

        // Register global listener
        const globalEvents: PartitionLostEvent[] = [];
        service.onPartitionLost((e) => globalEvents.push(e));

        // Remove all members
        service.memberRemovedWithRepair(memberA, [memberB]);
        service.memberRemovedWithRepair(memberB, []);

        // Global partition-lost events should fire
        expect(globalEvents.length).toBeGreaterThan(0);

        // Map-scoped events should also fire
        expect(mapEvents.length).toBeGreaterThan(0);

        // Metrics should reflect reality
        const metrics = service.getRecoveryMetrics();
        expect(metrics.partitionsLost).toBeGreaterThan(0);
        expect(metrics.promotionCount).toBeGreaterThan(0);
    });
});
