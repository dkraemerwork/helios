# MapStore SPI + Extension Packages (S3, MongoDB, Turso)

## Goal

Add MapStore/MapLoader runtime support to Helios core, then build three backend extension
packages. This enables IMap to persist data to external stores (write-through or
write-behind) and load-on-miss from external stores. Store resolution follows the Hazelcast
`StoreConstructor` priority chain: `MapStoreFactory` (factory-per-map) first, then direct
`implementation`. The `MapStoreFactory` pattern is the preferred integration path for
extension packages (S3, MongoDB, Turso) because it allows per-map scoping of prefixes,
collections, and table names.

**Repo:** `/Users/zenystx/IdeaProjects/helios/`  
**Java reference:** `/Users/zenystx/IdeaProjects/helios-1/` (read-only)  
**Baseline:** 2,271 core tests + 25 app tests all passing  
**Full plan lives in:** `plans/TYPESCRIPT_PORT_PLAN.md` (Phase 12)

---

## How loop.sh Uses This Plan

loop.sh reads `TYPESCRIPT_PORT_PLAN.md` and picks the first `- [ ] **Block 12.X**` entry.
For every Phase 12 block, the agent reads this file for the implementation spec.

Each block in this plan is self-contained: no block requires work from a later block.
Blocks A1 → A2 → A3 are strictly sequential. B, C, D are independent of each other
(all require only A3 to be complete first).

Required output at the end of each block iteration (emitted by the agent):
```
✅  Block 12.X — <N> tests green
GATE-CHECK: block=12.X required=<N> passed=<N> labels=<label1,label2>
```

---

## Phase Dependency Graph

```
Block 12.A1: Public interfaces + MapStoreConfig + core types   ← limited existing changes (MapConfig + root barrel)
   ↓
Block 12.A2: WriteThroughStore + WriteBehind subsystem + MapStoreContext  ← new mapstore subsystem files only
   ↓
Block 12.A3: IMap async migration + MapProxy wiring + integration tests   ← touches existing code
   ↓ (all three must complete before B/C/D)
Block 12.B: packages/s3/           ← independent
Block 12.C: packages/mongodb/      ← independent
Block 12.D: packages/turso/        ← independent
```

---

## Design Decisions (Final — not negotiable)

### IMap becomes async

**Decision:** `IMap` mutating methods return `Promise<...>`. `RecordStore` stays **sync**.  
MapProxy is made `async`. After the sync RecordStore operation, MapProxy `await`s the
MapDataStore call.

For **write-behind**: `mapDataStore.add()` enqueues synchronously (instant) → the `await`
resolves in the same microtask. No observable delay.  
For **write-through**: `mapDataStore.add()` calls `wrapper.store()` → real I/O → must await.

```typescript
// MapProxy
async put(key: K, value: V): Promise<V | null> {
  const oldData = this._store.put(kd, vd, -1, -1); // sync, fast
  if (this._mapDataStore.isWithStore()) {
    await this._mapDataStore.add(key, value, Date.now());
  }
  return oldData ? this._toObject<V>(oldData) : null;
}
```

**IMap interface changes** (all methods that read or write data):

| Method | Old return | New return |
|--------|-----------|------------|
| `put(key, value)` | `V \| null` | `Promise<V \| null>` |
| `get(key)` | `V \| null` | `Promise<V \| null>` |
| `set(key, value)` | `void` | `Promise<void>` |
| `remove(key)` | `V \| null` | `Promise<V \| null>` |
| `delete(key)` | `void` | `Promise<void>` |
| `putIfAbsent(key, value)` | `V \| null` | `Promise<V \| null>` |
| `putAll(entries)` | `void` | `Promise<void>` |
| `getAll(keys)` | `Map<K, V \| null>` | `Promise<Map<K, V \| null>>` |
| `replace(key, value)` | `V \| null` | `Promise<V \| null>` |
| `replaceIfSame(key, old, new)` | `boolean` | `Promise<boolean>` |
| `clear()` | `void` | `Promise<void>` |

Methods that stay sync (no store interaction):  
`getName()`, `size()`, `isEmpty()`, `containsKey()`, `containsValue()`,
`values()`, `keySet()`, `entrySet()`, `aggregate()`, `addEntryListener()`,
`removeEntryListener()`, `lock()`, `tryLock()`, `unlock()`, `isLocked()`.

Async variants stay as-is: `putAsync`, `getAsync`, `removeAsync`.

### MapDataStore operates on deserialized K, V

No Data-object layer. Store implementations receive plain JavaScript objects — not
serialized bytes. This keeps extension packages simple.

### MapStoreConfig lives in src/config/

`MapStoreConfig` is a config POJO added to `MapConfig`. `MapConfig.getMapStoreConfig()`
returns it. When `isEnabled() === false` (the default), no store wiring occurs.

### Store resolution follows Hazelcast precedence

To mirror Hazelcast `StoreConstructor`, store resolution for an enabled map follows:
1) `factoryImplementation` (if set) → `factory.newMapStore(mapName, properties)`
2) `implementation` (if set)

If neither is set while `enabled=true`, startup fails with a clear configuration error.

---

## A.0 — MapStoreConfig (prerequisite for all Phase A blocks)

**Create `src/config/MapStoreConfig.ts`:**

```typescript
export type InitialLoadMode = 'LAZY' | 'EAGER';

export class MapStoreConfig {
  private _enabled: boolean = false;
  private _factoryImplementation: MapStoreFactory<unknown, unknown> | null = null;
  private _implementation: object | null = null;  // MapStore | MapLoader
  private _writeDelaySeconds: number = 0;         // 0 = write-through, >0 = write-behind
  private _writeBatchSize: number = 1000;
  private _initialLoadMode: InitialLoadMode = 'LAZY';
  private _writeCoalescing: boolean = true;       // true = CoalescedWriteBehindQueue
  private _properties: Map<string, string> = new Map();

  isEnabled(): boolean { return this._enabled; }
  setEnabled(enabled: boolean): this { this._enabled = enabled; return this; }

  getFactoryImplementation(): MapStoreFactory<unknown, unknown> | null { return this._factoryImplementation; }
  setFactoryImplementation(factory: MapStoreFactory<unknown, unknown>): this {
    this._factoryImplementation = factory;
    this._implementation = null;   // mutual exclusivity: setting factory clears direct impl
    return this;
  }

  getImplementation(): object | null { return this._implementation; }
  setImplementation(impl: object): this {
    this._implementation = impl;
    this._factoryImplementation = null;  // mutual exclusivity: setting impl clears factory
    return this;
  }

  getWriteDelaySeconds(): number { return this._writeDelaySeconds; }
  setWriteDelaySeconds(seconds: number): this { this._writeDelaySeconds = seconds; return this; }

  getWriteBatchSize(): number { return this._writeBatchSize; }
  setWriteBatchSize(size: number): this { this._writeBatchSize = size; return this; }

  getInitialLoadMode(): InitialLoadMode { return this._initialLoadMode; }
  setInitialLoadMode(mode: InitialLoadMode): this { this._initialLoadMode = mode; return this; }

  isWriteCoalescing(): boolean { return this._writeCoalescing; }
  setWriteCoalescing(coalescing: boolean): this { this._writeCoalescing = coalescing; return this; }

  getProperties(): Map<string, string> { return this._properties; }
  setProperties(props: Map<string, string>): this { this._properties = props; return this; }
}
```

**Modify `src/config/MapConfig.ts`:**
- Add `private _mapStoreConfig: MapStoreConfig = new MapStoreConfig()` field
- Add `getMapStoreConfig(): MapStoreConfig` and `setMapStoreConfig(cfg: MapStoreConfig): this`

In Phase A, existing-file changes include `MapConfig` plus root barrel export updates and
the wiring changes explicitly listed in each block's file summary.

---

## Block 12.A1 — Public Interfaces + Core Types

**Existing code changes in this block are limited to MapConfig (A.0) and root barrel exports (`src/index.ts`).**

### A1.1 — Public Interfaces

