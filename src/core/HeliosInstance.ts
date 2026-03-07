import type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
import type { IQueue } from "@zenystx/helios-core/collection/IQueue";
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
import type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
import type { IMap } from "@zenystx/helios-core/map/IMap";
import type { ITopic } from "@zenystx/helios-core/topic/ITopic";

/**
 * Primary interface for a Helios cluster member or client.
 * Port of com.hazelcast.core.HazelcastInstance.
 *
 * This contract is shared between HeliosInstanceImpl (member) and HeliosClient
 * (remote client). Only methods with real distributed server-side runtime are
 * included. Member-only data structures (IList, ISet, MultiMap, ReplicatedMap)
 * that currently lack distributed service infrastructure are available only on
 * HeliosInstanceImpl directly and are not part of this shared contract.
 */
export interface HeliosInstance {
  /** Returns the name of this instance. */
  getName(): string;

  /** Returns the distributed map with the given name. */
  getMap<K, V>(name: string): IMap<K, V>;

  /** Returns the distributed queue with the given name. */
  getQueue<E>(name: string): IQueue<E>;

  /** Returns the distributed topic with the given name. */
  getTopic<E>(name: string): ITopic<E>;

  /**
   * Returns a distributed object by service name and object name.
   * Members may support additional service names beyond the shared remote-client
   * contract; remote clients retain only map, queue, and topic here.
   * @throws Error if the service name is not recognised or not retained.
   */
  getDistributedObject(serviceName: string, name: string): DistributedObject;

  /** Returns the lifecycle service for this instance. */
  getLifecycleService(): LifecycleService;

  /** Returns the cluster view. */
  getCluster(): Cluster;

  /** Returns the configuration for this instance. */
  getConfig(): InstanceConfig;

  /** Shuts down this instance. */
  shutdown(): void;
}
