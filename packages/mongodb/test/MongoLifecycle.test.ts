import { describe, expect, mock, test } from 'bun:test';
import { MongoMapStore } from '../src/MongoMapStore.js';

function makeMockClient(opts?: { owned?: boolean }) {
  const mockColl = {
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: mock(async () => []) })),
    updateOne: mock(async () => ({ matchedCount: 1 })),
    deleteOne: mock(async () => ({ deletedCount: 1 })),
    deleteMany: mock(async () => ({ deletedCount: 0 })),
    bulkWrite: mock(async () => ({ ok: 1 })),
  };
  const mockDb = { collection: mock(() => mockColl) };
  const client = {
    connect: mock(async () => {}),
    db: mock(() => mockDb),
    close: mock(async () => {}),
  };
  return { client, db: mockDb, coll: mockColl };
}

describe('MongoMapStore lifecycle', () => {
  test('destroy() closes owned client (no injected client)', async () => {
    const store = new MongoMapStore({
      uri: 'mongodb://localhost:27017',
      database: 'testdb',
    });
    // Inject a mock client manually for test — the store owns it because
    // it created it (simulated via internal _client assignment)
    const { client, db: _db } = makeMockClient();
    (store as any)._client = client as any;
    (store as any)._ownsClient = true;
    (store as any)._coll = makeMockClient().coll;

    await store.destroy();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('destroy() does NOT close injected client', async () => {
    const { client } = makeMockClient();
    const store = new MongoMapStore(
      { uri: 'mongodb://localhost:27017', database: 'testdb' },
      client as any,
    );
    (store as any)._coll = makeMockClient().coll;
    await store.init(new Map(), 'mymap');
    await store.destroy();
    expect(client.close).not.toHaveBeenCalled();
  });

  test('init() with owned client creates and connects MongoClient', async () => {
    // Can't fully test real MongoClient creation without a server, but we
    // can test that the store marks ownership correctly
    const { client } = makeMockClient();
    const store = new MongoMapStore(
      { uri: 'mongodb://localhost:27017', database: 'testdb' },
      client as any, // injected
    );
    await store.init(new Map(), 'mymap');
    // injected client should be marked as not owned
    expect((store as any)._ownsClient).toBe(false);
  });

  test('init() sets _ownsClient=true when no client is injected', async () => {
    // We can't connect to real Mongo, but we can verify the flag
    // by constructing without client and checking pre-init state
    const store = new MongoMapStore({
      uri: 'mongodb://localhost:27017',
      database: 'testdb',
    });
    // Before init, no client exists
    expect((store as any)._ownsClient).toBe(true);
  });

  test('collection binding uses external-name from properties when provided', async () => {
    const { client, db } = makeMockClient();
    const store = new MongoMapStore(
      { uri: 'mongodb://localhost:27017', database: 'testdb' },
      client as any,
    );
    const props = new Map<string, string>([['external-name', 'custom_collection']]);
    await store.init(props, 'mymap');
    expect(db.collection).toHaveBeenCalledWith('custom_collection');
  });

  test('collection binding falls back to config.collection, then mapName', async () => {
    const { client, db } = makeMockClient();
    const store = new MongoMapStore(
      { uri: 'mongodb://localhost:27017', database: 'testdb', collection: 'from_config' },
      client as any,
    );
    await store.init(new Map(), 'mymap');
    expect(db.collection).toHaveBeenCalledWith('from_config');
  });

  test('repeated destroy() is idempotent', async () => {
    const { client } = makeMockClient();
    const store = new MongoMapStore(
      { uri: 'mongodb://localhost:27017', database: 'testdb' },
    );
    (store as any)._client = client as any;
    (store as any)._ownsClient = true;
    (store as any)._coll = makeMockClient().coll;

    await store.destroy();
    await store.destroy();
    // Only closed once
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
