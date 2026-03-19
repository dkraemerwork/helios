/**
 * Port of {@code com.hazelcast.internal.journal.EventJournal}.
 *
 * Per-partition append-only ring buffer for recording map events.
 * Uses ArrayRingbuffer-style circular buffer with sequence-based access.
 */
import type { EventJournalEvent } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import { EventJournalEventType } from '@zenystx/helios-core/internal/journal/EventJournalEvent';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class EventJournal {
    private readonly _capacity: number;
    private readonly _ttlMs: number;
    private readonly _buffer: (EventJournalEvent | null)[];
    private _headSequence: bigint = 0n;
    private _tailSequence: bigint = -1n; // Points to the last written item

    constructor(capacity: number, ttlSeconds: number = 0) {
        this._capacity = Math.max(1, capacity);
        this._ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : 0;
        this._buffer = new Array(this._capacity).fill(null);
    }

    /**
     * Append an event to the journal. Returns the assigned sequence number.
     */
    add(
        key: Data,
        oldValue: Data | null,
        newValue: Data | null,
        eventType: EventJournalEventType,
    ): bigint {
        this._tailSequence++;
        const sequence = this._tailSequence;

        // Advance head if buffer is full
        if (sequence - this._headSequence >= BigInt(this._capacity)) {
            this._headSequence = sequence - BigInt(this._capacity) + 1n;
        }

        const index = Number(sequence % BigInt(this._capacity));
        this._buffer[index] = {
            sequence,
            key,
            newValue,
            oldValue,
            eventType,
            timestamp: Date.now(),
        };

        return sequence;
    }

    /**
     * Read events starting from the given sequence (inclusive).
     * Returns up to maxCount events, optionally filtered by predicate.
     */
    readMany(
        startSequence: bigint,
        minCount: number,
        maxCount: number,
        predicate?: (event: EventJournalEvent) => boolean,
    ): EventJournalEvent[] {
        this._cleanup();

        const results: EventJournalEvent[] = [];
        const effectiveStart = startSequence < this._headSequence ? this._headSequence : startSequence;

        for (let seq = effectiveStart; seq <= this._tailSequence && results.length < maxCount; seq++) {
            const index = Number(seq % BigInt(this._capacity));
            const event = this._buffer[index];
            if (event !== null && event.sequence === seq) {
                if (!predicate || predicate(event)) {
                    results.push(event);
                }
            }
        }

        return results;
    }

    /** Returns the current head (oldest available) sequence. */
    getHeadSequence(): bigint {
        this._cleanup();
        return this._headSequence;
    }

    /** Returns the current tail (newest) sequence. */
    getTailSequence(): bigint {
        return this._tailSequence;
    }

    /** Returns the total number of events currently in the journal. */
    size(): number {
        if (this._tailSequence < this._headSequence) return 0;
        return Number(this._tailSequence - this._headSequence + 1n);
    }

    /** Returns true if the journal has no events. */
    isEmpty(): boolean {
        return this._tailSequence < this._headSequence;
    }

    /** Clear all events. */
    clear(): void {
        this._buffer.fill(null);
        this._headSequence = 0n;
        this._tailSequence = -1n;
    }

    /** Cleanup expired events based on TTL. */
    private _cleanup(): void {
        if (this._ttlMs <= 0) return;
        const now = Date.now();
        while (this._headSequence <= this._tailSequence) {
            const index = Number(this._headSequence % BigInt(this._capacity));
            const event = this._buffer[index];
            if (event !== null && (now - event.timestamp) > this._ttlMs) {
                this._buffer[index] = null;
                this._headSequence++;
            } else {
                break;
            }
        }
    }
}
