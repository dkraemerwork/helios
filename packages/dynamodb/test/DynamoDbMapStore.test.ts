import { describe, expect, mock, test } from 'bun:test';
import type { DynamoDbMapStoreMetrics } from '../src/DynamoDbConfig.js';
import { DynamoDbMapStore } from '../src/DynamoDbMapStore.js';

async function collectKeys<K>(stream: AsyncIterable<K>): Promise<K[]> {
  const keys: K[] = [];
  for await (const key of stream) {
    keys.push(key);
  }
  return keys;
}

function makeMockClient(handler?: (command: any) => unknown | Promise<unknown>) {
  const calls: Array<{ command: string; input: unknown }> = [];
  const send = mock(async (command: any, _options?: any) => {
    const name = command.constructor.name;
    calls.push({ command: name, input: command.input });

    // Auto-handle metadata commands unless the handler explicitly handles them
    if (name === 'GetItemCommand' && (command.input as any)?.Key?.bucket_key?.S?.startsWith('_meta#')) {
      return handler ? await handler(command) : {};
    }
    if (name === 'PutItemCommand' && (command.input as any)?.Item?.bucket_key?.S?.startsWith('_meta#')) {
      return handler ? await handler(command) : {};
    }

    return await (handler?.(command) ?? {});
  });
  return { send, destroy: mock(() => {}), calls };
}

/** Filter out metadata commands from recorded calls for cleaner assertions. */
function nonMetaCalls(calls: Array<{ command: string; input: unknown }>): Array<{ command: string; input: unknown }> {
  return calls.filter((c) => {
    const input = c.input as any;
    const bucketKey = input?.Key?.bucket_key?.S ?? input?.Item?.bucket_key?.S;
    return !bucketKey?.startsWith('_meta#');
  });
}

