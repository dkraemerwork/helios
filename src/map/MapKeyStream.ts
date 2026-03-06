/**
 * Streaming contract for loadAllKeys() — replaces the old K[] return type.
 *
 * Adapters produce a MapKeyStream; core/runtime owns batching, backpressure,
 * ordering, and consumption. Runtime must call close() in finally on all scans.
 */
export class MapKeyStream<K> implements AsyncIterable<K> {
  private _closed = false;
  private readonly _source: AsyncIterable<K>;

  private constructor(source: AsyncIterable<K>) {
    this._source = source;
  }

  /**
   * Create a MapKeyStream from any iterable or async iterable of keys.
   */
  static fromIterable<K>(keys: Iterable<K> | AsyncIterable<K>): MapKeyStream<K> {
    if (Symbol.asyncIterator in Object(keys)) {
      return new MapKeyStream(keys as AsyncIterable<K>);
    }
    const syncKeys = keys as Iterable<K>;
    const asyncIterable: AsyncIterable<K> = {
      [Symbol.asyncIterator](): AsyncIterator<K> {
        const iter = syncKeys[Symbol.iterator]();
        return {
          async next(): Promise<IteratorResult<K>> {
            return iter.next();
          },
        };
      },
    };
    return new MapKeyStream(asyncIterable);
  }

  /**
   * Create an empty MapKeyStream.
   */
  static empty<K>(): MapKeyStream<K> {
    return MapKeyStream.fromIterable<K>([]);
  }

  [Symbol.asyncIterator](): AsyncIterator<K> {
    const source = this._source[Symbol.asyncIterator]();
    const stream = this;
    return {
      async next(): Promise<IteratorResult<K>> {
        if (stream._closed) {
          return { done: true, value: undefined };
        }
        return source.next();
      },
    };
  }

  /**
   * Signal that no more keys are needed. Stops further iteration.
   */
  async close(): Promise<void> {
    this._closed = true;
  }
}
