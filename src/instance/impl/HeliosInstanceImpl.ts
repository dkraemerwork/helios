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
 * Block 7.5 addition: when NetworkConfig has TCP-IP join enabled, a
 * TcpClusterTransport is started and map mutations are broadcast to peers.
 */
import { NodeEngineImpl } from '@helios/spi/impl/NodeEngineImpl';
import { SerializationServiceImpl } from '@helios/internal/serialization/impl/SerializationServiceImpl';
import { SerializationConfig } from '@helios/internal/serialization/impl/SerializationConfig';
import { MapContainerService } from '@helios/map/impl/MapContainerService';
import { MapService } from '@helios/map/impl/MapService';
import { MapProxy } from '@helios/map/impl/MapProxy';
import { NetworkedMapProxy } from '@helios/map/impl/NetworkedMapProxy';
import { NearCachedIMapWrapper } from '@helios/map/impl/nearcache/NearCachedIMapWrapper';
import { TcpClusterTransport } from '@helios/cluster/tcp/TcpClusterTransport';
import { DefaultNearCacheManager } from '@helios/internal/nearcache/impl/DefaultNearCacheManager';
import { QueueImpl } from '@helios/collection/impl/QueueImpl';
import { ListImpl } from '@helios/collection/impl/ListImpl';
import { SetImpl } from '@helios/collection/impl/SetImpl';
import { TopicImpl } from '@helios/topic/impl/TopicImpl';
import { MultiMapImpl } from '@helios/multimap/impl/MultiMapImpl';
import { ReplicatedMapImpl } from '@helios/replicatedmap/impl/ReplicatedMapImpl';
import { HeliosLifecycleService } from '@helios/instance/lifecycle/HeliosLifecycleService';
import { LocalCluster } from '@helios/cluster/impl/LocalCluster';
import { HeliosConfig } from '@helios/config/HeliosConfig';
import { HeliosRestServer } from '@helios/rest/HeliosRestServer';
import { HealthCheckHandler } from '@helios/rest/handler/HealthCheckHandler';
import { ClusterReadHandler } from '@helios/rest/handler/ClusterReadHandler';
import { ClusterWriteHandler } from '@helios/rest/handler/ClusterWriteHandler';
import { DataHandler } from '@helios/rest/handler/DataHandler';
import type { DataHandlerMap, DataHandlerQueue, DataHandlerStore } from '@helios/rest/handler/DataHandler';
import { NodeState } from '@helios/instance/lifecycle/NodeState';
import type { HeliosInstance } from '@helios/core/HeliosInstance';
import type { IMap } from '@helios/map/IMap';
import type { IQueue } from '@helios/collection/IQueue';
import type { IList } from '@helios/collection/IList';
import type { ISet } from '@helios/collection/ISet';
import type { ITopic } from '@helios/topic/ITopic';
import type { MultiMap } from '@helios/multimap/MultiMap';
import type { ReplicatedMap } from '@helios/replicatedmap/ReplicatedMap';
import type { DistributedObject } from '@helios/core/DistributedObject';
import type { LifecycleService } from '@helios/instance/lifecycle/LifecycleService';
import type { Cluster } from '@helios/cluster/Cluster';
import type { MapConfig } from '@helios/config/MapConfig';

/** Service name constant for the distributed map service. */
const MAP_SERVICE_NAME = 'hz:impl:mapService';

/** Parse "host:port" or "host" (default port 5701). */
function parseMemberAddress(member: string): [string, number] {
    const trimmed = member.trim();
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon > 0 && lastColon < trimmed.length - 1) {
        const host = trimmed.substring(0, lastColon);
        const port = parseInt(trimmed.substring(lastColon + 1), 10);
        if (!isNaN(port)) return [host, port];
    }
    return [trimmed, 5701];
}

export class HeliosInstanceImpl implements HeliosInstance {
    private readonly _name: string;
    private readonly _config: HeliosConfig;
    private readonly _nodeEngine: NodeEngineImpl;
    private readonly _mapService: MapContainerService;
    private readonly _lifecycleService: HeliosLifecycleService;
    private readonly _cluster: LocalCluster;

    // Per-name data-structure caches (same name → same instance)
    private readonly _maps = new Map<string, MapProxy<unknown, unknown>>();
    private readonly _nearCachedMaps = new Map<string, NearCachedIMapWrapper<unknown, unknown>>();
    private readonly _queues = new Map<string, QueueImpl<unknown>>();
    private readonly _lists = new Map<string, ListImpl<unknown>>();
    private readonly _sets = new Map<string, SetImpl<unknown>>();
    private readonly _topics = new Map<string, TopicImpl<unknown>>();
    private readonly _multiMaps = new Map<string, MultiMapImpl<unknown, unknown>>();
    private readonly _replicatedMaps = new Map<string, ReplicatedMapImpl<unknown, unknown>>();

    /** TCP transport — non-null when TCP-IP join is enabled. */
    private _transport: TcpClusterTransport | null = null;

