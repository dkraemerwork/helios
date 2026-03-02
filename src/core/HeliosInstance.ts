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
import type { HeliosConfig } from '@helios/config/HeliosConfig';

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

    /** Shuts down this instance. */
    shutdown(): void;
}
