/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.maxsize.EntryCountNearCacheEvictionChecker}.
 *
 * EvictionChecker for the ENTRY_COUNT max-size policy.
 */
export interface EvictionChecker {
    isEvictionRequired(): boolean;
}

export class EntryCountNearCacheEvictionChecker implements EvictionChecker {
    private readonly _maxSize: number;
    private readonly _records: { size(): number };

    constructor(maxSize: number, records: { size(): number }) {
        this._maxSize = maxSize;
        this._records = records;
    }

    isEvictionRequired(): boolean {
        return this._records.size() >= this._maxSize;
    }
}
