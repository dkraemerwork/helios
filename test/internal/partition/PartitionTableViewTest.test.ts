/**
 * Port of com.hazelcast.internal.partition.PartitionTableViewTest
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { PartitionStampUtil } from '@zenystx/helios-core/internal/partition/PartitionStampUtil';
import { PartitionTableView } from '@zenystx/helios-core/internal/partition/PartitionTableView';
import { ReadonlyInternalPartition } from '@zenystx/helios-core/internal/partition/ReadonlyInternalPartition';
import { describe, expect, it } from 'bun:test';

const MAX_REPLICA_COUNT = 7; // InternalPartition.MAX_REPLICA_COUNT

function newUUID(): string {
    return crypto.randomUUID();
}

function randomInt(max: number): number {
    return Math.floor(Math.random() * max);
}

function createRandomPartitions(): ReadonlyInternalPartition[] {
    const partitions: ReadonlyInternalPartition[] = [];
    for (let i = 0; i < 100; i++) {
        const replicas: (PartitionReplica | null)[] = [];
        for (let j = 0; j < MAX_REPLICA_COUNT; j++) {
            const addr = new Address(`10.10.${i}.${randomInt(256)}`, 5000 + j);
            replicas.push(new PartitionReplica(addr, newUUID()));
        }
        partitions.push(new ReadonlyInternalPartition(replicas as PartitionReplica[], i, randomInt(10) + 1));
    }
    return partitions;
}

function createRandomPartitionTable(): PartitionTableView {
    return new PartitionTableView(createRandomPartitions());
}

function extractPartitions(table: PartitionTableView): InternalPartition[] {
    const partitions: InternalPartition[] = [];
    for (let i = 0; i < table.length(); i++) {
        partitions.push(table.getPartition(i)!);
    }
    return partitions;
}

describe('PartitionTableViewTest', () => {
    it('test_getStamp', () => {
        const partitions = createRandomPartitions();
        const table = new PartitionTableView(partitions);
        expect(table.stamp()).toBe(PartitionStampUtil.calculateStamp(partitions));
    });

    it('test_getLength', () => {
        const len = randomInt(100);
        const table = new PartitionTableView(new Array(len).fill(null));
        expect(table.length()).toBe(len);
    });

    it('test_getReplica', () => {
        const partitions = createRandomPartitions();
        const table = new PartitionTableView(partitions);
        expect(table.length()).toBe(partitions.length);
        for (let i = 0; i < partitions.length; i++) {
            for (let j = 0; j < MAX_REPLICA_COUNT; j++) {
                const r1 = partitions[i]!.getReplica(j);
                const r2 = table.getReplica(i, j);
                if (r1 === null) {
                    expect(r2).toBeNull();
                } else {
                    expect(r2).not.toBeNull();
                    expect(r1.equals(r2)).toBe(true);
                }
            }
        }
    });

    it('test_getReplicas', () => {
        const partitions = createRandomPartitions();
        const table = new PartitionTableView(partitions);
        expect(table.length()).toBe(partitions.length);
        for (let i = 0; i < partitions.length; i++) {
            const replicas = table.getReplicas(i);
            const copy = partitions[i]!.getReplicasCopy();
            expect(replicas).not.toBe(copy);
            for (let j = 0; j < MAX_REPLICA_COUNT; j++) {
                const r1 = copy[j] ?? null;
                const r2 = replicas[j] ?? null;
                if (r1 === null) {
                    expect(r2).toBeNull();
                } else {
                    expect(r1.equals(r2)).toBe(true);
                }
            }
        }
    });

    it('testIdentical', () => {
        const table = createRandomPartitionTable();
        expect(table.equals(table)).toBe(true);
    });

    it('testEquals', () => {
        const table1 = createRandomPartitionTable();
        const table2 = new PartitionTableView(extractPartitions(table1));
        expect(table1.equals(table2)).toBe(true);
        expect(table1.hashCode()).toBe(table2.hashCode());
    });

    it('testEquals_whenSingleReplicaIsDifferent', () => {
        const table1 = createRandomPartitionTable();
        const partitions = extractPartitions(table1);
        const replicas = table1.getReplicas(0);
        const replica = replicas[0]!;
        const newAddr = new Address(replica.address().host, replica.address().port + 1);
        replicas[0] = new PartitionReplica(newAddr, newUUID());
        partitions[0] = new ReadonlyInternalPartition(replicas, 0, (partitions[0] as ReadonlyInternalPartition).version());
        const table2 = new PartitionTableView(partitions);
        expect(table1.equals(table2)).toBe(false);
    });

    it('testDistanceIsZero_whenSame', () => {
        const table1 = createRandomPartitionTable();
        const partitions = extractPartitions(table1);
        const table2 = new PartitionTableView(partitions);
        expect(table2.distanceOf(table1)).toBe(0);
    });

    it('testDistance_whenReplicasExchanged', () => {
        // distanceOf([A, B, C], [B, A, C]) == 2
        const table1 = createRandomPartitionTable();
        const partitions = extractPartitions(table1);
        const replicas = partitions[0]!.getReplicasCopy();
        const temp = replicas[0]!;
        replicas[0] = replicas[1]!;
        replicas[1] = temp;
        partitions[0] = new ReadonlyInternalPartition(replicas, 0, partitions[0]!.version());
        const table2 = new PartitionTableView(partitions);
        expect(table2.distanceOf(table1)).toBe(2);
    });

    it('testDistance_whenSomeReplicasNull', () => {
        // distanceOf([A, B, C, D...], [A, B, null...]) == count(null) * MAX_REPLICA_COUNT
        const table1 = createRandomPartitionTable();
        const partitions = extractPartitions(table1);
        const replicas = partitions[0]!.getReplicasCopy();
        for (let i = 3; i < MAX_REPLICA_COUNT; i++) {
            replicas[i] = null as unknown as PartitionReplica;
        }
        partitions[0] = new ReadonlyInternalPartition(replicas, 0, partitions[0]!.version());
        const table2 = new PartitionTableView(partitions);
        expect(table2.distanceOf(table1)).toBe((MAX_REPLICA_COUNT - 3) * MAX_REPLICA_COUNT);
    });
});
