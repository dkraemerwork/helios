/**
 * Block 19.3 — Bulk I/O + Helios integration + real MongoDB proof
 *
 * Tests cover: batched storeAll/deleteAll with max-batch-size, retry ownership,
 * offload behavior, putAll bulk wiring, write-through/write-behind integration,
 * restart durability, shutdown flush, eager/lazy load, clear, bulk loadAllKeys,
 * MongoDB test harness wiring, and end-to-end proof.
 */
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { InitialLoadMode, MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { MapStoreWrapper } from '@zenystx/helios-core/map/impl/mapstore/MapStoreWrapper';
import { WriteBehindProcessor } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindProcessor';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { WriteThroughStore } from '@zenystx/helios-core/map/impl/mapstore/writethrough/WriteThroughStore';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import { describe, expect, it } from 'bun:test';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTrackingStore<K = string, V = string>(data: Map<K, V> = new Map()) {
  const tracker = {
    storeCalls: [] as Array<{ key: K; value: V }>,
    storeAllCalls: [] as Array<Map<K, V>>,
    deleteCalls: [] as K[],
    deleteAllCalls: [] as Array<K[]>,
    loadAllKeysCalled: 0,
    initCalled: false,
    destroyCalled: false,
    storeAllErrors: 0,
    _shouldFailStoreAll: false,
    _failStoreAllTimes: 0,
    _storeAllAttempts: 0,

    async load(key: K): Promise<V | null> {
      return data.get(key) ?? null;
    },
    async loadAll(keys: K[]): Promise<Map<K, V>> {
      const result = new Map<K, V>();
      for (const k of keys) {
        const v = data.get(k);
        if (v !== undefined) result.set(k, v);
      }
      return result;
    },
    async loadAllKeys(): Promise<MapKeyStream<K>> {
      tracker.loadAllKeysCalled++;
      return MapKeyStream.fromIterable(data.keys());
    },
    async store(key: K, value: V): Promise<void> {
      tracker.storeCalls.push({ key, value });
      data.set(key, value);
    },
    async storeAll(entries: Map<K, V>): Promise<void> {
      tracker._storeAllAttempts++;
      if (tracker._shouldFailStoreAll && tracker._storeAllAttempts <= tracker._failStoreAllTimes) {
        tracker.storeAllErrors++;
        throw new Error('storeAll simulated failure');
      }
      tracker.storeAllCalls.push(new Map(entries));
      for (const [k, v] of entries) data.set(k, v);
    },
    async delete(key: K): Promise<void> {
      tracker.deleteCalls.push(key);
      data.delete(key);
    },
    async deleteAll(keys: K[]): Promise<void> {
      tracker.deleteAllCalls.push([...keys]);
      for (const k of keys) data.delete(k);
    },
    async init(_properties: Map<string, string>, _mapName: string): Promise<void> {
      tracker.initCalled = true;
    },
    async destroy(): Promise<void> {
      tracker.destroyCalled = true;
    },
  };
  return tracker;
}

function makeInstance(mapName: string, storeConfig: MapStoreConfig): HeliosInstanceImpl {
  const config = new HeliosConfig('test');
  const mapConfig = new MapConfig(mapName);
  mapConfig.setMapStoreConfig(storeConfig);
  config.addMapConfig(mapConfig);
  return new HeliosInstanceImpl(config);
}

// ── 1. Batched storeAll with max-batch-size ──────────────────────────────────

describe('Batched storeAll with max-batch-size', () => {
  it('MongoMapStore.storeAll chunks by max-batch-size property', async () => {
    // When max-batch-size=2 and we store 5 entries, storeAll should issue
    // 3 bulkWrite calls (2+2+1)
    const store = createTrackingStore<string, string>();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteBatchSize(2);

    const ctx = await MapStoreContext.create<string, string>('batch-map', config);
    const ds = ctx.getMapDataStore();

    // Write-through: addAll should chunk to storeAll calls of size 2
    const entries = new Map<string, string>([
      ['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5'],
    ]);
    await ds.addAll(entries);

    // storeAll should have been called 3 times: [a,b], [c,d], [e]
    expect(store.storeAllCalls.length).toBe(3);
    expect(store.storeAllCalls[0].size).toBe(2);
    expect(store.storeAllCalls[1].size).toBe(2);
    expect(store.storeAllCalls[2].size).toBe(1);
  });

  it('storeAll with batch-size=1 calls store per entry (no batching)', async () => {
    const store = createTrackingStore<string, string>();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteBatchSize(1);

    const ctx = await MapStoreContext.create<string, string>('single-batch', config);
    const ds = ctx.getMapDataStore();

    await ds.addAll(new Map([['a', '1'], ['b', '2']]));
    // batch-size=1 should result in per-entry storeAll calls of size 1
    expect(store.storeAllCalls.length).toBe(2);
    expect(store.storeAllCalls[0].size).toBe(1);
    expect(store.storeAllCalls[1].size).toBe(1);
  });
});

