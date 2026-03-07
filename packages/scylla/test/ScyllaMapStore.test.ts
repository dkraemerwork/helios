import { describe, expect, mock, test } from 'bun:test';
import { ScyllaMapStore } from '../src/ScyllaMapStore.js';

async function collectKeys<K>(stream: AsyncIterable<K>): Promise<K[]> {
  const keys: K[] = [];
  for await (const key of stream) {
    keys.push(key);
  }
  return keys;
}

function makeMockClient(handler?: (command: any) => unknown | Promise<unknown>) {
  const calls: Array<{ command: string; input: unknown }> = [];
  const send = mock(async (command: any) => {
    calls.push({ command: command.constructor.name, input: command.input });
    return await (handler?.(command) ?? {});
  });
  return { send, destroy: mock(() => {}), calls };
}

describe('ScyllaMapStore', () => {
  const baseConfig = {
    endpoint: 'http://localhost:8000',
    tableName: 'helios_mapstore',
    bucketCount: 8,
    autoCreateTable: false,
  };

  test('store(k, v) issues PutItem with bucketed key and serialized value', async () => {
    const client = makeMockClient();
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');
    await store.store('ord-1', { side: 'buy' });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.command).toBe('PutItemCommand');
    const input = client.calls[0]?.input as any;
    expect(input.TableName).toBe('helios_mapstore');
    expect(input.Item.entry_key.S).toBe('ord-1');
    expect(input.Item.entry_value.S).toBe('{"side":"buy"}');
    expect(input.Item.bucket_key.S.startsWith('orders#')).toBe(true);
  });

  test('load(k) returns null when item is missing', async () => {
    const client = makeMockClient(() => ({ Item: undefined }));
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.load('missing')).resolves.toBeNull();
    expect(client.calls[0]?.command).toBe('GetItemCommand');
  });

  test('load(k) deserializes entry_value', async () => {
    const client = makeMockClient(() => ({
      Item: {
        entry_value: { S: '{"qty":5}' },
      },
    }));
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.load('ord-1')).resolves.toEqual({ qty: 5 });
  });

  test('storeAll(Map) chunks writes into BatchWriteItem requests', async () => {
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 30; i++) {
      entries.set(`ord-${i}`, { i });
    }

    await store.storeAll(entries);

    expect(client.calls.filter((call) => call.command === 'BatchWriteItemCommand')).toHaveLength(2);
  });

  test('deleteAll(keys) chunks writes into BatchWriteItem requests', async () => {
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.deleteAll(Array.from({ length: 26 }, (_, i) => `ord-${i}`));

    expect(client.calls.filter((call) => call.command === 'BatchWriteItemCommand')).toHaveLength(2);
  });

  test('loadAll(keys) uses BatchGetItem and returns keyed map', async () => {
    const client = makeMockClient(() => ({
      Responses: {
        helios_mapstore: [
          { entry_key: { S: 'ord-1' }, entry_value: { S: '{"price":10}' } },
          { entry_key: { S: 'ord-2' }, entry_value: { S: '{"price":20}' } },
        ],
      },
    }));
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const result = await store.loadAll(['ord-1', 'ord-2']);
    expect(client.calls[0]?.command).toBe('BatchGetItemCommand');
    expect(result).toEqual(new Map([
      ['ord-1', { price: 10 }],
      ['ord-2', { price: 20 }],
    ]));
  });

  test('loadAll(keys) retries unprocessed keys until complete', async () => {
    let calls = 0;
    const client = makeMockClient(() => {
      calls += 1;
      if (calls === 1) {
        return {
          Responses: {
            helios_mapstore: [
              { entry_key: { S: 'ord-1' }, entry_value: { S: '{"price":10}' } },
            ],
          },
          UnprocessedKeys: {
            helios_mapstore: {
              Keys: [{ bucket_key: { S: 'orders#0' }, entry_key: { S: 'ord-2' } }],
            },
          },
        };
      }
      return {
        Responses: {
          helios_mapstore: [
            { entry_key: { S: 'ord-2' }, entry_value: { S: '{"price":20}' } },
          ],
        },
      };
    });
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const result = await store.loadAll(['ord-1', 'ord-2']);

    expect(client.calls.filter((call) => call.command === 'BatchGetItemCommand')).toHaveLength(2);
    expect(result).toEqual(new Map([
      ['ord-1', { price: 10 }],
      ['ord-2', { price: 20 }],
    ]));
  });

  test('loadAllKeys() queries every bucket and paginates within a bucket', async () => {
    const perBucketPages = new Map<number, number>();
    const client = makeMockClient((command) => {
      const bucketKey = command.input.ExpressionAttributeValues[':bucketKey'].S as string;
      const bucket = Number(bucketKey.split('#').at(-1));
      const page = (perBucketPages.get(bucket) ?? 0) + 1;
      perBucketPages.set(bucket, page);

      if (bucket === 0 && page === 1) {
        return {
          Items: [{ entry_key: { S: 'ord-a' } }],
          LastEvaluatedKey: { bucket_key: { S: bucketKey }, entry_key: { S: 'ord-a' } },
        };
      }
      if (bucket === 0 && page === 2) {
        return {
          Items: [{ entry_key: { S: 'ord-b' } }],
        };
      }
      if (bucket === 3) {
        return {
          Items: [{ entry_key: { S: 'ord-c' } }],
        };
      }
      return { Items: [] };
    });
    const store = new ScyllaMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const keys = await collectKeys(await store.loadAllKeys());
    expect(client.calls.filter((call) => call.command === 'QueryCommand')).toHaveLength(9);
    expect(keys.sort()).toEqual(['ord-a', 'ord-b', 'ord-c']);
  });

  test('init() creates the table when autoCreateTable is enabled and describe misses', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'DescribeTableCommand') {
        const error = new Error('missing');
        (error as Error & { name?: string }).name = 'ResourceNotFoundException';
        throw error;
      }
      return {};
    });
    const store = new ScyllaMapStore({ ...baseConfig, autoCreateTable: true }, client as any);

    await store.init(new Map(), 'orders');

    expect(client.calls.map((call) => call.command)).toEqual([
      'DescribeTableCommand',
      'CreateTableCommand',
    ]);
  });

  test('init() tolerates table creation races', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'DescribeTableCommand') {
        const error = new Error('missing');
        (error as Error & { name?: string }).name = 'ResourceNotFoundException';
        throw error;
      }
      if (command.constructor.name === 'CreateTableCommand') {
        const error = new Error('exists');
        (error as Error & { name?: string }).name = 'ResourceInUseException';
        throw error;
      }
      return {};
    });
    const store = new ScyllaMapStore({ ...baseConfig, autoCreateTable: true }, client as any);

    await expect(store.init(new Map(), 'orders')).resolves.toBeUndefined();
  });

  test('destroy() closes injected client only when owned by store is false', async () => {
    const client = makeMockClient();
    const store = new ScyllaMapStore(baseConfig, client as any);

    await store.destroy();

    expect(client.destroy).not.toHaveBeenCalled();
  });

  test('constructor requires at least one endpoint when client is not injected', () => {
    expect(() => new ScyllaMapStore({ autoCreateTable: false } as any)).toThrow(
      'ScyllaMapStore requires endpoint or endpoints',
    );
  });
});
