/**
 * Port of {@code com.hazelcast.internal.cluster.impl.MembershipManager}.
 *
 * Manages the canonical member list, suspected members, mastership claims,
 * and member lifecycle events. Wired into ClusterServiceImpl as a sub-manager.
 *
 * Ref: MembershipManager.java (1,531 lines)
 */
import { MemberImpl } from '@zenystx/helios-core/cluster/impl/MemberImpl';
import { MemberMap } from '@zenystx/helios-core/internal/cluster/impl/MemberMap';
import { MembersView } from '@zenystx/helios-core/internal/cluster/impl/MembersView';
import type { ClusterServiceImpl } from '@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl';

type MemberListCallback = (members: MemberImpl[]) => void;
type PartitionRepairCallback = (oldUuid: string, newUuid: string) => void;

export class MembershipManager {
    private readonly _clusterService: ClusterServiceImpl;
    private readonly _localMember: MemberImpl;
    private _memberMap: MemberMap;
    private readonly _suspectedMembers: Set<string> = new Set(); // member UUIDs
    private readonly _missingMembers: Map<string, MemberImpl> = new Map(); // uuid → member
    private _mastershipClaimInProgress = false;

    // Event callbacks
    private readonly _addedCallbacks: MemberListCallback[] = [];
    private readonly _removedCallbacks: MemberListCallback[] = [];
    private readonly _repairCallbacks: PartitionRepairCallback[] = [];

    constructor(clusterService: ClusterServiceImpl, localMember: MemberImpl) {
        this._clusterService = clusterService;
        this._localMember = localMember;
        this._memberMap = MemberMap.singleton(localMember);
    }

    // ── Event registration ─────────────────────────────────────────────────

    onMembersAdded(cb: MemberListCallback): void {
        this._addedCallbacks.push(cb);
    }

    onMembersRemoved(cb: MemberListCallback): void {
        this._removedCallbacks.push(cb);
    }

    /** Finding 20: callback when a member restarts (same address, new UUID). */
    onPartitionTableRepair(cb: PartitionRepairCallback): void {
        this._repairCallbacks.push(cb);
    }

    // ── updateMembers ──────────────────────────────────────────────────────

    /**
     * Core member update. Compares current MemberMap to incoming MembersView,
     * detects additions, removals, and UUID changes (restarts).
     *
     * Step 0 (version gate): reject if incomingVersion <= currentVersion.
     * Ref: ClusterServiceImpl.java:491-522
     */
    updateMembers(membersView: MembersView): void {
        // Version gate
        const currentVersion = this._memberMap.getVersion();
        if (membersView.getVersion() <= currentVersion) {
            throw new Error(
                `Rejecting stale member update: incoming version ${membersView.getVersion()} ` +
                `<= current version ${currentVersion}`,
            );
        }

        const oldMap = this._memberMap;
        const newMemberMap = membersView.toMemberMap();

        // Detect added, removed, and UUID-changed members
        const addedMembers: MemberImpl[] = [];
        const removedMembers: MemberImpl[] = [];

        // Find removed members (in old but not in new)
        for (const oldMember of oldMap.getMembers()) {
            if (!newMemberMap.containsUuid(oldMember.getUuid())) {
                removedMembers.push(oldMember);
                this._missingMembers.set(oldMember.getUuid(), oldMember);
            }
        }

        // Find added members and detect UUID changes (Finding 20)
        for (const newMember of newMemberMap.getMembers()) {
            if (!oldMap.containsUuid(newMember.getUuid())) {
                addedMembers.push(newMember);

                // Check if same address existed with different UUID (restart)
                const oldByAddr = oldMap.getMemberByAddress(newMember.getAddress());
                if (oldByAddr !== null && oldByAddr.getUuid() !== newMember.getUuid()) {
                    for (const cb of this._repairCallbacks) {
                        cb(oldByAddr.getUuid(), newMember.getUuid());
                    }
                }
            }
        }

        // Update the member map
        this._memberMap = newMemberMap;

        // Clear suspicions for removed members
        for (const removed of removedMembers) {
            this._suspectedMembers.delete(removed.getUuid());
        }

        // Fire events
        if (removedMembers.length > 0) {
            for (const cb of this._removedCallbacks) {
                cb(removedMembers);
            }
        }
        if (addedMembers.length > 0) {
            for (const cb of this._addedCallbacks) {
                cb(addedMembers);
            }
        }
    }

    // ── Suspect management ─────────────────────────────────────────────────

    suspectMember(member: MemberImpl): void {
        this._suspectedMembers.add(member.getUuid());
    }

    isMemberSuspected(member: MemberImpl): boolean {
        return this._suspectedMembers.has(member.getUuid());
    }

    // ── Mastership claim ───────────────────────────────────────────────────

    /**
     * Returns true if all members before this node in the member list are suspected.
     * First member (master) never claims mastership — it already is master.
     */
    shouldClaimMastership(): boolean {
        const members = [...this._memberMap.getMembers()];
        let foundPrior = false;
        for (const m of members) {
            if (m.getUuid() === this._localMember.getUuid()) {
                // Reached self — all prior members must have been suspected
                return foundPrior;
            }
            if (!this._suspectedMembers.has(m.getUuid())) {
                return false; // found a non-suspected prior member
            }
            foundPrior = true;
        }
        return false; // self not in list
    }

    /**
     * Finding 19: Validates a mastership claim from a candidate.
     * The receiver checks that all members before the candidate in its own
     * member list are suspected. If not, the claim is rejected.
     */
    validateMastershipClaim(candidate: MemberImpl): boolean {
        const members = [...this._memberMap.getMembers()];
        for (const m of members) {
            if (m.getUuid() === candidate.getUuid()) {
                return true; // reached candidate — all prior are suspected
            }
            if (m.getUuid() === this._localMember.getUuid()) {
                continue; // skip self
            }
            if (!this._suspectedMembers.has(m.getUuid())) {
                return false; // found a non-suspected prior member
            }
        }
        return false; // candidate not in list
    }

    // ── Accessors ──────────────────────────────────────────────────────────

    getMemberMap(): MemberMap {
        return this._memberMap;
    }

    getMissingMembers(): Map<string, MemberImpl> {
        return this._missingMembers;
    }

    /** Builds a MembersView from the current member map for publishing. */
    buildMembersView(): MembersView {
        return MembersView.createNew(this._memberMap.getVersion(), this._memberMap.getMembers());
    }
}
