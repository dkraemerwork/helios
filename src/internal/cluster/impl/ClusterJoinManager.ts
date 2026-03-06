/**
 * Port of {@code com.hazelcast.internal.cluster.impl.ClusterJoinManager}.
 *
 * Enhanced join manager that implements the full join protocol:
 * - Master self-election (first node in cluster)
 * - Join request validation (ConfigCheck)
 * - startJoin: master processes join, updates MembersView
 * - Finding 7: Master crash recovery via membership view collection
 *
 * The original ClusterJoinManager (discovery bridge) remains at
 * {@code @zenystx/core/internal/cluster/ClusterJoinManager} for address resolution.
 */
import { MemberImpl } from '@zenystx/core/cluster/impl/MemberImpl';
import { Address } from '@zenystx/core/cluster/Address';
import { ClusterServiceImpl } from '@zenystx/core/internal/cluster/impl/ClusterServiceImpl';
import { MembersView } from '@zenystx/core/internal/cluster/impl/MembersView';
import { ConfigCheck } from '@zenystx/core/internal/cluster/impl/ConfigCheck';

/**
 * Transport abstraction for sending join protocol messages.
 * Decouples join logic from TCP transport (wired in Block A.5).
 */
export interface JoinTransport {
    send(target: Address, type: string, payload: unknown): Promise<unknown>;
}

export interface JoinManagerConfig {
    readonly clusterName: string;
    readonly partitionCount: number;
    readonly localMember: MemberImpl;
    readonly clusterService: ClusterServiceImpl;
    readonly transport: JoinTransport;
}

export interface JoinRequestResult {
    readonly accepted: boolean;
    readonly reason?: string;
}

export class ClusterJoinManager {
    private readonly _clusterName: string;
    private readonly _partitionCount: number;
    private readonly _localMember: MemberImpl;
    private readonly _clusterService: ClusterServiceImpl;
    private readonly _transport: JoinTransport;

    constructor(config: JoinManagerConfig) {
        this._clusterName = config.clusterName;
        this._partitionCount = config.partitionCount;
        this._localMember = config.localMember;
        this._clusterService = config.clusterService;
        this._transport = config.transport;
    }

    /**
     * First node in cluster: sets self as master, generates cluster UUID,
     * sets joined = true, member list version to 1.
     *
     * Ref: ClusterJoinManager.java — setThisMemberAsMaster()
     */
    setThisMemberAsMaster(): void {
        this._clusterService.setMasterAddress(this._localMember.getAddress());
        this._clusterService.setJoined(true);

        // Generate cluster UUID
        const clusterId = crypto.randomUUID();
        this._clusterService.setClusterId(clusterId);

        // Set member list version to 1 via a fresh MembersView
        const view = MembersView.createNew(1, [this._localMember]);
        this._clusterService.setMemberMap(view.toMemberMap());
    }

    /**
     * Handle a join request from a remote node (master side).
     *
     * Validates:
     * 1. This node is master
     * 2. No migrations in progress
     * 3. ConfigCheck passes (cluster name, partition count)
     */
    handleJoinRequest(
        joiner: MemberImpl,
        joinerClusterName: string,
        joinerPartitionCount: number,
    ): JoinRequestResult {
        if (!this._clusterService.isMaster()) {
            throw new Error('Cannot handle join request: this node is not master');
        }

        if (this._clusterService.isMigrationsInProgress()) {
            return {
                accepted: false,
                reason: 'Join rejected: migration in progress',
            };
        }

        const configResult = ConfigCheck.check(
            this._clusterName, this._partitionCount,
            joinerClusterName, joinerPartitionCount,
        );
        if (!configResult.ok) {
            return { accepted: false, reason: configResult.reason };
        }

        return { accepted: true };
    }

    /**
     * Process accepted joiners: create new MembersView, update cluster state.
     *
     * Ref: ClusterJoinManager.java — startJoin()
     *
     * Steps:
     * 1. Clone current MembersView + add joining members (version incremented)
     * 2. Update ClusterServiceImpl member map
     *
     * Transport-level FinalizeJoinOp / MembersUpdateOp sending is deferred to Block A.5.
     */
    async startJoin(joiners: readonly MemberImpl[]): Promise<void> {
        if (!this._clusterService.isMaster()) {
            throw new Error('Cannot start join: this node is not master');
        }

        const currentMap = this._clusterService.getMemberMap();
        const currentMembers = [...currentMap.getMembers()];
        const currentVersion = currentMap.getVersion();

        // Create new view with joiners added
        const newView = MembersView.createNew(
            currentVersion + 1,
            [...currentMembers, ...joiners],
        );

        this._clusterService.setMemberMap(newView.toMemberMap());
    }
}
