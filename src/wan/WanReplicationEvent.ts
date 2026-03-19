/**
 * Represents a single map mutation event captured for WAN replication.
 *
 * Carries the serialized key/value bytes so they can be transmitted
 * across the wire without depending on local serialization context.
 */
export interface WanReplicationEvent {
    /** Map the event originated from. */
    readonly mapName: string;
    /** Type of mutation: PUT, REMOVE, or CLEAR. */
    readonly eventType: 'PUT' | 'REMOVE' | 'CLEAR';
    /** Serialized key bytes; null for CLEAR events. */
    readonly key: Buffer | null;
    /** Serialized value bytes; null for REMOVE/CLEAR events. */
    readonly value: Buffer | null;
    /** TTL in milliseconds; 0 means no expiry. */
    readonly ttl: number;
    /** Wall-clock timestamp when the mutation occurred. */
    readonly timestamp: number;
}
