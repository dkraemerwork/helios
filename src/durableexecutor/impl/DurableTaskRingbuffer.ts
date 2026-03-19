/**
 * Per-partition circular buffer for durable executor task submission records.
 *
 * Stores task submission records in a fixed-capacity ring. When the buffer is
 * full, the oldest completed entry is evicted (OVERWRITE policy). Incomplete
 * tasks are never evicted — submission to a full buffer with all slots occupied
 * by in-progress tasks throws a RejectedExecutionError.
 *
 * Thread model: single-threaded JavaScript event loop — no locking needed.
 *
 * Port of com.hazelcast.durableexecutor.impl.DurableExecutorContainer ring.
 */

/**
 * A single task submission record stored in the partition ringbuffer.
 */
export interface DurableTaskRecord {
    /** Monotonically increasing sequence number assigned at submission time. */
    readonly sequence: number;
    /** Serialized callable payload as submitted by the client. */
    readonly callableData: Buffer;
    /** Serialized result, null until the task completes (successfully or with error). */
    result: Buffer | null;
    /** Whether the task has finished executing (success or failure). */
    completed: boolean;
    /** Unix-epoch milliseconds at submission time. */
    readonly submittedAt: number;
    /** Unix-epoch milliseconds at completion time, null until completed. */
    completedAt: number | null;
}

/**
 * Circular buffer of DurableTaskRecord entries, keyed by sequence number.
 *
 * The buffer tracks a global monotonic sequence counter. Each newly submitted
 * task gets the next sequence. The buffer slots are addressed via
 * `sequence % capacity`, so old entries are naturally overwritten.
 *
 * Invariants:
 *  - `headSequence` is the smallest valid sequence in the ring (0-based).
 *  - `tailSequence` is the sequence of the most recently added entry (-1 if empty).
 *  - `tailSequence - headSequence + 1 === size()`.
 */
export class DurableTaskRingbuffer {
    private readonly _capacity: number;
    /** Underlying circular buffer — indexed by `sequence % capacity`. */
    private readonly _slots: (DurableTaskRecord | undefined)[];
    /** Next sequence to assign. Starts at 1; first submitted task gets sequence 1. */
    private _nextSequence = 1;
    /** Sequence of the oldest live entry. -1 when empty. */
    private _headSequence = -1;
    /** Sequence of the most recently added entry. -1 when empty. */
    private _tailSequence = -1;

    constructor(capacity: number) {
        if (capacity <= 0) {
            throw new Error(`DurableTaskRingbuffer capacity must be > 0, got ${capacity}`);
        }
        this._capacity = capacity;
        this._slots = new Array(capacity).fill(undefined);
    }

    get capacity(): number {
        return this._capacity;
    }

    get headSequence(): number {
        return this._headSequence;
    }

