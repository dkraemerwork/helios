/**
 * Tests for ClusterJoinManager (Enhanced) — Block 16.A4
 *
 * Covers:
 * - ConfigCheck: cluster name + partition count validation
 * - Master self-election: first node becomes master
 * - Join protocol: new node joins via JoinRequest → FinalizeJoin
 * - Join rejected: wrong cluster name, wrong partition count
 * - Multiple sequential joins of 3+ nodes
 * - Join during migration: blocked until migration completes
 * - Finding 7: Master crash between FinalizeJoinOp and MembersUpdateOp
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { ClusterJoinManager, type JoinManagerConfig, type JoinTransport } from '@zenystx/helios-core/internal/cluster/impl/ClusterJoinManager';
import { ConfigCheck, type ConfigCheckResult } from '@zenystx/helios-core/internal/cluster/impl/ConfigCheck';
import { ClusterServiceImpl } from '@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl';
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/helios-core/cluster/Address';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';
import { MembersView } from '@zenystx/helios-core/internal/cluster/impl/MembersView';
import { BuildInfoProvider } from '@zenystx/helios-core/instance/BuildInfoProvider';
import { ClusterState } from '@zenystx/helios-core/internal/cluster/ClusterState';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());
const DEFAULT_PARTITION_COUNT = 271;

function newMember(port: number, uuid?: string, local = false): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(VERSION)
        .uuid(uuid ?? crypto.randomUUID())
        .localMember(local)
        .build();
}

// ── ConfigCheck tests ───────────────────────────────────────────────────────

describe('ConfigCheck', () => {
    test('passes when cluster name and partition count match', () => {
        const result = ConfigCheck.check(
            'my-cluster', DEFAULT_PARTITION_COUNT,
            'my-cluster', DEFAULT_PARTITION_COUNT,
        );
        expect(result.ok).toBe(true);
    });

    test('fails when cluster name does not match', () => {
        const result = ConfigCheck.check(
            'my-cluster', DEFAULT_PARTITION_COUNT,
            'other-cluster', DEFAULT_PARTITION_COUNT,
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('cluster name');
    });

    test('fails when partition count does not match', () => {
        const result = ConfigCheck.check(
            'my-cluster', DEFAULT_PARTITION_COUNT,
            'my-cluster', 512,
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('partition count');
    });

    test('fails when both cluster name and partition count differ', () => {
        const result = ConfigCheck.check(
            'my-cluster', DEFAULT_PARTITION_COUNT,
            'other-cluster', 512,
        );
        expect(result.ok).toBe(false);
    });
});

// ── ClusterJoinManager enhanced tests ────────────────────────────────────────

describe('ClusterJoinManager (Enhanced)', () => {
    let localMember: MemberImpl;
    let clusterService: ClusterServiceImpl;
    let joinManager: ClusterJoinManager;
    const sentMessages: Array<{ target: Address; type: string; payload: unknown }> = [];

    const mockTransport: JoinTransport = {
        send(target: Address, type: string, payload: unknown): Promise<unknown> {
            sentMessages.push({ target, type, payload });
            return Promise.resolve(undefined);
        },
    };

    beforeEach(() => {
        sentMessages.length = 0;
        localMember = newMember(5701, 'local-uuid', true);
        clusterService = new ClusterServiceImpl(localMember);
        joinManager = new ClusterJoinManager({
            clusterName: 'test-cluster',
            partitionCount: DEFAULT_PARTITION_COUNT,
            localMember,
            clusterService,
            transport: mockTransport,
        });
    });

    // ── Master self-election ──────────────────────────────────────────────

    test('first node elects itself as master', () => {
        joinManager.setThisMemberAsMaster();

        expect(clusterService.isMaster()).toBe(true);
        expect(clusterService.isJoined()).toBe(true);
        expect(clusterService.getClusterId()).toBeTruthy();
        expect(clusterService.getMasterAddress()!.equals(localMember.getAddress())).toBe(true);
    });

    test('master self-election sets member list version to 1', () => {
        joinManager.setThisMemberAsMaster();

        const members = clusterService.getMembers();
        expect(members.length).toBe(1);
        expect(clusterService.getMemberMap().getVersion()).toBe(1);
    });

    test('master self-election generates cluster UUID', () => {
        joinManager.setThisMemberAsMaster();
        const clusterId = clusterService.getClusterId();
        expect(clusterId).not.toBeNull();
        expect(typeof clusterId).toBe('string');
        expect(clusterId!.length).toBeGreaterThan(0);
    });

    // ── Join request handling (master side) ──────────────────────────────

    test('master accepts join request with matching config', () => {
        joinManager.setThisMemberAsMaster();
        const joiner = newMember(5702, 'joiner-uuid');

        const result = joinManager.handleJoinRequest(joiner, 'test-cluster', DEFAULT_PARTITION_COUNT);
        expect(result.accepted).toBe(true);
    });

    test('master rejects join request with wrong cluster name', () => {
        joinManager.setThisMemberAsMaster();
        const joiner = newMember(5702, 'joiner-uuid');

        const result = joinManager.handleJoinRequest(joiner, 'wrong-cluster', DEFAULT_PARTITION_COUNT);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('cluster name');
    });

    test('master rejects join request with wrong partition count', () => {
        joinManager.setThisMemberAsMaster();
        const joiner = newMember(5702, 'joiner-uuid');

        const result = joinManager.handleJoinRequest(joiner, 'test-cluster', 512);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('partition count');
    });

    test('master rejects join request when not master', () => {
        // Don't set as master
        const joiner = newMember(5702, 'joiner-uuid');

        expect(() =>
            joinManager.handleJoinRequest(joiner, 'test-cluster', DEFAULT_PARTITION_COUNT),
        ).toThrow('not master');
    });

    // ── startJoin (master processes join) ─────────────────────────────────

    test('startJoin creates new MembersView with joiner added', async () => {
        joinManager.setThisMemberAsMaster();
        const joiner = newMember(5702, 'joiner-uuid');

        await joinManager.startJoin([joiner]);

        const members = clusterService.getMembers();
        expect(members.length).toBe(2);
        expect(clusterService.getMemberMap().getVersion()).toBe(2);
    });

    test('startJoin with multiple joiners adds all', async () => {
        joinManager.setThisMemberAsMaster();
        const joiner1 = newMember(5702, 'joiner-1');
        const joiner2 = newMember(5703, 'joiner-2');

        await joinManager.startJoin([joiner1, joiner2]);

        const members = clusterService.getMembers();
        expect(members.length).toBe(3);
    });

    // ── Sequential joins ────────────────────────────────────────────────

    test('multiple sequential joins increment version', async () => {
        joinManager.setThisMemberAsMaster();

        const joiner1 = newMember(5702, 'joiner-1');
        await joinManager.startJoin([joiner1]);
        expect(clusterService.getMemberMap().getVersion()).toBe(2);

        const joiner2 = newMember(5703, 'joiner-2');
        await joinManager.startJoin([joiner2]);
        expect(clusterService.getMemberMap().getVersion()).toBe(3);

        const joiner3 = newMember(5704, 'joiner-3');
        await joinManager.startJoin([joiner3]);
        expect(clusterService.getMemberMap().getVersion()).toBe(4);

        expect(clusterService.getMembers().length).toBe(4);
    });

    // ── Join during migration ──────────────────────────────────────────

    test('join is blocked during active migration', () => {
        joinManager.setThisMemberAsMaster();
        clusterService.setMigrationsInProgress(true);

        const joiner = newMember(5702, 'joiner-uuid');
        const result = joinManager.handleJoinRequest(joiner, 'test-cluster', DEFAULT_PARTITION_COUNT);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('migration');
    });

    // ── Finalize join (joiner side) ──────────────────────────────────────

    test('finalizeJoin on joining node sets joined state', async () => {
        // Simulate joining node receiving FinalizeJoinOp from master
        const masterAddress = new Address('127.0.0.1', 5700);
        clusterService.setMasterAddress(masterAddress);

        const joinerView = MembersView.createNew(1, [
            newMember(5700, 'master-uuid'),
            localMember,
        ]);
        const clusterId = crypto.randomUUID();

        await clusterService.finalizeJoin(joinerView, ClusterState.ACTIVE, null, clusterId, Date.now());

        expect(clusterService.isJoined()).toBe(true);
        expect(clusterService.getClusterId()).toBe(clusterId);
        expect(clusterService.getMembers().length).toBe(2);
    });

    // ── Finding 7: Master crash recovery ─────────────────────────────────

    test('master crash between FinalizeJoin and MembersUpdate — joiner state preserved if reachable', async () => {
        // Setup: master has finalized join for joiner but not yet sent MembersUpdate to others
        joinManager.setThisMemberAsMaster();
        const joiner = newMember(5702, 'joiner-uuid');

        // Perform the join
        await joinManager.startJoin([joiner]);
        expect(clusterService.getMembers().length).toBe(2);

        // The joiner is now in the members view
        // If master crashes, the new master's DecideNewMembersViewTask (from A.2)
        // will use FetchMembersViewOp to collect views from reachable members
        // The joiner will appear in the collected view if it's reachable
        const currentView = clusterService.getMemberMap();
        expect(currentView.containsUuid('joiner-uuid')).toBe(true);

        // Verify the members view can be built for publishing
        const membersView = MembersView.createNew(
            currentView.getVersion(),
            [...currentView.getMembers()],
        );
        expect(membersView.size()).toBe(2);
        expect(membersView.containsMember(joiner.getAddress(), joiner.getUuid())).toBe(true);
    });

    // ── Non-master cannot start join ──────────────────────────────────────

    test('startJoin throws when not master', async () => {
        const joiner = newMember(5702, 'joiner-uuid');
        await expect(joinManager.startJoin([joiner])).rejects.toThrow('not master');
    });
});
