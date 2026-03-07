/**
 * Tests for InternalPartitionServiceImpl (Block 16.B2).
 * Covers partition table lifecycle, membership-triggered rebalancing,
 * applyPartitionRuntimeState, and partition query methods.
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import type { Member } from '@zenystx/helios-core/cluster/Member';
import { InternalPartitionImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionImpl';
import { InternalPartitionServiceImpl, PartitionRuntimeState } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';
import { beforeEach, describe, expect, test } from 'bun:test';

function makeMember(host: string, port: number, uuid?: string, lite = false): Member {
    return new MemberImpl.Builder(new Address(host, port))
        .uuid(uuid ?? crypto.randomUUID())
        .version(MemberVersion.of(1, 0, 0))
        .liteMember(lite)
        .localMember(false)
        .build();
}

const PARTITION_COUNT = 271;

describe('InternalPartitionServiceImpl', () => {
    let masterAddress: Address;
    let master: Member;
    let service: InternalPartitionServiceImpl;

    beforeEach(() => {
        masterAddress = new Address('127.0.0.1', 5701);
        master = makeMember('127.0.0.1', 5701, 'master-uuid');
        service = new InternalPartitionServiceImpl(PARTITION_COUNT);
    });

    // ─── firstArrangement ───────────────────────────────────────

    test('firstArrangement assigns all partitions on master', () => {
        const members = [master];
        service.firstArrangement(members, masterAddress);

        expect(service.isInitialized()).toBe(true);
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = service.getPartitionOwner(i);
            expect(owner).not.toBeNull();
            expect(owner!.uuid()).toBe('master-uuid');
        }
    });

    test('firstArrangement distributes partitions across multiple members', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        const m2 = makeMember('127.0.0.1', 5702, 'uuid-2');
        const m3 = makeMember('127.0.0.1', 5703, 'uuid-3');
        const members = [m1, m2, m3];

        service.firstArrangement(members, m1.getAddress());

        const counts = new Map<string, number>();
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = service.getPartitionOwner(i);
            expect(owner).not.toBeNull();
            counts.set(owner!.uuid(), (counts.get(owner!.uuid()) ?? 0) + 1);
        }
        // Each member should own roughly 271/3 ≈ 90 partitions
        expect(counts.size).toBe(3);
        for (const [, count] of counts) {
            expect(count).toBeGreaterThanOrEqual(90);
            expect(count).toBeLessThanOrEqual(91);
        }
    });

    test('firstArrangement ignores lite members', () => {
        const data = makeMember('127.0.0.1', 5701, 'data-uuid');
        const lite = makeMember('127.0.0.1', 5702, 'lite-uuid', true);

        service.firstArrangement([data, lite], data.getAddress());

        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = service.getPartitionOwner(i);
            expect(owner).not.toBeNull();
            expect(owner!.uuid()).toBe('data-uuid');
        }
    });

    test('firstArrangement sets initialized to true', () => {
        expect(service.isInitialized()).toBe(false);
        service.firstArrangement([master], masterAddress);
        expect(service.isInitialized()).toBe(true);
    });

    // ─── memberAdded / memberRemoved ────────────────────────────

    test('memberAdded triggers rebalancing', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        service.firstArrangement([m1], m1.getAddress());

        // All partitions owned by m1
        for (let i = 0; i < PARTITION_COUNT; i++) {
            expect(service.getPartitionOwner(i)!.uuid()).toBe('uuid-1');
        }

        // Add a second member
        const m2 = makeMember('127.0.0.1', 5702, 'uuid-2');
        service.memberAdded([m1, m2]);

        // m2 should now own some partitions
        let m2Count = 0;
        for (let i = 0; i < PARTITION_COUNT; i++) {
            if (service.getPartitionOwner(i)?.uuid() === 'uuid-2') m2Count++;
        }
        expect(m2Count).toBeGreaterThan(0);
    });

    test('memberRemoved reassigns orphaned partitions', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        const m2 = makeMember('127.0.0.1', 5702, 'uuid-2');
        service.firstArrangement([m1, m2], m1.getAddress());

        // Remove m2
        service.memberRemoved(m2, [m1]);

        // All partitions should now be owned by m1
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const owner = service.getPartitionOwner(i);
            expect(owner).not.toBeNull();
            expect(owner!.uuid()).toBe('uuid-1');
        }
    });

    // ─── applyPartitionRuntimeState ─────────────────────────────

    test('applyPartitionRuntimeState applies newer state', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        service.firstArrangement([m1], m1.getAddress());

        // Build a runtime state with higher versions
        const replicas: (PartitionReplica | null)[][] = [];
        const m2Replica = new PartitionReplica(new Address('127.0.0.1', 5702), 'uuid-2');
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const arr = new Array(7).fill(null);
            arr[0] = m2Replica;
            replicas.push(arr);
        }
        const state: PartitionRuntimeState = {
            partitions: replicas,
            versions: new Array(PARTITION_COUNT).fill(10), // version 10 > current
        };

        const applied = service.applyPartitionRuntimeState(state, m1.getAddress());
        expect(applied).toBe(true);
        expect(service.isInitialized()).toBe(true);

        // All partitions should now point to uuid-2
        for (let i = 0; i < PARTITION_COUNT; i++) {
            expect(service.getPartitionOwner(i)!.uuid()).toBe('uuid-2');
        }
    });

    test('applyPartitionRuntimeState rejects older versions', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        service.firstArrangement([m1], m1.getAddress());

        // Manually bump partition 0 version high
        const p0 = service.getPartition(0) as InternalPartitionImpl;
        p0.setVersion(100);

        // Try to apply state with version 5 for partition 0
        const replicas: (PartitionReplica | null)[][] = [];
        const newReplica = new PartitionReplica(new Address('127.0.0.1', 5702), 'uuid-2');
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const arr = new Array(7).fill(null);
            arr[0] = newReplica;
            replicas.push(arr);
        }
        const state: PartitionRuntimeState = {
            partitions: replicas,
            versions: new Array(PARTITION_COUNT).fill(5),
        };

        service.applyPartitionRuntimeState(state, m1.getAddress());

        // Partition 0 should NOT have been updated (version 5 < 100)
        expect(service.getPartition(0).version()).toBe(100);
    });

    test('applyPartitionRuntimeState sets initialized', () => {
        expect(service.isInitialized()).toBe(false);

        const replicas: (PartitionReplica | null)[][] = [];
        const replica = new PartitionReplica(new Address('127.0.0.1', 5701), 'uuid-1');
        for (let i = 0; i < PARTITION_COUNT; i++) {
            const arr = new Array(7).fill(null);
            arr[0] = replica;
            replicas.push(arr);
        }
        const state: PartitionRuntimeState = {
            partitions: replicas,
            versions: new Array(PARTITION_COUNT).fill(1),
        };

        service.applyPartitionRuntimeState(state, new Address('127.0.0.1', 5701));
        expect(service.isInitialized()).toBe(true);
    });

    // ─── getPartition / getPartitionOwner / getMemberPartitions ─

    test('getPartition returns correct InternalPartition', () => {
        service.firstArrangement([master], masterAddress);
        const p = service.getPartition(0);
        expect(p).not.toBeNull();
        expect(p.getPartitionId()).toBe(0);
    });

    test('getPartitionOwner returns null before initialization', () => {
        expect(service.getPartitionOwner(0)).toBeNull();
    });

    test('getPartitionCount returns configured count', () => {
        expect(service.getPartitionCount()).toBe(PARTITION_COUNT);
    });

    test('getMemberPartitions returns all partition IDs owned by a member', () => {
        const m1 = makeMember('127.0.0.1', 5701, 'uuid-1');
        const m2 = makeMember('127.0.0.1', 5702, 'uuid-2');
        service.firstArrangement([m1, m2], m1.getAddress());

        const m1Partitions = service.getMemberPartitions(m1.getAddress());
        const m2Partitions = service.getMemberPartitions(m2.getAddress());

        expect(m1Partitions.length + m2Partitions.length).toBe(PARTITION_COUNT);
        expect(m1Partitions.length).toBeGreaterThan(0);
        expect(m2Partitions.length).toBeGreaterThan(0);
    });

    // ─── getPartitionId ─────────────────────────────────────────

    test('getPartitionId is deterministic', () => {
        const mockData = { getPartitionHash: () => 42 } as any;
        const id1 = service.getPartitionId(mockData);
        const id2 = service.getPartitionId(mockData);
        expect(id1).toBe(id2);
        expect(id1).toBeGreaterThanOrEqual(0);
        expect(id1).toBeLessThan(PARTITION_COUNT);
    });

    // ─── partition table view ───────────────────────────────────

    test('toPartitionTableView returns immutable snapshot', () => {
        service.firstArrangement([master], masterAddress);
        const view = service.toPartitionTableView();
        expect(view.length()).toBe(PARTITION_COUNT);
        expect(view.getReplica(0, 0)?.uuid()).toBe('master-uuid');
    });
});
