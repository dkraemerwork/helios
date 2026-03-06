/**
 * Tests for MembershipManager — Block 16.A2
 *
 * Covers:
 * - updateMembers: adds new members, removes departed, handles UUID change (restart)
 * - Version gate: rejects older or same-version updates
 * - suspectMember: adds to suspected set, triggers mastership claim
 * - shouldClaimMastership: correct only when all prior members suspected
 * - Mastership claim lifecycle (DecideNewMembersViewTask)
 * - Finding 19: FetchMembersViewOp receiver rejects if it doesn't suspect all prior members
 * - Finding 20: UUID change triggers partition table repair
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MembershipManager } from '@zenystx/core/internal/cluster/impl/MembershipManager';
import { ClusterServiceImpl } from '@zenystx/core/internal/cluster/impl/ClusterServiceImpl';
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/core/cluster/Address';
import { MemberVersion } from '@zenystx/core/version/MemberVersion';
import { MembersView } from '@zenystx/core/internal/cluster/impl/MembersView';
import { BuildInfoProvider } from '@zenystx/core/instance/BuildInfoProvider';

const VERSION = MemberVersion.of(BuildInfoProvider.getBuildInfo().getVersion());

function newMember(port: number, uuid?: string, local = false): MemberImpl {
    return new MemberImpl.Builder(new Address('127.0.0.1', port))
        .version(VERSION)
        .uuid(uuid ?? crypto.randomUUID())
        .localMember(local)
        .build();
}

describe('MembershipManager', () => {
    let localMember: MemberImpl;
    let clusterService: ClusterServiceImpl;
    let manager: MembershipManager;

    beforeEach(() => {
        localMember = newMember(5701, 'local-uuid', true);
        clusterService = new ClusterServiceImpl(localMember);
        clusterService.setMasterAddress(localMember.getAddress());
        manager = new MembershipManager(clusterService, localMember);
    });

    // ── updateMembers ──────────────────────────────────────────────────────

    describe('updateMembers', () => {
        test('adds new members from incoming MembersView', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);

            manager.updateMembers(view);

            const memberMap = manager.getMemberMap();
            expect(memberMap.size()).toBe(2);
            expect(memberMap.getMemberByUuid('member-2')).not.toBeNull();
        });

        test('removes departed members', () => {
            // First add m2
            const m2 = newMember(5702, 'member-2');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);
            expect(manager.getMemberMap().size()).toBe(2);

            // Then update without m2
            const view2 = MembersView.createNew(3, [localMember]);
            manager.updateMembers(view2);
            expect(manager.getMemberMap().size()).toBe(1);
            expect(manager.getMemberMap().getMemberByUuid('member-2')).toBeNull();
        });

        test('detects member restart (same address, new UUID)', () => {
            const m2 = newMember(5702, 'old-uuid');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);

            // Same address, different UUID = restart
            const m2Restarted = newMember(5702, 'new-uuid');
            const view2 = MembersView.createNew(3, [localMember, m2Restarted]);
            manager.updateMembers(view2);

            const memberMap = manager.getMemberMap();
            expect(memberMap.size()).toBe(2);
            expect(memberMap.getMemberByUuid('old-uuid')).toBeNull();
            expect(memberMap.getMemberByUuid('new-uuid')).not.toBeNull();
        });

        test('fires added members list for new members', () => {
            const added: MemberImpl[] = [];
            manager.onMembersAdded((members: MemberImpl[]) => { added.push(...members); });

            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            expect(added.length).toBe(1);
            expect(added[0]!.getUuid()).toBe('member-2');
        });

        test('fires removed members list for departed members', () => {
            const removed: MemberImpl[] = [];
            manager.onMembersRemoved((members) => { removed.push(...members); });

            const m2 = newMember(5702, 'member-2');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);

            const view2 = MembersView.createNew(3, [localMember]);
            manager.updateMembers(view2);

            expect(removed.length).toBe(1);
            expect(removed[0]!.getUuid()).toBe('member-2');
        });
    });

    // ── Version gate ───────────────────────────────────────────────────────

    describe('version gate', () => {
        test('rejects update with older version', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            // Try to apply an older version
            const staleView = MembersView.createNew(1, [localMember]);
            expect(() => manager.updateMembers(staleView)).toThrow(/stale/i);
        });

        test('rejects update with same version', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            const sameVersionView = MembersView.createNew(2, [localMember]);
            expect(() => manager.updateMembers(sameVersionView)).toThrow(/stale/i);
        });

        test('accepts update with higher version', () => {
            const m2 = newMember(5702, 'member-2');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);

            const view2 = MembersView.createNew(3, [localMember, m2]);
            expect(() => manager.updateMembers(view2)).not.toThrow();
        });
    });

    // ── suspectMember ──────────────────────────────────────────────────────

    describe('suspectMember', () => {
        test('adds member to suspected set', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            manager.suspectMember(m2);
            expect(manager.isMemberSuspected(m2)).toBeTrue();
        });

        test('suspected member cleared after new members view excludes it', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            manager.suspectMember(m2);
            expect(manager.isMemberSuspected(m2)).toBeTrue();

            // Update removes m2 — suspicion should be cleared
            const view2 = MembersView.createNew(3, [localMember]);
            manager.updateMembers(view2);
            expect(manager.isMemberSuspected(m2)).toBeFalse();
        });
    });

    // ── shouldClaimMastership ──────────────────────────────────────────────

    describe('shouldClaimMastership', () => {
        test('returns false when no members are suspected', () => {
            const m1 = newMember(5701, 'master-uuid');
            const m2 = newMember(5702, 'second-uuid', true);
            const m3 = newMember(5703, 'third-uuid');
            const cs = new ClusterServiceImpl(m2);
            cs.setMasterAddress(m1.getAddress());
            const mgr = new MembershipManager(cs, m2);

            const view = MembersView.createNew(2, [m1, m2, m3]);
            mgr.updateMembers(view);

            expect(mgr.shouldClaimMastership()).toBeFalse();
        });

        test('returns true when all prior members are suspected', () => {
            const m1 = newMember(5701, 'master-uuid');
            const m2 = newMember(5702, 'second-uuid', true);
            const m3 = newMember(5703, 'third-uuid');
            const cs = new ClusterServiceImpl(m2);
            cs.setMasterAddress(m1.getAddress());
            const mgr = new MembershipManager(cs, m2);

            const view = MembersView.createNew(2, [m1, m2, m3]);
            mgr.updateMembers(view);

            mgr.suspectMember(m1);
            expect(mgr.shouldClaimMastership()).toBeTrue();
        });

        test('returns false when only some prior members are suspected', () => {
            const m1 = newMember(5701, 'first-uuid');
            const m2 = newMember(5702, 'second-uuid');
            const m3 = newMember(5703, 'third-uuid', true);
            const cs = new ClusterServiceImpl(m3);
            cs.setMasterAddress(m1.getAddress());
            const mgr = new MembershipManager(cs, m3);

            const view = MembersView.createNew(2, [m1, m2, m3]);
            mgr.updateMembers(view);

            mgr.suspectMember(m1);
            // m2 is NOT suspected, so m3 cannot claim mastership
            expect(mgr.shouldClaimMastership()).toBeFalse();
        });

        test('first member in list never claims mastership (is already master)', () => {
            // localMember is first in list = master
            expect(manager.shouldClaimMastership()).toBeFalse();
        });
    });

    // ── sendMemberListToOthers ─────────────────────────────────────────────

    describe('sendMemberListToOthers', () => {
        test('generates MembersView from current member map', () => {
            const m2 = newMember(5702, 'member-2');
            const view = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view);

            const published = manager.buildMembersView();
            expect(published.size()).toBe(2);
            expect(published.getVersion()).toBe(2);
        });
    });

    // ── Finding 19: FetchMembersViewOp validation ──────────────────────────

    describe('Finding 19 — FetchMembersViewOp receiver validation', () => {
        test('validateMastershipClaim rejects if receiver does not suspect all prior members', () => {
            const m1 = newMember(5701, 'first-uuid');
            const m2 = newMember(5702, 'second-uuid', true);
            const m3 = newMember(5703, 'third-uuid');
            const cs = new ClusterServiceImpl(m2);
            cs.setMasterAddress(m1.getAddress());
            const mgr = new MembershipManager(cs, m2);

            const view = MembersView.createNew(2, [m1, m2, m3]);
            mgr.updateMembers(view);

            // m3 claims mastership but m2 hasn't suspected m1
            expect(mgr.validateMastershipClaim(m3)).toBeFalse();
        });

        test('validateMastershipClaim accepts if receiver suspects all prior members', () => {
            const m1 = newMember(5701, 'first-uuid');
            const m2 = newMember(5702, 'second-uuid', true);
            const m3 = newMember(5703, 'third-uuid');
            const cs = new ClusterServiceImpl(m2);
            cs.setMasterAddress(m1.getAddress());
            const mgr = new MembershipManager(cs, m2);

            const view = MembersView.createNew(2, [m1, m2, m3]);
            mgr.updateMembers(view);

            // m2 suspects m1, m3 claims: m2 validates all before m3 are suspected
            mgr.suspectMember(m1);
            // m3 claims: all members before m3 in list are m1 (suspected) and m2 (local = not suspected but irrelevant — we check members before the candidate)
            expect(mgr.validateMastershipClaim(m3)).toBeTrue();
        });
    });

    // ── Finding 20: UUID change triggers partition table repair ─────────────

    describe('Finding 20 — partition table repair on UUID change', () => {
        test('UUID change fires partition repair callback', () => {
            const repairs: Array<{ oldUuid: string; newUuid: string }> = [];
            manager.onPartitionTableRepair((oldUuid, newUuid) => {
                repairs.push({ oldUuid, newUuid });
            });

            const m2 = newMember(5702, 'old-uuid');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);

            const m2Restarted = newMember(5702, 'new-uuid');
            const view2 = MembersView.createNew(3, [localMember, m2Restarted]);
            manager.updateMembers(view2);

            expect(repairs.length).toBe(1);
            expect(repairs[0]!.oldUuid).toBe('old-uuid');
            expect(repairs[0]!.newUuid).toBe('new-uuid');
        });
    });

    // ── missingMembers tracking ────────────────────────────────────────────

    describe('missingMembers', () => {
        test('removed members are tracked in missingMembersRef', () => {
            const m2 = newMember(5702, 'member-2');
            const view1 = MembersView.createNew(2, [localMember, m2]);
            manager.updateMembers(view1);

            const view2 = MembersView.createNew(3, [localMember]);
            manager.updateMembers(view2);

            expect(manager.getMissingMembers().has('member-2')).toBeTrue();
        });
    });
});
