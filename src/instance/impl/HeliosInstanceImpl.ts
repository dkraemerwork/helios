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
import { CacheUtil } from "@zenystx/helios-core/cache/CacheUtil";
import { DistributedCacheService } from "@zenystx/helios-core/cache/impl/DistributedCacheService";
import { DistributedCardinalityEstimatorService } from "@zenystx/helios-core/cardinality/impl/DistributedCardinalityEstimatorService";
import { RecentStringSet } from "@zenystx/helios-core/internal/util/RecentStringSet";
import { ListAddListenerCodec } from "../../client/impl/protocol/codec/ListAddListenerCodec.js";
import { MapAddEntryListenerCodec } from "../../client/impl/protocol/codec/MapAddEntryListenerCodec";
import { MultiMapAddEntryListenerCodec } from "../../client/impl/protocol/codec/MultiMapAddEntryListenerCodec.js";
import { QueueAddListenerCodec } from "../../client/impl/protocol/codec/QueueAddListenerCodec.js";
import { SetAddListenerCodec } from "../../client/impl/protocol/codec/SetAddListenerCodec.js";
import { TopicAddMessageListenerCodec } from "../../client/impl/protocol/codec/TopicAddMessageListenerCodec";
import { Address } from "@zenystx/helios-core/cluster/Address";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { Member } from "@zenystx/helios-core/cluster/Member";
import { MemberInfo } from "@zenystx/helios-core/cluster/MemberInfo";
import { LocalCluster } from "@zenystx/helios-core/cluster/impl/LocalCluster";
import { MulticastJoiner } from "@zenystx/helios-core/cluster/multicast/MulticastJoiner";
import { MulticastService } from "@zenystx/helios-core/cluster/multicast/MulticastService";
import { decodeData, encodeData } from "@zenystx/helios-core/cluster/tcp/DataWireCodec";
import { TcpClusterTransport } from "@zenystx/helios-core/cluster/tcp/TcpClusterTransport";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import type { LocalQueueStats } from "@zenystx/helios-core/collection/LocalQueueStats";
import { QueueImpl } from "@zenystx/helios-core/collection/impl/QueueImpl";
import { SetImpl } from "@zenystx/helios-core/collection/impl/SetImpl";
import { DistributedListService } from "@zenystx/helios-core/collection/impl/list/DistributedListService";
import { ListProxyImpl } from "@zenystx/helios-core/collection/impl/list/ListProxyImpl";
import { DistributedQueueService } from "@zenystx/helios-core/collection/impl/queue/DistributedQueueService";
import { QueueProxyImpl } from "@zenystx/helios-core/collection/impl/queue/QueueProxyImpl";
import { DistributedSetService } from "@zenystx/helios-core/collection/impl/set/DistributedSetService";
import { SetProxyImpl } from "@zenystx/helios-core/collection/impl/set/SetProxyImpl";
import type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
import { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
import type { MapConfig } from "@zenystx/helios-core/config/MapConfig";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import { AtomicLongService } from "@zenystx/helios-core/cp/impl/AtomicLongService";
import { AtomicReferenceService } from "@zenystx/helios-core/cp/impl/AtomicReferenceService";
import { CountDownLatchService } from "@zenystx/helios-core/cp/impl/CountDownLatchService";
import { CpSubsystemService } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
import { SemaphoreService } from "@zenystx/helios-core/cp/impl/SemaphoreService";
import { PNCounterService } from "@zenystx/helios-core/crdt/impl/PNCounterService";
import { SlowOperationDetector } from "@zenystx/helios-core/diagnostics/SlowOperationDetector";
import type { StoreLatencyMetrics } from "@zenystx/helios-core/diagnostics/StoreLatencyTracker";
import { StoreLatencyTracker } from "@zenystx/helios-core/diagnostics/StoreLatencyTracker";
import type { SystemEvent } from "@zenystx/helios-core/diagnostics/SystemEventLog";
import { SystemEventLog } from "@zenystx/helios-core/diagnostics/SystemEventLog";
import { ExecutorRejectedExecutionException } from "@zenystx/helios-core/executor/ExecutorExceptions";
import type { ExecutorOperationResult } from "@zenystx/helios-core/executor/ExecutorOperationResult";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import type { TaskCallable } from "@zenystx/helios-core/executor/TaskCallable";
import { CancellationOperation } from "@zenystx/helios-core/executor/impl/CancellationOperation";
import { ExecuteCallableOperation } from "@zenystx/helios-core/executor/impl/ExecuteCallableOperation";
import { ExecutorContainerService } from "@zenystx/helios-core/executor/impl/ExecutorContainerService";
import { ExecutorServiceProxy } from "@zenystx/helios-core/executor/impl/ExecutorServiceProxy";
import { InlineExecutionBackend } from "@zenystx/helios-core/executor/impl/InlineExecutionBackend";
import { MemberCallableOperation } from "@zenystx/helios-core/executor/impl/MemberCallableOperation";
import { ScatterExecutionBackend } from "@zenystx/helios-core/executor/impl/ScatterExecutionBackend";
import { TaskTypeRegistry } from "@zenystx/helios-core/executor/impl/TaskTypeRegistry";
import { FlakeIdGeneratorService } from "@zenystx/helios-core/flakeid/impl/FlakeIdGeneratorService";
import { EndpointQualifier } from "@zenystx/helios-core/instance/EndpointQualifier";
import { HeliosClusterCoordinator } from "@zenystx/helios-core/instance/impl/HeliosClusterCoordinator";
import { InvocationMonitor } from "@zenystx/helios-core/instance/impl/InvocationMonitor";
import { readMemberAdminCapability, readMemberMonitorCapability } from "@zenystx/helios-core/instance/impl/MemberCapabilityAttributes";
import { PendingResponseEntryPool } from "@zenystx/helios-core/instance/impl/PendingResponseEntryPool";
import { BlitzReadinessState, HeliosBlitzLifecycleManager } from "@zenystx/helios-core/instance/impl/blitz/HeliosBlitzLifecycleManager";
import { HeliosLifecycleService } from "@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import { NodeState } from "@zenystx/helios-core/instance/lifecycle/NodeState";
import { ClusterServiceImpl } from "@zenystx/helios-core/internal/cluster/impl/ClusterServiceImpl";
import { ClusterState } from '@zenystx/helios-core/internal/cluster/ClusterState';
import type { LocalMapStats } from "@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl";
import { DefaultNearCacheManager } from "@zenystx/helios-core/internal/nearcache/impl/DefaultNearCacheManager";
import { MigrationManager } from "@zenystx/helios-core/internal/partition/impl/MigrationManager";
import { MigrationQueue } from "@zenystx/helios-core/internal/partition/impl/MigrationQueue";
import { PartitionReplicaManager } from "@zenystx/helios-core/internal/partition/impl/PartitionReplicaManager";
import { PartitionBackupReplicaAntiEntropyOp } from "@zenystx/helios-core/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp";
import { chunkNamespaceStates } from "@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncRequest";
import { PartitionReplicaSyncChunkAssembler, PartitionReplicaSyncResponse } from "@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import { HazelcastSerializationService } from '@zenystx/helios-core/internal/serialization/HazelcastSerializationService';
import { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import { blitzJobMetricsToJSON } from "@zenystx/helios-core/job/metrics/BlitzJobMetrics";
import type { EntryProcessor } from "@zenystx/helios-core/map/EntryProcessor";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import { MapContainerService } from "@zenystx/helios-core/map/impl/MapContainerService";
import { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
import { MapService } from "@zenystx/helios-core/map/impl/MapService";
import { NearCachedIMapWrapper } from "@zenystx/helios-core/map/impl/nearcache/NearCachedIMapWrapper";
import { MapEntryProcessorEngine } from "@zenystx/helios-core/map/impl/query/MapEntryProcessorEngine";
import { globalMetrics } from "@zenystx/helios-core/monitor/HazelcastMetrics";
import { HealthMonitor } from "@zenystx/helios-core/monitor/HealthMonitor";
import { MetricsRegistry } from "@zenystx/helios-core/monitor/MetricsRegistry";
import type { BlitzMetrics, InvocationMetrics, JobCounterMetrics, MemberPartitionInfo, MigrationMetrics, ObjectInventory, OperationMetrics, ThreadPoolMetrics, TransportMetrics } from "@zenystx/helios-core/monitor/MetricsSample";
import { MetricsSampler } from "@zenystx/helios-core/monitor/MetricsSampler";
import type { MonitorStateProvider } from "@zenystx/helios-core/monitor/MonitorStateProvider";
import { globalResourceLimiter } from "@zenystx/helios-core/monitor/ResourceLimiter";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import { DistributedMultiMapService } from "@zenystx/helios-core/multimap/impl/DistributedMultiMapService";
import { MultiMapImpl } from "@zenystx/helios-core/multimap/impl/MultiMapImpl";
import { MultiMapProxyImpl } from "@zenystx/helios-core/multimap/impl/MultiMapProxyImpl";
import type { Predicate } from "@zenystx/helios-core/query/Predicate";
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import { DistributedReplicatedMapService } from "@zenystx/helios-core/replicatedmap/impl/DistributedReplicatedMapService";
import { ReplicatedMapImpl } from "@zenystx/helios-core/replicatedmap/impl/ReplicatedMapImpl";
import { ReplicatedMapProxyImpl } from "@zenystx/helios-core/replicatedmap/impl/ReplicatedMapProxyImpl";
import { HeliosRestServer } from "@zenystx/helios-core/rest/HeliosRestServer";
import { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";
import type { AdminOperationsProvider } from "@zenystx/helios-core/rest/handler/AdminHandler";
import { AdminHandler } from "@zenystx/helios-core/rest/handler/AdminHandler";
import { ClusterReadHandler } from "@zenystx/helios-core/rest/handler/ClusterReadHandler";
import { ClusterWriteHandler } from "@zenystx/helios-core/rest/handler/ClusterWriteHandler";
import type {
  DataHandlerMap,
  DataHandlerQueue,
  DataHandlerStore,
} from "@zenystx/helios-core/rest/handler/DataHandler";
import { DataHandler } from "@zenystx/helios-core/rest/handler/DataHandler";
import { HealthCheckHandler } from "@zenystx/helios-core/rest/handler/HealthCheckHandler";
import { MetricsHandler } from "@zenystx/helios-core/rest/handler/MetricsHandler";
import type { MonitorJobSnapshot, MonitorJobsProvider } from "@zenystx/helios-core/rest/handler/MonitorHandler";
import { MonitorHandler } from "@zenystx/helios-core/rest/handler/MonitorHandler";
import { DistributedRingbufferService } from "@zenystx/helios-core/ringbuffer/impl/DistributedRingbufferService";
import { RingbufferService } from "@zenystx/helios-core/ringbuffer/impl/RingbufferService";
import type { IScheduledExecutorService } from "@zenystx/helios-core/scheduledexecutor/IScheduledExecutorService";
import { ScheduledExecutorContainerService as ScheduledContainerService } from "@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorContainerService";
import { ScheduledExecutorServiceProxy } from "@zenystx/helios-core/scheduledexecutor/impl/ScheduledExecutorServiceProxy";
import { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";
import type { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";
import { TopologyPublisher } from "@zenystx/helios-core/server/clientprotocol/TopologyPublisher";
import { registerAllHandlers } from "@zenystx/helios-core/server/clientprotocol/handlers/registerAllHandlers";
import type { PartitionService } from "@zenystx/helios-core/spi/PartitionService";
import { MutationTrigger } from "@zenystx/helios-core/spi/impl/NearCacheInvalidationEvent";
import { NearCacheInvalidationManager } from "@zenystx/helios-core/spi/impl/NearCacheInvalidationManager";
import { NodeEngineImpl } from "@zenystx/helios-core/spi/impl/NodeEngineImpl";
import type { BackpressureStats } from "@zenystx/helios-core/spi/impl/operationservice/BackpressureRegulator";
import { BackpressureRegulator } from "@zenystx/helios-core/spi/impl/operationservice/BackpressureRegulator";
import { isBackupAwareOperation } from "@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation";
import {
  deserializeOperation,
  serializeOperation,
} from "@zenystx/helios-core/spi/impl/operationservice/OperationWireCodec";
import { RetryableException } from "@zenystx/helios-core/spi/impl/operationservice/RetryableException";
import { OperationServiceImpl } from "@zenystx/helios-core/spi/impl/operationservice/impl/OperationServiceImpl";
import { SqlResult } from "@zenystx/helios-core/sql/impl/SqlResult";
import type { SqlColumnType } from "@zenystx/helios-core/sql/impl/SqlRowMetadata";
import { SqlExecutionError, SqlService, SqlTimeoutError } from "@zenystx/helios-core/sql/impl/SqlService";
import { SqlStatement, SqlStatementParseError } from "@zenystx/helios-core/sql/impl/SqlStatement";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { LocalTopicStats } from "@zenystx/helios-core/topic/LocalTopicStats";
import type { Message } from "@zenystx/helios-core/topic/Message";
import { DistributedTopicService } from "@zenystx/helios-core/topic/impl/DistributedTopicService";
import { TopicProxyImpl } from "@zenystx/helios-core/topic/impl/TopicProxyImpl";
import { ReliableTopicProxyImpl } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicProxyImpl";
import { ReliableTopicService } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";
import { TransactionException } from "@zenystx/helios-core/transaction/TransactionException";
import { TransactionOptions, TransactionType } from "@zenystx/helios-core/transaction/TransactionOptions";
import { TransactionCoordinator } from "@zenystx/helios-core/transaction/impl/TransactionCoordinator";
import { TransactionBackupApplier } from "@zenystx/helios-core/transaction/impl/TransactionBackupApplier";
import { TransactionImpl } from "@zenystx/helios-core/transaction/impl/TransactionImpl";
import { TransactionManagerServiceImpl } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";
import { TransactionalListProxy } from "@zenystx/helios-core/transaction/impl/TransactionalListProxy";
import { TransactionalMapProxy } from "@zenystx/helios-core/transaction/impl/TransactionalMapProxy";
import { TransactionalMultiMapProxy } from "@zenystx/helios-core/transaction/impl/TransactionalMultiMapProxy";
import { TransactionalQueueProxy } from "@zenystx/helios-core/transaction/impl/TransactionalQueueProxy";
import { TransactionalSetProxy } from "@zenystx/helios-core/transaction/impl/TransactionalSetProxy";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

/** Service name constant for the distributed map service. */
const MAP_SERVICE_NAME = "hz:impl:mapService";
const QUEUE_SERVICE_NAME = "hz:impl:queueService";
const TOPIC_SERVICE_NAME = "hz:impl:topicService";
const RELIABLE_TOPIC_SERVICE_NAME = "hz:impl:reliableTopicService";
const EXECUTOR_SERVICE_NAME = "hz:impl:executorService";
const REMOTE_OPERATION_TIMEOUT_MS = 10_000;
const REMOTE_BACKUP_ACK_TIMEOUT_MS = 1_500;
const INVOCATION_SWEEP_INTERVAL_MS = 1_000;
const REMOTE_PEER_CONNECT_TIMEOUT_MS = 500;
const REMOTE_PEER_CONNECT_POLL_MS = 10;
const RECOVERY_SYNC_CHUNK_MAX_BYTES = 256 * 1024;

type BlitzServerManagerLike = {
  shutdown(): Promise<void>;
  clientUrls: string[];
};

type BlitzServiceLike = {
  shutdown(): Promise<void>;
  readonly isClosed: boolean;
  readonly jsm?: { getAccountInfo(): Promise<unknown> };
  getRunningJobCount?(): number;
  getClusterSize?(): number;
  getJobCounters?(): { submitted: number; completedSuccessfully: number; completedWithFailure: number; executionStarted: number };
  getJobs?(): Array<{
    id: string;
    name: string;
    getStatus(): string;
    getSubmissionTime(): number;
    getMetrics?(): Promise<unknown>;
  }>;
  getJobDescriptor?(id: string): {
    vertices?: Array<{ name: string; type: string }>;
    edges?: Array<{ from: string; to: string; edgeType: string }>;
    parallelism?: number;
  } | null;
  getJobMetadata?(id: string): Promise<{
    lightJob: boolean;
    participatingMembers: string[];
    supportsCancel: boolean;
    supportsRestart: boolean;
    executionStartTime: number | null;
    executionCompletionTime: number | null;
  } | null>;
  cancelJob?(id: string): Promise<void>;
  restartJob?(id: string): Promise<void>;
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

type MonitorJobSnapshotWithCapabilities = MonitorJobSnapshot & {
  supportsCancel: boolean;
  supportsRestart: boolean;
};

type BlitzRuntimeLauncher = (input: {
  instanceName: string;
  config: HeliosBlitzRuntimeConfig;
  routes: string[];
}) => Promise<BlitzRuntimeHandle>;

type ClientSqlQueryId = {
  localHigh: bigint;
  localLow: bigint;
  globalHigh: bigint;
  globalLow: bigint;
};

type ClientExecutorTaskRoute = {
  name: string;
  partitionId: number | null;
  memberUuid: string | null;
};

const defaultBlitzRuntimeLauncher: BlitzRuntimeLauncher = async ({
  instanceName,
  config,
  routes,
}) => {
  const blitz = await import("../../../packages/blitz/src/index.js");
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

interface MapClientListenerRegistration {
  mapName: string;
  registrationId: string;
  correlationId: number;
  flags: number;
  session: ClientSession;
}

interface QueueClientListenerRegistration {
  queueName: string;
  registrationId: string;
  queueListenerId: string;
}

interface ItemClientListenerRegistration {
  name: string;
  registrationId: string;
  itemListenerId?: string;
  includeValue: boolean;
  correlationId: number;
  session: ClientSession;
}

interface MultiMapClientListenerRegistration {
  name: string;
  registrationId: string;
  entryListenerId?: string;
  includeValue: boolean;
  correlationId: number;
  session: ClientSession;
}

interface ReplicatedMapClientListenerRegistration {
  name: string;
  registrationId: string;
  entryListenerId?: string;
  correlationId: number;
  session: ClientSession;
}

interface CacheClientInvalidationListenerRegistration {
  name: string;
  invalidationName: string;
  registrationId: string;
  session: ClientSession;
}

interface ClientTransactionContext {
  transaction: TransactionImpl;
  mapProxies: Map<string, TransactionalMapProxy<Data, Data>>;
  queueProxies: Map<string, TransactionalQueueProxy<Data>>;
  listProxies: Map<string, TransactionalListProxy<Data>>;
  setProxies: Map<string, TransactionalSetProxy<Data>>;
  multiMapProxies: Map<string, TransactionalMultiMapProxy<Data, Data>>;
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

function extractHostFromAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.includes("://")) {
    try {
      const hostname = new URL(trimmed).hostname;
      return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
    } catch {
      // Fall back to host:port parsing below.
    }
  }

  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    if (bracketEnd !== -1) {
      return trimmed.slice(1, bracketEnd);
    }
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) {
    return trimmed;
  }

  const port = Number.parseInt(trimmed.slice(lastColon + 1), 10);
  return Number.isNaN(port) ? trimmed : trimmed.slice(0, lastColon);
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function parseAdminClusterState(state: string): ClusterState {
  switch (state) {
    case ClusterState.ACTIVE:
      return ClusterState.ACTIVE;
    case ClusterState.FROZEN:
      return ClusterState.FROZEN;
    case ClusterState.PASSIVE:
      return ClusterState.PASSIVE;
    case ClusterState.NO_MIGRATION:
      return ClusterState.NO_MIGRATION;
    default:
      throw new Error(
        `Invalid cluster state: '${state}'. Valid values: ACTIVE, FROZEN, PASSIVE, NO_MIGRATION`,
      );
  }
}

function clientDataFingerprint(data: Data): string {
  return data.toByteArray()?.toString("base64") ?? "";
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
  private _distributedListService: DistributedListService | null = null;
  private _distributedSetService: DistributedSetService | null = null;
  private _distributedMultiMapService: DistributedMultiMapService | null = null;
  private _distributedReplicatedMapService: DistributedReplicatedMapService | null = null;
  private _distributedCacheService: DistributedCacheService | null = null;
  private _distributedRingbufferService: DistributedRingbufferService | null = null;
  private _distributedTopicService: DistributedTopicService | null = null;
  private _reliableTopicService: ReliableTopicService;
  private _ringbufferService!: RingbufferService;
  private readonly _replicaManager = new PartitionReplicaManager(271, 20);
  private readonly _recoverySyncAssemblies = new Map<string, PartitionReplicaSyncChunkAssembler>();

  // Per-name data-structure caches (same name → same instance)
  private readonly _maps = new Map<string, MapProxy<unknown, unknown>>();
  private readonly _nearCachedMaps = new Map<
    string,
    NearCachedIMapWrapper<unknown, unknown>
  >();
  private readonly _queues = new Map<string, IQueue<unknown>>();
  private readonly _lists = new Map<string, ListProxyImpl<unknown>>();
  private readonly _sets = new Map<string, SetProxyImpl<unknown> | SetImpl<unknown>>();
  private readonly _topics = new Map<string, ITopic<unknown>>();
  private readonly _reliableTopics = new Map<string, ITopic<unknown>>();
  private readonly _multiMaps = new Map<
    string,
    MultiMapProxyImpl<unknown, unknown> | MultiMapImpl<unknown, unknown>
  >();
  private readonly _replicatedMaps = new Map<
    string,
    ReplicatedMapProxyImpl<unknown, unknown> | ReplicatedMapImpl<unknown, unknown>
  >();
  private readonly _executors = new Map<string, ExecutorServiceProxy>();
  private readonly _executorContainers = new Map<string, ExecutorContainerService>();
  private readonly _clientExecutorTasks = new Map<string, ClientExecutorTaskRoute>();
  private readonly _clientSqlResults = new Map<string, SqlResult>();
  private readonly _scheduledExecutors = new Map<string, ScheduledExecutorServiceProxy>();
  private readonly _scheduledExecutorContainers = new Map<string, ScheduledContainerService>();
  private _knownExecutorMemberIds = new Set<string>();
  private _sqlService: SqlService | null = null;
  private _cpSubsystemService: CpSubsystemService | null = null;
  private _atomicLongService: AtomicLongService | null = null;
  private _atomicReferenceService: AtomicReferenceService | null = null;
  private _countDownLatchService: CountDownLatchService | null = null;
  private _semaphoreService: SemaphoreService | null = null;
  private _pnCounterService: PNCounterService | null = null;
  private _flakeIdGeneratorService: FlakeIdGeneratorService | null = null;
  private _cardinalityEstimatorService: DistributedCardinalityEstimatorService | null = null;

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

  /** Topology publisher used for live official-client cluster view updates. */
  private _topologyPublisher: TopologyPublisher | null = null;

  /** Resolves when the client protocol server has finished binding its TCP port. */
  private _clientProtocolReady: Promise<void> = Promise.resolve();

  /** Current log level (mutable via REST CLUSTER_WRITE). */
  private _logLevel: string = "INFO";

  /** Metrics registry — non-null when monitoring is enabled. */
  private _metricsRegistry: MetricsRegistry | null = null;

  /** Metrics sampler — non-null when monitoring is enabled. */
  private _metricsSampler: MetricsSampler | null = null;

  /** Health monitor — non-null when monitoring is enabled and level != OFF. */
  private _healthMonitor: HealthMonitor | null = null;

  /** Built-in REST server — non-null when REST API is configured. */
  private readonly _restServer: HeliosRestServer;
  private readonly _transactionManagerService: TransactionManagerServiceImpl;
  private readonly _transactionCoordinator: TransactionCoordinator;

  /** Near-cache manager — creates/manages near-caches per map name. */
  private readonly _nearCacheManager: DefaultNearCacheManager;

  /** Near-cache invalidation manager — pushes invalidation events to subscribed client sessions. */
  private readonly _nearCacheInvalidationManager: NearCacheInvalidationManager;

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
  private readonly _clientMapListenerRegistrations = new Map<string, MapClientListenerRegistration>();
  private readonly _clientSessionMapListeners = new Map<string, Set<string>>();
  private readonly _clientQueueListenerRegistrations = new Map<string, QueueClientListenerRegistration>();
  private readonly _clientSessionQueueListeners = new Map<string, Set<string>>();
  private readonly _clientListListenerRegistrations = new Map<string, ItemClientListenerRegistration>();
  private readonly _clientSessionListListeners = new Map<string, Set<string>>();
  private readonly _clientSetListenerRegistrations = new Map<string, ItemClientListenerRegistration>();
  private readonly _clientSessionSetListeners = new Map<string, Set<string>>();
  private readonly _clientMultiMapListenerRegistrations = new Map<string, MultiMapClientListenerRegistration>();
  private readonly _clientSessionMultiMapListeners = new Map<string, Set<string>>();
  private readonly _clientReplicatedMapListenerRegistrations = new Map<string, ReplicatedMapClientListenerRegistration>();
  private readonly _clientSessionReplicatedMapListeners = new Map<string, Set<string>>();
  private readonly _clientCacheInvalidationListenerRegistrations = new Map<string, CacheClientInvalidationListenerRegistration>();
  private readonly _clientSessionCacheInvalidationListeners = new Map<string, Set<string>>();
  private readonly _clientTransactions = new Map<string, ClientTransactionContext>();
  private readonly _pendingTxnBackupAcks = new Map<string, {
    resolve: (applied: boolean) => void;
    reject: (error: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout> | null;
    target: string;
  }>();
  private readonly _dedupedTxnBackupMessages = new RecentStringSet(8_192);
  private readonly _dedupedQueueTxnOps = new RecentStringSet(8_192);
  private readonly _dedupedListTxnOps = new RecentStringSet(8_192);
  private readonly _dedupedSetTxnOps = new RecentStringSet(8_192);
  private readonly _dedupedMultiMapTxnOps = new RecentStringSet(8_192);
  private readonly _addressToMemberId = new Map<string, string>();
  private _pendingResponseEntryPool: PendingResponseEntryPool = new PendingResponseEntryPool();
  private _invocationMonitor: InvocationMonitor = new InvocationMonitor(this._pendingResponseEntryPool);
  private readonly _localBackupAckWaiters = new Map<number, {
    pendingMemberIds: Set<string>;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
  }>();
  private _invocationSweepHandle: ReturnType<typeof setInterval> | null = null;

  /** Remote invocation backpressure regulator — non-null when clustering is enabled. */
  private _backpressureRegulator: BackpressureRegulator | null = null;

  /** Migration manager — non-null when clustering is enabled. */
  private _migrationManager: MigrationManager | null = null;

  /** Operation service impl — reference kept for metrics access. */
  private _operationServiceImpl: OperationServiceImpl | null = null;

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Slow operation detector — created and started in _initMonitor(). */
  private _slowOperationDetector: SlowOperationDetector | null = null;

  /** Store latency tracker — created in _initMonitor(), wired to MapContainerService. */
  private _storeLatencyTracker: StoreLatencyTracker | null = null;

  /** System event log — ring buffer of cluster lifecycle events. */
  private readonly _systemEventLog = new SystemEventLog();

  constructor(config?: HeliosConfig) {
    this._config = config ?? new HeliosConfig();
    this._name = this._config.getName();

    // Production SerializationServiceImpl — single shared instance for NodeEngine + NearCacheManager.
    const serializationConfig = this._config.getSerializationConfig();
    this._ss = new HazelcastSerializationService(serializationConfig);

    // MapContainerService — must be registered before any map proxy creation
    this._mapService = new MapContainerService();

    // Near-cache manager — shares the same serialization service as the node engine
    this._nearCacheManager = new DefaultNearCacheManager(this._ss);

    // Near-cache invalidation manager — pushes invalidation events to subscribed clients
    this._nearCacheInvalidationManager = new NearCacheInvalidationManager();

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

    this._transactionManagerService = new TransactionManagerServiceImpl(this._nodeEngine);
    this._transactionCoordinator = new TransactionCoordinator(
      this._nodeEngine,
      this._transactionManagerService,
    );
    this._transactionManagerService.configureReplication(
      this._buildTransactionBackupTransport(),
      this._buildTransactionBackupApplier(),
    );

    // RingbufferService — must be initialized after _startNetworking() (needs _nodeEngine)
    // and before DistributedRingbufferService / ReliableTopicService (both depend on it).
    this._ringbufferService = new RingbufferService(this._nodeEngine);

    // Reliable topic service — always available (single-node ringbuffer-backed via RingbufferService)
    this._reliableTopicService = new ReliableTopicService(
      this.getLocalMemberId(),
      this._config,
      this._ringbufferService,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );

    // DistributedRingbufferService — needs both _ringbufferService (above) and
    // _transport/_clusterCoordinator (set inside _startNetworking). Constructed here
    // so _rbService is never undefined when membership-change callbacks fire.
    if (this._transport !== null && this._clusterCoordinator !== null) {
      this._distributedRingbufferService = new DistributedRingbufferService(
        this.getLocalMemberId(),
        this._config,
        this._ringbufferService,
        this._transport,
        this._clusterCoordinator,
      );
    }

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
    this._syncLocalMemberEndpoints();

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
      // Capture the internally created OperationServiceImpl for metrics collection
      this._operationServiceImpl = this._nodeEngine.getOperationService() as OperationServiceImpl;
      return;
    }

    const port = this._config.getNetworkConfig().getPort();
    const scatterConfig = this._config.getNetworkConfig().getTcpTransportScatterConfig();
    // Generate a single RFC 4122 UUID shared by both the transport HELLO handshake
    // and the cluster coordinator member identity. This is critical: the transport
    // registers peers by the nodeId from their HELLO message, and the coordinator
    // sends cluster messages (JOIN_REQUEST, FINALIZE_JOIN, etc.) addressed by member
    // UUID. Both must use the same identifier or targeted sends will silently drop.
    const memberUuid = crypto.randomUUID();
    this._transport = new TcpClusterTransport(memberUuid, undefined, {
      scatterOutboundEncoding: scatterConfig.isEnabled(),
      scatterOutboundEncoder: {
        inputCapacityBytes: scatterConfig.getInputCapacityBytes(),
        outputCapacityBytes: scatterConfig.getOutputCapacityBytes(),
      },
    });
    this._transport.start(port, "0.0.0.0");

    // Create cluster coordinator (needs transport bound port)
    this._clusterCoordinator = new HeliosClusterCoordinator(
      this._name,
      this._config,
      this._transport,
      this._ss,
      memberUuid,
    );
    if (!multicast.isEnabled()) {
      this._clusterCoordinator.bootstrap();
    }
    this._cluster = this._clusterCoordinator.getCluster();
    const internalPartitionService = this._clusterCoordinator.getInternalPartitionService();
    internalPartitionService.setReplicaManager(this._replicaManager);
    internalPartitionService.setLocalMemberUuid(this._clusterCoordinator.getLocalMemberId());

    // Create the MigrationManager sharing the same PartitionStateManager as the partition service.
    this._migrationManager = new MigrationManager(
      internalPartitionService.getPartitionStateManager(),
      new MigrationQueue(),
    );
    internalPartitionService.setAntiEntropyDispatcher((targetUuid, op) => {
      this._dispatchAntiEntropy(targetUuid, op);
    });
    this._knownExecutorMemberIds = this._captureCurrentMemberIds();
    this._rebuildAddressToMemberIdCache();
    this._clusterCoordinator.onMembershipChanged(() => {
      this._rebuildAddressToMemberIdCache();
      this._handleExecutorMembershipChange();
      this._publishClientTopology();
      this._systemEventLog.pushEvent('MEMBER_JOINED', 'Cluster membership changed');
    });
    this._clusterCoordinator.onMemberRemoved((memberId) => {
      this._systemEventLog.pushEvent('MEMBER_LEFT', `Member left: ${memberId}`, { memberId });
      queueMicrotask(() => {
        this._invocationMonitor.failInvocationsForMember(memberId);
        this._failLocalBackupAckWaitersForMember(memberId);
        void this._transactionManagerService.recoverBackupLogsForCoordinator(memberId);
      });
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
    this._startInvocationSweeper();

    // Create backpressure regulator for remote invocation admission control
    const backpressureConfig = this._config.getBackpressureConfig();
    const partitionCount = 271;
    this._backpressureRegulator = new BackpressureRegulator(backpressureConfig, partitionCount);

    let callIdCounter = 1;
    const regulator = this._backpressureRegulator;
    const operationService = new OperationServiceImpl(
      null as unknown as NodeEngineImpl, // will be set below via back-reference
      {
        localMode: false,
        localAddress,
        afterLocalRun: async (op) => {
          const backupMemberIds = await this._dispatchBackupsForOperation(op, coordinator.getLocalMemberId());
          await this._awaitLocalBackupAcks(Number(op.getCallId()), backupMemberIds);
        },
        remoteSend: async (op, target) => {
          // Backpressure admission: acquire a slot before sending.
          // tryAcquire() returns synchronously when space is available,
          // or a Promise when at capacity (waits up to backoffTimeout).
          const acquired = regulator.tryAcquire();
          // acquired is either a number (call ID from regulator) or a Promise<number>.
          // We use the regulator's call ID for tracking, but the actual wire callId
          // is assigned from our own counter for monitor registration.
          if (acquired instanceof Promise) {
            await acquired;
          }

          const callId = callIdCounter++;
          const { factoryId, classId, payload } = serializeOperation(op);
          const targetMemberId = this._findMemberIdByAddress(target);
          if (targetMemberId === null) {
            regulator.release();
            throw new Error(`No member found for address ${target.getHost()}:${target.getPort()}`);
          }

          return new Promise<void>((resolve, reject) => {
            this._invocationMonitor.register({
              callId,
              resolve: (value: unknown) => {
                regulator.release();
                op.sendResponse(value);
                resolve();
              },
              reject: (error: Error) => {
                regulator.release();
                reject(error);
              },
              targetMemberId,
              timeoutMs: REMOTE_OPERATION_TIMEOUT_MS,
              backupAckTimeoutMs: REMOTE_BACKUP_ACK_TIMEOUT_MS,
            });

            const sent = transport.send(targetMemberId, {
              type: 'OPERATION',
              callId,
              partitionId: op.partitionId,
              factoryId,
              classId,
              payload,
              senderId: coordinator.getLocalMemberId(),
            });

            if (!sent) {
              void (async () => {
                const connected = await this._ensureRemotePeerConnected(targetMemberId, target);
                if (connected && transport.send(targetMemberId, {
                  type: 'OPERATION',
                  callId,
                  partitionId: op.partitionId,
                  factoryId,
                  classId,
                  payload,
                  senderId: coordinator.getLocalMemberId(),
                })) {
                  return;
                }
                this._invocationMonitor.failInvocation(
                  callId,
                  new RetryableException(`Send failed: peer ${targetMemberId} not connected (callId=${callId})`),
                );
              })();
              return;
            }

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

    // Keep a typed reference for metrics collection
    this._operationServiceImpl = operationService;

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
      this._systemEventLog.pushEvent('CONNECTION_OPENED', `Peer connected: ${nodeId}`, { nodeId });
    };
    this._transport.onPeerDisconnected = (nodeId) => {
      this._clusterCoordinator?.handlePeerDisconnected(nodeId);
      this._systemEventLog.pushEvent('CONNECTION_CLOSED', `Peer disconnected: ${nodeId}`, { nodeId });
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
      if (message.type === 'BACKUP_ACK') {
        this._handleBackupAck(message);
        return;
      }
      if (message.type === 'BACKUP') {
        this._handleBackup(message);
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
      if (message.type === 'TXN_BACKUP_REPLICATION') {
        const dedupeKey = `${message.sourceNodeId}:${message.requestId ?? 'fire-and-forget'}:${message.payload.txnId}:${message.payload.type}`;
        let applied = true;
        if (!this._dedupedTxnBackupMessages.has(dedupeKey)) {
          this._dedupedTxnBackupMessages.add(dedupeKey);
          applied = this._transactionManagerService.applyBackupMessage(message.payload);
        }
        if (message.requestId !== null) {
          this._transport?.send(message.sourceNodeId, {
            type: 'TXN_BACKUP_REPLICATION_ACK',
            requestId: message.requestId,
            txnId: message.payload.txnId,
            applied,
          });
        }
        return;
      }
      if (message.type === 'TXN_BACKUP_REPLICATION_ACK') {
        const pending = this._pendingTxnBackupAcks.get(message.requestId);
        if (pending !== undefined) {
          this._pendingTxnBackupAcks.delete(message.requestId);
          if (pending.timeoutHandle !== null) {
            clearTimeout(pending.timeoutHandle);
          }
          pending.resolve(message.applied);
        }
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
      if (this._distributedListService?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedSetService?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedMultiMapService?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedReplicatedMapService?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedCacheService?.handleMessage(message) === true) {
        return;
      }
      if (this._distributedRingbufferService?.handleMessage(message) === true) {
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

    const localMemberId = this.getLocalMemberId();
    this._distributedQueueService = new DistributedQueueService(
      localMemberId,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedListService = new DistributedListService(
      localMemberId,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedSetService = new DistributedSetService(
      localMemberId,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedMultiMapService = new DistributedMultiMapService(
      localMemberId,
      this._config,
      this._ss,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedReplicatedMapService = new DistributedReplicatedMapService(
      localMemberId,
      this._config,
      this._transport,
      this._clusterCoordinator,
    );
    this._distributedCacheService = this._createDistributedCacheService(localMemberId);
    // NOTE: DistributedRingbufferService is constructed after _startNetworking() returns,
    // once _ringbufferService is initialised. See constructor body.
    this._distributedTopicService = new DistributedTopicService(
      localMemberId,
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
      clusterName: this._config.getClusterName(),
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

  /** Handle an incoming OPERATION message: execute locally and send response. */
  private _handleRemoteOperation(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'OPERATION' }>): void {
    const { callId, partitionId, factoryId, classId, payload } = message;
    const op = deserializeOperation(factoryId, classId, payload);
    const senderMemberId = this._findSenderForOperation(message);
    op.partitionId = partitionId;
    op.setCallId(BigInt(callId));
    op.setNodeEngine(this._nodeEngine);

    void (async () => {
      let responseValue: unknown = undefined;
      let errorMsg: string | null = null;
      let backupMemberIds: string[] = [];

      op.setResponseHandler({
        sendResponse: (_op, response) => {
          responseValue = response;
        },
      });

      try {
        await op.beforeRun();
        await op.run();
        backupMemberIds = await this._dispatchBackupsForOperation(op, senderMemberId ?? null);
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
      if (senderMemberId !== null && this._transport !== null) {
          this._transport.send(senderMemberId, {
            type: 'OPERATION_RESPONSE',
            callId,
            backupAcks: errorMsg === null ? backupMemberIds.length : 0,
            backupMemberIds: errorMsg === null ? backupMemberIds : [],
            payload: responseValue,
            error: errorMsg,
          });
      }
    })();
  }

  /** Handle an incoming OPERATION_RESPONSE message. */
  private _handleOperationResponse(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'OPERATION_RESPONSE' }>): void {
    this._invocationMonitor.handleResponse(message);
  }

  private _handleBackupAck(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'BACKUP_ACK' }>): void {
    const waiter = this._localBackupAckWaiters.get(message.callId);
    if (waiter !== undefined) {
      waiter.pendingMemberIds.delete(message.senderId);
      if (waiter.pendingMemberIds.size === 0) {
        clearTimeout(waiter.timeoutHandle);
        this._localBackupAckWaiters.delete(message.callId);
        waiter.resolve();
      }
      return;
    }
    this._invocationMonitor.handleBackupAck(message);
  }

  private _handleBackup(message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'BACKUP' }>): void {
    const op = deserializeOperation(message.factoryId, message.classId, message.payload);
    op.partitionId = message.partitionId;
    op.setReplicaIndex(message.replicaIndex);
    op.setNodeEngine(this._nodeEngine);

    void (async () => {
      const partition = this._clusterCoordinator?.getInternalPartitionService().getPartition(message.partitionId);
      const localMemberId = this._clusterCoordinator?.getLocalMemberId() ?? null;
      const expectedReplica = partition?.getReplica(message.replicaIndex) ?? null;
      if (expectedReplica === null || expectedReplica.uuid() !== localMemberId) {
        return;
      }

      const replicaVersions = message.replicaVersions.map((value) => BigInt(value));
      if (this._replicaManager.isPartitionReplicaVersionStale(message.partitionId, replicaVersions, message.replicaIndex)) {
        return;
      }

      try {
        await op.beforeRun();
        await op.run();
        this._replicaManager.updatePartitionReplicaVersions(message.partitionId, replicaVersions, message.replicaIndex);
      } catch {
        return;
      }

      if (!message.sync || localMemberId === null) {
        return;
      }

      if (message.callerId === localMemberId) {
        this._invocationMonitor.handleBackupAck({
          callId: message.callId,
          senderId: localMemberId,
        });
        return;
      }

      if (this._transport === null) {
        return;
      }

      this._transport.send(message.callerId, {
        type: 'BACKUP_ACK',
        callId: message.callId,
        senderId: localMemberId,
      });
    })();
  }

  private async _dispatchBackupsForOperation(
    op: import('@zenystx/helios-core/spi/impl/operationservice/Operation').Operation,
    callerMemberId: string | null,
  ): Promise<string[]> {
    if (
      !isBackupAwareOperation(op)
      || !op.shouldBackup()
      || this._clusterCoordinator === null
      || this._transport === null
      || callerMemberId === null
    ) {
      return [];
    }

    const requestedSync = op.getSyncBackupCount();
    const requestedAsync = op.getAsyncBackupCount();
    const requestedTotal = requestedSync + requestedAsync;
    const clusterSize = this._clusterCoordinator.getCluster().getMembers().length;
    const totalBackups = Math.min(requestedTotal, Math.max(0, clusterSize - 1));
    if (totalBackups === 0) {
      return [];
    }

    const backupIds = this._clusterCoordinator.getBackupIds(op.partitionId, totalBackups);
    if (backupIds.length === 0) {
      return [];
    }

    const syncBackups = Math.min(requestedSync, backupIds.length);
    const replicaVersions = this._replicaManager.incrementPartitionReplicaVersions(op.partitionId, backupIds.length);
    const sentSyncBackupIds: string[] = [];

    for (const [index, backupId] of backupIds.entries()) {
      const replicaIndex = index + 1;
      const backupOp = op.getBackupOperation();
      backupOp.partitionId = op.partitionId;
      backupOp.setReplicaIndex(replicaIndex);
      const { factoryId, classId, payload } = serializeOperation(backupOp);
      const sent = this._transport.send(backupId, {
        type: 'BACKUP',
        callId: Number(op.getCallId()),
        partitionId: op.partitionId,
        replicaIndex,
        senderId: this._clusterCoordinator.getLocalMemberId(),
        callerId: callerMemberId,
        sync: replicaIndex <= syncBackups,
        replicaVersions: replicaVersions.map((value) => value.toString()),
        factoryId,
        classId,
        payload,
      });
      if (sent && replicaIndex <= syncBackups) {
        sentSyncBackupIds.push(backupId);
      }
    }

    return sentSyncBackupIds;
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

  private _buildTransactionBackupTransport(): import('@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl').TransactionBackupTransport | null {
    if (this._clusterCoordinator === null || this._transport === null) {
      return null;
    }

    return {
      localMemberId: this._clusterCoordinator.getLocalMemberId(),
      getBackupMemberIds: (count: number) => {
        const localMemberId = this._clusterCoordinator!.getLocalMemberId();
        return this._clusterCoordinator!
          .getCluster()
          .getMembers()
          .map((member) => member.getUuid())
          .filter((memberId) => memberId !== localMemberId)
          .slice(0, count);
      },
      getActiveMemberIds: () => this._clusterCoordinator!
        .getCluster()
        .getMembers()
        .map((member) => member.getUuid()),
      validateBackupMembers: async (targets) => {
        const confirmedTargets: string[] = [];
        for (const target of targets) {
          if (target === this._clusterCoordinator!.getLocalMemberId()) {
            confirmedTargets.push(target);
            continue;
          }
          const member = this._clusterCoordinator!.getCluster().getMembers().find((candidate) => candidate.getUuid() === target);
          if (member === undefined) {
            continue;
          }
          try {
            await this._ensureRemotePeerConnected(target, member.getAddress(), 2_000);
            const directTransport = this._transport as unknown as { _peers: Map<string, unknown> };
            if (directTransport._peers.has(target)) {
              confirmedTargets.push(target);
            }
          } catch {
            continue;
          }
        }
        return confirmedTargets;
      },
      replicate: async (payload, targets) => {
        const acknowledgedTargets: string[] = [];
        for (const target of targets) {
          if (target === this._clusterCoordinator!.getLocalMemberId()) {
            acknowledgedTargets.push(target);
            continue;
          }
          const member = this._clusterCoordinator!.getCluster().getMembers().find((candidate) => candidate.getUuid() === target);
          if (member === undefined) {
            continue;
          }
          await this._ensureRemotePeerConnected(target, member.getAddress(), 2_000);
          const directTransport = this._transport as unknown as {
            _peers: Map<string, unknown>;
            _sendMsg(ch: unknown, msg: import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage): boolean;
          };
          const channel = directTransport._peers.get(target);
          if (channel !== undefined) {
            const requestId = crypto.randomUUID();
            const ackPromise = new Promise<boolean>((resolve, reject) => {
              const timeoutHandle = setTimeout(() => {
                this._pendingTxnBackupAcks.delete(requestId);
                reject(new Error(`Transaction backup replication timed out for target ${target}`));
              }, 10_000);
              this._pendingTxnBackupAcks.set(requestId, {
                resolve,
                reject,
                timeoutHandle,
                target,
              });
            });
            directTransport._sendMsg(channel, {
              type: 'TXN_BACKUP_REPLICATION',
              requestId,
              sourceNodeId: this._clusterCoordinator!.getLocalMemberId(),
              payload,
            });
            if (await ackPromise) {
              acknowledgedTargets.push(target);
            }
          }
        }
        return acknowledgedTargets;
      },
    };
  }

  private _buildTransactionBackupApplier(): TransactionBackupApplier {
    return new TransactionBackupApplier({
      mapService: this._mapService,
      queueService: this._distributedQueueService,
      listService: this._distributedListService,
      setService: this._distributedSetService,
      multiMapService: this._distributedMultiMapService,
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
    const ownerId = this.getPartitionOwnerId(message.partitionId);
    if (ownerId === null) {
      return;
    }
    const syncId = this._clusterCoordinator?.getInternalPartitionService().tryRegisterSyncRequest(
      message.partitionId,
      message.replicaIndex,
      ownerId,
      result.dirtyNamespaces,
    );
    if (syncId === null || syncId === undefined) {
      return;
    }
    this._transport?.send(ownerId, {
      type: 'RECOVERY_SYNC_REQUEST',
      requestId: syncId,
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
    const chunks = chunkNamespaceStates(namespaceStates, RECOVERY_SYNC_CHUNK_MAX_BYTES);
    const namespaceVersions = Object.fromEntries(
      message.dirtyNamespaces.map((namespace) => [
        namespace,
        this._replicaManager
          .getNamespaceReplicaVersions(message.partitionId, namespace)
          .map((value) => value.toString()),
      ]),
    );
    const versions = this._replicaManager
      .getPartitionReplicaVersions(message.partitionId)
      .map((value) => value.toString());
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;
      this._transport?.send(message.requesterId, {
        type: 'RECOVERY_SYNC_RESPONSE',
        requestId: message.requestId,
        partitionId: message.partitionId,
        replicaIndex: message.replicaIndex,
        chunkIndex,
        chunkCount: chunks.length,
        versions,
        namespaceVersions,
        namespaceStates: chunk.map((state) => ({
          namespace: state.namespace,
          estimatedSizeBytes: state.estimatedSizeBytes,
          entries: state.entries.map(([key, value]) => [encodeData(key), encodeData(value)] as const),
        })),
      });
    }
  }

  private _handleRecoverySyncResponse(
    message: Extract<import('@zenystx/helios-core/cluster/tcp/ClusterMessage').ClusterMessage, { type: 'RECOVERY_SYNC_RESPONSE' }>,
  ): void {
    const internalPartitionService = this._clusterCoordinator?.getInternalPartitionService();
    if (internalPartitionService === null || internalPartitionService === undefined) {
      return;
    }
    if (!internalPartitionService.acceptSyncResponseChunk(message.requestId, message.chunkIndex, message.chunkCount)) {
      this._recoverySyncAssemblies.delete(message.requestId);
      return;
    }

    const namespaceStates = message.namespaceStates.map((state) => ({
      namespace: state.namespace,
      estimatedSizeBytes: state.estimatedSizeBytes,
      entries: state.entries.map(([key, value]) => [decodeData(key), decodeData(value)] as const),
    }));
    const assembler = this._recoverySyncAssemblies.get(message.requestId)
      ?? new PartitionReplicaSyncChunkAssembler();
    this._recoverySyncAssemblies.set(message.requestId, assembler);
    if (!assembler.acceptChunk(message.chunkIndex, message.chunkCount, namespaceStates)) {
      this._recoverySyncAssemblies.delete(message.requestId);
      return;
    }
    if (!assembler.isComplete()) {
      return;
    }

    const response = new PartitionReplicaSyncResponse(
      message.partitionId,
      message.replicaIndex,
      assembler.buildNamespaceStates(),
      message.versions.map((value) => BigInt(value)),
      new Map(
        Object.entries(message.namespaceVersions).map(([namespace, versions]) => [
          namespace,
          versions.map((value) => BigInt(value)),
        ]),
      ),
    );
    if (!internalPartitionService.completeSyncRequest(message.requestId, response.versions)) {
      this._recoverySyncAssemblies.delete(message.requestId);
      return;
    }

    try {
      response.apply(
        this._mapService.getOrCreatePartitionContainer(message.partitionId),
        this._replicaManager,
      );
    } catch (error) {
      this._replicaManager.releaseReplicaSyncPermits(1);
      throw error;
    } finally {
      this._recoverySyncAssemblies.delete(message.requestId);
    }
  }

  /** Extract the sender member ID from an OPERATION message. */
  private _findSenderForOperation(message: { senderId: string }): string | null {
    return message.senderId ?? null;
  }

  private _startInvocationSweeper(): void {
    if (this._invocationSweepHandle !== null) {
      return;
    }
    this._invocationSweepHandle = setInterval(() => {
      this._sweepPendingResponses();
    }, INVOCATION_SWEEP_INTERVAL_MS);
  }

  private _stopInvocationSweeper(): void {
    if (this._invocationSweepHandle === null) {
      return;
    }
    clearInterval(this._invocationSweepHandle);
    this._invocationSweepHandle = null;
  }

  private _awaitLocalBackupAcks(callId: number, backupMemberIds: readonly string[]): Promise<void> {
    if (backupMemberIds.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const waiter = this._localBackupAckWaiters.get(callId);
        if (waiter === undefined) {
          return;
        }
        this._localBackupAckWaiters.delete(callId);
        reject(new Error(
          `Backup ack timed out (callId=${callId}, required=${backupMemberIds.length}, received=${backupMemberIds.length - waiter.pendingMemberIds.size})`,
        ));
      }, REMOTE_BACKUP_ACK_TIMEOUT_MS);

      this._localBackupAckWaiters.set(callId, {
        pendingMemberIds: new Set(backupMemberIds),
        resolve,
        reject,
        timeoutHandle,
      });
    });
  }

  private _failLocalBackupAckWaitersForMember(memberId: string): void {
    for (const [callId, waiter] of this._localBackupAckWaiters) {
      if (!waiter.pendingMemberIds.has(memberId)) {
        continue;
      }
      clearTimeout(waiter.timeoutHandle);
      this._localBackupAckWaiters.delete(callId);
      waiter.reject(new Error(`Backup member ${memberId} left before acknowledgement completed (callId=${callId})`));
    }
  }

  private _sweepPendingResponses(now: number = Date.now()): void {
    this._invocationMonitor.sweep(now);
    this._sweepReplicaSyncRequests(now);
  }

  private _sweepReplicaSyncRequests(now: number): void {
    const internalPartitionService = this._clusterCoordinator?.getInternalPartitionService();
    if (internalPartitionService === null || internalPartitionService === undefined) {
      return;
    }

    const retryableRequests = internalPartitionService.expireTimedOutSyncRequests(now);
    for (const requestId of this._recoverySyncAssemblies.keys()) {
      if (internalPartitionService.getSyncRequestInfo(requestId) === null) {
        this._recoverySyncAssemblies.delete(requestId);
      }
    }
    for (const request of retryableRequests) {
      const ownerId = this.getPartitionOwnerId(request.partitionId);
      if (ownerId === null) {
        continue;
      }

      const retriedSyncId = internalPartitionService.tryRegisterSyncRequest(
        request.partitionId,
        request.replicaIndex,
        ownerId,
        request.dirtyNamespaces,
        now,
        request.retryCount + 1,
      );
      if (retriedSyncId === null || retriedSyncId === undefined) {
        continue;
      }

      this._transport?.send(ownerId, {
        type: 'RECOVERY_SYNC_REQUEST',
        requestId: retriedSyncId,
        requesterId: this._clusterCoordinator!.getLocalMemberId(),
        partitionId: request.partitionId,
        replicaIndex: request.replicaIndex,
        dirtyNamespaces: [...request.dirtyNamespaces],
      });
    }
  }

  private _addressKey(address: Address): string {
    return `${address.getHost()}:${address.getPort()}`;
  }

  private _rebuildAddressToMemberIdCache(): void {
    this._addressToMemberId.clear();
    if (this._clusterCoordinator === null) {
      return;
    }
    for (const member of this._cluster.getMembers()) {
      this._addressToMemberId.set(this._addressKey(member.getAddress()), member.getUuid());
    }
  }

  /** Find the member ID for a given address. */
  private _findMemberIdByAddress(target: Address): string | null {
    return this._addressToMemberId.get(this._addressKey(target)) ?? null;
  }

  private async _ensureRemotePeerConnected(
    memberId: string,
    target: Address,
    timeoutMs: number = REMOTE_PEER_CONNECT_TIMEOUT_MS,
  ): Promise<boolean> {
    if (this._transport === null) {
      return false;
    }
    if (this._transport.hasPeer(memberId)) {
      return true;
    }
    this._transport.connectToPeer(target.getHost(), target.getPort()).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this._transport.hasPeer(memberId)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, REMOTE_PEER_CONNECT_POLL_MS));
    }
    return this._transport.hasPeer(memberId);
  }

  private _initBlitzLifecycle(): void {
    const blitzConfig = this._config.getBlitzConfig();
    if (!blitzConfig || blitzConfig.enabled === false) return;

    this._blitzLifecycleManager = new HeliosBlitzLifecycleManager(
      blitzConfig,
      // Use the cluster member UUID so that Blitz registration messages carry
      // the same ID that the coordinator uses in expectedRegistrants. The
      // HeliosBlitzCoordinator.isRegistrationComplete() compares
      // registration.memberId against the set of cluster member UUIDs.
      this.getLocalMemberId(),
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
      clusterName: this._config.getClusterName(),
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

    // Bun.listen() is synchronous — the port is bound as soon as start() runs.
    // We must start() BEFORE registering handlers so that srv.getPort() returns
    // the actual bound port (especially for ephemeral port 0).
    this._clientProtocolReady = this._clientProtocolServer.start();
    this._syncLocalMemberEndpoints();

    this._registerClientProtocolHandlers();
  }

  private _registerClientProtocolHandlers(): void {
    const srv = this._clientProtocolServer!;
    const ps = this._nodeEngine.getPartitionService();
    const partitionCount = this.getPartitionCount();
    const entryProcessorEngine = new MapEntryProcessorEngine(this._mapService, this._nodeEngine);
    const trackClientProtocolOperations = <T extends object>(operations: T): T => {
      const operationService = this._operationServiceImpl;
      if (operationService === null) {
        return operations;
      }

      const wrapped = { ...operations } as T;
      for (const name of Object.keys(operations) as Array<keyof T>) {
        const operation = operations[name];
        if (typeof operation !== 'function') {
          continue;
        }

        wrapped[name] = (async (...args: unknown[]) => {
          return operationService.trackExternalOperation(async () => {
            return (operation as (...callArgs: unknown[]) => Promise<unknown>)(...args);
          });
        }) as T[keyof T];
      }

      return wrapped;
    };

    const deserializeEntryProcessor = <R>(data: Data): EntryProcessor<R> => {
      const processor = this._ss.toObject<EntryProcessor<R>>(data);
      if (processor === null || typeof processor.process !== 'function') {
        throw new Error('Entry processor payload is not a valid EntryProcessor');
      }
      return processor;
    };

    const deserializePredicate = (data: Data): Predicate => {
      const predicate = this._ss.toObject<Predicate>(data);
      if (predicate === null || typeof predicate.apply !== 'function') {
        throw new Error('Predicate payload is not a valid Predicate');
      }
      return predicate;
    };

    const serializeResult = (value: unknown): Data | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (value instanceof Object && 'toByteArray' in value && typeof (value as Data).toByteArray === 'function') {
        return value as Data;
      }
      return this._ss.toData(value);
    };

    const getKeyObject = (key: Data): unknown => this._ss.toObject(key);

    const getValueObject = (value: Data): unknown => this._ss.toObject(value);

    const getEventAttributeValue = (value: unknown, attribute: string): unknown => {
      if (attribute === 'this') {
        return value;
      }
      const segments = attribute.split('.');
      let current: unknown = value;
      for (const segment of segments) {
        if (current === null || current === undefined) {
          return undefined;
        }
        if (typeof current !== 'object') {
          return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
      }
      return current;
    };

    const predicateMatches = (predicate: Predicate, key: Data, value: Data): boolean => {
      const keyObject = getKeyObject(key);
      const valueObject = getValueObject(value);
      return predicate.apply({
        getKey: () => keyObject,
        getValue: () => valueObject,
        getAttributeValue: (attribute: string) => {
          if (attribute === '__key') {
            return keyObject;
          }
          return getEventAttributeValue(valueObject, attribute);
        },
      });
    };

    // ── Map adapter ───────────────────────────────────────────────────────
    const mapOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').MapServiceOperations = {
      put: async (name, key, value, _threadId, ttl) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.put(key, value, Number(ttl), -1);
        this._publishClientMapEvent(name, key, value, previous, previous === null ? 1 : 4);
        return previous;
      },
      get: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        return store.get(key);
      },
      remove: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.remove(key);
        if (previous !== null) {
          this._publishClientMapEvent(name, key, null, previous, 2);
        }
        return previous;
      },
      size: async (name) => {
        let total = 0;
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store) total += store.size();
        }
        return total;
      },
      containsKey: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        return store.containsKey(key);
      },
      containsValue: async (name, value) => {
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store?.containsValue(value)) return true;
        }
        return false;
      },
      clear: async (name) => {
        let affectedEntries = 0;
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store) {
            affectedEntries += store.size();
            store.clear();
          }
        }
        if (affectedEntries > 0) {
          this._publishClientMapBulkEvent(name, 64, affectedEntries);
        }
      },
      delete: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        if (store.delete(key)) {
          this._publishClientMapEvent(name, key, null, null, 2);
        }
      },
      set: async (name, key, value, _threadId, ttl) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.put(key, value, Number(ttl), -1);
        this._publishClientMapEvent(name, key, value, previous, previous === null ? 1 : 4);
      },
      getAll: async (name, keys) => {
        const result: Array<[import('@zenystx/helios-core/internal/serialization/Data').Data, import('@zenystx/helios-core/internal/serialization/Data').Data]> = [];
        for (const key of keys) {
          const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
          const val = store.get(key);
          if (val !== null) result.push([key, val]);
        }
        return result;
      },
      putAll: async (name, entries) => {
        for (const [key, value] of entries) {
          const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
          const previous = store.put(key, value, -1, -1);
          this._publishClientMapEvent(name, key, value, previous, previous === null ? 1 : 4);
        }
      },
      putIfAbsent: async (name, key, value, _threadId, ttl) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.putIfAbsent(key, value, Number(ttl), -1);
        if (previous === null) {
          this._publishClientMapEvent(name, key, value, null, 1);
        }
        return previous;
      },
      replace: async (name, key, value, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.replace(key, value, -1, -1);
        if (previous !== null) {
          this._publishClientMapEvent(name, key, value, previous, 4);
        }
        return previous;
      },
      replaceIfSame: async (name, key, oldValue, newValue, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const current = store.get(key);
        if (current === null || !current.equals(oldValue)) {
          return false;
        }
        store.replace(key, newValue, -1, -1);
        this._publishClientMapEvent(name, key, newValue, oldValue, 4);
        return true;
      },
      removeIfSame: async (name, key, value, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const removed = store.removeIfSame(key, value);
        if (removed) {
          this._publishClientMapEvent(name, key, null, value, 2);
        }
        return removed;
      },
      getEntryView: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        return store.getEntryView(key);
      },
      evict: async (name, key, _threadId) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        const previous = store.get(key);
        const evicted = store.evict(key);
        if (evicted) {
          this._publishClientMapEvent(name, key, null, previous, 8);
        }
        return evicted;
      },
      evictAll: async (name) => {
        let affectedEntries = 0;
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (!store) {
            continue;
          }
          for (const [key] of store.entries()) {
            const keyObject = getKeyObject(key);
            if (this._getOrCreateProxy(name).isLocked(keyObject)) {
              continue;
            }
            if (store.evict(key)) {
              affectedEntries += 1;
            }
          }
        }
        if (affectedEntries > 0) {
          this._publishClientMapBulkEvent(name, 32, affectedEntries);
        }
      },
      flush: async (_name) => { /* no-op: no write-behind in this impl */ },
      keySet: async (name) => {
        const keys: import('@zenystx/helios-core/internal/serialization/Data').Data[] = [];
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store) for (const [k] of store.entries()) keys.push(k);
        }
        return keys;
      },
      values: async (name) => {
        const vals: import('@zenystx/helios-core/internal/serialization/Data').Data[] = [];
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store) for (const [, v] of store.entries()) vals.push(v);
        }
        return vals;
      },
      entrySet: async (name) => {
        const result: Array<[import('@zenystx/helios-core/internal/serialization/Data').Data, import('@zenystx/helios-core/internal/serialization/Data').Data]> = [];
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (store) for (const entry of store.entries()) result.push([entry[0], entry[1]]);
        }
        return result;
      },
      tryPut: async (name, key, value, _threadId, _timeout) => {
        const proxy = this._getOrCreateProxy(name);
        const keyObject = getKeyObject(key);
        if (!proxy.tryLock(keyObject)) {
          return false;
        }
        try {
          const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
          const previous = store.put(key, value, -1, -1);
          this._publishClientMapEvent(name, key, value, previous, previous === null ? 1 : 4);
          return true;
        } finally {
          proxy.unlock(keyObject);
        }
      },
      lock: async (name, key, _threadId, _ttl, _referenceId) => {
        this._getOrCreateProxy(name).lock(getKeyObject(key));
      },
      unlock: async (name, key, _threadId, _referenceId) => {
        this._getOrCreateProxy(name).unlock(getKeyObject(key));
      },
      tryLock: async (name, key, _threadId, _lease, _timeout, _referenceId) => {
        return this._getOrCreateProxy(name).tryLock(getKeyObject(key));
      },
      isLocked: async (name, key) => {
        return this._getOrCreateProxy(name).isLocked(getKeyObject(key));
      },
      forceUnlock: async (name, key, _referenceId) => {
        this._getOrCreateProxy(name).unlock(getKeyObject(key));
      },
      addEntryListener: async (name, flags, _localOnly, correlationId, session) => {
        return this._registerClientMapListener(name, flags, correlationId, session);
      },
      removeEntryListener: async (registrationId, session) => {
        return this._removeClientMapListener(session.getSessionId(), registrationId);
      },
      removeInterceptor: async (_name, _id) => false,
      executeOnKey: async (name, key, entryProcessor, _threadId) => {
        const before = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key)).get(key);
        const result = entryProcessorEngine.executeOnKey(name, key, deserializeEntryProcessor(entryProcessor));
        const after = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key)).get(key);
        this._publishClientMapMutationFromValues(name, key, before, after);
        return serializeResult(result);
      },
      executeOnAllKeys: async (name, entryProcessor) => {
        const processor = deserializeEntryProcessor(entryProcessor);
        const entries = entryProcessorEngine.executeOnEntries(name, processor);
        return entries
          .map(([key, result]) => [key, serializeResult(result)] as const)
          .filter((entry): entry is [Data, Data] => entry[1] !== null);
      },
      executeWithPredicate: async (name, entryProcessor, predicateData) => {
        const processor = deserializeEntryProcessor(entryProcessor);
        const predicate = deserializePredicate(predicateData);
        const keys: Data[] = [];
        for (let i = 0; i < partitionCount; i++) {
          const store = this._mapService.getRecordStore(name, i);
          if (!store) {
            continue;
          }
          for (const [key, value] of store.entries()) {
            if (predicateMatches(predicate, key, value)) {
              keys.push(key);
            }
          }
        }
        const results = entryProcessorEngine.executeOnKeys(name, keys, processor);
        return Array.from(results.entries())
          .map(([key, result]) => [key, serializeResult(result)] as const)
          .filter((entry): entry is [Data, Data] => entry[1] !== null);
      },
      executeOnKeys: async (name, keys, entryProcessor) => {
        const results = entryProcessorEngine.executeOnKeys(name, keys, deserializeEntryProcessor(entryProcessor));
        return Array.from(results.entries())
          .map(([key, result]) => [key, serializeResult(result)] as const)
          .filter((entry): entry is [Data, Data] => entry[1] !== null);
      },
      setTtl: async (name, key, ttl) => {
        const store = this._mapService.getOrCreateRecordStore(name, ps.getPartitionId(key));
        return store.setTtl(key, Number(ttl));
      },
    };

    // ── Queue adapter ─────────────────────────────────────────────────────
    const queueOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').QueueServiceOperations = {
      offer: async (name, value, timeoutMs) => {
        this._ensureQueueService();
        return this._distributedQueueService!.offer(name, value, Number(timeoutMs));
      },
      poll: async (name, timeoutMs) => {
        this._ensureQueueService();
        return this._distributedQueueService!.poll(name, Number(timeoutMs));
      },
      peek: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.peek(name);
      },
      size: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.size(name);
      },
      clear: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.clear(name);
      },
      isEmpty: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.isEmpty(name);
      },
      contains: async (name, value) => {
        this._ensureQueueService();
        return this._distributedQueueService!.contains(name, value);
      },
      containsAll: async (name, values) => {
        this._ensureQueueService();
        return this._distributedQueueService!.containsAll(name, values);
      },
      addAll: async (name, values) => {
        this._ensureQueueService();
        return this._distributedQueueService!.addAll(name, values);
      },
      removeAll: async (name, values) => {
        this._ensureQueueService();
        return this._distributedQueueService!.removeAll(name, values);
      },
      retainAll: async (name, values) => {
        this._ensureQueueService();
        return this._distributedQueueService!.retainAll(name, values);
      },
      drain: async (name, maxElements) => {
        this._ensureQueueService();
        return this._distributedQueueService!.drain(name, maxElements);
      },
      iterator: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.toArray(name);
      },
      remainingCapacity: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.remainingCapacity(name);
      },
      take: async (name) => {
        this._ensureQueueService();
        return this._distributedQueueService!.poll(name, 0);
      },
      put: async (name, value) => {
        this._ensureQueueService();
        await this._distributedQueueService!.offer(name, value, 0);
      },
      addItemListener: async (name, includeValue, correlationId, session) =>
        this._registerClientQueueListener(name, includeValue, correlationId, session),
      removeItemListener: async (registrationId, session) =>
        this._removeClientQueueListener(session.getSessionId(), registrationId),
    };

    // ── Topic adapter ─────────────────────────────────────────────────────
    const topicOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').TopicServiceOperations = {
      publish: async (name, message) => {
        this._ensureTopicService();
        return this._distributedTopicService!.publish(name, message);
      },
      publishAll: async (name, messages) => {
        this._ensureTopicService();
        for (const msg of messages) {
          await this._distributedTopicService!.publish(name, msg);
        }
      },
      addMessageListener: async (name, correlationId, session) =>
        this._registerClientTopicListener(name, correlationId, session),
      removeMessageListener: async (registrationId, session) =>
        this._removeClientTopicListener(session.getSessionId(), registrationId),
    };

    const listOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').ListServiceOperations = {
      add: async (name, value) => {
        this._ensureListService();
        return this._distributedListService!.add(name, value);
      },
      addWithIndex: async (name, index, value) => {
        this._ensureListService();
        await this._distributedListService!.addAt(name, index, value);
      },
      get: async (name, index) => {
        this._ensureListService();
        return this._distributedListService!.get(name, index);
      },
      set: async (name, index, value) => {
        this._ensureListService();
        return this._distributedListService!.set(name, index, value);
      },
      remove: async (name, value) => {
        this._ensureListService();
        return this._distributedListService!.remove(name, value);
      },
      removeWithIndex: async (name, index) => {
        this._ensureListService();
        return this._distributedListService!.removeAt(name, index);
      },
      size: async (name) => {
        this._ensureListService();
        return this._distributedListService!.size(name);
      },
      contains: async (name, value) => {
        this._ensureListService();
        return this._distributedListService!.contains(name, value);
      },
      containsAll: async (name, values) => {
        this._ensureListService();
        return this._distributedListService!.containsAll(name, values);
      },
      addAll: async (name, values) => {
        this._ensureListService();
        return this._distributedListService!.addAll(name, values);
      },
      addAllWithIndex: async (name, index, values) => {
        this._ensureListService();
        return this._distributedListService!.addAllAt(name, index, values);
      },
      clear: async (name) => {
        this._ensureListService();
        await this._distributedListService!.clear(name);
      },
      indexOf: async (name, value) => {
        this._ensureListService();
        return this._distributedListService!.indexOf(name, value);
      },
      lastIndexOf: async (name, value) => {
        this._ensureListService();
        return this._distributedListService!.lastIndexOf(name, value);
      },
      iterator: async (name) => {
        this._ensureListService();
        return this._distributedListService!.toArray(name);
      },
      subList: async (name, from, to) => {
        this._ensureListService();
        return this._distributedListService!.subList(name, from, to);
      },
      addItemListener: async (name, includeValue, correlationId, session) =>
        this._registerClientListListener(name, includeValue, correlationId, session),
      removeItemListener: async (registrationId, session) =>
        this._removeClientListListener(session.getSessionId(), registrationId),
      isEmpty: async (name) => {
        this._ensureListService();
        return this._distributedListService!.isEmpty(name);
      },
      removeAll: async (name, values) => {
        this._ensureListService();
        const previous = await this._distributedListService!.toArray(name);
        const fingerprints = new Set(values.map(clientDataFingerprint));
        const survivors = previous.filter((value) => !fingerprints.has(clientDataFingerprint(value)));
        const changed = survivors.length !== previous.length;
        if (changed) {
          await this._distributedListService!.clear(name);
          if (survivors.length > 0) {
            await this._distributedListService!.addAll(name, survivors);
          }
        }
        return changed;
      },
      retainAll: async (name, values) => {
        this._ensureListService();
        const previous = await this._distributedListService!.toArray(name);
        const fingerprints = new Set(values.map(clientDataFingerprint));
        const survivors = previous.filter((value) => fingerprints.has(clientDataFingerprint(value)));
        const changed = survivors.length !== previous.length;
        if (changed) {
          await this._distributedListService!.clear(name);
          if (survivors.length > 0) {
            await this._distributedListService!.addAll(name, survivors);
          }
        }
        return changed;
      },
    };

    const setOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SetServiceOperations = {
      add: async (name, value) => {
        this._ensureSetService();
        const added = await this._distributedSetService!.add(name, value);
        return added;
      },
      remove: async (name, value) => {
        this._ensureSetService();
        const removed = await this._distributedSetService!.remove(name, value);
        return removed;
      },
      size: async (name) => {
        this._ensureSetService();
        return this._distributedSetService!.size(name);
      },
      contains: async (name, value) => {
        this._ensureSetService();
        return this._distributedSetService!.contains(name, value);
      },
      containsAll: async (name, values) => {
        this._ensureSetService();
        return this._distributedSetService!.containsAll(name, values);
      },
      addAll: async (name, values) => {
        this._ensureSetService();
        return this._distributedSetService!.addAll(name, values);
      },
      removeAll: async (name, values) => {
        this._ensureSetService();
        return this._distributedSetService!.removeAll(name, values);
      },
      retainAll: async (name, values) => {
        this._ensureSetService();
        return this._distributedSetService!.retainAll(name, values);
      },
      clear: async (name) => {
        this._ensureSetService();
        await this._distributedSetService!.clear(name);
      },
      iterator: async (name) => {
        this._ensureSetService();
        return this._distributedSetService!.toArray(name);
      },
      isEmpty: async (name) => {
        this._ensureSetService();
        return this._distributedSetService!.isEmpty(name);
      },
      addItemListener: async (name, includeValue, correlationId, session) =>
        this._registerClientSetListener(name, includeValue, correlationId, session),
      removeItemListener: async (registrationId, session) =>
        this._removeClientSetListener(session.getSessionId(), registrationId),
    };

    const multiMapOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').MultiMapServiceOperations = {
      put: async (name, key, value) => {
        this._ensureMultiMapService();
        const added = await this._distributedMultiMapService!.put(name, key, value);
        return added;
      },
      get: async (name, key) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.get(name, key);
      },
      remove: async (name, key) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.removeAll(name, key);
      },
      removeEntry: async (name, key, value) => {
        this._ensureMultiMapService();
        const removed = await this._distributedMultiMapService!.remove(name, key, value);
        return removed;
      },
      size: async (name) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.size(name);
      },
      containsKey: async (name, key) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.containsKey(name, key);
      },
      containsValue: async (name, value) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.containsValue(name, value);
      },
      containsEntry: async (name, key, value) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.containsEntry(name, key, value);
      },
      clear: async (name) => {
        this._ensureMultiMapService();
        await this._distributedMultiMapService!.clear(name);
      },
      keySet: async (name) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.keySet(name);
      },
      values: async (name) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.values(name);
      },
      entrySet: async (name) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.entrySet(name);
      },
      valueCount: async (name, key) => {
        this._ensureMultiMapService();
        return this._distributedMultiMapService!.valueCount(name, key);
      },
      lock: async (name, key) => {
        this._getOrCreateProxy(`__hz_multimap_lock__:${name}`).lock(getKeyObject(key));
      },
      unlock: async (name, key) => {
        this._getOrCreateProxy(`__hz_multimap_lock__:${name}`).unlock(getKeyObject(key));
      },
      tryLock: async (name, key) => {
        return this._getOrCreateProxy(`__hz_multimap_lock__:${name}`).tryLock(getKeyObject(key));
      },
      isLocked: async (name, key) => {
        return this._getOrCreateProxy(`__hz_multimap_lock__:${name}`).isLocked(getKeyObject(key));
      },
      forceUnlock: async (name, key) => {
        this._getOrCreateProxy(`__hz_multimap_lock__:${name}`).unlock(getKeyObject(key));
      },
      addEntryListener: async (name, includeValue, _localOnly, correlationId, session) =>
        this._registerClientMultiMapListener(name, includeValue, correlationId, session),
      removeEntryListener: async (registrationId, session) =>
        this._removeClientMultiMapListener(session.getSessionId(), registrationId),
      putAll: async (name, key, values) => {
        this._ensureMultiMapService();
        for (const value of values) {
          await this._distributedMultiMapService!.put(name, key, value);
        }
      },
    };

    const replicatedMapOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').ReplicatedMapServiceOperations = {
      put: async (name, key, value) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.put(name, key, value);
      },
      get: async (name, key) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.get(name, key);
      },
      remove: async (name, key) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.remove(name, key);
      },
      size: async (name) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.size(name);
      },
      containsKey: async (name, key) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.containsKey(name, key);
      },
      containsValue: async (name, value) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.containsValue(name, value);
      },
      clear: async (name) => {
        this._ensureReplicatedMapService();
        this._distributedReplicatedMapService!.clear(name);
      },
      keySet: async (name) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.keySet(name);
      },
      values: async (name) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.values(name);
      },
      entrySet: async (name) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.entrySet(name);
      },
      putAll: async (name, entries) => {
        this._ensureReplicatedMapService();
        this._distributedReplicatedMapService!.putAll(name, entries);
      },
      isEmpty: async (name) => {
        this._ensureReplicatedMapService();
        return this._distributedReplicatedMapService!.isEmpty(name);
      },
      addEntryListener: async (name, correlationId, session) =>
        this._registerClientReplicatedMapListener(name, correlationId, session),
      removeEntryListener: async (registrationId, session) =>
        this._removeClientReplicatedMapListener(session.getSessionId(), registrationId),
      addEntryListenerWithKey: async (name, key, correlationId, session) =>
        this._registerClientReplicatedMapListener(
          name,
          correlationId,
          session,
          (eventKey: Data | null) => eventKey === null || eventKey.equals(key),
        ),
      addEntryListenerWithPredicate: async (name, predicateData, correlationId, session) => {
        const predicate = deserializePredicate(predicateData);
        return this._registerClientReplicatedMapListener(
          name,
          correlationId,
          session,
          (eventKey: Data | null, eventValue: Data | null, eventOldValue: Data | null) => {
            if (eventKey === null) {
              return true;
            }
            const candidateValue = eventValue ?? eventOldValue;
            return candidateValue !== null && predicateMatches(predicate, eventKey, candidateValue);
          },
        );
      },
      addEntryListenerWithKeyAndPredicate: async (name, key, predicateData, correlationId, session) => {
        const predicate = deserializePredicate(predicateData);
        return this._registerClientReplicatedMapListener(
          name,
          correlationId,
          session,
          (eventKey: Data | null, eventValue: Data | null, eventOldValue: Data | null) => {
            if (eventKey === null) {
              return true;
            }
            if (!eventKey.equals(key)) {
              return false;
            }
            const candidateValue = eventValue ?? eventOldValue;
            return candidateValue !== null && predicateMatches(predicate, eventKey, candidateValue);
          },
        );
      },
    };

    const ringbufferOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').RingbufferServiceOperations = {
      capacity: async (name) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.capacity(name));
      },
      size: async (name) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.size(name));
      },
      tailSequence: async (name) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.tailSequence(name));
      },
      headSequence: async (name) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.headSequence(name));
      },
      remainingCapacity: async (name) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.remainingCapacity(name));
      },
      add: async (name, overflowPolicy, value) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.add(name, value, overflowPolicy));
      },
      addAll: async (name, values, overflowPolicy) => {
        this._ensureRingbufferService();
        return BigInt(await this._distributedRingbufferService!.addAll(name, values, overflowPolicy));
      },
      readOne: async (name, sequence) => {
        this._ensureRingbufferService();
        return this._distributedRingbufferService!.readOne(name, Number(sequence));
      },
      readMany: async (name, startSequence, minCount, maxCount, filter) => {
        this._ensureRingbufferService();
        const effectiveStartSequence = Math.max(
          Number(startSequence),
          await this._distributedRingbufferService!.headSequence(name),
        );
        const items = await this._distributedRingbufferService!.readMany(
          name,
          Number(startSequence),
          minCount,
          maxCount,
          filter,
        );
        const readCount = items.length;
        return {
          readCount,
          items,
          itemSeqs: Array.from({ length: readCount }, (_, index) => BigInt(effectiveStartSequence + index)),
          nextSeq: BigInt(effectiveStartSequence + readCount),
        };
      },
    };

    const cacheOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').CacheServiceOperations = {
      get: async (name, key) => {
        this._ensureCacheService();
        return this._distributedCacheService!.get(name, key);
      },
      put: async (name, key, value, _expiryPolicy, isGet) => {
        this._ensureCacheService();
        if (isGet) {
          return this._distributedCacheService!.getAndPut(name, key, value);
        }
        await this._distributedCacheService!.put(name, key, value);
        return null;
      },
      remove: async (name, key, currentValue) => {
        this._ensureCacheService();
        if (currentValue === null) {
          return this._distributedCacheService!.remove(name, key);
        }
        const existing = await this._distributedCacheService!.get(name, key);
        if (existing === null || !existing.equals(currentValue)) {
          return false;
        }
        return this._distributedCacheService!.remove(name, key);
      },
      size: async (name) => {
        this._ensureCacheService();
        return this._distributedCacheService!.size(name);
      },
      clear: async (name) => {
        this._ensureCacheService();
        await this._distributedCacheService!.clear(name);
      },
      containsKey: async (name, key) => {
        this._ensureCacheService();
        return this._distributedCacheService!.containsKey(name, key);
      },
      getAndPut: async (name, key, value) => {
        this._ensureCacheService();
        return this._distributedCacheService!.getAndPut(name, key, value);
      },
      getAndRemove: async (name, key) => {
        this._ensureCacheService();
        return this._distributedCacheService!.getAndRemove(name, key);
      },
      getAndReplace: async (name, key, value) => {
        this._ensureCacheService();
        return this._distributedCacheService!.getAndReplace(name, key, value);
      },
      putIfAbsent: async (name, key, value) => {
        this._ensureCacheService();
        return this._distributedCacheService!.putIfAbsent(name, key, value);
      },
      replace: async (name, key, oldValue, newValue) => {
        this._ensureCacheService();
        if (oldValue === null) {
          return this._distributedCacheService!.replace(name, key, newValue);
        }
        const existing = await this._distributedCacheService!.get(name, key);
        if (existing === null || !existing.equals(oldValue)) {
          return false;
        }
        return this._distributedCacheService!.replace(name, key, newValue);
      },
      getAll: async (name, keys) => {
        this._ensureCacheService();
        return this._distributedCacheService!.getAll(name, keys);
      },
      putAll: async (name, entries) => {
        this._ensureCacheService();
        await this._distributedCacheService!.putAll(name, entries);
      },
      removeAll: async (name, keys) => {
        this._ensureCacheService();
        await this._distributedCacheService!.removeAll(name, keys ?? undefined);
      },
      destroy: async (name) => {
        this._ensureCacheService();
        this._distributedCacheService!.destroy(name);
      },
      addInvalidationListener: async (name, _localOnly, session) => this._registerClientCacheInvalidationListener(name, session),
      removeInvalidationListener: async (registrationId, session) =>
        this._removeClientCacheInvalidationListener(session.getSessionId(), registrationId),
    };

    const transactionOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').TransactionServiceOperations = {
      create: async (timeoutMs, durability, transactionType, threadId) =>
        this._createClientTransaction(timeoutMs, durability, transactionType, threadId),
      commit: async (txId) => {
        try {
          await this._transactionCoordinator.commitTransaction(txId);
        } finally {
          this._clientTransactions.delete(txId);
        }
      },
      rollback: async (txId) => {
        try {
          await this._transactionCoordinator.rollbackTransaction(txId);
        } finally {
          this._clientTransactions.delete(txId);
        }
      },
      mapGet: async (txId, name, key) => this._toClientData(this._getTransactionalMap(txId, name).get(key)),
      mapPut: async (txId, name, key, value) => this._toClientData(this._getTransactionalMap(txId, name).put(key, value)),
      mapSet: async (txId, name, key, value) => {
        this._getTransactionalMap(txId, name).set(key, value);
      },
      mapPutIfAbsent: async (txId, name, key, value) => this._toClientData(this._getTransactionalMap(txId, name).putIfAbsent(key, value)),
      mapRemove: async (txId, name, key) => this._toClientData(this._getTransactionalMap(txId, name).remove(key)),
      mapDelete: async (txId, name, key) => {
        this._getTransactionalMap(txId, name).delete(key);
      },
      mapKeySet: async (txId, name) => this._toClientDataList([...this._getTransactionalMap(txId, name).keySet()]),
      mapValues: async (txId, name) => this._toClientDataList(this._getTransactionalMap(txId, name).values()),
      queueOffer: async (txId, name, value) => this._getTransactionalQueue(txId, name).offer(value),
      queuePoll: async (txId, name) => this._toClientData(await this._getTransactionalQueue(txId, name).poll()),
      queuePeek: async (txId, name) => this._toClientData(await this._getTransactionalQueue(txId, name).peek()),
      queueSize: async (txId, name) => this._getTransactionalQueue(txId, name).size(),
      listAdd: async (txId, name, value) => this._getTransactionalList(txId, name).add(value),
      listRemove: async (txId, name, value) => this._getTransactionalList(txId, name).remove(value),
      listSize: async (txId, name) => this._getTransactionalList(txId, name).size(),
      listGet: async (txId, name, index) => this._toClientData(await this._getTransactionalList(txId, name).get(index)),
      listSet: async (txId, name, index, value) => this._toClientData(await this._getTransactionalList(txId, name).set(index, value)),
      setAdd: async (txId, name, value) => this._getTransactionalSet(txId, name).add(value),
      setRemove: async (txId, name, value) => this._getTransactionalSet(txId, name).remove(value),
      setSize: async (txId, name) => this._getTransactionalSet(txId, name).size(),
      multimapPut: async (txId, name, key, value) => this._getTransactionalMultiMap(txId, name).put(key, value),
      multimapRemove: async (txId, name, key, value) => this._getTransactionalMultiMap(txId, name).remove(key, value),
      multimapGet: async (txId, name, key) => this._toClientDataList(await this._getTransactionalMultiMap(txId, name).get(key)),
      multimapValueCount: async (txId, name, key) => this._getTransactionalMultiMap(txId, name).valueCount(key),
      multimapSize: async (txId, name) => this._getTransactionalMultiMap(txId, name).size(),
    };

    const sqlOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlServiceOperations = {
      execute: async (sql, params, timeoutMs, cursorBufferSize, partitionArgumentIndex, queryId, returnRawResult, schema, expectedResultType) =>
        this._executeClientSql(sql, params, timeoutMs, cursorBufferSize, partitionArgumentIndex, queryId, returnRawResult, schema, expectedResultType),
      fetch: async (queryId, cursorBufferSize) =>
        this._fetchClientSql(queryId, cursorBufferSize),
      close: async (queryId) =>
        this._closeClientSql(queryId),
    };

    const executorOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').ExecutorServiceOperations = {
      shutdown: async (name) => {
        const { container, proxy } = this._getOrCreateExecutorRuntime(name);
        await container.shutdown();
        await proxy.shutdown();
      },
      isShutdown: async (name) => this._getOrCreateExecutorRuntime(name).container.isShutdown(),
      cancelOnPartition: async (uuid, partitionId, interrupt) =>
        this._cancelClientExecutorTaskOnPartition(uuid, partitionId, interrupt),
      cancelOnMember: async (uuid, memberUuid, interrupt) =>
        this._cancelClientExecutorTaskOnMember(uuid, memberUuid, interrupt),
      submitToPartition: async (name, uuid, callable, partitionId) =>
        this._submitClientExecutorTaskToPartition(name, uuid, callable, partitionId),
      submitToMember: async (name, uuid, callable, memberUuid) =>
        this._submitClientExecutorTaskToMember(name, uuid, callable, memberUuid),
    };

    const atomicLongOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').AtomicLongOperations = {
      get: async (name) => this._getOrCreateAtomicLongService().get(name),
      set: async (name, value) => this._getOrCreateAtomicLongService().set(name, value),
      getAndSet: async (name, value) => this._getOrCreateAtomicLongService().getAndSet(name, value),
      addAndGet: async (name, delta) => this._getOrCreateAtomicLongService().addAndGet(name, delta),
      getAndAdd: async (name, delta) => this._getOrCreateAtomicLongService().getAndAdd(name, delta),
      compareAndSet: async (name, expect, update) => this._getOrCreateAtomicLongService().compareAndSet(name, expect, update),
      incrementAndGet: async (name) => this._getOrCreateAtomicLongService().incrementAndGet(name),
      getAndIncrement: async (name) => this._getOrCreateAtomicLongService().getAndIncrement(name),
      decrementAndGet: async (name) => this._getOrCreateAtomicLongService().decrementAndGet(name),
      getAndDecrement: async (name) => this._getOrCreateAtomicLongService().getAndDecrement(name),
      apply: async (name, functionData) => {
        const result = await this._getOrCreateAtomicLongService().apply(name, this._deserializeAtomicLongFunction(functionData));
        return this._toClientData(result);
      },
      alter: async (name, functionData) => {
        await this._getOrCreateAtomicLongService().alter(name, (value) => this._coerceBigInt(this._deserializeAtomicLongFunction(functionData)(value)));
      },
      alterAndGet: async (name, functionData) =>
        this._getOrCreateAtomicLongService().alterAndGet(name, (value) => this._coerceBigInt(this._deserializeAtomicLongFunction(functionData)(value))),
      getAndAlter: async (name, functionData) =>
        this._getOrCreateAtomicLongService().getAndAlter(name, (value) => this._coerceBigInt(this._deserializeAtomicLongFunction(functionData)(value))),
    };

    const atomicRefOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').AtomicRefOperations = {
      get: async (name) => this._toClientData(await this._getOrCreateAtomicReferenceService().get(name)),
      set: async (name, value) => this._getOrCreateAtomicReferenceService().set(name, this._fromNullableClientData(value)),
      compareAndSet: async (name, expected, updated) =>
        this._getOrCreateAtomicReferenceService().compareAndSet(
          name,
          this._fromNullableClientData(expected),
          this._fromNullableClientData(updated),
        ),
      isNull: async (name) => this._getOrCreateAtomicReferenceService().isNull(name),
      clear: async (name) => this._getOrCreateAtomicReferenceService().clear(name),
      contains: async (name, value) => this._getOrCreateAtomicReferenceService().contains(name, this._fromNullableClientData(value)),
      apply: async (name, functionData) =>
        this._toClientData(await this._getOrCreateAtomicReferenceService().apply(name, this._deserializeAtomicReferenceFunction(functionData))),
      alter: async (name, functionData) => {
        await this._getOrCreateAtomicReferenceService().alter(name, this._deserializeAtomicReferenceFunction(functionData));
      },
      alterAndGet: async (name, functionData) =>
        this._toClientData(await this._getOrCreateAtomicReferenceService().alterAndGet(name, this._deserializeAtomicReferenceFunction(functionData))),
      getAndAlter: async (name, functionData) =>
        this._toClientData(await this._getOrCreateAtomicReferenceService().getAndAlter(name, this._deserializeAtomicReferenceFunction(functionData))),
    };

    const countDownLatchOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').CountDownLatchOperations = {
      trySetCount: async (name, count) => this._getOrCreateCountDownLatchService().trySetCount(name, count),
      await: async (name, timeoutMs) => this._getOrCreateCountDownLatchService().await(name, this._toOptionalTimeoutMs(timeoutMs)),
      countDown: async (name, expectedRound, invocationUuid) => this._getOrCreateCountDownLatchService().countDown(name, expectedRound, invocationUuid),
      getCount: async (name) => this._getOrCreateCountDownLatchService().getCount(name),
      getRound: async (name) => this._getOrCreateCountDownLatchService().getRound(name),
    };

    const semaphoreOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SemaphoreOperations = {
      init: async (name, permits) => this._getOrCreateSemaphoreService().init(name, permits),
      acquire: async (name, sessionId, _threadId, invocationUuid, permits, timeoutMs) =>
        this._getOrCreateSemaphoreService().acquire(
          name,
          permits,
          this._toOptionalCpSessionId(sessionId),
          invocationUuid,
          this._toOptionalTimeoutMs(timeoutMs),
        ),
      release: async (name, sessionId, _threadId, invocationUuid, permits) =>
        this._getOrCreateSemaphoreService().release(name, permits, this._toOptionalCpSessionId(sessionId), invocationUuid),
      drain: async (name, sessionId, _threadId, invocationUuid) =>
        this._getOrCreateSemaphoreService().drain(name, this._toOptionalCpSessionId(sessionId), invocationUuid),
      change: async (name, _sessionId, _threadId, invocationUuid, permits) =>
        this._getOrCreateSemaphoreService().change(name, permits, invocationUuid),
      availablePermits: async (name) => this._getOrCreateSemaphoreService().availablePermits(name),
      isJdkCompatible: async (_name) => false,
    };

    const cpGroupOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').CpGroupOperations = {
      createCPGroup: async (proxyName) => this._createClientCpGroup(proxyName),
      destroyCPObject: async (groupName, serviceName, objectName) => {
        this._destroyClientCpObject(groupName, serviceName, objectName);
      },
    };

    const cpSessionOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').CpSessionOperations = {
      createSession: async (groupName, endpointName) => {
        this._getOrCreateCpSubsystemService().getOrCreateGroup(groupName);
        const session = this._getOrCreateCpSubsystemService().createSession(endpointName);
        return {
          sessionId: BigInt(session.sessionId),
          ttlMillis: BigInt(this._getOrCreateCpSubsystemService().getSessionTtlMs()),
          heartbeatMillis: BigInt(this._getOrCreateCpSubsystemService().getSessionHeartbeatIntervalMs()),
        };
      },
      closeSession: async (_groupName, sessionId) => this._getOrCreateCpSubsystemService().closeSession(String(sessionId)),
      heartbeatSession: async (_groupName, sessionId) => {
        this._getOrCreateCpSubsystemService().heartbeatSession(String(sessionId));
      },
      generateThreadId: async (_groupName) => this._getOrCreateCpSubsystemService().createThreadId(),
    };

    const flakeIdOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').FlakeIdGeneratorOperations = {
      newIdBatch: async (name, batchSize) => this._getOrCreateFlakeIdGeneratorService().newBatch(name, batchSize),
    };

    const pnCounterOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').PnCounterOperations = {
      get: async (name) => ({
        value: this._getOrCreatePnCounterService().get(name),
        replicaTimestamps: this._getPnCounterReplicaTimestamps(name),
      }),
      add: async (name, delta, getBeforeUpdate) => ({
        value: getBeforeUpdate
          ? this._getOrCreatePnCounterService().getAndAdd(name, delta)
          : this._getOrCreatePnCounterService().addAndGet(name, delta),
        replicaTimestamps: this._getPnCounterReplicaTimestamps(name),
      }),
      getConfiguredReplicaCount: async () => this._getOrCreatePnCounterService().getReplicaCount(),
    };

    const cardinalityOps: import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').CardinalityEstimatorOperations = {
      add: async (name, item) => {
        this._getOrCreateCardinalityEstimatorService().add(name, item.hashCode() >>> 0);
      },
      estimate: async (name) => BigInt(this._getOrCreateCardinalityEstimatorService().estimateGlobal(name)),
    };

    // ── TopologyPublisher ─────────────────────────────────────────────────
    const topologyPublisher = new TopologyPublisher(srv.getSessionRegistry());
    topologyPublisher.start();
    this._topologyPublisher = topologyPublisher;
    this._publishClientTopology();

    // Wire session close handler to clean up topology subscriptions
    srv.setSessionCloseHandler((session) => {
      topologyPublisher.onSessionClosed(session.getSessionId());
      this._removeClientTopicListenersForSession(session.getSessionId());
      this._removeClientMapListenersForSession(session.getSessionId());
      this._removeClientQueueListenersForSession(session.getSessionId());
      this._removeClientListListenersForSession(session.getSessionId());
      this._removeClientSetListenersForSession(session.getSessionId());
      this._removeClientMultiMapListenersForSession(session.getSessionId());
      this._removeClientReplicatedMapListenersForSession(session.getSessionId());
      this._removeClientCacheInvalidationListenersForSession(session.getSessionId());
      this._nearCacheInvalidationManager.removeSession(session.getSessionId());
    });

    // ── Wire all handlers ─────────────────────────────────────────────────
    registerAllHandlers({
      dispatcher: srv.getDispatcher(),
      topologyPublisher,
      schemaService: this._ss.schemaService,
      localMemberUuid: this.getLocalMemberId(),
      map: trackClientProtocolOperations(mapOps),
      queue: trackClientProtocolOperations(queueOps),
      topic: trackClientProtocolOperations(topicOps),
      list: trackClientProtocolOperations(listOps),
      set: trackClientProtocolOperations(setOps),
      multiMap: trackClientProtocolOperations(multiMapOps),
      replicatedMap: trackClientProtocolOperations(replicatedMapOps),
      ringbuffer: trackClientProtocolOperations(ringbufferOps),
      cache: trackClientProtocolOperations(cacheOps),
      transaction: trackClientProtocolOperations(transactionOps),
      sql: trackClientProtocolOperations(sqlOps),
      executor: trackClientProtocolOperations(executorOps),
      cpGroup: trackClientProtocolOperations(cpGroupOps),
      cpSession: trackClientProtocolOperations(cpSessionOps),
      atomicLong: trackClientProtocolOperations(atomicLongOps),
      atomicRef: trackClientProtocolOperations(atomicRefOps),
      countDownLatch: trackClientProtocolOperations(countDownLatchOps),
      semaphore: trackClientProtocolOperations(semaphoreOps),
      flakeIdGenerator: trackClientProtocolOperations(flakeIdOps),
      pnCounter: trackClientProtocolOperations(pnCounterOps),
      cardinalityEstimator: trackClientProtocolOperations(cardinalityOps),
      invalidationManager: this._nearCacheInvalidationManager,
      sessionRegistry: srv.getSessionRegistry(),
    });
  }

  private _createClientTransaction(
    timeoutMs: bigint,
    durability: number,
    transactionType: number,
    threadId: bigint,
  ): Promise<string> {
    const options = new TransactionOptions()
      .setTimeout(Number(timeoutMs))
      .setDurability(durability)
      .setTransactionType(TransactionType.getById(transactionType));
    const tx = this._transactionCoordinator.newTransaction(
      options,
      `client-thread:${threadId.toString()}`,
    );

    return this._transactionCoordinator.beginTransaction(tx).then(() => {
      this._clientTransactions.set(tx.getTxnId(), {
        transaction: tx,
        mapProxies: new Map(),
        queueProxies: new Map(),
        listProxies: new Map(),
        setProxies: new Map(),
        multiMapProxies: new Map(),
      });
      return tx.getTxnId();
    });
  }

  private _getClientTransactionContext(txId: string): ClientTransactionContext {
    const context = this._clientTransactions.get(txId);
    if (context === undefined) {
      throw new TransactionException(`No active transaction found with id: ${txId}`);
    }
    return context;
  }

  private _toClientData(value: unknown): Data | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (
      typeof value === 'object'
      && typeof (value as { toByteArray?: unknown }).toByteArray === 'function'
      && typeof (value as { equals?: unknown }).equals === 'function'
    ) {
      return value as Data;
    }
    return this._ss.toData(value);
  }

  private _fromNullableClientData(value: Data | null): unknown | null {
    if (value === null) {
      return null;
    }
    const decoded = this._ss.toObject(value);
    return decoded ?? null;
  }

  private _toClientDataList(values: Iterable<unknown>): Data[] {
    const items: Data[] = [];
    for (const value of values) {
      const data = this._toClientData(value);
      if (data !== null) {
        items.push(data);
      }
    }
    return items;
  }

  private _getOrCreateSqlService(): SqlService {
    if (this._sqlService === null) {
      this._sqlService = new SqlService(this._nodeEngine, this._mapService);
    }
    return this._sqlService;
  }

  private _getOrCreateCpSubsystemService(): CpSubsystemService {
    if (this._cpSubsystemService === null) {
      this._cpSubsystemService = new CpSubsystemService(this.getLocalMemberId());
      this._nodeEngine.registerService(CpSubsystemService.SERVICE_NAME, this._cpSubsystemService);
    }
    return this._cpSubsystemService;
  }

  private _getOrCreatePnCounterService(): PNCounterService {
    if (this._pnCounterService === null) {
      this._pnCounterService = new PNCounterService(this._getClientProtocolReplicaId());
      this._nodeEngine.registerService(PNCounterService.SERVICE_NAME, this._pnCounterService);
    }
    return this._pnCounterService;
  }

  private _getOrCreateFlakeIdGeneratorService(): FlakeIdGeneratorService {
    if (this._flakeIdGeneratorService === null) {
      this._flakeIdGeneratorService = new FlakeIdGeneratorService(this._computeStableNodeNumber(this.getLocalMemberId()));
      this._nodeEngine.registerService(FlakeIdGeneratorService.SERVICE_NAME, this._flakeIdGeneratorService);
    }
    return this._flakeIdGeneratorService;
  }

  private _getOrCreateCardinalityEstimatorService(): DistributedCardinalityEstimatorService {
    if (this._cardinalityEstimatorService === null) {
      this._cardinalityEstimatorService = new DistributedCardinalityEstimatorService();
      this._nodeEngine.registerService(DistributedCardinalityEstimatorService.SERVICE_NAME, this._cardinalityEstimatorService);
    }
    return this._cardinalityEstimatorService;
  }

  private _getPnCounterReplicaTimestamps(name: string): Array<[string, bigint]> {
    return Array.from(
      this._getOrCreatePnCounterService().getReplicaTimestampVector(name).timestamps,
      ([replicaId, timestamp]) => [replicaId, BigInt(timestamp)],
    );
  }

  private _computeStableNodeNumber(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash * 31) + value.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }

  private _getClientProtocolReplicaId(): string {
    const memberId = this.getLocalMemberId();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
      return memberId;
    }

    const hex = this._computeStableUuidHex(memberId);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  private _computeStableUuidHex(value: string): string {
    let hi = 0x811c9dc5;
    let lo = 0x01000193;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      hi = Math.imul(hi ^ code, 16777619) >>> 0;
      lo = Math.imul(lo ^ ((code << 8) | code), 16777619) >>> 0;
    }

    const part1 = hi.toString(16).padStart(8, '0');
    const part2 = lo.toString(16).padStart(8, '0');
    const part3 = (hi ^ lo).toString(16).padStart(8, '0');
    const part4 = Math.imul(hi, 31).toString(16).padStart(8, '0');
    return `${part1}${part2}${part3}${part4}`.slice(0, 32);
  }

  private _getOrCreateAtomicLongService(): AtomicLongService {
    if (this._atomicLongService === null) {
      this._atomicLongService = new AtomicLongService(this._getOrCreateCpSubsystemService());
      this._nodeEngine.registerService(AtomicLongService.SERVICE_NAME, this._atomicLongService);
    }
    return this._atomicLongService;
  }

  private _getOrCreateAtomicReferenceService(): AtomicReferenceService {
    if (this._atomicReferenceService === null) {
      this._atomicReferenceService = new AtomicReferenceService(this._getOrCreateCpSubsystemService());
      this._nodeEngine.registerService(AtomicReferenceService.SERVICE_NAME, this._atomicReferenceService);
    }
    return this._atomicReferenceService;
  }

  private _getOrCreateCountDownLatchService(): CountDownLatchService {
    if (this._countDownLatchService === null) {
      this._countDownLatchService = new CountDownLatchService(this._getOrCreateCpSubsystemService());
      this._nodeEngine.registerService(CountDownLatchService.SERVICE_NAME, this._countDownLatchService);
    }
    return this._countDownLatchService;
  }

  private _getOrCreateSemaphoreService(): SemaphoreService {
    if (this._semaphoreService === null) {
      this._semaphoreService = new SemaphoreService(this._getOrCreateCpSubsystemService());
      this._nodeEngine.registerService(SemaphoreService.SERVICE_NAME, this._semaphoreService);
    }
    return this._semaphoreService;
  }

  private _toOptionalTimeoutMs(timeoutMs: bigint): number | undefined {
    if (timeoutMs < 0n || timeoutMs > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return Number(timeoutMs);
  }

  private _toOptionalCpSessionId(sessionId: bigint): string | null {
    return sessionId >= 0n ? sessionId.toString() : null;
  }

  private _coerceBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string') {
      return BigInt(value);
    }
    throw new Error('AtomicLong function result must be coercible to bigint');
  }

  private _deserializeAtomicLongFunction(functionData: Data): (value: bigint) => unknown {
    const candidate = this._ss.toObject<unknown>(functionData);
    if (candidate !== null && typeof (candidate as { apply?: unknown }).apply === 'function') {
      return (value: bigint) => (candidate as { apply(input: bigint): unknown }).apply(value);
    }
    if (typeof candidate === 'string') {
      switch (candidate) {
        case 'increment':
          return (value: bigint) => value + 1n;
        case 'decrement':
          return (value: bigint) => value - 1n;
        case 'negate':
          return (value: bigint) => -value;
        case 'identity':
          return (value: bigint) => value;
      }
    }
    if (candidate !== null && typeof candidate === 'object' && 'type' in candidate) {
      const descriptor = candidate as { type: string; delta?: string | number | bigint; value?: string | number | bigint };
      switch (descriptor.type) {
        case 'add':
          return (value: bigint) => value + this._coerceBigInt(descriptor.delta ?? 0n);
        case 'set':
          return () => this._coerceBigInt(descriptor.value ?? 0n);
      }
    }
    throw new Error('AtomicLong function payload is not a supported callable descriptor');
  }

  private _deserializeAtomicReferenceFunction(functionData: Data): (value: unknown | null) => unknown {
    const candidate = this._ss.toObject<unknown>(functionData);
    if (candidate !== null && typeof (candidate as { apply?: unknown }).apply === 'function') {
      return (value: unknown | null) => (candidate as { apply(input: unknown | null): unknown }).apply(value);
    }
    if (candidate !== null && typeof candidate === 'object' && 'type' in candidate) {
      const descriptor = candidate as { type: string; value?: unknown };
      switch (descriptor.type) {
        case 'identity':
          return (value: unknown | null) => value;
        case 'clear':
          return () => null;
        case 'set':
          return () => descriptor.value ?? null;
      }
    }
    throw new Error('AtomicReference function payload is not a supported callable descriptor');
  }

  private _createClientCpGroup(proxyName: string): { name: string; seed: bigint; id: bigint } {
    const normalizedName = proxyName.trim();
    const separatorIndex = normalizedName.indexOf('@');
    const groupName = separatorIndex >= 0 ? normalizedName.slice(separatorIndex + 1).trim() : 'default';
    const effectiveGroupName = groupName.length > 0 ? groupName : 'default';
    this._getOrCreateCpSubsystemService().getOrCreateGroup(effectiveGroupName);
    return {
      name: effectiveGroupName,
      seed: 0n,
      id: 0n,
    };
  }

  private _toScopedCpObjectName(groupName: string, objectName: string): string {
    const effectiveGroupName = groupName.length > 0 ? groupName : 'default';
    return effectiveGroupName === 'default' ? objectName : `${objectName}@${effectiveGroupName}`;
  }

  private _destroyClientCpObject(groupName: string, serviceName: string, objectName: string): void {
    const effectiveGroupName = groupName.length > 0 ? groupName : 'default';
    const scopedObjectName = this._toScopedCpObjectName(effectiveGroupName, objectName);
    switch (serviceName) {
      case 'hz:raft:atomicLongService':
        this._getOrCreateAtomicLongService().destroy(scopedObjectName);
        return;
      case 'hz:raft:atomicRefService':
        this._getOrCreateAtomicReferenceService().destroy(scopedObjectName);
        return;
      case 'hz:raft:countDownLatchService':
        this._getOrCreateCountDownLatchService().destroy(scopedObjectName);
        return;
      case 'hz:raft:semaphoreService':
        this._getOrCreateSemaphoreService().destroy(scopedObjectName);
        return;
      default:
        this._getOrCreateCpSubsystemService().destroyGroup(effectiveGroupName);
    }
  }

  private _clientSqlQueryKey(queryId: ClientSqlQueryId): string {
    return `${queryId.localHigh}:${queryId.localLow}:${queryId.globalHigh}:${queryId.globalLow}`;
  }

  private _encodeSqlCell(value: unknown): Data {
    return this._ss.toData(value) ?? this._ss.toData(null) as Data;
  }

  private _mapSqlColumnType(type: SqlColumnType): number {
    switch (type) {
      case 'VARCHAR':
        return 0;
      case 'BOOLEAN':
        return 1;
      case 'TINYINT':
        return 2;
      case 'SMALLINT':
        return 3;
      case 'INTEGER':
        return 4;
      case 'BIGINT':
        return 5;
      case 'DECIMAL':
        return 6;
      case 'REAL':
        return 7;
      case 'DOUBLE':
        return 8;
      case 'DATE':
        return 9;
      case 'TIME':
        return 10;
      case 'TIMESTAMP':
        return 11;
      case 'TIMESTAMP_WITH_TIME_ZONE':
        return 12;
      case 'OBJECT':
        return 13;
      case 'NULL':
        return 14;
      default:
        return 13;
    }
  }

  private _toProtocolSqlMetadata(
    result: SqlResult,
  ): import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlColumnMetadata[] {
    return result.getRowMetadata().getColumns().map((column) => ({
      name: column.name,
      type: this._mapSqlColumnType(column.type),
      nullable: column.nullable,
      nullableIsSet: true,
    }));
  }

  private _toProtocolSqlPage(
    result: SqlResult,
    pageSize: number,
  ): import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlPage {
    const columns = result.getRowMetadata().getColumns();
    const rows = result.fetchPage(pageSize > 0 ? pageSize : 4096);
    const columnData = columns.map(() => [] as Data[]);

    for (const row of rows) {
      columns.forEach((column, index) => {
        columnData[index].push(this._encodeSqlCell(row[column.name]));
      });
    }

    return {
      columnTypes: columns.map((column) => this._mapSqlColumnType(column.type)),
      columns: columnData,
      last: !result.hasMoreRows(),
    };
  }

  private _toProtocolSqlError(
    error: unknown,
  ): import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlError {
    const message = error instanceof Error ? error.message : String(error);
    let code = -1;
    if (error instanceof SqlStatementParseError) {
      code = 1008;
    } else if (error instanceof SqlTimeoutError) {
      code = 1004;
    }

    return {
      code,
      message,
      originatingMemberId: this.getCluster().getLocalMember().getUuid(),
      suggestion: null,
    };
  }

  private _closeStoredClientSqlResult(queryKey: string): void {
    const existing = this._clientSqlResults.get(queryKey);
    if (existing !== undefined) {
      this._clientSqlResults.delete(queryKey);
      existing.close();
    }
  }

  private _executeClientSql(
    sql: string,
    params: Data[],
    timeoutMs: bigint,
    cursorBufferSize: number,
    partitionArgumentIndex: number,
    queryId: ClientSqlQueryId,
    _returnRawResult: boolean,
    schema: string | null,
    expectedResultType: number,
  ): import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlExecuteResult {
    const queryKey = this._clientSqlQueryKey(queryId);
    this._closeStoredClientSqlResult(queryKey);

    try {
      if (schema !== null) {
        throw new SqlExecutionError(
          'Only the default schema is supported for the retained IMap SQL surface',
          queryKey,
        );
      }

      const statement = new SqlStatement(
        sql,
        params.map((param) => this._ss.toObject(param)),
      );
      if (timeoutMs >= 0n && timeoutMs <= BigInt(Number.MAX_SAFE_INTEGER)) {
        statement.setTimeoutMillis(Number(timeoutMs));
      }
      if (cursorBufferSize > 0) {
        statement.setCursorBufferSize(cursorBufferSize);
      }

      const result = this._getOrCreateSqlService().executeStatement(statement);
      if (result.isUpdateCount()) {
        if (expectedResultType === 1) {
          result.close();
          throw new SqlExecutionError('SQL statement returned an update count, but rows were required', queryKey);
        }

        const updateCount = BigInt(result.getUpdateCount());
        result.close();
        return {
          queryId,
          rowMetadata: null,
          rowPage: null,
          updateCount,
          error: null,
          isInfiniteRows: false,
          partitionArgumentIndex,
        };
      }

      if (expectedResultType === 2) {
        result.close();
        throw new SqlExecutionError('SQL statement returned rows, but an update count was required', queryKey);
      }

      const rowPage = this._toProtocolSqlPage(result, cursorBufferSize);
      if (rowPage.last) {
        result.close();
      } else {
        this._clientSqlResults.set(queryKey, result);
      }

      return {
        queryId,
        rowMetadata: this._toProtocolSqlMetadata(result),
        rowPage,
        updateCount: -1n,
        error: null,
        isInfiniteRows: false,
        partitionArgumentIndex,
      };
    } catch (error) {
      return {
        queryId,
        rowMetadata: null,
        rowPage: null,
        updateCount: 0n,
        error: this._toProtocolSqlError(error),
        isInfiniteRows: false,
        partitionArgumentIndex,
      };
    }
  }

  private _fetchClientSql(
    queryId: ClientSqlQueryId,
    cursorBufferSize: number,
  ): import('@zenystx/helios-core/server/clientprotocol/handlers/ServiceOperations').SqlFetchResult {
    const queryKey = this._clientSqlQueryKey(queryId);
    const result = this._clientSqlResults.get(queryKey);
    if (result === undefined) {
      return {
        rowPage: null,
        error: this._toProtocolSqlError(new Error(`SQL cursor not found for queryId ${queryKey}`)),
      };
    }

    try {
      const rowPage = this._toProtocolSqlPage(result, cursorBufferSize);
      if (rowPage.last) {
        this._clientSqlResults.delete(queryKey);
        result.close();
      }
      return { rowPage, error: null };
    } catch (error) {
      this._closeStoredClientSqlResult(queryKey);
      return { rowPage: null, error: this._toProtocolSqlError(error) };
    }
  }

  private _closeClientSql(queryId: ClientSqlQueryId): void {
    this._closeStoredClientSqlResult(this._clientSqlQueryKey(queryId));
  }

  private _getExecutorTaskRoute(uuid: string): ClientExecutorTaskRoute | null {
    return this._clientExecutorTasks.get(uuid) ?? null;
  }

  private _findClusterMemberByUuid(memberUuid: string) {
    return this._cluster.getMembers().find((member) => member.getUuid() === memberUuid) ?? null;
  }

  private _getOrCreateExecutorRuntime(name: string): {
    proxy: ExecutorServiceProxy;
    container: ExecutorContainerService;
  } {
    const proxy = this.getExecutorService(name) as ExecutorServiceProxy;
    const container = this._executorContainers.get(name)
      ?? this._nodeEngine.getServiceOrNull<ExecutorContainerService>(`helios:executor:container:${name}`);
    if (container === null || container === undefined) {
      throw new Error(`No executor container registered for executor \"${name}\"`);
    }
    return { proxy, container };
  }

  private _buildClientExecutorOperation(
    name: string,
    uuid: string,
    callable: Data,
  ): ExecuteCallableOperation {
    const { container } = this._getOrCreateExecutorRuntime(name);
    if (container.isShutdown()) {
      throw new ExecutorRejectedExecutionException(`Executor \"${name}\" is shut down`);
    }

    const registry = this._nodeEngine.getServiceOrNull<TaskTypeRegistry>(
      `helios:executor:registry:${name}`,
    );
    if (registry === null) {
      throw new Error(`No executor registry registered for executor \"${name}\"`);
    }

    const task = this._ss.toObject<TaskCallable<unknown>>(callable);
    if (task === null || typeof task !== 'object' || typeof task.taskType !== 'string') {
      throw new Error('Executor callable payload must serialize to a TaskCallable');
    }
    if (task.taskType === '__inline__') {
      throw new Error('Inline tasks cannot be submitted for distributed execution');
    }

    const taskDescriptor = registry.get(task.taskType);
    if (taskDescriptor === undefined) {
      throw new Error(`Unknown task type: \"${task.taskType}\"`);
    }

    const config = this._config.getExecutorConfig(name);
    if (config.getExecutionBackend() === 'scatter' && !registry.isWorkerSafe(task.taskType)) {
      throw new Error(
        `Task \"${task.taskType}\" is not worker-safe (no modulePath). `
        + 'Distributed tasks require module-backed registration with modulePath and exportName.',
      );
    }

    return new ExecuteCallableOperation({
      taskUuid: uuid,
      executorName: name,
      taskType: task.taskType,
      registrationFingerprint: taskDescriptor.fingerprint,
      inputData: Buffer.from(JSON.stringify(task.input ?? null)),
      submitterMemberUuid: this.getLocalMemberId(),
      timeoutMillis: config.getTaskTimeoutMillis(),
    });
  }

  private _trackClientExecutorTask(
    uuid: string,
    route: ClientExecutorTaskRoute,
    future: import('@zenystx/helios-core/spi/impl/operationservice/InvocationFuture').InvocationFuture<ExecutorOperationResult>,
  ): void {
    this._clientExecutorTasks.set(uuid, route);
    future.whenComplete(() => {
      this._clientExecutorTasks.delete(uuid);
    });
  }

  private _submitClientExecutorTaskToPartition(
    name: string,
    uuid: string,
    callable: Data,
    partitionId: number,
  ): void {
    const operation = this._buildClientExecutorOperation(name, uuid, callable);
    const future = this._nodeEngine.getOperationService().invokeOnPartition<ExecutorOperationResult>(
      'helios:executor',
      operation,
      partitionId,
    );
    this._trackClientExecutorTask(uuid, { name, partitionId, memberUuid: null }, future);
  }

  private _submitClientExecutorTaskToMember(
    name: string,
    uuid: string,
    callable: Data,
    memberUuid: string,
  ): void {
    const member = this._findClusterMemberByUuid(memberUuid);
    if (member === null) {
      throw new Error(`Executor target member not found: ${memberUuid}`);
    }

    const operation = new MemberCallableOperation(
      this._buildClientExecutorOperation(name, uuid, callable).descriptor,
      memberUuid,
    );
    const future = this._nodeEngine.getOperationService().invokeOnTarget<ExecutorOperationResult>(
      'helios:executor',
      operation,
      member.getAddress(),
    );
    this._trackClientExecutorTask(uuid, { name, partitionId: null, memberUuid }, future);
  }

  private async _cancelClientExecutorTaskOnPartition(
    uuid: string,
    partitionId: number,
    _interrupt: boolean,
  ): Promise<boolean> {
    const route = this._getExecutorTaskRoute(uuid);
    if (route === null || route.partitionId !== partitionId) {
      return false;
    }

    const operation = new CancellationOperation(route.name, uuid);
    const cancelled = await this._nodeEngine.getOperationService().invokeOnPartition<boolean>(
      'helios:executor',
      operation,
      partitionId,
    ).get();
    if (cancelled) {
      this._clientExecutorTasks.delete(uuid);
    }
    return cancelled;
  }

  private async _cancelClientExecutorTaskOnMember(
    uuid: string,
    memberUuid: string,
    _interrupt: boolean,
  ): Promise<boolean> {
    const route = this._getExecutorTaskRoute(uuid);
    if (route === null || route.memberUuid !== memberUuid) {
      return false;
    }

    const member = this._findClusterMemberByUuid(memberUuid);
    if (member === null) {
      return false;
    }

    const operation = new CancellationOperation(route.name, uuid);
    const cancelled = await this._nodeEngine.getOperationService().invokeOnTarget<boolean>(
      'helios:executor',
      operation,
      member.getAddress(),
    ).get();
    if (cancelled) {
      this._clientExecutorTasks.delete(uuid);
    }
    return cancelled;
  }

  private _getTransactionalMap(
    txId: string,
    name: string,
  ): TransactionalMapProxy<Data, Data> {
    const context = this._getClientTransactionContext(txId);
    let proxy = context.mapProxies.get(name);
    if (proxy === undefined) {
      proxy = new TransactionalMapProxy(name, context.transaction, this._nodeEngine, this._mapService);
      context.mapProxies.set(name, proxy);
    }
    return proxy;
  }

  private _getTransactionalQueue(
    txId: string,
    name: string,
  ): TransactionalQueueProxy<Data> {
    const context = this._getClientTransactionContext(txId);
    let proxy = context.queueProxies.get(name);
    if (proxy === undefined) {
      this._ensureQueueService();
      proxy = new TransactionalQueueProxy(name, context.transaction, this._nodeEngine, {
        offer: (value, dedupeId) => this._distributedQueueService!.offer(name, value, 0, dedupeId, this._dedupedQueueTxnOps),
        poll: (dedupeId) => this._distributedQueueService!.poll(name, 0, dedupeId, this._dedupedQueueTxnOps),
        peek: () => this._distributedQueueService!.peek(name),
        size: () => this._distributedQueueService!.size(name),
        toArray: () => this._distributedQueueService!.toArray(name),
      });
      context.queueProxies.set(name, proxy);
    }
    return proxy;
  }

  private _getTransactionalList(
    txId: string,
    name: string,
  ): TransactionalListProxy<Data> {
    const context = this._getClientTransactionContext(txId);
    let proxy = context.listProxies.get(name);
    if (proxy === undefined) {
      this._ensureListService();
      proxy = new TransactionalListProxy(name, context.transaction, this._nodeEngine, {
        add: (value, dedupeId) => this._distributedListService!.add(name, value, dedupeId, this._dedupedListTxnOps),
        remove: (value, dedupeId) => this._distributedListService!.remove(name, value, dedupeId, this._dedupedListTxnOps),
        size: () => this._distributedListService!.size(name),
        toArray: () => this._distributedListService!.toArray(name),
      });
      context.listProxies.set(name, proxy);
    }
    return proxy;
  }

  private _getTransactionalSet(
    txId: string,
    name: string,
  ): TransactionalSetProxy<Data> {
    const context = this._getClientTransactionContext(txId);
    let proxy = context.setProxies.get(name);
    if (proxy === undefined) {
      this._ensureSetService();
      proxy = new TransactionalSetProxy(name, context.transaction, this._nodeEngine, {
        add: (value, dedupeId) => this._distributedSetService!.add(name, value, dedupeId, this._dedupedSetTxnOps),
        remove: (value, dedupeId) => this._distributedSetService!.remove(name, value, dedupeId, this._dedupedSetTxnOps),
        size: () => this._distributedSetService!.size(name),
        contains: (value) => this._distributedSetService!.contains(name, value),
      });
      context.setProxies.set(name, proxy);
    }
    return proxy;
  }

  private _getTransactionalMultiMap(
    txId: string,
    name: string,
  ): TransactionalMultiMapProxy<Data, Data> {
    const context = this._getClientTransactionContext(txId);
    let proxy = context.multiMapProxies.get(name);
    if (proxy === undefined) {
      this._ensureMultiMapService();
      proxy = new TransactionalMultiMapProxy(name, context.transaction, this._nodeEngine, {
        put: (key, value, dedupeId) => this._distributedMultiMapService!.put(name, key, value, undefined, dedupeId, this._dedupedMultiMapTxnOps),
        get: (key) => this._distributedMultiMapService!.get(name, key),
        remove: (key, value, dedupeId) => this._distributedMultiMapService!.remove(name, key, value, dedupeId, this._dedupedMultiMapTxnOps),
        removeAll: (key, dedupeId) => this._distributedMultiMapService!.removeAll(name, key, dedupeId, this._dedupedMultiMapTxnOps),
        valueCount: (key) => this._distributedMultiMapService!.valueCount(name, key),
        size: () => this._distributedMultiMapService!.size(name),
      });
      context.multiMapProxies.set(name, proxy);
    }
    return proxy;
  }

  private _ensureQueueService(): void {
    if (this._distributedQueueService === null) {
      this._distributedQueueService = new DistributedQueueService(
        this.getLocalMemberId(),
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

  private _ensureListService(): void {
    if (this._distributedListService === null) {
      this._distributedListService = new DistributedListService(
        this.getLocalMemberId(),
        this._config,
        this._ss,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _ensureSetService(): void {
    if (this._distributedSetService === null) {
      this._distributedSetService = new DistributedSetService(
        this.getLocalMemberId(),
        this._config,
        this._ss,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _ensureMultiMapService(): void {
    if (this._distributedMultiMapService === null) {
      this._distributedMultiMapService = new DistributedMultiMapService(
        this.getLocalMemberId(),
        this._config,
        this._ss,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _ensureReplicatedMapService(): void {
    if (this._distributedReplicatedMapService === null) {
      this._distributedReplicatedMapService = new DistributedReplicatedMapService(
        this.getLocalMemberId(),
        this._config,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _ensureRingbufferService(): void {
    if (this._distributedRingbufferService === null) {
      this._distributedRingbufferService = new DistributedRingbufferService(
        this.getLocalMemberId(),
        this._config,
        this._ringbufferService,
        this._transport,
        this._clusterCoordinator,
      );
    }
  }

  private _createDistributedCacheService(
    localMemberId: string,
    transport: TcpClusterTransport | null = this._transport,
    coordinator: HeliosClusterCoordinator | null = this._clusterCoordinator,
  ): DistributedCacheService {
    return new DistributedCacheService(
      localMemberId,
      this._config,
      this._ss,
      transport,
      coordinator,
      {
        onMutation: (event) => {
          this._publishCacheMutationInvalidation(event.cacheName, event.operation, event.keyData, event.keyDataList);
        },
      },
    );
  }

  private _toCacheInvalidationName(name: string): string {
    return name.startsWith("/hz/") ? name : CacheUtil.getDistributedObjectName(name);
  }

  private _toCacheMutationTrigger(operation: string): MutationTrigger {
    switch (operation) {
      case "put":
      case "getAndPut":
        return MutationTrigger.PUT;
      case "putIfAbsent":
        return MutationTrigger.PUT_IF_ABSENT;
      case "getAndReplace":
      case "replace":
        return MutationTrigger.REPLACE;
      case "getAndRemove":
      case "remove":
        return MutationTrigger.REMOVE;
      case "clear":
        return MutationTrigger.CLEAR;
      default:
        return MutationTrigger.UNKNOWN;
    }
  }

  private _publishCacheMutationInvalidation(name: string, operation: string, keyData?: Data, keyDataList?: Data[]): void {
    const invalidationName = this._toCacheInvalidationName(name);
    const trigger = this._toCacheMutationTrigger(operation);
    if (keyDataList !== undefined && keyDataList.length > 0) {
      this._nearCacheInvalidationManager.invalidateBatch(
        invalidationName,
        keyDataList.map((key) => ({
          keyBytes: Buffer.from(key.toByteArray() ?? []),
          partitionId: this._nodeEngine.getPartitionService().getPartitionId(key),
        })),
        trigger,
      );
      return;
    }
    if (keyData !== undefined) {
      this._nearCacheInvalidationManager.invalidateKey(
        invalidationName,
        Buffer.from(keyData.toByteArray() ?? []),
        this._nodeEngine.getPartitionService().getPartitionId(keyData),
        trigger,
      );
      return;
    }
    this._nearCacheInvalidationManager.invalidateAll(invalidationName, trigger);
  }

  private _ensureCacheService(): void {
    if (this._distributedCacheService === null) {
      this._distributedCacheService = this._createDistributedCacheService(this.getLocalMemberId());
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

  private _registerClientMapListener(name: string, flags: number, correlationId: number, session: ClientSession): string {
    const registrationId = crypto.randomUUID();
    this._clientMapListenerRegistrations.set(registrationId, {
      mapName: name,
      registrationId,
      correlationId,
      flags,
      session,
    });
    let registrations = this._clientSessionMapListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionMapListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientMapListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientMapListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientMapListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionMapListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionMapListeners.delete(sessionId);
    }
    return true;
  }

  private _removeClientMapListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionMapListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientMapListener(sessionId, registrationId);
    }
  }

  private _publishClientMapEvent(name: string, key: Data | null, value: Data | null, oldValue: Data | null, eventType: number): void {
    const memberUuid = this._cluster.getLocalMember().getUuid();
    for (const [registrationId, registration] of this._clientMapListenerRegistrations) {
      if (registration.mapName !== name) {
        continue;
      }
      if (registration.flags !== 0 && (registration.flags & eventType) === 0) {
        continue;
      }
      const sessionId = [...this._clientSessionMapListeners.entries()]
        .find(([, registrations]) => registrations.has(registrationId))?.[0];
      if (sessionId === undefined) {
        continue;
      }
      const session = registration.session;
      if (!session.isAuthenticated()) {
        this._removeClientMapListener(sessionId, registrationId);
        continue;
      }
      const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
        key,
        value,
        oldValue,
        null,
        eventType,
        memberUuid,
        1,
      );
      eventMessage.setCorrelationId(registration.correlationId);
      session.pushEvent(eventMessage);
    }
  }

  private _publishClientMapBulkEvent(name: string, eventType: number, affectedEntries: number): void {
    const memberUuid = this._cluster.getLocalMember().getUuid();
    for (const [registrationId, registration] of this._clientMapListenerRegistrations) {
      if (registration.mapName !== name) {
        continue;
      }
      if (registration.flags !== 0 && (registration.flags & eventType) === 0) {
        continue;
      }
      const sessionId = [...this._clientSessionMapListeners.entries()]
        .find(([, registrations]) => registrations.has(registrationId))?.[0];
      if (sessionId === undefined) {
        continue;
      }
      const session = registration.session;
      if (!session.isAuthenticated()) {
        this._removeClientMapListener(sessionId, registrationId);
        continue;
      }
      const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
        null,
        null,
        null,
        null,
        eventType,
        memberUuid,
        affectedEntries,
      );
      eventMessage.setCorrelationId(registration.correlationId);
      session.pushEvent(eventMessage);
    }
  }

  private _publishClientMapMutationFromValues(name: string, key: Data, before: Data | null, after: Data | null): void {
    if (before === null && after === null) {
      return;
    }
    if (before === null && after !== null) {
      this._publishClientMapEvent(name, key, after, null, 1);
      return;
    }
    if (before !== null && after === null) {
      this._publishClientMapEvent(name, key, null, before, 2);
      return;
    }
    if (before !== null && after !== null && !before.equals(after)) {
      this._publishClientMapEvent(name, key, after, before, 4);
    }
  }

  private _registerClientQueueListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): string {
    this._ensureQueueService();
    const memberUuid = this._cluster.getLocalMember().getUuid();
    const registrationId = crypto.randomUUID();
    const queueListenerId = this._distributedQueueService!.addItemListener(name, {
      itemAdded: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = QueueAddListenerCodec.encodeItemEvent(item, memberUuid, 1);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      itemRemoved: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = QueueAddListenerCodec.encodeItemEvent(item, memberUuid, 2);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
    }, includeValue);
    this._clientQueueListenerRegistrations.set(registrationId, {
      queueName: name,
      registrationId,
      queueListenerId,
    });
    let registrations = this._clientSessionQueueListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionQueueListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientQueueListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientQueueListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientQueueListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionQueueListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionQueueListeners.delete(sessionId);
    }
    this._ensureQueueService();
    return this._distributedQueueService!.removeItemListener(registration.queueName, registration.queueListenerId);
  }

  private _removeClientQueueListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionQueueListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientQueueListener(sessionId, registrationId);
    }
  }

  private _registerClientListListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): string {
    this._ensureListService();
    const memberUuid = this._cluster.getLocalMember().getUuid();
    const registrationId = crypto.randomUUID();
    const itemListenerId = this._distributedListService!.addItemListener(name, {
      itemAdded: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = ListAddListenerCodec.encodeItemEvent(item, memberUuid, 1);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      itemRemoved: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = ListAddListenerCodec.encodeItemEvent(item, memberUuid, 2);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
    }, includeValue);
    this._clientListListenerRegistrations.set(registrationId, {
      name,
      registrationId,
      itemListenerId,
      includeValue,
      correlationId,
      session,
    });
    let registrations = this._clientSessionListListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionListListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientListListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientListListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientListListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionListListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionListListeners.delete(sessionId);
    }
    this._ensureListService();
    return this._distributedListService!.removeItemListener(
      registration.name,
      registration.itemListenerId ?? registration.registrationId,
    );
  }

  private _removeClientListListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionListListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientListListener(sessionId, registrationId);
    }
  }

  private _registerClientSetListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): string {
    this._ensureSetService();
    const memberUuid = this._cluster.getLocalMember().getUuid();
    const registrationId = crypto.randomUUID();
    const itemListenerId = this._distributedSetService!.addItemListener(name, {
      itemAdded: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = SetAddListenerCodec.encodeItemEvent(item, memberUuid, 1);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      itemRemoved: (event) => {
        const item = includeValue ? this._ss.toData(event.getItem()) : null;
        const eventMessage = SetAddListenerCodec.encodeItemEvent(item, memberUuid, 2);
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
    }, includeValue);
    this._clientSetListenerRegistrations.set(registrationId, {
      name,
      registrationId,
      itemListenerId,
      includeValue,
      correlationId,
      session,
    });
    let registrations = this._clientSessionSetListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionSetListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientSetListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientSetListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientSetListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionSetListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionSetListeners.delete(sessionId);
    }
    this._ensureSetService();
    return this._distributedSetService!.removeItemListener(
      registration.name,
      registration.itemListenerId ?? registration.registrationId,
    );
  }

  private _removeClientSetListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionSetListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientSetListener(sessionId, registrationId);
    }
  }

  private _registerClientMultiMapListener(name: string, includeValue: boolean, correlationId: number, session: ClientSession): string {
    this._ensureMultiMapService();
    const memberUuid = this._cluster.getLocalMember().getUuid();
    const registrationId = crypto.randomUUID();
    const entryListenerId = this._distributedMultiMapService!.addEntryListener(name, {
      entryAdded: (event) => {
        const key = this._ss.toData(event.getKey());
        const value = includeValue ? this._ss.toData(event.getValue()) : null;
        const eventMessage = MultiMapAddEntryListenerCodec.encodeEntryEvent(
          key,
          value,
          null,
          null,
          1,
          memberUuid,
          1,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      entryRemoved: (event) => {
        const key = this._ss.toData(event.getKey());
        const oldValue = includeValue ? this._ss.toData(event.getOldValue()) : null;
        const eventMessage = MultiMapAddEntryListenerCodec.encodeEntryEvent(
          key,
          null,
          oldValue,
          null,
          2,
          memberUuid,
          1,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      mapCleared: (event) => {
        const eventMessage = MultiMapAddEntryListenerCodec.encodeEntryEvent(
          null,
          null,
          null,
          null,
          64,
          memberUuid,
          event.numberOfAffectedEntries,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
    }, includeValue);
    this._clientMultiMapListenerRegistrations.set(registrationId, {
      name,
      registrationId,
      entryListenerId,
      includeValue,
      correlationId,
      session,
    });
    let registrations = this._clientSessionMultiMapListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionMultiMapListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientMultiMapListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientMultiMapListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientMultiMapListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionMultiMapListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionMultiMapListeners.delete(sessionId);
    }
    this._ensureMultiMapService();
    return this._distributedMultiMapService!.removeEntryListener(
      registration.name,
      registration.entryListenerId ?? registration.registrationId,
    );
  }

  private _removeClientMultiMapListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionMultiMapListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientMultiMapListener(sessionId, registrationId);
    }
  }

  private _registerClientReplicatedMapListener(
    name: string,
    correlationId: number,
    session: ClientSession,
    filter?: (key: Data | null, value: Data | null, oldValue: Data | null, eventType: number) => boolean,
  ): string {
    this._ensureReplicatedMapService();
    const memberUuid = this._cluster.getLocalMember().getUuid();
    const registrationId = crypto.randomUUID();
    const entryListenerId = this._distributedReplicatedMapService!.addEntryListener(name, {
      entryAdded: (event) => {
        if (filter !== undefined && !filter(event.key, event.value, event.oldValue, 1)) {
          return;
        }
        const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
          event.key,
          event.value,
          event.oldValue,
          null,
          1,
          memberUuid,
          event.numberOfAffectedEntries,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      entryUpdated: (event) => {
        if (filter !== undefined && !filter(event.key, event.value, event.oldValue, 4)) {
          return;
        }
        const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
          event.key,
          event.value,
          event.oldValue,
          null,
          4,
          memberUuid,
          event.numberOfAffectedEntries,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      entryRemoved: (event) => {
        if (filter !== undefined && !filter(event.key, event.value, event.oldValue, 2)) {
          return;
        }
        const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
          event.key,
          null,
          event.oldValue,
          null,
          2,
          memberUuid,
          event.numberOfAffectedEntries,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
      mapCleared: (event) => {
        const eventMessage = MapAddEntryListenerCodec.encodeEntryEvent(
          null,
          null,
          null,
          null,
          64,
          memberUuid,
          event.numberOfAffectedEntries,
        );
        eventMessage.setCorrelationId(correlationId);
        session.pushEvent(eventMessage);
      },
    });
    this._clientReplicatedMapListenerRegistrations.set(registrationId, {
      name,
      registrationId,
      entryListenerId,
      correlationId,
      session,
    });
    let registrations = this._clientSessionReplicatedMapListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionReplicatedMapListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientReplicatedMapListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientReplicatedMapListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientReplicatedMapListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionReplicatedMapListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionReplicatedMapListeners.delete(sessionId);
    }
    this._ensureReplicatedMapService();
    return this._distributedReplicatedMapService!.removeEntryListener(
      registration.name,
      registration.entryListenerId ?? registration.registrationId,
    );
  }

  private _removeClientReplicatedMapListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionReplicatedMapListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientReplicatedMapListener(sessionId, registrationId);
    }
  }

  private _registerClientCacheInvalidationListener(name: string, session: ClientSession): string {
    const registrationId = crypto.randomUUID();
    const invalidationName = this._toCacheInvalidationName(name);
    this._nearCacheInvalidationManager.subscribe(session, invalidationName);
    this._clientCacheInvalidationListenerRegistrations.set(registrationId, {
      name,
      invalidationName,
      registrationId,
      session,
    });
    let registrations = this._clientSessionCacheInvalidationListeners.get(session.getSessionId());
    if (registrations === undefined) {
      registrations = new Set<string>();
      this._clientSessionCacheInvalidationListeners.set(session.getSessionId(), registrations);
    }
    registrations.add(registrationId);
    return registrationId;
  }

  private _removeClientCacheInvalidationListener(sessionId: string, registrationId: string): boolean {
    const registration = this._clientCacheInvalidationListenerRegistrations.get(registrationId);
    if (registration === undefined) {
      return false;
    }
    this._clientCacheInvalidationListenerRegistrations.delete(registrationId);
    const registrations = this._clientSessionCacheInvalidationListeners.get(sessionId);
    registrations?.delete(registrationId);
    if (registrations !== undefined && registrations.size === 0) {
      this._clientSessionCacheInvalidationListeners.delete(sessionId);
    }
    this._nearCacheInvalidationManager.unsubscribe(sessionId, registration.invalidationName);
    return true;
  }

  private _removeClientCacheInvalidationListenersForSession(sessionId: string): void {
    const registrations = this._clientSessionCacheInvalidationListeners.get(sessionId);
    if (registrations === undefined) {
      return;
    }
    for (const registrationId of Array.from(registrations)) {
      this._removeClientCacheInvalidationListener(sessionId, registrationId);
    }
  }

  /**
   * Returns the port the client protocol server is listening on, or 0 if not started.
   */
  getClientProtocolPort(): number {
    return this._clientProtocolServer?.getPort() ?? 0;
  }

  /**
   * Returns a promise that resolves once the client protocol server's TCP port
   * is bound and ready to accept connections.  Callers (e.g. test helpers) can
   * await this instead of sleeping an arbitrary duration.
   */
  waitForClientProtocolReady(): Promise<void> {
    return this._clientProtocolReady;
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
   * Returns the local cluster member UUID. In clustered mode this is the
   * RFC 4122 UUID assigned during startup (used for TCP HELLO handshake and
   * all cluster protocol messages). In single-node mode returns the instance
   * name (no cluster coordinator exists).
   */
  getLocalMemberId(): string {
    return this._clusterCoordinator?.getLocalMemberId() ?? this._name;
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
    this._stopInvocationSweeper();
    this._backpressureRegulator?.rejectAll(new Error('Helios instance shutting down'));
    this._backpressureRegulator?.reset();
    for (const [callId, waiter] of this._localBackupAckWaiters) {
      clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error(`Helios instance shutting down (callId=${callId})`));
    }
    this._localBackupAckWaiters.clear();
    queueMicrotask(() => {
      this._invocationMonitor.reset(new Error('Helios instance shutting down'));
    });
    this._recoverySyncAssemblies.clear();
    // Shut down all executor containers + proxies (fire-and-forget the promises)
    for (const [name, exec] of Array.from(this._executors.entries())) {
      const container = this._executorContainers.get(name)
        ?? this._nodeEngine.getServiceOrNull<ExecutorContainerService>(`helios:executor:container:${name}`);
      if (container) container.shutdown().catch(() => {});
      exec.shutdown().catch(() => {});
    }
    this._executors.clear();
    this._executorContainers.clear();
    this._clientExecutorTasks.clear();
    for (const queryKey of Array.from(this._clientSqlResults.keys())) {
      this._closeStoredClientSqlResult(queryKey);
    }
    // Shut down all scheduled executor containers + proxies
    for (const [name, schedProxy] of Array.from(this._scheduledExecutors.entries())) {
      const schedContainer = this._scheduledExecutorContainers.get(name);
      if (schedContainer) schedContainer.shutdown().catch(() => {});
      schedProxy.shutdown().catch(() => {});
    }
    this._scheduledExecutors.clear();
    this._scheduledExecutorContainers.clear();
    this._transactionCoordinator.shutdown();
    this._transactionManagerService.shutdown(false);
    this._clientTransactions.clear();
    for (const topic of Array.from(this._topics.values())) topic.destroy();
    this._reliableTopicService.shutdown();
    this._distributedReplicatedMapService?.shutdown();
    this._cpSubsystemService?.shutdown();
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
    this._atomicLongService = null;
    this._atomicReferenceService = null;
    this._countDownLatchService = null;
    this._semaphoreService = null;
    this._pnCounterService = null;
    this._flakeIdGeneratorService = null;
    this._cardinalityEstimatorService = null;
    this._cpSubsystemService = null;
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
    this._healthMonitor?.stop();
    this._slowOperationDetector?.stop();
    this._slowOperationDetector = null;
    this._storeLatencyTracker = null;
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

  getMigrationQueueSize(): number {
    return this._migrationManager?.getStats().migrationQueueSize ?? 0;
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

  /**
   * Returns the backpressure regulator's observable stats, or null if backpressure
   * is not active (single-node mode). Useful for monitoring and diagnostics.
   */
  getBackpressureStats(): BackpressureStats | null {
    return this._backpressureRegulator?.getStats() ?? null;
  }

  /**
   * Returns the backpressure regulator instance, or null if not in clustered mode.
   * @internal — used for testing and diagnostics.
   */
  getBackpressureRegulator(): BackpressureRegulator | null {
    return this._backpressureRegulator;
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
    this._ensureListService();
    let list = this._lists.get(name);
    if (!list) {
      list = new ListProxyImpl<unknown>(name, this._distributedListService!, this._ss);
      this._lists.set(name, list);
    }
    return list as unknown as IList<E>;
  }

  getSet<E>(name: string): ISet<E> {
    let set = this._sets.get(name);
    if (!set) {
      set =
        this._distributedSetService === null
          ? new SetImpl<unknown>()
          : new SetProxyImpl<unknown>(name, this._distributedSetService, this._ss);
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
      mmap =
        this._distributedMultiMapService === null
          ? new MultiMapImpl<unknown, unknown>()
          : new MultiMapProxyImpl<unknown, unknown>(
              name,
              this._distributedMultiMapService,
              this._ss,
            );
      this._multiMaps.set(name, mmap);
    }
    return mmap as MultiMap<K, V>;
  }

  getReplicatedMap<K, V>(name: string): ReplicatedMap<K, V> {
    let rm = this._replicatedMaps.get(name);
    if (!rm) {
      rm =
        this._distributedReplicatedMapService === null
          ? new ReplicatedMapImpl<unknown, unknown>(name)
          : new ReplicatedMapProxyImpl<unknown, unknown>(
              name,
              this._distributedReplicatedMapService,
              this._ss,
            );
      this._replicatedMaps.set(name, rm);
    }
    return rm as ReplicatedMap<K, V>;
  }

  /** Get (or create) a distributed cache by name. */
  getCache<K, V>(name: string): DistributedCacheService {
    if (this._distributedCacheService === null) {
      this._distributedCacheService = this._createDistributedCacheService(this._name, null, null);
    }
    return this._distributedCacheService;
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
        this.getLocalMemberId(),
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
      const map = this.getMap<unknown, unknown>(name);
      return {
        getName: () => map.getName(),
        getServiceName: () => MAP_SERVICE_NAME,
        destroy: async () => {
          await this._destroyMapDistributedObject(name);
        },
      };
    }
    if (serviceName === QUEUE_SERVICE_NAME) {
      const queue = this.getQueue<unknown>(name);
      return {
        getName: () => queue.getName(),
        getServiceName: () => QUEUE_SERVICE_NAME,
        destroy: async () => {
          this._destroyQueueDistributedObject(name);
        },
      };
    }
    if (serviceName === TOPIC_SERVICE_NAME) {
      const topic = this.getTopic<unknown>(name);
      return {
        getName: () => topic.getName(),
        getServiceName: () => TOPIC_SERVICE_NAME,
        destroy: async () => {
          this._destroyTopicDistributedObject(name);
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

  private async _destroyMapDistributedObject(name: string): Promise<void> {
    this._nearCachedMaps.delete(name);
    this._nearCacheManager.destroyNearCache(name);
    this._maps.delete(name);
    await this._mapService.destroyDistributedObject(name);
  }

  private _destroyQueueDistributedObject(name: string): void {
    this._queues.delete(name);
    if (this._distributedQueueService !== null) {
      this._distributedQueueService.destroy(name);
    }
  }

  private _destroyTopicDistributedObject(name: string): void {
    const topic = this._topics.get(name);
    if (topic !== undefined) {
      topic.destroy();
      return;
    }
    this._distributedTopicService?.destroy(name);
  }

  getSql(): SqlService {
    return this._getOrCreateSqlService();
  }

  getJet(): { shutdown(): Promise<void>; isClosed: boolean } | null {
    return this.getBlitzService();
  }

  getCPSubsystem(): CpSubsystemService {
    return this._getOrCreateCpSubsystemService();
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

  /** Returns a MonitorStateProvider bound to this instance, or null if monitoring is disabled. */
  getMonitorStateProvider(): MonitorStateProvider | null {
    if (this._metricsRegistry === null) return null;
    return this._createMonitorStateProvider();
  }

  private _initMonitor(): void {
    const monitorConfig = this._config.getMonitorConfig();
    if (!monitorConfig.isEnabled()) return;

    // Enable the MONITOR REST endpoint group automatically when monitoring is enabled
    this._config.getNetworkConfig().getRestApiConfig()
      .enableGroups(RestEndpointGroup.MONITOR);

    // T16: Create and start slow operation detector
    this._slowOperationDetector = new SlowOperationDetector();
    this._slowOperationDetector.start();
    if (this._operationServiceImpl !== null) {
      this._operationServiceImpl.setSlowOperationDetector(this._slowOperationDetector);
    }

    // T17: Create store latency tracker and wire to MapContainerService
    this._storeLatencyTracker = new StoreLatencyTracker();
    this._mapService.setStoreLatencyTracker(this._storeLatencyTracker);

    const stateProvider = this._createMonitorStateProvider();
    this._metricsRegistry = new MetricsRegistry(monitorConfig);
    this._metricsSampler = new MetricsSampler(monitorConfig, stateProvider, this._metricsRegistry);

    // Build the jobs provider for /helios/monitor/jobs
    const jobsProvider = this._createMonitorJobsProvider();

    // Register the monitor REST handler (with jobs and config endpoints)
    const monitorHandler = new MonitorHandler(
      monitorConfig,
      this._metricsRegistry,
      stateProvider,
      jobsProvider,
      {
        monitoring: this._config.getNetworkConfig().getRestApiConfig().isGroupEnabled(RestEndpointGroup.MONITOR),
        admin: this._config.getNetworkConfig().getRestApiConfig().isGroupEnabled(RestEndpointGroup.ADMIN),
      },
    );
    this._restServer.registerHandler('/helios/monitor', (req) => monitorHandler.handle(req));

    // Register the /helios/metrics REST handler (JSON + Prometheus text)
    const metricsHandler = new MetricsHandler(globalMetrics, this._metricsRegistry, globalResourceLimiter);
    this._restServer.registerHandler('/helios/metrics', (req) => metricsHandler.handle(req));

    // Enable and register admin endpoints (co-enabled with monitoring)
    this._config.getNetworkConfig().getRestApiConfig()
      .enableGroups(RestEndpointGroup.ADMIN);
    const adminHandler = new AdminHandler(this._createAdminOperationsProvider());
    this._restServer.registerHandler('/helios/admin', (req) => adminHandler.handle(req));

    // Create and start the health monitor (subscribes to registry sample events)
    this._healthMonitor = new HealthMonitor(monitorConfig, this._metricsRegistry, stateProvider);
    this._healthMonitor.start();

    // Start sampling
    this._metricsSampler.start();
  }

  private _createMonitorJobsProvider(): MonitorJobsProvider {
    return {
      getActiveJobs: async (): Promise<MonitorJobSnapshot[]> => {
        // Collect jobs from the BlitzJobCoordinator if available via the Blitz service bridge
        const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);
        if (blitzService === null) return [];

        // The coordinator is accessed through the service-like bridge pattern.
        // If no coordinator method is exposed, return an empty list gracefully.
        const getJobsFn = (blitzService as unknown as { getJobs?(): Promise<unknown[]> }).getJobs;
        if (typeof getJobsFn !== 'function') return [];

        try {
          const getDescriptorFn = (blitzService as unknown as { getJobDescriptor?(id: string): unknown }).getJobDescriptor;
          const getMetadataFn = (blitzService as unknown as { getJobMetadata?(id: string): Promise<unknown> }).getJobMetadata;
          const jobs = await getJobsFn.call(blitzService) as Array<{
            id: string;
            name: string;
            getStatus(): string;
            getSubmissionTime(): number;
            getMetrics?(): Promise<unknown>;
          }>;

          const snapshots: MonitorJobSnapshotWithCapabilities[] = [];
          for (const job of jobs) {
            let metrics: Record<string, unknown> | null = null;
            if (typeof job.getMetrics === 'function') {
              try {
                const m = await job.getMetrics();
                if (m !== null && typeof m === 'object' && 'vertices' in (m as Record<string, unknown>)) {
                  metrics = blitzJobMetricsToJSON(m as import('@zenystx/helios-core/job/metrics/BlitzJobMetrics').BlitzJobMetrics);
                }
              } catch {
                // Metrics collection may fail for completed jobs
              }
            }

            const descriptor = typeof getDescriptorFn === 'function'
              ? getDescriptorFn.call(blitzService, job.id) as {
                  vertices?: Array<{ name: string; type: string }>;
                  edges?: Array<{ from: string; to: string; edgeType: string }>;
                  parallelism?: number;
                } | null
              : null;
            const metadata = typeof getMetadataFn === 'function'
              ? await getMetadataFn.call(blitzService, job.id) as {
                  lightJob: boolean;
                  participatingMembers: string[];
                  supportsCancel: boolean;
                  supportsRestart: boolean;
                  executionStartTime: number | null;
                  executionCompletionTime: number | null;
                } | null
              : null;

            snapshots.push({
              id: job.id,
              name: job.name,
              status: typeof job.getStatus === 'function' ? job.getStatus() : 'UNKNOWN',
              submittedAt: typeof job.getSubmissionTime === 'function' ? job.getSubmissionTime() : 0,
              executionStartTime: metadata?.executionStartTime ?? null,
              executionCompletionTime: metadata?.executionCompletionTime ?? null,
              lightJob: metadata?.lightJob ?? true,
              supportsCancel: metadata?.supportsCancel ?? true,
              supportsRestart: metadata?.supportsRestart ?? false,
              participatingMembers: metadata?.participatingMembers ?? [],
              vertices: descriptor?.vertices !== undefined
                ? descriptor.vertices.map((vertex) => {
                    const metricVertex = metrics?.['vertices'] && typeof metrics['vertices'] === 'object'
                      ? (metrics['vertices'] as Record<string, Record<string, unknown>>)[vertex.name] ?? null
                      : null;
                    return {
                      name: vertex.name,
                      type: vertex.type,
                      ...(metricVertex !== null
                        ? {
                            status: String(metricVertex['status'] ?? 'UNKNOWN'),
                            parallelism: typeof metricVertex['parallelism'] === 'number' ? metricVertex['parallelism'] : descriptor.parallelism,
                            processedItems: typeof metricVertex['itemsIn'] === 'number' ? metricVertex['itemsIn'] : 0,
                            emittedItems: typeof metricVertex['itemsOut'] === 'number' ? metricVertex['itemsOut'] : 0,
                          }
                        : {}),
                    };
                  })
                : (metrics?.['vertices'] && typeof metrics['vertices'] === 'object'
                    ? Object.entries(metrics['vertices'] as Record<string, Record<string, unknown>>).map(([name, value]) => ({
                        name,
                        type: String((value as Record<string, unknown>)['type'] ?? 'operator'),
                        status: String((value as Record<string, unknown>)['status'] ?? 'UNKNOWN'),
                        parallelism: Number((value as Record<string, unknown>)['parallelism'] ?? 0),
                        processedItems: Number((value as Record<string, unknown>)['itemsIn'] ?? 0),
                        emittedItems: Number((value as Record<string, unknown>)['itemsOut'] ?? 0),
                      }))
                    : []),
              edges: descriptor?.edges ?? [],
              metrics,
            });
          }
          return snapshots;
        } catch {
          return [];
        }
      },
    };
  }

  private _createAdminOperationsProvider(): AdminOperationsProvider {
    return {
      setClusterState: (state: string): void => {
        const clusterState = parseAdminClusterState(state);

        if (this._clusterCoordinator !== null) {
          this._clusterCoordinator.setClusterState(clusterState);
          return;
        }

        if (this._cluster instanceof ClusterServiceImpl) {
          this._cluster.setClusterState(clusterState);
          return;
        }

        throw new Error('Cluster state changes require a cluster service.');
      },

      cancelJob: async (jobId: string): Promise<void> => {
        const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);
        if (blitzService === null) {
          throw new Error('No Blitz service available for job operations.');
        }
        const cancelFn = (blitzService as unknown as { cancelJob?(id: string): Promise<void> }).cancelJob;
        if (typeof cancelFn !== 'function') {
          throw new Error('Job cancel is not supported by this Blitz service.');
        }
        await cancelFn.call(blitzService, jobId);
      },

      restartJob: async (jobId: string): Promise<void> => {
        const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);
        if (blitzService === null) {
          throw new Error('No Blitz service available for job operations.');
        }
        const getMetadataFn = (blitzService as unknown as { getJobMetadata?(id: string): Promise<unknown> }).getJobMetadata;
        const metadata = typeof getMetadataFn === 'function'
          ? await getMetadataFn.call(blitzService, jobId) as { supportsRestart: boolean } | null
          : null;
        if (metadata !== null && metadata.supportsRestart === false) {
          throw new Error('Job restart is not supported for standalone/light jobs.');
        }
        const restartFn = (blitzService as unknown as { restartJob?(id: string): Promise<void> }).restartJob;
        if (typeof restartFn !== 'function') {
          throw new Error('Job restart is not supported by this Blitz service.');
        }
        await restartFn.call(blitzService, jobId);
      },

      clearMap: async (name: string): Promise<void> => {
        const proxy = this._getOrCreateProxy(name);
        await proxy.clear();
      },

      evictMap: async (name: string): Promise<void> => {
        // MapProxy does not expose evictAll(); use clear() as the eviction path.
        // This is semantically equivalent for the MC admin "evict map" action.
        const proxy = this._getOrCreateProxy(name);
        await proxy.clear();
      },

      triggerGc: (): void => {
        if (typeof globalThis.gc === 'function') {
          globalThis.gc();
        }
        // Bun's --expose-gc or V8 flag needed; otherwise this is a best-effort no-op.
      },
    };
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
      getMigrationMetrics: (): MigrationMetrics => this._getMigrationMetrics(),
      getOperationMetrics: (): OperationMetrics => this._getOperationMetrics(),
      getInvocationMetrics: (): InvocationMetrics => this._getInvocationMetrics(),
      getBlitzMetrics: () => this._getBlitzMetrics(),
      getJobCounterMetrics: (): JobCounterMetrics | null => this._getJobCounterMetrics(),
      getMapStats: (): Map<string, LocalMapStats> => this._mapService.getAllMapStats(),
      getStoreLatencyMetrics: (): StoreLatencyMetrics | null =>
        this._storeLatencyTracker !== null ? this._storeLatencyTracker.getStats() : null,
      getQueueStats: (): Map<string, LocalQueueStats> => {
        const result = new Map<string, LocalQueueStats>();
        for (const [name, queue] of this._queues) {
          result.set(name, queue.getLocalQueueStats());
        }
        return result;
      },
      getTopicStats: (): Map<string, LocalTopicStats> => {
        const result = new Map<string, LocalTopicStats>();
        for (const [name, topic] of this._topics) {
          result.set(name, topic.getLocalTopicStats());
        }
        return result;
      },
      getSystemEvents: (): SystemEvent[] => this._systemEventLog.getRecentEvents(20),
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
      const isLocal = address === localAddress;
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

      const restAdvertisement = this._getMemberRestAdvertisement(
        member,
        address === localAddress ? localMember : null,
      );
      const monitorCapable = readMemberMonitorCapability(member) ?? (restAdvertisement !== null);
      const adminCapable = readMemberAdminCapability(member) ?? monitorCapable;

      result.push({
        uuid: member.getUuid(),
        address,
        restPort: restAdvertisement?.port ?? 0,
        restAddress: restAdvertisement?.url ?? null,
        monitorCapable,
        adminCapable,
        isMaster: address === masterAddress,
        isLocal,
        primaryPartitions,
        backupPartitions,
      });
    }

    return result;
  }

  private _buildAdvertisedRestAddress(localMember: Member): string | null {
    const restApiConfig = this._config.getNetworkConfig().getRestApiConfig();
    if (!restApiConfig.isEnabled()) {
      return null;
    }

    const restPort = this._restServer.isStarted()
      ? this._restServer.getBoundPort()
      : restApiConfig.getPort();
    if (restPort <= 0) {
      return null;
    }

    const publicAddress = this._config.getNetworkConfig().getPublicAddress();
    const host = publicAddress !== null && publicAddress.trim().length > 0
      ? extractHostFromAddress(publicAddress)
      : localMember.getAddress().getHost();

    return `http://${formatUrlHost(host)}:${restPort}`;
  }

  private _buildAdvertisedClientAddress(localMember: Member): Address | null {
    const configuredPort = this._config.getNetworkConfig().getClientProtocolPort();
    const boundPort = this._clientProtocolServer?.getPort() ?? 0;
    const port = boundPort > 0 ? boundPort : configuredPort;
    if (port <= 0) {
      return null;
    }

    const publicAddress = this._config.getNetworkConfig().getPublicAddress();
    const host = publicAddress !== null && publicAddress.trim().length > 0
      ? extractHostFromAddress(publicAddress)
      : localMember.getAddress().getHost();
    return new Address(host, port);
  }

  private _syncLocalMemberEndpoints(): void {
    const localMember = this.getCluster().getLocalMember();
    const restAddress = this._buildAdvertisedRestAddress(localMember);
    const clientAddress = this._buildAdvertisedClientAddress(localMember);
    const addressMap = localMember.getAddressMap();

    for (const qualifier of addressMap.keys()) {
      if (
        qualifier.type === EndpointQualifier.REST.type
        || qualifier.type === EndpointQualifier.CLIENT.type
      ) {
        addressMap.delete(qualifier);
      }
    }

    if (clientAddress !== null) {
      addressMap.set(EndpointQualifier.CLIENT, clientAddress);
    }

    if (restAddress !== null) {
      const host = extractHostFromAddress(restAddress);
      const port = this._restServer.getBoundPort();
      addressMap.set(EndpointQualifier.REST, new Address(host, port));
    }

    this._clusterCoordinator?.updateLocalEndpoints({
      restEndpoint: addressMap.get(EndpointQualifier.REST) ?? null,
      clientEndpoint: addressMap.get(EndpointQualifier.CLIENT) ?? null,
    });
  }

  private _publishClientTopology(): void {
    const topologyPublisher = this._topologyPublisher;
    if (topologyPublisher === null) {
      return;
    }

    topologyPublisher.publishMemberListUpdate(this._buildClientTopologyMembers());
    topologyPublisher.publishPartitionTableUpdate(this._buildClientPartitionOwnership());
  }

  private _buildClientTopologyMembers(): MemberInfo[] {
    return this.getCluster().getMembers().map((member) => new MemberInfo(
      this._resolveClientVisibleMemberAddress(member),
      member.getUuid(),
      member.getAttributes(),
      member.isLiteMember(),
      member.getVersion().isUnknown()
        ? new MemberVersion(5, 5, 0)
        : member.getVersion(),
      member.getAddressMap(),
    ));
  }

  private _resolveClientVisibleMemberAddress(member: Member): Address {
    for (const [qualifier, address] of member.getAddressMap()) {
      if (qualifier.type === EndpointQualifier.CLIENT.type) {
        return address;
      }
    }

    return member.getAddress();
  }

  private _buildClientPartitionOwnership(): Map<number, string | null> {
    const partitionOwnership = new Map<number, string | null>();
    const partitionService = this._clusterCoordinator?.getInternalPartitionService() ?? null;
    if (partitionService === null) {
      const localMemberId = this.getCluster().getLocalMember().getUuid();
      for (let partitionId = 0; partitionId < this.getPartitionCount(); partitionId++) {
        partitionOwnership.set(partitionId, localMemberId);
      }
      return partitionOwnership;
    }

    for (let partitionId = 0; partitionId < partitionService.getPartitionCount(); partitionId++) {
      partitionOwnership.set(
        partitionId,
        partitionService.getPartitionOwner(partitionId)?.uuid() ?? null,
      );
    }
    return partitionOwnership;
  }

  private _getMemberRestAdvertisement(
    member: Member,
    localMember: Member | null,
  ): { port: number; url: string } | null {
    if (localMember !== null) {
      const localRestAddress = this._buildAdvertisedRestAddress(localMember);
      if (localRestAddress === null) {
        return null;
      }

      return {
        port: this._restServer.getBoundPort(),
        url: localRestAddress,
      };
    }

    for (const [qualifier, address] of member.getAddressMap()) {
      if (qualifier.type !== EndpointQualifier.REST.type) {
        continue;
      }

      return {
        port: address.getPort(),
        url: `http://${formatUrlHost(address.getHost())}:${address.getPort()}`,
      };
    }

    return null;
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

  private _getMigrationMetrics(): MigrationMetrics {
    const stats = this._migrationManager?.getStats();
    return {
      migrationQueueSize: stats?.migrationQueueSize ?? 0,
      activeMigrations: stats?.activeMigrations ?? 0,
      completedMigrations: stats?.completedMigrations ?? 0,
    };
  }

  private _getOperationMetrics(): OperationMetrics {
    const stats = this._operationServiceImpl?.getStats();
    return {
      queueSize: stats?.queueSize ?? 0,
      runningCount: stats?.runningCount ?? 0,
      completedCount: stats?.completedCount ?? 0,
    };
  }

  /**
   * Invocation capacity — mirrors Hazelcast's maxAllowedInvocations configuration.
   * Hazelcast defaults to partitionCount × 100 + genericQueueCapacity; we use a
   * conservative constant that matches the BackpressureRegulator's practical limit.
   */
  private static readonly _MAX_CONCURRENT_INVOCATIONS = 100_000;

  private _getInvocationMetrics(): InvocationMetrics {
    const pendingCount = this._invocationMonitor.activeCount();
    const maxConcurrent = HeliosInstanceImpl._MAX_CONCURRENT_INVOCATIONS;
    const usedPercentage = Math.round((pendingCount / maxConcurrent) * 10_000) / 100;
    const stats = this._invocationMonitor.getStats();
    return {
      pendingCount,
      maxConcurrent,
      usedPercentage,
      timeoutFailures: stats.timeoutFailures,
      memberLeftFailures: stats.memberLeftFailures,
    };
  }

  private _getBlitzMetrics(): BlitzMetrics | null {
    const manager = this.getBlitzLifecycleManager();
    if (manager === null) return null;

    const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);

    return {
      clusterSize: blitzService?.getClusterSize?.() ?? 1,
      isReady: this.isBlitzReady(),
      readinessState: manager.getReadinessState(),
      runningPipelines: blitzService?.getRunningJobCount?.() ?? 0,
      jetStreamReady: blitzService?.jsm !== undefined,
      jobCounters: this._getJobCounterMetrics(),
    };
  }

  private _getJobCounterMetrics(): JobCounterMetrics | null {
    const blitzService = this.getBlitzServiceForBridge() as (BlitzServiceLike | null);
    const counters = blitzService?.getJobCounters?.();
    if (counters === undefined) return null;
    return {
      submitted: counters.submitted,
      completedSuccessfully: counters.completedSuccessfully,
      completedWithFailure: counters.completedWithFailure,
      executionStarted: counters.executionStarted,
    };
  }
}