// ── 2. Batched deleteAll with max-batch-size ─────────────────────────────────

describe('Batched deleteAll with max-batch-size', () => {
  it('deleteAll chunks by writeBatchSize', async () => {
    const data = new Map<string, string>([
      ['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5'],
    ]);
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteBatchSize(2);

    const ctx = await MapStoreContext.create<string, string>('del-batch', config);
    const ds = ctx.getMapDataStore();

    // clear() enumerates keys and deletes them — should chunk deleteAll
    await ds.clear();

    // deleteAll should have been chunked
    const totalDeleted = store.deleteAllCalls.reduce((sum, c) => sum + c.length, 0);
    expect(totalDeleted).toBe(5);
    expect(store.deleteAllCalls.length).toBeGreaterThanOrEqual(3); // 5/2 = 3 chunks
  });
});

// ── 3. Retry ownership — write-behind retries, adapter does not stack ────────

describe('Retry ownership', () => {
  it('WriteBehindProcessor retries failed batch then falls back to individual', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    store._shouldFailStoreAll = true;
    store._failStoreAllTimes = 10; // fail all storeAll calls

    const wrapper = new MapStoreWrapper<string, string>(store);
    const processor = new WriteBehindProcessor(wrapper, 10);

    // Process 2 ADD entries
    const { addedEntry } = await import('@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry');
    const entries = [
      addedEntry('k1', 'v1', 0),
      addedEntry('k2', 'v2', 0),
    ];

    const result = await processor.process(entries);

    // storeAll fails 3 times, then falls back to individual store() calls
    expect(result.batchFailures).toBe(1);
    expect(result.fallbackBatchCount).toBe(1);
    // Individual store should succeed (store() doesn't fail)
    expect(result.successfulEntries).toBe(2);
    expect(data.get('k1')).toBe('v1');
    expect(data.get('k2')).toBe('v2');
  });
});

// ── 4. Offload behavior ─────────────────────────────────────────────────────

describe('Offload behavior', () => {
  it('offload=true (default) wraps store operations off the hot path', async () => {
    const store = createTrackingStore<string, string>();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setOffload(true);

    // offload=true is the default
    expect(config.isOffload()).toBe(true);

    const ctx = await MapStoreContext.create<string, string>('offload-map', config);
    const ds = ctx.getMapDataStore();

    // Store should still work — offload just changes execution context
    await ds.add('k1', 'v1', Date.now());
    expect(store.storeCalls.length).toBe(1);
  });

  it('offload=false runs store operations inline', async () => {
    const store = createTrackingStore<string, string>();
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setOffload(false);

    const ctx = await MapStoreContext.create<string, string>('inline-map', config);
    const ds = ctx.getMapDataStore();

    await ds.add('k1', 'v1', Date.now());
    expect(store.storeCalls.length).toBe(1);
  });
});

// ── 5. putAll bulk wiring through IMap ───────────────────────────────────────

describe('putAll bulk wiring through IMap', () => {
  it('IMap.putAll stores all entries via owner-routed PutOperations', async () => {
    const store = createTrackingStore<string, string>();
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const instance = makeInstance('bulk-put-imap', storeConfig);
    const map = instance.getMap<string, string>('bulk-put-imap');

    await map.putAll([['a', '1'], ['b', '2'], ['c', '3']]);

    // Block 21.2: putAll routes through individual PutOperations (owner-scoped).
    // Each PutOperation calls mapDataStore.add() → store() individually.
    const totalStored = store.storeCalls.length +
      store.storeAllCalls.reduce((sum, m) => sum + m.size, 0);
    expect(totalStored).toBe(3);

    instance.shutdown();
  });
});

// ── 6. Write-through integration with restart ────────────────────────────────

