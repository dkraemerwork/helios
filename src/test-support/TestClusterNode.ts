/**
 * TestClusterNode — wraps ClusterServiceImpl + TcpClusterTransport into a
 * single cohesive node for integration testing.
 *
 * Block 16.A0 — Multi-Node Test Infrastructure
 */
import { Address } from "@zenystx/helios-core/cluster/Address";
import { MemberImpl } from "@zenystx/helios-core/cluster/impl/MemberImpl";
import type { ClusterMessage } from "@zenystx/helios-core/cluster/tcp/ClusterMessage";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import {
  ClusterHeartbeatManager,
  type HeartbeatConfig,
} from "@zenystx/helios-core/internal/cluster/impl/ClusterHeartbeatManager";
import {
  ClusterJoinManager,
  type JoinTransport,
} from "@zenystx/helios-core/internal/cluster/impl/ClusterJoinManager";
import { ClusterServiceImpl } from "@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl";
import { MembersView } from "@zenystx/helios-core/internal/cluster/impl/MembersView";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

export interface TestClusterNodeConfig {
  readonly clusterName: string;
  readonly partitionCount: number;
  readonly port?: number;
  readonly heartbeatIntervalMillis?: number;
  readonly maxNoHeartbeatMillis?: number;
}

export class TestClusterNode {
  readonly nodeId: string;
  readonly transport: TcpClusterTransport;

  private _clusterService!: ClusterServiceImpl;
  private _joinManager!: ClusterJoinManager;
  private _heartbeatManager!: ClusterHeartbeatManager;

  private readonly _config: TestClusterNodeConfig;
  private _running = false;

  constructor(config: TestClusterNodeConfig) {
    this.nodeId = crypto.randomUUID();
    this._config = config;
    this.transport = new TcpClusterTransport(this.nodeId);
  }

  get clusterService(): ClusterServiceImpl {
    return this._clusterService;
  }
  get joinManager(): ClusterJoinManager {
    return this._joinManager;
  }
  get heartbeatManager(): ClusterHeartbeatManager {
    return this._heartbeatManager;
  }

  get boundPort(): number | null {
    return this.transport.boundPort();
  }

  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Start the TCP transport, then create cluster service with actual bound address.
   */
  start(port?: number): void {
    this.transport.start(port ?? 0, "127.0.0.1");
    this._running = true;

    const actualPort = this.transport.boundPort()!;
    const address = new Address("127.0.0.1", actualPort);
    const member = new MemberImpl.Builder(address)
      .uuid(this.nodeId)
      .version(new MemberVersion(1, 0, 0))
      .localMember(true)
      .build();

    this._clusterService = new ClusterServiceImpl(member);

    const joinTransport: JoinTransport = {
      async send(): Promise<unknown> {
        return null;
      },
    };
    this._joinManager = new ClusterJoinManager({
      clusterName: this._config.clusterName,
      partitionCount: this._config.partitionCount,
      localMember: member,
      clusterService: this._clusterService,
      transport: joinTransport,
    });

    const heartbeatConfig: HeartbeatConfig = {
      heartbeatIntervalMillis: this._config.heartbeatIntervalMillis ?? 5000,
      maxNoHeartbeatMillis: this._config.maxNoHeartbeatMillis ?? 60000,
    };
    this._heartbeatManager = new ClusterHeartbeatManager(
      this._clusterService,
      heartbeatConfig,
    );

    // Wire up message handling
    this.transport.onMessage = (msg: ClusterMessage) => {
      this._handleMessage(msg);
    };
  }

  /** Become master (first node in cluster). */
  becomeMaster(): void {
    this._joinManager.setThisMemberAsMaster();
  }

  /** Start heartbeat sending over TCP. Seed failure detector for all known members. */
  startHeartbeats(): void {
    // Seed failure detector so members aren't immediately suspected
    const now = Date.now();
    for (const m of this._clusterService.getMembers()) {
      if (m.getUuid() !== this.nodeId) {
        this._heartbeatManager.onHeartbeat(m as MemberImpl, now);
      }
    }

    this._heartbeatManager.onHeartbeatSent((member) => {
      this.transport.send(member.getUuid(), {
        type: "HEARTBEAT",
        senderUuid: this.nodeId,
        timestamp: Date.now(),
      });
    });
    this._heartbeatManager.init();
  }

  /** Stop this node. */
  async shutdown(): Promise<void> {
    this._heartbeatManager?.shutdown();
    this.transport.shutdown();
    this._running = false;
  }

  // ── Internal message handling ─────────────────────────────────────────

  private _handleMessage(msg: ClusterMessage): void {
    switch (msg.type) {
      case "JOIN_REQUEST":
        this._handleJoinRequest(msg);
        break;
      case "FINALIZE_JOIN":
        this._handleFinalizeJoin(msg);
        break;
      case "MEMBERS_UPDATE":
        this._handleMembersUpdate(msg);
        break;
      case "HEARTBEAT":
        this._handleHeartbeat(msg);
        break;
    }
  }

