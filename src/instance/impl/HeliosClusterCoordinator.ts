import { Address } from "@zenystx/helios-core/cluster/Address";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import { MemberImpl } from "@zenystx/helios-core/cluster/impl/MemberImpl";
import type {
  BlitzNodeRegisterMsg,
  BlitzNodeRemoveMsg,
  BlitzTopologyRequestMsg,
  ClusterMessage,
  FinalizeJoinMsg,
  MembersUpdateMsg,
  PartitionStateMsg,
  WireMemberInfo,
  WirePartitionReplica,
} from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { HeliosBlitzCoordinator } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzCoordinator";
import { ClusterJoinManager } from "@zenystx/helios-core/internal/cluster/impl/ClusterJoinManager";
import { ClusterServiceImpl } from "@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl";
import { MembersView } from "@zenystx/helios-core/internal/cluster/impl/MembersView";
import { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import { PartitionReplica } from "@zenystx/helios-core/internal/partition/PartitionReplica";
import type { PartitionRuntimeState } from "@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl";
import { InternalPartitionServiceImpl } from "@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

type MembershipListener = () => void;
type MemberRemovedListener = (memberId: string) => void;
interface BlitzCoordinatorListener {
  onAuthorityChanged?(state: {
    masterMemberId: string | null;
    memberListVersion: number;
    isMaster: boolean;
    joined: boolean;
    memberIds: string[];
  }): void;
  onTopologyResponse?(state: {
    routes: string[];
    registrationsComplete: boolean;
    clientConnectUrl?: string;
    retryAfterMs?: number;
  }): void;
  onTopologyAnnounce?(state: { routes: string[] }): void;
  onTopologyRegistrationChanged?(): void;
  onDemotion?(): void;
}
const DEFAULT_CLUSTER_NAME = "helios";

export class HeliosClusterCoordinator {
  private readonly _localAddress: Address;
  private readonly _localMember: MemberImpl;
  private readonly _clusterService: ClusterServiceImpl;
  private readonly _joinManager: ClusterJoinManager;
  private readonly _partitionService = new InternalPartitionServiceImpl();
  private readonly _membershipListeners: MembershipListener[] = [];
  private readonly _memberRemovedListeners: MemberRemovedListener[] = [];
  private readonly _blitzCoordinatorListeners: BlitzCoordinatorListener[] = [];
  private readonly _joinRequestedPeers = new Set<string>();
  private readonly _connectedPeers = new Set<string>();
  private readonly _blitzCoordinator = new HeliosBlitzCoordinator();
  private _lastKnownMasterState = false;

  constructor(
    private readonly _instanceName: string,
    private readonly _config: HeliosConfig,
    private readonly _transport: TcpClusterTransport,
    private readonly _serializationService: SerializationService,
  ) {
    const boundPort = this._transport.boundPort();
    if (boundPort === null) {
      throw new Error(
        "Transport must be started before cluster coordinator initialization",
      );
    }

    this._localAddress = new Address("127.0.0.1", boundPort);
    this._localMember = new MemberImpl.Builder(this._localAddress)
      .uuid(this._instanceName)
      .version(new MemberVersion(1, 0, 0))
      .localMember(true)
      .build();
    this._clusterService = new ClusterServiceImpl(this._localMember);
    this._joinManager = new ClusterJoinManager({
      clusterName: DEFAULT_CLUSTER_NAME,
      partitionCount: this._partitionService.getPartitionCount(),
      localMember: this._localMember,
      clusterService: this._clusterService,
      transport: {
        send: async () => null,
      },
    });
  }

  bootstrap(): void {
    const joinConfig = this._config.getNetworkConfig().getJoin();
    const configuredPeers = joinConfig.getTcpIpConfig().getMembers();

    if (configuredPeers.length === 0) {
      this._joinManager.setThisMemberAsMaster();
      this._recomputePartitions();
      this._syncBlitzCoordinatorState();
      this._notifyMembershipChanged();
    }
  }

  getCluster(): Cluster {
    return this._clusterService;
  }

  getLocalAddress(): Address {
    return this._localAddress;
  }

  getLocalMemberId(): string {
    return this._localMember.getUuid();
  }

  getInternalPartitionService(): InternalPartitionServiceImpl {
    return this._partitionService;
  }

  isJoined(): boolean {
    return this._clusterService.isJoined();
  }

  isLocalMember(memberId: string): boolean {
    return memberId === this._localMember.getUuid();
  }

  getPartitionId(name: string): number {
    const data = this._serializationService.toData(name);
    if (data === null) {
      throw new Error(`Unable to derive partition id for '${name}'`);
    }
    return this._partitionService.getPartitionId(data);
  }

  getOwnerId(partitionId: number): string | null {
    return (
      this._partitionService.getPartitionOwner(partitionId)?.uuid() ?? null
    );
  }

  getBackupIds(partitionId: number, count: number): string[] {
    const partition = this._partitionService.getPartition(partitionId);
    const result: string[] = [];
    for (let replicaIndex = 1; replicaIndex <= count; replicaIndex++) {
      const replica = partition.getReplica(replicaIndex);
      if (replica !== null) {
        result.push(replica.uuid());
      }
    }
    return result;
  }

  getMemberAddress(memberId: string): Address | null {
    return this._clusterService.getMemberByUuid(memberId)?.getAddress() ?? null;
  }

  /**
   * Registers a MigrationAwareService on the internal partition service.
   * Called during instance startup to wire services into the migration lifecycle.
   */
  registerMigrationAwareService(serviceName: string, service: import('@zenystx/helios-core/internal/partition/MigrationAwareService').MigrationAwareService): void {
    this._partitionService.registerMigrationAwareService(serviceName, service);
  }

  getBlitzCoordinator(): HeliosBlitzCoordinator {
    return this._blitzCoordinator;
  }

  onMembershipChanged(listener: MembershipListener): void {
    this._membershipListeners.push(listener);
  }

  onMemberRemoved(listener: MemberRemovedListener): void {
    this._memberRemovedListeners.push(listener);
  }

  onBlitzCoordinatorEvent(listener: BlitzCoordinatorListener): void {
    this._blitzCoordinatorListeners.push(listener);
  }

  handlePeerConnected(peerId: string): void {
    if (peerId === this._localMember.getUuid()) {
      return;
    }
    this._connectedPeers.add(peerId);

    if (
      !this._clusterService.isJoined() &&
      !this._joinRequestedPeers.has(peerId)
    ) {
      this._joinRequestedPeers.add(peerId);
      this._transport.send(peerId, {
        type: "JOIN_REQUEST",
        joinerAddress: {
          host: this._localAddress.getHost(),
          port: this._localAddress.getPort(),
        },
        joinerUuid: this._localMember.getUuid(),
        clusterName: DEFAULT_CLUSTER_NAME,
        partitionCount: this._partitionService.getPartitionCount(),
        joinerVersion: { major: 1, minor: 0, patch: 0 },
      });
      return;
    }

    this._connectToKnownMembers();
  }

  handlePeerDisconnected(peerId: string): void {
    this._connectedPeers.delete(peerId);
    if (this._clusterService.getMemberByUuid(peerId) === null) {
      return;
    }
    this._removeMember(peerId);
  }

  handleMessage(message: ClusterMessage): boolean {
    switch (message.type) {
      case "JOIN_REQUEST":
        this._handleJoinRequest(message);
        return true;
      case "FINALIZE_JOIN":
        this._handleFinalizeJoin(message);
        return true;
      case "MEMBERS_UPDATE":
        this._handleMembersUpdate(message);
        return true;
      case "PARTITION_STATE":
        this._handlePartitionState(message);
        return true;
      case "BLITZ_NODE_REGISTER":
        {
          const accepted = this._blitzCoordinator.handleRegister(
          message as BlitzNodeRegisterMsg,
          this._clusterService.isMaster(),
          );
          if (accepted) {
            this._notifyBlitzTopologyRegistrationChanged();
          }
          return accepted;
        }
      case "BLITZ_NODE_REMOVE":
        {
          const accepted = this._blitzCoordinator.handleRemove(
          message as BlitzNodeRemoveMsg,
          this._clusterService.isMaster(),
          );
          if (accepted) {
            this._notifyBlitzTopologyRegistrationChanged();
          }
          return accepted;
        }
      case "BLITZ_TOPOLOGY_REQUEST": {
        const response = this._blitzCoordinator.handleTopologyRequest(
          message as BlitzTopologyRequestMsg,
          this._clusterService.isMaster(),
        );
        if (response) {
          this._transport.broadcast(response);
        }
        return response !== null;
      }
      case "BLITZ_TOPOLOGY_RESPONSE":
        {
          const result = this._blitzCoordinator.handleIncomingTopologyResponse(
          message as import("@zenystx/helios-core/cluster/tcp/ClusterMessage").BlitzTopologyResponseMsg,
          );
          if (result.accepted) {
            this._notifyBlitzTopologyResponse(result);
          }
          return result.accepted;
        }
      case "BLITZ_TOPOLOGY_ANNOUNCE":
        {
          const result = this._blitzCoordinator.handleIncomingTopologyAnnounce(
          message as import("@zenystx/helios-core/cluster/tcp/ClusterMessage").BlitzTopologyAnnounceMsg,
          );
          if (result.accepted) {
            this._notifyBlitzTopologyAnnounce(result.routes ?? []);
          }
          return result.accepted;
        }
      default:
        return false;
    }
  }

  private _handleJoinRequest(
    message: Extract<ClusterMessage, { type: "JOIN_REQUEST" }>,
  ): void {
    if (!this._clusterService.isMaster()) {
      return;
    }

    const joiner = new MemberImpl.Builder(
      new Address(message.joinerAddress.host, message.joinerAddress.port),
    )
      .uuid(message.joinerUuid)
      .version(
        new MemberVersion(
          message.joinerVersion.major,
          message.joinerVersion.minor,
          message.joinerVersion.patch,
        ),
      )
      .build();

    const result = this._joinManager.handleJoinRequest(
      joiner,
      message.clusterName,
      message.partitionCount,
    );
    if (!result.accepted) {
      return;
    }

    void this._joinManager.startJoin([joiner]).then(() => {
      this._recomputePartitions();
      this._syncBlitzCoordinatorState();

      const members = this._clusterService.getMembers() as MemberImpl[];
      const wireMembers = members.map((member) => this._toWireMember(member));
      const memberMap = this._clusterService.getMemberMap();
      const masterAddress =
        this._clusterService.getMasterAddress() ?? this._localAddress;

      this._transport.send(message.joinerUuid, {
        type: "FINALIZE_JOIN",
        memberListVersion: memberMap.getVersion(),
        members: wireMembers,
        masterAddress: {
          host: masterAddress.getHost(),
          port: masterAddress.getPort(),
        },
        clusterId: this._clusterService.getClusterId() ?? this._instanceName,
      });

      for (const member of members) {
        if (
          member.getUuid() === this._localMember.getUuid() ||
          member.getUuid() === message.joinerUuid
        ) {
          continue;
        }
        this._transport.send(member.getUuid(), {
          type: "MEMBERS_UPDATE",
          memberListVersion: memberMap.getVersion(),
          members: wireMembers,
          masterAddress: {
            host: masterAddress.getHost(),
            port: masterAddress.getPort(),
          },
          clusterId: this._clusterService.getClusterId() ?? this._instanceName,
        });
      }

      this._broadcastPartitionState();
      this._notifyMembershipChanged();
    });
  }

  private _handleFinalizeJoin(message: FinalizeJoinMsg): void {
    this._clusterService.setMasterAddress(
      new Address(message.masterAddress.host, message.masterAddress.port),
    );
    this._clusterService.setClusterId(message.clusterId);
    this._clusterService.setJoined(true);
    this._clusterService.setMemberMap(
      MembersView.createNew(
        message.memberListVersion,
        this._fromWireMembers(message.members),
      ).toMemberMap(),
    );
    this._syncBlitzCoordinatorState();
    this._connectToKnownMembers();
    this._notifyMembershipChanged();
  }

  private _handleMembersUpdate(message: MembersUpdateMsg): void {
    this._clusterService.setMasterAddress(
      new Address(message.masterAddress.host, message.masterAddress.port),
    );
    this._clusterService.setClusterId(message.clusterId);
    this._clusterService.setJoined(true);
    this._clusterService.setMemberMap(
      MembersView.createNew(
        message.memberListVersion,
        this._fromWireMembers(message.members),
      ).toMemberMap(),
    );
    this._syncBlitzCoordinatorState();
    this._connectToKnownMembers();
    this._notifyMembershipChanged();
  }

  private _handlePartitionState(message: PartitionStateMsg): void {
    this._applyRuntimeStateWithPromotionLifecycle(
      this._fromWirePartitionState(message),
    );
    this._notifyMembershipChanged();
  }

  private _removeMember(memberId: string): void {
    const removedMember = this._clusterService.getMemberByUuid(memberId);
    const currentMembers = (
      this._clusterService.getMembers() as MemberImpl[]
    ).filter((member) => member.getUuid() !== memberId);
    if (currentMembers.length === 0) {
      return;
    }

    const sortedMembers = [...currentMembers].sort((left, right) =>
      left.getUuid().localeCompare(right.getUuid()),
    );
    const newMaster = sortedMembers[0];
    const newView = MembersView.createNew(
      this._clusterService.getMemberMap().getVersion() + 1,
      currentMembers,
    );

    this._clusterService.setMemberMap(newView.toMemberMap());
    this._clusterService.setMasterAddress(newMaster.getAddress());
    this._clusterService.setJoined(true);

    if (removedMember) {
      const previousState = this._toRuntimeState(this._partitionService);
      this._partitionService.memberRemovedWithRepair(removedMember, currentMembers);
      this._applyRuntimeStateWithPromotionLifecycle(
        this._toRuntimeState(this._partitionService),
        previousState,
      );
    } else {
      this._recomputePartitions();
    }

    if (newMaster.getUuid() === this._localMember.getUuid()) {
      const wireMembers = currentMembers.map((member) =>
        this._toWireMember(member),
      );
      const masterAddress = newMaster.getAddress();
      for (const member of currentMembers) {
        if (member.getUuid() === this._localMember.getUuid()) {
          continue;
        }
        this._transport.send(member.getUuid(), {
          type: "MEMBERS_UPDATE",
          memberListVersion: newView.getVersion(),
          members: wireMembers,
          masterAddress: {
            host: masterAddress.getHost(),
            port: masterAddress.getPort(),
          },
          clusterId: this._clusterService.getClusterId() ?? this._instanceName,
        });
      }
      this._broadcastPartitionState();
    }

    this._syncBlitzCoordinatorState();
    this._notifyMemberRemoved(memberId);
    this._notifyMembershipChanged();
  }

  private _connectToKnownMembers(): void {
    for (const member of this._clusterService.getMembers() as MemberImpl[]) {
      if (member.getUuid() === this._localMember.getUuid()) {
        continue;
      }
      if (this._connectedPeers.has(member.getUuid())) {
        continue;
      }
      void this._transport
        .connectToPeer(
          member.getAddress().getHost(),
          member.getAddress().getPort(),
        )
        .catch(() => {});
    }
  }

  private _recomputePartitions(): void {
    const freshPartitionService = new InternalPartitionServiceImpl(
      this._partitionService.getPartitionCount(),
    );
    const members = this._clusterService.getMembers();
    const masterAddress =
      this._clusterService.getMasterAddress() ?? this._localAddress;
    // Hazelcast always allocates MAX_BACKUP_COUNT (6) replica slots in the
    // partition table — the topology is independent of per-map backupCount.
    // Per-data-structure backupCount (MapConfig, QueueConfig, etc.) controls
    // which slots receive actual data replication at the operation layer.
    freshPartitionService.firstArrangement(members, masterAddress);
    for (
      let partitionId = 0;
      partitionId < freshPartitionService.getPartitionCount();
      partitionId++
    ) {
      const currentVersion = this._partitionService
        .getPartition(partitionId)
        .version();
      const nextVersion = Math.max(
        freshPartitionService.getPartition(partitionId).version(),
        currentVersion + 1,
      );
      freshPartitionService.getPartition(partitionId).setVersion(nextVersion);
    }
    this._applyRuntimeStateWithPromotionLifecycle(
      this._toRuntimeState(freshPartitionService),
    );
  }

  private _applyRuntimeStateWithPromotionLifecycle(
    state: PartitionRuntimeState,
    previousState?: PartitionRuntimeState,
  ): void {
    const localUuid = this._localMember.getUuid();
    const promotions: Array<{ partitionId: number; sourceUuid: string; targetUuid: string }> = [];
    const demotions: PartitionMigrationEvent[] = [];
    const baselineState = previousState ?? this._toRuntimeState(this._partitionService);

    for (let partitionId = 0; partitionId < this._partitionService.getPartitionCount(); partitionId++) {
      const currentPartition = this._partitionService.getPartition(partitionId);
      const currentOwner = baselineState.partitions[partitionId]?.[0] ?? null;
      const nextOwner = state.partitions[partitionId]?.[0] ?? null;
      const currentOwnerUuid = currentOwner?.uuid() ?? null;
      const nextOwnerUuid = nextOwner?.uuid() ?? null;

      if (currentOwnerUuid === nextOwnerUuid) {
        continue;
      }

      if (currentOwnerUuid === localUuid) {
        const event = new PartitionMigrationEvent(partitionId, currentOwner, nextOwner, 'MOVE');
        for (const [, service] of this._partitionService.getMigrationAwareServices()) {
          service.beforeMigration(event);
        }
        demotions.push(event);
      }

      if (nextOwnerUuid === localUuid) {
        const sourceUuid = currentOwnerUuid ?? 'unassigned';
        currentPartition.beginPromotion(sourceUuid, localUuid);
        this._notifyServicesBeforePromotion(partitionId, sourceUuid, localUuid);
        promotions.push({ partitionId, sourceUuid, targetUuid: localUuid });
      }
    }

    this._partitionService.applyPartitionRuntimeState(state, this._localAddress);

    for (const promotion of promotions) {
      this._notifyServicesInstallPromotionState(promotion.partitionId);
      this._partitionService.getPartition(promotion.partitionId).finalizePromotion();
      this._notifyServicesFinalizePromotion(
        promotion.partitionId,
        promotion.sourceUuid,
        promotion.targetUuid,
      );
    }

    for (const event of demotions) {
      for (const [, service] of this._partitionService.getMigrationAwareServices()) {
        service.commitMigration(event);
      }
    }
  }

  private _notifyServicesBeforePromotion(
    partitionId: number,
    sourceUuid: string,
    targetUuid: string,
  ): void {
    for (const [, service] of this._partitionService.getMigrationAwareServices()) {
      if ('beforePromotion' in service && typeof service.beforePromotion === 'function') {
        service.beforePromotion(partitionId, sourceUuid, targetUuid);
      }
    }
  }

  private _notifyServicesInstallPromotionState(partitionId: number): void {
    for (const [, service] of this._partitionService.getMigrationAwareServices()) {
      if ('installPromotionState' in service && typeof service.installPromotionState === 'function') {
        service.installPromotionState(partitionId);
      }
    }
  }

  private _notifyServicesFinalizePromotion(
    partitionId: number,
    sourceUuid: string,
    targetUuid: string,
  ): void {
    for (const [, service] of this._partitionService.getMigrationAwareServices()) {
      if ('finalizePromotion' in service && typeof service.finalizePromotion === 'function') {
        service.finalizePromotion(partitionId, sourceUuid, targetUuid);
      }
    }
  }

  private _broadcastPartitionState(): void {
    const runtimeState = this._toRuntimeState(this._partitionService);
    this._transport.broadcast({
      type: "PARTITION_STATE",
      versions: runtimeState.versions,
      partitions: runtimeState.partitions.map((replicas) =>
        replicas.map((replica) =>
          replica === null
            ? null
            : {
                uuid: replica.uuid(),
                address: {
                  host: replica.address().getHost(),
                  port: replica.address().getPort(),
                },
              },
        ),
      ),
    });
  }

  private _toWireMember(member: MemberImpl): WireMemberInfo {
    return {
      address: {
        host: member.getAddress().getHost(),
        port: member.getAddress().getPort(),
      },
      uuid: member.getUuid(),
      attributes: Object.fromEntries(member.getAttributes()),
      liteMember: member.isLiteMember(),
      version: {
        major: member.getVersion().getMajor(),
        minor: member.getVersion().getMinor(),
        patch: member.getVersion().getPatch(),
      },
      memberListJoinVersion: member.getMemberListJoinVersion(),
    };
  }

  private _fromWireMembers(members: WireMemberInfo[]): MemberImpl[] {
    return members.map((member) =>
      new MemberImpl.Builder(
        new Address(member.address.host, member.address.port),
      )
        .uuid(member.uuid)
        .version(
          new MemberVersion(
            member.version.major,
            member.version.minor,
            member.version.patch,
          ),
        )
        .localMember(member.uuid === this._localMember.getUuid())
        .attributes(new Map(Object.entries(member.attributes)))
        .memberListJoinVersion(member.memberListJoinVersion)
        .build(),
    );
  }

  private _toRuntimeState(
    service: InternalPartitionServiceImpl,
  ): PartitionRuntimeState {
    const partitions: (PartitionReplica | null)[][] = [];
    const versions: number[] = [];
    for (
      let partitionId = 0;
      partitionId < service.getPartitionCount();
      partitionId++
    ) {
      const partition = service.getPartition(partitionId);
      partitions.push(partition.getReplicasCopy());
      versions.push(partition.version());
    }
    return { partitions, versions };
  }

  private _fromWirePartitionState(
    message: PartitionStateMsg,
  ): PartitionRuntimeState {
    return {
      versions: [...message.versions],
      partitions: message.partitions.map((replicas) =>
        replicas.map((replica) => this._fromWireReplica(replica)),
      ),
    };
  }

  private _fromWireReplica(
    replica: WirePartitionReplica | null,
  ): PartitionReplica | null {
    if (replica === null) {
      return null;
    }
    return new PartitionReplica(
      new Address(replica.address.host, replica.address.port),
      replica.uuid,
    );
  }

  private _notifyMembershipChanged(): void {
    for (const listener of this._membershipListeners) {
      listener();
    }
  }

  private _notifyMemberRemoved(memberId: string): void {
    for (const listener of this._memberRemovedListeners) {
      listener(memberId);
    }
  }

  private _syncBlitzCoordinatorState(): void {
    const memberMap = this._clusterService.getMemberMap();
    const memberIds = Array.from(this._clusterService.getMembers(), (member) =>
      member.getUuid(),
    );
    const currentIsMaster = this._clusterService.isMaster();
    if (this._lastKnownMasterState && !currentIsMaster) {
      this._blitzCoordinator.onDemotion();
      for (const listener of this._blitzCoordinatorListeners) {
        listener.onDemotion?.();
      }
    }
    this._lastKnownMasterState = currentIsMaster;

    this._blitzCoordinator.setMemberListVersion(memberMap.getVersion());
    this._blitzCoordinator.setExpectedRegistrants(new Set(memberIds));
    this._blitzCoordinator.getReplicaReconciler().setIsMaster(currentIsMaster);

    const masterAddress = this._clusterService.getMasterAddress();
    const masterMemberId =
      masterAddress === null
        ? null
        : this._clusterService.getMember(masterAddress)?.getUuid() ?? null;
    if (masterMemberId !== null) {
      this._blitzCoordinator.setMasterMemberId(masterMemberId);
    }

    for (const listener of this._blitzCoordinatorListeners) {
      listener.onAuthorityChanged?.({
        masterMemberId,
        memberListVersion: memberMap.getVersion(),
        isMaster: currentIsMaster,
        joined: this._clusterService.isJoined(),
        memberIds,
      });
    }
  }

  private _notifyBlitzTopologyResponse(state: {
    routes?: string[];
    registrationsComplete?: boolean;
    clientConnectUrl?: string;
    retryAfterMs?: number;
  }): void {
    for (const listener of this._blitzCoordinatorListeners) {
      listener.onTopologyResponse?.({
        routes: state.routes ?? [],
        registrationsComplete: state.registrationsComplete ?? false,
        clientConnectUrl: state.clientConnectUrl,
        retryAfterMs: state.retryAfterMs,
      });
    }
  }

  private _notifyBlitzTopologyAnnounce(routes: string[]): void {
    for (const listener of this._blitzCoordinatorListeners) {
      listener.onTopologyAnnounce?.({ routes });
    }
  }

  private _notifyBlitzTopologyRegistrationChanged(): void {
    for (const listener of this._blitzCoordinatorListeners) {
      listener.onTopologyRegistrationChanged?.();
    }
  }
}
