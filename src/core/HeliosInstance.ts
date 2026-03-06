import type { IMap } from "@zenystx/core/map/IMap";
import type { IQueue } from "@zenystx/core/collection/IQueue";
import type { IList } from "@zenystx/core/collection/IList";
import type { ISet } from "@zenystx/core/collection/ISet";
import type { ITopic } from "@zenystx/core/topic/ITopic";
import type { MultiMap } from "@zenystx/core/multimap/MultiMap";
import type { ReplicatedMap } from "@zenystx/core/replicatedmap/ReplicatedMap";
import type { DistributedObject } from "@zenystx/core/core/DistributedObject";
import type { LifecycleService } from "@zenystx/core/instance/lifecycle/LifecycleService";
import type { Cluster } from "@zenystx/core/cluster/Cluster";
import type { IExecutorService } from "@zenystx/core/executor/IExecutorService";
import type { HeliosConfig } from "@zenystx/core/config/HeliosConfig";

/**
 * Primary interface for a Helios cluster member or client.
 * Port of com.hazelcast.core.HazelcastInstance.
 */
export interface HeliosInstance {
  /** Returns the name of this instance. */
  getName(): string;

  /** Returns the distributed map with the given name. */
  getMap<K, V>(name: string): IMap<K, V>;

  /** Returns the distributed queue with the given name. */
  getQueue<E>(name: string): IQueue<E>;

  /** Returns the distributed list with the given name. */
  getList<E>(name: string): IList<E>;

  /** Returns the distributed set with the given name. */
  getSet<E>(name: string): ISet<E>;

  /** Returns the distributed topic with the given name. */
  getTopic<E>(name: string): ITopic<E>;

  /** Returns the reliable topic with the given name. */
  getReliableTopic<E>(name: string): ITopic<E>;

  /** Returns the distributed multi-map with the given name. */
  getMultiMap<K, V>(name: string): MultiMap<K, V>;

  /** Returns the replicated map with the given name. */
  getReplicatedMap<K, V>(name: string): ReplicatedMap<K, V>;

  /**
   * Returns a distributed object by service name and object name.
   * @throws Error if the service name is not recognised.
   */
  getDistributedObject(serviceName: string, name: string): DistributedObject;

  /** Returns the lifecycle service for this instance. */
  getLifecycleService(): LifecycleService;

  /** Returns the cluster view. */
  getCluster(): Cluster;

  /** Returns the configuration for this instance. */
  getConfig(): HeliosConfig;

  /** Returns the distributed executor service with the given name. */
  getExecutorService(name: string): IExecutorService;

  /** Shuts down this instance. */
  shutdown(): void;
}
