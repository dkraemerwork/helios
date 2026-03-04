import { describe, test, expect } from 'bun:test';
import { HashIndex } from '@helios/query/impl/HashIndex';
import { IndexType } from '@helios/query/impl/Index';

describe('HashIndex', () => {

  test('getConfig_returnsHashType', () => {
    const idx = new HashIndex();
    expect(idx.getConfig().getType()).toBe(IndexType.HASH);
  });

  test('insert_and_getEqual_singleValue', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    expect([...idx.getEqual('Berlin')]).toEqual(['key1']);
    expect([...idx.getEqual('Paris')]).toEqual([]);
  });

  test('insert_multipleKeysForSameValue', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    idx.insert('Berlin', 'key2');
    idx.insert('Berlin', 'key3');
    const result = [...idx.getEqual('Berlin')].sort();
    expect(result).toEqual(['key1', 'key2', 'key3']);
    expect(idx.size).toBe(1); // one distinct value
  });

  test('insert_multipleDistinctValues', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    idx.insert('Paris', 'key2');
    idx.insert('London', 'key3');
    expect([...idx.getEqual('Berlin')]).toEqual(['key1']);
    expect([...idx.getEqual('Paris')]).toEqual(['key2']);
    expect(idx.size).toBe(3);
  });

  test('remove_existingKey', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    idx.insert('Berlin', 'key2');
    idx.remove('Berlin', 'key1');
    expect([...idx.getEqual('Berlin')]).toEqual(['key2']);
  });

  test('remove_lastKeyInBucket_deletesBucket', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    idx.remove('Berlin', 'key1');
    expect([...idx.getEqual('Berlin')]).toEqual([]);
    expect(idx.size).toBe(0); // bucket should be cleaned up
  });

  test('remove_nonExistentKey_isNoOp', () => {
    const idx = new HashIndex();
    idx.insert('Berlin', 'key1');
    idx.remove('Berlin', 'nonexistent');  // should not throw
    expect([...idx.getEqual('Berlin')]).toEqual(['key1']);
  });

  test('remove_nonExistentValue_isNoOp', () => {
    const idx = new HashIndex();
    idx.remove('Paris', 'key1');  // should not throw
    expect([...idx.getEqual('Paris')]).toEqual([]);
  });

  test('insert_numericValues', () => {
    const idx = new HashIndex();
    idx.insert(42, 'key1');
    idx.insert(100, 'key2');
    expect([...idx.getEqual(42)]).toEqual(['key1']);
    expect([...idx.getEqual(100)]).toEqual(['key2']);
    expect([...idx.getEqual(0)]).toEqual([]);
  });

  test('insert_nullValue', () => {
    const idx = new HashIndex();
    idx.insert(null, 'key1');
    expect([...idx.getEqual(null)]).toEqual(['key1']);
  });

  test('insert_booleanValues', () => {
    const idx = new HashIndex();
    idx.insert(true, 'key1');
    idx.insert(false, 'key2');
    expect([...idx.getEqual(true)]).toEqual(['key1']);
    expect([...idx.getEqual(false)]).toEqual(['key2']);
  });
});
