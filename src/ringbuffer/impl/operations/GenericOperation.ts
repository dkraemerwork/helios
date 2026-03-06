import { AbstractRingBufferOperation } from '@zenystx/helios-core/ringbuffer/impl/operations/AbstractRingBufferOperation';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.GenericOperation}.
 *
 * Handles simple read operations on ringbuffer properties (size, capacity,
 * tail, head, remaining capacity) without needing any parameters beyond the name.
 */
export class GenericOperation extends AbstractRingBufferOperation {
    static readonly OPERATION_SIZE: number = 0;
    static readonly OPERATION_TAIL: number = 1;
    static readonly OPERATION_HEAD: number = 2;
    static readonly OPERATION_REMAINING_CAPACITY: number = 3;
    static readonly OPERATION_CAPACITY: number = 4;

    readonly operation: number;
    private result: number = 0;

    constructor(name: string, operation: number) {
        super(name);
        this.operation = operation;
    }

    async run(): Promise<void> {
        const ringbuffer = this.getRingBufferContainer();
        switch (this.operation) {
            case GenericOperation.OPERATION_SIZE:
                this.result = ringbuffer.size();
                break;
            case GenericOperation.OPERATION_HEAD:
                this.result = ringbuffer.headSequence();
                break;
            case GenericOperation.OPERATION_TAIL:
                this.result = ringbuffer.tailSequence();
                break;
            case GenericOperation.OPERATION_REMAINING_CAPACITY:
                this.result = ringbuffer.remainingCapacity();
                break;
            case GenericOperation.OPERATION_CAPACITY:
                this.result = ringbuffer.getCapacity();
                break;
            default:
                throw new Error(`Unrecognized operation: ${this.operation}`);
        }
    }

    getResponse(): number {
        return this.result;
    }
}