**Create `src/map/MapLoader.ts`:**
```typescript
export interface MapLoader<K, V> {
  load(key: K): Promise<V | null>;
  loadAll(keys: K[]): Promise<Map<K, V>>;
  loadAllKeys(): Promise<K[]>;
}
```

**Create `src/map/MapStore.ts`:**
```typescript
import type { MapLoader } from './MapLoader.js';
export interface MapStore<K, V> extends MapLoader<K, V> {
  store(key: K, value: V): Promise<void>;
  storeAll(entries: Map<K, V>): Promise<void>;
  delete(key: K): Promise<void>;
  deleteAll(keys: K[]): Promise<void>;
}
```

**Create `src/map/MapLoaderLifecycleSupport.ts`:**
```typescript
export interface MapLoaderLifecycleSupport {
  init(properties: Map<string, string>, mapName: string): Promise<void>;
  destroy(): Promise<void>;
}
```

**Create `src/map/MapStoreFactory.ts`:**
```typescript
import type { MapLoader } from './MapLoader.js';
import type { MapStore } from './MapStore.js';

export interface MapStoreFactory<K, V> {
  newMapStore(mapName: string, properties: Map<string, string>): MapStore<K, V> | MapLoader<K, V> | Promise<MapStore<K, V> | MapLoader<K, V>>;
}
```

**Modify `src/index.ts` root barrel exports:**
- Export `MapLoader`, `MapStore`, `MapLoaderLifecycleSupport`, and `MapStoreFactory` from `@helios/core`.

### A1.2 — Internal MapDataStore

**Create `src/map/impl/mapstore/MapDataStore.ts`:**
```typescript
export interface MapDataStore<K, V> {
  /** Called after RecordStore write — async for write-through, instant-queue for write-behind. */
  add(key: K, value: V, now: number): Promise<void>;
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
```

**Create `src/map/impl/mapstore/EmptyMapDataStore.ts`:**

Singleton no-op. `isWithStore()` → false. `hasPendingWrites()` → false. All async
methods resolve immediately without doing anything. Implement as a singleton class:
```typescript
private static readonly _instance = new EmptyMapDataStore();
static empty<K, V>(): MapDataStore<K, V> { return EmptyMapDataStore._instance as any; }
```

### A1.3 — MapStoreWrapper

**Create `src/map/impl/mapstore/MapStoreWrapper.ts`:**

Wraps the user's `MapStore | MapLoader` implementation. Detects which interface via
`typeof (impl as any).store === 'function'`. If true → it is a `MapStore` (has write
methods). If false → it is a `MapLoader` only (read-only).

Delegates:
- `store(k, v)` → `impl.store(k, v)` (only if isMapStore)
- `storeAll(entries)` → `impl.storeAll(entries)` (only if isMapStore)
- `delete(k)` → `impl.delete(k)` (only if isMapStore)
- `deleteAll(keys)` → `impl.deleteAll(keys)` (only if isMapStore)
- `load(k)` → `impl.load(k)`
- `loadAll(keys)` → `impl.loadAll(keys)`
- `loadAllKeys()` → `impl.loadAllKeys()`

Handles `MapLoaderLifecycleSupport`: if `typeof (impl as any).init === 'function'`,
treat as lifecycle-supported. Expose `init()` and `destroy()` on the wrapper that
delegate only when supported (otherwise no-op).

Fields:
- `readonly isMapStore: boolean` (type-guard result set at construction)
- `readonly supportsLifecycle: boolean` (`init` + `destroy` both present)

### A1.4 — DelayedEntry

**Create `src/map/impl/mapstore/writebehind/DelayedEntry.ts`:**

```typescript
export const enum DelayedEntryType { ADD = 'ADD', DELETE = 'DELETE' }

export interface DelayedEntry<K, V> {
  readonly type: DelayedEntryType;
  readonly key: K;
  readonly value: V | null;    // null for DELETE
  readonly storeTime: number;  // Date.now() + writeDelayMs — deadline for flush
  readonly sequence: number;   // monotonic counter for ordering
}

let _seq = 0;

export function addedEntry<K, V>(key: K, value: V, storeTime: number): DelayedEntry<K, V> {
  return { type: DelayedEntryType.ADD, key, value, storeTime, sequence: ++_seq };
}

export function deletedEntry<K, V>(key: K, storeTime: number): DelayedEntry<K, V> {
  return { type: DelayedEntryType.DELETE, key, value: null, storeTime, sequence: ++_seq };
}
```

### A1.5 — LoadOnlyMapDataStore

**Create `src/map/impl/mapstore/LoadOnlyMapDataStore.ts`:**

Used when user provides only a `MapLoader` (no write methods). `add()` and `remove()`
are no-ops that resolve immediately (reads go to the store; writes only go to in-memory
RecordStore). `clear()` is also a no-op (no external delete capability in loader-only mode).
`isWithStore()` → true (it IS wired; load-on-miss works). `hasPendingWrites()` → false.

### A1.6 — Files Summary (Block 12.A1)

**New files (10):**

| File | Purpose |
|------|---------|
| `src/map/MapLoader.ts` | Public interface |
| `src/map/MapStore.ts` | Public interface |
| `src/map/MapLoaderLifecycleSupport.ts` | Lifecycle interface |
| `src/map/MapStoreFactory.ts` | Store factory interface |
| `src/config/MapStoreConfig.ts` | Config POJO |
| `src/map/impl/mapstore/MapDataStore.ts` | Internal abstraction |
| `src/map/impl/mapstore/EmptyMapDataStore.ts` | No-op singleton |
| `src/map/impl/mapstore/MapStoreWrapper.ts` | User-impl adapter |
| `src/map/impl/mapstore/LoadOnlyMapDataStore.ts` | Read-only adapter |
| `src/map/impl/mapstore/writebehind/DelayedEntry.ts` | Entry types + factories |

**Modified files (2):**

| File | Change |
|------|--------|
| `src/config/MapConfig.ts` | Add `_mapStoreConfig` field + getter/setter |
| `src/index.ts` | Export new map store interfaces from root package |

### A1.7 — Test Plan (~22 tests)

| File | # | Covers |
|------|---|--------|
| `test/map/mapstore/MapStoreWrapper.test.ts` | 8 | isMapStore detection, supportsLifecycle detection, delegation to store/load methods, lifecycle init/destroy, no-op when not lifecycle-supported |
| `test/map/mapstore/EmptyMapDataStore.test.ts` | 4 | Singleton identity, isWithStore=false, all ops no-op |
| `test/map/mapstore/LoadOnlyMapDataStore.test.ts` | 4 | isWithStore=true, add/remove are no-ops, load delegates |
| `test/map/mapstore/DelayedEntry.test.ts` | 3 | Factory functions, sequence monotonicity, type field |
| `test/config/MapStoreConfig.test.ts` | 3 | setFactoryImplementation clears impl; setImplementation clears factory; MapConfig.getMapStoreConfig() returns wired config |

Additionally, include one compile-time import smoke test to verify root-barrel exports for
`MapLoader`, `MapStore`, `MapLoaderLifecycleSupport`, and `MapStoreFactory`.

**MapStoreConfig mutual-exclusivity tests (inside `test/config/MapStoreConfig.test.ts`):**
```
1. setFactoryImplementation(f) then getImplementation() → null
2. setImplementation(impl) then getFactoryImplementation() → null
3. setFactoryImplementation(f) then setImplementation(impl) → only implementation survives (factory null)
```

### A1.8 — Verification

```bash
bun test --pattern "mapstore/(MapStoreWrapper|EmptyMapDataStore|LoadOnly|DelayedEntry)"
bun run tsc --noEmit
```

All 2,271 existing tests must remain green (no runtime behavior changes in this block).

**GATE-CHECK labels:** `mapstore-interfaces`, `mapstore-types`

---

## Block 12.A2 — WriteThroughStore + WriteBehind Subsystem + MapStoreContext

**No existing code changes. Builds on A1 types.**

### A2.1 — WriteThroughStore

**Create `src/map/impl/mapstore/writethrough/WriteThroughStore.ts`:**

