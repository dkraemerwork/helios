import { describe, it, expect, beforeEach } from 'bun:test';
import { QueueImpl } from '@zenystx/helios-core/collection/impl/QueueImpl';

/** Mirror of Java VersionedObject<T> used in Hazelcast queue tests */
class VersionedObject<T> {
    constructor(
        readonly object: T,
        readonly version: number = -1,
    ) {
        if (object === null || object === undefined) {
            throw new Error('NullPointerException');
        }
    }

    equals(other: unknown): boolean {
        if (!(other instanceof VersionedObject)) return false;
        return this.version === other.version && this.object === other.object;
    }
}

function vo(s: string, v = -1) { return new VersionedObject(s, v); }

function makeQueue(maxSize = 0) {
    return new QueueImpl<VersionedObject<string>>(maxSize);
}

function eqVo(a: VersionedObject<string> | null, b: VersionedObject<string>) {
    return a !== null && a.equals(b);
}

describe('QueueTest', () => {

    // ===== offer =====
    describe('testOffer', () => {
        it('accepts 100 items', () => {
            const q = makeQueue();
            for (let i = 0; i < 100; i++) q.offer(vo('item' + i, i));
            expect(q.size()).toBe(100);
        });
    });

    describe('testOffer_whenFull', () => {
        it('rejects when at maxSize', () => {
            const q = makeQueue(100);
            for (let i = 0; i < 100; i++) q.offer(vo('item' + i, i));
            expect(q.offer(vo('rejected'))).toBe(false);
            expect(q.size()).toBe(100);
        });
    });

    describe('testOffer_whenNullArgument', () => {
        it('throws NullPointerException and leaves queue empty', () => {
            const q = makeQueue();
            expect(() => q.offer(null as unknown as VersionedObject<string>)).toThrow();
            expect(q.isEmpty()).toBe(true);
        });
    });

    // ===== poll =====
    describe('testPoll', () => {
        it('removes items from head', () => {
            const q = makeQueue();
            for (let i = 0; i < 100; i++) q.offer(vo('item' + i, i));
            q.poll(); q.poll(); q.poll(); q.poll();
            expect(q.size()).toBe(96);
        });
    });

    describe('testPoll_whenQueueEmpty', () => {
        it('returns null for empty queue', () => {
            expect(makeQueue().poll()).toBeNull();
        });
    });

    // ===== remove by value =====
    describe('testRemove', () => {
        it('removes specified element', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(q.remove(vo('item4', 4))).toBe(true);
            expect(q.size()).toBe(9);
        });
    });

    describe('testRemove_whenElementNotExists', () => {
        it('returns false when element not found', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(q.remove(vo('item13', 13))).toBe(false);
            expect(q.size()).toBe(10);
        });
    });

    describe('testRemove_whenQueueEmpty', () => {
        it('returns false for empty queue', () => {
            expect(makeQueue().remove(vo('not in Queue'))).toBe(false);
        });
    });

    describe('testRemove_whenArgNull', () => {
        it('throws NullPointerException and preserves queue', () => {
            const q = makeQueue();
            q.add(vo('foo'));
            expect(() => q.remove(null as unknown as VersionedObject<string>)).toThrow();
            expect(q.size()).toBe(1);
        });
    });

    // ===== drainTo =====
    describe('testDrainTo', () => {
        it('drains all elements', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list: VersionedObject<string>[] = [];
            expect(q.drainTo(list)).toBe(10);
            expect(list).toHaveLength(10);
            expect(list[0].equals(vo('item0', 0))).toBe(true);
            expect(list[5].equals(vo('item5', 5))).toBe(true);
            expect(q.size()).toBe(0);
        });
    });

    describe('testDrainTo_whenQueueEmpty', () => {
        it('returns 0 for empty queue', () => {
            const list: VersionedObject<string>[] = [];
            expect(makeQueue().drainTo(list)).toBe(0);
        });
    });

    describe('testDrainTo_whenCollectionNull', () => {
        it('throws NullPointerException and preserves queue', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(() => q.drainTo(null as unknown as VersionedObject<string>[])).toThrow();
            expect(q.size()).toBe(10);
        });
    });

    describe('testDrainToWithMaxElement', () => {
        it('drains at most maxElements', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list: VersionedObject<string>[] = [];
            q.drainTo(list, 4);
            expect(list).toHaveLength(4);
            expect(list.some(v => v.equals(vo('item3', 3)))).toBe(true);
            expect(q.size()).toBe(6);
        });
    });

    describe('testDrainToWithMaxElement_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(() => q.drainTo(null as unknown as VersionedObject<string>[], 4)).toThrow();
            expect(q.size()).toBe(10);
        });
    });

    describe('testDrainToWithMaxElement_whenMaxArgNegative', () => {
        it('drains all when maxElements is negative', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list: VersionedObject<string>[] = [];
            expect(q.drainTo(list, -4)).toBe(10);
            expect(q.size()).toBe(0);
        });
    });

    // ===== contains =====
    describe('testContains_whenExists', () => {
        it('returns true for existing element', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(q.contains(vo('item4', 4))).toBe(true);
            expect(q.contains(vo('item8', 8))).toBe(true);
        });
    });

    describe('testContains_whenNotExists', () => {
        it('returns false for missing element', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(q.contains(vo('item10', 10))).toBe(false);
            expect(q.contains(vo('item19', 19))).toBe(false);
        });
    });

    // ===== addAll =====
    describe('testAddAll_whenCollectionContainsNull', () => {
        it('throws NullPointerException when null in collection', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(() => q.addAll([vo('item10'), null as unknown as VersionedObject<string>])).toThrow();
        });
    });

    describe('testContainsAll_whenExists', () => {
        it('returns true when all elements present', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list = [vo('item1', 1), vo('item2', 2), vo('item3', 3)];
            expect(q.containsAll(list)).toBe(true);
        });
    });

    describe('testContainsAll_whenNoneExists', () => {
        it('returns false when no elements present', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list = [vo('item10', 10), vo('item11', 11)];
            expect(q.containsAll(list)).toBe(false);
        });
    });

    describe('testContainsAll_whenSomeExists', () => {
        it('returns false when only some elements present', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const list = [vo('item1', 1), vo('item14', 14)];
            expect(q.containsAll(list)).toBe(false);
        });
    });

    describe('testContainsAll_whenNull', () => {
        it('throws NullPointerException for null collection', () => {
            expect(() => makeQueue().containsAll(null as unknown as VersionedObject<string>[])).toThrow();
        });
    });

    describe('testAddAll', () => {
        it('adds all items from collection', () => {
            const q = makeQueue();
            const list = Array.from({ length: 10 }, (_, i) => vo('item' + i, i));
            expect(q.addAll(list)).toBe(true);
            expect(q.size()).toBe(10);
        });
    });

    describe('testAddAll_whenNullCollection', () => {
        it('throws NullPointerException', () => {
            expect(() => makeQueue().addAll(null as unknown as VersionedObject<string>[])).toThrow();
            expect(makeQueue().size()).toBe(0);
        });
    });

    describe('testAddAll_whenEmptyCollection', () => {
        it('returns false and does not change queue', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            expect(q.size()).toBe(10);
            expect(q.addAll([])).toBe(false);
            expect(q.size()).toBe(10);
        });
    });

    describe('testAddAll_whenDuplicateItems', () => {
        it('adds duplicates', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            q.addAll([vo('item3')]);
            expect(q.size()).toBe(11);
        });
    });

    describe('testAddAll_whenExceedingConstraint', () => {
        it('throws IllegalStateException when exceeding maxSize', () => {
            const q = makeQueue(100);
            const list = Array.from({ length: 101 }, () => vo('Hello'));
            expect(() => q.addAll(list)).toThrow();
            // queue should remain empty (addAll was rolled back / rejected)
            const drain: VersionedObject<string>[] = [];
            q.drainTo(drain);
            expect(drain).toHaveLength(0);
        });
    });

    // ===== retainAll =====
    describe('testRetainAll', () => {
        it('retains only elements in given collection', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            const retain = [vo('item3'), vo('item4'), vo('item31')];
            expect(q.retainAll(retain)).toBe(true);
            expect(q.size()).toBe(2);
        });
    });

    describe('testRetainAll_whenCollectionNull', () => {
        it('throws NullPointerException and preserves queue', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            expect(() => q.retainAll(null as unknown as VersionedObject<string>[])).toThrow();
            expect(q.size()).toBe(3);
        });
    });

    describe('testRetainAll_whenCollectionEmpty', () => {
        it('clears queue when retaining empty collection', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            expect(q.retainAll([])).toBe(true);
            expect(q.size()).toBe(0);
        });
    });

    describe('testRetainAll_whenCollectionContainsNull', () => {
        it('retains nothing (null never matches) and clears queue', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            expect(q.retainAll([null as unknown as VersionedObject<string>])).toBe(true);
            expect(q.size()).toBe(0);
        });
    });

    // ===== removeAll =====
    describe('testRemoveAll', () => {
        it('removes all elements in given collection', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            expect(q.removeAll([vo('item3'), vo('item4'), vo('item5')])).toBe(true);
            expect(q.size()).toBe(0);
        });
    });

    describe('testRemoveAll_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeQueue().removeAll(null as unknown as VersionedObject<string>[])).toThrow();
        });
    });

    describe('testRemoveAll_whenCollectionEmpty', () => {
        it('returns false and preserves queue', () => {
            const q = makeQueue();
            q.add(vo('item3')); q.add(vo('item4')); q.add(vo('item5'));
            expect(q.removeAll([])).toBe(false);
            expect(q.size()).toBe(3);
        });
    });

    // ===== toArray =====
    describe('testToArray', () => {
        it('returns elements in queue order', () => {
            const q = makeQueue();
            for (let i = 0; i < 10; i++) q.offer(vo('item' + i, i));
            const arr = q.toArray();
            expect(arr).toHaveLength(10);
            for (let i = 0; i < arr.length; i++) {
                expect((arr[i] as VersionedObject<string>).equals(vo('item' + i, i))).toBe(true);
            }
        });
    });

    // ===== iterator =====
    describe('testQueueRemoveFromIterator', () => {
        it('throws UnsupportedOperationException on iterator.remove()', () => {
            const q = makeQueue();
            q.add(vo('one'));
            const it = q.iterator();
            it.next();
            expect(() => (it as unknown as { remove(): void }).remove()).toThrow();
        });
    });
});
