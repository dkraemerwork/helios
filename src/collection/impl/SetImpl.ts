import type { ISet } from '../ISet';

/**
 * In-memory single-node ISet implementation.
 * Port of com.hazelcast.collection.impl.set (single-node subset).
 */
export class SetImpl<E> implements ISet<E> {
    private readonly data = new Set<E>();

    /**
     * @param maxSize 0 = unlimited.
     */
    constructor(private readonly maxSize: number = 0) {}

    size(): number {
        return this.data.size;
    }

    isEmpty(): boolean {
        return this.data.size === 0;
    }

    contains(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.data.has(element);
    }

    containsAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        return elements.every(e => this.data.has(e));
    }

    add(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (this.data.has(element)) return false;
        if (this.maxSize > 0 && this.data.size >= this.maxSize) return false;
        this.data.add(element);
        return true;
    }

    addAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        // Validate nulls first
        for (const e of elements) {
            if (e === null || e === undefined) {
                throw new Error('NullPointerException: null element in collection');
            }
        }
        let changed = false;
        for (const e of elements) {
            if (this.add(e)) changed = true;
        }
        return changed;
    }

    remove(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.data.delete(element);
    }

    removeAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        let changed = false;
        for (const e of elements) {
            if (this.data.delete(e)) changed = true;
        }
        return changed;
    }

    retainAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        // Null elements in the retain set should be ignored (can't be in a non-null set)
        const retainSet = new Set<E>(elements.filter(e => e !== null && e !== undefined));
        let changed = false;
        for (const item of this.data) {
            if (!retainSet.has(item)) {
                this.data.delete(item);
                changed = true;
            }
        }
        return changed;
    }

    clear(): void {
        this.data.clear();
    }

    toArray(): E[] {
        return [...this.data];
    }

    iterator(): Iterator<E> & { remove(): never } {
        const iter = this.data[Symbol.iterator]();
        return {
            next(): IteratorResult<E> {
                return iter.next();
            },
            remove(): never {
                throw new Error('UnsupportedOperationException: iterator.remove() not supported');
            },
        };
    }

    [Symbol.iterator](): Iterator<E> {
        return this.data[Symbol.iterator]();
    }
}