Implements `MapDataStore`. Every `add()` → `await wrapper.store(key, value)`. Every
`remove()` → `await wrapper.delete(key)`. `flush()` is a no-op. `hasPendingWrites()` → false.
`load()` and `loadAll()` delegate to wrapper. `clear()` calls `loadAllKeys()` + `deleteAll()`
to clear external state for map.clear() semantics.
`isWithStore()` → true.

### A2.2 — WriteBehindQueue

**Create `src/map/impl/mapstore/writebehind/WriteBehindQueue.ts`:**
```typescript
export interface WriteBehindQueue<K, V> {
  offer(entry: DelayedEntry<K, V>): void;
  /** Returns entries where storeTime <= now, removing them from the queue. */
  drainTo(now: number): DelayedEntry<K, V>[];
  /** Returns and removes ALL entries (for flush/shutdown). */
  drainAll(): DelayedEntry<K, V>[];
  size(): number;
  isEmpty(): boolean;
  clear(): void;
}
```

**Create `src/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue.ts`:**

Backed by `Map<string, DelayedEntry>` (key = `JSON.stringify(entry.key)`).
When a new entry arrives for an existing key: replace the value/type, but KEEP the
original `storeTime` (deadline is not pushed out by new writes). `drainTo(now)` iterates
the map and returns entries where `storeTime <= now`, deleting them from the map.

**Create `src/map/impl/mapstore/writebehind/ArrayWriteBehindQueue.ts`:**

Backed by a `DelayedEntry[]` array (FIFO). No coalescing — every mutation is a separate
entry. `drainTo(now)` removes from the front while `entry.storeTime <= now` (entries are
inserted in increasing storeTime order since writeDelay is constant).

### A2.3 — WriteBehindProcessor

**Create `src/map/impl/mapstore/writebehind/WriteBehindProcessor.ts`:**

Takes drained entries, groups into batches of at most `writeBatchSize`:
- Groups consecutive `ADD` entries into `storeAll(Map<K,V>)` calls.
- Groups consecutive `DELETE` entries into `deleteAll(K[])` calls.
- Alternating types break into separate batch calls.

Retry/fallback contract (deterministic):
- For each batch group: 1 initial attempt + up to 3 retries with 1-second delay.
- If all attempts fail, switch to per-entry fallback for that failed batch group only.
- Per-entry fallback is **continue-on-error**: attempt every entry in original order,
  even when some entries fail.
- After fallback on one failed batch group, continue processing later batch groups.
- Log each fallback entry failure with operation type and key.
- Do not throw from `process()` on backend store/delete failures.

Expose processing stats to make behavior observable:
```typescript
interface WriteBehindProcessResult {
  totalEntries: number;
  successfulEntries: number;
  failedEntries: number;
  batchGroups: number;
  batchFailures: number;
  retryCount: number;
  fallbackBatchCount: number;
}
```

Constructor: `new WriteBehindProcessor(wrapper: MapStoreWrapper, writeBatchSize: number)`.

### A2.4 — StoreWorker

**Create `src/map/impl/mapstore/writebehind/StoreWorker.ts`:**

Background timer using `setInterval(1000)`.  
Each tick: `queue.drainTo(Date.now())` → `processor.process(entries)`.  
Guard: if previous flush is still running (via a `boolean _running` flag), skip tick.  
`start()` method: calls `setInterval`, stores the handle.  
`stop()` method: calls `clearInterval`.  
`flush()` method (for shutdown): `clearInterval`, then `processor.process(queue.drainAll())`
synchronously (as a final await before the instance shuts down).

Constructor: `new StoreWorker(queue: WriteBehindQueue, processor: WriteBehindProcessor)`.

### A2.5 — WriteBehindStore

**Create `src/map/impl/mapstore/writebehind/WriteBehindStore.ts`:**

Implements `MapDataStore`.

Fields:
- `_queue: WriteBehindQueue`
- `_processor: WriteBehindProcessor`
- `_worker: StoreWorker`
- `_wrapper: MapStoreWrapper`
- `_writeDelayMs: number`

`add(key, value, now)` → creates `addedEntry(key, value, now + _writeDelayMs)`, calls
`_queue.offer(entry)`. Returns `Promise.resolve()` (instant).

`remove(key, now)` → creates `deletedEntry(key, now + _writeDelayMs)`, calls
`_queue.offer(entry)`. Returns `Promise.resolve()` (instant).

`load(key)` → delegates to `_wrapper.load(key)` (bypass queue).

`loadAll(keys)` → delegates to `_wrapper.loadAll(keys)`.

`flush()` → `await _worker.flush()`.

`clear()` semantics for `map.clear()` on MapStore-backed maps:
1. Stop periodic worker execution.
2. `await _worker.flush()` (never silently drop pending write-behind entries).
3. `const keys = await _wrapper.loadAllKeys()`.
4. If keys exist, call `await _wrapper.deleteAll(keys)` to clear persisted external state.
5. `_queue.clear()` for local queue cleanup.
6. Restart worker.

`isWithStore()` → true.

`hasPendingWrites()` → `!_queue.isEmpty()`.

Worker startup contract:
- Constructor starts the worker.
- No external caller should invoke `startWorker()`.
- `destroy()` stops the worker.

### A2.6 — MapStoreContext

**Create `src/map/impl/mapstore/MapStoreContext.ts`:**

Factory + lifecycle for a single map's store integration.

```typescript
export class MapStoreContext<K, V> {
  private readonly _wrapper: MapStoreWrapper;
  private readonly _mapDataStore: MapDataStore<K, V>;

  private constructor(wrapper: MapStoreWrapper, store: MapDataStore<K, V>) { ... }

  static async create<K, V>(
    mapName: string,
    config: MapStoreConfig,
    // nodeEngine is available if needed for logging; pass undefined if not
  ): Promise<MapStoreContext<K, V>> {
    const impl = config.getFactoryImplementation()
      ? await config.getFactoryImplementation()!.newMapStore(mapName, config.getProperties())
      : config.getImplementation();
    if (!impl) throw new Error(`MapStoreConfig for '${mapName}' has no implementation/factory set`);

    const wrapper = new MapStoreWrapper(impl);

    // Init lifecycle if supported
    if (wrapper.supportsLifecycle) {
      await wrapper.init(config.getProperties(), mapName);
    }

    let store: MapDataStore<K, V>;
    if (!wrapper.isMapStore) {
      // MapLoader only — reads work, writes are in-memory only
      store = new LoadOnlyMapDataStore(wrapper);
    } else if (config.getWriteDelaySeconds() > 0) {
      // Write-behind
      const queue = config.isWriteCoalescing()
        ? new CoalescedWriteBehindQueue<K, V>()
        : new ArrayWriteBehindQueue<K, V>();
      const processor = new WriteBehindProcessor(wrapper, config.getWriteBatchSize());
      const wbStore = new WriteBehindStore(wrapper, queue, processor, config.getWriteDelaySeconds() * 1000);
      store = wbStore;
    } else {
      // Write-through
      store = new WriteThroughStore(wrapper);
    }

    return new MapStoreContext(wrapper, store);
  }

  getMapDataStore(): MapDataStore<K, V> { return this._mapDataStore; }

  async destroy(): Promise<void> {
    await this._mapDataStore.flush();
    if (this._mapDataStore instanceof WriteBehindStore) {
      this._mapDataStore.destroy();
    }
    if (this._wrapper.supportsLifecycle) {
      await this._wrapper.destroy();
    }
  }
}
```

### A2.7 — Initial Load (Eager)

`MapStoreContext.create()` — after creating the store, if `config.getInitialLoadMode() === 'EAGER'`
and `wrapper.isMapStore` (or just MapLoader):

```typescript
if (config.getInitialLoadMode() === 'EAGER') {
  const keys = await wrapper.loadAllKeys();
  if (keys.length > 0) {
    const entries = await wrapper.loadAll(keys);
    // caller must inject these into RecordStore — returned as initialEntries
  }
}
```