    /** Current log level (mutable via REST CLUSTER_WRITE). */
    private _logLevel: string = 'INFO';

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
    private readonly _invalidateCallbacks: Array<(mapName: string, key: unknown) => void> = [];

    private _running = true;

    /** Registered async shutdown hooks — awaited during shutdownAsync(). */
    private readonly _shutdownHooks: Array<() => Promise<void>> = [];

    constructor(config?: HeliosConfig) {
        this._config = config ?? new HeliosConfig();
        this._name = this._config.getName();

        // Production SerializationServiceImpl — single shared instance for NodeEngine + NearCacheManager.
        const serializationConfig = new SerializationConfig();
        this._ss = new SerializationServiceImpl(serializationConfig);
        this._nodeEngine = new NodeEngineImpl(this._ss);

        // Register MapContainerService
        this._mapService = new MapContainerService();
        this._mapService.setNodeEngine(this._nodeEngine);
        this._nodeEngine.registerService(MapService.SERVICE_NAME, this._mapService);

        // Near-cache manager — shares the same serialization service as the node engine
        this._nearCacheManager = new DefaultNearCacheManager(this._ss);

        // Lifecycle and cluster
        this._lifecycleService = new HeliosLifecycleService();
        this._cluster = new LocalCluster();

        // Start TCP networking if configured
        this._startNetworking();

        // Start built-in REST server if configured
        this._restServer = new HeliosRestServer(this._config.getNetworkConfig().getRestApiConfig());
        const healthHandler = new HealthCheckHandler(this);
        this._restServer.registerHandler('/hazelcast/health', (req) => healthHandler.handle(req));

        const clusterReadHandler = new ClusterReadHandler(this);
        this._restServer.registerHandler('/hazelcast/rest/cluster', (req) => clusterReadHandler.handle(req));
        this._restServer.registerHandler('/hazelcast/rest/instance', (req) => clusterReadHandler.handle(req));

        const clusterWriteHandler = new ClusterWriteHandler(this);
        this._restServer.registerHandler('/hazelcast/rest/log-level', (req) => clusterWriteHandler.handle(req));
        this._restServer.registerHandler('/hazelcast/rest/management', (req) => clusterWriteHandler.handle(req));

        const dataHandler = new DataHandler(this._makeDataStore());
        this._restServer.registerHandler('/hazelcast/rest/maps', (req) => dataHandler.handle(req));
        this._restServer.registerHandler('/hazelcast/rest/queues', (req) => dataHandler.handle(req));

        this._restServer.start();
    }

    // ── TCP networking ───────────────────────────────────────────────────

    private _startNetworking(): void {
        const tcpIp = this._config.getNetworkConfig().getJoin().getTcpIpConfig();
        if (!tcpIp.isEnabled()) return;

        const port = this._config.getNetworkConfig().getPort();
        this._transport = new TcpClusterTransport(this._name);
        this._transport.start(port, '0.0.0.0');

        // Wire transport callbacks
        this._transport.onRemotePut = (mapName, key, value) => {
            this._applyRemotePut(mapName, key, value);
        };
        this._transport.onRemoteRemove = (mapName, key) => {
            this._applyRemoteRemove(mapName, key);
        };
        this._transport.onRemoteClear = (mapName) => {
            this._applyRemoteClear(mapName);
        };
        this._transport.onRemoteInvalidate = (mapName, key) => {
            // Invalidate near-cache entry for this map (if a near-cache exists)
            const nearCache = this._nearCacheManager.getNearCache(mapName);
            if (nearCache) {
                nearCache.invalidate(key);
            }

            // Fire external callbacks (test hooks, etc.)
            for (const cb of this._invalidateCallbacks) {
                cb(mapName, key);
            }
        };

        // Connect to configured peers (fire-and-forget)
        for (const member of tcpIp.getMembers()) {
            const [host, peerPort] = parseMemberAddress(member);
            this._transport.connectToPeer(host, peerPort).catch(() => {
                // Connection may fail transiently; callers use waitForPeers() to poll
            });
        }
    }

    private _applyRemotePut(mapName: string, key: unknown, value: unknown): void {
        const proxy = this._maps.get(mapName);
        if (proxy instanceof NetworkedMapProxy) {
            proxy.applyRemotePut(key as never, value as never);
        } else {
            // Map not yet accessed locally — apply directly to the correct partition store.
            const kd = this._nodeEngine.toData(key);
            const vd = this._nodeEngine.toData(value);
            if (kd !== null && vd !== null) {
                const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
                const store = this._mapService.getOrCreateRecordStore(mapName, partitionId);
                store.put(kd, vd, -1, -1);
            }
        }
    }

    private _applyRemoteRemove(mapName: string, key: unknown): void {
        const proxy = this._maps.get(mapName);
        if (proxy instanceof NetworkedMapProxy) {
            proxy.applyRemoteRemove(key as never);
        } else {
            const kd = this._nodeEngine.toData(key);
            if (kd !== null) {
                const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
                const store = this._mapService.getOrCreateRecordStore(mapName, partitionId);
                store.remove(kd);
            }
        }
    }

