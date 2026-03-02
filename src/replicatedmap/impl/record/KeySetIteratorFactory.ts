import type { ReplicatedRecord } from './ReplicatedRecord';
import type { ReplicatedRecordStore } from './ReplicatedRecordStore';
import type { IteratorFactory, LazyIterator } from './LazySet';

/**
 * Iterator factory that produces key iterators for LazySet.
 * Java source: com.hazelcast.replicatedmap.impl.record.KeySetIteratorFactory
 */
export class KeySetIteratorFactory<K, V> implements IteratorFactory<K, V, K> {
  private readonly _recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>;

  constructor(recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>) {
    this._recordStore = recordStore;
  }

  create(iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>): LazyIterator<K> {
    return new KeySetIterator<K, V>(iterator, this._recordStore);
  }
}

class KeySetIterator<K, V> implements LazyIterator<K> {
  private readonly _iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>;
  private readonly _recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>;
  private _nextEntry: [K, ReplicatedRecord<K, V>] | null = null;

  constructor(iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>, recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>) {
    this._iterator = iterator;
    this._recordStore = recordStore;
  }

  hasNext(): boolean {
    while (true) {
      const result = this._iterator.next();
      if (result.done) return false;
      const entry = result.value;
      if (entry[0] != null && entry[1] != null) {
        this._nextEntry = entry;
        return true;
      }
    }
  }

  next(): K {
    let entry = this._nextEntry;
    let key: unknown = entry != null ? entry[0] : null;

    if (entry == null) {
      while (true) {
        const result = this._iterator.next();
        if (result.done) throw new Error('NoSuchElementException');
        entry = result.value;
        key = entry[0];
        if (key != null) break;
      }
    }

    this._nextEntry = null;
    if (key == null) throw new Error('NoSuchElementException');

    return this._recordStore.unmarshall(key) as K;
  }
}
