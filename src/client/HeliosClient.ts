/**
 * Public entrypoint for the Helios remote client.
 *
 * Port of com.hazelcast.client.HazelcastClient.
 *
 * HeliosClient implements HeliosInstance as the locked product contract.
 * All HeliosInstance methods that are not yet remotely viable throw
 * UnsupportedOperationError until the corresponding runtime phase delivers them.
 *
 * This class is the client product surface — the single import external
 * consumers use to connect to a Helios cluster.
 */
import type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
import type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { IList } from "@zenystx/helios-core/collection/IList";
import type { ISet } from "@zenystx/helios-core/collection/ISet";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";
import type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
import type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { IExecutorService } from "@zenystx/helios-core/executor/IExecutorService";
import { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

/**
 * Remote client for connecting to a Helios cluster.
 *
 * Implements HeliosInstance so external consumers have a single, stable
 * contract for both embedded members and remote clients.
 *
 * Methods that are not yet remotely implemented throw UnsupportedOperationError
 * with a clear message indicating the missing runtime phase.
 */
export class HeliosClient implements HeliosInstance {
  private readonly _config: ClientConfig;
  private readonly _name: string;

  constructor(config?: ClientConfig) {
    this._config = config ?? new ClientConfig();
    this._name = this._config.getName();
  }

  getName(): string {
    return this._name;
  }

  getConfig(): ClientConfig {
    return this._config;
  }

  getMap<K, V>(_name: string): IMap<K, V> {
    throw new Error("HeliosClient.getMap() is not yet implemented — blocked on Phase 20 remote proxy runtime");
  }

  getQueue<E>(_name: string): IQueue<E> {
    throw new Error("HeliosClient.getQueue() is not yet implemented — blocked on Phase 20 remote proxy runtime");
  }

  getList<E>(_name: string): IList<E> {
    throw new Error("HeliosClient.getList() is not yet implemented — blocked on server-side distributed list semantics");
  }

  getSet<E>(_name: string): ISet<E> {
    throw new Error("HeliosClient.getSet() is not yet implemented — blocked on server-side distributed set semantics");
  }

  getTopic<E>(_name: string): ITopic<E> {
    throw new Error("HeliosClient.getTopic() is not yet implemented — blocked on Phase 20 remote proxy runtime");
  }

  getReliableTopic<E>(_name: string): ITopic<E> {
    throw new Error("HeliosClient.getReliableTopic() is not yet implemented — blocked on server-side reliable topic runtime");
  }

  getMultiMap<K, V>(_name: string): MultiMap<K, V> {
    throw new Error("HeliosClient.getMultiMap() is not yet implemented — blocked on server-side distributed multimap semantics");
  }

  getReplicatedMap<K, V>(_name: string): ReplicatedMap<K, V> {
    throw new Error("HeliosClient.getReplicatedMap() is not yet implemented — blocked on server-side replicated map runtime");
  }

  getDistributedObject(_serviceName: string, _name: string): DistributedObject {
    throw new Error("HeliosClient.getDistributedObject() is not yet implemented — blocked on Phase 20 proxy manager");
  }

  getLifecycleService(): LifecycleService {
    throw new Error("HeliosClient.getLifecycleService() is not yet implemented — blocked on Phase 20 client lifecycle");
  }

  getCluster(): Cluster {
    throw new Error("HeliosClient.getCluster() is not yet implemented — blocked on Phase 20 cluster service");
  }

  getExecutorService(_name: string): IExecutorService {
    throw new Error("HeliosClient.getExecutorService() is not yet implemented — blocked on server-side remote executor runtime");
  }

  shutdown(): void {
    // Minimal shutdown — real implementation comes in Phase 20 connection/lifecycle blocks
  }
}
