/**
 * Tests for ClusterHeartbeatManager + SplitBrainDetector — Block 16.A3
 *
 * Covers:
 * - Heartbeat received → failure detector records, member not suspected
 * - Heartbeat timeout → member suspected
 * - Clock drift detection → heartbeat timestamps reset
 * - HeartbeatOp received from unknown member → rejected
 * - Master heartbeat cycle → all members receive heartbeat
 * - Cooperative yielding tests
 * - SplitBrainDetector quorum logic
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ClusterHeartbeatManager } from '@zenystx/core/internal/cluster/impl/ClusterHeartbeatManager';
import { SplitBrainDetector } from '@zenystx/core/internal/cluster/impl/SplitBrainDetector';
import { ClusterServiceImpl } from '@zenystx/core/internal/cluster/impl/ClusterServiceImpl';
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberVersion } from '@zenystx/core/version/MemberVersion';
import { MembersView } from '@zenystx/core/internal/cluster/impl/MembersView';
import { BuildInfoProvider } from '@zenystx/core/instance/BuildInfoProvider';
import { DeadlineClusterFailureDetector } from '@zenystx/core/internal/cluster/impl/DeadlineClusterFailureDetector';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());

function newMember(port: number, uuid?: string, local = false): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(VERSION)
        .uuid(uuid ?? crypto.randomUUID())
        .localMember(local)
        .build();
}

// ── DeadlineClusterFailureDetector tests ───────────────────────────────────

describe('DeadlineClusterFailureDetector', () => {
    test('member is alive when heartbeat is recent', () => {
        const fd = new DeadlineClusterFailureDetector(60_000);
        const memberUuid = crypto.randomUUID();
        const now = Date.now();
        fd.heartbeat(memberUuid, now);
        expect(fd.isAlive(memberUuid, now + 1000)).toBe(true);
    });

    test('member is not alive when heartbeat times out', () => {
        const fd = new DeadlineClusterFailureDetector(60_000);
        const memberUuid = crypto.randomUUID();
        const now = Date.now();
        fd.heartbeat(memberUuid, now);
        expect(fd.isAlive(memberUuid, now + 61_000)).toBe(false);
    });

    test('member with no heartbeat is not alive', () => {
        const fd = new DeadlineClusterFailureDetector(60_000);
        const memberUuid = crypto.randomUUID();
        expect(fd.isAlive(memberUuid, Date.now())).toBe(false);
    });

    test('reset clears all heartbeat timestamps', () => {
        const fd = new DeadlineClusterFailureDetector(60_000);
        const uuid1 = crypto.randomUUID();
        const uuid2 = crypto.randomUUID();
        const now = Date.now();
        fd.heartbeat(uuid1, now);
        fd.heartbeat(uuid2, now);
        fd.reset(now + 1000);
        // After reset, members should get a fresh timestamp at reset time
        expect(fd.isAlive(uuid1, now + 1000 + 59_000)).toBe(true);
        expect(fd.isAlive(uuid1, now + 1000 + 61_000)).toBe(false);
    });

    test('remove removes a specific member', () => {
        const fd = new DeadlineClusterFailureDetector(60_000);
        const uuid = crypto.randomUUID();
        fd.heartbeat(uuid, Date.now());
        fd.remove(uuid);
        expect(fd.isAlive(uuid, Date.now())).toBe(false);
    });
});

// ── ClusterHeartbeatManager tests ──────────────────────────────────────────

describe('ClusterHeartbeatManager', () => {
    let localMember: MemberImpl;
    let clusterService: ClusterServiceImpl;
    let heartbeatManager: ClusterHeartbeatManager;

    beforeEach(() => {
        localMember = newMember(5701, 'local-uuid', true);
        clusterService = new ClusterServiceImpl(localMember);
        heartbeatManager = new ClusterHeartbeatManager(clusterService, {
            heartbeatIntervalMillis: 5000,
            maxNoHeartbeatMillis: 60_000,
        });
    });

    afterEach(() => {
        heartbeatManager.shutdown();
    });

    test('onHeartbeat records heartbeat and member is not suspected', () => {
        const remote = newMember(5702, 'remote-uuid');
        // Add remote to cluster (version 2 to pass version gate on singleton v1)
        clusterService.setMasterAddress(localMember.getAddress());
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.updateMembers(view, localMember.getAddress());

        heartbeatManager.onHeartbeat(remote, Date.now());
        expect(heartbeatManager.isMemberAlive(remote)).toBe(true);
    });

    test('member is suspected when heartbeat times out', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        // Record heartbeat in the past beyond timeout
        const pastTime = Date.now() - 70_000;
        heartbeatManager.onHeartbeat(remote, pastTime);

        // Now check suspicion
        const suspected = heartbeatManager.suspectMemberIfNotHeartBeating(remote, Date.now());
        expect(suspected).toBe(true);
        expect(clusterService.isMemberSuspected(remote)).toBe(true);
    });

    test('heartbeat from unknown member is rejected', () => {
        const unknown = newMember(5799, 'unknown-uuid');
        // Don't add unknown to cluster — should be rejected
        expect(() => heartbeatManager.onHeartbeat(unknown, Date.now())).toThrow();
    });

    test('clock drift detection resets heartbeat timestamps', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        // Record a heartbeat
        const baseTime = Date.now();
        heartbeatManager.onHeartbeat(remote, baseTime);

        // Simulate a clock jump > CLOCK_JUMP_THRESHOLD (120s)
        heartbeatManager.checkClockDrift(baseTime + 130_000);

        // After reset, the member should have a fresh timestamp at jump time
        // so it should be alive at jump_time + 59s
        expect(heartbeatManager.isMemberAlive(remote, baseTime + 130_000 + 59_000)).toBe(true);
    });

    test('no clock drift reset when jump is small', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        const baseTime = Date.now();
        heartbeatManager.onHeartbeat(remote, baseTime);

        // Small time advance (< CLOCK_JUMP_THRESHOLD)
        heartbeatManager.checkClockDrift(baseTime + 10_000);

        // Member should still be alive based on original heartbeat
        expect(heartbeatManager.isMemberAlive(remote, baseTime + 10_000)).toBe(true);
    });

    test('suspectMemberIfNotHeartBeating returns false for alive member', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        heartbeatManager.onHeartbeat(remote, Date.now());
        const suspected = heartbeatManager.suspectMemberIfNotHeartBeating(remote, Date.now());
        expect(suspected).toBe(false);
    });

    test('heartbeat clears suspicion on member', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        // Suspect the member
        clusterService.suspectMember(remote);
        expect(clusterService.isMemberSuspected(remote)).toBe(true);

        // Heartbeat should clear suspicion
        heartbeatManager.onHeartbeat(remote, Date.now());
        expect(clusterService.isMemberSuspected(remote)).toBe(false);
    });

    test('init starts periodic heartbeat interval', async () => {
        // Create with short interval for testing
        const fastManager = new ClusterHeartbeatManager(clusterService, {
            heartbeatIntervalMillis: 50,
            maxNoHeartbeatMillis: 60_000,
        });

        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        // Mark as joined and master
        clusterService.setJoined(true);

        // Track sent heartbeats
        const sentTo: string[] = [];
        fastManager.onHeartbeatSent((member) => sentTo.push(member.getUuid()));

        fastManager.init();
        await Bun.sleep(120);
        fastManager.shutdown();

        // At least one heartbeat cycle should have run
        expect(sentTo.length).toBeGreaterThanOrEqual(1);
    });

    test('heartbeat does nothing when not joined', () => {
        const remote = newMember(5702, 'remote-uuid');
        const view = MembersView.createNew(2, [localMember, remote]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());

        // Not joined — heartbeat cycle should be no-op
        const sentTo: string[] = [];
        heartbeatManager.onHeartbeatSent((member) => sentTo.push(member.getUuid()));
        heartbeatManager.runHeartbeatCycle();
        expect(sentTo.length).toBe(0);
    });

    test('master heartbeat cycle sends to all non-local members', () => {
        const remote1 = newMember(5702, 'remote-1');
        const remote2 = newMember(5703, 'remote-2');
        const view = MembersView.createNew(2, [localMember, remote1, remote2]);
        clusterService.setMasterAddress(localMember.getAddress());
        clusterService.updateMembers(view, localMember.getAddress());
        clusterService.setJoined(true);

        const sentTo: string[] = [];
        heartbeatManager.onHeartbeatSent((member) => sentTo.push(member.getUuid()));
        heartbeatManager.runHeartbeatCycle();

        expect(sentTo.sort()).toEqual(['remote-1', 'remote-2'].sort());
    });
});

// ── SplitBrainDetector tests ───────────────────────────────────────────────

describe('SplitBrainDetector', () => {
    test('quorum maintained: 3 reachable of 3 total → not read-only', () => {
        const detector = new SplitBrainDetector(3);
        detector.onMemberReachable('a');
        detector.onMemberReachable('b');
        detector.onMemberReachable('c');
        expect(detector.isReadOnly()).toBe(false);
    });

    test('quorum lost: 1 reachable of 3 total → read-only', () => {
        const detector = new SplitBrainDetector(3);
        detector.onMemberReachable('a');
        detector.onMemberReachable('b');
        detector.onMemberReachable('c');

        detector.onMemberUnreachable('b');
        detector.onMemberUnreachable('c');
        expect(detector.isReadOnly()).toBe(true);
    });

    test('quorum regained: member recovers → read-only cleared', () => {
        const detector = new SplitBrainDetector(3);
        detector.onMemberReachable('a');
        detector.onMemberReachable('b');
        detector.onMemberReachable('c');

        detector.onMemberUnreachable('b');
        detector.onMemberUnreachable('c');
        expect(detector.isReadOnly()).toBe(true);

        detector.onMemberReachable('b');
        expect(detector.isReadOnly()).toBe(false);
    });

    test('single-node cluster: quorum = 1, always satisfies quorum', () => {
        const detector = new SplitBrainDetector(1);
        detector.onMemberReachable('a');
        expect(detector.isReadOnly()).toBe(false);
    });

    test('membership change: adding a member raises quorum size', () => {
        const detector = new SplitBrainDetector(3);
        detector.onMemberReachable('a');
        detector.onMemberReachable('b');
        detector.onMemberReachable('c');
        expect(detector.isReadOnly()).toBe(false);

        // Total becomes 4 → quorum = 3. Lose 2 → 2 reachable < 3
        detector.updateTotalMembers(4);
        detector.onMemberUnreachable('c');
        detector.onMemberUnreachable('b');
        expect(detector.isReadOnly()).toBe(true);
    });

    test('mutating operation rejected while in read-only mode', () => {
        const detector = new SplitBrainDetector(3);
        detector.onMemberReachable('a');
        // Only 1 reachable of 3 → read-only
        expect(detector.isReadOnly()).toBe(true);
        expect(() => detector.checkNotReadOnly()).toThrow(/read-only/i);
    });

    test('quorum formula: floor(N/2) + 1', () => {
        // 5 members → quorum = 3
        const detector = new SplitBrainDetector(5);
        detector.onMemberReachable('a');
        detector.onMemberReachable('b');
        detector.onMemberReachable('c');
        expect(detector.isReadOnly()).toBe(false);

        detector.onMemberUnreachable('c');
        // 2 reachable < 3 quorum
        expect(detector.isReadOnly()).toBe(true);
    });
});
