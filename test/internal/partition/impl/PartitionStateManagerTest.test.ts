/**
 * Tests for PartitionStateManager — Block 16.B1.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { PartitionStateManager } from '@zenystx/helios-core/internal/partition/impl/PartitionStateManager';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { Address } from '@zenystx/helios-core/cluster/Address';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';

function makeReplica(port: number): PartitionReplica {
    return new PartitionReplica(
        new Address('127.0.0.1', port),
        `uuid-${port}`,
    );
}

function makeMember(port: number): { getAddress(): Address; getUuid(): string; isLiteMember(): boolean } {
    const addr = new Address('127.0.0.1', port);
    return {
        getAddress: () => addr,
        getUuid: () => `uuid-${port}`,
        isLiteMember: () => false,
    };
}

describe('PartitionStateManager', () => {
    const PARTITION_COUNT = 271;
    let psm: PartitionStateManager;

    beforeEach(() => {
        psm = new PartitionStateManager(PARTITION_COUNT);
    });

    it('should not be initialized before assignment', () => {
        expect(psm.isInitialized()).toBe(false);
    });

    describe('initializePartitionAssignments', () => {
        it('should assign all partitions an owner with a single member', () => {
            const members = [makeMember(5701)] as any[];
            psm.initializePartitionAssignments(members);

            expect(psm.isInitialized()).toBe(true);
            for (let i = 0; i < PARTITION_COUNT; i++) {
                const owner = psm.getPartitionOwner(i);
                expect(owner).not.toBeNull();
                expect(owner!.address().port).toBe(5701);
            }
        });

        it('should distribute owners across multiple members (round-robin)', () => {
            const members = [makeMember(5701), makeMember(5702), makeMember(5703)] as any[];
            psm.initializePartitionAssignments(members);

            const ownerCounts = new Map<number, number>();
            for (let i = 0; i < PARTITION_COUNT; i++) {
                const owner = psm.getPartitionOwner(i);
                expect(owner).not.toBeNull();
                const port = owner!.address().port;
                ownerCounts.set(port, (ownerCounts.get(port) ?? 0) + 1);
            }
            // Each member should own roughly PARTITION_COUNT/3 partitions
            for (const [, count] of ownerCounts) {
                expect(count).toBeGreaterThanOrEqual(Math.floor(PARTITION_COUNT / 3));
                expect(count).toBeLessThanOrEqual(Math.ceil(PARTITION_COUNT / 3));
            }
        });

        it('should assign backup replicas on different members than owner', () => {
            const members = [makeMember(5701), makeMember(5702), makeMember(5703)] as any[];
            psm.initializePartitionAssignments(members, 1);

            for (let i = 0; i < PARTITION_COUNT; i++) {
                const owner = psm.getPartitionOwner(i);
                const backup = psm.getPartition(i).getReplica(1);
                expect(owner).not.toBeNull();
                expect(backup).not.toBeNull();
                expect(owner!.equals(backup)).toBe(false);
            }
        });

        it('should not assign backup replicas when only one member exists', () => {
            const members = [makeMember(5701)] as any[];
            psm.initializePartitionAssignments(members, 1);

            for (let i = 0; i < PARTITION_COUNT; i++) {
                const owner = psm.getPartitionOwner(i);
                expect(owner).not.toBeNull();
                const backup = psm.getPartition(i).getReplica(1);
                expect(backup).toBeNull();
            }
        });
    });

    describe('repartition', () => {
        it('should redistribute partitions when a member is added', () => {
            const members = [makeMember(5701), makeMember(5702)] as any[];
            psm.initializePartitionAssignments(members);

            const newMembers = [makeMember(5701), makeMember(5702), makeMember(5703)] as any[];
            const newAssignment = psm.repartition(newMembers, []);

            // New assignment should include the new member as an owner somewhere
            const newMemberUuid = `uuid-5703`;
            let hasNewMember = false;
            for (const replicas of newAssignment) {
                if (replicas[0] && replicas[0].uuid() === newMemberUuid) {
                    hasNewMember = true;
                    break;
                }
            }
            expect(hasNewMember).toBe(true);
        });

        it('should reassign orphaned partitions when a member is removed', () => {
            const members = [makeMember(5701), makeMember(5702), makeMember(5703)] as any[];
            psm.initializePartitionAssignments(members);

            const remaining = [makeMember(5701), makeMember(5702)] as any[];
            const excluded = [makeMember(5703)] as any[];
            const newAssignment = psm.repartition(remaining, excluded);

            // No partition should be owned by the excluded member
            const excludedUuid = `uuid-5703`;
            for (const replicas of newAssignment) {
                if (replicas[0]) {
                    expect(replicas[0].uuid()).not.toBe(excludedUuid);
                }
            }
            // All partitions should have owners
            for (const replicas of newAssignment) {
                expect(replicas[0]).not.toBeNull();
            }
        });
    });

    describe('getPartitionId', () => {
        it('should return deterministic partition ID for same key', () => {
            const buf = Buffer.alloc(HeapData.DATA_OFFSET + 4);
            buf.writeInt32BE(-1, HeapData.TYPE_OFFSET); // type
            buf.writeInt32BE(0, HeapData.TYPE_OFFSET + 4); // partition hash placeholder
            buf.writeInt32BE(42, HeapData.DATA_OFFSET); // payload
            const data = new HeapData(buf);

            const id1 = psm.getPartitionId(data);
            const id2 = psm.getPartitionId(data);
            expect(id1).toBe(id2);
            expect(id1).toBeGreaterThanOrEqual(0);
            expect(id1).toBeLessThan(PARTITION_COUNT);
        });

        it('should distribute keys across partitions', () => {
            const seen = new Set<number>();
            for (let k = 0; k < 1000; k++) {
                const buf = Buffer.alloc(HeapData.DATA_OFFSET + 4);
                buf.writeInt32BE(-1, HeapData.TYPE_OFFSET);
                buf.writeInt32BE(0, HeapData.TYPE_OFFSET + 4);
                buf.writeInt32BE(k, HeapData.DATA_OFFSET);
                const data = new HeapData(buf);
                seen.add(psm.getPartitionId(data));
            }
            // Should hit at least 100 distinct partitions with 1000 keys
            expect(seen.size).toBeGreaterThan(100);
        });
    });

    describe('state stamp', () => {
        it('should change when partition versions change', () => {
            const members = [makeMember(5701), makeMember(5702)] as any[];
            psm.initializePartitionAssignments(members);

            const stamp1 = psm.getStateStamp();

            // Modify a partition (change its replica to bump version)
            const partition = psm.getPartition(0);
            partition.setReplica(0, makeReplica(5702));

            psm.updateStamp();
            const stamp2 = psm.getStateStamp();

            expect(stamp1).not.toBe(stamp2);
        });

        it('should be consistent when partitions are unchanged', () => {
            const members = [makeMember(5701)] as any[];
            psm.initializePartitionAssignments(members);

            const stamp1 = psm.getStateStamp();
            psm.updateStamp();
            const stamp2 = psm.getStateStamp();

            expect(stamp1).toBe(stamp2);
        });
    });

    describe('toPartitionTableView', () => {
        it('should create an immutable snapshot of partition state', () => {
            const members = [makeMember(5701), makeMember(5702)] as any[];
            psm.initializePartitionAssignments(members);

            const view = psm.toPartitionTableView();
            expect(view.length()).toBe(PARTITION_COUNT);

            // Owner in view should match state manager
            for (let i = 0; i < PARTITION_COUNT; i++) {
                const expected = psm.getPartitionOwner(i);
                const actual = view.getReplica(i, 0);
                if (expected) {
                    expect(actual).not.toBeNull();
                    expect(actual!.equals(expected)).toBe(true);
                }
            }
        });
    });
});
