/**
 * Port of {@code com.hazelcast.internal.cluster.impl.MemberSelectingCollection}.
 *
 * An immutable collection that applies a MemberSelector to its internal Member collection.
 * Mutation methods throw errors. Supports iteration via for-of.
 */
import type { Member } from '@helios/cluster/Member';
import type { MemberSelector } from '@helios/cluster/MemberSelector';

export class MemberSelectingCollection<M extends Member> implements Iterable<M> {
    private readonly members: M[];
    private readonly selector: MemberSelector;

    constructor(members: M[] | Iterable<M>, selector: MemberSelector) {
        this.members = Array.isArray(members) ? members : [...members];
        this.selector = selector;
    }

    size(): number {
        let count = 0;
        for (const m of this.members) {
            if (this.selector.select(m)) count++;
        }
        return count;
    }

    isEmpty(): boolean {
        for (const m of this.members) {
            if (this.selector.select(m)) return false;
        }
        return true;
    }

    contains(o: unknown): boolean {
        for (const m of this.members) {
            if (this.selector.select(m) && (m as unknown as { equals(x: unknown): boolean }).equals(o)) {
                return true;
            }
        }
        return false;
    }

    containsAll(items: M[]): boolean {
        for (const item of items) {
            if (!this.contains(item)) return false;
        }
        return true;
    }

    toArray(): M[] {
        const result: M[] = [];
        for (const m of this.members) {
            if (this.selector.select(m)) result.push(m);
        }
        return result;
    }

    [Symbol.iterator](): Iterator<M> {
        return new MemberSelectingIterator(this.members, this.selector);
    }

    /**
     * Returns the next element from a fresh iterator.
     * Throws if no elements remain.
     * Used by iterator-exhaustion tests.
     */
    nextExplicit(): M {
        const iter = new MemberSelectingIterator(this.members, this.selector);
        const result = iter.next();
        if (result.done) throw new Error('NoSuchElementException');
        return result.value;
    }

    // Mutation methods always throw
    add(_m: M): never { throw new Error('UnsupportedOperationException'); }
    remove(_o: unknown): never { throw new Error('UnsupportedOperationException'); }
    addAll(_c: M[]): never { throw new Error('UnsupportedOperationException'); }
    removeAll(_c: unknown[]): never { throw new Error('UnsupportedOperationException'); }
    retainAll(_c: unknown[]): never { throw new Error('UnsupportedOperationException'); }
    clear(): never { throw new Error('UnsupportedOperationException'); }
}

class MemberSelectingIterator<M extends Member> implements Iterator<M> {
    private readonly members: M[];
    private readonly selector: MemberSelector;
    private index = 0;
    private pending: M | undefined;
    private exhausted = false;

    constructor(members: M[], selector: MemberSelector) {
        this.members = members;
        this.selector = selector;
    }

    next(): IteratorResult<M> {
        if (this.exhausted) {
            throw new Error('NoSuchElementException');
        }

        // Use pending if available
        if (this.pending !== undefined) {
            const value = this.pending;
            this.pending = undefined;
            return { value, done: false };
        }

        // Advance to next matching member
        while (this.index < this.members.length) {
            const m = this.members[this.index++];
            if (this.selector.select(m)) {
                return { value: m, done: false };
            }
        }

        this.exhausted = true;
        return { value: undefined as unknown as M, done: true };
    }

    return?(): IteratorResult<M> {
        this.exhausted = true;
        return { value: undefined as unknown as M, done: true };
    }
}
