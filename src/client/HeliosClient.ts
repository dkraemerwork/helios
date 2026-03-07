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
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
import { ClientLifecycleService } from "@zenystx/helios-core/client/impl/lifecycle/ClientLifecycleService";
import { createClientSerializationService } from "@zenystx/helios-core/client/impl/serialization/ClientSerializationService";
import type { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import { ProxyManager } from "@zenystx/helios-core/client/proxy/ProxyManager";
import { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService";

const MAP_SERVICE = "hz:impl:mapService";
const QUEUE_SERVICE = "hz:impl:queueService";
const TOPIC_SERVICE = "hz:impl:topicService";
const RELIABLE_TOPIC_SERVICE = "hz:impl:reliableTopicService";
const EXECUTOR_SERVICE = "hz:impl:executorService";

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

  constructor(config?: ClientConfig) {
    this._config = config ?? new ClientConfig();
    this._name = this._config.getName();
    this._lifecycleService = new ClientLifecycleService();
    this._serializationService = createClientSerializationService(this._config);
    this._partitionService = new ClientPartitionService();
    this._proxyManager = new ProxyManager(
      this._serializationService,
      this._partitionService,
      null, // invocation service — set after connect()
    );
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

  shutdown(): void {
    this._doShutdown(true);
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

  getReliableTopic<E>(name: string): ITopic<E> {
    this._ensureActive();
    return this._proxyManager.getOrCreateProxy(RELIABLE_TOPIC_SERVICE, name) as unknown as ITopic<E>;
  }

  getDistributedObject(serviceName: string, name: string): DistributedObject {
    this._ensureActive();
    return this._proxyManager.getOrCreateProxy(serviceName, name);
  }

  getCluster(): Cluster {
    this._ensureActive();
    throw new Error("HeliosClient.getCluster() is not yet implemented — awaiting Block 20.7 cluster service wiring");
  }

  getExecutorService(name: string): IExecutorService {
    this._ensureActive();
    return this._proxyManager.getOrCreateProxy(EXECUTOR_SERVICE, name) as unknown as IExecutorService;
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
    this._lifecycleService.shutdown();
    this._serializationService.destroy();
    if (removeFromRegistry) {
      CLIENTS.delete(this._name);
    }
  }
}