    get tailSequence(): number {
        return this._tailSequence;
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Submit a callable to the ringbuffer.
     *
     * Assigns the next monotonic sequence, stores the record, and returns the
     * sequence so the caller can track the result later.
     *
     * If the buffer is full and all live entries are still in-progress (no
     * completed entry available to evict), throws `RangeError`.
     *
     * @returns The assigned sequence number.
     */
    submit(callableData: Buffer): number {
        if (this.isFull()) {
            // Attempt to evict the oldest completed entry.
            if (!this._evictOldestCompleted()) {
                throw new RangeError(
                    `DurableTaskRingbuffer is full (capacity=${this._capacity}) and all entries are in-progress. ` +
                    'Retrieve or dispose existing results before submitting new tasks.',
                );
            }
        }

        const sequence = this._nextSequence++;
        const record: DurableTaskRecord = {
            sequence,
            callableData,
            result: null,
            completed: false,
            submittedAt: Date.now(),
            completedAt: null,
        };

        this._slots[sequence % this._capacity] = record;

        if (this._headSequence === -1) {
            this._headSequence = sequence;
        }
        this._tailSequence = sequence;

        return sequence;
    }

    /**
     * Mark a task as complete and store its serialized result.
     *
     * No-op if the sequence is no longer in the ring (already evicted).
     */
    complete(sequence: number, resultData: Buffer): void {
        const record = this._getRecord(sequence);
        if (record === undefined) return;

        record.result = resultData;
        record.completed = true;
        record.completedAt = Date.now();
    }

    /**
     * Retrieve the task record for the given sequence, or null if not present.
     */
    retrieveResult(sequence: number): DurableTaskRecord | null {
        return this._getRecord(sequence) ?? null;
    }

    /**
     * Remove the task record for the given sequence from the ring.
     *
     * Advances headSequence over any now-empty leading slots.
     */
    dispose(sequence: number): void {
        const record = this._getRecord(sequence);
        if (record === undefined) return;

        this._slots[sequence % this._capacity] = undefined;
        this._advanceHead();
    }

    /**
     * Atomic retrieve-and-dispose: returns the record and removes it from the ring.
     */
    retrieveAndDispose(sequence: number): DurableTaskRecord | null {
        const record = this._getRecord(sequence);
        if (record === undefined) return null;

        this._slots[sequence % this._capacity] = undefined;
        this._advanceHead();
        return record;
    }

    /**
     * Returns the number of live entries currently held in the ring.
     */
    size(): number {
        if (this._headSequence === -1) return 0;
        return this._tailSequence - this._headSequence + 1;
    }

    /**
     * Returns true when the ring holds `capacity` live entries.
     */
    isFull(): boolean {
        return this.size() >= this._capacity;
    }

    /**
     * Returns a snapshot of all live entries for backup replication.
     * Order is from headSequence to tailSequence.
     */
    getSnapshot(): DurableTaskRecord[] {
        if (this._headSequence === -1) return [];
        const result: DurableTaskRecord[] = [];
        for (let seq = this._headSequence; seq <= this._tailSequence; seq++) {
            const record = this._slots[seq % this._capacity];
            if (record !== undefined) {
                result.push({ ...record });
            }
        }
        return result;
    }

    /**
     * Restore the ring from a snapshot received from the primary partition owner.
     *
     * Replaces the entire ring state. Used during partition ownership transfer
     * (member failure recovery / migration).
     */
    restoreFromSnapshot(records: DurableTaskRecord[]): void {
        this._slots.fill(undefined);

        if (records.length === 0) {
            this._headSequence = -1;
            this._tailSequence = -1;
            return;
        }

        // Sort by sequence ascending to establish head/tail correctly.
        const sorted = [...records].sort((a, b) => a.sequence - b.sequence);

        for (const record of sorted) {
            this._slots[record.sequence % this._capacity] = { ...record };
        }

        this._headSequence = sorted[0].sequence;
        this._tailSequence = sorted[sorted.length - 1].sequence;
        // Restore next-sequence counter so new submissions don't collide.
        // Minimum is 2 to preserve the invariant that sequences start at 1.
        this._nextSequence = Math.max(2, this._tailSequence + 1);
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private _getRecord(sequence: number): DurableTaskRecord | undefined {
        if (this._headSequence === -1) return undefined;
        if (sequence < this._headSequence || sequence > this._tailSequence) return undefined;
        const record = this._slots[sequence % this._capacity];
        // Guard against wrap-around aliasing: verify the slot belongs to this sequence.
        return record?.sequence === sequence ? record : undefined;
    }

    /**
     * Advance headSequence past any leading slots that are now undefined
     * (disposed records).
     */
    private _advanceHead(): void {
        if (this._headSequence === -1) return;
        while (
            this._headSequence <= this._tailSequence &&
            this._slots[this._headSequence % this._capacity] === undefined
        ) {
            this._headSequence++;
        }
        if (this._headSequence > this._tailSequence) {
            this._headSequence = -1;
            this._tailSequence = -1;
        }
    }

    /**
     * Evict the oldest completed entry to make room for a new submission.
     *
     * Scans from head to tail looking for the first completed record.
     * Returns true if one was found and evicted; false otherwise.
     */
    private _evictOldestCompleted(): boolean {
        if (this._headSequence === -1) return false;
        for (let seq = this._headSequence; seq <= this._tailSequence; seq++) {
            const record = this._slots[seq % this._capacity];
            if (record !== undefined && record.completed) {
                this._slots[seq % this._capacity] = undefined;
                this._advanceHead();
                return true;
            }
        }
        return false;
    }
}
