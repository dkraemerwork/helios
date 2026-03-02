/**
 * Base collection interface.
 * Port of java.util.Collection<E> (subset used by Helios).
 */
export interface ICollection<E> {
    size(): number;
    isEmpty(): boolean;
    contains(element: E): boolean;
    containsAll(elements: E[]): boolean;
    add(element: E): boolean;
    addAll(elements: E[]): boolean;
    remove(element: E): boolean;
    removeAll(elements: E[]): boolean;
    retainAll(elements: E[]): boolean;
    clear(): void;
    toArray(): E[];
    iterator(): Iterator<E> & { remove?(): void };
    [Symbol.iterator](): Iterator<E>;
}
