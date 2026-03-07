import type { IteratorFactory, LazyIterator } from './LazySet';
import type { ReplicatedRecord } from './ReplicatedRecord';
import type { ReplicatedRecordStore } from './ReplicatedRecordStore';

export type MapEntry<K, V> = [K, V];

/**
 * Iterator factory that produces entry iterators for LazySet.
 * Java source: com.hazelcast.replicatedmap.impl.record.EntrySetIteratorFactory
 */
export class EntrySetIteratorFactory<K, V> implements IteratorFactory<K, V, MapEntry<K, V>> {
  private readonly _recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>;

  constructor(recordStore: Pick<ReplicatedRecordStore, 'unmarshall'>) {
    this._recordStore = recordStore;
  }

  create(iterator: IterableIterator<[K, ReplicatedRecord<K, V>]>): LazyIterator<MapEntry<K, V>> {
    return new EntrySetIterator<K, V>(iterator, this._recordStore);
  }
}

class EntrySetIterator<K, V> implements LazyIterator<MapEntry<K, V>> {
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

  next(): MapEntry<K, V> {
    let entry = this._entry;
    let key: unknown = entry != null ? entry[0] : null;
    let value: unknown = entry != null && entry[1] != null ? entry[1].getValue() : null;

    if (entry == null) {
      while (true) {
        const result = this._iterator.next();
        if (result.done) throw new Error('NoSuchElementException');
        entry = result.value;
        key = entry[0];
        const record = entry[1];
        value = record != null ? record.getValue() : null;
        if (key != null && value != null) break;
      }
    }

    this._entry = null;
    if (key == null || value == null) throw new Error('NoSuchElementException');

    key = this._recordStore.unmarshall(key);
    value = this._recordStore.unmarshall(value);
    return [key as K, value as V];
  }
}
