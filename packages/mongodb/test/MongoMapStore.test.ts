import { describe, expect, mock, test } from 'bun:test';
import { MongoMapStore } from '../src/MongoMapStore.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockCollection() {
  const findOne = mock(async (_filter: any) => null as any);
  const find = mock((_filter: any, _opts?: any) => ({
    toArray: mock(async () => [] as any[]),
  }));
  const updateOne = mock(async (_filter: any, _update: any, _opts?: any) => ({ matchedCount: 1 }));
  const deleteOne = mock(async (_filter: any) => ({ deletedCount: 1 }));
  const deleteMany = mock(async (_filter: any) => ({ deletedCount: 0 }));
  const bulkWrite = mock(async (_ops: any[]) => ({ ok: 1 }));

  return { findOne, find, updateOne, deleteOne, deleteMany, bulkWrite };
}

function makeMockClient(coll: ReturnType<typeof makeMockCollection>) {
  const mockDb = {
    collection: mock((_name: string) => coll),
  };
  const mockClient = {
    connect: mock(async () => {}),
    db: mock((_name: string) => mockDb),
    close: mock(async () => {}),
  };
  return { client: mockClient, db: mockDb };
}

const BASE_CONFIG = { uri: 'mongodb://localhost:27017', database: 'testdb' };

async function makeStore(collOverride?: ReturnType<typeof makeMockCollection>) {
  const coll = collOverride ?? makeMockCollection();
  const { client, db } = makeMockClient(coll);
  const store = new MongoMapStore(BASE_CONFIG, client as any);
  await store.init(new Map(), 'mymap');
  return { store, coll, client, db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MongoMapStore', () => {
  test('init() connects client and uses mapName as default collection', async () => {
    const coll = makeMockCollection();
    const { client, db } = makeMockClient(coll);
    const store = new MongoMapStore(BASE_CONFIG, client as any);
    await store.init(new Map(), 'mymap');

    expect(client.connect.mock.calls).toHaveLength(1);
    expect(client.db.mock.calls[0][0]).toBe('testdb');
    expect(db.collection.mock.calls[0][0]).toBe('mymap');
  });

  test('init() uses config.collection when provided instead of mapName', async () => {
    const coll = makeMockCollection();
    const { client, db } = makeMockClient(coll);
    const store = new MongoMapStore(
      { ...BASE_CONFIG, collection: 'custom_coll' },
      client as any,
    );
    await store.init(new Map(), 'mymap');
    expect(db.collection.mock.calls[0][0]).toBe('custom_coll');
  });

  test('destroy() does not close an injected MongoClient', async () => {
    const { store, client } = await makeStore();
    await store.destroy();
    // Injected clients are not owned by the store, so close is NOT called
    expect(client.close.mock.calls).toHaveLength(0);
  });

  test('store(k, v) calls updateOne with upsert', async () => {
    const { store, coll } = await makeStore();
    await store.store('alice', { age: 30 });

    expect(coll.updateOne.mock.calls).toHaveLength(1);
    const [filter, update, opts] = coll.updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({ _id: 'alice' });
    expect(update).toEqual({ $set: { value: JSON.stringify({ age: 30 }) } });
    expect(opts).toEqual({ upsert: true });
  });

  test('load(k) calls findOne and returns deserialized value', async () => {
    const coll = makeMockCollection();
    coll.findOne = mock(async (_filter: any) =>
      ({ _id: 'alice', value: JSON.stringify({ age: 30 }) }) as any,
    );
    const { store } = await makeStore(coll);
    const result = await store.load('alice');

    expect(result).toEqual({ age: 30 });
    const [filter] = coll.findOne.mock.calls[0] as any[];
    expect(filter).toEqual({ _id: 'alice' });
  });

  test('load(k) returns null when findOne returns null', async () => {
    const { store } = await makeStore();
    const result = await store.load('missing');
    expect(result).toBeNull();
  });

  test('delete(k) calls deleteOne with correct filter', async () => {
    const { store, coll } = await makeStore();
    await store.delete('alice');

    expect(coll.deleteOne.mock.calls).toHaveLength(1);
    const [filter] = coll.deleteOne.mock.calls[0] as any[];
    expect(filter).toEqual({ _id: 'alice' });
  });

  test('storeAll(Map) calls bulkWrite with updateOne upsert operations', async () => {
    const { store, coll } = await makeStore();
    const entries = new Map<string, unknown>([
      ['alice', { age: 30 }],
      ['bob', { age: 25 }],
    ]);
    await store.storeAll(entries);

    expect(coll.bulkWrite.mock.calls).toHaveLength(1);
    const [ops] = coll.bulkWrite.mock.calls[0] as any[];
    expect(ops).toHaveLength(2);
    const opKeys = ops.map((op: any) => op.updateOne.filter._id).sort();
    expect(opKeys).toEqual(['alice', 'bob']);
    ops.forEach((op: any) => {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$set).toBeDefined();
    });
  });

  test('deleteAll(keys) calls deleteMany with $in filter', async () => {
    const { store, coll } = await makeStore();
    await store.deleteAll(['alice', 'bob']);

    expect(coll.deleteMany.mock.calls).toHaveLength(1);
    const [filter] = coll.deleteMany.mock.calls[0] as any[];
    expect(filter._id.$in.sort()).toEqual(['alice', 'bob']);
  });

  test('loadAll(keys) calls find with $in and builds result Map', async () => {
    const coll = makeMockCollection();
    coll.find = mock((_filter: any, _opts?: any) => ({
      toArray: mock(async () => [
        { _id: 'alice', value: JSON.stringify({ age: 30 }) },
        { _id: 'bob', value: JSON.stringify({ age: 25 }) },
      ]),
    }));
    const { store } = await makeStore(coll);
    const result = await store.loadAll(['alice', 'bob']);

    expect(result.size).toBe(2);
    expect(result.get('alice')).toEqual({ age: 30 });
    expect(result.get('bob')).toEqual({ age: 25 });
    const [filter] = coll.find.mock.calls[0] as any[];
    expect(filter._id.$in.sort()).toEqual(['alice', 'bob']);
  });

  test('loadAllKeys() calls find with projection and returns _id array', async () => {
    const coll = makeMockCollection();
    coll.find = mock((_filter: any, _opts?: any) => ({
      toArray: mock(async () => [{ _id: 'alice' }, { _id: 'bob' }]),
    }));
    const { store } = await makeStore(coll);
    const stream = await store.loadAllKeys();
    const keys: string[] = [];
    for await (const k of stream) keys.push(k);
    await stream.close();

    expect(keys.sort()).toEqual(['alice', 'bob']);
    const [, opts] = coll.find.mock.calls[0] as any[];
    expect(opts?.projection).toEqual({ _id: 1 });
  });
});