Expose `getInitialEntries(): Map<K, V> | null` on `MapStoreContext` (null when LAZY).
MapContainerService (Block A3) uses this to pre-populate the RecordStore.

### A2.8 — Files Summary (Block 12.A2)

**New files (8):**

| File | Purpose |
|------|---------|
| `src/map/impl/mapstore/writethrough/WriteThroughStore.ts` | Immediate persistence |
| `src/map/impl/mapstore/writebehind/WriteBehindQueue.ts` | Queue interface |
| `src/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue.ts` | Coalescing queue |
| `src/map/impl/mapstore/writebehind/ArrayWriteBehindQueue.ts` | FIFO queue |
| `src/map/impl/mapstore/writebehind/WriteBehindProcessor.ts` | Batch + retry |
| `src/map/impl/mapstore/writebehind/StoreWorker.ts` | Background timer |
| `src/map/impl/mapstore/writebehind/WriteBehindStore.ts` | Write-behind MapDataStore |
| `src/map/impl/mapstore/MapStoreContext.ts` | Factory + lifecycle |

**Modified files (0).**

### A2.9 — Test Plan (~37 tests)

| File | # | Covers |
|------|---|--------|
| `test/map/mapstore/WriteThroughStore.test.ts` | 5 | Immediate store/delete, load delegation, flush no-op |
| `test/map/mapstore/CoalescedWriteBehindQueue.test.ts` | 6 | offer, drainTo, coalescing keeps original storeTime, drainAll |
| `test/map/mapstore/ArrayWriteBehindQueue.test.ts` | 5 | FIFO order, drainTo by deadline, drainAll |
| `test/map/mapstore/WriteBehindProcessor.test.ts` | 11 | Batching, storeAll/deleteAll grouping, retry policy, continue-on-error fallback, continue after failed batch, result counters |
| `test/map/mapstore/StoreWorker.test.ts` | 5 | start/stop, periodic drain via fake timer, flush drains all |
| `test/map/mapstore/WriteBehindStore.test.ts` | 7 | Queue-on-add, queue-on-remove, load bypasses queue, flush delegates, clear flushes+deleteAll, constructor-owned worker start |
| `test/map/mapstore/MapStoreContext.test.ts` | 3 | WT vs WB selection, lifecycle init/destroy, factoryImplementation precedence |

**Test strategy for StoreWorker:** use `bun:test`'s `mock()` to mock `setInterval`/`clearInterval`
and advance time manually, or inject a clock function. Do NOT use real timers in unit tests.

### A2.10 — Verification

```bash
bun test --pattern "mapstore/(WriteThroughStore|WriteBehindQueue|CoalescedWriteBehind|ArrayWriteBehind|WriteBehindProcessor|StoreWorker|WriteBehindStore|MapStoreContext)"
bun run tsc --noEmit
```

All 2,271 existing tests must remain green (no existing code changed).

**GATE-CHECK labels:** `mapstore-writethrough`, `mapstore-writebehind`

**STATUS: ✅ Complete — 46 tests green (2026-03-02)**

---

## Block 12.A3 — IMap Async Migration + MapProxy Wiring + Integration Tests

**This block touches existing code. Run the async-IMap codemod first.**

### A3.1 — IMap Interface Update

**Modify `src/map/IMap.ts`:**  
Change the 11 methods listed in the Design Decisions section above from sync to
`Promise<...>` return types. No other changes. All sync methods (size, containsKey, etc.)
stay sync.

### A3.2 — Type-Aware Async IMap Codemod

**Create `scripts/async-imap-codemod.ts`:**

Use AST + TypeScript type-checker resolution (not sed) to rewrite only true IMap callsites.

Methods to migrate:
- `put`, `get`, `set`, `remove`, `delete`, `putIfAbsent`, `putAll`, `getAll`, `replace`, `replaceIfSame`, `clear`

Target files:
- `src/**/*.ts`
- `app/src/**/*.ts`
- `test/**/*.ts`
- `app/test/**/*.ts`
- `packages/**/*.ts`
- `examples/**/*.ts`

Required behavior:
- Add `await` for selected IMap call expressions (including chained forms like `node.getMap(...).get(...)`).
- Transform nested expressions (e.g., `expect(map.get(k))` → `expect(await map.get(k))`).
- If a call is inside a non-async callback/function, upgrade that callback/function to `async` when safe.
- Skip non-IMap receivers (e.g., `Map`, `Int2ObjectHashMap`, other `get/put` APIs).
- Avoid double-await.

Modes:
- `--check` (no writes, CI gate)
- `--write` (apply changes)

Output:
- summary of files changed + callsites rewritten
- unresolved/blocked callsites with `file:line` and reason
- non-zero exit when unresolved callsites remain

CI gate requirement:
- `--check` must run in CI across the full target-file set above.
- Any unresolved IMap callsite is a hard failure (no allowlist/silent skip path).

Run order: codemod first, then typecheck/tests.

### A3.3 — MapProxy Update

**Modify `src/map/impl/MapProxy.ts`:**

1. Add field: `private _mapDataStore: MapDataStore<K, V> = EmptyMapDataStore.empty()`
2. Add method: `setMapDataStore(store: MapDataStore<K, V>): void`
3. Make these methods `async`:

**`get(key)`:**
```typescript
async get(key: K): Promise<V | null> {
  const kd = this._toData(key);
  const data = this._store.get(kd);
  if (data !== null) {
    return this._toObject<V>(data);
  }
  // load-on-miss
  if (this._mapDataStore.isWithStore()) {
    const loaded = await this._mapDataStore.load(key);
    if (loaded !== null) {
      // back-fill cache — use store.put with no TTL
      this._store.put(kd, this._toData(loaded), -1, -1);
      return loaded;
    }
  }
  return null;
}
```

**`put(key, value)`:**
```typescript
async put(key: K, value: V): Promise<V | null> {
  const kd = this._toData(key);
  const vd = this._toData(value);
  const oldData = this._store.put(kd, vd, -1, -1);
  if (this._mapDataStore.isWithStore()) {
    await this._mapDataStore.add(key, value, Date.now());
  }
  return oldData ? this._toObject<V>(oldData) : null;
}
```

**`set(key, value)`:**  
Same as `put()` but returns `void` (discards old value).

**`remove(key)`:**
```typescript
async remove(key: K): Promise<V | null> {
  const kd = this._toData(key);
  const oldData = this._store.remove(kd);
  if (this._mapDataStore.isWithStore()) {
    await this._mapDataStore.remove(key, Date.now());
  }
  return oldData ? this._toObject<V>(oldData) : null;
}
```

**`delete(key)`:**  
Same as `remove()` but returns `void`.

**`putAll(entries)`:**
```typescript
async putAll(entries: Map<K, V>): Promise<void> {
  for (const [k, v] of entries) {
    this._store.put(this._toData(k), this._toData(v), -1, -1);
  }
  if (this._mapDataStore.isWithStore()) {
    for (const [k, v] of entries) {
      await this._mapDataStore.add(k, v, Date.now());
    }
  }
}
```

**`getAll(keys)`:**
```typescript
async getAll(keys: K[]): Promise<Map<K, V | null>> {
  const result = new Map<K, V | null>();
  const missing: K[] = [];
  for (const k of keys) {
    const kd = this._toData(k);
    const data = this._store.get(kd);
    if (data !== null) {
      result.set(k, this._toObject<V>(data));
    } else {
      missing.push(k);
    }
  }
  if (missing.length > 0 && this._mapDataStore.isWithStore()) {
    const loaded = await this._mapDataStore.loadAll(missing);
    for (const [k, v] of loaded) {
      result.set(k, v);
      this._store.put(this._toData(k), this._toData(v), -1, -1);
    }
    for (const k of missing) {
      if (!result.has(k)) result.set(k, null);
    }
  } else {
    for (const k of missing) result.set(k, null);
  }
  return result;
}
```

**`clear()`:**
```typescript
async clear(): Promise<void> {
  this._store.clear();
  if (this._mapDataStore.isWithStore()) {
    await this._mapDataStore.clear();
  }
}
```

