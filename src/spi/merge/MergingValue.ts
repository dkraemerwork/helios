/**
 * Port of Hazelcast's MergingValue/MergingEntry/MergingHits etc.
 * These interfaces carry the data needed by merge policies.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export interface MergingValue {
    /** The serialized value. */
    getValue(): Data | null;
    /** Deserialized value (lazy). */
    getDeserializedValue<V>(): V | null;
}

export interface MergingKey extends MergingValue {
    /** The serialized key. */
    getKey(): Data;
    /** Deserialized key (lazy). */
    getDeserializedKey<K>(): K;
}

export interface MergingEntry extends MergingKey {
    // Combines key + value
}

export interface MergingHits {
    /** Number of hits (accesses) on this entry. */
    getHits(): number;
}

export interface MergingCreationTime {
    getCreationTime(): number;
}

export interface MergingLastAccessTime {
    getLastAccessTime(): number;
}

export interface MergingLastUpdateTime {
    getLastUpdateTime(): number;
}

export interface MergingExpirationTime {
    getExpirationTime(): number;
}

export interface MergingTtl {
    getTtl(): number;
}

export interface MergingMaxIdle {
    getMaxIdle(): number;
}

export interface MergingVersion {
    getVersion(): number;
}

/** Full merge data carrier with all stats. */
export interface SplitBrainMergeData extends MergingEntry, MergingHits, MergingCreationTime,
    MergingLastAccessTime, MergingLastUpdateTime, MergingExpirationTime, MergingVersion {
}
