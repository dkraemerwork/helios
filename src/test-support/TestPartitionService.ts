/**
 * Minimal partition service stub for unit tests.
 *
 * All 271 partitions are considered locally owned. Partition assignment uses
 * the standard Hazelcast formula: abs(key.getPartitionHash()) % partitionCount.
 *
 * Port of the test-support pattern from Java integration tests.
 */
import type { Data } from '@zenystx/core/internal/serialization/Data';
import { Address } from '@zenystx/core/cluster/Address';

export const PARTITION_COUNT = 271;

export class TestPartitionService {
    private readonly _localAddress = new Address('127.0.0.1', 5701);

    getPartitionCount(): number {
        return PARTITION_COUNT;
    }

    getPartitionId(key: Data | object): number {
        const hash = this._partitionHash(key);
        const mod = hash % PARTITION_COUNT;
        return mod < 0 ? mod + PARTITION_COUNT : mod;
    }

    isPartitionLocallyOwned(_partitionId: number): boolean {
        return true;
    }

    getPartitionOwner(_partitionId: number): Address | null {
        return this._localAddress;
    }

    isMigrating(_partitionId: number): boolean {
        return false;
    }

    private _partitionHash(key: Data | object): number {
        // If key is a Data, use its partition hash (matches Java behaviour).
        if (key != null && typeof key === 'object' && 'getPartitionHash' in key) {
            return (key as Data).getPartitionHash();
        }
        // Fallback: simple identity hash for plain objects.
        return 0;
    }
}
