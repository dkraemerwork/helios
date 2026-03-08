/**
 * Production implementation of HeliosInstance.
 *
 * Wires all built-in data-structure services into a NodeEngineImpl, exposing
 * typed distributed-object accessors with idempotent same-name semantics.
 *
 * Replaces TestHeliosInstance as the primary runtime entry point.
 * TestHeliosInstance remains available for lightweight unit tests that do not
 * need the full service registry.
 *
 * Block 21.1: When TCP-IP join is enabled, map operations route through
 * OperationService with owner-routed partition dispatch (no legacy
 * MAP_PUT/MAP_REMOVE/MAP_CLEAR broadcast).
 */
import { MapClearCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapClearCodec";
import { MapContainsKeyCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapContainsKeyCodec";
import { MapDeleteCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapDeleteCodec";
import { MapGetCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapGetCodec";
import { MapPutCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec";
import { MapRemoveCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapRemoveCodec";
import { MapSetCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapSetCodec";
import { MapSizeCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapSizeCodec";
import { QueueClearCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueClearCodec";
import { QueueOfferCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueOfferCodec";
import { QueuePeekCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueuePeekCodec";
import { QueuePollCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueuePollCodec";
import { QueueSizeCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueSizeCodec";
import { TopicAddMessageListenerCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicAddMessageListenerCodec";
import { TopicPublishCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicPublishCodec";
import { TopicRemoveMessageListenerCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicRemoveMessageListenerCodec";
import { Address } from "@zenystx/helios-core/cluster/Address";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import { LocalCluster } from "@zenystx/helios-core/cluster/impl/LocalCluster";
import { MulticastJoiner } from "@zenystx/helios-core/cluster/multicast/MulticastJoiner";
import { MulticastService } from "@zenystx/helios-core/cluster/multicast/MulticastService";
import { decodeData, encodeData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import { ListImpl } from "@zenystx/helios-core/collection/impl/ListImpl";
import { QueueImpl } from "@zenystx/helios-core/collection/impl/QueueImpl";
import { SetImpl } from "@zenystx/helios-core/collection/impl/SetImpl";
import { DistributedQueueService } from "@zenystx/helios-core/collection/impl/queue/DistributedQueueService";
import { QueueProxyImpl } from "@zenystx/helios-core/collection/impl/queue/QueueProxyImpl";
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import { ExecutorRejectedExecutionException } from "@zenystx/helios-core/executor/ExecutorExceptions";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import { ExecutorContainerService } from "@zenystx/helios-core/executor/impl/ExecutorContainerService";
import { ExecutorServiceProxy } from "@zenystx/helios-core/executor/impl/ExecutorServiceProxy";
import type { IScheduledExecutorService } from "@zenystx/helios-core/scheduledexecutor/IScheduledExecutorService";
import { ScheduledExecutorServiceProxy } from "@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorServiceProxy";
import { ScheduledExecutorContainerService as ScheduledContainerService } from "@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService";
import { InlineExecutionBackend } from "@zenystx/helios-core/executor/impl/InlineExecutionBackend";
import { ScatterExecutionBackend } from "@zenystx/helios-core/executor/impl/ScatterExecutionBackend";
import { TaskTypeRegistry } from "@zenystx/helios-core/executor/impl/TaskTypeRegistry";
import { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import { BlitzReadinessState, HeliosBlitzLifecycleManager } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzLifecycleManager";
import { HeliosLifecycleService } from "@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import { NodeState } from "@zenystx/helios-core/instance/lifecycle/NodeState";
import { ClusterServiceImpl } from "@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl";
import { DefaultNearCacheManager } from "@zenystx/helios-core/internal/nearcache/impl/DefaultNearCacheManager";
import { PartitionReplicaManager } from "@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager";
import { PartitionBackupReplicaAntiEntropyOp } from "@zenystx/helios-core/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp";
import { PartitionReplicaSyncResponse } from "@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import { SerializationConfig } from "@zenystx/helios-core/internal/serialization/impl/SerializationConfig";
import { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import { MapContainerService } from "@zenystx/helios-core/map/impl/MapContainerService";
import { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
import { MapService } from "@zenystx/helios-core/map/impl/MapService";
import { NearCachedIMapWrapper } from "@zenystx/helios-core/map/impl/nearcache/NearCachedIMapWrapper";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import { MultiMapImpl } from "@zenystx/helios-core/multimap/impl/MultiMapImpl";
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import { ReplicatedMapImpl } from "@zenystx/helios-core/replicatedmap/impl/ReplicatedMapImpl";
import { HeliosRestServer } from "@zenystx/helios-core/rest/HeliosRestServer";
import { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";
import { ClusterReadHandler } from "@zenystx/helios-core/rest/handler/ClusterReadHandler";
import { ClusterWriteHandler } from "@zenystx/helios-core/rest/handler/ClusterWriteHandler";
import type {
  DataHandlerMap,
  DataHandlerQueue,
  DataHandlerStore,
} from "@zenystx/helios-core/rest/handler/DataHandler";
import { DataHandler } from "@zenystx/helios-core/rest/handler/DataHandler";
import { HealthCheckHandler } from "@zenystx/helios-core/rest/handler/HealthCheckHandler";
import { MonitorHandler } from "@zenystx/helios-core/rest/handler/MonitorHandler";
import { MetricsRegistry } from "@zenystx/helios-core/monitor/MetricsRegistry";
import { MetricsSampler } from "@zenystx/helios-core/monitor/MetricsSampler";
import type { MonitorStateProvider } from "@zenystx/helios-core/monitor/MonitorStateProvider";
import type { BlitzMetrics, MemberPartitionInfo, ObjectInventory, ThreadPoolMetrics, TransportMetrics } from "@zenystx/helios-core/monitor/MetricsSample";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";
import type { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";
import type { PartitionService } from "@zenystx/helios-core/spi/PartitionService";
import { NodeEngineImpl } from "@zenystx/helios-core/spi/impl/NodeEngineImpl";
import {
  decodeResponsePayload,
  deserializeOperation,
  encodeResponsePayload,
  serializeOperation,
} from "@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec";
import { OperationServiceImpl } from "@zenystx/helios-core/spi/impl/operationservice/impl/OperationServiceImpl";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { Message } from "@zenystx/helios-core/topic/Message";
import { DistributedTopicService } from "@zenystx/helios-core/topic/impl/DistributedTopicService";
import { TopicProxyImpl } from "@zenystx/helios-core/topic/impl/TopicProxyImpl";
import { ReliableTopicProxyImpl } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicProxyImpl";
import { ReliableTopicService } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";

/** Service name constant for the distributed map service. */
const MAP_SERVICE_NAME = "hz:impl:mapService";
const QUEUE_SERVICE_NAME = "hz:impl:queueService";
const TOPIC_SERVICE_NAME = "hz:impl:topicService";
const RELIABLE_TOPIC_SERVICE_NAME = "hz:impl:reliableTopicService";
const EXECUTOR_SERVICE_NAME = "hz:impl:executorService";

type BlitzServerManagerLike = {
  shutdown(): Promise<void>;
  clientUrls: string[];
};

type BlitzServiceLike = {
  shutdown(): Promise<void>;
  readonly isClosed: boolean;
  readonly jsm?: { getAccountInfo(): Promise<unknown> };
};

type BlitzRuntimeHandle = {
  manager: BlitzServerManagerLike;
  service: BlitzServiceLike;
  registration: {
    serverName: string;
    clientPort: number;
    clusterPort: number;
    advertiseHost: string;
    clusterName: string;
  };
};

type BlitzRuntimeLauncher = (input: {
  instanceName: string;
  config: HeliosBlitzRuntimeConfig;
  routes: string[];
}) => Promise<BlitzRuntimeHandle>;

const defaultBlitzRuntimeLauncher: BlitzRuntimeLauncher = async ({
  instanceName,
  config,
  routes,
}) => {
  const blitz = await import("@zenystx/helios-blitz");
  const resolved = blitz.resolveClusterNodeConfig({
    bindHost: config.bindHost,
    advertiseHost: config.advertiseHost,
    port: config.localPort,
    clusterPort: config.localClusterPort,
    clusterName: config.clusterName,
    serverName: `blitz-${instanceName}`,
    routes,
    dataDir: config.dataDir,
    startTimeoutMs: config.startTimeoutMs,
  });
  const manager = await blitz.clusterNode(resolved);
  const service = await blitz.BlitzService.connect({
    servers: manager.clientUrls,
    connectTimeoutMs: config.startTimeoutMs,
  });
  const jsm = await service.getJsm(config.startTimeoutMs);
  await jsm.getAccountInfo();
  return {
    manager,
    service,
    registration: {
      serverName: resolved.serverName,
      clientPort: resolved.port,
      clusterPort: resolved.clusterPort,
      advertiseHost: resolved.advertiseHost,
      clusterName: resolved.clusterName,
    },
  };
};

interface TopicClientListenerRegistration {
  topicName: string;
  registrationId: string;
  topicListenerId: string;
}

/** Parse "host:port" or "host" (default port 5701). */
function parseMemberAddress(member: string): [string, number] {
  const trimmed = member.trim();
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > 0 && lastColon < trimmed.length - 1) {
    const host = trimmed.substring(0, lastColon);
    const port = parseInt(trimmed.substring(lastColon + 1), 10);
    if (!isNaN(port)) return [host, port];
  }
  return [trimmed, 5701];
}

export class HeliosInstanceImpl implements HeliosInstance {
  private static _blitzRuntimeLauncher: BlitzRuntimeLauncher =
    defaultBlitzRuntimeLauncher;

  static setBlitzRuntimeLauncherForTests(
    launcher: BlitzRuntimeLauncher | null,
  ): void {
    this._blitzRuntimeLauncher = launcher ?? defaultBlitzRuntimeLauncher;
  }

  private readonly _name: string;
  private readonly _config: HeliosConfig;
  private _nodeEngine!: NodeEngineImpl;
  private readonly _mapService: MapContainerService;
  private readonly _lifecycleService: HeliosLifecycleService;
  private _cluster: Cluster;
  private _clusterCoordinator: HeliosClusterCoordinator | null = null;
  private _distributedQueueService: DistributedQueueService | null = null;
  private _distributedTopicService: DistributedTopicService | null = null;
  private _reliableTopicService: ReliableTopicService;
  private _ringbufferService!: RingbufferService;
  private readonly _replicaManager = new PartitionReplicaManager(271, 20);

  // Per-name data-structure caches (same name → same instance)
  private readonly _maps = new Map<string, MapProxy<unknown, unknown>>();
  private readonly _nearCachedMaps = new Map<
    string,
    NearCachedIMapWrapper<unknown, unknown>
  >();
  private readonly _queues = new Map<string, IQueue<unknown>>();
  private readonly _lists = new Map<string, ListImpl<unknown>>();
  private readonly _sets = new Map<string, SetImpl<unknown>>();
  private readonly _topics = new Map<string, ITopic<unknown>>();
  private readonly _reliableTopics = new Map<string, ITopic<unknown>>();
  private readonly _multiMaps = new Map<
    string,
    MultiMapImpl<unknown, unknown>
  >();
  private readonly _replicatedMaps = new Map<
    string,
    ReplicatedMapImpl<unknown, unknown>
  >();
  private readonly _executors = new Map<string, ExecutorServiceProxy>();
  private readonly _executorContainers = new Map<string, ExecutorContainerService>();
  private readonly _scheduledExecutors = new Map<string, ScheduledExecutorServiceProxy>();
  private readonly _scheduledExecutorContainers = new Map<string, ScheduledContainerService>();
  private _knownExecutorMemberIds = new Set<string>();

  /** TCP transport — non-null when TCP-IP or multicast join is enabled. */
  private _transport: TcpClusterTransport | null = null;

  /** Multicast service — non-null when multicast join is enabled. */
  private _multicastService: MulticastService | null = null;

  /** Multicast joiner — non-null when multicast join is enabled. */
  private _multicastJoiner: MulticastJoiner | null = null;

  /** Blitz lifecycle manager — non-null when Blitz distributed-auto or embedded-local is enabled. */
  private _blitzLifecycleManager: HeliosBlitzLifecycleManager | null = null;

  /**
   * Blitz NATS server manager — owns the nats-server child process lifecycle.
   * Set by startBlitzRuntime(); null before runtime start or after shutdown.
   * Typed as `any` to avoid cross-workspace type dependency on @zenystx/helios-blitz.
   */
  private _natsServerManager: { shutdown(): Promise<void>; clientUrls: string[] } | null = null;

  /**
   * Blitz service instance — the connected NATS/JetStream/KV client.
   * Set by startBlitzRuntime(); null before runtime start or after shutdown.
   * Access guarded by the pre-cutover readiness fence via getBlitzService().
   */
  private _blitzService: { shutdown(): Promise<void>; isClosed: boolean } | null = null;
  private _blitzRegistration:
    | {
        serverName: string;
        clientPort: number;
        clusterPort: number;
        advertiseHost: string;
        clusterName: string;
      }
    | null = null;
  private _blitzAuthorityKey: string | null = null;
  private _blitzAuthorityEpoch = 0;
  private _blitzQueue: Promise<void> = Promise.resolve();
  private _blitzStartupPromise: Promise<void> | null = null;
  private _blitzCurrentRoutes: string[] = [];

  /** Client protocol server — non-null when client protocol port is configured (>= 0). */
  private _clientProtocolServer: ClientProtocolServer | null = null;

  /** Current log level (mutable via REST CLUSTER_WRITE). */
  private _logLevel: string = "INFO";

  /** Metrics registry — non-null when monitoring is enabled. */
  private _metricsRegistry: MetricsRegistry | null = null;

  /** Metrics sampler — non-null when monitoring is enabled. */
  private _metricsSampler: MetricsSampler | null = null;

  /** Built-in REST server — non-null when REST API is configured. */
  private readonly _restServer: HeliosRestServer;

  /** Near-cache manager — creates/manages near-caches per map name. */
  private readonly _nearCacheManager: DefaultNearCacheManager;

  /** Production serialization service — shared by NodeEngine and NearCacheManager. */
  private readonly _ss: SerializationServiceImpl;

  /**
   * Subscribers for remote INVALIDATE messages.
   * Registered via onRemoteInvalidate().
   */
  private readonly _invalidateCallbacks: Array<
    (mapName: string, key: unknown) => void
  > = [];

  private _running = true;

  /** Registered async shutdown hooks — awaited during shutdownAsync(). */
  private readonly _shutdownHooks: Array<() => Promise<void>> = [];
  private readonly _clientTopicListenerRegistrations = new Map<string, TopicClientListenerRegistration>();
  private readonly _clientSessionTopicListeners = new Map<string, Set<string>>();

  constructor(config?: HeliosConfig) {
    this._config = config ?? new HeliosConfig();
    this._name = this._config.getName();

    // Production SerializationServiceImpl — single shared instance for NodeEngine + NearCacheManager.
    const serializationConfig = new SerializationConfig();
    this._ss = new SerializationServiceImpl(serializationConfig);

    // MapContainerService — must be registered before any map proxy creation
    this._mapService = new MapContainerService();

    // Near-cache manager — shares the same serialization service as the node engine
    this._nearCacheManager = new DefaultNearCacheManager(this._ss);

    // Validate reliable-topic configs: backing ringbuffer must have backupCount >= 1
    this._validateReliableTopicConfigs();

    // Validate executor configs: reject inline backend in production unless testing override is set
    this._validateExecutorConfigs();

    // Lifecycle and cluster
    this._lifecycleService = new HeliosLifecycleService();
    this._cluster = new LocalCluster();

    // Start TCP networking if configured (creates NodeEngine with routing)
    // or create default single-node NodeEngine
    this._startNetworking();

    // RingbufferService — backs reliable topic storage through service containers
    this._ringbufferService = new RingbufferService(this._nodeEngine);

    // Reliable topic service — always available (single-node ringbuffer-backed via RingbufferService)
    this._reliableTopicService = new ReliableTopicService(
      this._name,
      this._config,
      this._ringbufferService,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );

    // Initialize Blitz lifecycle manager if configured
    this._initBlitzLifecycle();

    // Start built-in REST server if configured
    this._restServer = new HeliosRestServer(
      this._config.getNetworkConfig().getRestApiConfig(),
    );
    const healthHandler = new HealthCheckHandler(this);
    this._restServer.registerHandler("/hazelcast/health", (req) =>
      healthHandler.handle(req),
    );

    const clusterReadHandler = new ClusterReadHandler(this);
    this._restServer.registerHandler("/hazelcast/rest/cluster", (req) =>
      clusterReadHandler.handle(req),
    );
    this._restServer.registerHandler("/hazelcast/rest/instance", (req) =>
      clusterReadHandler.handle(req),
    );

    const clusterWriteHandler = new ClusterWriteHandler(this);
    this._restServer.registerHandler("/hazelcast/rest/log-level", (req) =>
      clusterWriteHandler.handle(req),
    );
    this._restServer.registerHandler("/hazelcast/rest/management", (req) =>
      clusterWriteHandler.handle(req),
    );

    const dataHandler = new DataHandler(this._makeDataStore());
    this._restServer.registerHandler("/hazelcast/rest/maps", (req) =>
      dataHandler.handle(req),
    );
    this._restServer.registerHandler("/hazelcast/rest/queues", (req) =>
      dataHandler.handle(req),
    );

    this._restServer.start();

    // Initialize monitoring subsystem if configured
    this._initMonitor();

    // Start client protocol server if configured
    this._startClientProtocolServer();
  }

  // ── config validation ────────────────────────────────────────────────

  private _validateReliableTopicConfigs(): void {
    const TOPIC_RB_PREFIX = "_hz_rb_";
    for (const [name] of this._config.getReliableTopicConfigs()) {
      const rbName = TOPIC_RB_PREFIX + name;
      const rbConfig = this._config.getRingbufferConfig(rbName);
      if (rbConfig.getBackupCount() < 1) {
        throw new Error(
          `Reliable topic '${name}': backing ringbuffer '${rbName}' has backupCount=${rbConfig.getBackupCount()}, ` +
          `but the v1 publish completion contract requires backupCount >= 1. ` +
          `Set backupCount >= 1 on the backing ringbuffer config or remove the reliable-topic config.`,
        );
      }
    }
  }

  private _validateExecutorConfigs(): void {
    for (const [name, config] of this._config.getExecutorConfigs()) {
      if (config.getExecutionBackend() === 'inline' && !config.getAllowInlineBackend()) {
        throw new Error(
          `Executor "${name}" is configured with inline backend but allowInlineBackend is not set. ` +
          'The inline execution backend is not supported in production. ' +
          'Use scatter (default) for production, or set allowInlineBackend(true) for test/dev bootstrap flows.',
        );
      }
    }
  }

  // ── TCP networking ───────────────────────────────────────────────────

  private _startNetworking(): void {
    const joinConfig = this._config.getNetworkConfig().getJoin();
    const tcpIp = joinConfig.getTcpIpConfig();
    const multicast = joinConfig.getMulticastConfig();

    const clusteringEnabled = tcpIp.isEnabled() || multicast.isEnabled();
    if (!clusteringEnabled) {
      // Single-node mode: default NodeEngine with local-only operation service
      this._nodeEngine = new NodeEngineImpl(this._ss);
      this._mapService.setNodeEngine(this._nodeEngine);
      this._nodeEngine.registerService(MapService.SERVICE_NAME, this._mapService);
      // Register all MapStoreConfigs so operations can trigger lazy init (Block 21.2)
      this._registerMapStoreConfigs();
      return;
    }

    const port = this._config.getNetworkConfig().getPort();
    this._transport = new TcpClusterTransport(this._name);
    this._transport.start(port, "0.0.0.0");

    // Create cluster coordinator (needs transport bound port)
    this._clusterCoordinator = new HeliosClusterCoordinator(
      this._name,
      this._config,
      this._transport,
      this._ss,
    );
    if (!multicast.isEnabled()) {
      this._clusterCoordinator.bootstrap();
    }
    this._cluster = this._clusterCoordinator.getCluster();
    const internalPartitionService = this._clusterCoordinator.getInternalPartitionService();
    internalPartitionService.setReplicaManager(this._replicaManager);
    internalPartitionService.setLocalMemberUuid(this._clusterCoordinator.getLocalMemberId());
    internalPartitionService.setAntiEntropyDispatcher((targetUuid, op) => {
      this._dispatchAntiEntropy(targetUuid, op);
    });
    this._knownExecutorMemberIds = this._captureCurrentMemberIds();
    this._clusterCoordinator.onMembershipChanged(() => {
      this._handleExecutorMembershipChange();
    });

    // Build a partition service adapter that delegates to the coordinator
    const coordinator = this._clusterCoordinator;
    const localAddress = coordinator.getLocalAddress();
    const clusteredPartitionService: PartitionService & {
      onMapPartitionLost: typeof internalPartitionService.onMapPartitionLost;
      removeMapPartitionLostListener: typeof internalPartitionService.removeMapPartitionLostListener;
      recordNamespaceMutation: typeof internalPartitionService.recordNamespaceMutation;
      applyNamespaceBackupMutation: typeof internalPartitionService.applyNamespaceBackupMutation;
      getBackupCount: typeof internalPartitionService.getBackupCount;
    } = {
      getPartitionCount: () => 271,
      getPartitionId: (key: Data) => {
        const hash = key.getPartitionHash();
        const mod = hash % 271;
        return mod < 0 ? mod + 271 : mod;
      },
      getPartitionOwner: (partitionId: number) => {
        const ownerId = coordinator.getOwnerId(partitionId);
        if (ownerId === null) return null;
        return coordinator.getMemberAddress(ownerId);
      },
      isMigrating: () => false,
      onMapPartitionLost: internalPartitionService.onMapPartitionLost.bind(internalPartitionService),
      removeMapPartitionLostListener: internalPartitionService.removeMapPartitionLostListener.bind(internalPartitionService),
      recordNamespaceMutation: internalPartitionService.recordNamespaceMutation.bind(internalPartitionService),
      applyNamespaceBackupMutation: internalPartitionService.applyNamespaceBackupMutation.bind(internalPartitionService),
      getBackupCount: internalPartitionService.getBackupCount.bind(internalPartitionService),
    };

    // Build a routing-mode OperationService with remoteSend wired to transport
    const transport = this._transport;
    const pendingResponses = new Map<number, {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }>();
    this._pendingResponses = pendingResponses;

    let callIdCounter = 1;
    const operationService = new OperationServiceImpl(
      null as unknown as NodeEngineImpl, // will be set below via back-reference
      {
        localMode: false,
        localAddress,
        remoteSend: async (op, target) => {
          const callId = callIdCounter++;
          const { operationType, payload } = serializeOperation(op);
          const targetMemberId = this._findMemberIdByAddress(target);
          if (targetMemberId === null) {
            throw new Error(`No member found for address ${target.getHost()}:${target.getPort()}`);
          }

          return new Promise<void>((resolve, reject) => {
            pendingResponses.set(callId, {
              resolve: (value: unknown) => {
                op.sendResponse(value);
                resolve();
              },
              reject: (error: Error) => {
                reject(error);
              },
            });

            const operationMsg: import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage = {
              type: 'OPERATION',
              callId,
              partitionId: op.partitionId,
              operationType,
              payload,
              senderId: coordinator.getLocalMemberId(),
            };

            // Use async send to offload JSON.stringify to a scatter worker thread
            void transport.sendAsync(targetMemberId, operationMsg).then((sent) => {
              if (!sent) {
                // Peer disconnected or channel closed — fail fast
                pendingResponses.delete(callId);
                reject(new Error(`Send failed: peer ${targetMemberId} not connected (callId=${callId})`));
              }
            });

            // Timeout after 10 seconds
            setTimeout(() => {
              if (pendingResponses.has(callId)) {
                pendingResponses.delete(callId);
                reject(new Error(`Operation timed out (callId=${callId})`));
              }
            }, 10_000);
          });
        },
      },
    );

    // Create NodeEngine with clustered operation service and partition service
    this._nodeEngine = new NodeEngineImpl(this._ss, {
      localAddress,
      operationService,
      partitionService: clusteredPartitionService,
    });

    // Back-patch the operation service's node engine reference
    (operationService as any)._nodeEngine = this._nodeEngine;

    this._mapService.setNodeEngine(this._nodeEngine);
    this._nodeEngine.registerService(MapService.SERVICE_NAME, this._mapService);
    // Register MapContainerService as MigrationAwareService (Block 21.3)
    this._clusterCoordinator!.registerMigrationAwareService(MapService.SERVICE_NAME, this._mapService);
    // Register all MapStoreConfigs so operations can trigger lazy init (Block 21.2)
    this._registerMapStoreConfigs();
    internalPartitionService.startAntiEntropy();

    // Wire transport callbacks
    this._transport.onRemoteInvalidate = (mapName, key) => {
      const nearCache = this._nearCacheManager.getNearCache(mapName);
      if (nearCache) nearCache.invalidate(key);
      for (const cb of this._invalidateCallbacks) cb(mapName, key);
    };
    this._transport.onPeerConnected = (nodeId) => {
      this._clusterCoordinator?.handlePeerConnected(nodeId);
    };
    this._transport.onPeerDisconnected = (nodeId) => {
      this._clusterCoordinator?.handlePeerDisconnected(nodeId);
    };
    this._transport.onMessage = (message) => {
      // Handle OPERATION messages: execute on this node and send response
      if (message.type === 'OPERATION') {
        this._handleRemoteOperation(message);
        return;
      }
      // Handle OPERATION_RESPONSE messages: complete pending invocations
      if (message.type === 'OPERATION_RESPONSE') {
        this._handleOperationResponse(message);
        return;
      }
      if (message.type === 'RECOVERY_ANTI_ENTROPY') {
        this._handleRecoveryAntiEntropy(message);
        return;
      }
      if (message.type === 'RECOVERY_SYNC_REQUEST') {
        this._handleRecoverySyncRequest(message);
        return;
      }
      if (message.type === 'RECOVERY_SYNC_RESPONSE') {
        this._handleRecoverySyncResponse(message);
        return;
      }

      if (this._clusterCoordinator?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedQueueService?.handleMessage(message) === true) {
        return;
      }
      if (this._reliableTopicService?.handleMessage(message) === true) {
        return;
      }
      this._distributedTopicService?.handleMessage(message);
    };

    // Legacy MAP_PUT/MAP_REMOVE/MAP_CLEAR callbacks are no longer used
    // for authoritative map operations. Keep as no-ops for compatibility
    // with any legacy messages from older nodes.
    this._transport.onRemotePut = () => {};
    this._transport.onRemoteRemove = () => {};
    this._transport.onRemoteClear = () => {};

    this._distributedQueueService = new DistributedQueueService(
      this._name,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedTopicService = new DistributedTopicService(
      this._name,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );

    // Connect to configured peers or discover via multicast
    if (multicast.isEnabled()) {
      this._startMulticastDiscovery(multicast);
    } else {
      for (const member of tcpIp.getMembers()) {
        const [host, peerPort] = parseMemberAddress(member);
        this._transport.connectToPeer(host, peerPort).catch(() => {});
      }
    }
  }

  /**
   * Start multicast discovery: creates the MulticastService and MulticastJoiner,
   * then performs async multicast discovery to find the cluster master.
   * Once discovered, connects via TCP to the master using the existing join protocol.
   */
  private _startMulticastDiscovery(multicastConfig: import('@zenystx/helios-core/config/MulticastConfig').MulticastConfig): void {
    const multicastService = MulticastService.create(multicastConfig);
    if (multicastService === null) return;
    this._multicastService = multicastService;

    this._multicastService.start();

    const boundPort = this._transport!.boundPort();
    if (boundPort === null) return;

    this._multicastJoiner = new MulticastJoiner({
      multicastConfig,
      multicastService: this._multicastService,
      localAddress: { host: '127.0.0.1', port: boundPort },
      localUuid: this._name,
      clusterName: this._config.getName(),
      partitionCount: 271,
      version: { major: 1, minor: 0, patch: 0 },
    });

    void (async () => {
      await multicastService.waitForReady();
      if (!this._running) return;

      const result = await this._multicastJoiner!.join();
      if (!this._running) return;

      if (result.masterFound && result.masterAddress !== null) {
        this._multicastJoiner?.setJoined();
        this._transport?.connectToPeer(
          result.masterAddress.host,
          result.masterAddress.port,
        ).catch(() => {});
      } else {
        this._multicastJoiner?.setAsMaster();
        this._clusterCoordinator?.bootstrap();
      }
    })();
  }

  /** Pending remote operation responses (callId → resolver). */
  private _pendingResponses: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> | null = null;

  /** Handle an incoming OPERATION message: execute locally and send response. */
  private _handleRemoteOperation(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'OPERATION' }>): void {
    const { callId, partitionId, operationType, payload } = message;
    const op = deserializeOperation(operationType, payload as any);
    op.partitionId = partitionId;
    op.setNodeEngine(this._nodeEngine);

    void (async () => {
      let responseValue: unknown = undefined;
      let errorMsg: string | null = null;

      op.setResponseHandler({
        sendResponse: (_op, response) => {
          responseValue = response;
        },
      });

      try {
        await op.beforeRun();
        await op.run();
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }

      // Find who sent this and reply — use async send to offload response
      // serialization to a scatter worker thread
      const senderMemberId = this._findSenderForOperation(message);
      if (senderMemberId !== null && this._transport !== null) {
        void this._transport.sendAsync(senderMemberId, {
          type: 'OPERATION_RESPONSE',
          callId,
          payload: encodeResponsePayload(responseValue),
          error: errorMsg,
        });
      }
    })();
  }

  /** Handle an incoming OPERATION_RESPONSE message. */
  private _handleOperationResponse(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'OPERATION_RESPONSE' }>): void {
    const pending = this._pendingResponses?.get(message.callId);
    if (pending === undefined) return;
    this._pendingResponses!.delete(message.callId);
    if (message.error !== null) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(decodeResponsePayload(message.payload));
    }
  }

  private _dispatchAntiEntropy(
    targetUuid: string,
    op: PartitionBackupReplicaAntiEntropyOp,
  ): void {
    const namespaceVersions = Object.fromEntries(
      [...(op.namespaceVersions ?? new Map<string, bigint[]>())].map(([namespace, versions]) => [
        namespace,
        versions.map((value: bigint) => value.toString()),
      ]),
    );
    this._transport?.send(targetUuid, {
      type: 'RECOVERY_ANTI_ENTROPY',
      senderId: this._clusterCoordinator!.getLocalMemberId(),
      partitionId: op.partitionId,
      replicaIndex: op.targetReplicaIndex,
      primaryVersions: op.primaryVersions.map((value) => value.toString()),
      namespaceVersions,
    });
  }

  private _handleRecoveryAntiEntropy(
    message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'RECOVERY_ANTI_ENTROPY' }>,
  ): void {
    const op = new PartitionBackupReplicaAntiEntropyOp(
      message.partitionId,
      message.primaryVersions.map((value) => BigInt(value)),
      message.replicaIndex,
      new Map(
        Object.entries(message.namespaceVersions).map(([namespace, versions]) => [
          namespace,
          versions.map((value) => BigInt(value)),
        ]),
      ),
    );
    const result = op.execute(this._replicaManager);
    if (!result.syncTriggered) {
      return;
    }
    const acquired = this._replicaManager.tryAcquireReplicaSyncPermits(1);
    if (acquired === 0) {
      return;
    }
    const ownerId = this.getPartitionOwnerId(message.partitionId);
    if (ownerId === null) {
      this._replicaManager.releaseReplicaSyncPermits(1);
      return;
    }
    this._transport?.send(ownerId, {
      type: 'RECOVERY_SYNC_REQUEST',
      requesterId: this._clusterCoordinator!.getLocalMemberId(),
      partitionId: message.partitionId,
      replicaIndex: message.replicaIndex,
      dirtyNamespaces: result.dirtyNamespaces,
    });
  }

  private _handleRecoverySyncRequest(
    message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'RECOVERY_SYNC_REQUEST' }>,
  ): void {
    const namespaceStates = this._mapService.collectPartitionNamespaceStates(
      message.partitionId,
      message.dirtyNamespaces,
    );
    const namespaceVersions = Object.fromEntries(
      message.dirtyNamespaces.map((namespace) => [
        namespace,
        this._replicaManager
          .getNamespaceReplicaVersions(message.partitionId, namespace)
          .map((value) => value.toString()),
      ]),
    );
    this._transport?.send(message.requesterId, {
      type: 'RECOVERY_SYNC_RESPONSE',
      partitionId: message.partitionId,
      replicaIndex: message.replicaIndex,
      versions: this._replicaManager
        .getPartitionReplicaVersions(message.partitionId)
        .map((value) => value.toString()),
      namespaceVersions,
      namespaceStates: namespaceStates.map((state) => ({
        namespace: state.namespace,
        estimatedSizeBytes: state.estimatedSizeBytes,
        entries: state.entries.map(([key, value]) => [encodeData(key), encodeData(value)] as const),
      })),
    });
  }

  private _handleRecoverySyncResponse(
    message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'RECOVERY_SYNC_RESPONSE' }>,
  ): void {
    const namespaceStates = message.namespaceStates.map((state) => ({
      namespace: state.namespace,
      estimatedSizeBytes: state.estimatedSizeBytes,
      entries: state.entries.map(([key, value]) => [decodeData(key), decodeData(value)] as const),
    }));
    this._mapService.applyReplicaSyncState(message.partitionId, namespaceStates);
    new PartitionReplicaSyncResponse(
      message.partitionId,
      message.replicaIndex,
      namespaceStates,
      message.versions.map((value) => BigInt(value)),
      new Map(
        Object.entries(message.namespaceVersions).map(([namespace, versions]) => [
          namespace,
          versions.map((value) => BigInt(value)),
        ]),
      ),
    ).apply(
      this._mapService.getOrCreatePartitionContainer(message.partitionId),
      this._replicaManager,
    );
  }

  /** Extract the sender member ID from an OPERATION message. */
  private _findSenderForOperation(message: { senderId: string }): string | null {
    return message.senderId ?? null;
  }

  /** Find the member ID for a given address. */
  private _findMemberIdByAddress(target: Address): string | null {
    if (this._clusterCoordinator === null) return null;
    const members = this._cluster.getMembers();
    for (const member of members) {
      if (member.getAddress().equals(target)) {
        return member.getUuid();
      }
    }
    return null;
  }

  private _initBlitzLifecycle(): void {
    const blitzConfig = this._config.getBlitzConfig();
    if (!blitzConfig || blitzConfig.enabled === false) return;

    this._blitzLifecycleManager = new HeliosBlitzLifecycleManager(
      blitzConfig,
      this._name,
    );

    // Register Blitz lifecycle cleanup as a shutdown hook
    this.registerShutdownHook(async () => {
      this._blitzLifecycleManager?.markShutdown();
    });

    this._clusterCoordinator?.onMembershipChanged(() => {
      this._handleBlitzAuthorityChange();
    });
    this._clusterCoordinator?.onBlitzCoordinatorEvent({
      onAuthorityChanged: () => {
        this._handleBlitzAuthorityChange();
      },
      onTopologyResponse: (state) => {
        this._scheduleBlitzTask(async (epoch) => {
          await this._handleIncomingBlitzTopologyResponse(epoch, state);
        });
      },
      onTopologyAnnounce: (state) => {
        this._scheduleBlitzTask(async (epoch) => {
          await this._applyBlitzTopology(epoch, state.routes);
        });
      },
      onTopologyRegistrationChanged: () => {
        this._maybeBroadcastBlitzTopology();
      },
      onDemotion: () => {
        this._handleBlitzDemotion();
      },
    });

    this._scheduleBlitzTask(async (epoch) => {
      await this._ensureBlitzRuntime(epoch, []);
      this._handleBlitzAuthorityChange();
    });
  }

  private _scheduleBlitzTask(
    task: (epoch: number) => Promise<void>,
  ): Promise<void> {
    if (this._blitzLifecycleManager === null) {
      return Promise.resolve();
    }
    const epoch = this._blitzAuthorityEpoch;
    const run = this._blitzQueue.then(() => task(epoch));
    this._blitzQueue = run.catch(() => {});
    return run;
  }

  async waitForBlitzOrchestration(): Promise<void> {
    await this._blitzQueue;
  }

  private _isStaleBlitzEpoch(epoch: number): boolean {
    return !this._running || this._blitzAuthorityEpoch !== epoch;
  }

  private async _ensureBlitzRuntime(
    epoch: number,
    routes: string[],
  ): Promise<void> {
    if (this._blitzLifecycleManager === null || this._isStaleBlitzEpoch(epoch)) {
      return;
    }
    if (this._blitzRegistration !== null && this._sameRoutes(routes)) {
      return;
    }

    const readinessBeforeStart = this._blitzLifecycleManager.getReadinessState();
    const runtime = await HeliosInstanceImpl._blitzRuntimeLauncher({
      instanceName: this._name,
      config: this._blitzLifecycleManager.getConfig(),
      routes,
    });
    if (this._isStaleBlitzEpoch(epoch)) {
      await runtime.service.shutdown().catch(() => {});
      await runtime.manager.shutdown().catch(() => {});
      return;
    }

    await this._shutdownBlitzRuntimeRefs();
    this._natsServerManager = runtime.manager;
    this._blitzService = runtime.service;
    this._blitzRegistration = runtime.registration;
    this._blitzStartupPromise = Promise.resolve();
    this._blitzCurrentRoutes = [...routes];
    if (readinessBeforeStart === BlitzReadinessState.NOT_READY) {
      this._blitzLifecycleManager.onLocalNodeStarted();
    }
  }

  private async _shutdownBlitzRuntimeRefs(): Promise<void> {
    const service = this._blitzService;
    const manager = this._natsServerManager;
    this._blitzService = null;
    this._natsServerManager = null;
    this._blitzRegistration = null;
    this._blitzCurrentRoutes = [];
    if (service !== null) {
      await service.shutdown().catch(() => {});
    }
    if (manager !== null) {
      await manager.shutdown().catch(() => {});
    }
  }

  private _handleBlitzAuthorityChange(): void {
    if (this._blitzLifecycleManager === null) {
      return;
    }

    if (this._clusterCoordinator === null) {
      this._blitzLifecycleManager.onTopologyEpochChange(this._name, 1);
      this._scheduleBlitzTask(async (epoch) => {
        await this._ensureBlitzRuntime(epoch, []);
        if (!this._isStaleBlitzEpoch(epoch)) {
          this._blitzLifecycleManager?.onStandaloneReady();
        }
      });
      return;
    }

    const coordinator = this._clusterCoordinator.getBlitzCoordinator();
    const masterMemberId = coordinator.getMasterMemberId();
    const memberListVersion = coordinator.getMemberListVersion();
    if (masterMemberId === null || !this._clusterCoordinator.isJoined()) {
      return;
    }

    const authorityKey = `${masterMemberId}:${memberListVersion}`;
    if (authorityKey !== this._blitzAuthorityKey) {
      this._blitzAuthorityEpoch += 1;
      this._blitzAuthorityKey = authorityKey;
      this._blitzLifecycleManager.onTopologyEpochChange(
        masterMemberId,
        memberListVersion,
      );
    }

    this._scheduleBlitzTask(async (epoch) => {
      await this._ensureBlitzRuntime(epoch, []);
      if (this._isStaleBlitzEpoch(epoch)) {
        return;
      }
      await this._registerWithBlitzMaster(epoch);
      await this._requestBlitzTopology(epoch);
    });
  }

  private _handleBlitzDemotion(): void {
    if (this._blitzLifecycleManager === null) {
      return;
    }
    this._blitzAuthorityEpoch += 1;
    this._blitzAuthorityKey = null;
    this._blitzLifecycleManager.onAuthorityLost();
    this._scheduleBlitzTask(async (epoch) => {
      await this._shutdownBlitzRuntimeRefs();
      if (!this._isStaleBlitzEpoch(epoch)) {
        await this._ensureBlitzRuntime(epoch, []);
      }
    });
  }

  private async _registerWithBlitzMaster(epoch: number): Promise<void> {
    if (
      this._clusterCoordinator === null ||
      this._blitzLifecycleManager === null ||
      this._blitzRegistration === null ||
      this._isStaleBlitzEpoch(epoch) ||
      !this._blitzLifecycleManager.canRegisterWithMaster()
    ) {
      return;
    }

    const baseMessage = this._blitzLifecycleManager.generateRegisterMessage();
    const message = {
      type: "BLITZ_NODE_REGISTER" as const,
      registration: {
        memberId: baseMessage.registration.memberId,
        memberListVersion: baseMessage.registration.memberListVersion,
        serverName: this._blitzRegistration.serverName,
        clientPort: this._blitzRegistration.clientPort,
        clusterPort: this._blitzRegistration.clusterPort,
        advertiseHost: this._blitzRegistration.advertiseHost,
        clusterName: this._blitzRegistration.clusterName,
        ready: baseMessage.registration.ready,
        startedAt: baseMessage.registration.startedAt,
      },
    };
    if (this._clusterCoordinator.getCluster().getLocalMember().getUuid() === this._clusterCoordinator.getBlitzCoordinator().getMasterMemberId()) {
      this._clusterCoordinator.handleMessage(message);
    } else {
      const masterMemberId = this._clusterCoordinator.getBlitzCoordinator().getMasterMemberId();
      if (masterMemberId !== null) {
        this._transport?.send(masterMemberId, message);
      }
    }
    this._blitzLifecycleManager.onRegisteredWithMaster();
    if (
      this._clusterCoordinator.getCluster().getLocalMember().getUuid() ===
        this._clusterCoordinator.getBlitzCoordinator().getMasterMemberId() &&
      this._clusterCoordinator.getBlitzCoordinator().getExpectedRegistrants().size === 1
    ) {
      this._blitzLifecycleManager.onStandaloneReady();
    }
    this._maybeBroadcastBlitzTopology();
  }

  private async _requestBlitzTopology(epoch: number): Promise<void> {
    if (this._clusterCoordinator === null || this._isStaleBlitzEpoch(epoch)) {
      return;
    }
    if (this._clusterCoordinator.getCluster().getLocalMember().getUuid() === this._clusterCoordinator.getBlitzCoordinator().getMasterMemberId()) {
      this._maybeBroadcastBlitzTopology();
      return;
    }
    const masterMemberId = this._clusterCoordinator.getBlitzCoordinator().getMasterMemberId();
    if (masterMemberId !== null) {
      this._transport?.send(masterMemberId, {
        type: "BLITZ_TOPOLOGY_REQUEST",
        requestId: crypto.randomUUID(),
      });
    }
  }

  private async _handleIncomingBlitzTopologyResponse(
    epoch: number,
    state: {
      routes: string[];
      registrationsComplete: boolean;
      retryAfterMs?: number;
    },
  ): Promise<void> {
    if (this._isStaleBlitzEpoch(epoch)) {
      return;
    }
    if (!state.registrationsComplete) {
      const retryAfterMs = state.retryAfterMs ?? 1000;
      this._clusterCoordinator
        ?.getBlitzCoordinator()
        .scheduleRetryTimer("blitz-topology-request", () => {
          this._scheduleBlitzTask(async (nextEpoch) => {
            await this._requestBlitzTopology(nextEpoch);
          });
        }, retryAfterMs);
      return;
    }
    await this._applyBlitzTopology(epoch, state.routes);
  }

  private _maybeBroadcastBlitzTopology(): void {
    if (this._clusterCoordinator === null) {
      return;
    }
    const blitzCoordinator = this._clusterCoordinator.getBlitzCoordinator();
    if (!blitzCoordinator.isRegistrationComplete()) {
      return;
    }
    const announce = blitzCoordinator.generateTopologyAnnounce();
    if (announce === null) {
      return;
    }
    this._transport?.broadcast(announce);
    this._scheduleBlitzTask(async (epoch) => {
      await this._applyBlitzTopology(epoch, announce.routes);
    });
  }

  private async _applyBlitzTopology(
    epoch: number,
    routes: string[],
  ): Promise<void> {
    if (this._blitzLifecycleManager === null || this._isStaleBlitzEpoch(epoch)) {
      return;
    }
    this._clusterCoordinator
      ?.getBlitzCoordinator()
      .cancelRetryTimer("blitz-topology-request");
    const peerRoutes = this._filterPeerRoutes(routes);
    if (peerRoutes.length === 0) {
      this._blitzLifecycleManager.onStandaloneReady();
      return;
    }
    if (!this._blitzLifecycleManager.needsClusteredCutover(peerRoutes)) {
      return;
    }
    await this._ensureBlitzRuntime(epoch, peerRoutes);
    if (!this._isStaleBlitzEpoch(epoch)) {
      this._blitzLifecycleManager.onClusteredCutoverComplete();
    }
  }

  private _filterPeerRoutes(routes: string[]): string[] {
    const localRoute = this._blitzRegistration === null
      ? null
      : `nats://${this._blitzRegistration.advertiseHost}:${this._blitzRegistration.clusterPort}`;
    return localRoute === null ? [...routes] : routes.filter((route) => route !== localRoute);
  }

  private _sameRoutes(routes: string[]): boolean {
    if (this._blitzCurrentRoutes.length !== routes.length) {
      return false;
    }
    return this._blitzCurrentRoutes.every((route, index) => route === routes[index]);
  }

  private _startClientProtocolServer(): void {
    const clientPort = this._config.getNetworkConfig().getClientProtocolPort();
    if (clientPort < 0) return;

    const localMember = this._cluster.getLocalMember();
    this._clientProtocolServer = new ClientProtocolServer({
      clusterName: this._name,
      port: clientPort,
      memberUuid: localMember.getUuid(),
      clusterId: this.getClusterId() ?? crypto.randomUUID(),
      partitionCount: this.getPartitionCount(),
      auth: this._config.getNetworkConfig().hasClientProtocolCredentials()
        ? {
          username: this._config.getNetworkConfig().getClientProtocolUsername()!,
          password: this._config.getNetworkConfig().getClientProtocolPassword() ?? '',
        }
        : null,
    });

    this._clientProtocolServer.setSessionCloseHandler((session) => {
      this._removeClientTopicListenersForSession(session.getSessionId());
    });

    this._registerClientProtocolHandlers();
    this._clientProtocolServer.start().catch(() => {});
  }

  private _registerClientProtocolHandlers(): void {
    const srv = this._clientProtocolServer!;
    const ps = this._nodeEngine.getPartitionService();

    // ── Map handlers ──────────────────────────────────────────────────────
    srv.registerHandler(MapPutCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapPutCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      const prev = store.put(req.key, req.value, Number(req.ttl), -1);
      return MapPutCodec.encodeResponse(prev);
    });

    srv.registerHandler(MapGetCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapGetCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      const val = store.get(req.key);
      return MapGetCodec.encodeResponse(val);
    });

    srv.registerHandler(MapRemoveCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapRemoveCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      const prev = store.remove(req.key);
      return MapRemoveCodec.encodeResponse(prev);
    });

    srv.registerHandler(MapSizeCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapSizeCodec.decodeRequest(msg);
      let total = 0;
      const partitionCount = this.getPartitionCount();
      for (let i = 0; i < partitionCount; i++) {
        const store = this._mapService.getRecordStore(req.name, i);
        if (store) total += store.size();
      }
      return MapSizeCodec.encodeResponse(total);
    });

    srv.registerHandler(MapContainsKeyCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapContainsKeyCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      return MapContainsKeyCodec.encodeResponse(store.containsKey(req.key));
    });

    srv.registerHandler(MapClearCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapClearCodec.decodeRequest(msg);
      const partitionCount = this.getPartitionCount();
      for (let i = 0; i < partitionCount; i++) {
        const store = this._mapService.getRecordStore(req.name, i);
        if (store) store.clear();
      }
      return MapClearCodec.encodeResponse();
    });

    srv.registerHandler(MapDeleteCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapDeleteCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      store.remove(req.key);
      return MapDeleteCodec.encodeResponse();
    });

    srv.registerHandler(MapSetCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = MapSetCodec.decodeRequest(msg);
      const pid = ps.getPartitionId(req.key);
      const store = this._mapService.getOrCreateRecordStore(req.name, pid);
      store.put(req.key, req.value, Number(req.ttl), -1);
      return MapSetCodec.encodeResponse();
    });

    // ── Queue handlers ────────────────────────────────────────────────────
    srv.registerHandler(QueueOfferCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = QueueOfferCodec.decodeRequest(msg);
      this._ensureQueueService();
      const result = await this._distributedQueueService!.offer(req.name, req.value, Number(req.timeoutMs));
      return QueueOfferCodec.encodeResponse(result);
    });

    srv.registerHandler(QueuePollCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = QueuePollCodec.decodeRequest(msg);
      this._ensureQueueService();
      const result = await this._distributedQueueService!.poll(req.name, Number(req.timeoutMs));
      return QueuePollCodec.encodeResponse(result);
    });

    srv.registerHandler(QueuePeekCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = QueuePeekCodec.decodeRequest(msg);
      this._ensureQueueService();
      const result = await this._distributedQueueService!.peek(req.name);
      return QueuePeekCodec.encodeResponse(result);
    });

    srv.registerHandler(QueueSizeCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = QueueSizeCodec.decodeRequest(msg);
      this._ensureQueueService();
      const result = await this._distributedQueueService!.size(req.name);
      return QueueSizeCodec.encodeResponse(result);
    });

    srv.registerHandler(QueueClearCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = QueueClearCodec.decodeRequest(msg);
      this._ensureQueueService();
      await this._distributedQueueService!.clear(req.name);
      return QueueClearCodec.encodeResponse();
    });

    // ── Topic handler ─────────────────────────────────────────────────────
    srv.registerHandler(TopicPublishCodec.REQUEST_MESSAGE_TYPE, async (msg) => {
      const req = TopicPublishCodec.decodeRequest(msg);
      this._ensureTopicService();
      await this._distributedTopicService!.publish(req.name, req.message);
      return TopicPublishCodec.encodeResponse();
    });

    srv.registerHandler(TopicAddMessageListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
      const req = TopicAddMessageListenerCodec.decodeRequest(msg);
      const registrationId = this._registerClientTopicListener(req.name, msg.getCorrelationId(), session);
      return TopicAddMessageListenerCodec.encodeResponse(registrationId);
    });

    srv.registerHandler(TopicRemoveMessageListenerCodec.REQUEST_MESSAGE_TYPE, async (msg, session) => {
      const req = TopicRemoveMessageListenerCodec.decodeRequest(msg);
      return TopicRemoveMessageListenerCodec.encodeResponse(
        this._removeClientTopicListener(session.getSessionId(), req.registrationId),
      );
    });
  }

  private _ensureQueueService(): void {
    if (this._distributedQueueService === null) {
      this._distributedQueueService = new DistributedQueueService(
        this._name,
        this._config,
        this._ss,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _ensureTopicService(): void {
    if (this._distributedTopicService === null) {
      this._distributedTopicService = new DistributedTopicService(
        this._name,
        this._config,
        this._ss,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _registerClientTopicListener(topicName: string, correlationId: number, session: ClientSession): string {
    this._ensureTopicService();
    const registrationId = crypto.randomUUID();
    const topicListenerId = this._distributedTopicService!.addMessageListener(topicName, (message: Message<unknown>) => {
      const payload = this._ss.toData(message.getMessageObject());
      if (payload === null) {
        return;
      }
      const eventMessage = TopicAddMessageListenerCodec.encodeEvent(
        topicName,
        payload,
        message.getPublishTime(),
        message.getPublishingMemberId(),
      );
      eventMessage.setCorrelationId(correlationId);
      session.pushEvent(eventMessage);
    });
    this._clientTopicListenerRegistrations.set(registrationId, {
      topicName,
      registrationId,
      topicListenerId,
    });
    let sessionRegistrations = this._clientSessionTopicListeners.get(session.getSessionId());
    if (sessionRegistrations === undefined) {
      sessionRegistrations = new Set<string>();
      this._clientSessionTopicListeners.set(session.getSessionId(), sessionRegistrations);
    }
    sessionRegistrations.add(registrationId);
    return registrationId;
  }

  private _removeClientTopicListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientTopicListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientTopicListenerRegistrations.delete(registrationId);
    const sessionRegistrations = this._clientSessionTopicListeners.get(sessionId);
    sessionRegistrations?.delete(registrationId);
    if (sessionRegistrations !== undefined && sessionRegistrations.size === 0) {
      this._clientSessionTopicListeners.delete(sessionId);
    }
    this._ensureTopicService();
    return this._distributedTopicService!.removeMessageListener(
      registration.topicName,
      registration.topicListenerId,
    );
  }

  private _removeClientTopicListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionTopicListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientTopicListener(sessionId, registrationId);
    }
  }

  /**
   * Returns the port the client protocol server is listening on, or 0 if not started.
   */
  getClientProtocolPort(): number {
    return this._clientProtocolServer?.getPort() ?? 0;
  }

  /**
   * Returns the Blitz lifecycle manager, or null if Blitz is not enabled.
   */
  getBlitzLifecycleManager(): HeliosBlitzLifecycleManager | null {
    return this._blitzLifecycleManager;
  }

  /**
   * Returns the NATS server manager that owns the child process lifecycle,
   * or null if Blitz runtime has not been started or has been shut down.
   */
  getNatsServerManager(): { shutdown(): Promise<void>; clientUrls: string[] } | null {
    return this._natsServerManager;
  }

  /**
   * Returns the connected BlitzService instance, or null if:
   * - Blitz is not enabled
   * - The pre-cutover readiness fence has not cleared
   * - The instance has been shut down
   *
   * This is the fence-aware accessor: callers receive the service only
   * after authoritative topology + post-cutover JetStream readiness is green.
   */
  getBlitzService(): { shutdown(): Promise<void>; isClosed: boolean } | null {
    if (!this._blitzLifecycleManager?.isBlitzAvailable()) return null;
    return this._blitzService;
  }

  /**
   * Returns true when the Blitz runtime is fully available.
   * Delegates to the lifecycle manager's pre-cutover readiness fence.
   *
   * Fail-closed: returns false for any pre-cutover, retryable, stale,
   * or shut-down state. Only returns true after authoritative topology
   * application + post-cutover JetStream readiness is green.
   */
  isBlitzReady(): boolean {
    return this._blitzLifecycleManager?.isBlitzAvailable() ?? false;
  }

  /**
   * Set the NATS server manager (called by async runtime startup flow).
   * @internal — used by Helios lifecycle orchestration, not user code.
   */
  setNatsServerManager(manager: { shutdown(): Promise<void>; clientUrls: string[] } | null): void {
    this._natsServerManager = manager;
  }

  /**
   * Set the connected BlitzService (called by async runtime startup flow).
   * @internal — used by Helios lifecycle orchestration, not user code.
   */
  setBlitzService(service: { shutdown(): Promise<void>; isClosed: boolean } | null): void {
    this._blitzService = service;
  }

  /**
   * Returns the raw Blitz service reference for NestJS bridge reuse,
   * bypassing the pre-cutover readiness fence. The NestJS bridge wraps
   * this with its own fence-aware provider (FenceAwareBlitzProvider).
   *
   * Returns null only when the Blitz runtime has not been started.
   */
  getBlitzServiceForBridge(): { shutdown(): Promise<void>; isClosed: boolean } | null {
    return this._blitzService;
  }

  /**
   * Creates a fence check function that delegates to the lifecycle manager's
   * isBlitzAvailable(). Used by the NestJS bridge (FenceAwareBlitzProvider)
   * to gate access until post-cutover readiness is green.
   */
  createBlitzFenceCheck(): () => boolean {
    return () => this._blitzLifecycleManager?.isBlitzAvailable() ?? false;
  }

  /**
   * Returns the BlitzReplicaReconciler from the cluster coordinator,
   * or null if no cluster coordinator exists (single-node mode).
   */
  getBlitzReplicaReconciler(): import('@zenystx/helios-core/instance/impl/blitz/BlitzReplicaReconciler').BlitzReplicaReconciler | null {
    return this._clusterCoordinator?.getBlitzCoordinator().getReplicaReconciler() ?? null;
  }

  // ── Public TCP helpers ───────────────────────────────────────────────

  /**
   * Returns the number of cluster peers that have completed the HELLO handshake.
   * Returns 0 if TCP networking is not enabled.
   */
  getTcpPeerCount(): number {
    return this._transport?.peerCount() ?? 0;
  }

  /**
   * Register a callback that fires whenever this instance receives a remote
   * INVALIDATE message.  Used by tests to verify near-cache invalidation
   * signals are flowing over the TCP transport.
   */
  onRemoteInvalidate(cb: (mapName: string, key: unknown) => void): void {
    this._invalidateCallbacks.push(cb);
  }

  // ── HeliosInstance interface ─────────────────────────────────────────────

  getName(): string {
    return this._name;
  }

  /**
   * Register an async hook to be awaited during shutdownAsync().
   * Used by executor services and other drainable subsystems.
   */
  registerShutdownHook(hook: () => Promise<void>): void {
    this._shutdownHooks.push(hook);
  }

  /**
   * Async shutdown that awaits all registered shutdown hooks before
   * tearing down the instance. Use this when graceful draining is needed.
   */
  async shutdownAsync(): Promise<void> {
    this._blitzAuthorityEpoch += 1;
    // Await all registered hooks (e.g., executor drain)
    await Promise.allSettled(this._shutdownHooks.map((h) => h()));
    await this._shutdownBlitzRuntimeRefs();
    // Await MapStore flush before tearing down (write-behind queues drain deterministically)
    await this._mapService.flushAll();
    this.shutdown();
  }

  shutdown(): void {
    this._running = false;
    this._blitzAuthorityEpoch += 1;
    // Shut down all executor containers + proxies (fire-and-forget the promises)
    for (const [name, exec] of Array.from(this._executors.entries())) {
      const container = this._executorContainers.get(name)
        ?? this._nodeEngine.getServiceOrNull<ExecutorContainerService>(`helios:executor:container:${name}`);
      if (container) container.shutdown().catch(() => {});
      exec.shutdown().catch(() => {});
    }
    this._executors.clear();
    this._executorContainers.clear();
    // Shut down all scheduled executor containers + proxies
    for (const [name, schedProxy] of Array.from(this._scheduledExecutors.entries())) {
      const schedContainer = this._scheduledExecutorContainers.get(name);
      if (schedContainer) schedContainer.shutdown().catch(() => {});
      schedProxy.shutdown().catch(() => {});
    }
    this._scheduledExecutors.clear();
    this._scheduledExecutorContainers.clear();
    for (const topic of Array.from(this._topics.values())) topic.destroy();
    this._reliableTopicService.shutdown();
    for (const rm of Array.from(this._replicatedMaps.values())) rm.destroy();
    this._nearCachedMaps.clear();
    this._nearCacheManager.destroyAllNearCaches();
    // Flush all MapStore contexts (fire-and-forget; write-behind entries flushed)
    this._mapService.flushAll().catch(() => {});
    this._maps.clear();
    this._queues.clear();
    this._lists.clear();
    this._sets.clear();
    this._topics.clear();
    this._reliableTopics.clear();
    this._multiMaps.clear();
    this._replicatedMaps.clear();
    this._lifecycleService.shutdown();
    this._nodeEngine.shutdown();
    this._ss.destroy();
    this._blitzLifecycleManager?.markShutdown();
    // Nullify Blitz runtime refs (actual drain done in shutdownAsync; sync path is fire-and-forget)
    if (this._blitzService !== null) {
      this._blitzService.shutdown().catch(() => {});
      this._blitzService = null;
    }
    if (this._natsServerManager !== null) {
      this._natsServerManager.shutdown().catch(() => {});
      this._natsServerManager = null;
    }
    this._blitzRegistration = null;
    this._blitzCurrentRoutes = [];
    this._clientProtocolServer?.shutdown().catch(() => {});
    this._clientProtocolServer = null;
    this._multicastJoiner?.stop();
    this._multicastJoiner = null;
    this._multicastService?.stop();
    this._multicastService = null;
    this._transport?.shutdown();
    this._transport = null;
    this._metricsSampler?.stop();
    this._restServer.stop();
  }

  // ── REST server access ────────────────────────────────────────────────────

  /** Returns the built-in REST server (always non-null; check isStarted() to see if running). */
  getRestServer(): HeliosRestServer {
    return this._restServer;
  }

  // ── ClusterReadState (for ClusterReadHandler) ─────────────────────────────

  getClusterName(): string {
    return this._name;
  }

  getMemberCount(): number {
    return this._cluster.getMembers().length;
  }

  // ── ClusterWriteState (for ClusterWriteHandler) ───────────────────────────

  getLogLevel(): string {
    return this._logLevel;
  }

  setLogLevel(level: string): void {
    this._logLevel = level;
  }

  resetLogLevel(): void {
    this._logLevel = "INFO";
  }

  // ── DataHandlerStore factory ───────────────────────────────────────────────

  private _makeDataStore(): DataHandlerStore {
    return {
      getMap: async (name: string) => {
        const proxy = this._getOrCreateProxy(name);
        const map: DataHandlerMap = {
          get: (key: string) => proxy.get(key as never) as Promise<unknown>,
          put: (key: string, value: unknown) =>
            proxy.put(key as never, value as never) as Promise<unknown>,
          remove: (key: string) =>
            proxy.remove(key as never) as Promise<unknown>,
        };
        return map;
      },
      getQueue: async (name: string) => {
        return this.getQueue(name) as unknown as DataHandlerQueue;
      },
    };
  }

  // ── HealthCheckState (for HealthCheckHandler) ─────────────────────────────

  getNodeState(): NodeState {
    return this._running ? NodeState.ACTIVE : NodeState.SHUTTING_DOWN;
  }

  getClusterState(): string {
    if (this._cluster instanceof ClusterServiceImpl) {
      return this._cluster.getClusterState();
    }
    return "ACTIVE";
  }

  isClusterSafe(): boolean {
    if (this._cluster instanceof ClusterServiceImpl) {
      return !this._cluster.isMigrationsInProgress();
    }
    return true;
  }

  getClusterSize(): number {
    return this._cluster.getMembers().length;
  }

  getMemberVersion(): string {
    const localMember = this._cluster.getLocalMember();
    return localMember.getVersion().toString();
  }

  getInstanceName(): string {
    return this._name;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  isRunning(): boolean {
    return this._running;
  }

  getLifecycleService(): LifecycleService {
    return this._lifecycleService;
  }

  // ── Cluster ──────────────────────────────────────────────────────────────

  getCluster(): Cluster {
    return this._cluster;
  }

  // ── Config ───────────────────────────────────────────────────────────────

  getConfig(): HeliosConfig {
    return this._config;
  }

  // ── NodeEngine access ────────────────────────────────────────────────────

  getNodeEngine(): NodeEngineImpl {
    return this._nodeEngine;
  }

  private _captureCurrentMemberIds(): Set<string> {
    return new Set(this._cluster.getMembers().map((member) => member.getUuid()));
  }

  private _handleExecutorMembershipChange(): void {
    const currentMemberIds = this._captureCurrentMemberIds();
    for (const memberId of this._knownExecutorMemberIds) {
      if (currentMemberIds.has(memberId)) {
        continue;
      }
      for (const container of this._executorContainers.values()) {
        container.markTasksLostForMember(memberId);
      }
    }
    this._knownExecutorMemberIds = currentMemberIds;
  }

  getRingbufferService(): RingbufferService {
    return this._ringbufferService;
  }

  // ── Near-cache access ─────────────────────────────────────────────────────

  /** Returns the near-cache manager for observability / testing. */
  getNearCacheManager(): DefaultNearCacheManager {
    return this._nearCacheManager;
  }

  getClusterMasterAddress(): string | null {
    if (this._cluster instanceof ClusterServiceImpl) {
      const masterAddress = this._cluster.getMasterAddress();
      if (masterAddress !== null) {
        return `${masterAddress.getHost()}:${masterAddress.getPort()}`;
      }
    }

    const localMember = this._cluster.getLocalMember();
    return `${localMember.getAddress().getHost()}:${localMember.getAddress().getPort()}`;
  }

  getClusterId(): string | null {
    if (this._cluster instanceof ClusterServiceImpl) {
      return this._cluster.getClusterId();
    }
    return null;
  }

  getPartitionCount(): number {
    return this._nodeEngine.getPartitionService().getPartitionCount();
  }

  getPartitionIdForName(name: string): number {
    if (this._clusterCoordinator !== null) {
      return this._clusterCoordinator.getPartitionId(name);
    }

    const data = this._ss.toData(name);
    if (data === null) {
      throw new Error(`Unable to derive partition id for '${name}'`);
    }
    return this._nodeEngine.getPartitionService().getPartitionId(data);
  }

  getPartitionOwnerId(partitionId: number): string | null {
    return this._clusterCoordinator?.getOwnerId(partitionId) ?? this._name;
  }

  getPartitionBackupIds(partitionId: number, replicaCount = 6): string[] {
    return this._clusterCoordinator?.getBackupIds(partitionId, replicaCount) ?? [];
  }

  getTransportStats(): {
    openChannels: number;
    peerCount: number;
    bytesRead: number;
    bytesWritten: number;
  } {
    return this._transport?.getStats() ?? {
      openChannels: 0,
      peerCount: 0,
      bytesRead: 0,
      bytesWritten: 0,
    };
  }

  getKnownDistributedObjectNames(): {
    maps: string[];
    queues: string[];
    topics: string[];
    executors: string[];
  } {
    return {
      maps: Array.from(this._maps.keys()),
      queues: Array.from(this._queues.keys()),
      topics: Array.from(this._topics.keys()),
      executors: Array.from(this._executors.keys()),
    };
  }

  // ── Config helpers ───────────────────────────────────────────────────────

  /**
   * Returns the MapConfig registered for the given name, or null.
   */
  getMapConfig(name: string): MapConfig | null {
    return this._config.getMapConfig(name);
  }

  /**
   * Pre-register all MapStoreConfigs from HeliosConfig so operations
   * forwarded to partition owners can trigger lazy MapDataStore init (Block 21.2).
   */
  private _registerMapStoreConfigs(): void {
    for (const [mapName, mapConfig] of this._config.getMapConfigs()) {
      const msCfg = mapConfig.getMapStoreConfig();
      if (msCfg.isEnabled()) {
        this._mapService.registerMapStoreConfig(mapName, msCfg);
      }
    }
  }

  // ── Data-structure accessors ─────────────────────────────────────────────

  getMap<K, V>(name: string): IMap<K, V> {
    // If a NearCacheConfig is registered for this map, return a near-cache-wrapped version
    const nearCacheConfig = this._config
      .getMapConfig(name)
      ?.getNearCacheConfig();
    if (nearCacheConfig) {
      let wrapped = this._nearCachedMaps.get(name);
      if (!wrapped) {
        const proxy = this._getOrCreateProxy(name);
        const nearCache = this._nearCacheManager.getOrCreateNearCache<
          unknown,
          unknown
        >(name, nearCacheConfig);
        wrapped = new NearCachedIMapWrapper(proxy, nearCache);
        this._nearCachedMaps.set(name, wrapped);
      }
      return wrapped as unknown as IMap<K, V>;
    }

    return this._getOrCreateProxy(name) as unknown as IMap<K, V>;
  }

  private _getOrCreateProxy(name: string): MapProxy<unknown, unknown> {
    let proxy = this._maps.get(name);
    if (!proxy) {
      const store = this._mapService.getOrCreateRecordStore(name, 0);
      const mapStoreConfig = this._config
        .getMapConfig(name)
        ?.getMapStoreConfig();
      // Block 21.1: Always use MapProxy — routing is handled by OperationService
      // (no more NetworkedMapProxy broadcast path)
      proxy = new MapProxy<unknown, unknown>(
        name,
        store,
        this._nodeEngine,
        this._mapService,
        mapStoreConfig,
      );
      this._maps.set(name, proxy);
    }
    return proxy;
  }

  getQueue<E>(name: string): IQueue<E> {
    let queue = this._queues.get(name);
    if (!queue) {
      queue =
        this._distributedQueueService === null
          ? new QueueImpl<unknown>(0, undefined, name)
          : new QueueProxyImpl<unknown>(
              name,
              this._distributedQueueService,
              this._ss,
            );
      this._queues.set(name, queue);
    }
    return queue as IQueue<E>;
  }

  getList<E>(name: string): IList<E> {
    let list = this._lists.get(name);
    if (!list) {
      list = new ListImpl<unknown>();
      this._lists.set(name, list);
    }
    return list as IList<E>;
  }

  getSet<E>(name: string): ISet<E> {
    let set = this._sets.get(name);
    if (!set) {
      set = new SetImpl<unknown>();
      this._sets.set(name, set);
    }
    return set as ISet<E>;
  }

  getTopic<E>(name: string): ITopic<E> {
    let topic = this._topics.get(name);
    if (!topic) {
      // Always use service-backed path — create a DistributedTopicService
      // even without transport for single-node consistency
      if (this._distributedTopicService === null) {
        this._distributedTopicService = new DistributedTopicService(
          this._name,
          this._config,
          this._ss,
          null,
          null,
        );
      }
      const service = this._distributedTopicService;
      // Allow re-creation after prior destroy
      service.undestroy(name);
      topic = new TopicProxyImpl<unknown>(name, service, this._ss);
      // Wrap destroy to also evict from instance cache
      const originalDestroy = topic.destroy.bind(topic);
      topic.destroy = () => {
        originalDestroy();
        this._topics.delete(name);
      };
      this._topics.set(name, topic);
    }
    return topic as ITopic<E>;
  }

  getReliableTopic<E>(name: string): ITopic<E> {
    let topic = this._reliableTopics.get(name);
    if (!topic) {
      this._reliableTopicService.undestroy(name);
      topic = new ReliableTopicProxyImpl<unknown>(
        name,
        this._reliableTopicService,
        () => this._reliableTopics.delete(name),
      );
      this._reliableTopics.set(name, topic);
    }
    return topic as ITopic<E>;
  }

  getMultiMap<K, V>(name: string): MultiMap<K, V> {
    let mmap = this._multiMaps.get(name);
    if (!mmap) {
      mmap = new MultiMapImpl<unknown, unknown>();
      this._multiMaps.set(name, mmap);
    }
    return mmap as MultiMap<K, V>;
  }

  getReplicatedMap<K, V>(name: string): ReplicatedMap<K, V> {
    let rm = this._replicatedMaps.get(name);
    if (!rm) {
      rm = new ReplicatedMapImpl<unknown, unknown>(name);
      this._replicatedMaps.set(name, rm);
    }
    return rm as ReplicatedMap<K, V>;
  }

  getExecutorService(name: string): IExecutorService {
    if (!this._running) {
      throw new ExecutorRejectedExecutionException(
        "HeliosInstance is shut down",
      );
    }
    let proxy = this._executors.get(name);
    if (!proxy) {
      const config = this._config.getExecutorConfig(name);
      const registry = new TaskTypeRegistry();

      // Reject inline backend in production mode unless explicit testing override is set
      if (config.getExecutionBackend() === 'inline' && !config.getAllowInlineBackend()) {
        throw new Error(
          `Executor "${name}" is configured with inline backend but allowInlineBackend is not set. ` +
          'The inline execution backend is not supported in production. ' +
          'Use scatter (default) for production, or set allowInlineBackend(true) for test/dev bootstrap flows.',
        );
      }

      // Create the execution backend based on config
      const backend = config.getExecutionBackend() === 'scatter'
        ? new ScatterExecutionBackend({ poolSize: config.getPoolSize() })
        : new InlineExecutionBackend();

      // Create and register container service in NodeEngine for operation routing
      const container = new ExecutorContainerService(name, config, registry, backend);
      this._nodeEngine.registerService(`helios:executor:container:${name}`, container);
      this._nodeEngine.registerService(`helios:executor:registry:${name}`, registry);
      this._executorContainers.set(name, container);

      proxy = new ExecutorServiceProxy(
        name,
        this._nodeEngine,
        config,
        registry,
        this._name,
      );
      // Register shutdown hook so shutdownAsync() drains executors
      this.registerShutdownHook(async () => {
        await container.shutdown();
        await proxy!.shutdown();
      });
      this._executors.set(name, proxy);
    }
    return proxy;
  }

  getDistributedObject(serviceName: string, name: string): DistributedObject {
    if (serviceName === MAP_SERVICE_NAME) {
      this.getMap<unknown, unknown>(name);
      return {
        getName: () => name,
        getServiceName: () => MAP_SERVICE_NAME,
        destroy: async () => {
          /* no-op for in-memory map */
        },
      };
    }
    if (serviceName === QUEUE_SERVICE_NAME) {
      this.getQueue<unknown>(name);
      return {
        getName: () => name,
        getServiceName: () => QUEUE_SERVICE_NAME,
        destroy: async () => {
          /* no-op for in-memory queue */
        },
      };
    }
    if (serviceName === TOPIC_SERVICE_NAME) {
      this.getTopic<unknown>(name);
      return {
        getName: () => name,
        getServiceName: () => TOPIC_SERVICE_NAME,
        destroy: async () => {
          /* no-op for in-memory topic */
        },
      };
    }
    if (serviceName === RELIABLE_TOPIC_SERVICE_NAME) {
      const topic = this.getReliableTopic<unknown>(name);
      return {
        getName: () => name,
        getServiceName: () => RELIABLE_TOPIC_SERVICE_NAME,
        destroy: async () => { topic.destroy(); },
      };
    }
    if (serviceName === EXECUTOR_SERVICE_NAME) {
      const executor = this.getExecutorService(name);
      return {
        getName: () => name,
        getServiceName: () => EXECUTOR_SERVICE_NAME,
        destroy: async () => { await executor.shutdown(); },
      };
    }
    throw new Error(`Unknown distributed object service: '${serviceName}'`);
  }

  // ── Deferred service stubs ───────────────────────────────────────────────
  // These services are deferred to future versions. They are exposed as stubs
  // so callers receive a clear error rather than "not a function".

  getSql(): never {
    throw new Error("SQL is not supported in this version (deferred to v2)");
  }

  getJet(): never {
    throw new Error(
      "Jet streaming is not supported in this version (deferred to v1.5)",
    );
  }

  getCPSubsystem(): never {
    throw new Error(
      "CP subsystem is not supported in this version (deferred to v2)",
    );
  }

  getScheduledExecutorService(name: string): IScheduledExecutorService {
    if (!this._running) {
      throw new ExecutorRejectedExecutionException('HeliosInstance is shut down');
    }
    let proxy = this._scheduledExecutors.get(name);
    if (!proxy) {
      const config = this._config.getScheduledExecutorConfig(name);
      const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();

      // Create and register container service
      const container = new ScheduledContainerService(partitionCount);
      container.init();
      container.createDistributedObject(name, config);
      this._nodeEngine.registerService(
        `helios:scheduledExecutor:container:${name}`,
        container,
      );
      this._scheduledExecutorContainers.set(name, container);

      proxy = new ScheduledExecutorServiceProxy(name, container, config, partitionCount);

      // Register shutdown hook
      this.registerShutdownHook(async () => {
        await container.shutdown();
        await proxy!.shutdown();
      });
      this._scheduledExecutors.set(name, proxy);
    }
    return proxy;
  }

  // ── Monitoring subsystem ─────────────────────────────────────────────────

  /** Returns the MetricsRegistry, or null if monitoring is disabled. */
  getMetricsRegistry(): MetricsRegistry | null {
    return this._metricsRegistry;
  }

  private _initMonitor(): void {
    const monitorConfig = this._config.getMonitorConfig();
    if (!monitorConfig.isEnabled()) return;

    // Enable the MONITOR REST endpoint group automatically when monitoring is enabled
    this._config.getNetworkConfig().getRestApiConfig()
      .enableGroups(RestEndpointGroup.MONITOR);

    this._metricsRegistry = new MetricsRegistry(monitorConfig);
    this._metricsSampler = new MetricsSampler(monitorConfig, this._createMonitorStateProvider(), this._metricsRegistry);

    // Register the monitor REST handler
    const monitorHandler = new MonitorHandler(monitorConfig, this._metricsRegistry, this._createMonitorStateProvider());
    this._restServer.registerHandler('/helios/monitor', (req) => monitorHandler.handle(req));

    // Start sampling
    this._metricsSampler.start();
  }

  private _createMonitorStateProvider(): MonitorStateProvider {
    return {
      getInstanceName: () => this.getName(),
      getNodeState: () => String(this.getNodeState()),
      getClusterState: () => this.getClusterState(),
      isClusterSafe: () => this.isClusterSafe(),
      getClusterSize: () => this.getClusterSize(),
      getMemberVersion: () => this.getMemberVersion(),
      getPartitionCount: () => this.getPartitionCount(),
      getTransportMetrics: (): TransportMetrics => this.getTransportStats(),
      getObjectInventory: (): ObjectInventory => this.getKnownDistributedObjectNames(),
      getMemberPartitionInfo: () => this._buildMemberPartitionInfo(),
      getThreadPoolMetrics: () => this._getThreadPoolMetrics(),
      getBlitzMetrics: () => this._getBlitzMetrics(),
    };
  }

  private _buildMemberPartitionInfo(): MemberPartitionInfo[] {
    const members = this.getCluster().getMembers();
    const masterAddress = this.getClusterMasterAddress();
    const localMember = this.getCluster().getLocalMember();
    const localAddress = `${localMember.getAddress().getHost()}:${localMember.getAddress().getPort()}`;

    const result: MemberPartitionInfo[] = [];

    for (const member of members) {
      const address = `${member.getAddress().getHost()}:${member.getAddress().getPort()}`;
      let primaryPartitions = 0;
      let backupPartitions = 0;

      const partitionCount = this.getPartitionCount();
      for (let pid = 0; pid < partitionCount; pid++) {
        if (this.getPartitionOwnerId(pid) === member.getUuid()) {
          primaryPartitions++;
        }
        if (this.getPartitionBackupIds(pid).includes(member.getUuid())) {
          backupPartitions++;
        }
      }

      result.push({
        uuid: member.getUuid(),
        address,
        isMaster: address === masterAddress,
        isLocal: address === localAddress,
        primaryPartitions,
        backupPartitions,
      });
    }

    return result;
  }

  private _getThreadPoolMetrics(): ThreadPoolMetrics {
    let scatterPoolActive = 0;
    let scatterPoolSize = 0;

    for (const [name, exec] of this._executors) {
      try {
        const stats = exec.getLocalExecutorStats();
        scatterPoolActive += stats.activeWorkers;
      } catch {
        // Executor may not support stats
      }
      const executorConfig = this._config.getExecutorConfig(name);
      if (executorConfig.getExecutionBackend() === 'scatter') {
        scatterPoolSize += executorConfig.getPoolSize();
      }
    }

    return { scatterPoolActive, scatterPoolSize };
  }

  private _getBlitzMetrics(): BlitzMetrics | null {
    const manager = this.getBlitzLifecycleManager();
    if (manager === null) return null;

    const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);

    return {
      clusterSize: 1,
      isReady: this.isBlitzReady(),
      readinessState: manager.getReadinessState(),
      runningPipelines: 0,
      jetStreamReady: blitzService?.jsm !== undefined,
    };
  }
}
