import type { Ringbuffer } from '@helios/ringbuffer/impl/Ringbuffer';
import { StaleSequenceException } from '@helios/ringbuffer/StaleSequenceException';
import { ReadOnlyRingbufferIterator } from '@helios/ringbuffer/impl/ReadOnlyRingbufferIterator';

/**
 * The ArrayRingbuffer is responsible for storing the actual contents of a ringbuffer.
 * Circular buffer with capacity; not thread-safe (single-threaded Bun context).
 */
export class ArrayRingbuffer<E> implements Ringbuffer<E> {
    private ringItems: (E | undefined)[];
    private _tailSequence = -1;
    private _headSequence = 0; // tailSequence + 1
    private readonly capacity: number;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.ringItems = new Array<E | undefined>(capacity);
    }

    tailSequence(): number {
        return this._tailSequence;
    }

    peekNextTailSequence(): number {
        return this._tailSequence + 1;
    }

    setTailSequence(sequence: number): void {
        this._tailSequence = sequence;
    }

    headSequence(): number {
        return this._headSequence;
    }

    setHeadSequence(sequence: number): void {
        this._headSequence = sequence;
    }

    getCapacity(): number {
        return this.capacity;
    }

    size(): number {
        return this._tailSequence - this._headSequence + 1;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }

    add(item: E): number {
        this._tailSequence++;

        if (this._tailSequence - this.capacity === this._headSequence) {
            this._headSequence++;
        }

        const index = this.toIndex(this._tailSequence);
        this.ringItems[index] = item;

        return this._tailSequence;
    }

    read(sequence: number): E {
        this.checkReadSequence(sequence);
        return this.ringItems[this.toIndex(sequence)] as E;
    }

    checkBlockableReadSequence(readSequence: number): void {
        if (readSequence > this._tailSequence + 1) {
            throw new Error(
                `sequence:${readSequence} is too large. The current tailSequence is:${this._tailSequence}`
            );
        }

        if (readSequence < this._headSequence) {
            throw new StaleSequenceException(
                `sequence:${readSequence} is too small. The current headSequence is:${this._headSequence} tailSequence is:${this._tailSequence}`,
                this._headSequence
            );
        }
    }

    checkReadSequence(sequence: number): void {
        if (sequence > this._tailSequence) {
            throw new Error(
                `sequence:${sequence} is too large. The current tailSequence is:${this._tailSequence}`
            );
        }

        if (sequence < this._headSequence) {
            throw new StaleSequenceException(
                `sequence:${sequence} is too small. The current headSequence is:${this._headSequence} tailSequence is:${this._tailSequence}`,
                this._headSequence
            );
        }
    }

    private toIndex(sequence: number): number {
        return ((sequence % this.ringItems.length) + this.ringItems.length) % this.ringItems.length;
    }

    set(seq: number, data: E): void {
        this.ringItems[this.toIndex(seq)] = data;
    }

    clear(): void {
        this.ringItems = new Array<E | undefined>(this.capacity);
        this._tailSequence = -1;
        this._headSequence = 0;
    }

    [Symbol.iterator](): Iterator<E> {
        return new ReadOnlyRingbufferIterator<E>(this);
    }

    getItems(): (E | undefined)[] {
        return this.ringItems;
    }
}