  private _handleJoinRequest(
    msg: ClusterMessage & { type: "JOIN_REQUEST" },
  ): void {
    if (!this._clusterService.isMaster()) return;

    const joinerAddress = new Address(
      msg.joinerAddress.host,
      msg.joinerAddress.port,
    );
    const joinerMember = new MemberImpl.Builder(joinerAddress)
      .uuid(msg.joinerUuid)
      .version(
        new MemberVersion(
          msg.joinerVersion.major,
          msg.joinerVersion.minor,
          msg.joinerVersion.patch,
        ),
      )
      .build();

    const result = this._joinManager.handleJoinRequest(
      joinerMember,
      msg.clusterName,
      msg.partitionCount,
    );

    if (result.accepted) {
      this._joinManager.startJoin([joinerMember]).then(() => {
        const members = this._clusterService.getMembers() as MemberImpl[];
        const wireMembers = members.map((m) => ({
          address: {
            host: m.getAddress().getHost(),
            port: m.getAddress().getPort(),
          },
          uuid: m.getUuid(),
          attributes: Object.fromEntries(m.getAttributes()),
          liteMember: m.isLiteMember(),
          version: {
            major: m.getVersion().getMajor(),
            minor: m.getVersion().getMinor(),
            patch: m.getVersion().getPatch(),
          },
          memberListJoinVersion: m.getMemberListJoinVersion(),
          clientEndpoint: null,
          restEndpoint: null,
        }));

        const masterAddr = this._clusterService.getMasterAddress()!;
        const memberMap = this._clusterService.getMemberMap();

        this.transport.send(msg.joinerUuid, {
          type: "FINALIZE_JOIN",
          memberListVersion: memberMap.getVersion(),
          members: wireMembers,
          masterAddress: {
            host: masterAddr.getHost(),
            port: masterAddr.getPort(),
          },
          clusterId: this._clusterService.getClusterId()!,
        });

        for (const m of members) {
          if (m.getUuid() === this.nodeId || m.getUuid() === msg.joinerUuid)
            continue;
          this.transport.send(m.getUuid(), {
            type: "MEMBERS_UPDATE",
            memberListVersion: memberMap.getVersion(),
            members: wireMembers,
            masterAddress: {
              host: masterAddr.getHost(),
              port: masterAddr.getPort(),
            },
            clusterId: this._clusterService.getClusterId()!,
          });
        }
      });
    }
  }

  private _handleFinalizeJoin(
    msg: ClusterMessage & { type: "FINALIZE_JOIN" },
  ): void {
    const masterAddress = new Address(
      msg.masterAddress.host,
      msg.masterAddress.port,
    );
    this._clusterService.setMasterAddress(masterAddress);

    const members = msg.members.map((wm) => {
      const isLocal = wm.uuid === this.nodeId;
      return new MemberImpl.Builder(
        new Address(wm.address.host, wm.address.port),
      )
        .uuid(wm.uuid)
        .version(
          new MemberVersion(
            wm.version.major,
            wm.version.minor,
            wm.version.patch,
          ),
        )
        .localMember(isLocal)
        .attributes(new Map(Object.entries(wm.attributes)))
        .memberListJoinVersion(wm.memberListJoinVersion)
        .addressMap(new Map())
        .build();
    });

    const view = MembersView.createNew(msg.memberListVersion, members);
    this._clusterService.setMemberMap(view.toMemberMap());
    this._clusterService.setClusterId(msg.clusterId);
    this._clusterService.setJoined(true);
  }

  private _handleMembersUpdate(
    msg: ClusterMessage & { type: "MEMBERS_UPDATE" },
  ): void {
    const members = msg.members.map((wm) => {
      const isLocal = wm.uuid === this.nodeId;
      return new MemberImpl.Builder(
        new Address(wm.address.host, wm.address.port),
      )
        .uuid(wm.uuid)
        .version(
          new MemberVersion(
            wm.version.major,
            wm.version.minor,
            wm.version.patch,
          ),
        )
        .localMember(isLocal)
        .attributes(new Map(Object.entries(wm.attributes)))
        .memberListJoinVersion(wm.memberListJoinVersion)
        .addressMap(new Map())
        .build();
    });

    const view = MembersView.createNew(msg.memberListVersion, members);
    this._clusterService.setMemberMap(view.toMemberMap());
  }

  private _handleHeartbeat(msg: ClusterMessage & { type: "HEARTBEAT" }): void {
    const sender = this._clusterService.getMemberByUuid(msg.senderUuid);
    if (sender) {
      this._heartbeatManager.onHeartbeat(sender, msg.timestamp);
    }
  }
}
