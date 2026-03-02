/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCache}.
 *
 * Contract point to store keys and values in an underlying NearCacheRecordStore.
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { NearCacheConfig } from '@helios/config/NearCacheConfig';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';

export const DEFAULT_EXPIRATION_TASK_INITIAL_DELAY_SECONDS = 5;
export const DEFAULT_EXPIRATION_TASK_PERIOD_SECONDS = 5;
export const DEFAULT_EXPIRATION_BATCH_SIZE = 500_000;
export const DEFAULT_EXPIRATION_TIME_LIMIT_MILLIS = 500;

/** Sentinel: value was cached as null. */
export const CACHED_AS_NULL: object = Object.freeze({});
/** Sentinel: key is not in the cache. */
export const NOT_CACHED: object = Object.freeze({});

/** Indicates how a Near Cache entry is updated. */
export type UpdateSemantic = 'READ_UPDATE' | 'WRITE_UPDATE';

export interface NearCache<K = unknown, V = unknown> {
    initialize(): void;

    getName(): string;
    getNearCacheConfig(): NearCacheConfig;

    get(key: K): V | null;
    put(key: K, keyData: Data | null, value: V | null, valueData: Data | null): void;
    invalidate(key: K): void;
    clear(): void;
    destroy(): void;

    size(): number;
    getNearCacheStats(): NearCacheStats;

    isSerializeKeys(): boolean;

    preload(adapter: unknown): void;
    storeKeys(): void;
    isPreloadDone(): boolean;

    unwrap<T>(clazz: new (...args: unknown[]) => T): T;

    tryReserveForUpdate(key: K, keyData: Data | null, updateSemantic: UpdateSemantic): number;
    tryPublishReserved(key: K, value: V | null, reservationId: number, deserialize: boolean): V | null;
}
