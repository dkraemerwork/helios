import type { ICollection } from './ICollection';

/**
 * Distributed queue interface.
 * Port of com.hazelcast.collection.IQueue (blocking subset, single-node).
 */
export interface IQueue<E> extends ICollection<E> {
    /** Inserts element at tail; returns false if queue is full. */
    offer(element: E): boolean;

    /** Retrieves and removes the head; returns null if empty. */
    poll(): E | null;

    /** Retrieves but does not remove the head; returns null if empty. */
    peek(): E | null;

    /** Inserts element at tail; throws IllegalStateException if full. */
    add(element: E): boolean;

    /** Drains all elements into collection; returns number drained. */
    drainTo(collection: E[]): number;

    /** Drains at most maxElements into collection. Negative maxElements → drain all. */
    drainTo(collection: E[], maxElements: number): number;
}
