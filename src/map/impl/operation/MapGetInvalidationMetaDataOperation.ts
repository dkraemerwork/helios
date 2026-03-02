/**
 * Port of {@code com.hazelcast.map.impl.operation.MapGetInvalidationMetaDataOperation}.
 *
 * Read-only operation that collects Near Cache invalidation metadata for a set of
 * map names across the locally-owned partitions.  The response is consumed by the
 * client-side {@code RepairingTask} during anti-entropy reconciliation.
 */
import type { MetaDataGenerator } from '@helios/internal/nearcache/impl/invalidation/MetaDataGenerator';

/** [partitionId, sequence] tuple returned per map name. */
export type PartitionSequenceEntry = [number, number];

export interface InvalidationMetaDataResponse {
    /** map-name → list of (partitionId, sequence) pairs (only non-zero sequences included) */
    namePartitionSequenceList: Map<string, PartitionSequenceEntry[]>;
    /** partitionId → partition UUID */
    partitionUuidList: Map<number, string>;
}

export class MapGetInvalidationMetaDataOperation {
    private readonly _names: string[];
    private readonly _ownedPartitions: number[];
    private readonly _metaDataGen: MetaDataGenerator;
    private _response: InvalidationMetaDataResponse | null = null;

    constructor(names: string[], ownedPartitions: number[], metaDataGen: MetaDataGenerator) {
        if (!names || names.length === 0) {
            throw new Error('names cannot be null or empty');
        }
        this._names = names;
        this._ownedPartitions = ownedPartitions;
        this._metaDataGen = metaDataGen;
    }

    run(): void {
        this._response = {
            partitionUuidList: this._buildPartitionUuidList(),
            namePartitionSequenceList: this._buildNamePartitionSequenceList(),
        };
    }

    getResponse(): InvalidationMetaDataResponse {
        if (!this._response) throw new Error('run() has not been called');
        return this._response;
    }

    private _buildPartitionUuidList(): Map<number, string> {
        const result = new Map<number, string>();
        for (const partitionId of this._ownedPartitions) {
            result.set(partitionId, this._metaDataGen.getOrCreateUuid(partitionId));
        }
        return result;
    }

    private _buildNamePartitionSequenceList(): Map<string, PartitionSequenceEntry[]> {
        const result = new Map<string, PartitionSequenceEntry[]>();
        for (const name of this._names) {
            const entries: PartitionSequenceEntry[] = [];
            for (const partitionId of this._ownedPartitions) {
                const seq = this._metaDataGen.currentSequence(name, partitionId);
                if (seq !== 0) {
                    entries.push([partitionId, seq]);
                }
            }
            result.set(name, entries);
        }
        return result;
    }
}
