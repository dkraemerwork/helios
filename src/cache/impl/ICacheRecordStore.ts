/**
 * Port of {@code com.hazelcast.cache.impl.ICacheRecordStore}.
 * Per-partition key→value cache storage contract.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export interface ICacheRecordStore {
    /**
     * Gets the value for {@code key}, respecting the given {@code expiryPolicy} (or null for default).
     * Returns a {@code Data} instance in BINARY format, the deserialized object in OBJECT format,
     * or {@code null} if the key is absent.
     */
    get(key: Data, expiryPolicy: unknown): unknown;

    /**
     * Associates {@code value} with {@code key}.
     * {@code expiryPolicy} may be null to use the cache-default.
     * {@code caller} is the UUID of the invoking member (may be null).
     * {@code completionId} is used for event notification (-1 = no event).
     */
    put(key: Data, value: unknown, expiryPolicy: unknown, caller: unknown, completionId: number): void;

    /**
     * Removes the mapping for {@code key}.
     */
    remove(key: Data, expiryPolicy: unknown, caller: unknown, completionId: number): boolean;

    /** Returns {@code true} if the store contains a live mapping for {@code key}. */
    contains(key: Data): boolean;

    /** Returns the number of entries in the store. */
    size(): number;

    /** Removes all entries. */
    clear(): void;

    /**
     * Associates the given {@code expiryPolicyOrData} with all keys in {@code keys}.
     * In BINARY mode the policy is expected as {@code Data}; in OBJECT mode as an object.
     */
    setExpiryPolicy(keys: Set<Data>, expiryPolicyOrData: unknown, caller: unknown): boolean;

    /**
     * Returns the expiry policy stored for {@code key}.
     * Returns {@code Data} in BINARY format or the policy object in OBJECT format.
     */
    getExpiryPolicy(key: Data): unknown;
}
