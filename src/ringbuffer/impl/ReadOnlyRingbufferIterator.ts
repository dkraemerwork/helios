import type { ArrayRingbuffer } from '@helios/ringbuffer/impl/ArrayRingbuffer';

/** Read-only iterator over items in a Ringbuffer. */
export class ReadOnlyRingbufferIterator<E> implements Iterator<E> {
    private sequence: number;

    constructor(private readonly ringbuffer: ArrayRingbuffer<E>) {
        this.sequence = ringbuffer.headSequence();
    }

    next(): IteratorResult<E> {
        if (this.sequence <= this.ringbuffer.tailSequence()) {
            const value = this.ringbuffer.read(this.sequence++);
            return { value, done: false };
        }
        return { value: undefined as unknown as E, done: true };
    }
}
