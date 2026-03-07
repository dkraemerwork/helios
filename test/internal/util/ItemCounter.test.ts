import { ItemCounter } from '@zenystx/helios-core/internal/util/ItemCounter';
import { beforeEach, describe, expect, it } from 'bun:test';

describe('ItemCounterTest', () => {
  let counter: ItemCounter<string | object>;

  beforeEach(() => {
    counter = new ItemCounter();
  });

  it('testKeySet', () => {
    counter.add('key1', 1);
    counter.add('key2', 1);
    expect(counter.keySet()).toEqual(new Set(['key1', 'key2']));
  });

  it('testDescendingKeys', () => {
    counter.add('key1', 2);
    counter.add('key2', 3);
    counter.add('key3', 1);
    expect(counter.descendingKeys()).toEqual(['key2', 'key1', 'key3']);
  });

  it('testGet_returnsZeroWhenEmpty', () => {
    const obj = {};
    expect(counter.get(obj)).toEqual(0);
  });

  it('testGet_returnsPreviouslySetValue', () => {
    const value = 9007199254740991;
    const obj = {};
    counter.set(obj, value);
    expect(counter.get(obj)).toEqual(value);
  });

  it('testSet_overridePreviousValue', () => {
    const obj = {};
    counter.set(obj, -100);
    counter.set(obj, 42);
    expect(counter.get(obj)).toEqual(42);
    expect(counter.total()).toEqual(42);
  });

  it('testAdd_whenNoPreviousValueExist', () => {
    const obj = {};
    counter.add(obj, 1);
    expect(counter.get(obj)).toEqual(1);
  });

  it('testAdd_whenPreviousValueExists', () => {
    const obj = {};
    counter.add(obj, 3);
    counter.add(obj, 5);
    expect(counter.get(obj)).toEqual(8);
    expect(counter.total()).toEqual(8);
  });

  it('testTotal', () => {
    counter.add('a', 3);
    counter.add('b', 7);
    expect(counter.total()).toEqual(10);
  });

  it('testReset', () => {
    counter.add('a', 5);
    counter.reset();
    expect(counter.get('a')).toEqual(0);
    expect(counter.total()).toEqual(0);
  });

  it('testClear', () => {
    counter.add('a', 5);
    counter.clear();
    expect(counter.get('a')).toEqual(0);
    expect(counter.keySet().size).toEqual(0);
  });
});
