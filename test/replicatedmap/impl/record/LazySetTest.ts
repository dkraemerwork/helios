import { describe, it, expect, beforeEach } from 'bun:test';
import { LazySet } from '@helios/replicatedmap/impl/record/LazySet';

describe('LazySetTest', () => {
  let set: LazySet<object, object, object>;

  beforeEach(() => {
    const keySetIteratorFactory = { create: (_it: any) => ({ hasNext: () => false, next: () => { throw new Error(); } }) };
    const storage = { size: () => 0, isEmpty: () => true, entrySet: () => new Map().entries(), values: () => [] };
    set = new LazySet<object, object, object>(keySetIteratorFactory as any, storage as any);
  });

  it('contains throws UnsupportedOperationException', () => {
    expect(() => set.contains(null)).toThrow();
  });

  it('containsAll throws UnsupportedOperationException', () => {
    expect(() => set.containsAll([])).toThrow();
  });

  it('add throws UnsupportedOperationException', () => {
    expect(() => set.add(null as any)).toThrow();
  });

  it('addAll throws UnsupportedOperationException', () => {
    expect(() => set.addAll([])).toThrow();
  });

  it('remove throws UnsupportedOperationException', () => {
    expect(() => set.remove(null)).toThrow();
  });

  it('removeAll throws UnsupportedOperationException', () => {
    expect(() => set.removeAll([])).toThrow();
  });

  it('retainAll throws UnsupportedOperationException', () => {
    expect(() => set.retainAll([])).toThrow();
  });

  it('clear throws UnsupportedOperationException', () => {
    expect(() => set.clear()).toThrow();
  });
});
