import type { ReplicatedRecord } from './ReplicatedRecord';
import type { InternalReplicatedMapStorage } from './InternalReplicatedMapStorage';
import type { IteratorFactory, LazyIterator } from './LazySet';

/**
 * Read-only lazy collection backed by InternalReplicatedMapStorage.
 * Java source: com.hazelcast.replicatedmap.impl.record.LazyCollection
 */
export class LazyCollection<K, V> {
  private readonly _storage: InternalReplicatedMapStorage<K, V>;
  private readonly _iteratorFactory: IteratorFactory<K, V, V>;

  constructor(iteratorFactory: IteratorFactory<K, V, V>, storage: InternalReplicatedMapStorage<K, V>) {
    this._iteratorFactory = iteratorFactory;
    this._storage = storage;
  }

  size(): number {
    return this._storage.size();
  }

  isEmpty(): boolean {
    return this._storage.isEmpty();
  }

  contains(_value: unknown): never {
    throw new Error('UnsupportedOperationException: LazySet does not support contains requests');
  }

  iterator(): LazyIterator<V> {
    const iter = this._storage.entrySet();
    return this._iteratorFactory.create(iter);
  }

  add(_v: V): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }

  remove(_o: unknown): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }

  containsAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazySet does not support contains requests');
  }

  addAll(_c: V[]): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }

  removeAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }

  retainAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }

  clear(): never {
    throw new Error('UnsupportedOperationException: LazyList is not modifiable');
  }
}