Clear semantics:
- MapStore-backed maps: clear in-memory and external persisted state.
- Loader-only maps: clear in-memory only (future load-on-miss may repopulate from loader).

**`putIfAbsent(key, value)`:** sync RecordStore check, if absent: `store.put()` then `await mapDataStore.add()`. Return old value or null.

**`replace(key, value)`:** sync RecordStore check (key must exist). If exists: `store.put()` then `await mapDataStore.add()`. Return old value.

**`replaceIfSame(key, oldValue, newValue)`:** sync RecordStore check + comparison. If match: `store.put()` then `await mapDataStore.add()`. Return boolean.

Async migration invariant:
- Preserve existing listener side effects exactly when methods become async. Calls to
  `_fireAdded`, `_fireUpdated`, `_fireRemoved`, and `_fireCleared` must still fire under
  the same conditions and ordering as before.

### A3.4 — NetworkedMapProxy Update

**Modify `src/map/impl/NetworkedMapProxy.ts`** (if it exists):  
Update method signatures to match the new async `IMap` interface. All methods that
previously returned sync values now return `Promise`. Implementation can be a simple
`return Promise.resolve(super.method(...))` wrapper if the parent is now async.

Behavioral invariants (required):
- Preserve current broadcast/invalidation behavior after async conversion (no lost or
  duplicated publish paths).
- Preserve remote-apply loop prevention semantics: any `_fromRemote` guard logic must
  remain effective under `async/await` so remotely applied mutations do not re-broadcast.

### A3.5 — NearCachedIMapWrapper Update

**Modify `src/map/impl/nearcache/NearCachedIMapWrapper.ts`:**  
All 11 async IMap methods must be updated to their `Promise<...>` signatures. The
near-cache wrapper intercepts `get()` (cache hit → return without calling super) and
invalidates on `put()`/`set()`/`remove()`/`delete()`/`putAll()`/`putIfAbsent()`/
`replace()`/`replaceIfSame()`/`clear()`. All
delegations to the wrapped map use `await`.

### A3.6 — MapContainerService Wiring

**Modify `src/map/impl/MapContainerService.ts`:**

```typescript
private readonly _mapStoreContexts = new Map<string, MapStoreContext<unknown, unknown>>();
private readonly _mapStoreContextInitPromises = new Map<string, Promise<MapStoreContext<unknown, unknown>>>();

async getOrCreateMapDataStore(
  mapName: string,
  mapStoreConfig: MapStoreConfig,
): Promise<MapDataStore<unknown, unknown>> {
  if (!mapStoreConfig.isEnabled()) return EmptyMapDataStore.empty();

  let ctx = this._mapStoreContexts.get(mapName);
  if (ctx) return ctx.getMapDataStore();

  let inFlight = this._mapStoreContextInitPromises.get(mapName);
  if (!inFlight) {
    inFlight = (async () => {
      const created = await MapStoreContext.create(mapName, mapStoreConfig);
      this._mapStoreContexts.set(mapName, created);

      // EAGER load: pre-populate RecordStore via NodeEngine serialization
      const initial = created.getInitialEntries();
      if (initial) {
        const recordStore = this.getOrCreateRecordStore(mapName, 0);
        for (const [k, v] of initial) {
          const kd = this._nodeEngine.toData(k);
          const vd = this._nodeEngine.toData(v);
          if (kd !== null && vd !== null) {
            recordStore.put(kd, vd, -1, -1);
          }
        }
      }

      return created;
    })();
    this._mapStoreContextInitPromises.set(mapName, inFlight);
  }

  try {
    ctx = await inFlight;
  } finally {
    this._mapStoreContextInitPromises.delete(mapName);
  }

  return ctx.getMapDataStore();
}

async destroyMapStoreContext(mapName: string): Promise<void> {
  const ctx = this._mapStoreContexts.get(mapName);
  if (ctx) {
    await ctx.destroy();
    this._mapStoreContexts.delete(mapName);
  }
}
```

`MapContainerService` gains a `NodeEngine` constructor dependency to serialize EAGER
entries before calling `RecordStore.put(Data, Data, ...)`.

Constructor migration requirement (no ambiguity):
- Update all existing `new MapContainerService(...)` callsites in this block, including
  `HeliosInstanceImpl`, `TestHeliosInstance`, and direct test constructions, so the new
  constructor shape compiles everywhere.

`getOrCreateRecordStore()` stays **sync** (no change).

### A3.7 — MapProxy wiring in HeliosInstanceImpl / MapService

`HeliosInstanceImpl.getMap()` remains sync. Proxy wiring is lazy and singleflight.

`HeliosInstanceImpl` changes:
- when constructing a `MapProxy`, pass the map's `MapStoreConfig` into the proxy.

`MapProxy` changes:
- add `private _mapStoreInitPromise: Promise<void> | null = null`
- add `private async ensureMapDataStoreInitialized(): Promise<void>`
- first store-touching call (`get/put/remove/set/delete/putAll/getAll/clear/replace...`) calls `ensureMapDataStoreInitialized()`.

Singleflight contract:
1. if mapStore disabled: return immediately.
2. if datastore already wired: return immediately.
3. if `_mapStoreInitPromise` exists: await it.
4. otherwise create `_mapStoreInitPromise = getOrCreateMapDataStore(...)`, await it,
   set datastore once, and clear promise in `finally` (allow retry after failed init).

This prevents duplicate context creation/lifecycle init when concurrent first calls hit
the same map.

### A3.8 — Files Summary (Block 12.A3)

**New files (2):**

| File | Purpose |
|------|---------|
| `scripts/async-imap-codemod.ts` | AST/type-aware IMap async migration |
| `test/map/mapstore/MapStoreIntegration.test.ts` | E2E with IMap + mock MapStore |

**Modified files (7+bulk):**

| File | Change |
|------|--------|
| `src/map/IMap.ts` | 11 methods become `Promise<...>` |
| `src/map/impl/MapProxy.ts` | Async methods + MapDataStore field + lazy wiring |
| `src/map/impl/MapContainerService.ts` | `getOrCreateMapDataStore()` + `destroyMapStoreContext()` |
| `src/instance/impl/HeliosInstanceImpl.ts` | Pass `MapStoreConfig` into proxies for lazy wiring |
| `src/map/impl/NetworkedMapProxy.ts` | Signature update to match async IMap |
| `src/map/impl/nearcache/NearCachedIMapWrapper.ts` | Signature update + async delegation |
| `src/**/*.ts` (bulk) | runtime IMap callsites migrated by codemod |
| `app/src/**/*.ts` (bulk) | app runtime IMap callsites migrated by codemod |
| `test/**/*.ts` (bulk) | test IMap callsites migrated by codemod |
| `app/test/**/*.ts` (bulk) | app test IMap callsites migrated by codemod |
| `packages/**/*.ts` (bulk) | package IMap callsites migrated by codemod |
| `examples/**/*.ts` (bulk) | example IMap callsites migrated by codemod |

### A3.9 — Integration Test Plan (~8 E2E tests + migration validates existing ~2,271)

**`test/map/mapstore/MapStoreIntegration.test.ts`:**

```
1. write-through: put(k,v) → store() called synchronously-ish, get(miss) → load() called
2. write-behind: put(k,v) → store NOT called immediately, after flush() → store() called
3. load-on-miss: get(absent key) → load() called → value back-filled in RecordStore → second get() hits RecordStore (no second load() call)
4. EAGER load: create context with EAGER mode → loadAllKeys() + loadAll() called → RecordStore pre-populated via Data serialization
5. clear on MapStore-backed map: clear removes in-memory and external persisted entries (no resurrection on next get)
6. clear on loader-only map: clear empties in-memory only; later get may load from loader again (documented behavior)
7. lazy wiring race: two concurrent first map calls trigger one context init/lifecycle init only
8. destroy: flush called on destroy, pending write-behind entries flushed before impl.destroy()
```

Additional: `test/map/mapstore/InitialLoad.test.ts` (~4 tests for EAGER vs LAZY behaviour).

### A3.10 — Verification

