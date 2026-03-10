/**
 * Public entrypoint for the Helios remote client.
 *
 * Port of com.hazelcast.client.HazelcastClient.
 *
 * HeliosClient implements HeliosInstance as the locked product contract.
 * Proxy creation is managed by ProxyManager for stable instance caching
 * and proper lifecycle cleanup.
 *
 * Static methods provide named-client registry and shutdown-all management.
 */
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig.js";
import { ClientConnectionManager } from "@zenystx/helios-core/client/connection/ClientConnectionManager.js";
import { ClientLifecycleService } from "@zenystx/helios-core/client/impl/lifecycle/ClientLifecycleService.js";
import { ClientNearCacheManager } from "@zenystx/helios-core/client/impl/nearcache/ClientNearCacheManager.js";
import { createClientSerializationService } from "@zenystx/helios-core/client/impl/serialization/ClientSerializationService.js";
import { ClientInvocationService } from "@zenystx/helios-core/client/invocation/ClientInvocationService.js";
import { ProxyManager } from "@zenystx/helios-core/client/proxy/ProxyManager.js";
import { ClientClusterService } from "@zenystx/helios-core/client/spi/ClientClusterService.js";
import { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService.js";
import { validateClientConfig } from "@zenystx/helios-core/config/ConfigValidator.js";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { Member } from "@zenystx/helios-core/cluster/Member";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";

const MAP_SERVICE = "hz:impl:mapService";
const QUEUE_SERVICE = "hz:impl:queueService";
const TOPIC_SERVICE = "hz:impl:topicService";
const RELIABLE_TOPIC_SERVICE = "hz:impl:reliableTopicService";
const EXECUTOR_SERVICE = "hz:impl:executorService";

const RETAINED_DISTRIBUTED_OBJECT_SERVICES = new Set<string>([
    MAP_SERVICE,
    QUEUE_SERVICE,
    TOPIC_SERVICE,
]);

const NOT_RETAINED_DISTRIBUTED_OBJECT_SERVICES = new Set<string>([
    RELIABLE_TOPIC_SERVICE,
    EXECUTOR_SERVICE,
]);

/**
 * Advanced remote-client capabilities intentionally excluded from the current
 * shared contract. Exported for transparency so unsupported features stay
 * explicit instead of surfacing as half-wired runtime stubs.
 */
export const DEFERRED_CLIENT_FEATURES: readonly string[] = Object.freeze([
    'cache',
    'query-cache',
    'transactions',
    'sql',
    'reliable-topic-client',
    'executor',
    'pn-counter',
    'flake-id-generator',
    'scheduled-executor',
    'cardinality-estimator',
]);

// ── Named-client registry (static) ──────────────────────────────────────────

const CLIENTS = new Map<string, HeliosClient>();

/**
 * Remote client for connecting to a Helios cluster.
 *
 * Implements HeliosInstance so external consumers have a single, stable
 * contract for both embedded members and remote clients.
 */
export class HeliosClient implements HeliosInstance {
    private readonly _config: ClientConfig;
    private readonly _name: string;
    private readonly _lifecycleService: ClientLifecycleService;
    private readonly _serializationService: SerializationServiceImpl;
    private readonly _partitionService: ClientPartitionService;
    private readonly _proxyManager: ProxyManager;
    private readonly _nearCacheManager: ClientNearCacheManager;
    private readonly _clusterService: ClientClusterService;
    private _connectionManager: ClientConnectionManager | null = null;
    private _invocationService: ClientInvocationService | null = null;

    constructor(config?: ClientConfig) {
        this._config = config ?? new ClientConfig();
        this._name = this._config.getName();
        this._lifecycleService = new ClientLifecycleService();
        this._serializationService = createClientSerializationService(this._config);
        this._partitionService = new ClientPartitionService();
        this._nearCacheManager = new ClientNearCacheManager(this._serializationService);
        this._clusterService = new ClientClusterService();
        this._proxyManager = new ProxyManager(
            this._serializationService,
            this._partitionService,
            null, // invocation service — set after connect()
        );
        this._proxyManager.setNearCacheManager(this._nearCacheManager);
        this._proxyManager.setClientConfig(this._config);
    }

    // ── Static factory / registry ────────────────────────────────────────────

    static newHeliosClient(config?: ClientConfig): HeliosClient {
        const cfg = config ?? new ClientConfig();
        const name = cfg.getName();
        if (CLIENTS.has(name)) {
            throw new Error(`HeliosClient with name "${name}" already exists in the registry`);
        }
        const client = new HeliosClient(cfg);
        CLIENTS.set(name, client);
        return client;
    }

    static getHeliosClientByName(name: string): HeliosClient | null {
        return CLIENTS.get(name) ?? null;
    }

    static shutdownAll(): void {
        for (const client of CLIENTS.values()) {
            client._doShutdown(false);
        }
        CLIENTS.clear();
    }

    static getAllHeliosClients(): readonly HeliosClient[] {
        return [...CLIENTS.values()];
    }

    // ── HeliosInstance contract ──────────────────────────────────────────────

    getName(): string {
        return this._name;
    }

    getConfig(): ClientConfig {
        return this._config;
    }

    getLifecycleService(): LifecycleService {
        return this._lifecycleService;
    }

    getSerializationService(): SerializationServiceImpl {
        return this._serializationService;
    }

    getNearCacheManager(): ClientNearCacheManager {
        return this._nearCacheManager;
    }

    shutdown(): void {
        this._doShutdown(true);
    }

    /**
     * Connect to the cluster using the binary client protocol.
     * Establishes a TCP connection, authenticates, and wires the invocation
     * service so proxy operations route through real network calls.
     */
    async connect(): Promise<void> {
        // Validate configuration eagerly — fail fast with a clear error message
        // before any network activity is attempted.
        validateClientConfig(this._config);

        const connMgr = new ClientConnectionManager(this._config);
        connMgr.setClusterService(this._clusterService);
        connMgr.setPartitionService(this._partitionService);
        connMgr.setListenerService(this._proxyManager.getListenerService());
        await connMgr.start();
        await connMgr.connectToCluster();
        this._connectionManager = connMgr;

        const invSvc = new ClientInvocationService(connMgr, this._config);
        invSvc.start();
        this._invocationService = invSvc;

        this._proxyManager.setInvocationService(invSvc);
    }

    // ── Proxy methods — routed through ProxyManager ──

    getMap<K, V>(name: string): IMap<K, V> {
        this._ensureActive();
        return this._proxyManager.getOrCreateProxy(MAP_SERVICE, name) as unknown as IMap<K, V>;
    }

    getQueue<E>(name: string): IQueue<E> {
        this._ensureActive();
        return this._proxyManager.getOrCreateProxy(QUEUE_SERVICE, name) as unknown as IQueue<E>;
    }

    getTopic<E>(name: string): ITopic<E> {
        this._ensureActive();
        return this._proxyManager.getOrCreateProxy(TOPIC_SERVICE, name) as unknown as ITopic<E>;
    }

    getDistributedObject(serviceName: string, name: string): DistributedObject {
        this._ensureActive();
        if (NOT_RETAINED_DISTRIBUTED_OBJECT_SERVICES.has(serviceName)) {
            throw new Error(
                `HeliosClient.getDistributedObject() does not support service "${serviceName}" because that distributed object is not retained on the remote-client contract`,
            );
        }
        if (!RETAINED_DISTRIBUTED_OBJECT_SERVICES.has(serviceName)) {
            throw new Error(
                `HeliosClient.getDistributedObject() supports only retained remote services: ${Array.from(RETAINED_DISTRIBUTED_OBJECT_SERVICES).join(", ")}. Received: "${serviceName}"`,
            );
        }
        return this._proxyManager.getOrCreateProxy(serviceName, name);
    }

    getCluster(): Cluster {
        this._ensureActive();
        const svc = this._clusterService;
        return {
            getMembers(): Member[] {
                return svc.getMemberList().map((mi) => mi.toMember());
            },
            getLocalMember(): Member {
                const members = svc.getMemberList();
                if (members.length === 0) {
                    throw new Error("Client is not connected to any cluster member");
                }
                // Client has no true "local" member — return first member as convention
                return members[0].toMember();
            },
        };
    }

    // ── Internal ────────────────────────────────────────────────────────────

    private _ensureActive(): void {
        if (!this._lifecycleService.isRunning()) {
            throw new Error("HeliosClient is not active");
        }
    }

    private _doShutdown(removeFromRegistry: boolean): void {
        if (!this._lifecycleService.isRunning()) return;
        this._proxyManager.destroyAll();
        this._nearCacheManager.destroyAllNearCaches();
        this._connectionManager?.shutdown().catch(() => {});
        this._connectionManager = null;
        this._invocationService = null;
        this._lifecycleService.shutdown();
        this._serializationService.destroy();
        if (removeFromRegistry) {
            CLIENTS.delete(this._name);
        }
    }
}
