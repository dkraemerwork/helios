/**
 * REST endpoint groups supported by the built-in Helios REST API.
 * Mirrors com.hazelcast.internal.management.dto.MCEventDTO / RestEndpointGroup.
 */
export enum RestEndpointGroup {
    /** Health-check probes — /hazelcast/health/* — enabled by default. */
    HEALTH_CHECK = 'HEALTH_CHECK',
    /** Read-only cluster information — /hazelcast/rest/cluster, /instance — enabled by default. */
    CLUSTER_READ = 'CLUSTER_READ',
    /** Mutating cluster operations — log-level, member shutdown — disabled by default. */
    CLUSTER_WRITE = 'CLUSTER_WRITE',
    /** IMap/IQueue CRUD over REST — disabled by default. */
    DATA = 'DATA',
}
