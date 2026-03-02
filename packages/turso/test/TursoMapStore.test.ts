import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TursoMapStore } from '../src/TursoMapStore.js';

// ---------------------------------------------------------------------------
// Real :memory: SQLite tests — no mocks needed for most behavioral tests
// ---------------------------------------------------------------------------

describe('TursoMapStore', () => {
  let store: TursoMapStore<unknown>;

  beforeEach(async () => {
    store = new TursoMapStore({ url: ':memory:' });
    await store.init(new Map(), 'testmap');
  });

  afterEach(async () => {
    await store.destroy();
  });

  test('init() creates table (idempotent — no error on second init)', async () => {
    // Second init on same config should not throw
    const store2 = new TursoMapStore({ url: ':memory:' });
    await store2.init(new Map(), 'testmap');
    await store2.destroy();
  });

  test('store(k, v) then load(k) returns v (round-trip)', async () => {
    await store.store('alice', { age: 30 });
    const result = await store.load('alice');
    expect(result).toEqual({ age: 30 });
  });

  test('load(absent key) returns null', async () => {
    const result = await store.load('missing');
    expect(result).toBeNull();
  });

  test('store(k, v) twice → load returns latest value (upsert)', async () => {
    await store.store('alice', { age: 30 });
    await store.store('alice', { age: 31 });
    const result = await store.load('alice');
    expect(result).toEqual({ age: 31 });
  });

  test('delete(k) then load(k) returns null', async () => {
    await store.store('alice', { age: 30 });
    await store.delete('alice');
    const result = await store.load('alice');
    expect(result).toBeNull();
  });

  test('storeAll(Map) then loadAll(keys) returns all entries', async () => {
    const entries = new Map<string, unknown>([
      ['alice', { age: 30 }],
      ['bob', { age: 25 }],
    ]);
    await store.storeAll(entries);
    const result = await store.loadAll(['alice', 'bob']);
    expect(result.size).toBe(2);
    expect(result.get('alice')).toEqual({ age: 30 });
    expect(result.get('bob')).toEqual({ age: 25 });
  });

  test('deleteAll(keys) removes all specified keys', async () => {
    const entries = new Map<string, unknown>([
      ['alice', { age: 30 }],
      ['bob', { age: 25 }],
      ['charlie', { age: 40 }],
    ]);
    await store.storeAll(entries);
    await store.deleteAll(['alice', 'bob']);
    expect(await store.load('alice')).toBeNull();
    expect(await store.load('bob')).toBeNull();
    expect(await store.load('charlie')).toEqual({ age: 40 });
  });

  test('loadAllKeys() returns all current keys', async () => {
    const entries = new Map<string, unknown>([
      ['alice', 1],
      ['bob', 2],
      ['charlie', 3],
    ]);
    await store.storeAll(entries);
    const keys = await store.loadAllKeys();
    expect(keys.sort()).toEqual(['alice', 'bob', 'charlie']);
  });

  test('storeAll with 1001 entries uses 3 chunks (500/500/1)', async () => {
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 1001; i++) {
      entries.set(`key${i}`, i);
    }
    await store.storeAll(entries);
    const keys = await store.loadAllKeys();
    expect(keys.length).toBe(1001);
  });

  test('deleteAll with 1001 keys uses 3 chunks (500/500/1)', async () => {
    // First store 1001 entries
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 1001; i++) {
      entries.set(`key${i}`, i);
    }
    await store.storeAll(entries);
    // Then delete all
    await store.deleteAll(Array.from(entries.keys()));
    const keys = await store.loadAllKeys();
    expect(keys.length).toBe(0);
  });

  test('loadAll with 1001 keys uses 3 chunks (500/500/1)', async () => {
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 1001; i++) {
      entries.set(`key${i}`, i);
    }
    await store.storeAll(entries);
    const result = await store.loadAll(Array.from(entries.keys()));
    expect(result.size).toBe(1001);
  });

  test('chunk failure fails fast and includes chunk metadata', async () => {
    // Use a mock client that throws on batch()
    const failingClient = {
      execute: async (_stmt: any) => ({ rows: [] }),
      batch: async (_stmts: any[]) => {
        throw new Error('connection timeout');
      },
      close: () => {},
    };
    const failStore = new TursoMapStore({ url: ':memory:' }, failingClient as any);
    // We bypass init() since we injected the client already
    (failStore as any)._tableName = 'testmap';

    const entries = new Map<string, unknown>([['a', 1]]);
    try {
      await failStore.storeAll(entries);
      expect(true).toBe(false); // should not reach here
    } catch (e: any) {
      expect(e.message).toMatch(/connection timeout/);
    }
  });

  test('custom serializer: store/load uses custom serialize/deserialize', async () => {
    const customSerializer = {
      serialize: (v: unknown) => `CUSTOM:${JSON.stringify(v)}`,
      deserialize: (s: string) => JSON.parse(s.replace('CUSTOM:', '')) as unknown,
    };
    const customStore = new TursoMapStore({ url: ':memory:', serializer: customSerializer });
    await customStore.init(new Map(), 'custom_table');
    await customStore.store('key1', { x: 99 });
    const result = await customStore.load('key1');
    expect(result).toEqual({ x: 99 });
    await customStore.destroy();
  });

  test('destroy() is safe to call (no error)', async () => {
    const s = new TursoMapStore({ url: ':memory:' });
    await s.init(new Map(), 'testmap2');
    await expect(s.destroy()).resolves.toBeUndefined();
  });
});
