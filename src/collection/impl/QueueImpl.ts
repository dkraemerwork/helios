import type { IQueue } from '../IQueue';

/**
 * In-memory single-node IQueue implementation.
 * Port of com.hazelcast.collection.impl.queue (single-node subset).
 */
export class QueueImpl<E> implements IQueue<E> {
    private readonly items: Array<E> = [];

    /**
     * @param maxSize 0 = unlimited (same as Hazelcast default).
     * @param equalsFn optional equality function (defaults to deep equals via value comparison)
     */
    constructor(
        private readonly maxSize: number = 0,
        private readonly equalsItem: (a: E, b: E) => boolean = defaultEquals,
    ) {}

    // ----- size / isEmpty -----

    size(): number {
        return this.items.length;
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }

    // ----- offer / poll / peek / add -----

    offer(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (this.maxSize > 0 && this.items.length >= this.maxSize) {
            return false;
        }
        this.items.push(element);
        return true;
    }

    add(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (this.maxSize > 0 && this.items.length >= this.maxSize) {
            throw new Error('IllegalStateException: Queue is full');
        }
        this.items.push(element);
        return true;
    }

    poll(): E | null {
        if (this.items.length === 0) return null;
        return this.items.shift()!;
    }

    peek(): E | null {
        if (this.items.length === 0) return null;
        return this.items[0];
    }

    // ----- remove by value -----

    remove(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        for (let i = 0; i < this.items.length; i++) {
            if (this.equalsItem(this.items[i], element)) {
                this.items.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    // ----- drainTo -----

    drainTo(collection: E[]): number;
    drainTo(collection: E[], maxElements: number): number;
    drainTo(collection: E[], maxElements?: number): number {
        if (collection === null || collection === undefined) {
            throw new Error('NullPointerException: collection is null');
        }
        const n = maxElements === undefined
            ? this.items.length
            : maxElements < 0 ? this.items.length : maxElements;
        const drained = this.items.splice(0, n);
        collection.push(...drained);
        return drained.length;
    }

    // ----- contains / containsAll -----

    contains(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.items.some(i => this.equalsItem(i, element));
    }

    containsAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: elements is null');
        }
        return elements.every(e => this.contains(e));
    }

    // ----- addAll -----

    addAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: elements is null');
        }
        if (elements.length === 0) return false;

        // Validate nulls first
        for (const e of elements) {
            if (e === null || e === undefined) {
                throw new Error('NullPointerException: null element in collection');
            }
        }
        // Check capacity
        if (this.maxSize > 0 && this.items.length + elements.length > this.maxSize) {
            throw new Error('IllegalStateException: Queue capacity exceeded');
        }
        for (const e of elements) this.items.push(e);
        return true;
    }

    // ----- retainAll -----

    retainAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: elements is null');
        }
        let changed = false;
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            const keep = elements.some(e => e !== null && e !== undefined && this.equalsItem(item, e));
            if (!keep) {
                this.items.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    // ----- removeAll -----

    removeAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: elements is null');
        }
        if (elements.length === 0) return false;
        let changed = false;
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (elements.some(e => e !== null && e !== undefined && this.equalsItem(this.items[i], e))) {
                this.items.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    // ----- toArray -----

    toArray(): E[] {
        return [...this.items];
    }

    // ----- clear -----

    clear(): void {
        this.items.length = 0;
    }

    // ----- iterator -----

    iterator(): Iterator<E> & { remove(): never } {
        let index = 0;
        const items = this.items;
        return {
            next(): IteratorResult<E> {
                if (index < items.length) {
                    return { value: items[index++], done: false };
                }
                return { value: undefined as unknown as E, done: true };
            },
            remove(): never {
                throw new Error('UnsupportedOperationException: iterator.remove() not supported');
            },
        };
    }

    [Symbol.iterator](): Iterator<E> {
        return this.iterator();
    }
}

function defaultEquals<E>(a: E, b: E): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof (a as unknown as { equals?: (o: unknown) => boolean }).equals === 'function') {
        return (a as unknown as { equals(o: unknown): boolean }).equals(b);
    }
    return false;
}
