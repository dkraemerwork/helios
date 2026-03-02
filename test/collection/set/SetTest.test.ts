import { describe, it, expect } from 'bun:test';
import { SetImpl } from '@helios/collection/impl/SetImpl';

function makeSet(maxSize = 0) {
    return new SetImpl<string>(maxSize);
}

describe('SetTest', () => {

    // ===== isEmpty =====
    describe('testIsEmpty_whenEmpty', () => {
        it('returns true for empty set', () => {
            expect(makeSet().isEmpty()).toBe(true);
        });
    });

    describe('testIsEmpty_whenNotEmpty', () => {
        it('returns false when set has items', () => {
            const s = makeSet();
            s.add('item1');
            expect(s.isEmpty()).toBe(false);
        });
    });

    // ===== add =====
    describe('testAdd', () => {
        it('adds 10 unique items', () => {
            const s = makeSet();
            for (let i = 1; i <= 10; i++) expect(s.add('item' + i)).toBe(true);
            expect(s.size()).toBe(10);
        });
    });

    describe('testAdd_withMaxCapacity', () => {
        it('rejects after maxSize reached', () => {
            const s = makeSet(1);
            s.add('item');
            for (let i = 1; i <= 10; i++) expect(s.add('item' + i)).toBe(false);
            expect(s.size()).toBe(1);
        });
    });

    describe('testAddNull', () => {
        it('throws NullPointerException for null', () => {
            expect(() => makeSet().add(null as unknown as string)).toThrow();
        });
    });

    // ===== addAll =====
    describe('testAddAll_Basic', () => {
        it('adds all items from collection', () => {
            const s = makeSet();
            s.addAll(['item1', 'item2']);
            expect(s.size()).toBe(2);
        });
    });

    describe('testAddAll_whenAllElementsSame', () => {
        it('deduplicates elements', () => {
            const s = makeSet();
            s.addAll(['item', 'item', 'item']);
            expect(s.size()).toBe(1);
        });
    });

    describe('testAddAll_whenCollectionContainsNull', () => {
        it('throws or adds nothing on null in collection', () => {
            const s = makeSet();
            try {
                s.addAll(['item1', null as unknown as string]);
            } catch (_e) { /* ignore */ }
            expect(s.size()).toBe(0);
        });
    });

    // ===== remove =====
    describe('testRemoveBasic', () => {
        it('removes existing element', () => {
            const s = makeSet();
            s.add('item1');
            expect(s.remove('item1')).toBe(true);
            expect(s.size()).toBe(0);
        });
    });

    describe('testRemove_whenElementNotExist', () => {
        it('returns false for non-existing element', () => {
            const s = makeSet();
            s.add('item1');
            expect(s.remove('notExist')).toBe(false);
            expect(s.size()).toBe(1);
        });
    });

    describe('testRemove_whenArgumentNull', () => {
        it('throws NullPointerException for null', () => {
            expect(() => makeSet().remove(null as unknown as string)).toThrow();
        });
    });

    describe('testRemoveAll', () => {
        it('removes all elements in collection', () => {
            const s = makeSet();
            const removed: string[] = [];
            for (let i = 1; i <= 10; i++) {
                s.add('item' + i);
                removed.push('item' + i);
            }
            s.removeAll(removed);
            expect(s.size()).toBe(0);
        });
    });

    // ===== iterator =====
    describe('testIterator', () => {
        it('iterates single element', () => {
            const s = makeSet();
            s.add('item');
            const it = s.iterator();
            expect(it.next().value).toBe('item');
            expect(it.next().done).toBe(true);
        });
    });

    describe('testIteratorRemoveThrowsUnsupportedOperationException', () => {
        it('throws on iterator remove', () => {
            const s = makeSet();
            s.add('item');
            const it = s.iterator();
            it.next();
            expect(() => (it as unknown as { remove(): void }).remove()).toThrow();
        });
    });

    // ===== clear =====
    describe('testClear', () => {
        it('removes all elements', () => {
            const s = makeSet();
            for (let i = 1; i <= 10; i++) s.add('item' + i);
            expect(s.size()).toBe(10);
            s.clear();
            expect(s.size()).toBe(0);
        });
    });

    describe('testClear_whenSetEmpty', () => {
        it('does nothing for empty set', () => {
            makeSet().clear();
            expect(makeSet().size()).toBe(0);
        });
    });

    // ===== retainAll =====
    describe('testRetainAll_whenArgumentEmptyCollection', () => {
        it('clears set', () => {
            const s = makeSet();
            for (let i = 1; i <= 10; i++) s.add('item' + i);
            s.retainAll([]);
            expect(s.size()).toBe(0);
        });
    });

    describe('testRetainAll_whenArgumentHasSameElements', () => {
        it('keeps all elements', () => {
            const s = makeSet();
            const retained: string[] = [];
            for (let i = 1; i <= 10; i++) {
                s.add('item' + i);
                retained.push('item' + i);
            }
            s.retainAll(retained);
            expect(s.size()).toBe(10);
        });
    });

    describe('testRetainAll_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeSet().retainAll(null as unknown as string[])).toThrow();
        });
    });

    // ===== contains / containsAll =====
    describe('testContains', () => {
        it('returns true for existing element', () => {
            const s = makeSet();
            s.add('item1');
            expect(s.contains('item1')).toBe(true);
        });
    });

    describe('testContains_whenEmpty', () => {
        it('returns false for empty set', () => {
            expect(makeSet().contains('notExist')).toBe(false);
        });
    });

    describe('testContains_whenNotContains', () => {
        it('returns false for missing element', () => {
            const s = makeSet();
            s.add('item1');
            expect(s.contains('notExist')).toBe(false);
        });
    });

    describe('testContainsAll', () => {
        it('returns true when all present', () => {
            const s = makeSet();
            const contains: string[] = [];
            for (let i = 1; i <= 10; i++) {
                s.add('item' + i);
                contains.push('item' + i);
            }
            expect(s.containsAll(contains)).toBe(true);
        });
    });

    describe('testContainsAll_whenSetNotContains', () => {
        it('returns false when some missing', () => {
            const s = makeSet();
            for (let i = 1; i <= 10; i++) s.add('item' + i);
            expect(s.containsAll(['item1', 'item100'])).toBe(false);
        });
    });
});
