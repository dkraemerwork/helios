import { describe, it, expect, beforeEach } from 'bun:test';
import { ListImpl } from '@helios/collection/impl/ListImpl';

function makeList(maxSize = 0) {
    return new ListImpl<string>(maxSize);
}

function addItems(list: ListImpl<string>, count: number) {
    for (let i = 0; i < count; i++) list.add('item' + i);
}

describe('ListTest', () => {

    // ===== isEmpty =====
    describe('testIsEmpty_whenEmpty', () => {
        it('returns true for empty list', () => {
            expect(makeList().isEmpty()).toBe(true);
        });
    });

    describe('testIsEmpty_whenNotEmpty', () => {
        it('returns false when list has items', () => {
            const list = makeList();
            list.add('1');
            expect(list.isEmpty()).toBe(false);
        });
    });

    // ===== add =====
    describe('testAdd', () => {
        it('adds 10 items', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.size()).toBe(10);
        });
    });

    describe('testAdd_whenArgNull', () => {
        it('throws NullPointerException for null element', () => {
            const list = makeList();
            expect(() => list.add(null as unknown as string)).toThrow();
            expect(list.isEmpty()).toBe(true);
        });
    });

    describe('testAdd_whenCapacityReached_thenItemNotAdded', () => {
        it('returns false when at maxSize', () => {
            const list = makeList(10);
            for (let i = 0; i < 10; i++) list.add('item' + i);
            expect(list.add('item10')).toBe(false);
            expect(list.size()).toBe(10);
        });
    });

    // ===== addWithIndex =====
    describe('testAddWithIndex', () => {
        it('inserts at specified index', () => {
            const list = makeList();
            for (let i = 0; i < 10; i++) list.addAt(i, 'item' + i);
            expect(list.size()).toBe(10);
        });
    });

    describe('testAddWithIndex_whenIndexAlreadyTaken', () => {
        it('shifts existing elements right', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.get(4)).toBe('item4');
            list.addAt(4, 'test');
            expect(list.get(4)).toBe('test');
        });
    });

    describe('testAddWithIndex_whenIndexAlreadyTaken_ArgNull', () => {
        it('throws NullPointerException and does not shift', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.get(4)).toBe('item4');
            expect(() => list.addAt(4, null as unknown as string)).toThrow();
            expect(list.get(4)).toBe('item4');
        });
    });

    describe('testAddWithIndex_whenIndexOutOfBound', () => {
        it('throws IndexOutOfBoundsException', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.addAt(14, 'item14')).toThrow();
        });
    });

    describe('testAddWithIndex_whenIndexNegative', () => {
        it('throws IndexOutOfBoundsException for negative index', () => {
            expect(() => makeList().addAt(-1, 'item0')).toThrow();
        });
    });

    // ===== addAll =====
    describe('testAddAll', () => {
        it('adds all items from collection', () => {
            const list = makeList();
            expect(list.addAll(['item0', 'item1', 'item2'])).toBe(true);
            expect(list.size()).toBe(3);
        });
    });

    describe('testAddAll_whenCollectionContainsNull', () => {
        it('throws NullPointerException', () => {
            const list = makeList();
            expect(() => list.addAll(['item0', 'item1', null as unknown as string])).toThrow();
            expect(list.size()).toBe(0);
        });
    });

    describe('testAddAll_whenEmptyCollection', () => {
        it('returns false for empty collection', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.addAll([])).toBe(false);
            expect(list.size()).toBe(10);
        });
    });

    describe('testAddAll_whenDuplicateItems', () => {
        it('allows duplicates', () => {
            const list = makeList();
            addItems(list, 10);
            list.addAll(['item4']);
            expect(list.size()).toBe(11);
        });
    });

    describe('testAddAllWithIndex', () => {
        it('inserts all at specified index', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.get(1)).toBe('item1');
            expect(list.get(2)).toBe('item2');
            expect(list.get(3)).toBe('item3');
            expect(list.addAllAt(1, ['test1', 'test2', 'test3'])).toBe(true);
            expect(list.get(1)).toBe('test1');
            expect(list.get(2)).toBe('test2');
            expect(list.get(3)).toBe('test3');
        });
    });

    describe('testAddAllWithIndex_whenIndexNegative', () => {
        it('throws IndexOutOfBoundsException for negative index', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.addAllAt(-2, ['test1'])).toThrow();
        });
    });

    // ===== clear =====
    describe('testClear', () => {
        it('removes all elements', () => {
            const list = makeList();
            addItems(list, 10);
            list.clear();
            expect(list.size()).toBe(0);
        });
    });

    // ===== contains =====
    describe('testContains', () => {
        it('returns true for existing elements', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.contains('item1')).toBe(true);
            expect(list.contains('item5')).toBe(true);
            expect(list.contains('item7')).toBe(true);
            expect(list.contains('item11')).toBe(false);
        });
    });

    // ===== containsAll =====
    describe('testContainsAll', () => {
        it('returns true when all present', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.containsAll(['item1', 'item4', 'item7'])).toBe(true);
        });
    });

    describe('testContainsAll_whenListNotContains', () => {
        it('returns false when some missing', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.containsAll(['item1', 'item4', 'item14'])).toBe(false);
        });
    });

    describe('testContainsAll_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.containsAll(null as unknown as string[])).toThrow();
        });
    });

    // ===== get =====
    describe('testGet', () => {
        it('returns element at index', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.get(1)).toBe('item1');
            expect(list.get(7)).toBe('item7');
            expect(list.get(9)).toBe('item9');
        });
    });

    describe('testGet_whenIndexNotExists', () => {
        it('throws IndexOutOfBoundsException', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.get(14)).toThrow();
        });
    });

    describe('testGet_whenIndexNegative', () => {
        it('throws IndexOutOfBoundsException for negative index', () => {
            expect(() => makeList().get(-1)).toThrow();
        });
    });

    // ===== set =====
    describe('testSet', () => {
        it('replaces element at index and returns old value', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.set(1, 'test1')).toBe('item1');
            expect(list.set(3, 'test3')).toBe('item3');
            expect(list.set(8, 'test8')).toBe('item8');
            expect(list.get(1)).toBe('test1');
            expect(list.get(3)).toBe('test3');
            expect(list.get(8)).toBe('test8');
        });
    });

    describe('testSet_whenListEmpty', () => {
        it('throws IndexOutOfBoundsException on empty list', () => {
            expect(() => makeList().set(0, 'item0')).toThrow();
        });
    });

    describe('testSet_whenElementNull', () => {
        it('throws NullPointerException for null value', () => {
            const list = makeList();
            addItems(list, 1);
            expect(() => list.set(0, null as unknown as string)).toThrow();
        });
    });

    describe('testSet_whenIndexNegative', () => {
        it('throws IndexOutOfBoundsException for negative index', () => {
            expect(() => makeList().set(-1, 'item1')).toThrow();
        });
    });

    // ===== indexOf =====
    describe('testIndexOf', () => {
        it('returns correct index', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.indexOf('item0')).toBe(0);
            expect(list.indexOf('item6')).toBe(6);
            expect(list.indexOf('item9')).toBe(9);
            expect(list.indexOf('item15')).toBe(-1);
        });
    });

    describe('testIndexOf_whenDuplicateItems', () => {
        it('returns first occurrence', () => {
            const list = makeList();
            list.add('item1'); list.add('item2'); list.add('item3'); list.add('item1');
            expect(list.indexOf('item1')).toBe(0);
            expect(list.indexOf('item1')).not.toBe(3);
        });
    });

    describe('testIndexOf_whenObjectNull', () => {
        it('throws NullPointerException', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.indexOf(null as unknown as string)).toThrow();
        });
    });

    // ===== lastIndexOf =====
    describe('testLastIndexOf', () => {
        it('returns last occurrence', () => {
            const list = makeList();
            list.add('item1'); list.add('item2'); list.add('item3');
            list.add('item1'); list.add('item4'); list.add('item1');
            expect(list.lastIndexOf('item1')).toBe(5);
            expect(list.lastIndexOf('item1')).not.toBe(0);
            expect(list.lastIndexOf('item1')).not.toBe(3);
        });
    });

    describe('testLastIndexOf_whenObjectNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeList().lastIndexOf(null as unknown as string)).toThrow();
        });
    });

    // ===== remove by index =====
    describe('testRemoveIndex', () => {
        it('removes element at index and shifts remainder', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.removeAt(0)).toBe('item0');
            expect(list.removeAt(3)).toBe('item4');  // item1,item2,item3 remain; item4 is at index 3
            expect(list.removeAt(5)).toBe('item7');  // item1,item2,item3,item5,item6 remain; item7 at idx5
        });
    });

    describe('testRemoveIndex_whenIndexNegative', () => {
        it('throws IndexOutOfBoundsException', () => {
            expect(() => makeList().removeAt(-1)).toThrow();
        });
    });

    describe('testRemoveIndex_whenIndexNotExists', () => {
        it('throws IndexOutOfBoundsException', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.removeAt(14)).toThrow();
        });
    });

    describe('testRemoveIndex_whenListEmpty', () => {
        it('throws IndexOutOfBoundsException for empty list', () => {
            expect(() => makeList().removeAt(0)).toThrow();
        });
    });

    // ===== remove by value =====
    describe('testRemoveObject', () => {
        it('removes first occurrence', () => {
            const list = makeList();
            list.add('item0'); list.add('item1'); list.add('item2'); list.add('item0');
            expect(list.remove('item0')).toBe(true);
            expect(list.remove('item3')).toBe(false);
            expect(list.get(0)).toBe('item1');
            expect(list.get(2)).toBe('item0');
        });
    });

    describe('testRemoveObject_whenObjectNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeList().remove(null as unknown as string)).toThrow();
        });
    });

    describe('testRemoveObject_whenListEmpty', () => {
        it('returns false for empty list', () => {
            expect(makeList().remove('item0')).toBe(false);
        });
    });

    // ===== removeAll =====
    describe('testRemoveAll', () => {
        it('removes all elements in collection', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.removeAll(['item0', 'item1', 'item2'])).toBe(true);
            expect(list.size()).toBe(7);
            expect(list.get(0)).toBe('item3');
        });
    });

    describe('testRemoveAll_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeList().removeAll(null as unknown as string[])).toThrow();
        });
    });

    describe('testRemoveAll_whenCollectionEmpty', () => {
        it('returns false and preserves list', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.removeAll([])).toBe(false);
            expect(list.size()).toBe(10);
        });
    });

    // ===== retainAll =====
    describe('testRetainAll', () => {
        it('keeps only elements in collection', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.retainAll(['item0', 'item1', 'item2'])).toBe(true);
            expect(list.size()).toBe(3);
            expect(list.get(0)).toBe('item0');
            expect(list.get(1)).toBe('item1');
            expect(list.get(2)).toBe('item2');
        });
    });

    describe('testRetainAll_whenCollectionNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeList().retainAll(null as unknown as string[])).toThrow();
        });
    });

    describe('testRetainAll_whenCollectionEmpty', () => {
        it('clears list', () => {
            const list = makeList();
            addItems(list, 10);
            expect(list.retainAll([])).toBe(true);
            expect(list.size()).toBe(0);
        });
    });

    describe('testRetainAll_whenCollectionContainsNull', () => {
        it('throws NullPointerException', () => {
            expect(() => makeList().retainAll([null as unknown as string])).toThrow();
        });
    });

    // ===== subList =====
    describe('testSublist', () => {
        it('returns sub-list with correct elements', () => {
            const list = makeList();
            addItems(list, 10);
            const sub = list.subList(3, 7);
            expect(sub).toHaveLength(4);
            expect(sub[0]).toBe('item3');
            expect(sub[1]).toBe('item4');
            expect(sub[2]).toBe('item5');
            expect(sub[3]).toBe('item6');
        });
    });

    describe('testSublist_whenFromIndexIllegal', () => {
        it('throws IndexOutOfBoundsException when from > to', () => {
            expect(() => makeList().subList(8, 7)).toThrow();
        });
    });

    describe('testSublist_whenToIndexIllegal', () => {
        it('throws IndexOutOfBoundsException when to > size', () => {
            const list = makeList();
            addItems(list, 10);
            expect(() => list.subList(4, 14)).toThrow();
        });
    });

    // ===== iterator =====
    describe('testIterator', () => {
        it('iterates all elements in order', () => {
            const list = makeList();
            addItems(list, 10);
            const it = list.listIterator();
            let i = 0;
            while (it.hasNext()) {
                expect(it.next()).toBe('item' + i++);
            }
            expect(i).toBe(10);
        });
    });

    describe('testIterator_throwsException_whenRemove', () => {
        it('throws UnsupportedOperationException on remove', () => {
            const list = makeList();
            addItems(list, 10);
            const it = list.listIterator();
            it.next();
            expect(() => (it as unknown as { remove(): void }).remove()).toThrow();
        });
    });

    describe('testIteratorWithIndex', () => {
        it('iterates from given index', () => {
            const list = makeList();
            addItems(list, 10);
            let i = 4;
            const it = list.listIterator(i);
            while (it.hasNext()) {
                expect(it.next()).toBe('item' + i++);
            }
            expect(i).toBe(10);
        });
    });
});
