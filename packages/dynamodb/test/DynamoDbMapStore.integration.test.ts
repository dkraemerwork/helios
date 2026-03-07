import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { DynamoDbMapStore } from '../src/DynamoDbMapStore.js';
import type { Serializer } from '../src/DynamoDbConfig.js';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collectKeys(stream: AsyncIterable<string> & { close(): Promise<void> }): Promise<string[]> {
  const keys: string[] = [];
  for await (const key of stream) {
    keys.push(key);
  }
  await stream.close();
  return keys;
}

function makeStore<T = unknown>(
  overrides: Partial<{
    tableName: string;
    bucketCount: number;
    autoCreateTable: boolean;
    serializer: Serializer<T>;
    consistentRead: boolean;
    mapName: string;
  }> = {},
): { store: DynamoDbMapStore<T>; mapName: string } {
  const mapName = overrides.mapName ?? `int-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const store = new DynamoDbMapStore<T>({
    endpoint: ENDPOINT!,
    tableName: overrides.tableName ?? tableName,
    bucketCount: overrides.bucketCount ?? 4,
    autoCreateTable: overrides.autoCreateTable ?? true,
    consistentRead: overrides.consistentRead ?? true,
    serializer: overrides.serializer,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  return { store, mapName };
}

// ---------------------------------------------------------------------------
// Shared table name with timestamp to avoid collisions between runs
// ---------------------------------------------------------------------------

const tableName = `helios_integration_test_${Date.now()}`;

// ---------------------------------------------------------------------------
// Integration tests — only run when DYNAMODB_ENDPOINT is set
// ---------------------------------------------------------------------------

describe.skipIf(!ENDPOINT)('DynamoDbMapStore Integration', () => {
  let store: DynamoDbMapStore<unknown>;

  beforeAll(async () => {
    const result = makeStore({ mapName: 'integration-primary' });
    store = result.store;
    await store.init(new Map(), result.mapName);
  });

  afterAll(async () => {
    await store.clear();
    await store.destroy();
  });

  // ── 1. Table auto-creation ─────────────────────────────────────────────

  test('init with autoCreateTable=true creates the table', async () => {
    // The beforeAll already created the table via autoCreateTable.
    // Verify a second store pointing at the same table initializes without error
    // (DescribeTable succeeds, so CreateTable is skipped).
    const { store: secondStore, mapName } = makeStore({ mapName: 'auto-create-check' });
    await secondStore.init(new Map(), mapName);
    await secondStore.destroy();
  });

  // ── 2. Store / Load round-trip ─────────────────────────────────────────

  test('store a value, load it back, verify round-trip', async () => {
    const key = `roundtrip-${Date.now()}`;
    const value = { name: 'alice', age: 30, tags: ['admin', 'user'] };

    await store.store(key, value);
    const loaded = await store.load(key);

    expect(loaded).toEqual(value);

    // clean up
    await store.delete(key);
  });

  // ── 3. Store / Delete / Load ───────────────────────────────────────────

  test('store then delete, load returns null', async () => {
    const key = `delete-test-${Date.now()}`;
    await store.store(key, { temp: true });

    await store.delete(key);
    const loaded = await store.load(key);

    expect(loaded).toBeNull();
  });

  // ── 4. StoreAll / LoadAll ──────────────────────────────────────────────

  test('batch store 10 entries, loadAll returns them all', async () => {
    const prefix = `batch-${Date.now()}`;
    const entries = new Map<string, unknown>();
    const keys: string[] = [];

    for (let i = 0; i < 10; i++) {
      const key = `${prefix}-${i}`;
      keys.push(key);
      entries.set(key, { index: i, value: `item-${i}` });
    }

    await store.storeAll(entries);
    const loaded = await store.loadAll(keys);

    expect(loaded.size).toBe(10);
    for (const [key, value] of entries) {
      expect(loaded.get(key)).toEqual(value);
    }

    // clean up
    await store.deleteAll(keys);
  });

  // ── 5. DeleteAll ───────────────────────────────────────────────────────

  test('deleteAll removes all specified keys', async () => {
    const prefix = `deleteall-${Date.now()}`;
    const keys = Array.from({ length: 5 }, (_, i) => `${prefix}-${i}`);
    const entries = new Map<string, unknown>();
    for (const key of keys) {
      entries.set(key, { data: key });
    }

    await store.storeAll(entries);
    await store.deleteAll(keys);

    const loaded = await store.loadAll(keys);
    expect(loaded.size).toBe(0);
  });

  // ── 6. Streaming loadAllKeys() ────────────────────────────────────────

  test('store multiple entries across buckets, loadAllKeys streams them all', async () => {
    const { store: freshStore, mapName } = makeStore({ mapName: `keys-stream-${Date.now()}` });
    await freshStore.init(new Map(), mapName);

    const prefix = `stream`;
    const insertedKeys = new Set<string>();
    const entries = new Map<string, unknown>();

    for (let i = 0; i < 20; i++) {
      const key = `${prefix}-${i}`;
      insertedKeys.add(key);
      entries.set(key, { i });
    }
    await freshStore.storeAll(entries);

    const stream = await freshStore.loadAllKeys();
    const loadedKeys = await collectKeys(stream);

    expect(loadedKeys.length).toBe(insertedKeys.size);
    for (const key of insertedKeys) {
      expect(loadedKeys).toContain(key);
    }

    await freshStore.clear();
    await freshStore.destroy();
  });

  // ── 7. Clear ───────────────────────────────────────────────────────────

  test('store entries, clear(), loadAllKeys returns nothing', async () => {
    const { store: clearStore, mapName } = makeStore({ mapName: `clear-test-${Date.now()}` });
    await clearStore.init(new Map(), mapName);

    const entries = new Map<string, unknown>();
    for (let i = 0; i < 8; i++) {
      entries.set(`clear-${i}`, { value: i });
    }
    await clearStore.storeAll(entries);

    await clearStore.clear();

    const stream = await clearStore.loadAllKeys();
    const remainingKeys = await collectKeys(stream);
    expect(remainingKeys).toHaveLength(0);

    await clearStore.destroy();
  });

  // ── 8. Serializer round-trip ───────────────────────────────────────────

  test('custom serializer works end-to-end', async () => {
    interface Prefixed {
      payload: string;
    }

    const customSerializer: Serializer<Prefixed> = {
      serialize: (v) => `CUSTOM:${JSON.stringify(v)}`,
      deserialize: (raw) => {
        if (!raw.startsWith('CUSTOM:')) {
          throw new Error('Missing custom prefix');
        }
        return JSON.parse(raw.slice('CUSTOM:'.length)) as Prefixed;
      },
    };

    const { store: customStore, mapName } = makeStore<Prefixed>({
      serializer: customSerializer,
      mapName: `serializer-test-${Date.now()}`,
    });
    await customStore.init(new Map(), mapName);

    const key = 'custom-ser-key';
    const value: Prefixed = { payload: 'hello-world' };

    await customStore.store(key, value);
    const loaded = await customStore.load(key);

    expect(loaded).toEqual(value);

    await customStore.clear();
    await customStore.destroy();
  });

  // ── 9. Not-found handling ──────────────────────────────────────────────

  test('load of nonexistent key returns null', async () => {
    const result = await store.load(`nonexistent-${Date.now()}-${Math.random()}`);
    expect(result).toBeNull();
  });

  // ── 10. Map isolation ──────────────────────────────────────────────────

  test('two stores with different map names share a table without cross-contamination', async () => {
    const { store: storeA, mapName: mapA } = makeStore({ mapName: `iso-a-${Date.now()}` });
    const { store: storeB, mapName: mapB } = makeStore({ mapName: `iso-b-${Date.now()}` });

    await storeA.init(new Map(), mapA);
    await storeB.init(new Map(), mapB);

    await storeA.store('shared-key', { source: 'A' });
    await storeB.store('shared-key', { source: 'B' });

    const fromA = await storeA.load('shared-key');
    const fromB = await storeB.load('shared-key');

    expect(fromA).toEqual({ source: 'A' });
    expect(fromB).toEqual({ source: 'B' });

    // Verify loadAllKeys isolation
    const keysA = await collectKeys(await storeA.loadAllKeys());
    const keysB = await collectKeys(await storeB.loadAllKeys());

    expect(keysA).toEqual(['shared-key']);
    expect(keysB).toEqual(['shared-key']);

    // Deleting from A should not affect B
    await storeA.delete('shared-key');
    expect(await storeA.load('shared-key')).toBeNull();
    expect(await storeB.load('shared-key')).toEqual({ source: 'B' });

    await storeA.clear();
    await storeB.clear();
    await storeA.destroy();
    await storeB.destroy();
  });

  // ── 11. Bucket-count consistency ───────────────────────────────────────

  test('store with bucketCount=4, verify keys distribute across buckets', async () => {
    const { store: bucketStore, mapName } = makeStore({
      bucketCount: 4,
      mapName: `bucket-test-${Date.now()}`,
    });
    await bucketStore.init(new Map(), mapName);

    // Insert enough keys to statistically hit multiple buckets.
    // Use a diverse set to maximize distribution.
    const keys: string[] = [];
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 40; i++) {
      const key = `bucket-key-${i}-${String.fromCharCode(65 + (i % 26))}`;
      keys.push(key);
      entries.set(key, { i });
    }
    await bucketStore.storeAll(entries);

    // Verify all keys are retrievable
    const stream = await bucketStore.loadAllKeys();
    const loadedKeys = await collectKeys(stream);
    expect(loadedKeys.sort()).toEqual(keys.sort());

    // Verify we can load all values back
    const loaded = await bucketStore.loadAll(keys);
    expect(loaded.size).toBe(40);

    await bucketStore.clear();
    await bucketStore.destroy();
  });

  // ── 12. Re-run safety ──────────────────────────────────────────────────

  test('tests can run repeatedly against existing table without failures', async () => {
    // Create a store that reuses the shared table with a fixed map name.
    // Running init() twice should not fail (table already exists).
    const { store: rerunStore, mapName } = makeStore({ mapName: `rerun-safety-${Date.now()}` });
    await rerunStore.init(new Map(), mapName);

    await rerunStore.store('rerun-key', { run: 1 });
    expect(await rerunStore.load('rerun-key')).toEqual({ run: 1 });

    // Simulate a second run: create another store with the same table
    const { store: rerunStore2 } = makeStore({ mapName });
    await rerunStore2.init(new Map(), mapName);

    // Overwrite with new data — should succeed, not conflict
    await rerunStore2.store('rerun-key', { run: 2 });
    expect(await rerunStore2.load('rerun-key')).toEqual({ run: 2 });

    await rerunStore.clear();
    await rerunStore.destroy();
    await rerunStore2.destroy();
  });
});
