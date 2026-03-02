/**
 * Port of {@code com.hazelcast.internal.services.ServiceNamespace}.
 * Namespace to group objects/structures/fragments within a service.
 */
export interface ServiceNamespace {
    getServiceName(): string;
}
