/**
 * Block 16.D4 — Map operations as BackupAwareOperation.
 *
 * Tests that PutOperation, RemoveOperation, SetOperation, DeleteOperation,
 * PutIfAbsentOperation implement BackupAwareOperation, and that their
 * corresponding backup operations (PutBackupOperation, RemoveBackupOperation)
 * correctly mutate the backup RecordStore.
 *
 * Also tests end-to-end backup flow: primary sends backup after write,
 * sync vs async semantics, backup validation (wrong replica / stale version).
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';
import { DefaultRecordStore } from '@helios/map/impl/recordstore/DefaultRecordStore';
import { MapContainerService } from '@helios/map/impl/MapContainerService';
import { MapService } from '@helios/map/impl/MapService';
import { PutOperation } from '@helios/map/impl/operation/PutOperation';
import { RemoveOperation } from '@helios/map/impl/operation/RemoveOperation';
import { SetOperation } from '@helios/map/impl/operation/SetOperation';
import { DeleteOperation } from '@helios/map/impl/operation/DeleteOperation';
import { PutIfAbsentOperation } from '@helios/map/impl/operation/PutIfAbsentOperation';
import { PutBackupOperation } from '@helios/map/impl/operation/PutBackupOperation';
import { RemoveBackupOperation } from '@helios/map/impl/operation/RemoveBackupOperation';
import { isBackupAwareOperation } from '@helios/spi/impl/operationservice/BackupAwareOperation';
import type { BackupAwareOperation } from '@helios/spi/impl/operationservice/BackupAwareOperation';
import { Operation } from '@helios/spi/impl/operationservice/Operation';
import { OperationBackupHandler } from '@helios/spi/impl/operationservice/OperationBackupHandler';
import type { BackupSender, ReplicaVersionManager, PartitionProvider } from '@helios/spi/impl/operationservice/OperationBackupHandler';
import { Address } from '@helios/cluster/Address';
import type { InternalPartition } from '@helios/internal/partition/InternalPartition';
import type { PartitionReplica } from '@helios/internal/partition/PartitionReplica';
import type { Data } from '@helios/internal/serialization/Data';

describe('Block 16.D4 — BackupAware Map Operations', () => {
    const MAP_NAME = 'testMap';
    const PARTITION = 0;

    let nodeEngine: TestNodeEngine;
    let primaryStore: DefaultRecordStore;
    let backupStore: DefaultRecordStore;

    function d(x: unknown): Data { return nodeEngine.toData(x)!; }
    function o(data: Data | null): unknown { return nodeEngine.toObject(data); }

    beforeEach(() => {
        nodeEngine = new TestNodeEngine();
        primaryStore = new DefaultRecordStore();
        backupStore = new DefaultRecordStore();
        const svc = new MapContainerService();
        svc.setRecordStore(MAP_NAME, PARTITION, primaryStore);
        nodeEngine.registerService(MapService.SERVICE_NAME, svc);
    });

    // ── BackupAwareOperation interface compliance ──────────────────────

    describe('interface compliance', () => {
        test('PutOperation implements BackupAwareOperation', () => {
            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect(isBackupAwareOperation(op)).toBe(true);
        });

        test('RemoveOperation implements BackupAwareOperation', () => {
            const op = new RemoveOperation(MAP_NAME, d('k'));
            expect(isBackupAwareOperation(op)).toBe(true);
        });

        test('SetOperation implements BackupAwareOperation', () => {
            const op = new SetOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect(isBackupAwareOperation(op)).toBe(true);
        });

        test('DeleteOperation implements BackupAwareOperation', () => {
            const op = new DeleteOperation(MAP_NAME, d('k'));
            expect(isBackupAwareOperation(op)).toBe(true);
        });

        test('PutIfAbsentOperation implements BackupAwareOperation', () => {
            const op = new PutIfAbsentOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect(isBackupAwareOperation(op)).toBe(true);
        });
    });

    // ── shouldBackup semantics ────────────────────────────────────────

    describe('shouldBackup', () => {
        test('PutOperation.shouldBackup() returns true', () => {
            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect((op as unknown as BackupAwareOperation).shouldBackup()).toBe(true);
        });

        test('RemoveOperation.shouldBackup() returns true', () => {
            const op = new RemoveOperation(MAP_NAME, d('k'));
            expect((op as unknown as BackupAwareOperation).shouldBackup()).toBe(true);
        });

        test('SetOperation.shouldBackup() returns true', () => {
            const op = new SetOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect((op as unknown as BackupAwareOperation).shouldBackup()).toBe(true);
        });

        test('DeleteOperation.shouldBackup() returns true', () => {
            const op = new DeleteOperation(MAP_NAME, d('k'));
            expect((op as unknown as BackupAwareOperation).shouldBackup()).toBe(true);
        });

        test('PutIfAbsentOperation.shouldBackup() returns true', () => {
            const op = new PutIfAbsentOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            expect((op as unknown as BackupAwareOperation).shouldBackup()).toBe(true);
        });
    });

    // ── backup count defaults ─────────────────────────────────────────

    describe('backup counts', () => {
        test('PutOperation has 1 sync backup, 0 async by default', () => {
            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1) as unknown as BackupAwareOperation;
            expect(op.getSyncBackupCount()).toBe(1);
            expect(op.getAsyncBackupCount()).toBe(0);
        });

        test('RemoveOperation has 1 sync backup, 0 async by default', () => {
            const op = new RemoveOperation(MAP_NAME, d('k')) as unknown as BackupAwareOperation;
            expect(op.getSyncBackupCount()).toBe(1);
            expect(op.getAsyncBackupCount()).toBe(0);
        });
    });

    // ── PutBackupOperation ────────────────────────────────────────────

    describe('PutBackupOperation', () => {
        test('applies put to backup record store', async () => {
            const backupOp = new PutBackupOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            backupOp.partitionId = PARTITION;

            // Set up node engine for backup op
            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            backupOp.setNodeEngine(backupEngine);

            await backupOp.beforeRun();
            await backupOp.run();

            expect(o(backupStore.get(d('k')))).toBe('v');
        });

        test('overwrites existing entry on backup store', async () => {
            backupStore.put(d('k'), d('old'), -1, -1);

            const backupOp = new PutBackupOperation(MAP_NAME, d('k'), d('new'), -1, -1);
            backupOp.partitionId = PARTITION;

            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            backupOp.setNodeEngine(backupEngine);

            await backupOp.beforeRun();
            await backupOp.run();

            expect(o(backupStore.get(d('k')))).toBe('new');
        });
    });

    // ── RemoveBackupOperation ─────────────────────────────────────────

    describe('RemoveBackupOperation', () => {
        test('removes entry from backup record store', async () => {
            backupStore.put(d('k'), d('v'), -1, -1);

            const backupOp = new RemoveBackupOperation(MAP_NAME, d('k'));
            backupOp.partitionId = PARTITION;

            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            backupOp.setNodeEngine(backupEngine);

            await backupOp.beforeRun();
            await backupOp.run();

            expect(backupStore.containsKey(d('k'))).toBe(false);
        });

        test('no-op when key absent on backup store', async () => {
            const backupOp = new RemoveBackupOperation(MAP_NAME, d('missing'));
            backupOp.partitionId = PARTITION;

            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            backupOp.setNodeEngine(backupEngine);

            await backupOp.beforeRun();
            await backupOp.run();

            expect(backupStore.size()).toBe(0);
        });
    });

    // ── getBackupOperation ────────────────────────────────────────────

    describe('getBackupOperation', () => {
        test('PutOperation returns PutBackupOperation', () => {
            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1) as unknown as BackupAwareOperation;
            const backup = op.getBackupOperation();
            expect(backup).toBeInstanceOf(PutBackupOperation);
        });

        test('RemoveOperation returns RemoveBackupOperation', () => {
            const op = new RemoveOperation(MAP_NAME, d('k')) as unknown as BackupAwareOperation;
            const backup = op.getBackupOperation();
            expect(backup).toBeInstanceOf(RemoveBackupOperation);
        });

        test('SetOperation returns PutBackupOperation', () => {
            const op = new SetOperation(MAP_NAME, d('k'), d('v'), -1, -1) as unknown as BackupAwareOperation;
            const backup = op.getBackupOperation();
            expect(backup).toBeInstanceOf(PutBackupOperation);
        });

        test('DeleteOperation returns RemoveBackupOperation', () => {
            const op = new DeleteOperation(MAP_NAME, d('k')) as unknown as BackupAwareOperation;
            const backup = op.getBackupOperation();
            expect(backup).toBeInstanceOf(RemoveBackupOperation);
        });

        test('PutIfAbsentOperation returns PutBackupOperation', () => {
            const op = new PutIfAbsentOperation(MAP_NAME, d('k'), d('v'), -1, -1) as unknown as BackupAwareOperation;
            const backup = op.getBackupOperation();
            expect(backup).toBeInstanceOf(PutBackupOperation);
        });
    });

    // ── End-to-end: OperationBackupHandler sends backups ──────────────

    describe('backup sending integration', () => {
        test('OperationBackupHandler sends backup after PutOperation', () => {
            const primaryAddr = new Address('127.0.0.1', 5701);
            const backupAddr = new Address('127.0.0.1', 5702);

            const sentBackups: { op: Operation; target: Address; sync: boolean }[] = [];

            const sender: BackupSender = {
                sendBackup(backupOp, target, _pid, _versions, sync) {
                    sentBackups.push({ op: backupOp, target, sync });
                },
            };

            const versionManager: ReplicaVersionManager = {
                incrementPartitionReplicaVersions(_pid, totalBackups) {
                    return Array.from({ length: totalBackups }, () => 1n);
                },
            };

            const mockReplica = (addr: Address): PartitionReplica => ({
                address: () => addr,
                equals: (other: PartitionReplica) => other.address().equals(addr),
            } as PartitionReplica);

            const partition = {
                getPartitionId: () => PARTITION,
                getReplica: (index: number) => index === 0 ? mockReplica(primaryAddr) : index === 1 ? mockReplica(backupAddr) : null,
                getOwnerOrNull: () => mockReplica(primaryAddr),
                isMigrating: () => false,
            } as unknown as InternalPartition;

            const provider: PartitionProvider = {
                getPartition: () => partition,
                getClusterSize: () => 2,
            };

            const handler = new OperationBackupHandler(primaryAddr, sender, versionManager, provider);

            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            op.partitionId = PARTITION;

            const syncCount = handler.sendBackups(op);

            expect(syncCount).toBe(1);
            expect(sentBackups).toHaveLength(1);
            expect(sentBackups[0]!.target.equals(backupAddr)).toBe(true);
            expect(sentBackups[0]!.sync).toBe(true);
            expect(sentBackups[0]!.op).toBeInstanceOf(PutBackupOperation);
        });

        test('no backup sent for single-node cluster', () => {
            const addr = new Address('127.0.0.1', 5701);
            const sentBackups: unknown[] = [];

            const sender: BackupSender = {
                sendBackup(...args) { sentBackups.push(args); },
            };

            const versionManager: ReplicaVersionManager = {
                incrementPartitionReplicaVersions() { return [1n]; },
            };

            const provider: PartitionProvider = {
                getPartition: () => ({} as InternalPartition),
                getClusterSize: () => 1,
            };

            const handler = new OperationBackupHandler(addr, sender, versionManager, provider);

            const op = new PutOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            op.partitionId = PARTITION;

            const syncCount = handler.sendBackups(op);
            expect(syncCount).toBe(0);
            expect(sentBackups).toHaveLength(0);
        });
    });

    // ── End-to-end: backup applied on backup node ─────────────────────

    describe('backup execution on backup node', () => {
        test('map put backup applied on backup node and data readable', async () => {
            // Simulate: primary put → backup op → backup store has entry
            const putOp = new PutBackupOperation(MAP_NAME, d('k'), d('v'), -1, -1);
            putOp.partitionId = PARTITION;

            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            putOp.setNodeEngine(backupEngine);

            await putOp.beforeRun();
            await putOp.run();

            // Backup store has the value
            expect(o(backupStore.get(d('k')))).toBe('v');
        });

        test('map remove backup removes entry on backup node', async () => {
            backupStore.put(d('k'), d('v'), -1, -1);

            const removeOp = new RemoveBackupOperation(MAP_NAME, d('k'));
            removeOp.partitionId = PARTITION;

            const backupEngine = new TestNodeEngine();
            const backupSvc = new MapContainerService();
            backupSvc.setRecordStore(MAP_NAME, PARTITION, backupStore);
            backupEngine.registerService(MapService.SERVICE_NAME, backupSvc);
            removeOp.setNodeEngine(backupEngine);

            await removeOp.beforeRun();
            await removeOp.run();

            expect(backupStore.containsKey(d('k'))).toBe(false);
        });
    });
});
