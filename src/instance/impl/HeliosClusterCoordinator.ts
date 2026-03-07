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
import { Address } from "@zenystx/helios-core/cluster/Address";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import { MemberImpl } from "@zenystx/helios-core/cluster/impl/MemberImpl";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import { ClusterJoinManager } from "@zenystx/helios-core/internal/cluster/impl/ClusterJoinManager";
import { ClusterServiceImpl } from "@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl";
import { MembersView } from "@zenystx/helios-core/internal/cluster/impl/MembersView";
import { PartitionReplica } from "@zenystx/helios-core/internal/partition/PartitionReplica";
import type { PartitionRuntimeState } from "@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl";
import { InternalPartitionServiceImpl } from "@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl";
import type { SerializationService } from "@zenystx/helios-core/internal/serialization/SerializationService";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import { HeliosBlitzCoordinator } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzCoordinator";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

type MembershipListener = () => void;
const DEFAULT_CLUSTER_NAME = "helios";

export class HeliosClusterCoordinator {
  private readonly _localAddress: Address;
  private readonly _localMember: MemberImpl;
  private readonly _clusterService: ClusterServiceImpl;
  private readonly _joinManager: ClusterJoinManager;
  private readonly _partitionService = new InternalPartitionServiceImpl();
  private readonly _membershipListeners: MembershipListener[] = [];
  private readonly _joinRequestedPeers = new Set<string>();
  private readonly _connectedPeers = new Set<string>();
  private readonly _blitzCoordinator = new HeliosBlitzCoordinator();

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
    const configuredPeers = this._config
      .getNetworkConfig()
      .getJoin()
      .getTcpIpConfig()
      .getMembers();
    if (configuredPeers.length === 0) {
      this._joinManager.setThisMemberAsMaster();
      this._recomputePartitions();
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

  onMembershipChanged(listener: MembershipListener): void {
    this._membershipListeners.push(listener);
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
        return this._blitzCoordinator.handleRegister(
          message as BlitzNodeRegisterMsg,
          this._clusterService.isMaster(),
        );
      case "BLITZ_NODE_REMOVE":
        return this._blitzCoordinator.handleRemove(
          message as BlitzNodeRemoveMsg,
          this._clusterService.isMaster(),
        );
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
    this._connectToKnownMembers();
    this._notifyMembershipChanged();
  }

  private _handlePartitionState(message: PartitionStateMsg): void {
    this._partitionService.applyPartitionRuntimeState(
      this._fromWirePartitionState(message),
      this._localAddress,
    );
    this._notifyMembershipChanged();
  }

  private _removeMember(memberId: string): void {
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
    this._recomputePartitions();

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
    freshPartitionService.firstArrangement(members, masterAddress, 6);
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
    this._partitionService.applyPartitionRuntimeState(
      this._toRuntimeState(freshPartitionService),
      this._localAddress,
    );
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
}
