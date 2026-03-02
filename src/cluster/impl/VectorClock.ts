/**
 * Port of {@code com.hazelcast.cluster.impl.VectorClock}.
 *
 * Vector clock consisting of distinct replica logical clocks.
 * See https://en.wikipedia.org/wiki/Vector_clock
 */
export class VectorClock {
    private readonly replicaTimestamps: Map<string, number> = new Map();

    constructor(from?: VectorClock) {
        if (from !== undefined) {
            for (const [k, v] of from.replicaTimestamps) {
                this.replicaTimestamps.set(k, v);
            }
        }
    }

    /** Returns logical timestamp for given replicaId, or undefined if not present. */
    getTimestampForReplica(replicaId: string): number | undefined {
        return this.replicaTimestamps.get(replicaId);
    }

    /** Sets the logical timestamp for the given replicaId. */
    setReplicaTimestamp(replicaId: string, timestamp: number): void {
        this.replicaTimestamps.set(replicaId, timestamp);
    }

    /**
     * Merges the provided vector clock into this one by taking the maximum of
     * the logical timestamps for each replica.
     */
    merge(other: VectorClock): void {
        for (const [replicaId, mergingTimestamp] of other.replicaTimestamps) {
            const localTimestamp = this.replicaTimestamps.get(replicaId);
            const local = localTimestamp !== undefined ? localTimestamp : Number.MIN_SAFE_INTEGER;
            this.replicaTimestamps.set(replicaId, Math.max(local, mergingTimestamp));
        }
    }

    /**
     * Returns true if this vector clock is causally strictly after the provided vector clock.
     */
    isAfter(other: VectorClock): boolean {
        let anyTimestampGreater = false;
        for (const [replicaId, otherTimestamp] of other.replicaTimestamps) {
            const localTimestamp = this.replicaTimestamps.get(replicaId);
            if (localTimestamp === undefined || localTimestamp < otherTimestamp) {
                return false;
            } else if (localTimestamp > otherTimestamp) {
                anyTimestampGreater = true;
            }
        }
        return anyTimestampGreater || other.replicaTimestamps.size < this.replicaTimestamps.size;
    }

    /** Returns true if this vector clock is empty. */
    isEmpty(): boolean {
        return this.replicaTimestamps.size === 0;
    }

    /** Returns the entry set of replica timestamps. */
    entrySet(): IterableIterator<[string, number]> {
        return this.replicaTimestamps.entries();
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof VectorClock)) return false;
        if (this.replicaTimestamps.size !== other.replicaTimestamps.size) return false;
        for (const [k, v] of this.replicaTimestamps) {
            if (other.replicaTimestamps.get(k) !== v) return false;
        }
        return true;
    }

    toString(): string {
        const entries = [...this.replicaTimestamps.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
        return `{${entries}}`;
    }
}
