import type { InternalReplicatedMapStorage } from './InternalReplicatedMapStorage';
import type { ReplicatedRecord } from './ReplicatedRecord';

/**
 * Interface for iterator factories used by LazySet.
 */
export interface IteratorFactory<K, V, R> {
  create(iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>): LazyIterator<R>;
}

/**
 * A lazy iterator that supports hasNext()/next() semantics.
 */
export interface LazyIterator<R> {
  hasNext(): boolean;
  next(): R;
}

/**
 * Read-only lazy set backed by InternalReplicatedMapStorage.
 * Java source: com.hazelcast.replicatedmap.impl.record.LazySet
 */
export class LazySet<K, V, R> {
  private readonly _storage: InternalReplicatedMapStorage<K, V>;
  private readonly _iteratorFactory: IteratorFactory<K, V, R>;

  constructor(iteratorFactory: IteratorFactory<K, V, R>, storage: InternalReplicatedMapStorage<K, V>) {
    this._iteratorFactory = iteratorFactory;
    this._storage = storage;
  }

  size(): number {
    return this._storage.size();
  }

  isEmpty(): boolean {
    return this._storage.isEmpty();
  }

  contains(_o: unknown): never {
    throw new Error('UnsupportedOperationException: LazySet does not support contains requests');
  }

  iterator(): LazyIterator<R> {
    const iter = this._storage.entrySet();
    return this._iteratorFactory.create(iter);
  }

  add(_e: R): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }

  remove(_o: unknown): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }

  containsAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazySet does not support contains requests');
  }

  addAll(_c: R[]): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }

  retainAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }

  removeAll(_c: unknown[]): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }

  clear(): never {
    throw new Error('UnsupportedOperationException: LazySet is not modifiable');
  }
}
