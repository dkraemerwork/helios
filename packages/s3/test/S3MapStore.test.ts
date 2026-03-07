import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { S3MapStore } from '../src/S3MapStore.js';

async function collectKeys<K>(stream: AsyncIterable<K>): Promise<K[]> {
  const keys: K[] = [];
  for await (const k of stream) keys.push(k);
  return keys;
}

// Minimal mock of the S3Client send() method
function makeMockClient(responses: Record<string, unknown> = {}) {
  const calls: Array<{ command: string; input: unknown }> = [];
  const send = mock(async (command: any) => {
    const name: string = command.constructor.name;
    calls.push({ command: name, input: command.input });
    const result = responses[name];
    if (result instanceof Error) throw result;
    return result ?? {};
  });
  return { send, calls };
}

describe('S3MapStore', () => {
  const bucket = 'test-bucket';
  const prefix = 'users/';
  const suffix = '.json';

  test('store(k, v) calls PutObjectCommand with correct Bucket/Key/Body', async () => {
    const client = makeMockClient();
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    await store.store('alice', { age: 30 });

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.command).toBe('PutObjectCommand');
    const input = call.input as any;
    expect(input.Bucket).toBe(bucket);
    expect(input.Key).toBe('users/alice.json');
    expect(input.Body).toBe(JSON.stringify({ age: 30 }));
  });

  test('load(k) calls GetObjectCommand, parses response body', async () => {
    const mockBody = { transformToString: async () => JSON.stringify({ age: 30 }) };
    const client = makeMockClient({ GetObjectCommand: { Body: mockBody } });
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);

    const result = await store.load('alice');
    expect(result).toEqual({ age: 30 });

    const call = client.calls[0];
    expect(call.command).toBe('GetObjectCommand');
    expect((call.input as any).Key).toBe('users/alice.json');
  });

  test('load(k) returns null when client throws NoSuchKey', async () => {
    const err = Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    const client = makeMockClient({ GetObjectCommand: err });
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);

    const result = await store.load('missing');
    expect(result).toBeNull();
  });

  test('delete(k) calls DeleteObjectCommand', async () => {
    const client = makeMockClient();
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    await store.delete('alice');

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].command).toBe('DeleteObjectCommand');
    expect((client.calls[0].input as any).Key).toBe('users/alice.json');
  });

  test('storeAll(Map) calls PutObjectCommand for each entry in parallel', async () => {
    const client = makeMockClient();
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    const entries = new Map<string, unknown>([
      ['alice', { age: 30 }],
      ['bob', { age: 25 }],
    ]);
    await store.storeAll(entries);

    expect(client.calls).toHaveLength(2);
    const keys = client.calls.map((c) => (c.input as any).Key).sort();
    expect(keys).toEqual(['users/alice.json', 'users/bob.json']);
    client.calls.forEach((c) => expect(c.command).toBe('PutObjectCommand'));
  });

  test('deleteAll(keys) calls DeleteObjectsCommand with correct Delete.Objects', async () => {
    const client = makeMockClient({ DeleteObjectsCommand: { Deleted: [] } });
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    await store.deleteAll(['alice', 'bob']);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].command).toBe('DeleteObjectsCommand');
    const input = client.calls[0].input as any;
    expect(input.Bucket).toBe(bucket);
    const objectKeys = input.Delete.Objects.map((o: any) => o.Key).sort();
    expect(objectKeys).toEqual(['users/alice.json', 'users/bob.json']);
  });

  test('deleteAll(>1000 keys) chunks into multiple DeleteObjectsCommand calls', async () => {
    const client = makeMockClient({ DeleteObjectsCommand: { Deleted: [] } });
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    const keys = Array.from({ length: 2500 }, (_, i) => `key${i}`);
    await store.deleteAll(keys);

    // 2500 keys → 3 chunks (1000 + 1000 + 500)
    expect(client.calls.filter((c) => c.command === 'DeleteObjectsCommand')).toHaveLength(3);
  });

  test('loadAll(keys) calls GetObjectCommand for each, builds result Map', async () => {
    const mockBody = (val: unknown) => ({ transformToString: async () => JSON.stringify(val) });
    let callCount = 0;
    const send = mock(async (command: any) => {
      callCount++;
      return { Body: mockBody({ index: callCount }) };
    });
    const client = { send, calls: [] as any[] };
    const store = new S3MapStore({ bucket, prefix, suffix }, client as any);
    const result = await store.loadAll(['k1', 'k2']);

    expect(result.size).toBe(2);
    expect(result.has('k1')).toBe(true);
    expect(result.has('k2')).toBe(true);
  });

  test('loadAllKeys() paginates ListObjectsV2, strips prefix+suffix', async () => {
    // Simulate two pages
    let page = 0;
    const send = mock(async (command: any) => {
      page++;
      if (page === 1) {
        return {
          Contents: [{ Key: 'users/alice.json' }, { Key: 'users/bob.json' }],
          IsTruncated: true,
          NextContinuationToken: 'token1',
        };
      }
      return {
        Contents: [{ Key: 'users/charlie.json' }],
        IsTruncated: false,
      };
    });
    const store = new S3MapStore({ bucket, prefix, suffix }, { send } as any);
    const keys = await collectKeys(await store.loadAllKeys());

    expect(keys.sort()).toEqual(['alice', 'bob', 'charlie']);
  });

  test('custom serializer: store/load uses custom serialize/deserialize', async () => {
    const serializer = {
      serialize: (v: unknown) => `CUSTOM:${JSON.stringify(v)}`,
      deserialize: (s: string) => JSON.parse(s.replace('CUSTOM:', '')),
    };
    let stored = '';
    const send = mock(async (command: any) => {
      if (command.constructor.name === 'PutObjectCommand') {
        stored = command.input.Body;
        return {};
      }
      // GetObjectCommand
      return { Body: { transformToString: async () => stored } };
    });
    const store = new S3MapStore({ bucket, prefix, suffix, serializer }, { send } as any);
    await store.store('alice', { age: 30 });
    expect(stored).toBe('CUSTOM:{"age":30}');

    const result = await store.load('alice');
    expect(result).toEqual({ age: 30 });
  });
});
