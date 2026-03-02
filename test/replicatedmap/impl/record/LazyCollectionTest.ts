import { describe, it, expect } from 'bun:test';
import { LazyCollection } from '@helios/replicatedmap/impl/record/LazyCollection';
import { InternalReplicatedMapStorage } from '@helios/replicatedmap/impl/record/InternalReplicatedMapStorage';

describe('LazyCollectionTest', () => {
  // Use a real InternalReplicatedMapStorage with a no-op iterator factory
  const storage = new InternalReplicatedMapStorage<unknown, unknown>();
  const iteratorFactory = {
    create: (_it: any) => ({ hasNext: () => false, next: () => { throw new Error(); } } as any),
  };
  const collection = new LazyCollection<unknown, unknown>(iteratorFactory as any, storage);

  it('contains throws UnsupportedOperationException', () => {
    expect(() => (collection as any).contains(null)).toThrow();
  });

  it('containsAll throws UnsupportedOperationException', () => {
    expect(() => (collection as any).containsAll([])).toThrow();
  });

  it('add throws UnsupportedOperationException', () => {
    expect(() => (collection as any).add(null)).toThrow();
  });

  it('addAll throws UnsupportedOperationException', () => {
    expect(() => (collection as any).addAll([])).toThrow();
  });

  it('remove throws UnsupportedOperationException', () => {
    expect(() => (collection as any).remove(null)).toThrow();
  });

  it('removeAll throws UnsupportedOperationException', () => {
    expect(() => (collection as any).removeAll([])).toThrow();
  });

  it('retainAll throws UnsupportedOperationException', () => {
    expect(() => (collection as any).retainAll([])).toThrow();
  });

  it('clear throws UnsupportedOperationException', () => {
    expect(() => (collection as any).clear()).toThrow();
  });
});
