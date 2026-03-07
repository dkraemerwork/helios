/**
 * Tests for ClusterServiceImpl + ClusterStateManager — Block 16.A1
 *
 * Covers:
 * - ClusterServiceImpl lifecycle (init, joined state, master state)
 * - Member lookup by address and UUID
 * - Cluster state transitions (ACTIVE → FROZEN → PASSIVE)
 * - State transition rejected during migration (stamp mismatch)
 * - Finding 1: FinalizeJoinOp preJoinOp runs before updateMembers
 * - Finding 13: Cluster state change rejected during active migration / stamp mismatch
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import { BuildInfoProvider } from '@zenystx/helios-core/instance/BuildInfoProvider';
import { ClusterState } from '@zenystx/helios-core/internal/cluster/ClusterState';
import { ClusterServiceImpl } from '@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl';
import { ClusterStateManager } from '@zenystx/helios-core/internal/cluster/impl/ClusterStateManager';
import { MembersView } from '@zenystx/helios-core/internal/cluster/impl/MembersView';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';
import { beforeEach, describe, expect, test } from 'bun:test';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());

function newMember(port: number, uuid?: string): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(VERSION)
        .uuid(uuid ?? crypto.randomUUID())
        .build();
}

// ── ClusterStateManager tests ────────────────────────────────────────────────

describe('ClusterStateManager', () => {
    let stateManager: ClusterStateManager;

    beforeEach(() => {
        stateManager = new ClusterStateManager();
    });

    test('initial state is ACTIVE', () => {
        expect(stateManager.getState()).toBe(ClusterState.ACTIVE);
    });

    test('transition ACTIVE → NO_MIGRATION', () => {
        stateManager.setState(ClusterState.NO_MIGRATION);
        expect(stateManager.getState()).toBe(ClusterState.NO_MIGRATION);
    });

    test('transition ACTIVE → FROZEN', () => {
        stateManager.setState(ClusterState.FROZEN);
        expect(stateManager.getState()).toBe(ClusterState.FROZEN);
    });

    test('transition ACTIVE → PASSIVE', () => {
        stateManager.setState(ClusterState.PASSIVE);
        expect(stateManager.getState()).toBe(ClusterState.PASSIVE);
    });

    test('transition FROZEN → ACTIVE', () => {
        stateManager.setState(ClusterState.FROZEN);
        stateManager.setState(ClusterState.ACTIVE);
        expect(stateManager.getState()).toBe(ClusterState.ACTIVE);
    });

    test('transition PASSIVE → ACTIVE', () => {
        stateManager.setState(ClusterState.PASSIVE);
        stateManager.setState(ClusterState.ACTIVE);
        expect(stateManager.getState()).toBe(ClusterState.ACTIVE);
    });

    test('cannot transition to IN_TRANSITION directly', () => {
        expect(() => stateManager.setState(ClusterState.IN_TRANSITION))
            .toThrow();
    });

    test('checkMigrationsAndPartitionStateStamp rejects on stamp mismatch', () => {
        // Provide a stamp that differs from the current partition state stamp
        const wrongStamp = 999n;
        const currentStamp = 0n;
        expect(() => stateManager.checkMigrationsAndPartitionStateStamp(wrongStamp, currentStamp, false))
            .toThrow();
    });

    test('checkMigrationsAndPartitionStateStamp rejects during active migration', () => {
        const stamp = 42n;
        expect(() => stateManager.checkMigrationsAndPartitionStateStamp(stamp, stamp, true))
            .toThrow();
    });

    test('checkMigrationsAndPartitionStateStamp succeeds when stamps match and no migration', () => {
        const stamp = 42n;
        expect(() => stateManager.checkMigrationsAndPartitionStateStamp(stamp, stamp, false))
            .not.toThrow();
    });
});

// ── ClusterServiceImpl tests ─────────────────────────────────────────────────

describe('ClusterServiceImpl', () => {
    let localMember: MemberImpl;
    let clusterService: ClusterServiceImpl;

    beforeEach(() => {
        localMember = newMember(5701);
        clusterService = new ClusterServiceImpl(localMember);
    });

    test('initial state: not joined, local member set', () => {
        expect(clusterService.isJoined()).toBe(false);
        expect(clusterService.getLocalMember()).toBe(localMember);
    });

    test('initial master address is null', () => {
        expect(clusterService.getMasterAddress()).toBeNull();
    });

    test('isMaster returns false when not master', () => {
        expect(clusterService.isMaster()).toBe(false);
    });

    test('getMembers returns only local member initially', () => {
        const members = clusterService.getMembers();
        expect(members.length).toBe(1);
        expect(members[0]!.getAddress().equals(localMember.getAddress())).toBe(true);
    });

    test('getMember by address returns local member', () => {
        const found = clusterService.getMember(localMember.getAddress());
        expect(found).not.toBeNull();
        expect(found!.getUuid()).toBe(localMember.getUuid());
    });

    test('getMember by UUID returns local member', () => {
        const found = clusterService.getMemberByUuid(localMember.getUuid());
        expect(found).not.toBeNull();
        expect(found!.getAddress().equals(localMember.getAddress())).toBe(true);
    });

    test('getMember by unknown address returns null', () => {
        const found = clusterService.getMember(new Address('10.0.0.1', 9999));
        expect(found).toBeNull();
    });

    test('getMemberByUuid for unknown UUID returns null', () => {
        const found = clusterService.getMemberByUuid('nonexistent-uuid');
        expect(found).toBeNull();
    });

    test('getClusterState returns ACTIVE initially', () => {
        expect(clusterService.getClusterState()).toBe(ClusterState.ACTIVE);
    });

    test('setClusterState transitions state', () => {
        clusterService.setClusterState(ClusterState.FROZEN);
        expect(clusterService.getClusterState()).toBe(ClusterState.FROZEN);
    });

    // ── updateMembers ────────────────────────────────────────────────────────

    test('updateMembers adds new members', async () => {
        const member2 = newMember(5702);
        const view = MembersView.createNew(2, [localMember, member2]);

        // Set master to local so sender validation passes
        clusterService.setMasterAddress(localMember.getAddress());
        await clusterService.updateMembers(view, localMember.getAddress());

        expect(clusterService.getMembers().length).toBe(2);
        expect(clusterService.getMember(member2.getAddress())).not.toBeNull();
    });

    test('updateMembers rejects if sender is not master', async () => {
        const member2 = newMember(5702);
        const view = MembersView.createNew(2, [localMember, member2]);

        clusterService.setMasterAddress(localMember.getAddress());
        await expect(
            clusterService.updateMembers(view, member2.getAddress())
        ).rejects.toThrow();
    });

    test('updateMembers rejects stale version', async () => {
        const member2 = newMember(5702);
        clusterService.setMasterAddress(localMember.getAddress());

        // First update to version 2
        const view1 = MembersView.createNew(2, [localMember, member2]);
        await clusterService.updateMembers(view1, localMember.getAddress());

        // Attempt update with same or older version
        const staleView = MembersView.createNew(1, [localMember]);
        await expect(
            clusterService.updateMembers(staleView, localMember.getAddress())
        ).rejects.toThrow();
    });

    // ── finalizeJoin ─────────────────────────────────────────────────────────

    test('finalizeJoin sets joined to true', async () => {
        const masterMember = newMember(5700);
        const view = MembersView.createNew(1, [masterMember, localMember]);

        clusterService.setMasterAddress(masterMember.getAddress());
        await clusterService.finalizeJoin(
            view,
            ClusterState.ACTIVE,
            null,
            crypto.randomUUID(),
            Date.now()
        );

        expect(clusterService.isJoined()).toBe(true);
    });

    test('finalizeJoin: preJoinOp runs before member list is updated (Finding 1)', async () => {
        let memberCountDuringPreJoin = -1;

        class TrackingPreJoinOp extends Operation {
            async run(): Promise<void> {
                // During preJoinOp, member list should still be the OLD one (just local member)
                memberCountDuringPreJoin = clusterService.getMembers().length;
            }
        }

        const masterMember = newMember(5700);
        const member2 = newMember(5702);
        const view = MembersView.createNew(1, [masterMember, localMember, member2]);

        clusterService.setMasterAddress(masterMember.getAddress());
        await clusterService.finalizeJoin(
            view,
            ClusterState.ACTIVE,
            new TrackingPreJoinOp(),
            crypto.randomUUID(),
            Date.now()
        );

        // preJoinOp saw only the local member (old state)
        expect(memberCountDuringPreJoin).toBe(1);
        // After finalize, all 3 members are visible
        expect(clusterService.getMembers().length).toBe(3);
    });

    // ── suspectMember ────────────────────────────────────────────────────────

    test('suspectMember adds to suspected set', () => {
        const member2 = newMember(5702);
        clusterService.suspectMember(member2);
        expect(clusterService.isMemberSuspected(member2)).toBe(true);
    });

    // ── isMaster ─────────────────────────────────────────────────────────────

    test('isMaster returns true when local member is master', () => {
        clusterService.setMasterAddress(localMember.getAddress());
        expect(clusterService.isMaster()).toBe(true);
    });

    test('isMaster returns false when different member is master', () => {
        clusterService.setMasterAddress(new Address('10.0.0.1', 5701));
        expect(clusterService.isMaster()).toBe(false);
    });

    // ── cluster state change with stamp validation (Finding 13) ─────────────

    test('cluster state change rejected during active migration', () => {
        // Simulate migrations in progress
        clusterService.setMigrationsInProgress(true);
        expect(() => clusterService.setClusterState(ClusterState.FROZEN, 0n))
            .toThrow();
    });

    test('cluster state change rejected on stamp mismatch', () => {
        const wrongStamp = 999n;
        expect(() => clusterService.setClusterState(ClusterState.FROZEN, wrongStamp))
            .toThrow();
    });
});
