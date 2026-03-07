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
import type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";

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
  getConfig(): InstanceConfig;

  /** Returns the distributed executor service with the given name. */
  getExecutorService(name: string): IExecutorService;

  /** Shuts down this instance. */
  shutdown(): void;
}
