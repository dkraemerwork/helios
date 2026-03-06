/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.Invalidation}.
 *
 * Root class for Near Cache invalidation data.
 */
import { InvalidationUtils } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/InvalidationUtils';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export abstract class Invalidation {
    protected _dataStructureName: string;
    protected _sourceUuid: string | null;
    protected _partitionUuid: string | null;
    protected _sequence: number;

    protected constructor(
        dataStructureName: string,
        sourceUuid: string | null = null,
        partitionUuid: string | null = null,
        sequence: number = InvalidationUtils.NO_SEQUENCE,
    ) {
        if (dataStructureName == null) {
            throw new Error('dataStructureName cannot be null');
        }
        this._dataStructureName = dataStructureName;
        this._sourceUuid = sourceUuid;
        this._partitionUuid = partitionUuid;
        this._sequence = sequence;
    }

    getPartitionUuid(): string | null { return this._partitionUuid; }
    getSourceUuid(): string | null { return this._sourceUuid; }
    getSequence(): number { return this._sequence; }
    getName(): string { return this._dataStructureName; }

    getKey(): Data | null { return null; }

    toString(): string {
        return `dataStructureName='${this._dataStructureName}', sourceUuid='${this._sourceUuid}', ` +
            `partitionUuid='${this._partitionUuid}', sequence=${this._sequence}`;
    }
}
