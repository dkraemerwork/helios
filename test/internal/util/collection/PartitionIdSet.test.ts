import { describe, it, expect, beforeEach } from 'bun:test';
import { PartitionIdSet } from '@zenystx/core/internal/util/collection/PartitionIdSet';

describe('PartitionIdSetTest', () => {
  let set: PartitionIdSet;

  beforeEach(() => {
    set = new PartitionIdSet(271);
  });

  it('test_add', () => {
    set.add(3);
    expect(set.contains(3)).toBe(true);
    expect(set.contains(2)).toBe(false);
    set.add(126);
    expect(set.contains(126)).toBe(true);
  });

  it('test_size', () => {
    expect(set.size()).toEqual(0);
    set.add(3);
    expect(set.size()).toEqual(1);
    set.add(7);
    expect(set.size()).toEqual(2);
    set.add(3);
    expect(set.size()).toEqual(2);
    set.remove(7);
    expect(set.size()).toEqual(1);
    set.clear();
    expect(set.size()).toEqual(0);
  });

  it('test_isEmpty', () => {
    expect(set.isEmpty()).toBe(true);
    set.add(17);
    expect(set.isEmpty()).toBe(false);
    set.remove(17);
    expect(set.isEmpty()).toBe(true);
  });

  it('test_contains', () => {
    expect(set.contains(5)).toBe(false);
    set.add(5);
    expect(set.contains(5)).toBe(true);
    set.remove(5);
    expect(set.contains(5)).toBe(false);
  });

  it('test_complement', () => {
    set.add(0);
    set.add(1);
    set.complement();
    expect(set.contains(0)).toBe(false);
    expect(set.contains(1)).toBe(false);
    expect(set.contains(2)).toBe(true);
    expect(set.size()).toEqual(269);
  });

  it('test_union', () => {
    set.add(1);
    const other = new PartitionIdSet(271);
    other.add(2);
    other.add(3);
    set.union(other);
    expect(set.contains(1)).toBe(true);
    expect(set.contains(2)).toBe(true);
    expect(set.contains(3)).toBe(true);
  });

  it('test_copyOf', () => {
    set.add(10);
    set.add(20);
    const copy = new PartitionIdSet(set);
    expect(copy.contains(10)).toBe(true);
    expect(copy.contains(20)).toBe(true);
    copy.add(30);
    expect(set.contains(30)).toBe(false);
  });

  it('test_iterator', () => {
    set.add(5);
    set.add(10);
    set.add(15);
    const values: number[] = [];
    for (const v of set) {
      values.push(v);
    }
    values.sort((a, b) => a - b);
    expect(values).toEqual([5, 10, 15]);
  });

  it('test_partitionCount', () => {
    expect(set.partitionCount()).toEqual(271);
  });

  it('test_addAllFromCollection', () => {
    set.addAll([0, 1, 2, 3, 4]);
    expect(set.size()).toEqual(5);
    for (let i = 0; i < 5; i++) {
      expect(set.contains(i)).toBe(true);
    }
  });
});