```bash
# Step 1: dry-run codemod safety check (no writes)
bun run scripts/async-imap-codemod.ts --check

# CI gate: unresolved callsites must fail here (non-zero)

# Step 2: apply codemod
bun run scripts/async-imap-codemod.ts --write

# Step 2b: post-write gate to ensure zero unresolved callsites remain
bun run scripts/async-imap-codemod.ts --check

# Step 3: typecheck
bun run tsc --noEmit

# Step 4: focused integration checks
bun test --pattern "app/"
bun test --pattern "mapstore/(MapStoreIntegration|InitialLoad|MapStoreContext|WriteBehindStore)"

# Step 5: full suite
bun test
```

### A3.11 — Extension Store Wiring Into HeliosInstance (required)

Hazelcast reference alignment:
- `MapContainerImpl` creates store context per map and starts it during container init.
- `StoreConstructor` resolves store by precedence: factory first, then implementation.

Helios requirement:
- During map-store context creation, resolve store source with the same precedence:
  1) `MapStoreConfig.factoryImplementation`
  2) `MapStoreConfig.implementation`
- Keep `getMap()` sync; lazy wire once per map via singleflight path (A3.7).

Required usage pattern for choosing an extension package:
```typescript
const usersMap = new MapConfig('users');
usersMap.getMapStoreConfig()
  .setEnabled(true)
  // choose one extension implementation:
  .setImplementation(new TursoMapStore({ url: ':memory:' }));

// or factory-based construction (Hazelcast-style)
usersMap.getMapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation({
    newMapStore: (mapName, props) => new TursoMapStore({
      url: props.get('url') ?? ':memory:',
      tableName: mapName,
    }),
  });
```

Add one integration test in A3 that boots `HeliosInstance`, configures map-store via
`setImplementation(...)` using a mock extension-like store object, and verifies `put/get`
flow through the configured store path.

**Total expected after A3:** ~2,271 existing + ~64 new mapstore tests = **~2,335 tests green**.

**GATE-CHECK labels:** `mapstore-async-imap`, `mapstore-integration`

**STATUS: ✅ Complete — 18 new tests green (2559 total, 2026-03-02)**

---

## Block 12.B — packages/s3/ (S3MapStore)

### B.1 — Package Setup

**Create `packages/s3/package.json`:**
```json
{
  "name": "@helios/s3",
  "version": "1.0.0",
  "description": "S3-backed MapStore for Helios",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@aws-sdk/client-s3": "^3.700.0" },
  "peerDependencies": { "@helios/core": "workspace:*" },
  "devDependencies": { "@helios/core": "workspace:*" },
  "scripts": {
    "test": "bun test",
    "typecheck": "bun run tsc --noEmit"
  }
}
```

**Create `packages/s3/tsconfig.json`:**  
Extends root `../../tsconfig.json`. Add paths:
- `@helios/core` → `../../src/index.ts`
- `@helios/core/*` → `../../src/*`

**Create `packages/s3/bunfig.toml`:**  
Standard test config (no reflect-metadata needed).

**Update root `package.json`** workspaces array to add `"packages/s3"`.

### B.2 — Files

| File | Purpose |
|------|---------|
| `packages/s3/src/index.ts` | Public barrel export (`S3MapStore`, `S3Config`) |
| `packages/s3/src/S3Config.ts` | Config: bucket, prefix, region, endpoint, credentials, serializer |
| `packages/s3/src/S3MapStore.ts` | `MapStore<string, T>` + `MapLoaderLifecycleSupport` |

### B.3 — S3Config

```typescript
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

export interface S3Config<T = unknown> {
  bucket: string;
  prefix?: string;          // default: ''
  suffix?: string;          // default: '.json' — appended to key for S3 object key
  region?: string;
  endpoint?: string;        // for LocalStack / MinIO
  credentials?: { accessKeyId: string; secretAccessKey: string };
  serializer?: Serializer<T>;  // default: JSON.stringify / JSON.parse
}
```

### B.4 — S3MapStore Behavior

`S3MapStore<T>` implements `MapStore<string, T>` and `MapLoaderLifecycleSupport`.

**S3 object key:** `${prefix}${key}${suffix}` (e.g., `users/alice.json`)

- `init(properties, mapName)` → creates `S3Client` from `this._config` (or env vars as fallback).  
  `mapName` is available for logging purposes only.
- `destroy()` → calls `client.destroy()`.
- `store(key, value)` → `PutObjectCommand({ Bucket, Key, Body: serializer.serialize(value) })`
- `load(key)` → `GetObjectCommand`. Catch `NoSuchKey` (or `NotFound`) error → return null.
  Parse response body stream: `await response.Body?.transformToString()` then `serializer.deserialize()`.
- `delete(key)` → `DeleteObjectCommand`.
- `storeAll(entries)` → `Promise.all(...)` with individual `PutObjectCommand` calls (S3 has no batch put).
- `deleteAll(keys)` → `DeleteObjectsCommand` (batch, max 1000 per call — chunk if needed).
- `loadAll(keys)` → `Promise.all(...)` with individual `GetObjectCommand` calls; omit nulls from result map.
- `loadAllKeys()` → paginated `ListObjectsV2Command`; strip prefix + suffix from each key.

### B.4b — Static Factory Method

`S3MapStore` must expose a static `.factory<T>(baseConfig: S3Config<T>): MapStoreFactory<string, T>`
method that enables per-map prefix scoping:

```typescript
static factory<T>(baseConfig: S3Config<T>): MapStoreFactory<string, T> {
  return {
    newMapStore(mapName: string): S3MapStore<T> {
      // Derive prefix from mapName: e.g. 'users' → prefix 'users/'
      // Merge with baseConfig, overriding prefix only if not already set by caller
      const derivedPrefix = baseConfig.prefix ?? `${mapName}/`;
      return new S3MapStore<T>({ ...baseConfig, prefix: derivedPrefix });
    }
  };
}
```

**Usage example:**
```typescript
const cfg = new MapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(S3MapStore.factory({ bucket: 'my-bucket', region: 'us-east-1' }));
// 'users' map → S3 keys: 'users/alice.json', 'users/bob.json'
// 'orders' map → S3 keys: 'orders/123.json', 'orders/456.json'
```

### B.5 — Test Plan (~14 tests)

**`packages/s3/test/S3MapStore.test.ts` (~10 tests):**  
Mock `S3Client` (inject via constructor: `new S3MapStore(config, mockClient)`).
Test mock client's `send()` method with `mock()` from `bun:test`.

| Test | Covers |
|------|--------|
| store(k, v) calls PutObjectCommand with correct Bucket/Key/Body | store |
| load(k) calls GetObjectCommand, parses response body | load |
| load(k) returns null when client throws NoSuchKey | missing key |
| delete(k) calls DeleteObjectCommand | delete |
| storeAll(Map) calls PutObjectCommand for each entry in parallel | storeAll |
| deleteAll(keys) calls DeleteObjectsCommand with correct Delete.Objects | deleteAll |
| deleteAll(>1000 keys) chunks into multiple DeleteObjectsCommand calls | deleteAll chunking |
| loadAll(keys) calls GetObjectCommand for each, builds result Map | loadAll |
| loadAllKeys() paginates ListObjectsV2, strips prefix+suffix | loadAllKeys |
| Custom serializer: store/load uses custom serialize/deserialize | serializer |

**`packages/s3/test/S3Config.test.ts` (~2 tests):**  
Default suffix is `.json`; default serializer is JSON.

**`packages/s3/test/S3MapStoreFactory.test.ts` (~2 tests):**
| Test | Covers |
|------|--------|
| `S3MapStore.factory(baseConfig).newMapStore('users')` → store has prefix `'users/'` | per-map prefix scoping |
| Two stores from same factory with different mapNames have independent prefixes | isolation |

### B.6 — Verification

```bash
cd packages/s3
bun test        # 14 tests green
bun run tsc --noEmit  # 0 errors
```

Root tests must not be affected: `bun test` at root → ~2,335 green.

### B.7 — Wiring into HeliosInstance

