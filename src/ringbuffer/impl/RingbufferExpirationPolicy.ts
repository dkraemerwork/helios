import type { Ringbuffer } from '@zenystx/helios-core/ringbuffer/impl/Ringbuffer';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.RingbufferExpirationPolicy}.
 *
 * Manages TTL expiration for ringbuffer items using an array of expiry timestamps.
 */
export class RingbufferExpirationPolicy {
    /** Expiry timestamp (ms since epoch) for each slot, indexed by sequence mod capacity. */
    readonly ringExpirationMs: number[];
    private readonly ttlMs: number;

    constructor(capacity: number, ttlMs: number) {
        this.ringExpirationMs = new Array<number>(capacity).fill(0);
        this.ttlMs = ttlMs;
    }

    /**
     * Remove all expired items from the head of the ringbuffer.
     */
    cleanup<E>(ringbuffer: Ringbuffer<E>): void {
        if (ringbuffer.headSequence() > ringbuffer.tailSequence()) {
            return;
        }

        const now = Date.now();
        while (ringbuffer.headSequence() <= ringbuffer.tailSequence()) {
            const headSequence = ringbuffer.headSequence();
            if (this.ringExpirationMs[this.toIndex(headSequence)] > now) {
                return;
            }
            // Null the slot and advance head
            ringbuffer.set(headSequence, null as unknown as E);
            ringbuffer.setHeadSequence(ringbuffer.headSequence() + 1);
        }
    }

    toIndex(sequence: number): number {
        return sequence % this.ringExpirationMs.length;
    }

    /** Set expiration for given sequence to now + TTL. */
    setExpirationAt(sequence: number): void;
    /** Set expiration for given sequence to an explicit timestamp. */
    setExpirationAt(sequence: number, value: number): void;
    setExpirationAt(sequence: number, value?: number): void {
        const ts = value !== undefined ? value : Date.now() + this.ttlMs;
        this.ringExpirationMs[this.toIndex(sequence)] = ts;
    }

    getExpirationAt(seq: number): number {
        return this.ringExpirationMs[this.toIndex(seq)];
    }

    getTtlMs(): number {
        return this.ttlMs;
    }

    clear(): void {
        this.ringExpirationMs.fill(0);
    }
}