describe('DynamoDbMapStore', () => {
  const baseConfig = {
    endpoint: 'http://localhost:8000',
    tableName: 'helios_mapstore',
    bucketCount: 8,
    autoCreateTable: false,
  };

  test('store(k, v) issues PutItem with bucketed key and serialized value', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');
    await store.store('ord-1', { side: 'buy' });

    const dataCalls = nonMetaCalls(client.calls);
    expect(dataCalls).toHaveLength(1);
    expect(dataCalls[0]?.command).toBe('PutItemCommand');
    const input = dataCalls[0]?.input as any;
    expect(input.TableName).toBe('helios_mapstore');
    expect(input.Item.entry_key.S).toBe('ord-1');
    expect(input.Item.entry_value.S).toBe('{"side":"buy"}');
    expect(input.Item.bucket_key.S.startsWith('orders#')).toBe(true);
  });

  test('load(k) returns null when item is missing', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: undefined };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.load('missing')).resolves.toBeNull();
    const dataCalls = nonMetaCalls(client.calls);
    expect(dataCalls[0]?.command).toBe('GetItemCommand');
  });

  test('load(k) deserializes entry_value', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: { entry_value: { S: '{"qty":5}' } } };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.load('ord-1')).resolves.toEqual({ qty: 5 });
  });

  test('storeAll(Map) chunks writes into BatchWriteItem requests', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchWriteItemCommand') return { UnprocessedItems: {} };
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');
    const entries = new Map<string, unknown>();
    for (let i = 0; i < 30; i++) {
      entries.set(`ord-${i}`, { i });
    }

    await store.storeAll(entries);

    expect(client.calls.filter((call) => call.command === 'BatchWriteItemCommand')).toHaveLength(2);
  });

  test('deleteAll(keys) chunks writes into BatchWriteItem requests', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchWriteItemCommand') return { UnprocessedItems: {} };
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.deleteAll(Array.from({ length: 26 }, (_, i) => `ord-${i}`));

    expect(client.calls.filter((call) => call.command === 'BatchWriteItemCommand')).toHaveLength(2);
  });

  test('loadAll(keys) uses BatchGetItem and returns keyed map', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchGetItemCommand') {
        return {
          Responses: {
            helios_mapstore: [
              { entry_key: { S: 'ord-1' }, entry_value: { S: '{"price":10}' } },
              { entry_key: { S: 'ord-2' }, entry_value: { S: '{"price":20}' } },
            ],
          },
        };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const result = await store.loadAll(['ord-1', 'ord-2']);
    const dataCalls = nonMetaCalls(client.calls);
    expect(dataCalls[0]?.command).toBe('BatchGetItemCommand');
    expect(result).toEqual(new Map([
      ['ord-1', { price: 10 }],
      ['ord-2', { price: 20 }],
    ]));
  });

  test('loadAll(keys) retries unprocessed keys until complete', async () => {
    let batchGetCalls = 0;
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchGetItemCommand') {
        batchGetCalls += 1;
        if (batchGetCalls === 1) {
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
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
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
      if (command.constructor.name !== 'QueryCommand') return {};
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
    const store = new DynamoDbMapStore(baseConfig, client as any);
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
    const store = new DynamoDbMapStore({ ...baseConfig, autoCreateTable: true }, client as any);

    await store.init(new Map(), 'orders');

    expect(client.calls.map((call) => call.command)).toEqual([
      'DescribeTableCommand',
      'CreateTableCommand',
      'GetItemCommand',
      'PutItemCommand',
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
    const store = new DynamoDbMapStore({ ...baseConfig, autoCreateTable: true }, client as any);

    await expect(store.init(new Map(), 'orders')).resolves.toBeUndefined();

    // Should have attempted table creation, then stored metadata
    expect(client.calls.map((call) => call.command)).toEqual([
      'DescribeTableCommand',
      'CreateTableCommand',
      'GetItemCommand',
      'PutItemCommand',
    ]);
  });

  test('destroy() closes injected client only when owned by store is false', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);

    await store.destroy();

    expect(client.destroy).not.toHaveBeenCalled();
  });

  test('constructor requires at least one endpoint when client is not injected', () => {
    expect(() => new DynamoDbMapStore({ autoCreateTable: false } as any)).toThrow(
      'DynamoDbMapStore requires endpoint or endpoints',
    );
  });

  // ── Step 3/5: Config validation ──────────────────────────────────────

  test('constructor rejects negative requestTimeoutMs', () => {
    expect(() => new DynamoDbMapStore({ ...baseConfig, requestTimeoutMs: 0 })).toThrow(
      'requestTimeoutMs must be greater than 0',
    );
    expect(() => new DynamoDbMapStore({ ...baseConfig, requestTimeoutMs: -1 })).toThrow(
      'requestTimeoutMs must be greater than 0',
    );
  });

  test('constructor rejects negative maxRetries', () => {
    expect(() => new DynamoDbMapStore({ ...baseConfig, maxRetries: -1 })).toThrow(
      'maxRetries must be >= 0',
    );
  });

  test('constructor rejects negative retryBaseDelayMs', () => {
    expect(() => new DynamoDbMapStore({ ...baseConfig, retryBaseDelayMs: -1 })).toThrow(
      'retryBaseDelayMs must be >= 0',
    );
  });

  test('constructor rejects retryMaxDelayMs < retryBaseDelayMs', () => {
    expect(() => new DynamoDbMapStore({
      ...baseConfig,
      retryBaseDelayMs: 500,
      retryMaxDelayMs: 100,
    })).toThrow('retryMaxDelayMs must be >= retryBaseDelayMs');
  });

  test('constructor accepts valid retry and timeout config', () => {
    const client = makeMockClient();
    expect(() => new DynamoDbMapStore({
      ...baseConfig,
      requestTimeoutMs: 10_000,
      maxRetries: 5,
      retryBaseDelayMs: 200,
      retryMaxDelayMs: 3000,
    }, client as any)).not.toThrow();
  });

  // ── Step 4: clear() ──────────────────────────────────────────────────

  test('clear() queries all buckets and deletes entries', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues[':bk'].S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 2) {
          return {
            Items: [
              { bucket_key: { S: bucketKey }, entry_key: { S: 'k1' } },
              { bucket_key: { S: bucketKey }, entry_key: { S: 'k2' } },
            ],
          };
        }
        if (bucket === 5) {
          return {
            Items: [
              { bucket_key: { S: bucketKey }, entry_key: { S: 'k3' } },
            ],
          };
        }
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    const queries = client.calls.filter((c) => c.command === 'QueryCommand');
    expect(queries).toHaveLength(8); // one per bucket

    const batchWrites = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchWrites).toHaveLength(2); // bucket 2 has 2 items (1 batch), bucket 5 has 1 item (1 batch)

    // Verify delete requests contain the right keys
    const allDeleteKeys = batchWrites.flatMap((call) => {
      const input = call.input as any;
      return input.RequestItems.helios_mapstore.map(
        (req: any) => req.DeleteRequest.Key.entry_key.S,
      );
    });
    expect(allDeleteKeys.sort()).toEqual(['k1', 'k2', 'k3']);

    // clear() also removes the metadata item
    const deleteCalls = client.calls.filter((c) => c.command === 'DeleteItemCommand');
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]?.input as any).Key.bucket_key.S).toBe('_meta#orders');
  });

  test('clear() paginates within a bucket', async () => {
    let queryCount = 0;
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues[':bk'].S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 0) {
          queryCount++;
          if (queryCount === 1) {
            return {
              Items: [{ bucket_key: { S: bucketKey }, entry_key: { S: 'page1-item' } }],
              LastEvaluatedKey: { bucket_key: { S: bucketKey }, entry_key: { S: 'page1-item' } },
            };
          }
          return {
            Items: [{ bucket_key: { S: bucketKey }, entry_key: { S: 'page2-item' } }],
          };
        }
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    // Bucket 0 should have 2 query pages, other 7 buckets have 1 each = 9 total
    const queries = client.calls.filter((c) => c.command === 'QueryCommand');
    expect(queries).toHaveLength(9);

    const batchWrites = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchWrites).toHaveLength(2); // one per page of bucket 0
  });

  // ── Step 5: Bounded retries ──────────────────────────────────────────

  test('_retryUnprocessedWrites throws after maxRetries exceeded', async () => {
    const client = makeMockClient(() => ({
      UnprocessedItems: {
        helios_mapstore: [
          { PutRequest: { Item: { bucket_key: { S: 'b#0' }, entry_key: { S: 'k1' }, entry_value: { S: '"v"' } } } },
        ],
      },
    }));
    const store = new DynamoDbMapStore(
      { ...baseConfig, maxRetries: 2, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
      client as any,
    );
    await store.init(new Map(), 'orders');

    // storeAll triggers _retryUnprocessedWrites internally
    await expect(store.storeAll(new Map([['x', 'v']]))).rejects.toThrow(
      /failed to process 1 write\(s\) after 2 retries/,
    );

    // attempt 0 (initial) sends, attempt 1 sends (< maxRetries=2), attempt 2 throws (>= maxRetries=2)
    // So 2 total BatchWriteItem calls before the error is thrown on the 3rd loop entry
    const batchCalls = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchCalls).toHaveLength(2);
  });

  test('_batchGetChunk throws after maxRetries exceeded for unprocessed keys', async () => {
    let callCount = 0;
    const client = makeMockClient(() => {
      callCount++;
      return {
        Responses: { helios_mapstore: [] },
        UnprocessedKeys: {
          helios_mapstore: {
            Keys: [{ bucket_key: { S: 'orders#0' }, entry_key: { S: 'k1' } }],
          },
        },
      };
    });
    const store = new DynamoDbMapStore(
      { ...baseConfig, maxRetries: 3, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await expect(store.loadAll(['k1'])).rejects.toThrow(
      /failed to process 1 read\(s\) after 3 retries/,
    );

    // attempt 0 sends, attempt 1 sends, attempt 2 sends, attempt 3 throws = 3 total calls
    const getCalls = client.calls.filter((c) => c.command === 'BatchGetItemCommand');
    expect(getCalls).toHaveLength(3);
  });

  // ── Step 5: _send passes abortSignal ─────────────────────────────────

  test('_send passes abortSignal to client.send', async () => {
    let capturedOptions: any;
    const send = mock(async (command: any, options?: any) => {
      // Only capture options for non-metadata commands
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any)?.Key?.bucket_key?.S?.startsWith('_meta#')) {
        capturedOptions = options;
        return { Item: { entry_value: { S: '"hello"' } } };
      }
      return {};
    });
    const client = { send, destroy: mock(() => {}) };
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.load('k1');

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.abortSignal).toBeInstanceOf(AbortSignal);
  });

  // ── Step 6: Streaming loadAllKeys() ──────────────────────────────────

  test('loadAllKeys() truly streams via async generator (lazy evaluation)', async () => {
    let queryCallCount = 0;
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        queryCallCount++;
        const bucketKey = command.input.ExpressionAttributeValues?.[':bucketKey']?.S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 0) {
          return { Items: [{ entry_key: { S: 'first-key' } }] };
        }
        if (bucket === 1) {
          return { Items: [{ entry_key: { S: 'second-key' } }] };
        }
        return { Items: [] };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const stream = await store.loadAllKeys();

    // Before iteration begins, no queries should have been made yet
    // (the generator hasn't been advanced)
    expect(queryCallCount).toBe(0);

    // Now consume just the first key
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toBe('first-key');
    // Only bucket 0 should have been queried so far
    expect(queryCallCount).toBe(1);

    // Consume the rest
    const remaining: string[] = [];
    let result = await iterator.next();
    while (!result.done) {
      remaining.push(result.value as string);
      result = await iterator.next();
    }
    expect(remaining).toContain('second-key');
    // All 8 buckets should now have been queried
    expect(queryCallCount).toBe(8);
  });

  // ── Step 7: Edge-case tests ────────────────────────────────────────────

  // 1. Empty batch operations

  test('storeAll(empty map) issues no BatchWriteItem calls', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.storeAll(new Map());

    expect(client.calls.filter((c) => c.command === 'BatchWriteItemCommand')).toHaveLength(0);
  });

  test('deleteAll(empty array) issues no BatchWriteItem calls', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.deleteAll([]);

    expect(client.calls.filter((c) => c.command === 'BatchWriteItemCommand')).toHaveLength(0);
  });

  test('loadAll(empty array) returns empty Map without any BatchGetItem calls', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const result = await store.loadAll([]);

    expect(result).toEqual(new Map());
    expect(client.calls.filter((c) => c.command === 'BatchGetItemCommand')).toHaveLength(0);
  });

  // 2. Duplicate keys in batch input

  test('loadAll with duplicate keys issues request containing both', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchGetItemCommand') {
        return {
          Responses: {
            helios_mapstore: [
              { entry_key: { S: 'k1' }, entry_value: { S: '{"v":1}' } },
            ],
          },
        };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const result = await store.loadAll(['k1', 'k1']);

    const batchCalls = client.calls.filter((c) => c.command === 'BatchGetItemCommand');
    expect(batchCalls[0]?.command).toBe('BatchGetItemCommand');
    const input = batchCalls[0]?.input as any;
    // DynamoDB may deduplicate on its side, but we send both keys
    expect(input.RequestItems.helios_mapstore.Keys).toHaveLength(2);
    expect(result.get('k1')).toEqual({ v: 1 });
  });

  test('storeAll with single entry issues single PutRequest in batch', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'BatchWriteItemCommand') return { UnprocessedItems: {} };
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.storeAll(new Map([['k1', { data: 'hello' }]]));

    const batchCalls = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchCalls).toHaveLength(1);
    const input = batchCalls[0]?.input as any;
    expect(input.RequestItems.helios_mapstore).toHaveLength(1);
    expect(input.RequestItems.helios_mapstore[0].PutRequest.Item.entry_key.S).toBe('k1');
  });

  // 3. Serializer failure propagation

  test('store() propagates serializer.serialize error', async () => {
    const client = makeMockClient();
    const failingSerializer = {
      serialize: () => { throw new Error('serialize boom'); },
      deserialize: (s: string) => JSON.parse(s),
    };
    const store = new DynamoDbMapStore(
      { ...baseConfig, serializer: failingSerializer },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await expect(store.store('k1', 'value')).rejects.toThrow('serialize boom');
    expect(nonMetaCalls(client.calls)).toHaveLength(0);
  });

  test('load() propagates serializer.deserialize error', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: { entry_value: { S: 'some-raw-value' } } };
      }
      return {};
    });
    const failingSerializer = {
      serialize: (v: unknown) => JSON.stringify(v),
      deserialize: () => { throw new Error('deserialize boom'); },
    };
    const store = new DynamoDbMapStore(
      { ...baseConfig, serializer: failingSerializer },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await expect(store.load('k1')).rejects.toThrow('deserialize boom');
  });

  // 4. Consistent-read flag propagation

  test('load() passes ConsistentRead: true when configured', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: undefined };
      }
      return {};
    });
    const store = new DynamoDbMapStore(
      { ...baseConfig, consistentRead: true },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await store.load('k1');

    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'GetItemCommand');
    const input = dataCalls[0]?.input as any;
    expect(input.ConsistentRead).toBe(true);
  });

  test('load() passes ConsistentRead: false when configured', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: undefined };
      }
      return {};
    });
    const store = new DynamoDbMapStore(
      { ...baseConfig, consistentRead: false },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await store.load('k1');

    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'GetItemCommand');
    const input = dataCalls[0]?.input as any;
    expect(input.ConsistentRead).toBe(false);
  });

  // 5. Bucket hashing determinism

  test('same key always maps to the same bucket_key', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.store('deterministic-key', { a: 1 });
    await store.store('deterministic-key', { a: 2 });

    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'PutItemCommand');
    const bucket1 = (dataCalls[0]?.input as any).Item.bucket_key.S;
    const bucket2 = (dataCalls[1]?.input as any).Item.bucket_key.S;
    expect(bucket1).toBe(bucket2);
  });

  test('different keys can map to different buckets', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    // Store enough keys that at least two land in different buckets
    const keys = Array.from({ length: 50 }, (_, i) => `key-${i}`);
    for (const key of keys) {
      await store.store(key, { key });
    }

    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'PutItemCommand');
    const bucketKeys = new Set(
      dataCalls.map((c) => (c.input as any).Item.bucket_key.S as string),
    );
    expect(bucketKeys.size).toBeGreaterThan(1);
  });

  // 6. Map isolation across multiple map names in one table

  test('two stores with different mapNames produce distinct bucket_key prefixes', async () => {
    const clientA = makeMockClient();
    const storeA = new DynamoDbMapStore(baseConfig, clientA as any);
    await storeA.init(new Map(), 'mapA');

    const clientB = makeMockClient();
    const storeB = new DynamoDbMapStore(baseConfig, clientB as any);
    await storeB.init(new Map(), 'mapB');

    await storeA.store('shared-key', { from: 'A' });
    await storeB.store('shared-key', { from: 'B' });

    const dataCallsA = nonMetaCalls(clientA.calls).filter((c) => c.command === 'PutItemCommand');
    const dataCallsB = nonMetaCalls(clientB.calls).filter((c) => c.command === 'PutItemCommand');
    const bucketA = (dataCallsA[0]?.input as any).Item.bucket_key.S as string;
    const bucketB = (dataCallsB[0]?.input as any).Item.bucket_key.S as string;

    expect(bucketA.startsWith('mapA#')).toBe(true);
    expect(bucketB.startsWith('mapB#')).toBe(true);
    // Same key, same hash → same bucket number, but different prefix
    const bucketNumA = bucketA.split('#')[1];
    const bucketNumB = bucketB.split('#')[1];
    expect(bucketNumA).toBe(bucketNumB); // same hash for same key
    expect(bucketA).not.toBe(bucketB); // different full bucket_key
  });

  // 7. Streaming loadAllKeys() pagination — keys from different buckets interleave

  test('loadAllKeys() interleaves keys from multiple buckets in bucket order', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues?.[':bucketKey']?.S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 0) {
          return { Items: [{ entry_key: { S: 'b0-key1' } }, { entry_key: { S: 'b0-key2' } }] };
        }
        if (bucket === 3) {
          return { Items: [{ entry_key: { S: 'b3-key1' } }] };
        }
        if (bucket === 7) {
          return { Items: [{ entry_key: { S: 'b7-key1' } }, { entry_key: { S: 'b7-key2' } }] };
        }
        return { Items: [] };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const keys = await collectKeys(await store.loadAllKeys());

    // Keys should arrive in bucket order: bucket 0, then 3, then 7
    expect(keys).toEqual(['b0-key1', 'b0-key2', 'b3-key1', 'b7-key1', 'b7-key2']);
  });

  test('loadAllKeys() stream can be aborted early without querying all buckets', async () => {
    let queryCallCount = 0;
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        queryCallCount++;
        const bucketKey = command.input.ExpressionAttributeValues?.[':bucketKey']?.S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        return {
          Items: [{ entry_key: { S: `bucket-${bucket}-key` } }],
        };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const stream = await store.loadAllKeys();
    const iterator = stream[Symbol.asyncIterator]();

    // Consume only first 2 keys, then break
    const consumed: string[] = [];
    for (let i = 0; i < 2; i++) {
      const next = await iterator.next();
      if (!next.done) consumed.push(next.value as string);
    }

    expect(consumed).toHaveLength(2);
    // Should NOT have queried all 8 buckets — at most 2
    expect(queryCallCount).toBeLessThanOrEqual(2);
  });

  // 8. Abort signal is passed to send

  test('_send passes an abortSignal to every client.send call', async () => {
    const capturedOptions: any[] = [];
    const send = mock(async (command: any, options?: any) => {
      // Skip capturing metadata commands
      const key = (command.input as any)?.Key?.bucket_key?.S ?? (command.input as any)?.Item?.bucket_key?.S;
      if (!key?.startsWith('_meta#')) {
        capturedOptions.push(options);
      }
      return {};
    });
    const client = { send, destroy: mock(() => {}) };
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.store('k1', { v: 1 });
    await store.delete('k2');

    expect(capturedOptions).toHaveLength(2);
    for (const options of capturedOptions) {
      expect(options).toBeDefined();
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    }
  });

  // 9. Bucket-count compatibility validation

  test('bucketCount: 0 is normalized to 1', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(
      { ...baseConfig, bucketCount: 0 },
      client as any,
    );
    expect(store._bucketCount).toBe(1);

    await store.init(new Map(), 'orders');
    await store.store('any-key', { v: 1 });

    // With bucketCount=1, all keys go to bucket 0
    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'PutItemCommand');
    const bucketKey = (dataCalls[0]?.input as any).Item.bucket_key.S as string;
    expect(bucketKey).toBe('orders#0');
  });

  test('bucketCount: -5 is normalized to 1', () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(
      { ...baseConfig, bucketCount: -5 },
      client as any,
    );
    expect(store._bucketCount).toBe(1);
  });

  test('bucketCount: 1 routes all keys to bucket 0', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(
      { ...baseConfig, bucketCount: 1 },
      client as any,
    );
    await store.init(new Map(), 'orders');

    const testKeys = ['alpha', 'beta', 'gamma', 'delta'];
    for (const key of testKeys) {
      await store.store(key, { key });
    }

    const dataCalls = nonMetaCalls(client.calls).filter((c) => c.command === 'PutItemCommand');
    for (const call of dataCalls) {
      const bucketKey = (call.input as any).Item.bucket_key.S as string;
      expect(bucketKey).toBe('orders#0');
    }
  });

  // 10. clear() edge cases

  test('clear() on empty map queries all buckets but issues no batch deletes', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    const queries = client.calls.filter((c) => c.command === 'QueryCommand');
    expect(queries).toHaveLength(8);
    const batchWrites = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchWrites).toHaveLength(0);
    // But the metadata item is still deleted
    const deleteCalls = client.calls.filter((c) => c.command === 'DeleteItemCommand');
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]?.input as any).Key.bucket_key.S).toBe('_meta#orders');
  });

  test('clear() with entries in only some buckets deletes only those', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues[':bk'].S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 4) {
          return {
            Items: [{ bucket_key: { S: bucketKey }, entry_key: { S: 'only-key' } }],
          };
        }
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    const queries = client.calls.filter((c) => c.command === 'QueryCommand');
    expect(queries).toHaveLength(8);
    const batchWrites = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchWrites).toHaveLength(1);

    const deleteInput = batchWrites[0]?.input as any;
    expect(deleteInput.RequestItems.helios_mapstore[0].DeleteRequest.Key.entry_key.S).toBe('only-key');
  });

  // 11. storeAll/deleteAll with exactly 25 items (batch boundary)

  test('storeAll with exactly 25 items issues exactly one BatchWriteItem', async () => {
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const entries = new Map<string, unknown>();
    for (let i = 0; i < 25; i++) {
      entries.set(`key-${i}`, { i });
    }
    await store.storeAll(entries);

    const batchCalls = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchCalls).toHaveLength(1);
    expect((batchCalls[0]?.input as any).RequestItems.helios_mapstore).toHaveLength(25);
  });

  test('deleteAll with exactly 25 items issues exactly one BatchWriteItem', async () => {
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    const keys = Array.from({ length: 25 }, (_, i) => `key-${i}`);
    await store.deleteAll(keys);

    const batchCalls = client.calls.filter((c) => c.command === 'BatchWriteItemCommand');
    expect(batchCalls).toHaveLength(1);
    expect((batchCalls[0]?.input as any).RequestItems.helios_mapstore).toHaveLength(25);
  });

  // ── Step 12: Metrics / Observability ─────────────────────────────────

  test('store() calls onOperation with correct operation name and duration > 0', async () => {
    const operationCalls: Array<{ operation: string; durationMs: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onOperation: mock((operation, durationMs) => {
        operationCalls.push({ operation, durationMs });
      }),
    };
    const client = makeMockClient();
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.store('k1', { v: 1 });

    expect(operationCalls).toHaveLength(1);
    expect(operationCalls[0]?.operation).toBe('store');
    expect(operationCalls[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('load() calls onOperation with "load"', async () => {
    const operationCalls: Array<{ operation: string; durationMs: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onOperation: mock((operation, durationMs) => {
        operationCalls.push({ operation, durationMs });
      }),
    };
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: { entry_value: { S: '"hello"' } } };
      }
      return {};
    });
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.load('k1');

    expect(operationCalls).toHaveLength(1);
    expect(operationCalls[0]?.operation).toBe('load');
    expect(operationCalls[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('delete() calls onOperation with "delete"', async () => {
    const operationCalls: Array<{ operation: string; durationMs: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onOperation: mock((operation, durationMs) => {
        operationCalls.push({ operation, durationMs });
      }),
    };
    const client = makeMockClient();
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.delete('k1');

    expect(operationCalls).toHaveLength(1);
    expect(operationCalls[0]?.operation).toBe('delete');
  });

  test('clear() calls onBatchOperation with correct item count', async () => {
    const batchCalls: Array<{ operation: string; itemCount: number; durationMs: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onBatchOperation: mock((operation, itemCount, durationMs) => {
        batchCalls.push({ operation, itemCount, durationMs });
      }),
    };
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues[':bk'].S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 1) {
          return {
            Items: [
              { bucket_key: { S: bucketKey }, entry_key: { S: 'a' } },
              { bucket_key: { S: bucketKey }, entry_key: { S: 'b' } },
            ],
          };
        }
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]?.operation).toBe('clear');
    expect(batchCalls[0]?.itemCount).toBe(2);
    expect(batchCalls[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('storeAll() calls onBatchOperation with entry count', async () => {
    const batchCalls: Array<{ operation: string; itemCount: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onBatchOperation: mock((operation, itemCount) => {
        batchCalls.push({ operation, itemCount });
      }),
    };
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.storeAll(new Map([['a', 1], ['b', 2], ['c', 3]]));

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]?.operation).toBe('storeAll');
    expect(batchCalls[0]?.itemCount).toBe(3);
  });

  test('deleteAll() calls onBatchOperation with key count', async () => {
    const batchCalls: Array<{ operation: string; itemCount: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onBatchOperation: mock((operation, itemCount) => {
        batchCalls.push({ operation, itemCount });
      }),
    };
    const client = makeMockClient(() => ({ UnprocessedItems: {} }));
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.deleteAll(['a', 'b']);

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]?.operation).toBe('deleteAll');
    expect(batchCalls[0]?.itemCount).toBe(2);
  });

  test('loadAll() calls onBatchOperation with key count', async () => {
    const batchCalls: Array<{ operation: string; itemCount: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onBatchOperation: mock((operation, itemCount) => {
        batchCalls.push({ operation, itemCount });
      }),
    };
    const client = makeMockClient(() => ({
      Responses: {
        helios_mapstore: [
          { entry_key: { S: 'a' }, entry_value: { S: '"v"' } },
        ],
      },
    }));
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await store.loadAll(['a', 'b']);

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]?.operation).toBe('loadAll');
    expect(batchCalls[0]?.itemCount).toBe(2);
  });

  test('retry exhaustion calls onRetryExhausted for batchWrite', async () => {
    const exhaustedCalls: Array<{ operation: string; totalAttempts: number; unprocessedCount: number }> = [];
    const retryCalls: Array<{ operation: string; attempt: number; unprocessedCount: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onRetryExhausted: mock((operation, totalAttempts, unprocessedCount) => {
        exhaustedCalls.push({ operation, totalAttempts, unprocessedCount });
      }),
      onRetry: mock((operation, attempt, unprocessedCount) => {
        retryCalls.push({ operation, attempt, unprocessedCount });
      }),
    };
    const client = makeMockClient(() => ({
      UnprocessedItems: {
        helios_mapstore: [
          { PutRequest: { Item: { bucket_key: { S: 'b#0' }, entry_key: { S: 'k1' }, entry_value: { S: '"v"' } } } },
        ],
      },
    }));
    const store = new DynamoDbMapStore(
      { ...baseConfig, maxRetries: 2, retryBaseDelayMs: 0, retryMaxDelayMs: 0, metrics },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await expect(store.storeAll(new Map([['x', 'v']]))).rejects.toThrow(/failed to process/);

    expect(exhaustedCalls).toHaveLength(1);
    expect(exhaustedCalls[0]?.operation).toBe('batchWrite');
    expect(exhaustedCalls[0]?.totalAttempts).toBe(2);
    expect(exhaustedCalls[0]?.unprocessedCount).toBe(1);

    // onRetry should have been called for attempt 1 (before the second send)
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0]?.operation).toBe('batchWrite');
    expect(retryCalls[0]?.attempt).toBe(1);
  });

  test('retry exhaustion calls onRetryExhausted for batchGet', async () => {
    const exhaustedCalls: Array<{ operation: string; totalAttempts: number; unprocessedCount: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onRetryExhausted: mock((operation, totalAttempts, unprocessedCount) => {
        exhaustedCalls.push({ operation, totalAttempts, unprocessedCount });
      }),
    };
    const client = makeMockClient(() => ({
      Responses: { helios_mapstore: [] },
      UnprocessedKeys: {
        helios_mapstore: {
          Keys: [{ bucket_key: { S: 'orders#0' }, entry_key: { S: 'k1' } }],
        },
      },
    }));
    const store = new DynamoDbMapStore(
      { ...baseConfig, maxRetries: 2, retryBaseDelayMs: 0, retryMaxDelayMs: 0, metrics },
      client as any,
    );
    await store.init(new Map(), 'orders');

    await expect(store.loadAll(['k1'])).rejects.toThrow(/failed to process/);

    expect(exhaustedCalls).toHaveLength(1);
    expect(exhaustedCalls[0]?.operation).toBe('batchGet');
    expect(exhaustedCalls[0]?.totalAttempts).toBe(2);
  });

  test('onError is called when _send fails', async () => {
    const errorCalls: Array<{ operation: string; error: Error }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onError: mock((operation, error) => {
        errorCalls.push({ operation, error });
      }),
    };
    const transportError = new Error('connection refused');
    const client = makeMockClient((command) => {
      // Only throw for non-metadata commands
      const key = (command.input as any)?.Key?.bucket_key?.S ?? (command.input as any)?.Item?.bucket_key?.S;
      if (key?.startsWith('_meta#')) return {};
      throw transportError;
    });
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.store('k1', 'v')).rejects.toThrow('connection refused');

    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]?.operation).toBe('PutItemCommand');
    expect(errorCalls[0]?.error).toBe(transportError);
  });

  test('loadAllKeys() calls onKeyStreamProgress after each bucket', async () => {
    const progressCalls: Array<{ bucket: number; totalBuckets: number; keysEmitted: number }> = [];
    const metrics: DynamoDbMapStoreMetrics = {
      onKeyStreamProgress: mock((bucket, totalBuckets, keysEmitted) => {
        progressCalls.push({ bucket, totalBuckets, keysEmitted });
      }),
    };
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        const bucketKey = command.input.ExpressionAttributeValues?.[':bucketKey']?.S as string;
        const bucket = Number(bucketKey.split('#').at(-1));
        if (bucket === 0) {
          return { Items: [{ entry_key: { S: 'a' } }, { entry_key: { S: 'b' } }] };
        }
        if (bucket === 3) {
          return { Items: [{ entry_key: { S: 'c' } }] };
        }
        return { Items: [] };
      }
      return {};
    });
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    const keys = await collectKeys(await store.loadAllKeys());

    expect(keys).toEqual(['a', 'b', 'c']);
    // One progress call per bucket (8 buckets)
    expect(progressCalls).toHaveLength(8);
    expect(progressCalls[0]).toEqual({ bucket: 0, totalBuckets: 8, keysEmitted: 2 });
    expect(progressCalls[3]).toEqual({ bucket: 3, totalBuckets: 8, keysEmitted: 1 });
    // Empty buckets report 0 keys
    expect(progressCalls[1]).toEqual({ bucket: 1, totalBuckets: 8, keysEmitted: 0 });
  });

  test('metrics callback errors do not break store operations', async () => {
    const metrics: DynamoDbMapStoreMetrics = {
      onOperation: () => { throw new Error('metrics boom'); },
      onBatchOperation: () => { throw new Error('metrics boom'); },
      onError: () => { throw new Error('metrics boom'); },
      onKeyStreamProgress: () => { throw new Error('metrics boom'); },
    };
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: { entry_value: { S: '"ok"' } } };
      }
      return {};
    });
    const store = new DynamoDbMapStore({ ...baseConfig, metrics }, client as any);
    await store.init(new Map(), 'orders');

    // None of these should throw despite metrics throwing
    await expect(store.store('k1', 'v')).resolves.toBeUndefined();
    await expect(store.load('k1')).resolves.toBe('ok');
    await expect(store.delete('k1')).resolves.toBeUndefined();
  });

  test('no metrics configured does not affect operations', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand' && !(command.input as any).Key.bucket_key.S.startsWith('_meta#')) {
        return { Item: { entry_value: { S: '"val"' } } };
      }
      return {};
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await expect(store.store('k1', 'v')).resolves.toBeUndefined();
    await expect(store.load('k1')).resolves.toBe('val');
    await expect(store.delete('k1')).resolves.toBeUndefined();
  });

  // ── Gap 2: TLS config ─────────────────────────────────────────────────

  test('constructor with tls config creates client without error', () => {
    const store = new DynamoDbMapStore({
      ...baseConfig,
      endpoint: 'https://localhost:8443',
      tls: { ca: 'fake-ca-pem', rejectUnauthorized: false },
    });
    expect(store).toBeDefined();
    expect(store._bucketCount).toBe(8);
  });

  test('explicit requestHandler takes precedence over tls config', () => {
    const customHandler = { handle: () => {} };
    const store = new DynamoDbMapStore({
      ...baseConfig,
      endpoint: 'https://localhost:8443',
      tls: { ca: 'fake-ca-pem', rejectUnauthorized: true },
      requestHandler: customHandler,
    });
    expect(store).toBeDefined();
  });

  test('tls config is applied when tls.enabled is true even on http endpoint', () => {
    const store = new DynamoDbMapStore({
      ...baseConfig,
      tls: { enabled: true, ca: 'my-ca-pem' },
    });
    expect(store).toBeDefined();
  });

  // ── Gap 3: bucketCount immutability ──────────────────────────────────

  test('init() stores metadata item with bucket count', async () => {
    const client = makeMockClient();
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'mymap');

    const getCalls = client.calls.filter((c) => c.command === 'GetItemCommand');
    expect(getCalls).toHaveLength(1);
    const getInput = getCalls[0]?.input as any;
    expect(getInput.Key.bucket_key.S).toBe('_meta#mymap');
    expect(getInput.Key.entry_key.S).toBe('_config');

    const putCalls = client.calls.filter((c) => c.command === 'PutItemCommand');
    expect(putCalls).toHaveLength(1);
    const putInput = putCalls[0]?.input as any;
    expect(putInput.Item.bucket_key.S).toBe('_meta#mymap');
    expect(putInput.Item.entry_key.S).toBe('_config');
    expect(JSON.parse(putInput.Item.entry_value.S)).toEqual({ bucketCount: 8 });
  });

  test('init() throws when bucket count mismatches stored metadata', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand') {
        return {
          Item: {
            bucket_key: { S: '_meta#orders' },
            entry_key: { S: '_config' },
            entry_value: { S: '{"bucketCount":32}' },
          },
        };
      }
      return {};
    });
    const store = new DynamoDbMapStore({ ...baseConfig, bucketCount: 8 }, client as any);

    await expect(store.init(new Map(), 'orders')).rejects.toThrow(
      "DynamoDbMapStore: map 'orders' was previously configured with bucketCount=32, but current config has bucketCount=8. bucketCount is immutable per persisted map. To change it, you must clear all data for this map first.",
    );
  });

  test('init() succeeds when bucket count matches stored metadata', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'GetItemCommand') {
        return {
          Item: {
            bucket_key: { S: '_meta#orders' },
            entry_key: { S: '_config' },
            entry_value: { S: '{"bucketCount":8}' },
          },
        };
      }
      return {};
    });
    const store = new DynamoDbMapStore({ ...baseConfig, bucketCount: 8 }, client as any);

    await expect(store.init(new Map(), 'orders')).resolves.toBeUndefined();

    // Should not have issued a PutItemCommand since metadata already matches
    const putCalls = client.calls.filter((c) => c.command === 'PutItemCommand');
    expect(putCalls).toHaveLength(0);
  });

  test('clear() removes the metadata item', async () => {
    const client = makeMockClient((command) => {
      if (command.constructor.name === 'QueryCommand') {
        return { Items: [] };
      }
      return { UnprocessedItems: {} };
    });
    const store = new DynamoDbMapStore(baseConfig, client as any);
    await store.init(new Map(), 'orders');

    await store.clear();

    const deleteCalls = client.calls.filter((c) => c.command === 'DeleteItemCommand');
    expect(deleteCalls).toHaveLength(1);
    const deleteInput = deleteCalls[0]?.input as any;
    expect(deleteInput.Key.bucket_key.S).toBe('_meta#orders');
    expect(deleteInput.Key.entry_key.S).toBe('_config');
  });

  // 12. Round-robin endpoint strategy

  test('round-robin strategy cycles through clients on consecutive send calls', async () => {
    const sendCalls: number[] = [];
    const clients = [0, 1, 2].map((index) => {
      const send = mock(async () => {
        sendCalls.push(index);
        return {};
      });
      return { send, destroy: mock(() => {}) };
    });

    const store = new DynamoDbMapStore(baseConfig);
    // Override internals to inject multiple mock clients
    (store as any)._clients = clients;
    (store as any)._endpointStrategy = 'round-robin';
    (store as any)._clientIndex = 0;
    (store as any)._ownsClient = false;
    await store.init(new Map(), 'orders');

    // Reset tracking and client index after init (which issues metadata commands)
    sendCalls.length = 0;
    (store as any)._clientIndex = 0;

    // Perform 6 operations to cycle through twice
    for (let i = 0; i < 6; i++) {
      await store.store(`key-${i}`, { i });
    }

    // Each client should have been used in round-robin order
    expect(sendCalls).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
