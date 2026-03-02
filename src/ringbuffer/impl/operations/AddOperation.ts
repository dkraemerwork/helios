import type { Data } from '@helios/internal/serialization/Data';
import { AbstractRingBufferOperation } from '@helios/ringbuffer/impl/operations/AbstractRingBufferOperation';
import { OverflowPolicy } from '@helios/ringbuffer/OverflowPolicy';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.AddOperation}.
 *
 * Adds one item to the ringbuffer. Respects overflow policy:
 * - FAIL: returns -1 if no remaining capacity
 * - OVERWRITE: always adds (overwrites oldest item)
 *
 * Returns the sequence ID of the stored item, or -1 on FAIL overflow.
 */
export class AddOperation extends AbstractRingBufferOperation {
    private item: Data;
    private readonly overflowPolicy: OverflowPolicy;
    private resultSequence: number = -1;

    constructor(name: string, item: Data, overflowPolicy: OverflowPolicy) {
        super(name);
        this.item = item;
        this.overflowPolicy = overflowPolicy;
    }

    async run(): Promise<void> {
        const ringbuffer = this.getRingBufferContainer();

        if (this.overflowPolicy === OverflowPolicy.FAIL) {
            if (ringbuffer.remainingCapacity() < 1) {
                this.resultSequence = -1;
                return;
            }
        }

        this.resultSequence = ringbuffer.add(this.item);
    }

    shouldNotify(): boolean {
        return this.resultSequence !== -1;
    }

    shouldBackup(): boolean {
        return this.resultSequence !== -1;
    }

    getResponse(): number {
        return this.resultSequence;
    }
}
