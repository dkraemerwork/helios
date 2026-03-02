/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.MetaDataContainer}.
 *
 * Contains one partition's invalidation metadata used for near-cache repair.
 * Bun is single-threaded — all CAS operations are trivially thread-safe.
 */

export class MetaDataContainer {
    /** Sequence number of last received invalidation event. */
    private _sequence = 0;

    /** Biggest sequence that is lost; lower sequences are considered stale. */
    private _staleSequence = 0;

    /** Number of missed sequence events. */
    private _missedSequenceCount = 0;

    /** UUID of the source partition that generates invalidation events. */
    private _uuid: string | null = null;

    getUuid(): string | null {
        return this._uuid;
    }

    setUuid(uuid: string | null): void {
        this._uuid = uuid;
    }

    casUuid(prevUuid: string | null, newUuid: string | null): boolean {
        if (this._uuid !== prevUuid) return false;
        this._uuid = newUuid;
        return true;
    }

    getSequence(): number {
        return this._sequence;
    }

    setSequence(sequence: number): void {
        this._sequence = sequence;
    }

    casSequence(currentSequence: number, nextSequence: number): boolean {
        if (this._sequence !== currentSequence) return false;
        this._sequence = nextSequence;
        return true;
    }

    resetSequence(): void {
        this._sequence = 0;
    }

    getStaleSequence(): number {
        return this._staleSequence;
    }

    casStaleSequence(lastKnownStaleSequence: number, lastReceivedSequence: number): boolean {
        if (this._staleSequence !== lastKnownStaleSequence) return false;
        this._staleSequence = lastReceivedSequence;
        return true;
    }

    resetStaleSequence(): void {
        this._staleSequence = 0;
    }

    addAndGetMissedSequenceCount(missCount: number): number {
        this._missedSequenceCount += missCount;
        return this._missedSequenceCount;
    }

    getMissedSequenceCount(): number {
        return this._missedSequenceCount;
    }
}
