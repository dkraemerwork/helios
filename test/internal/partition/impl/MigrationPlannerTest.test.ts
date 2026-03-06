/**
 * Port of com.hazelcast.internal.partition.impl.MigrationPlannerTest
 */
import { describe, it, expect } from 'bun:test';
import { Address } from '@zenystx/helios-core/cluster/Address';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { MigrationPlanner } from '@zenystx/helios-core/internal/partition/impl/MigrationPlanner';

type MigrateCall = [
    source: PartitionReplica | null,
    sourceCurrentReplicaIndex: number,
    sourceNewReplicaIndex: number,
    destination: PartitionReplica | null,
    destinationCurrentReplicaIndex: number,
    destinationNewReplicaIndex: number,
];

function recordingCallback(): { calls: MigrateCall[], callback: { migrate: (...args: any[]) => void } } {
    const calls: MigrateCall[] = [];
    const callback = {
        migrate(
            source: PartitionReplica | null,
            sourceCurrentReplicaIndex: number,
            sourceNewReplicaIndex: number,
            destination: PartitionReplica | null,
            destinationCurrentReplicaIndex: number,
            destinationNewReplicaIndex: number,
        ) {
            calls.push([source, sourceCurrentReplicaIndex, sourceNewReplicaIndex, destination, destinationCurrentReplicaIndex, destinationNewReplicaIndex]);
        },
    };
    return { calls, callback };
}

function expectCall(
    calls: MigrateCall[],
    source: PartitionReplica | null,
    sci: number,
    sni: number,
    dest: PartitionReplica | null,
    dci: number,
    dni: number,
): void {
    const found = calls.some(c =>
        replicaEq(c[0], source) &&
        c[1] === sci &&
        c[2] === sni &&
        replicaEq(c[3], dest) &&
        c[4] === dci &&
        c[5] === dni
    );
    if (!found) {
        throw new Error(
            `Expected migrate call not found:\n  source=${source} sci=${sci} sni=${sni} dest=${dest} dci=${dci} dni=${dni}\nActual calls:\n${calls.map(c => `  [${c}]`).join('\n')}`
        );
    }
}

function replicaEq(a: PartitionReplica | null | undefined, b: PartitionReplica | null | undefined): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.equals(b);
}

function addr(port: number): Address {
    return new Address('localhost', port);
}

const uuids: string[] = [
    '00000039-0000-0000-0000-000000000001',
    '00000039-0000-0000-0000-000000000002',
    '00000039-0000-0000-0000-000000000003',
    '00000039-0000-0000-0000-000000000004',
    '00000039-0000-0000-0000-000000000005',
    '00000039-0000-0000-0000-000000000006',
    '00000039-0000-0000-0000-000000000007',
];

function r(port: number, uuidIdx: number): PartitionReplica {
    return new PartitionReplica(addr(port), uuids[uuidIdx]!);
}

