import { AbstractRingBufferOperation } from '@zenystx/core/ringbuffer/impl/operations/AbstractRingBufferOperation';
import { ReadResultSetImpl } from '@zenystx/core/ringbuffer/impl/ReadResultSetImpl';
import { CallStatus } from '@zenystx/core/spi/impl/operationservice/CallStatus';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.ReadManyOperation}.
 *
 * Reads multiple items from the ringbuffer. Supports min/max size constraints
 * and an optional filter function. Returns WAIT if not enough items are available,
 * or RESPONSE when min items have been collected.
 */
export class ReadManyOperation<O = unknown> extends AbstractRingBufferOperation {
    private readonly minSize: number;
    private readonly maxSize: number;
    private readonly startSequence: number;
    private readonly filter: ((item: O) => boolean) | null;

    /** Current read position - advances across multiple call() invocations. */
    sequence: number = 0;
    private resultSet: ReadResultSetImpl<O> | null = null;

    constructor(
        name: string,
        startSequence: number,
        minSize: number,
        maxSize: number,
        filter: ((item: O) => boolean) | null = null,
    ) {
        super(name);
        this.startSequence = startSequence;
        this.minSize = minSize;
        this.maxSize = maxSize;
        this.filter = filter;
    }

    /** shouldWait is invoked only during unparking; by then we have data. */
    shouldWait(): boolean {
        return false;
    }

    /**
     * Core logic: check if we have enough items, read if we do, block if we don't.
     */
    call(): CallStatus {
        const ringbuffer = this.getRingBufferContainerOrNull();

        if (this.resultSet === null) {
            const ss = this.getNodeEngine()!.getSerializationService();
            this.resultSet = new ReadResultSetImpl<O>(
                this.minSize,
                this.maxSize,
                ss,
                this.filter,
            );
            this.sequence = this.startSequence;
        }

        if (ringbuffer === null) {
            return this.minSize > 0 ? CallStatus.WAIT : CallStatus.RESPONSE;
        }

        this.sequence = ringbuffer.clampReadSequenceToBounds(this.sequence);

        if (this.minSize === 0) {
            if (this.sequence < ringbuffer.tailSequence() + 1) {
                this.readMany(ringbuffer);
            }
            return CallStatus.RESPONSE;
        }

        if (this.resultSet.isMinSizeReached()) {
            return CallStatus.RESPONSE;
        }

        if (this.sequence === ringbuffer.tailSequence() + 1) {
            return CallStatus.WAIT;
        }

        this.readMany(ringbuffer);
        return this.resultSet.isMinSizeReached() ? CallStatus.RESPONSE : CallStatus.WAIT;
    }

    private readMany(ringbuffer: import('@zenystx/core/ringbuffer/impl/RingbufferContainer').RingbufferContainer): void {
        this.sequence = ringbuffer.readMany(this.sequence, this.resultSet!);
        this.resultSet!.setNextSequenceToReadFrom(this.sequence);
    }

    async run(): Promise<void> {
        this.call();
    }

    getResponse(): ReadResultSetImpl<O> | null {
        return this.resultSet;
    }
}