```typescript
const mapCfg = new MapConfig('users');
mapCfg.getMapStoreConfig()
  .setEnabled(true)
  .setImplementation(new S3MapStore({ bucket: 'my-bucket', region: 'us-east-1' }));
config.addMapConfig(mapCfg);
```

Factory-based wiring (preferred for per-map scoping):
```typescript
const usersCfg = new MapConfig('users');
usersCfg.getMapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(S3MapStore.factory({ bucket: 'my-bucket', region: 'us-east-1' }));
config.addMapConfig(usersCfg);
```

**GATE-CHECK labels:** `s3-mapstore`, `s3-config`

**STATUS: ✅ Complete — 14 tests green (2026-03-02)**

---

## Block 12.C — packages/mongodb/ (MongoMapStore)

### C.1 — Package Setup

**Create `packages/mongodb/package.json`:**
```json
{
  "name": "@helios/mongodb",
  "version": "1.0.0",
  "description": "MongoDB-backed MapStore for Helios",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "mongodb": "^6.12.0" },
  "peerDependencies": { "@helios/core": "workspace:*" },
  "devDependencies": { "@helios/core": "workspace:*" },
  "scripts": { "test": "bun test", "typecheck": "bun run tsc --noEmit" }
}
```

**Create `packages/mongodb/tsconfig.json`**, **`packages/mongodb/bunfig.toml`** (same path mapping pattern as S3).  
**Update root `package.json`** workspaces to add `"packages/mongodb"`.

### C.2 — Files

| File | Purpose |
|------|---------|
| `packages/mongodb/src/index.ts` | Public barrel export |
| `packages/mongodb/src/MongoConfig.ts` | Config: uri, database, collection, clientOptions |
| `packages/mongodb/src/MongoMapStore.ts` | `MapStore<string, T>` + `MapLoaderLifecycleSupport` |

### C.3 — MongoConfig

```typescript
export interface MongoConfig<T = unknown> {
  uri: string;
  database: string;
  collection?: string;          // default: mapName from init()
  clientOptions?: object;       // passed to MongoClient constructor
  serializer?: Serializer<T>;   // default: identity (store as BSON)
}
```

### C.4 — MongoMapStore Behavior

Document schema: `{ _id: key, value: serializedValue }`.  
`MongoMapStore<T>` implements `MapStore<string, T>` and `MapLoaderLifecycleSupport`.

- `init(properties, mapName)` → `new MongoClient(uri)` → `client.connect()`.  
  Collection = `config.collection ?? mapName`.
- `destroy()` → `client.close()`.
- `store(key, value)` → `collection.updateOne({ _id: key }, { $set: { value } }, { upsert: true })`.
- `load(key)` → `collection.findOne({ _id: key })` → return `doc?.value ?? null`.
- `delete(key)` → `collection.deleteOne({ _id: key })`.
- `storeAll(entries)` → `collection.bulkWrite(Array.from(entries).map(([k,v]) => ({ updateOne: { filter: { _id: k }, update: { $set: { value: v } }, upsert: true } })))`.
- `deleteAll(keys)` → `collection.deleteMany({ _id: { $in: keys } })`.
- `loadAll(keys)` → `collection.find({ _id: { $in: keys } }).toArray()` → build `Map<K, V>`.
- `loadAllKeys()` → `collection.find({}, { projection: { _id: 1 } }).map(d => d._id).toArray()`.

### C.4b — Static Factory Method

`MongoMapStore` must expose a static `.factory<T>(baseConfig: MongoConfig<T>): MapStoreFactory<string, T>`
method that enables per-map collection scoping:

```typescript
static factory<T>(baseConfig: MongoConfig<T>): MapStoreFactory<string, T> {
  return {
    newMapStore(mapName: string): MongoMapStore<T> {
      // Each map gets its own collection named after the map (unless caller overrides)
      const derivedCollection = baseConfig.collection ?? mapName;
      return new MongoMapStore<T>({ ...baseConfig, collection: derivedCollection });
    }
  };
}
```

**Usage example:**
```typescript
const cfg = new MapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(MongoMapStore.factory({ uri: 'mongodb://localhost', database: 'mydb' }));
// 'users' map → MongoDB collection 'users'
// 'orders' map → MongoDB collection 'orders'
```

### C.5 — Test Plan (~14 tests)

**`packages/mongodb/test/MongoMapStore.test.ts` (~10 tests):**  
Mock the `Collection` object (inject via a factory: `MongoMapStore` accepts an optional
`collectionFactory?: () => Collection` for testing).

| Test | Covers |
|------|--------|
| store(k, v) calls updateOne with upsert | store/upsert |
| load(k) calls findOne, returns value field | load |
| load(k) returns null when findOne returns null | missing key |
| delete(k) calls deleteOne | delete |
| storeAll(Map) calls bulkWrite with updateOne ops | storeAll |
| deleteAll(keys) calls deleteMany with $in | deleteAll |
| loadAll(keys) calls find with $in, builds Map | loadAll |
| loadAllKeys() calls find with projection, returns array of _id | loadAllKeys |
| init() connects client, uses mapName as default collection | lifecycle |
| destroy() closes client | lifecycle |

**`packages/mongodb/test/MongoConfig.test.ts` (~2 tests):**  
Default collection = mapName; config fields validated.

**`packages/mongodb/test/MongoMapStoreFactory.test.ts` (~2 tests):**
| Test | Covers |
|------|--------|
| `MongoMapStore.factory(baseConfig).newMapStore('users')` → store uses collection `'users'` | per-map collection scoping |
| Two stores from same factory with different mapNames use independent collections | isolation |

### C.6 — Verification

```bash
cd packages/mongodb
bun test        # 14 tests green
bun run tsc --noEmit  # 0 errors
```

### C.7 — Wiring into HeliosInstance

```typescript
const mapCfg = new MapConfig('users');
mapCfg.getMapStoreConfig()
  .setEnabled(true)
  .setImplementation(new MongoMapStore({ uri, database: 'helios' }));
config.addMapConfig(mapCfg);
```

Factory-based wiring (preferred for per-map scoping):
```typescript
const usersCfg = new MapConfig('users');
usersCfg.getMapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(MongoMapStore.factory({ uri, database: 'helios' }));
config.addMapConfig(usersCfg);
```

**STATUS: ✅ Complete — 15 tests green (2026-03-02)**

**GATE-CHECK labels:** `mongodb-mapstore`, `mongodb-config`

---

## Block 12.D — packages/turso/ (TursoMapStore)

### D.1 — Package Setup

**Create `packages/turso/package.json`:**
```json
{
  "name": "@helios/turso",
  "version": "1.0.0",
  "description": "Turso/libSQL-backed MapStore for Helios",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@libsql/client": "^0.14.0" },
  "peerDependencies": { "@helios/core": "workspace:*" },
  "devDependencies": { "@helios/core": "workspace:*" },
  "scripts": { "test": "bun test", "typecheck": "bun run tsc --noEmit" }
}
```

**Create `packages/turso/tsconfig.json`**, **`packages/turso/bunfig.toml`**.  
**Update root `package.json`** workspaces to add `"packages/turso"`.

### D.2 — Files

| File | Purpose |
|------|---------|
| `packages/turso/src/index.ts` | Public barrel export |
| `packages/turso/src/TursoConfig.ts` | Config: url, authToken, tableName, serializer |
| `packages/turso/src/TursoMapStore.ts` | `MapStore<string, T>` + `MapLoaderLifecycleSupport` |

### D.3 — TursoConfig

```typescript
export interface TursoConfig<T = unknown> {
  url: string;          // ':memory:' for tests, 'libsql://...' for Turso cloud, 'file:...' for local
  authToken?: string;   // required for Turso cloud; omit for local/memory
  tableName?: string;   // default: mapName from init()
  serializer?: Serializer<T>;  // default: JSON.stringify / JSON.parse
}
```

### D.4 — TursoMapStore Behavior

