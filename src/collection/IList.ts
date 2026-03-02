import type { ICollection } from './ICollection';

/** A positional iterator with hasNext()/next() and an unsupported remove(). */
export interface ListIterator<E> {
    hasNext(): boolean;
    next(): E;
    /** @throws UnsupportedOperationException always */
    remove(): never;
}

/**
 * Distributed list interface.
 * Port of com.hazelcast.collection.IList.
 */
export interface IList<E> extends ICollection<E> {
    /** Returns element at index. @throws IndexOutOfBoundsException */
    get(index: number): E;

    /** Replaces element at index; returns old value. @throws IndexOutOfBoundsException */
    set(index: number, element: E): E;

    /** Inserts element at index, shifting subsequent elements. @throws IndexOutOfBoundsException */
    addAt(index: number, element: E): void;

    /** Inserts all elements at index. @throws IndexOutOfBoundsException */
    addAllAt(index: number, elements: E[]): boolean;

    /** Removes and returns element at index. @throws IndexOutOfBoundsException */
    removeAt(index: number): E;

    /** Returns index of first occurrence, or -1. */
    indexOf(element: E): number;

    /** Returns index of last occurrence, or -1. */
    lastIndexOf(element: E): number;

    /** Returns sub-list [fromIndex, toIndex). @throws IndexOutOfBoundsException */
    subList(fromIndex: number, toIndex: number): E[];

    /** Returns a ListIterator positioned at the start. */
    listIterator(): ListIterator<E>;

    /** Returns a ListIterator positioned at index. */
    listIterator(index: number): ListIterator<E>;
}
