/**
 * Port of {@code com.hazelcast.internal.networking.HandlerStatus}.
 */
export enum HandlerStatus {
    CLEAN = 'CLEAN',
    DIRTY = 'DIRTY',
    BLOCKED = 'BLOCKED',
}