describe('MigrationPlannerTest', () => {
    const migrationPlanner = new MigrationPlanner();

    it('test_MOVE', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), null, null, null, null];
        const newReplicas = [r(5704, 3), r(5702, 1), r(5705, 4), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, -1, r(5704, 3), -1, 0);
        expectCall(calls, r(5703, 2), 2, -1, r(5705, 4), -1, 2);
    });

    it('test_COPY', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), null, r(5703, 2), null, null, null, null];
        const newReplicas = [r(5701, 0), r(5704, 3), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, null, -1, -1, r(5704, 3), -1, 1);
    });

    it('test_SHIFT_DOWN_withNullKeepReplicaIndex', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), null, r(5703, 2), null, null, null, null];
        const newReplicas = [r(5704, 3), r(5701, 0), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, 1, r(5704, 3), -1, 0);
    });

    it('test_SHIFT_DOWN_withNullNonNullKeepReplicaIndex', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), null, null, null, null];
        const newReplicas = [r(5704, 3), r(5701, 0), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, -1, r(5704, 3), -1, 0);
        expectCall(calls, r(5702, 1), 1, -1, r(5701, 0), -1, 1);
    });

    it('test_SHIFT_DOWN_performedBy_MOVE', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), null, null, null, null];
        const newReplicas = [r(5704, 3), r(5701, 0), r(5702, 1), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, -1, r(5704, 3), -1, 0);
        expectCall(calls, r(5702, 1), 1, -1, r(5701, 0), -1, 1);
        expectCall(calls, r(5703, 2), 2, -1, r(5702, 1), -1, 2);
    });

    it('test_SHIFT_UP', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), null, r(5703, 2), r(5704, 3), null, null, null];
        const newReplicas = [r(5701, 0), r(5703, 2), r(5704, 3), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, null, -1, -1, r(5703, 2), 2, 1);
        expectCall(calls, null, -1, -1, r(5704, 3), 3, 2);
    });

    it('test_SHIFT_UPS_performedBy_MOVE', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5704, 3), null, null, null];
        const newReplicas = [r(5701, 0), r(5703, 2), r(5704, 3), r(5705, 4), null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5704, 3), 3, -1, r(5705, 4), -1, 3);
        expectCall(calls, r(5703, 2), 2, -1, r(5704, 3), -1, 2);
        expectCall(calls, r(5702, 1), 1, -1, r(5703, 2), -1, 1);
    });

    it('test_SHIFT_DOWN_performedAfterKnownNewReplicaOwnerKickedOutOfReplicas', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5705, 4), null, null, null];
        const newReplicas = [r(5704, 3), r(5703, 2), r(5705, 4), r(5706, 5), r(5702, 1), r(5701, 0), null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, 5, r(5704, 3), -1, 0);
        expectCall(calls, r(5705, 4), 3, -1, r(5706, 5), -1, 3);
        expectCall(calls, r(5703, 2), 2, -1, r(5705, 4), -1, 2);
        expectCall(calls, r(5702, 1), 1, 4, r(5703, 2), -1, 1);
    });

    it('test_SHIFT_DOWN_performedBeforeNonConflicting_SHIFT_UP', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5705, 4), null, null, null];
        const newReplicas = [r(5704, 3), r(5703, 2), r(5705, 4), r(5706, 5), r(5701, 0), null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, 4, r(5704, 3), -1, 0);
        expectCall(calls, r(5705, 4), 3, -1, r(5706, 5), -1, 3);
        expectCall(calls, r(5703, 2), 2, -1, r(5705, 4), -1, 2);
    });

    it('test_MOVE_toNull', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5705, 4), null, null, null];
        const newReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5705, 4), 3, -1, null, -1, -1);
    });

    it('test_SHIFT_UP_toReplicaIndexWithExistingOwner', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5704, 3), null, null, null];
        const newReplicas = [r(5701, 0), r(5704, 3), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5702, 1), 1, -1, r(5704, 3), 3, 1);
    });

    it('test_MOVE_performedAfter_SHIFT_UP_toReplicaIndexWithExistingOwnerKicksItOutOfCluster', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), r(5704, 3), null, null, null];
        const newReplicas = [r(5702, 1), r(5704, 3), r(5703, 2), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5702, 1), 1, -1, r(5704, 3), 3, 1);
        expectCall(calls, r(5701, 0), 0, -1, r(5702, 1), -1, 0);
    });

    it('test_SHIFT_UP_multipleTimes', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5702, 1), null, r(5703, 2), r(5704, 3), null, null, null];
        const newReplicas = [r(5702, 1), r(5703, 2), r(5704, 3), null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, null, -1, -1, r(5703, 2), 2, 1);
        expectCall(calls, null, -1, -1, r(5704, 3), 3, 2);
    });

    it('test_SHIFT_UP_nonNullSource_isNoLongerReplica', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), null, null, null, null, null];
        const newReplicas = [r(5702, 1), null, null, null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, -1, r(5702, 1), 1, 0);
    });

    it('test_SHIFT_UP_nonNullSource_willGetAnotherMOVE', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), r(5702, 1), r(5703, 2), null, null, null, null];
        const newReplicas = [r(5703, 2), r(5701, 0), null, null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, -1, r(5703, 2), 2, 0);
        expectCall(calls, r(5702, 1), 1, -1, r(5701, 0), -1, 1);
    });

    it('test_SHIFT_UP_SHIFT_DOWN_atomicTogether', () => {
        const { calls, callback } = recordingCallback();
        const oldReplicas = [r(5701, 0), null, r(5703, 2), null, null, null, null];
        const newReplicas = [r(5703, 2), r(5701, 0), null, null, null, null, null];
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
        expectCall(calls, r(5701, 0), 0, 1, r(5703, 2), 2, 0);
    });

    it('testSingleMigrationPrioritization', () => {
        const migrations: MigrationInfo[] = [];
        const migration1 = new MigrationInfo(0, null, r(5701, 0), -1, -1, -1, 0);
        migrations.push(migration1);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([migration1]);
    });

    it('testNoCopyPrioritizationAgainstCopy', () => {
        const migrations: MigrationInfo[] = [];
        const m1 = new MigrationInfo(0, null, r(5701, 0), -1, -1, -1, 0);
        const m2 = new MigrationInfo(0, null, r(5702, 1), -1, -1, -1, 1);
        const m3 = new MigrationInfo(0, null, r(5703, 2), -1, -1, -1, 2);
        const m4 = new MigrationInfo(0, null, r(5704, 3), -1, -1, -1, 3);
        migrations.push(m1, m2, m3, m4);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([m1, m2, m3, m4]);
    });

    it('testCopyPrioritizationAgainstMove', () => {
        const migrations: MigrationInfo[] = [];
        const m1 = new MigrationInfo(0, null, r(5701, 0), -1, -1, -1, 0);
        const m2 = new MigrationInfo(0, null, r(5702, 1), -1, -1, -1, 1);
        const m3 = new MigrationInfo(0, r(5703, 2), r(5704, 3), 2, -1, -1, 2);
        const m4 = new MigrationInfo(0, r(5705, 4), r(5706, 5), 2, -1, -1, 3);
        const m5 = new MigrationInfo(0, null, r(5707, 6), -1, -1, -1, 4);
        migrations.push(m1, m2, m3, m4, m5);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([m1, m2, m5, m3, m4]);
    });

    it('testShiftUpPrioritizationAgainstMove', () => {
        const migrations: MigrationInfo[] = [];
        const m1 = new MigrationInfo(0, null, r(5701, 0), -1, -1, -1, 0);
        const m2 = new MigrationInfo(0, null, r(5702, 1), -1, -1, -1, 1);
        const m3 = new MigrationInfo(0, r(5705, 4), r(5706, 5), 2, -1, -1, 3);
        const m4 = new MigrationInfo(0, null, r(5707, 6), -1, -1, 4, 2);
        migrations.push(m1, m2, m3, m4);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([m1, m2, m4, m3]);
    });

    it('testCopyPrioritizationAgainstShiftDownToColderIndex', () => {
        const migrations: MigrationInfo[] = [];
        const m1 = new MigrationInfo(0, r(5701, 0), r(5702, 1), 0, 2, -1, 0);
        const m2 = new MigrationInfo(0, null, r(5703, 2), -1, -1, -1, 1);
        migrations.push(m1, m2);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([m2, m1]);
    });

    it('testNoCopyPrioritizationAgainstShiftDownToHotterIndex', () => {
        const migrations: MigrationInfo[] = [];
        const m1 = new MigrationInfo(0, r(5701, 0), r(5702, 1), 0, 1, -1, 0);
        const m2 = new MigrationInfo(0, null, r(5703, 2), -1, -1, -1, 2);
        migrations.push(m1, m2);
        migrationPlanner.prioritizeCopiesAndShiftUps(migrations);
        expect(migrations).toEqual([m1, m2]);
    });

    it('testRandom', () => {
        // Just verify it doesn't crash on random inputs
        for (let i = 0; i < 100; i++) {
            testRandom(3);
            testRandom(4);
            testRandom(5);
        }
    });

    function testRandom(initialLen: number): void {
        const MAX_REPLICA_COUNT = 7;
        const oldReplicas: (PartitionReplica | null)[] = new Array(MAX_REPLICA_COUNT).fill(null);
        for (let i = 0; i < initialLen; i++) {
            oldReplicas[i] = new PartitionReplica(addr(5000 + i), crypto.randomUUID());
        }

        const newReplicas: (PartitionReplica | null)[] = [...oldReplicas];
        const newLen = Math.floor(Math.random() * (MAX_REPLICA_COUNT - initialLen + 1));
        for (let i = 0; i < newLen; i++) {
            newReplicas[i + initialLen] = new PartitionReplica(addr(6000 + i), crypto.randomUUID());
        }

        shuffle(newReplicas, initialLen + newLen);
        const { callback } = recordingCallback();
        migrationPlanner.planMigrations(0, oldReplicas, newReplicas, callback);
    }

    function shuffle(array: any[], len: number): void {
        for (let i = len - 1; i > 0; i--) {
            const index = Math.floor(Math.random() * (i + 1));
            const temp = array[index];
            array[index] = array[i];
            array[i] = temp;
        }
    }
});
