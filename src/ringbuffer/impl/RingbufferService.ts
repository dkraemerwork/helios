import { RingbufferConfig } from '@zenystx/helios-core/config/RingbufferConfig';
import { DistributedObjectNamespace } from '@zenystx/helios-core/internal/services/DistributedObjectNamespace';
import type { ObjectNamespace } from '@zenystx/helios-core/internal/services/ObjectNamespace';
import { RingbufferContainer } from '@zenystx/helios-core/ringbuffer/impl/RingbufferContainer';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.RingbufferService}.
 *
 * Manages ringbuffer containers keyed by (partitionId, namespace).
 * Provides helper methods for namespace creation and partition routing.
 */
export class RingbufferService {
    static readonly SERVICE_NAME = 'hz:impl:ringbufferService';
    static readonly TOPIC_RB_PREFIX = '_hz_rb_';

    /** containers[partitionId][namespaceKey] → RingbufferContainer */
    private readonly containers = new Map<number, Map<string, RingbufferContainer>>();
    private nodeEngine!: NodeEngine;
    private readonly configs = new Map<string, RingbufferConfig>();

    constructor(nodeEngine: NodeEngine) {
        this.nodeEngine = nodeEngine;
    }

    /** Register a RingbufferConfig by name. */
    addRingbufferConfig(config: RingbufferConfig): void {
        this.configs.set(config.getName(), config);
    }

    /**
     * Returns the ObjectNamespace for a ringbuffer with the given name.
     */
    static getRingbufferNamespace(name: string): ObjectNamespace {
        return new DistributedObjectNamespace(RingbufferService.SERVICE_NAME, name);
    }

    /**
     * Returns the partition ID for a ringbuffer with the given name.
     * In single-node mode: hash-based, consistent with Hazelcast's approach.
     */
    getRingbufferPartitionId(name: string): number {
        return Math.abs(hashString(name)) % 271;
    }

    /**
     * Get or create a RingbufferContainer for the given partition and namespace.
     */
    getOrCreateContainer(
        partitionId: number,
        namespace: ObjectNamespace,
        config: RingbufferConfig,
    ): RingbufferContainer {
        const nsKey = namespaceKey(namespace);
        let partitionMap = this.containers.get(partitionId);
        if (partitionMap === undefined) {
            partitionMap = new Map<string, RingbufferContainer>();
            this.containers.set(partitionId, partitionMap);
        }
        let container = partitionMap.get(nsKey);
        if (container === undefined) {
            container = new RingbufferContainer(
                namespace,
                config,
                this.nodeEngine,
                partitionId,
            );
            partitionMap.set(nsKey, container);
        }
        return container;
    }

    /**
     * Returns the container for the given partition and namespace, or null.
     */
    getContainerOrNull(partitionId: number, namespace: ObjectNamespace): RingbufferContainer | null {
        const partitionMap = this.containers.get(partitionId);
        if (partitionMap === undefined) return null;
        return partitionMap.get(namespaceKey(namespace)) ?? null;
    }

    /**
     * Lookup the RingbufferConfig for the given name.
     * Falls back to a default config if not registered.
     */
    getRingbufferConfig(name: string): RingbufferConfig {
        return this.configs.get(name) ?? new RingbufferConfig(name);
    }
}

function namespaceKey(ns: ObjectNamespace): string {
    return `${ns.getServiceName()}::${ns.getObjectName()}`;
}

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h;
}
