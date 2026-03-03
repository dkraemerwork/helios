/**
 * Runtime state of a Helios node.
 *
 * Analogous to com.hazelcast.instance.impl.NodeState.
 * Used by REST health endpoints to report node readiness.
 */
export enum NodeState {
    STARTING = 'STARTING',
    ACTIVE = 'ACTIVE',
    PASSIVE = 'PASSIVE',
    SHUTTING_DOWN = 'SHUTTING_DOWN',
    TERMINATED = 'TERMINATED',
}
