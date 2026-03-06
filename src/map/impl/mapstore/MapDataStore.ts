export interface MapDataStore<K, V> {
  /** Called after RecordStore write — async for write-through, instant-queue for write-behind. */
  add(key: K, value: V, now: number): Promise<void>;
  /** Bulk add — routes to storeAll on write-through, batch-queues on write-behind. */
  addAll(entries: Map<K, V>): Promise<void>;
  /** Called after RecordStore remove. */
  remove(key: K, now: number): Promise<void>;
  /** Load-on-miss: called when RecordStore returns null. */
  load(key: K): Promise<V | null>;
  /** Batch load-on-miss. */
  loadAll(keys: K[]): Promise<Map<K, V>>;
  /** Flush all pending writes (used on shutdown). */
  flush(): Promise<void>;
  /**
   * Clear hook invoked by map.clear().
   * MapStore-backed implementations must clear external persisted state.
   * Loader-only implementations are allowed to no-op (external source remains authoritative).
   */
  clear(): Promise<void>;
  /** True when a real store is wired (false for EmptyMapDataStore). */
  isWithStore(): boolean;
  /** True when write-behind has entries waiting to be flushed. */
  hasPendingWrites(): boolean;
}