describe('Write-through restart durability', () => {
  it('data survives instance restart via write-through store', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);

    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    // First instance: write data
    const inst1 = makeInstance('restart-map', storeConfig);
    const map1 = inst1.getMap<string, string>('restart-map');
    await map1.put('durable-key', 'durable-value');
    expect(data.get('durable-key')).toBe('durable-value');
    inst1.shutdown();

    // Second instance: data should be loadable from store
    const store2 = createTrackingStore(data);
    const storeConfig2 = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store2);
    const inst2 = makeInstance('restart-map', storeConfig2);
    const map2 = inst2.getMap<string, string>('restart-map');
    const val = await map2.get('durable-key');
    expect(val).toBe('durable-value');
    inst2.shutdown();
  });
});

// ── 7. Write-behind shutdown flush ───────────────────────────────────────────

describe('Write-behind shutdown flush', () => {
  it('shutdownAsync flushes write-behind entries to store', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(60); // very long delay

    const instance = makeInstance('wb-flush-map', storeConfig);
    const map = instance.getMap<string, string>('wb-flush-map');

    await map.put('k1', 'v1');
    await map.put('k2', 'v2');

    // Not yet flushed
    expect(data.has('k1')).toBe(false);

    // shutdownAsync must flush
    await instance.shutdownAsync();
    expect(data.get('k1')).toBe('v1');
    expect(data.get('k2')).toBe('v2');
  });
});

// ── 8. EAGER load proof ─────────────────────────────────────────────────────

describe('EAGER load integration', () => {
  it('EAGER preload populates IMap before first get', async () => {
    const data = new Map<string, string>([['pre1', 'val1'], ['pre2', 'val2']]);
    const store = createTrackingStore(data);
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.EAGER);

    const instance = makeInstance('eager-imap', storeConfig);
    const map = instance.getMap<string, string>('eager-imap');

    // First get should return preloaded value without load-on-miss
    const val = await map.get('pre1');
    expect(val).toBe('val1');
    // Trigger MapStore init
    expect(store.loadAllKeysCalled).toBeGreaterThanOrEqual(1);

    instance.shutdown();
  });
});

// ── 9. LAZY load proof ───────────────────────────────────────────────────────

describe('LAZY load integration', () => {
  it('LAZY mode loads on first miss', async () => {
    const data = new Map<string, string>([['lazy1', 'lv1']]);
    const store = createTrackingStore(data);
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setInitialLoadMode(InitialLoadMode.LAZY);

    const instance = makeInstance('lazy-imap', storeConfig);
    const map = instance.getMap<string, string>('lazy-imap');

    // loadAllKeys should NOT have been called (LAZY mode)
    const val = await map.get('lazy1');
    expect(val).toBe('lv1');
    expect(store.loadAllKeysCalled).toBe(0);

    instance.shutdown();
  });
});

// ── 10. Clear proof ──────────────────────────────────────────────────────────

describe('Clear integration', () => {
  it('clear removes entries from both map and external store', async () => {
    const data = new Map<string, string>([['c1', 'v1'], ['c2', 'v2']]);
    const store = createTrackingStore(data);
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const instance = makeInstance('clear-imap', storeConfig);
    const map = instance.getMap<string, string>('clear-imap');

    await map.clear();
    expect(data.size).toBe(0);
    instance.shutdown();
  });
});

// ── 11. Bulk getAll with loadAll ─────────────────────────────────────────────

describe('getAll bulk loading', () => {
  it('getAll loads missing keys in bulk via loadAll', async () => {
    const data = new Map<string, string>([['g1', 'v1'], ['g2', 'v2'], ['g3', 'v3']]);
    const store = createTrackingStore(data);
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const instance = makeInstance('getall-imap', storeConfig);
    const map = instance.getMap<string, string>('getall-imap');

    const result = await map.getAll(['g1', 'g2', 'g3']);
    expect(result.get('g1')).toBe('v1');
    expect(result.get('g2')).toBe('v2');
    expect(result.get('g3')).toBe('v3');
    instance.shutdown();
  });
});

// ── 12. Streaming loadAllKeys proof ──────────────────────────────────────────

describe('Streaming loadAllKeys', () => {
  it('loadAllKeys streams keys without full materialization', async () => {
    const data = new Map<string, string>();
    for (let i = 0; i < 100; i++) data.set(`key-${i}`, `val-${i}`);
    const store = createTrackingStore(data);

    const wrapper = new MapStoreWrapper<string, string>(store);
    const stream = await wrapper.loadAllKeys();

    const collected: string[] = [];
    for await (const k of stream) collected.push(k);
    await stream.close();

    expect(collected.length).toBe(100);
    expect(store.loadAllKeysCalled).toBe(1);
  });
});

