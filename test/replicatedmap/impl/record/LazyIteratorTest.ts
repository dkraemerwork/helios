import { describe, it, expect, beforeEach } from 'bun:test';
import { InternalReplicatedMapStorage } from '@zenystx/helios-core/replicatedmap/impl/record/InternalReplicatedMapStorage';
import { ReplicatedRecord } from '@zenystx/helios-core/replicatedmap/impl/record/ReplicatedRecord';
import { LazyCollection } from '@zenystx/helios-core/replicatedmap/impl/record/LazyCollection';
import { LazySet } from '@zenystx/helios-core/replicatedmap/impl/record/LazySet';
import { ValuesIteratorFactory } from '@zenystx/helios-core/replicatedmap/impl/record/ValuesIteratorFactory';
import { KeySetIteratorFactory } from '@zenystx/helios-core/replicatedmap/impl/record/KeySetIteratorFactory';
import { EntrySetIteratorFactory } from '@zenystx/helios-core/replicatedmap/impl/record/EntrySetIteratorFactory';
import type { ReplicatedRecordStore } from '@zenystx/helios-core/replicatedmap/impl/record/ReplicatedRecordStore';

// Test data: 100 records
const TEST_DATA_SIMPLE = new InternalReplicatedMapStorage<string, number>();
for (let i = 0; i < 100; i++) {
  const key = `key-${i}`;
  TEST_DATA_SIMPLE.put(key, new ReplicatedRecord<string, number>(key, i, -1));
  TEST_DATA_SIMPLE.incrementVersion();
}

// Mock ReplicatedRecordStore: marshall/unmarshall returns the argument unchanged
function makeRecordStore(): ReplicatedRecordStore {
  return {
    marshall: (v: unknown) => v,
    unmarshall: (v: unknown) => v,
  } as unknown as ReplicatedRecordStore;
}

describe('LazyIteratorTest', () => {
  let replicatedRecordStore: ReplicatedRecordStore;

  beforeEach(() => {
    replicatedRecordStore = makeRecordStore();
  });

  it('testLazyCollection_size', () => {
    const factory = new ValuesIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazyCollection<string, number>(factory, TEST_DATA_SIMPLE);
    expect(collection.size()).toBe(100);
  });

  it('testLazyCollection_isEmpty', () => {
    const factory = new ValuesIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazyCollection<string, number>(factory, TEST_DATA_SIMPLE);
    expect(collection.isEmpty()).toBe(false);
  });

  it('testLazyCollection_withValuesIterator_hasNext', () => {
    const factory = new ValuesIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazyCollection<string, number>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    let count = 0;
    const values = new Set<number>();
    while (iterator.hasNext()) {
      count++;
      values.add(iterator.next());
    }
    expect(count).toBe(100);
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazyCollection_withValuesIterator_hasNext_everySecondTime', () => {
    const factory = new ValuesIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazyCollection<string, number>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        expect(iterator.hasNext()).toBe(true);
      }
      values.add(iterator.next());
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazyCollection_withValuesIterator_next_whenNoMoreElementsAreAvailable', () => {
    const factory = new ValuesIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazyCollection<string, number>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(iterator.next());
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
    expect(() => iterator.next()).toThrow();
  });

  it('testLazySet_size', () => {
    const factory = new KeySetIteratorFactory<string, number>(replicatedRecordStore);
    const set = new LazySet<string, number, string>(factory, TEST_DATA_SIMPLE);
    expect(set.size()).toBe(100);
  });

  it('testLazySet_isEmpty', () => {
    const factory = new KeySetIteratorFactory<string, number>(replicatedRecordStore);
    const set = new LazySet<string, number, string>(factory, TEST_DATA_SIMPLE);
    expect(set.isEmpty()).toBe(false);
  });

  it('testLazySet_withKeySetIterator_hasNext', () => {
    const factory = new KeySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, string>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    let count = 0;
    const values = new Set<string>();
    while (iterator.hasNext()) {
      count++;
      values.add(iterator.next());
    }
    expect(count).toBe(100);
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazySet_withKeySetIterator_hasNext_everySecondTime', () => {
    const factory = new KeySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, string>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<string>();
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        expect(iterator.hasNext()).toBe(true);
      }
      values.add(iterator.next());
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazySet_withKeySetIterator_next_whenNoMoreElementsAreAvailable', () => {
    const factory = new KeySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, string>(factory, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<string>();
    for (let i = 0; i < 100; i++) {
      values.add(iterator.next());
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
    expect(() => iterator.next()).toThrow();
  });

  it('testLazySet_withEntrySetIterator_hasNext', () => {
    const factory = new EntrySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, [string, number]>(factory as any, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    let count = 0;
    const values = new Set<number>();
    while (iterator.hasNext()) {
      count++;
      const entry = iterator.next() as unknown as [string, number];
      values.add(entry[1]);
    }
    expect(count).toBe(100);
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazySet_withEntrySetIterator_hasNext_everySecondTime', () => {
    const factory = new EntrySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, [string, number]>(factory as any, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      if (i % 2 === 0) {
        expect(iterator.hasNext()).toBe(true);
      }
      const entry = iterator.next() as unknown as [string, number];
      values.add(entry[1]);
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
  });

  it('testLazySet_withEntrySetIterator_next_whenNoMoreElementsAreAvailable', () => {
    const factory = new EntrySetIteratorFactory<string, number>(replicatedRecordStore);
    const collection = new LazySet<string, number, [string, number]>(factory as any, TEST_DATA_SIMPLE);
    const iterator = collection.iterator();

    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const entry = iterator.next() as unknown as [string, number];
      values.add(entry[1]);
    }
    expect(values.size).toBe(100);
    expect(iterator.hasNext()).toBe(false);
    expect(() => iterator.next()).toThrow();
  });
});
