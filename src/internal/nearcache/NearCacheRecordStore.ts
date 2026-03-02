/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCacheRecordStore}.
 *
 * Contract point to store keys and values as NearCacheRecord internally.
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { NearCacheRecord } from '@helios/internal/nearcache/NearCacheRecord';
import type { NearCacheStats } from '@helios/nearcache/NearCacheStats';
import type { StaleReadDetector } from '@helios/internal/nearcache/impl/invalidation/StaleReadDetector';
import type { UpdateSemantic } from '@helios/internal/nearcache/NearCache';

export interface NearCacheRecordStore<K = unknown, V = unknown> {
    initialize(): void;

    get(key: K): V | null;
    put(key: K, keyData: Data | null, value: V | null, valueData: Data | null): void;

    tryReserveForUpdate(key: K, keyData: Data | null, updateSemantic?: UpdateSemantic): number;
    tryPublishReserved(key: K, value: V | null, reservationId: number, deserialize?: boolean): V | null;

    invalidate(key: K): void;
    clear(): void;
    destroy(): void;

    size(): number;
    getRecord(key: K): NearCacheRecord | null;
    getNearCacheStats(): NearCacheStats;

    doExpiration(): void;
    doEviction(withoutMaxSizeCheck: boolean): boolean;

    loadKeys(adapter: unknown): void;
    storeKeys(): void;

    setStaleReadDetector(detector: StaleReadDetector): void;
}
