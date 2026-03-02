import type { IList, ListIterator } from '../IList';

/**
 * In-memory single-node IList implementation.
 * Port of com.hazelcast.collection.impl.list (single-node subset).
 */
export class ListImpl<E> implements IList<E> {
    private readonly items: E[] = [];

    /**
     * @param maxSize 0 = unlimited.
     */
    constructor(private readonly maxSize: number = 0) {}

    // ----- size / isEmpty -----

    size(): number {
        return this.items.length;
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }

    // ----- add -----

    add(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (this.maxSize > 0 && this.items.length >= this.maxSize) return false;
        this.items.push(element);
        return true;
    }

    addAt(index: number, element: E): void {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (index < 0 || index > this.items.length) {
            throw new Error('IndexOutOfBoundsException: index ' + index);
        }
        this.items.splice(index, 0, element);
    }

    addAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        if (elements.length === 0) return false;
        // Validate all non-null first
        for (const e of elements) {
            if (e === null || e === undefined) {
                throw new Error('NullPointerException: null element in collection');
            }
        }
        for (const e of elements) this.items.push(e);
        return true;
    }

    addAllAt(index: number, elements: E[]): boolean {
        if (index < 0 || index > this.items.length) {
            throw new Error('IndexOutOfBoundsException: index ' + index);
        }
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        if (elements.length === 0) return false;
        this.items.splice(index, 0, ...elements);
        return true;
    }

    // ----- get / set -----

    get(index: number): E {
        this.checkBounds(index);
        return this.items[index];
    }

    set(index: number, element: E): E {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        if (index < 0 || index >= this.items.length) {
            throw new Error('IndexOutOfBoundsException: index ' + index);
        }
        const old = this.items[index];
        this.items[index] = element;
        return old;
    }

    // ----- remove -----

    removeAt(index: number): E {
        if (index < 0 || index >= this.items.length) {
            throw new Error('IndexOutOfBoundsException: index ' + index);
        }
        return this.items.splice(index, 1)[0];
    }

    remove(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        const i = this.items.indexOf(element);
        if (i === -1) return false;
        this.items.splice(i, 1);
        return true;
    }

    removeAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        if (elements.length === 0) return false;
        const set = new Set(elements);
        let changed = false;
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (set.has(this.items[i])) {
                this.items.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    retainAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        // Check for null elements in retain collection (throw NPE per Java spec)
        for (const e of elements) {
            if (e === null || e === undefined) {
                throw new Error('NullPointerException: null element in collection');
            }
        }
        const set = new Set(elements);
        let changed = false;
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (!set.has(this.items[i])) {
                this.items.splice(i, 1);
                changed = true;
            }
        }
        return changed;
    }

    // ----- contains -----

    contains(element: E): boolean {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.items.includes(element);
    }

    containsAll(elements: E[]): boolean {
        if (elements === null || elements === undefined) {
            throw new Error('NullPointerException: null collection');
        }
        return elements.every(e => this.items.includes(e));
    }

    // ----- indexOf / lastIndexOf -----

    indexOf(element: E): number {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.items.indexOf(element);
    }

    lastIndexOf(element: E): number {
        if (element === null || element === undefined) {
            throw new Error('NullPointerException: null element');
        }
        return this.items.lastIndexOf(element);
    }

    // ----- subList -----

    subList(fromIndex: number, toIndex: number): E[] {
        if (fromIndex < 0 || toIndex > this.items.length || fromIndex > toIndex) {
            throw new Error('IndexOutOfBoundsException: fromIndex=' + fromIndex + ' toIndex=' + toIndex);
        }
        return this.items.slice(fromIndex, toIndex);
    }

    // ----- clear -----

    clear(): void {
        this.items.length = 0;
    }

    // ----- toArray -----

    toArray(): E[] {
        return [...this.items];
    }

    // ----- iterators -----

    listIterator(): ListIterator<E>;
    listIterator(index: number): ListIterator<E>;
    listIterator(startIndex = 0): ListIterator<E> {
        const items = this.items;
        let pos = startIndex;
        return {
            hasNext(): boolean {
                return pos < items.length;
            },
            next(): E {
                if (pos >= items.length) throw new Error('NoSuchElementException');
                return items[pos++];
            },
            remove(): never {
                throw new Error('UnsupportedOperationException: iterator.remove() not supported');
            },
        };
    }

    iterator(): Iterator<E> & { remove(): never } {
        return this.listIterator() as Iterator<E> & { remove(): never };
    }

    [Symbol.iterator](): Iterator<E> {
        return this.items[Symbol.iterator]();
    }

    // ----- helpers -----

    private checkBounds(index: number): void {
        if (index < 0 || index >= this.items.length) {
            throw new Error('IndexOutOfBoundsException: index ' + index);
        }
    }
}