    private _applyRemoteClear(mapName: string): void {
        const proxy = this._maps.get(mapName);
        if (proxy instanceof NetworkedMapProxy) {
            proxy.applyRemoteClear();
        } else {
            // Clear all partitions for this map
            const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();
            for (let i = 0; i < partitionCount; i++) {
                const store = this._mapService.getRecordStore(mapName, i);
                if (store !== null) store.clear();
            }
        }
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
        // Await all registered hooks (e.g., executor drain)
        await Promise.allSettled(this._shutdownHooks.map(h => h()));
        this.shutdown();
    }

    shutdown(): void {
        this._running = false;
        for (const topic of this._topics.values()) topic.destroy();
        for (const rm of this._replicatedMaps.values()) rm.destroy();
        this._nearCachedMaps.clear();
        this._nearCacheManager.destroyAllNearCaches();
        // Flush all MapStore contexts (fire-and-forget; write-behind entries flushed)
        this._mapService.flushAll().catch(() => {});
        this._maps.clear();
        this._queues.clear();
        this._lists.clear();
        this._sets.clear();
        this._topics.clear();
        this._multiMaps.clear();
        this._replicatedMaps.clear();
        this._lifecycleService.shutdown();
        this._nodeEngine.shutdown();
        this._ss.destroy();
        this._transport?.shutdown();
        this._transport = null;
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
        this._logLevel = 'INFO';
    }

    // ── DataHandlerStore factory ───────────────────────────────────────────────

    private _makeDataStore(): DataHandlerStore {
        return {
            getMap: async (name: string) => {
                const proxy = this._getOrCreateProxy(name);
                const map: DataHandlerMap = {
                    get: (key: string) => proxy.get(key as never) as Promise<unknown>,
                    put: (key: string, value: unknown) => proxy.put(key as never, value as never) as Promise<unknown>,
                    remove: (key: string) => proxy.remove(key as never) as Promise<unknown>,
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
        return 'ACTIVE';
    }

    isClusterSafe(): boolean {
        return true;
    }

    getClusterSize(): number {
        return this._cluster.getMembers().length;
    }

    getMemberVersion(): string {
        return '1.0.0';
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

    // ── Near-cache access ─────────────────────────────────────────────────────

    /** Returns the near-cache manager for observability / testing. */
    getNearCacheManager(): DefaultNearCacheManager {
        return this._nearCacheManager;
    }

    // ── Config helpers ───────────────────────────────────────────────────────

    /**
     * Returns the MapConfig registered for the given name, or null.
     */
    getMapConfig(name: string): MapConfig | null {
        return this._config.getMapConfig(name);
    }

    // ── Data-structure accessors ─────────────────────────────────────────────

    getMap<K, V>(name: string): IMap<K, V> {
        // If a NearCacheConfig is registered for this map, return a near-cache-wrapped version
        const nearCacheConfig = this._config.getMapConfig(name)?.getNearCacheConfig();
        if (nearCacheConfig) {
            let wrapped = this._nearCachedMaps.get(name);
            if (!wrapped) {
                const proxy = this._getOrCreateProxy(name);
                const nearCache = this._nearCacheManager.getOrCreateNearCache<unknown, unknown>(name, nearCacheConfig);
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
            const mapStoreConfig = this._config.getMapConfig(name)?.getMapStoreConfig();
            if (this._transport !== null) {
                proxy = new NetworkedMapProxy<unknown, unknown>(
                    name, store, this._nodeEngine, this._mapService, this._transport, mapStoreConfig,
                );
            } else {
                proxy = new MapProxy<unknown, unknown>(name, store, this._nodeEngine, this._mapService, mapStoreConfig);
            }
            this._maps.set(name, proxy);
        }
        return proxy;
    }

    getQueue<E>(name: string): IQueue<E> {
        let queue = this._queues.get(name);
        if (!queue) {
            queue = new QueueImpl<unknown>();
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
            topic = new TopicImpl<unknown>(name);
            this._topics.set(name, topic);
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

    getDistributedObject(serviceName: string, name: string): DistributedObject {
        if (serviceName === MAP_SERVICE_NAME) {
            this.getMap<unknown, unknown>(name);
            return {
                getName: () => name,
                getServiceName: () => MAP_SERVICE_NAME,
                destroy: async () => { /* no-op for in-memory map */ },
            };
        }
        throw new Error(`Unknown distributed object service: '${serviceName}'`);
    }

    // ── Deferred service stubs ───────────────────────────────────────────────
    // These services are deferred to future versions. They are exposed as stubs
    // so callers receive a clear error rather than "not a function".

    getSql(): never {
        throw new Error('SQL is not supported in this version (deferred to v2)');
    }

    getJet(): never {
        throw new Error('Jet streaming is not supported in this version (deferred to v1.5)');
    }

    getCPSubsystem(): never {
        throw new Error('CP subsystem is not supported in this version (deferred to v2)');
    }

    getScheduledExecutorService(_name: string): never {
        throw new Error('ScheduledExecutorService is not supported in this version (deferred to v2)');
    }
}
