/**
 * Public entrypoint for the Helios remote client.
 *
 * Port of com.hazelcast.client.HazelcastClient.
 *
 * HeliosClient implements HeliosInstance as the locked product contract.
 * Methods that are not yet remotely viable throw UnsupportedOperationError
 * until the corresponding runtime phase delivers them.
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

  constructor(config?: ClientConfig) {
    this._config = config ?? new ClientConfig();
    this._name = this._config.getName();
    this._lifecycleService = new ClientLifecycleService();
    this._serializationService = createClientSerializationService(this._config);
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

  // ── Proxy methods — awaiting Block 20.6 proxy manager + remote proxies ──

  getMap<K, V>(_name: string): IMap<K, V> {
    this._ensureActive();
    throw new Error("HeliosClient.getMap() is not yet implemented — awaiting Block 20.6 proxy manager and remote proxy runtime");
  }

  getQueue<E>(_name: string): IQueue<E> {
    this._ensureActive();
    throw new Error("HeliosClient.getQueue() is not yet implemented — awaiting Block 20.6 proxy manager and remote proxy runtime");
  }

  getTopic<E>(_name: string): ITopic<E> {
    this._ensureActive();
    throw new Error("HeliosClient.getTopic() is not yet implemented — awaiting Block 20.6 proxy manager and remote proxy runtime");
  }

  getReliableTopic<E>(_name: string): ITopic<E> {
    this._ensureActive();
    throw new Error("HeliosClient.getReliableTopic() is not yet implemented — awaiting Block 20.6 proxy manager and remote proxy runtime");
  }

  getDistributedObject(_serviceName: string, _name: string): DistributedObject {
    this._ensureActive();
    throw new Error("HeliosClient.getDistributedObject() is not yet implemented — awaiting Block 20.6 proxy manager");
  }

  getCluster(): Cluster {
    this._ensureActive();
    throw new Error("HeliosClient.getCluster() is not yet implemented — awaiting Block 20.6 cluster service");
  }

  getExecutorService(_name: string): IExecutorService {
    this._ensureActive();
    throw new Error("HeliosClient.getExecutorService() is not yet implemented — awaiting Block 20.6 proxy manager and remote executor proxy");
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private _ensureActive(): void {
    if (!this._lifecycleService.isRunning()) {
      throw new Error("HeliosClient is not active");
    }
  }

  private _doShutdown(removeFromRegistry: boolean): void {
    if (!this._lifecycleService.isRunning()) return;
    this._lifecycleService.shutdown();
    this._serializationService.destroy();
    if (removeFromRegistry) {
      CLIENTS.delete(this._name);
    }
  }
}
