import { describe, test, expect } from 'bun:test';
import { SortedIndex } from '@zenystx/core/query/impl/SortedIndex';
import { IndexType } from '@zenystx/core/query/impl/Index';

describe('SortedIndex', () => {

  test('getConfig_returnsSortedType', () => {
    const idx = new SortedIndex();
    expect(idx.getConfig().getType()).toBe(IndexType.SORTED);
  });

  test('insert_and_getEqual_singleEntry', () => {
    const idx = new SortedIndex();
    idx.insert(10, 'key1');
    expect(idx.getEqual(10)).toEqual(['key1']);
    expect(idx.getEqual(99)).toEqual([]);
  });

  test('insert_multipleEntries_maintainsSortedOrder', () => {
    const idx = new SortedIndex();
    idx.insert(30, 'key3');
    idx.insert(10, 'key1');
    idx.insert(20, 'key2');
    expect(idx.getBetween(1, 100)).toEqual(['key1', 'key2', 'key3']);
  });

  test('getBetween_inclusiveBounds', () => {
    const idx = new SortedIndex();
    idx.insert(1, 'k1');
    idx.insert(5, 'k5');
    idx.insert(10, 'k10');
    idx.insert(15, 'k15');
    idx.insert(20, 'k20');
    expect(idx.getBetween(5, 15)).toEqual(['k5', 'k10', 'k15']);
    expect(idx.getBetween(1, 1)).toEqual(['k1']);
    expect(idx.getBetween(6, 9)).toEqual([]);
  });

  test('getGreaterThan_exclusive', () => {
    const idx = new SortedIndex();
    idx.insert(1, 'k1'); idx.insert(5, 'k5'); idx.insert(10, 'k10');
    expect(idx.getGreaterThan(5, false)).toEqual(['k10']);
  });

  test('getGreaterThan_inclusive', () => {
    const idx = new SortedIndex();
    idx.insert(1, 'k1'); idx.insert(5, 'k5'); idx.insert(10, 'k10');
    expect(idx.getGreaterThan(5, true)).toEqual(['k5', 'k10']);
  });

  test('getLessThan_exclusive', () => {
    const idx = new SortedIndex();
    idx.insert(1, 'k1'); idx.insert(5, 'k5'); idx.insert(10, 'k10');
    expect(idx.getLessThan(5, false)).toEqual(['k1']);
  });

  test('getLessThan_inclusive', () => {
    const idx = new SortedIndex();
    idx.insert(1, 'k1'); idx.insert(5, 'k5'); idx.insert(10, 'k10');
    expect(idx.getLessThan(5, true)).toEqual(['k1', 'k5']);
  });

  test('getByPrefix_returnsMatchingStrings', () => {
    const idx = new SortedIndex();
    idx.insert('alice', 'k1');
    idx.insert('alfred', 'k2');
    idx.insert('bob', 'k3');
    idx.insert('barbara', 'k4');
    idx.insert('al', 'k5');
    const result = idx.getByPrefix('al').sort();
    expect(result).toEqual(['k1', 'k2', 'k5'].sort());
  });

  test('getByPrefix_noMatch_returnsEmpty', () => {
    const idx = new SortedIndex();
    idx.insert('alice', 'k1');
    expect(idx.getByPrefix('z')).toEqual([]);
  });

  test('getByPrefix_exactAndLongerMatches', () => {
    const idx = new SortedIndex();
    idx.insert('alice', 'k1');
    idx.insert('alicex', 'k2');
    const result = idx.getByPrefix('alice').sort();
    expect(result).toEqual(['k1', 'k2'].sort());
  });

  test('remove_existingEntry', () => {
    const idx = new SortedIndex();
    idx.insert(10, 'k1');
    idx.insert(10, 'k2');
    idx.remove(10, 'k1');
    expect(idx.getEqual(10)).toEqual(['k2']);
  });

  test('remove_nonExistentEntry_isNoOp', () => {
    const idx = new SortedIndex();
    idx.insert(10, 'k1');
    idx.remove(10, 'nonexistent');
    expect(idx.getEqual(10)).toEqual(['k1']);
  });

  test('remove_nonExistentValue_isNoOp', () => {
    const idx = new SortedIndex();
    idx.remove(99, 'k1');
    expect(idx.size).toBe(0);
  });

  test('size_tracksCorrectly', () => {
    const idx = new SortedIndex();
    expect(idx.size).toBe(0);
    idx.insert(1, 'k1');
    idx.insert(2, 'k2');
    expect(idx.size).toBe(2);
    idx.insert(1, 'k3');
    expect(idx.size).toBe(3);
    idx.remove(1, 'k1');
    expect(idx.size).toBe(2);
  });

  test('getBetween_withStrings', () => {
    const idx = new SortedIndex();
    idx.insert('apple', 'k1');
    idx.insert('banana', 'k2');
    idx.insert('cherry', 'k3');
    idx.insert('date', 'k4');
    expect(idx.getBetween('banana', 'cherry')).toEqual(['k2', 'k3']);
  });

  test('getEqual_multipleEntriesSameValue', () => {
    const idx = new SortedIndex();
    idx.insert(5, 'k1');
    idx.insert(5, 'k2');
    idx.insert(5, 'k3');
    const result = idx.getEqual(5).sort();
    expect(result).toEqual(['k1', 'k2', 'k3'].sort());
  });
});
