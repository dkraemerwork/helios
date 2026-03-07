import { MultiMapImpl } from '@zenystx/helios-core/multimap/impl/MultiMapImpl';
import { ValueCollectionType } from '@zenystx/helios-core/multimap/MultiMapConfig';
import { describe, expect, it } from 'bun:test';

function makeMultiMap<K, V>(type: ValueCollectionType = ValueCollectionType.LIST) {
    return new MultiMapImpl<K, V>(type);
}

describe('MultiMapTest', () => {

    describe('testMultiMapPutAndGet', () => {
        it('put and get multiple values per key', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            let values = mm.get('Hello');
            expect([...values][0]).toBe('World');
            mm.put('Hello', 'Europe');
            mm.put('Hello', 'America');
            mm.put('Hello', 'Asia');
            mm.put('Hello', 'Africa');
            mm.put('Hello', 'Antarctica');
            mm.put('Hello', 'Australia');
            values = mm.get('Hello');
            expect(values.size).toBe(7);
            expect(mm.remove('Hello', 'Unknown')).toBe(false);
            expect(mm.get('Hello').size).toBe(7);
            expect(mm.remove('Hello', 'Antarctica')).toBe(true);
            expect(mm.get('Hello').size).toBe(6);
        });
    });

    describe('testMultiMapPutGetRemove', () => {
        it('put, get, remove operations', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('1', 'C'); mm.put('2', 'x'); mm.put('2', 'y');
            mm.put('1', 'A'); mm.put('1', 'B');
            const g1 = mm.get('1');
            expect(g1.has('A')).toBe(true);
            expect(g1.has('B')).toBe(true);
            expect(g1.has('C')).toBe(true);
            expect(mm.size()).toBe(5);

            expect(mm.remove('1', 'C')).toBe(true);
            expect(mm.size()).toBe(4);
            const g2 = mm.get('1');
            expect(g2.has('A')).toBe(true);
            expect(g2.has('B')).toBe(true);
            expect(g2.has('C')).toBe(false);

            const r1 = mm.removeAll('2');
            expect([...r1].includes('x')).toBe(true);
            expect([...r1].includes('y')).toBe(true);
            expect(mm.get('2')).toBeDefined();
            expect(mm.get('2').size).toBe(0);
            expect(mm.size()).toBe(2);

            const r2 = mm.removeAll('1');
            expect([...r2].includes('A')).toBe(true);
            expect([...r2].includes('B')).toBe(true);
            expect(mm.get('1').size).toBe(0);
            expect(mm.size()).toBe(0);
        });
    });

    describe('testMultiMapClear', () => {
        it('clear removes all entries', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            expect(mm.size()).toBe(1);
            mm.clear();
            expect(mm.size()).toBe(0);
        });
    });

    describe('testMultiMapContainsKey', () => {
        it('containsKey returns true after put', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            expect(mm.containsKey('Hello')).toBe(true);
        });
    });

    describe('testMultiMapContainsValue', () => {
        it('containsValue returns true for existing value', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            expect(mm.containsValue('World')).toBe(true);
        });
    });

    describe('testMultiMapContainsEntry', () => {
        it('containsEntry returns true for existing entry', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            expect(mm.containsEntry('Hello', 'World')).toBe(true);
        });
    });

    describe('testMultiMapDelete', () => {
        it('delete removes all values for key', () => {
            const mm = makeMultiMap<string, string>();
            mm.put('Hello', 'World');
            mm.delete('Hello');
            expect(mm.containsEntry('Hello', 'World')).toBe(false);
        });
    });

    describe('testMultiMapWithCustomSerializable', () => {
        it('put and remove custom objects', () => {
            const mm = makeMultiMap<string, object>();
            const obj = { id: 1 };
            mm.put('1', obj);
            expect(mm.size()).toBe(1);
            mm.removeAll('1');
            expect(mm.size()).toBe(0);
        });
    });

    describe('testMultiMapKeySet', () => {
        it('keySet returns unique keys', () => {
            const mm = makeMultiMap<string, string>();
            ['World','Europe','America','Asia','Africa','Antarctica','Australia']
                .forEach(v => mm.put('Hello', v));
            expect(mm.keySet().size).toBe(1);
        });
    });

    describe('testMultiMapValues', () => {
        it('values returns all values', () => {
            const mm = makeMultiMap<string, string>();
            ['World','Europe','America','Asia','Africa','Antarctica','Australia']
                .forEach(v => mm.put('Hello', v));
            expect(mm.values().length).toBe(7);
        });
    });

    describe('testMultiMapRemove', () => {
        it('removeAll returns removed values and updates size', () => {
            const mm = makeMultiMap<string, string>();
            ['World','Europe','America','Asia','Africa','Antarctica','Australia']
                .forEach(v => mm.put('Hello', v));
            expect(mm.size()).toBe(7);
            expect(mm.keySet().size).toBe(1);
            const values = mm.removeAll('Hello');
            expect(values.size).toBe(7);
            expect(mm.size()).toBe(0);
            expect(mm.keySet().size).toBe(0);
            mm.put('Hello', 'World');
            expect(mm.size()).toBe(1);
            expect(mm.keySet().size).toBe(1);
        });
    });

    describe('testMultiMapRemoveEntries', () => {
        it('remove single entry by key+value', () => {
            const mm = makeMultiMap<string, string>();
            ['World','Europe','America','Asia','Africa','Antarctica','Australia']
                .forEach(v => mm.put('Hello', v));
            expect(mm.remove('Hello', 'World')).toBe(true);
            expect(mm.size()).toBe(6);
        });
    });

    describe('testMultiMapEntrySet', () => {
        it('entrySet returns all key-value pairs', () => {
            const mm = makeMultiMap<string, string>();
            ['World','Europe','America','Asia','Africa','Antarctica','Australia']
                .forEach(v => mm.put('Hello', v));
            const entries = mm.entrySet();
            expect(entries.length).toBe(7);
            for (const [k] of entries) expect(k).toBe('Hello');
        });
    });

    describe('testMultiMapValueCount', () => {
        it('valueCount returns count for given key', () => {
            const mm = makeMultiMap<number, string>();
            mm.put(1, 'World'); mm.put(2, 'Africa'); mm.put(1, 'America');
            mm.put(2, 'Antarctica'); mm.put(1, 'Asia'); mm.put(1, 'Europe');
            mm.put(2, 'Australia');
            expect(mm.valueCount(1)).toBe(4);
            expect(mm.valueCount(2)).toBe(3);
        });
    });

    describe('testContainsKey', () => {
        it('containsKey returns correct values', () => {
            const mm = makeMultiMap<string, string>();
            expect(mm.containsKey('test')).toBe(false);
            mm.put('test', 'test');
            expect(mm.containsKey('test')).toBe(true);
            mm.removeAll('test');
            expect(mm.containsKey('test')).toBe(false);
        });
    });

    // ===== null checks =====
    describe('testGet_whenNullKey', () => {
        it('throws NullPointerException', () => {
            expect(() => makeMultiMap().get(null)).toThrow();
        });
    });

    describe('testPut_whenNullKey', () => {
        it('throws NullPointerException for null key', () => {
            expect(() => makeMultiMap().put(null, 'someVal')).toThrow();
        });
    });

    describe('testPut_whenNullValue', () => {
        it('throws NullPointerException for null value', () => {
            expect(() => makeMultiMap().put('someVal', null)).toThrow();
        });
    });

    describe('testContainsKey_whenNullKey', () => {
        it('throws NullPointerException', () => {
            expect(() => makeMultiMap().containsKey(null)).toThrow();
        });
    });

    describe('testContainsValue_whenNullKey', () => {
        it('throws NullPointerException', () => {
            expect(() => makeMultiMap().containsValue(null)).toThrow();
        });
    });

    describe('testContainsEntry_whenNullKey', () => {
        it('throws NullPointerException for null key', () => {
            expect(() => makeMultiMap().containsEntry(null, 'someVal')).toThrow();
        });
    });

    describe('testContainsEntry_whenNullValue', () => {
        it('throws NullPointerException for null value', () => {
            expect(() => makeMultiMap().containsEntry('someVal', null)).toThrow();
        });
    });

    // ===== SET collection type =====
    describe('testPutGetRemoveWhileCollectionTypeSet', () => {
        it('SET type deduplicates values per key', () => {
            const mm = makeMultiMap<string, string>(ValueCollectionType.SET);
            expect(mm.put('key1', 'key1_value1')).toBe(true);
            expect(mm.put('key1', 'key1_value2')).toBe(true);
            expect(mm.put('key2', 'key2_value1')).toBe(true);
            expect(mm.put('key2', 'key2_value1')).toBe(false); // duplicate in SET

            expect(mm.valueCount('key1')).toBe(2);
            expect(mm.valueCount('key2')).toBe(1);
            expect(mm.size()).toBe(3);

            const col = mm.get('key2');
            expect(col.size).toBe(1);
            expect([...col][0]).toBe('key2_value1');

            expect(mm.remove('key1', 'key1_value1')).toBe(true);
            expect(mm.remove('key1', 'key1_value1')).toBe(false);
            expect(mm.remove('key1', 'key1_value2')).toBe(true);
            expect(mm.get('key1').size).toBe(0);

            const r = mm.removeAll('key2');
            expect(r.size).toBe(1);
            expect([...r][0]).toBe('key2_value1');
        });
    });

    // ===== LIST collection type =====
    describe('testPutGetRemoveWhileCollectionTypeList', () => {
        it('LIST type allows duplicate values per key', () => {
            const mm = makeMultiMap<string, string>(ValueCollectionType.LIST);
            expect(mm.put('key1', 'key1_value1')).toBe(true);
            expect(mm.put('key1', 'key1_value2')).toBe(true);
            expect(mm.put('key2', 'key2_value1')).toBe(true);
            expect(mm.put('key2', 'key2_value1')).toBe(true); // duplicate allowed in LIST

            expect(mm.valueCount('key1')).toBe(2);
            expect(mm.valueCount('key2')).toBe(2);
            expect(mm.size()).toBe(4);

            const col = mm.get('key1');
            expect(col.size).toBe(2);
            const iter = col[Symbol.iterator]();
            expect(iter.next().value).toBe('key1_value1');
            expect(iter.next().value).toBe('key1_value2');

            expect(mm.remove('key1', 'key1_value1')).toBe(true);
            expect(mm.remove('key1', 'key1_value1')).toBe(false);
            expect(mm.remove('key1', 'key1_value2')).toBe(true);
            expect(mm.get('key1').size).toBe(0);

            const r = mm.removeAll('key2');
            expect(r.size).toBe(2);
            const ri = r[Symbol.iterator]();
            expect(ri.next().value).toBe('key2_value1');
            expect(ri.next().value).toBe('key2_value1');
        });
    });
});
