/**
 * Port of {@code com.hazelcast.internal.partition.impl.NameSpaceUtil}.
 * Helper for retrieving ServiceNamespace objects from partition containers.
 */
import type { ObjectNamespace } from '@helios/internal/services/ObjectNamespace';
import type { ServiceNamespace } from '@helios/internal/services/ServiceNamespace';

export class NameSpaceUtil {
    private constructor() {}

    /**
     * Returns a mutable Set of all service namespaces from containers matching the filter,
     * or an empty Set if none match.
     */
    static getAllNamespaces<T>(
        containers: Map<unknown, T>,
        containerFilter: (container: T) => boolean,
        toNamespace: (container: T) => ObjectNamespace,
    ): Set<ServiceNamespace> {
        if (!containers || containers.size === 0) {
            return new Set<ServiceNamespace>();
        }

        let collection: Set<ServiceNamespace> | null = null;
        for (const container of containers.values()) {
            if (!containerFilter(container)) continue;
            const namespace = toNamespace(container);
            if (collection == null) {
                collection = new Set<ServiceNamespace>();
            }
            collection.add(namespace);
        }

        return collection ?? new Set<ServiceNamespace>();
    }
}
