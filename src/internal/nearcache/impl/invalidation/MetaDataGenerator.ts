/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.MetaDataGenerator}.
 *
 * Responsible for partition-sequence and partition UUID generation.
 * Used by Invalidator to generate metadata for invalidation events.
 * One instance per service is created. Used on member side.
 */

export class MetaDataGenerator {
    private readonly _partitionCount: number;
    /** data-structure-name → array of per-partition sequence numbers */
    private readonly _sequenceGenerators = new Map<string, number[]>();
    /** partitionId → UUID */
    private readonly _uuids = new Map<number, string>();

    constructor(partitionCount: number) {
        this._partitionCount = partitionCount;
    }

    currentSequence(name: string, partitionId: number): number {
        const seqs = this._sequenceGenerators.get(name);
        return seqs ? seqs[partitionId]! : 0;
    }

    nextSequence(name: string, partitionId: number): number {
        const seqs = this._sequenceGenerator(name);
        seqs[partitionId] = (seqs[partitionId] ?? 0) + 1;
        return seqs[partitionId]!;
    }

    setCurrentSequence(name: string, partitionId: number, sequence: number): void {
        this._sequenceGenerator(name)[partitionId] = sequence;
    }

    private _sequenceGenerator(name: string): number[] {
        let seqs = this._sequenceGenerators.get(name);
        if (!seqs) {
            seqs = new Array<number>(this._partitionCount).fill(0);
            this._sequenceGenerators.set(name, seqs);
        }
        return seqs;
    }

    getOrCreateUuid(partitionId: number): string {
        let uuid = this._uuids.get(partitionId);
        if (!uuid) {
            uuid = crypto.randomUUID();
            this._uuids.set(partitionId, uuid);
        }
        return uuid;
    }

    getUuidOrNull(partitionId: number): string | null {
        return this._uuids.get(partitionId) ?? null;
    }

    setUuid(partitionId: number, uuid: string): void {
        this._uuids.set(partitionId, uuid);
    }

    removeUuidAndSequence(partitionId: number): void {
        this._uuids.delete(partitionId);
        for (const seqs of this._sequenceGenerators.values()) {
            seqs[partitionId] = 0;
        }
    }

    destroyMetaDataFor(dataStructureName: string): void {
        this._sequenceGenerators.delete(dataStructureName);
    }

    regenerateUuid(partitionId: number): void {
        this._uuids.set(partitionId, crypto.randomUUID());
    }

    resetSequence(name: string, partitionId: number): void {
        this._sequenceGenerator(name)[partitionId] = 0;
    }

    /** Used for testing. */
    getSequenceGenerators(): Map<string, number[]> {
        return this._sequenceGenerators;
    }
}