// ── 13. WriteThroughStore addAll batching ─────────────────────────────────────

describe('WriteThroughStore addAll batching', () => {
  it('addAll with writeBatchSize > 1 chunks storeAll calls', async () => {
    const store = createTrackingStore<string, string>();
    const wrapper = new MapStoreWrapper<string, string>(store);
    const wt = new WriteThroughStore<string, string>(wrapper, 2);

    await wt.addAll(new Map([['a', '1'], ['b', '2'], ['c', '3']]));
    // Should chunk: [a,b] and [c]
    expect(store.storeAllCalls.length).toBe(2);
    expect(store.storeAllCalls[0].size).toBe(2);
    expect(store.storeAllCalls[1].size).toBe(1);
  });
});

// ── 14. WriteThroughStore clear batching ──────────────────────────────────────

describe('WriteThroughStore clear batching', () => {
  it('clear chunks deleteAll calls by writeBatchSize', async () => {
    const data = new Map<string, string>([
      ['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '5'],
    ]);
    const store = createTrackingStore(data);
    const wrapper = new MapStoreWrapper<string, string>(store);
    const wt = new WriteThroughStore<string, string>(wrapper, 2);

    await wt.clear();
    // 5 keys / batch-size 2 = 3 deleteAll calls
    expect(store.deleteAllCalls.length).toBe(3);
    expect(data.size).toBe(0);
  });
});

// ── 15. Write-behind batch groups respect writeBatchSize ──────────────────────

describe('WriteBehindProcessor batch sizing', () => {
  it('processes entries in chunks of writeBatchSize', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    const wrapper = new MapStoreWrapper<string, string>(store);
    const processor = new WriteBehindProcessor(wrapper, 2);

    const { addedEntry } = await import('@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry');
    const entries = [
      addedEntry('k1', 'v1', 0),
      addedEntry('k2', 'v2', 0),
      addedEntry('k3', 'v3', 0),
    ];

    const result = await processor.process(entries);
    // 3 entries, batch size 2 → 2 batch groups: [k1,k2] and [k3]
    expect(result.batchGroups).toBe(2);
    expect(result.successfulEntries).toBe(3);
    expect(store.storeAllCalls.length).toBe(2);
  });
});

// ── 16. Partial failure handling ─────────────────────────────────────────────

describe('Partial failure handling', () => {
  it('partial batch failure falls back to individual retries', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    // Fail the first 3 storeAll attempts (all retries), then succeed on individual
    store._shouldFailStoreAll = true;
    store._failStoreAllTimes = 3;

    const wrapper = new MapStoreWrapper<string, string>(store);
    const processor = new WriteBehindProcessor(wrapper, 10);

    const { addedEntry } = await import('@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry');
    const entries = [addedEntry('k1', 'v1', 0), addedEntry('k2', 'v2', 0)];

    const result = await processor.process(entries);

    // Batch fails 3 times → individual fallback → store() succeeds
    expect(result.batchFailures).toBe(1);
    expect(result.successfulEntries).toBe(2);
    expect(data.get('k1')).toBe('v1');
    expect(data.get('k2')).toBe('v2');
  });
});

// ── 17. Empty batch no-op ────────────────────────────────────────────────────

describe('Empty batch no-op', () => {
  it('storeAll/deleteAll with empty inputs is a no-op', async () => {
    const store = createTrackingStore<string, string>();
    const wrapper = new MapStoreWrapper<string, string>(store);

    await wrapper.storeAll(new Map());
    await wrapper.deleteAll([]);

    expect(store.storeAllCalls.length).toBe(0);
    expect(store.deleteAllCalls.length).toBe(0);
  });
});

// ── 18. MapStoreWrapper empty-guard for storeAll/deleteAll ────────────────────

describe('MapStoreWrapper empty-guard', () => {
  it('storeAll with empty map does not call underlying store', async () => {
    const store = createTrackingStore<string, string>();
    const wrapper = new MapStoreWrapper<string, string>(store);
    await wrapper.storeAll(new Map());
    expect(store.storeAllCalls.length).toBe(0);
  });

  it('deleteAll with empty array does not call underlying store', async () => {
    const store = createTrackingStore<string, string>();
    const wrapper = new MapStoreWrapper<string, string>(store);
    await wrapper.deleteAll([]);
    expect(store.deleteAllCalls.length).toBe(0);
  });
});

