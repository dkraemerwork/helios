import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { AbstractRingBufferOperation } from '@zenystx/helios-core/ringbuffer/impl/operations/AbstractRingBufferOperation';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.ReadOneOperation}.
 *
 * Reads one item from the ringbuffer at the given sequence.
 * Blocks if the sequence is one beyond the tail.
 */
export class ReadOneOperation extends AbstractRingBufferOperation {
    private sequence: number;
    private result: Data | null = null;

    constructor(name: string, sequence: number) {
        super(name);
        this.sequence = sequence;
    }

    override async beforeRun(): Promise<void> {
        const ringbuffer = this.getRingBufferContainerOrNull();
        if (ringbuffer !== null) {
            ringbuffer.checkBlockableReadSequence(this.sequence);
        }
    }

    /**
     * Returns true if the operation should wait (block) for more data.
     * Returns false to proceed (either has data or will fail in beforeRun).
     */
    shouldWait(): boolean {
        const ringbuffer = this.getRingBufferContainerOrNull();
        if (ringbuffer === null) {
            return true;
        }
        if (ringbuffer.isTooLargeSequence(this.sequence) || ringbuffer.isStaleSequence(this.sequence)) {
            // Let beforeRun throw the appropriate exception
            return false;
        }
        // The sequence is not readable yet
        return this.sequence === ringbuffer.tailSequence() + 1;
    }

    async run(): Promise<void> {
        const ringbuffer = this.getRingBufferContainer();
        this.result = ringbuffer.readAsData(this.sequence);
    }

    getResponse(): Data | null {
        return this.result;
    }
}
