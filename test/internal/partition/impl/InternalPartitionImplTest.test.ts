/**
 * Port of com.hazelcast.internal.partition.impl.InternalPartitionImplTest
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { PartitionReplicaInterceptor } from '@zenystx/helios-core/internal/partition/PartitionReplicaInterceptor';
import { InternalPartitionImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionImpl';
import { beforeEach, describe, expect, it } from 'bun:test';

const MAX_REPLICA_COUNT = 7;

function newAddress(port: number): Address {
    return new Address('127.0.0.1', 5000 + port);
}

function newUUID(): string {
    return crypto.randomUUID();
}

class TestPartitionReplicaInterceptor implements PartitionReplicaInterceptor {
    eventCount = 0;
    replicaChanged(_partitionId: number, _replicaIndex: number, _oldReplica: PartitionReplica | null, _newReplica: PartitionReplica | null): void {
        this.eventCount++;
    }
    reset(): void { this.eventCount = 0; }
}

describe('InternalPartitionImplTest', () => {
    const localReplica = new PartitionReplica(newAddress(5000), newUUID());
    const replicaOwners: (PartitionReplica | null)[] = new Array(MAX_REPLICA_COUNT).fill(null);
    let partitionListener: TestPartitionReplicaInterceptor;
    let partition: InternalPartitionImpl;

    beforeEach(() => {
        partitionListener = new TestPartitionReplicaInterceptor();
        partition = new InternalPartitionImpl(1, localReplica, partitionListener);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) replicaOwners[i] = null;
    });

    it('testIsLocal_whenOwnedByThis', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partition.isLocal()).toBe(true);
    });

    it('testIsLocal_whenNOTOwnedByThis', () => {
        replicaOwners[0] = new PartitionReplica(newAddress(6000), newUUID());
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partition.isLocal()).toBe(false);
        expect(partition.version()).toBe(1);
    });

    it('testGetOwnerOrNull_whenOwnerExists', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partition.getOwnerReplicaOrNull()?.equals(localReplica)).toBe(true);
        expect(partition.getOwnerOrNull()?.equals(localReplica.address())).toBe(true);
    });

    it('testGetOwnerOrNull_whenOwnerNOTExists', () => {
        expect(partition.getOwnerOrNull()).toBeNull();
    });

    it('testVersion_setReplicas', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partition.version()).toBe(1);

        const newReplicas = [...replicaOwners] as PartitionReplica[];
        newReplicas[0] = new PartitionReplica(newAddress(6000), newUUID());
        newReplicas[1] = localReplica;
        partition.setReplicas(newReplicas);
        expect(partition.version()).toBe(3);
    });

    it('testVersion_setReplica', () => {
        partition.setReplica(1, new PartitionReplica(newAddress(6000), newUUID()));
        expect(partition.version()).toBe(1);

        partition.setReplica(0, new PartitionReplica(newAddress(7000), newUUID()));
        expect(partition.version()).toBe(2);

        // setting same replica at index 0 — no change
        partition.setReplica(0, partition.getReplica(0)!);
        expect(partition.version()).toBe(2);
    });

    it('testVersion_swapReplica', () => {
        partition.setReplica(1, new PartitionReplica(newAddress(6000), newUUID()));
        partition.setReplica(0, new PartitionReplica(newAddress(7000), newUUID()));

        partition.swapReplicas(1, 0);
        expect(partition.version()).toBe(4);
    });

    it('testGetReplicaAddress', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);

        expect(partition.getReplica(0)?.equals(localReplica)).toBe(true);
        expect(partition.getReplicaAddress(0)?.equals(localReplica.address())).toBe(true);
        for (let i = 1; i < MAX_REPLICA_COUNT; i++) {
            expect(partition.getReplica(i)).toBeNull();
            expect(partition.getReplicaAddress(i)).toBeNull();
        }
    });

    it('testSetInitialReplicaAddresses', () => {
        for (let i = 0; i < replicaOwners.length; i++) {
            replicaOwners[i] = new PartitionReplica(newAddress(5000 + i), newUUID());
        }
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            expect(partition.getReplica(i)?.equals(replicaOwners[i]!)).toBe(true);
        }
    });

    it('testSetReplicaAddresses', () => {
        for (let i = 0; i < replicaOwners.length; i++) {
            replicaOwners[i] = new PartitionReplica(newAddress(5000 + i), newUUID());
        }
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            expect(partition.getReplica(i)?.equals(replicaOwners[i]!)).toBe(true);
        }
    });

    it('testSetReplicaAddresses_afterInitialSet', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        partition.setReplicas(replicaOwners as PartitionReplica[]);
    });

    it('testSetReplicaAddresses_multipleTimes', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        partition.setReplicas(replicaOwners as PartitionReplica[]);
    });

    it('testSetReplicaAddresses_ListenerShouldBeCalled', () => {
        replicaOwners[0] = localReplica;
        replicaOwners[1] = new PartitionReplica(newAddress(5001), newUUID());
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partitionListener.eventCount).toBe(2);
    });

    it('testListenerShouldNOTBeCalled_whenReplicaRemainsSame', () => {
        replicaOwners[0] = localReplica;
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        partitionListener.reset();
        partition.setReplicas(replicaOwners as PartitionReplica[]);
        expect(partitionListener.eventCount).toBe(0);
    });

    it('testIsOwnerOrBackup', () => {
        replicaOwners[0] = localReplica;
        const otherAddress = newAddress(5001);
        replicaOwners[1] = new PartitionReplica(otherAddress, newUUID());
        partition.setReplicas(replicaOwners as PartitionReplica[]);

        expect(partition.isOwnerOrBackupReplica(replicaOwners[0]!)).toBe(true);
        expect(partition.isOwnerOrBackupReplica(localReplica)).toBe(true);
        expect(partition.isOwnerOrBackupReplica(replicaOwners[1]!)).toBe(true);
        expect(partition.isOwnerOrBackupAddress(otherAddress)).toBe(true);
        expect(partition.isOwnerOrBackupReplica(new PartitionReplica(newAddress(6000), newUUID()))).toBe(false);
        expect(partition.isOwnerOrBackupAddress(newAddress(6000))).toBe(false);
    });

    it('testGetReplicaIndex', () => {
        replicaOwners[0] = localReplica;
        replicaOwners[1] = new PartitionReplica(newAddress(5001), newUUID());
        partition.setReplicas(replicaOwners as PartitionReplica[]);

        expect(partition.getReplicaIndex(replicaOwners[0]!)).toBe(0);
        expect(partition.getReplicaIndex(replicaOwners[1]!)).toBe(1);
        expect(partition.getReplicaIndex(new PartitionReplica(newAddress(6000), newUUID()))).toBe(-1);
    });

    it('testReset', () => {
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            replicaOwners[i] = new PartitionReplica(newAddress(5000 + i), newUUID());
        }
        partition.setReplicas(replicaOwners as PartitionReplica[]);

        partition.reset(localReplica);
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            expect(partition.getReplicaAddress(i)).toBeNull();
        }
        expect(partition.isMigrating()).toBe(false);
        expect(partition.version()).toBe(0);
    });
});
