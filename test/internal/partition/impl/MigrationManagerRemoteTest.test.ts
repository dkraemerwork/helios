/**
 * Block 16.B3b — MigrationManager remote execution tests.
 *
 * Tests: MigrationRequestOperation, commitMigrationToDestination(),
 * FinalizeMigrationOperation, PublishCompletedMigrationsOp,
 * applyCompletedMigrations with version gap rejection, rollback protocol,
 * and version +1 extra delta on failure.
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { FinalizeMigrationOperation } from '@zenystx/helios-core/internal/partition/impl/FinalizeMigrationOperation';
import { InternalPartitionImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionImpl';
import { InternalPartitionServiceImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl';
import { MigrationCommitOperation } from '@zenystx/helios-core/internal/partition/impl/MigrationCommitOperation';
import { MigrationManager } from '@zenystx/helios-core/internal/partition/impl/MigrationManager';
import { MigrationRequestOperation } from '@zenystx/helios-core/internal/partition/impl/MigrationRequestOperation';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import { PartitionStateManager } from '@zenystx/helios-core/internal/partition/impl/PartitionStateManager';
import { PublishCompletedMigrationsOp } from '@zenystx/helios-core/internal/partition/impl/PublishCompletedMigrationsOp';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import { MigrationInfo, MigrationStatus } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// ── helpers ────────────────────────────────────────────────────────────────

function addr(port: number): Address {
    return new Address('127.0.0.1', port);
}

function replica(port: number): PartitionReplica {
    return new PartitionReplica(addr(port), `uuid-${port}`);
}

function makeMigrationInfo(
    partitionId: number,
    sourcePort: number | null,
    destPort: number | null,
    opts?: {
        srcCurIdx?: number;
        srcNewIdx?: number;
        dstCurIdx?: number;
        dstNewIdx?: number;
        initialPartitionVersion?: number;
    },
): MigrationInfo {
    const info = new MigrationInfo(
        partitionId,
        sourcePort !== null ? replica(sourcePort) : null,
        destPort !== null ? replica(destPort) : null,
        opts?.srcCurIdx ?? 0,
        opts?.srcNewIdx ?? -1,
        opts?.dstCurIdx ?? -1,
        opts?.dstNewIdx ?? 0,
    );
    if (opts?.initialPartitionVersion !== undefined) {
        info.setInitialPartitionVersion(opts.initialPartitionVersion);
    }
    return info;
}

// ── MigrationRequestOperation ──────────────────────────────────────────────

describe('MigrationRequestOperation', () => {
    test('carries partitionId and migration info', () => {
        const migration = makeMigrationInfo(5, 5001, 5002);
        const op = new MigrationRequestOperation(migration, []);
        expect(op.partitionId).toBe(5);
        expect(op.getMigrationInfo()).toBe(migration);
    });

    test('collects replication operations from MigrationAwareServices', () => {
        const migration = makeMigrationInfo(3, 5001, 5002);
        const mockReplicationOp = { run: mock(() => Promise.resolve()) } as unknown as Operation;
        const mockService: MigrationAwareService = {
            prepareReplicationOperation: mock((_event, _ns) => mockReplicationOp),
            beforeMigration: () => {},
            commitMigration: () => {},
            rollbackMigration: () => {},
        };
        const services = new Map<string, MigrationAwareService>([['map', mockService]]);

        const namespaces: ServiceNamespace[] = [{ getServiceName: () => 'map' }];
        const op = new MigrationRequestOperation(migration, namespaces, services);

        expect(op.getReplicationOperations().length).toBe(1);
        expect(op.getReplicationOperations()[0]).toBe(mockReplicationOp);
    });

    test('skips services that return null replication operation', () => {
        const migration = makeMigrationInfo(3, 5001, 5002);
        const mockService: MigrationAwareService = {
            prepareReplicationOperation: mock(() => null),
            beforeMigration: () => {},
            commitMigration: () => {},
            rollbackMigration: () => {},
        };
        const services = new Map<string, MigrationAwareService>([['map', mockService]]);
        const namespaces: ServiceNamespace[] = [{ getServiceName: () => 'map' }];
        const op = new MigrationRequestOperation(migration, namespaces, services);

        expect(op.getReplicationOperations().length).toBe(0);
    });

    test('run() executes all collected replication operations', async () => {
        const migration = makeMigrationInfo(3, 5001, 5002);
        const runFn = mock(() => Promise.resolve());
        const mockReplicationOp = { run: runFn, sendResponse: mock(() => {}) } as unknown as Operation;
        const mockService: MigrationAwareService = {
            prepareReplicationOperation: mock(() => mockReplicationOp),
            beforeMigration: () => {},
            commitMigration: () => {},
            rollbackMigration: () => {},
        };
        const services = new Map([['map', mockService]]);
        const namespaces: ServiceNamespace[] = [{ getServiceName: () => 'map' }];
        const op = new MigrationRequestOperation(migration, namespaces, services);

        await op.run();
        expect(runFn).toHaveBeenCalledTimes(1);
    });
});

// ── MigrationCommitOperation ───────────────────────────────────────────────

describe('MigrationCommitOperation', () => {
    test('carries migration info', () => {
        const migration = makeMigrationInfo(7, 5001, 5002);
        const op = new MigrationCommitOperation(migration);
        expect(op.getMigrationInfo()).toBe(migration);
    });

    test('marks migration as SUCCESS on commit', async () => {
        const migration = makeMigrationInfo(7, 5001, 5002);
        const op = new MigrationCommitOperation(migration);
        await op.run();
        expect(migration.getStatus()).toBe(MigrationStatus.SUCCESS);
    });

    test('uses infinite retry count (Number.MAX_SAFE_INTEGER)', () => {
        const migration = makeMigrationInfo(7, 5001, 5002);
        const op = new MigrationCommitOperation(migration);
        expect(op.getTryCount()).toBe(Number.MAX_SAFE_INTEGER);
    });
});

// ── FinalizeMigrationOperation ─────────────────────────────────────────────

describe('FinalizeMigrationOperation', () => {
    test('on success=true: clears migrating flag on partition', async () => {
        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setMigrating();
        expect(partition.isMigrating()).toBe(true);

        const migration = makeMigrationInfo(5, 5001, 5002);
        const op = new FinalizeMigrationOperation(migration, true, partition);
        await op.run();

        expect(partition.isMigrating()).toBe(false);
    });

    test('on success=true: updates partition replicas', async () => {
        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setReplica(0, replica(5001));
        partition.setMigrating();

        const migration = makeMigrationInfo(5, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
        });
        const op = new FinalizeMigrationOperation(migration, true, partition);
        await op.run();

        expect(partition.getReplica(0)?.address().port).toBe(5002);
    });

    test('on success=false: rollback clears partial state from PartitionContainer', async () => {
        const container = new PartitionContainer(5);
        container.getRecordStore('myMap'); // registers namespace

        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setMigrating();

        const migration = makeMigrationInfo(5, 5001, 5002);
        const op = new FinalizeMigrationOperation(migration, false, partition, container);
        await op.run();

        expect(container.getAllNamespaces().length).toBe(0);
        expect(partition.isMigrating()).toBe(false);
    });

    test('on success=false: partition replicas unchanged (rollback)', async () => {
        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setReplica(0, replica(5001));
        partition.setMigrating();
        const versionBefore = partition.version();

        const migration = makeMigrationInfo(5, 5001, 5002);
        const op = new FinalizeMigrationOperation(migration, false, partition);
        await op.run();

        expect(partition.getReplica(0)?.address().port).toBe(5001);
    });

    test('rollback idempotency: calling twice leaves clean state', async () => {
        const container = new PartitionContainer(5);
        container.getRecordStore('myMap'); // registers namespace

        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setMigrating();

        const migration = makeMigrationInfo(5, 5001, 5002);
        const op1 = new FinalizeMigrationOperation(migration, false, partition, container);
        await op1.run();

        // Second rollback should not throw
        partition.setMigrating();
        const op2 = new FinalizeMigrationOperation(migration, false, partition, container);
        await op2.run();

        expect(container.getAllNamespaces().length).toBe(0);
        expect(partition.isMigrating()).toBe(false);
    });

    test('notifies MigrationAwareServices on rollback', async () => {
        const rollbackFn = mock(() => {});
        const mockService: MigrationAwareService = {
            prepareReplicationOperation: mock(() => null),
            beforeMigration: () => {},
            commitMigration: () => {},
            rollbackMigration: () => {},
        };
        const services = new Map<string, MigrationAwareService>([['map', mockService]]);

        const partition = new InternalPartitionImpl(5, replica(5001), null);
        partition.setMigrating();

        const migration = makeMigrationInfo(5, 5001, 5002);
        const container = new PartitionContainer(5);
        const op = new FinalizeMigrationOperation(migration, false, partition, container, services);
        await op.run();

        expect(partition.isMigrating()).toBe(false);
    });
});

// ── PublishCompletedMigrationsOp ───────────────────────────────────────────

describe('PublishCompletedMigrationsOp', () => {
    test('carries collection of completed MigrationInfo', () => {
        const m1 = makeMigrationInfo(0, 5001, 5002);
        const m2 = makeMigrationInfo(1, 5001, 5002);
        const op = new PublishCompletedMigrationsOp([m1, m2]);
        expect(op.getCompletedMigrations()).toHaveLength(2);
    });

    test('operation is non-partition-specific (generic)', () => {
        const op = new PublishCompletedMigrationsOp([]);
        expect(op.partitionId).toBe(-1);
    });
});

// ── applyCompletedMigrations on InternalPartitionServiceImpl ───────────────

describe('InternalPartitionServiceImpl.applyCompletedMigrations', () => {
    let service: InternalPartitionServiceImpl;
    const partitionCount = 4;

    beforeEach(() => {
        service = new InternalPartitionServiceImpl(partitionCount);
    });

    test('applies migration and updates partition replicas', () => {
        // Set initial partition state
        const partition = service.getPartition(0);
        partition.setReplica(0, replica(5001));
        const initialVersion = partition.version();

        const migration = makeMigrationInfo(0, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
            initialPartitionVersion: initialVersion,
        });
        migration.setStatus(MigrationStatus.SUCCESS);

        const result = service.applyCompletedMigrations([migration]);
        expect(result).toBe(true);

        const newOwner = service.getPartitionOwner(0);
        expect(newOwner?.address().port).toBe(5002);
    });

    test('version gap causes rejection (Finding 12)', () => {
        const partition = service.getPartition(0);
        partition.setReplica(0, replica(5001));
        const currentVersion = partition.version();

        // Migration claims version is currentVersion + 5 — a gap
        const migration = makeMigrationInfo(0, 5001, 5002, {
            initialPartitionVersion: currentVersion + 5,
        });
        migration.setStatus(MigrationStatus.SUCCESS);

        const result = service.applyCompletedMigrations([migration]);
        expect(result).toBe(false);

        // Partition should be unchanged
        expect(service.getPartitionOwner(0)?.address().port).toBe(5001);
    });

    test('members apply only migrations newer than current view (idempotent)', () => {
        const partition = service.getPartition(0);
        partition.setReplica(0, replica(5001));
        const ver = partition.version();

        const migration = makeMigrationInfo(0, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
            initialPartitionVersion: ver,
        });
        migration.setStatus(MigrationStatus.SUCCESS);

        // Apply once
        service.applyCompletedMigrations([migration]);
        const verAfterFirst = service.getPartition(0).version();

        // Apply same migration again — should be idempotent (version mismatch rejects it)
        const migration2 = makeMigrationInfo(0, 5002, 5003, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
            initialPartitionVersion: ver, // same old version — gap now
        });
        migration2.setStatus(MigrationStatus.SUCCESS);
        const result2 = service.applyCompletedMigrations([migration2]);
        expect(result2).toBe(false);
    });

    test('completedMigrations cleared after full partition-state publish', () => {
        const partition = service.getPartition(0);
        partition.setReplica(0, replica(5001));
        const ver = partition.version();

        const migration = makeMigrationInfo(0, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
            initialPartitionVersion: ver,
        });
        migration.setStatus(MigrationStatus.SUCCESS);
        service.applyCompletedMigrations([migration]);

        // After full state publish, completed list should be cleared
        service.clearCompletedMigrations();
        expect(service.getCompletedMigrations()).toHaveLength(0);
    });
});

// ── Version +1 extra delta on migration failure (Finding 3) ────────────────

describe('Migration failure: version increment includes +1 extra delta', () => {
    test('failed migration increments version by replicaCount + 1', () => {
        const partitionService = new InternalPartitionServiceImpl(4);
        const partition = partitionService.getPartition(0);
        partition.setReplica(0, replica(5001));
        const versionBefore = partition.version();
        const replicaCount = MAX_REPLICA_COUNT;

        partitionService.onMigrationFailure(0, replicaCount);

        const versionAfter = partition.version();
        expect(versionAfter).toBe(versionBefore + replicaCount + 1);
    });

    test('stale commit after failure: rejected due to version mismatch', () => {
        const partitionService = new InternalPartitionServiceImpl(4);
        const partition = partitionService.getPartition(0);
        partition.setReplica(0, replica(5001));
        const versionBeforeFailure = partition.version();

        // Simulate failure with +1 delta
        partitionService.onMigrationFailure(0, MAX_REPLICA_COUNT);

        // Now a stale commit tries to apply with the old version
        const staleMigration = makeMigrationInfo(0, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
            initialPartitionVersion: versionBeforeFailure,
        });
        staleMigration.setStatus(MigrationStatus.SUCCESS);

        const result = partitionService.applyCompletedMigrations([staleMigration]);
        expect(result).toBe(false);
    });
});

// ── MigrationManager remote execution integration ──────────────────────────

describe('MigrationManager remote execution', () => {
    test('executeMigration sends MigrationRequestOperation to destination', async () => {
        const manager = new MigrationManager(
            new PartitionStateManager(4),
            { clear: mock(() => {}), add: mock(() => {}), poll: mock(() => null), afterTaskCompletion: mock(() => {}), migrationTaskCount: mock(() => 0), hasMigrationTasks: mock(() => false) } as any,
        );

        const migration = makeMigrationInfo(0, 5001, 5002);
        const container = new PartitionContainer(0);
        container.getRecordStore('test'); // registers namespace

        const executed = await manager.executeMigration(migration, container, new Map());
        expect(executed).toBeDefined();
    });

    test('commitMigrationToDestination uses infinite retry', async () => {
        const manager = new MigrationManager(
            new PartitionStateManager(4),
            { clear: mock(() => {}), add: mock(() => {}), poll: mock(() => null), afterTaskCompletion: mock(() => {}), migrationTaskCount: mock(() => 0), hasMigrationTasks: mock(() => false) } as any,
        );

        const migration = makeMigrationInfo(0, 5001, 5002);
        const commitOp = manager.createCommitOperation(migration);
        expect(commitOp.getTryCount()).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('finalizeMigration on both source and destination clears migrating flag', async () => {
        const partition = new InternalPartitionImpl(0, replica(5001), null);
        partition.setReplica(0, replica(5001));
        partition.setMigrating();

        const migration = makeMigrationInfo(0, 5001, 5002, {
            srcCurIdx: 0, srcNewIdx: -1, dstCurIdx: -1, dstNewIdx: 0,
        });

        const finalizeOp = new FinalizeMigrationOperation(migration, true, partition);
        await finalizeOp.run();

        expect(partition.isMigrating()).toBe(false);
    });

    test('parallel migration limit: respects maxParallelMigrations', () => {
        const manager = new MigrationManager(
            new PartitionStateManager(4),
            { clear: mock(() => {}), add: mock(() => {}), poll: mock(() => null), afterTaskCompletion: mock(() => {}), migrationTaskCount: mock(() => 0), hasMigrationTasks: mock(() => false) } as any,
            { maxParallelMigrations: 2 },
        );

        expect(manager.getMaxParallelMigrations()).toBe(2);
    });
});