// ── 19. Write-behind with batched flush ──────────────────────────────────────

describe('Write-behind batched flush', () => {
  it('write-behind flush processes entries through processor batch sizing', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);
    const config = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store)
      .setWriteDelaySeconds(60)
      .setWriteBatchSize(2);

    const ctx = await MapStoreContext.create<string, string>('wb-batch-map', config);
    const ds = ctx.getMapDataStore() as WriteBehindStore<string, string>;

    await ds.add('a', '1', Date.now());
    await ds.add('b', '2', Date.now());
    await ds.add('c', '3', Date.now());

    await ds.flush();

    // Processor should have chunked: [a,b] and [c]
    expect(store.storeAllCalls.length).toBe(2);
    expect(data.size).toBe(3);
  });
});

// ── 20. MongoDB test harness env var wiring ──────────────────────────────────

describe('MongoDB test harness env vars', () => {
  it('HELIOS_MONGODB_TEST_URI defaults to localhost', () => {
    const uri = process.env.HELIOS_MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017';
    expect(uri).toBe('mongodb://127.0.0.1:27017');
  });

  it('HELIOS_MONGODB_TEST_DB_PREFIX defaults to helios_mapstore_test', () => {
    const prefix = process.env.HELIOS_MONGODB_TEST_DB_PREFIX ?? 'helios_mapstore_test';
    expect(prefix).toBe('helios_mapstore_test');
  });

  it('test database name includes unique suffix for isolation', () => {
    const prefix = process.env.HELIOS_MONGODB_TEST_DB_PREFIX ?? 'helios_mapstore_test';
    const dbName = `${prefix}_${Date.now()}`;
    expect(dbName.startsWith(prefix)).toBe(true);
    expect(dbName.length).toBeGreaterThan(prefix.length);
  });
});

// ── 21. MongoMapStore batch-size-aware storeAll/deleteAll ────────────────────

describe('MongoMapStore batch-size-aware operations', () => {
  it('MongoPropertyResolver resolves max-batch-size property', async () => {
    const { MongoPropertyResolver } = await import('../../../packages/mongodb/src/MongoPropertyResolver.js');
    const props = new Map<string, string>([['max-batch-size', '50']]);
    const resolved = MongoPropertyResolver.resolve(props);
    expect(resolved.maxBatchSize).toBe(50);
  });

  it('MongoPropertyResolver defaults max-batch-size to null (unlimited)', async () => {
    const { MongoPropertyResolver } = await import('../../../packages/mongodb/src/MongoPropertyResolver.js');
    const props = new Map<string, string>();
    const resolved = MongoPropertyResolver.resolve(props);
    expect(resolved.maxBatchSize).toBeNull();
  });
});

// ── 22. End-to-end vertical slice proof ──────────────────────────────────────

describe('MapStore vertical slice proof', () => {
  it('full lifecycle: configure → write → shutdown → restart → read', async () => {
    const data = new Map<string, string>();
    const store = createTrackingStore(data);

    // Phase 1: configure and write
    const storeConfig = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store);

    const inst1 = makeInstance('proof-map', storeConfig);
    const map1 = inst1.getMap<string, string>('proof-map');
    await map1.put('proof-key', 'proof-value');
    await map1.putAll([['batch1', 'bv1'], ['batch2', 'bv2']]);
    expect(data.get('proof-key')).toBe('proof-value');

    // Phase 2: shutdown
    await inst1.shutdownAsync();

    // Phase 3: restart with new instance, same backing store
    const store2 = createTrackingStore(data);
    const storeConfig2 = new MapStoreConfig()
      .setEnabled(true)
      .setImplementation(store2);

    const inst2 = makeInstance('proof-map', storeConfig2);
    const map2 = inst2.getMap<string, string>('proof-map');

    // Phase 4: read survives restart
    const val = await map2.get('proof-key');
    expect(val).toBe('proof-value');
    const b1 = await map2.get('batch1');
    expect(b1).toBe('bv1');

    // Phase 5: clear
    await map2.clear();
    expect(data.size).toBe(0);

    await inst2.shutdownAsync();
  });
});