Table schema:
```sql
CREATE TABLE IF NOT EXISTS "{tableName}" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

`TursoMapStore<T>` implements `MapStore<string, T>` and `MapLoaderLifecycleSupport`.

Bulk operation contract (deterministic and limit-safe):
- Use `const BULK_CHUNK_SIZE = 500` for `storeAll/deleteAll/loadAll`.
- Process chunks sequentially in input order.
- For `deleteAll/loadAll`, each chunk size remains below SQLite bind-parameter limits.
- On first failing chunk, fail fast: throw with operation + chunk index metadata; do not continue later chunks.

- `init(properties, mapName)` → `createClient({ url, authToken })` → execute CREATE TABLE IF NOT EXISTS.  
  `tableName = config.tableName ?? mapName`.
- `destroy()` → `client.close()`.
- `store(key, value)` → `INSERT OR REPLACE INTO "{t}" (key, value) VALUES (?, ?)`.
- `load(key)` → `SELECT value FROM "{t}" WHERE key = ?` → parse first row → null if no rows.
- `delete(key)` → `DELETE FROM "{t}" WHERE key = ?`.
- `storeAll(entries)` → chunk by `BULK_CHUNK_SIZE`; execute one `client.batch(...)` per chunk.
- `deleteAll(keys)` → chunk by `BULK_CHUNK_SIZE`: `DELETE FROM "{t}" WHERE key IN (?,?,...)`.
- `loadAll(keys)` → chunk by `BULK_CHUNK_SIZE`: `SELECT key, value FROM "{t}" WHERE key IN (?,?,...)` — merge into result Map.
- `loadAllKeys()` → `SELECT key FROM "{t}"` → map to string array.

**Key advantage for tests:** `url: ':memory:'` uses real SQLite in-process — no external service.

### D.4b — Static Factory Method

`TursoMapStore` must expose a static `.factory<T>(baseConfig: TursoConfig<T>): MapStoreFactory<string, T>`
method that enables per-map table scoping:

```typescript
static factory<T>(baseConfig: TursoConfig<T>): MapStoreFactory<string, T> {
  return {
    newMapStore(mapName: string): TursoMapStore<T> {
      // Each map gets its own SQLite table named after the map (unless caller overrides)
      const derivedTableName = baseConfig.tableName ?? mapName;
      return new TursoMapStore<T>({ ...baseConfig, tableName: derivedTableName });
    }
  };
}
```

**Usage example:**
```typescript
const cfg = new MapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(TursoMapStore.factory({ url: ':memory:' }));
// 'users' map → SQLite table 'users'
// 'orders' map → SQLite table 'orders'
```

### D.5 — Test Plan (~18 tests)

**`packages/turso/test/TursoMapStore.test.ts` (~14 tests):**  
Use `url: ':memory:'` for behavioral tests. For chunk-failure path, inject a mock client
to force deterministic chunk failures.

| Test | Covers |
|------|--------|
| init() creates table (no error on subsequent init) | table auto-create, idempotent |
| store(k, v) then load(k) returns v | store + load round-trip |
| load(absent) returns null | missing key |
| store(k, v) twice → load returns latest value (upsert) | upsert behavior |
| delete(k) then load(k) returns null | delete |
| storeAll(Map) then loadAll(keys) returns all entries | batch store + batch load |
| deleteAll(keys) removes all specified keys | batch delete |
| loadAllKeys() returns all current keys | keys listing |
| storeAll with 1001 entries uses 3 chunks (500/500/1) | deterministic storeAll chunking |
| deleteAll with 1001 keys uses 3 chunks (500/500/1) | deterministic deleteAll chunking |
| loadAll with 1001 keys uses 3 chunks (500/500/1) | deterministic loadAll chunking |
| chunk failure fails fast and includes chunk metadata | failure semantics |
| Custom serializer: store/load uses custom serialize/deserialize | serializer |
| destroy() is safe to call (no error) | lifecycle |

**`packages/turso/test/TursoConfig.test.ts` (~2 tests):**  
Default tableName = mapName; default serializer = JSON.

**`packages/turso/test/TursoMapStoreFactory.test.ts` (~2 tests):**
| Test | Covers |
|------|--------|
| `TursoMapStore.factory({ url: ':memory:' }).newMapStore('users')` → uses table `'users'` | per-map table scoping |
| Two stores from same factory with different mapNames use independent tables | isolation (both `':memory:'` — independent in-process DBs per client) |

### D.6 — Verification

```bash
cd packages/turso
bun test        # 18 tests green
bun run tsc --noEmit  # 0 errors
```

### D.7 — Wiring into HeliosInstance

```typescript
const mapCfg = new MapConfig('users');
mapCfg.getMapStoreConfig()
  .setEnabled(true)
  .setImplementation(new TursoMapStore({ url: ':memory:' }));
config.addMapConfig(mapCfg);
```

Factory-based wiring (preferred for per-map scoping):
```typescript
const usersCfg = new MapConfig('users');
usersCfg.getMapStoreConfig()
  .setEnabled(true)
  .setFactoryImplementation(TursoMapStore.factory({ url: ':memory:' }));
config.addMapConfig(usersCfg);
```

**GATE-CHECK labels:** `turso-mapstore`, `turso-config`

---

## Cross-Phase Summary

| Block | New Files | Modified Files | New Tests | Prerequisite |
|-------|-----------|----------------|-----------|-------------|
| 12.A1 | 10 | 2 (MapConfig, root barrel) | ~22 | Phase 8 done |
| 12.A2 | 8 | 0 | ~37 | 12.A1 |
| 12.A3 | 2 | 7 + bulk (`src`, `app/src`, `test`, `app/test`) | ~12 new (codemod validates existing suites) | 12.A2 |
| 12.B | 5 | 1 (root pkg.json) | ~14 | 12.A3 |
| 12.C | 5 | 1 (root pkg.json) | ~14 | 12.A3 |
| 12.D | 5 | 1 (root pkg.json) | ~18 | 12.A3 |
| **Total** | **35** | **11+** | **~117** | — |

---

## Final Verification (All Phase 12 Blocks Complete)

```bash
# Core
bun test                    # ~2,342+ pass (2,271 + ~71 core mapstore tests)
bun test --pattern "app/"   # 25 pass (app/ tests now use await correctly)
bun run tsc --noEmit        # 0 errors

# Extension packages
bun test --pattern "packages/s3"       # 14 pass
bun test --pattern "packages/mongodb"  # 14 pass
bun test --pattern "packages/turso"    # 18 pass

# Manual E2E (optional — not a CI gate)
# Configure TursoMapStore on IMap with url: ':memory:'
# put(k,v) → verify row in SQLite
# restart → get(k) loads from SQLite
```

---

## Java Reference Files

| Component | Java Source |
|-----------|------------|
| MapStore interface | `helios-1/hazelcast/src/main/java/com/hazelcast/map/MapStore.java` |
| MapLoader interface | `helios-1/hazelcast/src/main/java/com/hazelcast/map/MapLoader.java` |
| MapLoaderLifecycleSupport | `helios-1/hazelcast/src/main/java/com/hazelcast/map/MapLoaderLifecycleSupport.java` |
| MapDataStore | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/MapDataStore.java` |
| WriteThroughStore | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writethrough/WriteThroughStore.java` |
| WriteBehindStore | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/WriteBehindStore.java` |
| CoalescedWriteBehindQueue | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/CoalescedWriteBehindQueue.java` |
| DefaultWriteBehindProcessor | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/DefaultWriteBehindProcessor.java` |
| StoreWorker | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/StoreWorker.java` |
| DelayedEntry | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/writebehind/entry/DelayedEntry.java` |
| MapStoreWrapper | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/MapStoreWrapper.java` |
| DefaultRecordStore | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/recordstore/DefaultRecordStore.java` |
| MapStoreContext | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/MapStoreContext.java` |
| StoreConstructor | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/StoreConstructor.java` |
| MapStoreFactory | `helios-1/hazelcast/src/main/java/com/hazelcast/map/MapStoreFactory.java` |
| MapStoreContextFactory | `helios-1/hazelcast/src/main/java/com/hazelcast/map/impl/mapstore/MapStoreContextFactory.java` |
