import type { IteratorFactory, LazyIterator } from './LazySet';
import type { ReplicatedRecord } from './ReplicatedRecord';
import type { ReplicatedRecordStore } from './ReplicatedRecordStore';

/**
 * Iterator factory that produces value iterators for LazyCollection.
 * Java source: com.hazelcast.replicatedmap.impl.record.ValuesIteratorFactory
 */
export class ValuesIteratorFactory<K, V> implements IteratorFactory<K, V, V> {
  private readonly _recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>;

  constructor(recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>) {
    this._recordStore = recordStore;
  }

  create(iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>): LazyIterator<V> {
    return new ValuesIterator<K, V>(iterator, this._recordStore);
  }
}

class ValuesIterator<K, V> implements LazyIterator<V> {
  private readonly _iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>;
  private readonly _recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>;
  private _entry: [K, ReplicatedRecord<K, V>] | null = null;

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
        this._entry = entry;
        return true;
      }
    }
  }

  next(): V {
    let entry = this._entry;
    let value: unknown = entry != null && entry[1] != null ? entry[1].getValue() : null;

    if (entry == null) {
      // find next valid entry
      while (true) {
        const result = this._iterator.next();
        if (result.done) {
          throw new Error('NoSuchElementException');
        }
        entry = result.value;
        const record = entry[1];
        value = record != null ? record.getValue() : null;
        if (value != null) break;
      }
    }

    this._entry = null;
    if (value == null) {
      throw new Error('NoSuchElementException');
    }

    return this._recordStore.unmarshall(value) as V;
  }
}
