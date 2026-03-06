import type { StaleSequenceException } from '@zenystx/core/ringbuffer/StaleSequenceException';

/**
 * The Ringbuffer is responsible for storing the actual content of a ringbuffer.
 */
export interface Ringbuffer<E> extends Iterable<E> {
    getCapacity(): number;
    size(): number;
    tailSequence(): number;
    peekNextTailSequence(): number;
    setTailSequence(tailSequence: number): void;
    headSequence(): number;
    setHeadSequence(sequence: number): void;
    isEmpty(): boolean;
    add(item: E): number;
    /** @throws StaleSequenceException if sequence < headSequence or sequence > tailSequence */
    read(sequence: number): E;
    /** @throws StaleSequenceException if sequence < headSequence; throws Error if sequence > tailSequence + 1 */
    checkBlockableReadSequence(readSequence: number): void;
    /** @throws StaleSequenceException if sequence < headSequence; throws Error if sequence > tailSequence */
    checkReadSequence(sequence: number): void;
    set(seq: number, data: E): void;
    clear(): void;
    getItems(): (E | undefined)[];
}
