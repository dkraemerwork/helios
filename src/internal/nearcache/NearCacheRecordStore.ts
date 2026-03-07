/**
 * Port of {@code com.hazelcast.internal.nearcache.NearCacheRecordStore}.
 *
 * Contract point to store keys and values as NearCacheRecord internally.
 */
import type { StaleReadDetector } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/StaleReadDetector';
import type { UpdateSemantic } from '@zenystx/helios-core/internal/nearcache/NearCache';
import type { NearCacheRecord } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { NearCacheStats } from '@zenystx/helios-core/nearcache/NearCacheStats';

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
