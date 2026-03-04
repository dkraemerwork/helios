/**
 * Port of {@code com.hazelcast.internal.cluster.impl.ClusterServiceImpl}.
 *
 * Orchestrates cluster membership, state transitions, and sub-managers.
 * This is the initial skeleton (Block A.1) — sub-managers (MembershipManager,
 * HeartbeatManager, JoinManager) are wired in later blocks.
 */
import type { Cluster } from '@helios/cluster/Cluster';
import type { Member } from '@helios/cluster/Member';
import { MemberImpl } from '@helios/cluster/impl/MemberImpl';
import { Address } from '@helios/cluster/Address';
import { MemberMap } from '@helios/internal/cluster/impl/MemberMap';
import { MembersView } from '@helios/internal/cluster/impl/MembersView';
import { ClusterState } from '@helios/internal/cluster/ClusterState';
import { ClusterStateManager } from '@helios/internal/cluster/impl/ClusterStateManager';
import type { Operation } from '@helios/spi/impl/operationservice/Operation';

export class ClusterServiceImpl implements Cluster {
    private readonly _localMember: MemberImpl;
    private readonly _stateManager: ClusterStateManager;
    private _memberMap: MemberMap;
    private _masterAddress: Address | null = null;
    private _joined = false;
    private _clusterId: string | null = null;
    private readonly _suspectedMembers: Set<string> = new Set(); // member UUIDs
    private _migrationsInProgress = false;
    private _partitionStateStamp: bigint = 0n;

    constructor(localMember: MemberImpl) {
        this._localMember = localMember;
        this._stateManager = new ClusterStateManager();
        this._memberMap = MemberMap.singleton(localMember);
    }

    // ── Cluster interface ────────────────────────────────────────────────────

    getMembers(): Member[] {
        return [...this._memberMap.getMembers()];
    }

    getLocalMember(): MemberImpl {
        return this._localMember;
    }

    // ── Member lookup ────────────────────────────────────────────────────────

    getMember(address: Address): MemberImpl | null {
        return this._memberMap.getMemberByAddress(address);
    }

    getMemberByUuid(uuid: string): MemberImpl | null {
        return this._memberMap.getMemberByUuid(uuid);
    }

    // ── Master ───────────────────────────────────────────────────────────────

    getMasterAddress(): Address | null {
        return this._masterAddress;
    }

    setMasterAddress(address: Address | null): void {
        this._masterAddress = address;
    }

    isMaster(): boolean {
        return this._masterAddress !== null
            && this._localMember.getAddress().equals(this._masterAddress);
    }

    // ── Joined state ─────────────────────────────────────────────────────────

    isJoined(): boolean {
        return this._joined;
    }

    setJoined(joined: boolean): void {
        this._joined = joined;
    }

    getClusterId(): string | null {
        return this._clusterId;
    }

    setClusterId(clusterId: string): void {
        this._clusterId = clusterId;
    }

    // ── Cluster state ────────────────────────────────────────────────────────

    getClusterState(): ClusterState {
        return this._stateManager.getState();
    }

    /**
     * Change cluster state with optional partition stamp validation.
     *
     * When expectedStamp is provided, validates against current partition state stamp
     * and checks that no migrations are in progress (Finding 13).
     */
    setClusterState(newState: ClusterState, expectedStamp?: bigint): void {
        if (expectedStamp !== undefined) {
            this._stateManager.checkMigrationsAndPartitionStateStamp(
                expectedStamp,
                this._partitionStateStamp,
                this._migrationsInProgress,
            );
        }
        this._stateManager.setState(newState);
    }

    // ── Partition state stamp (for Finding 13 validation) ────────────────────

    setPartitionStateStamp(stamp: bigint): void {
        this._partitionStateStamp = stamp;
    }

    setMigrationsInProgress(inProgress: boolean): void {
        this._migrationsInProgress = inProgress;
    }

    isMigrationsInProgress(): boolean {
        return this._migrationsInProgress;
    }

    // ── Suspect management ───────────────────────────────────────────────────

    suspectMember(member: Member): void {
        this._suspectedMembers.add(member.getUuid());
    }

    isMemberSuspected(member: Member): boolean {
        return this._suspectedMembers.has(member.getUuid());
    }

    clearSuspicion(member: Member): void {
        this._suspectedMembers.delete(member.getUuid());
    }

    // ── updateMembers ────────────────────────────────────────────────────────

    /**
     * Updates the member list from a MembersView received from the master.
     *
     * Validates:
     * 1. Sender is the current master
     * 2. Incoming version is newer than current (version gate — prevents stale updates)
     *
     * Ref: ClusterServiceImpl.java:491-522
     */
    async updateMembers(membersView: MembersView, senderAddress: Address): Promise<void> {
        // Validate sender is master
        if (this._masterAddress === null || !this._masterAddress.equals(senderAddress)) {
            throw new Error(
                `Rejecting member update from non-master ${senderAddress}: ` +
                `current master is ${this._masterAddress}`,
            );
        }

        // Version gate: reject stale or duplicate updates
        const currentVersion = this._memberMap.getVersion();
        if (membersView.getVersion() <= currentVersion) {
            throw new Error(
                `Rejecting stale member update: incoming version ${membersView.getVersion()} ` +
                `<= current version ${currentVersion}`,
            );
        }

        this._memberMap = membersView.toMemberMap();
    }

    // ── finalizeJoin ─────────────────────────────────────────────────────────

    /**
     * Called on a joining node when the master sends FinalizeJoinOp.
     *
     * Remediation — Finding 1 (CRITICAL): Pre-Join Operation Ordering
     * The preJoinOp MUST run before updateMembers to ensure the joining node
     * has complete state before participating in the cluster.
     *
     * Order:
     * 1. Validate master
     * 2. Run preJoinOp (if provided)
     * 3. Update member list
     * 4. Set joined = true
     */
    async finalizeJoin(
        membersView: MembersView,
        clusterState: ClusterState,
        preJoinOp: Operation | null,
        clusterId: string,
        _masterTime: number,
    ): Promise<void> {
        // Validate master address is set
        if (this._masterAddress === null) {
            throw new Error('Cannot finalize join: master address is not set');
        }

        // Step 2: Run preJoinOp BEFORE updating members (Finding 1)
        if (preJoinOp !== null) {
            await preJoinOp.run();
        }

        // Step 3: Update member list — bypass sender validation since this is finalize
        this._memberMap = membersView.toMemberMap();

        // Step 4: Set cluster state and joined
        this._stateManager.setState(clusterState);
        this._clusterId = clusterId;
        this._joined = true;
    }

    // ── MemberMap access (for sub-managers) ──────────────────────────────────

    getMemberMap(): MemberMap {
        return this._memberMap;
    }

    setMemberMap(memberMap: MemberMap): void {
        this._memberMap = memberMap;
    }
}
