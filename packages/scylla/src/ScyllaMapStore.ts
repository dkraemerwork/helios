import {
  BatchGetItemCommand,
  BatchWriteItemCommand,
  CreateTableCommand,
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
  type DynamoDBClientConfig,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { EndpointStrategy, ScyllaConfig, Serializer } from './ScyllaConfig.js';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TABLE_NAME = 'helios_mapstore';
const DEFAULT_BUCKET_COUNT = 64;
const BATCH_WRITE_CHUNK_SIZE = 25;
const BATCH_GET_CHUNK_SIZE = 100;

const defaultSerializer: Serializer<unknown> = {
  serialize: (v) => JSON.stringify(v),
  deserialize: (s) => JSON.parse(s) as unknown,
};

interface KeyParts {
  bucketKey: string;
  entryKey: string;
}

/**
 * DynamoDB-compatible MapStore for Helios, with Scylla/Alternator as the
 * initial target backend.
 *
 * Table schema:
 *   - partition key: bucket_key (S)
 *   - sort key: entry_key (S)
 *
 * Values are stored as serialized strings in `entry_value`.
 */
export class ScyllaMapStore<T = unknown> {
  readonly _tableName: string;
  readonly _bucketCount: number;
  readonly _serializer: Serializer<T>;
  readonly _consistentRead: boolean;
  readonly _autoCreateTable: boolean;
  private _clients: DynamoDBClient[];
  private _endpointStrategy: EndpointStrategy;
  private _clientIndex = 0;
  private _mapName: string | undefined;
  private _ownsClient: boolean;

  constructor(config: ScyllaConfig<T>, client?: DynamoDBClient) {
    this._tableName = config.tableName ?? DEFAULT_TABLE_NAME;
    this._bucketCount = Math.max(1, config.bucketCount ?? DEFAULT_BUCKET_COUNT);
    this._serializer = (config.serializer ?? defaultSerializer) as Serializer<T>;
    this._consistentRead = config.consistentRead ?? false;
    this._autoCreateTable = config.autoCreateTable ?? true;
    this._endpointStrategy = config.endpointStrategy ?? 'single';
    this._clients = client !== undefined ? [client] : this._createClients(config);
    this._ownsClient = client === undefined;
  }

  private _createClients(config: ScyllaConfig<T>): DynamoDBClient[] {
    const endpoints = this._resolveEndpoints(config);
    return endpoints.map((endpoint) => this._createClient(config, endpoint));
  }

  private _resolveEndpoints(config: ScyllaConfig<T>): string[] {
    const endpoints = config.endpoints?.filter((endpoint) => endpoint.length > 0) ?? [];
    if (config.endpoint !== undefined) {
      endpoints.unshift(config.endpoint);
    }
    if (endpoints.length === 0) {
      throw new Error('ScyllaMapStore requires endpoint or endpoints');
    }
    return [...new Set(endpoints)];
  }

  private _createClient(config: ScyllaConfig<T>, endpoint: string): DynamoDBClient {
    const clientConfig: DynamoDBClientConfig = {
      endpoint,
      region: config.region ?? DEFAULT_REGION,
    };
    if (config.credentials !== undefined) {
      clientConfig.credentials = config.credentials;
    }
    return new DynamoDBClient(clientConfig);
  }

  private _client(): DynamoDBClient {
    const client = this._clients[this._clientIndex];
    if (client === undefined) {
      throw new Error('ScyllaMapStore has no DynamoDB-compatible clients configured');
    }
    if (this._clients.length > 1 && this._endpointStrategy === 'round-robin') {
      this._clientIndex = (this._clientIndex + 1) % this._clients.length;
    }
    return client;
  }

  private _requireMapName(): string {
    if (this._mapName === undefined) {
      throw new Error('ScyllaMapStore used before init() completed');
    }
    return this._mapName;
  }

  private _bucketForKey(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    }
    return hash % this._bucketCount;
  }

  private _keyParts(key: string): KeyParts {
    const mapName = this._requireMapName();
    const bucket = this._bucketForKey(key);
    return {
      bucketKey: `${mapName}#${bucket}`,
      entryKey: key,
    };
  }

  private _itemForValue(key: string, value: T): Record<string, AttributeValue> {
    const parts = this._keyParts(key);
    return {
      bucket_key: { S: parts.bucketKey },
      entry_key: { S: parts.entryKey },
      entry_value: { S: this._serializer.serialize(value) },
      updated_at: { N: `${Date.now()}` },
    };
  }

  private _tableKey(key: string): Record<string, AttributeValue> {
    const parts = this._keyParts(key);
    return {
      bucket_key: { S: parts.bucketKey },
      entry_key: { S: parts.entryKey },
    };
  }

  private async _ensureTableExists(): Promise<void> {
    try {
      await this._client().send(new DescribeTableCommand({ TableName: this._tableName }));
      return;
    } catch (error: unknown) {
      const code = this._errorCode(error);
      if (code !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    try {
      await this._client().send(new CreateTableCommand({
        TableName: this._tableName,
        AttributeDefinitions: [
          { AttributeName: 'bucket_key', AttributeType: 'S' },
          { AttributeName: 'entry_key', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'bucket_key', KeyType: 'HASH' },
          { AttributeName: 'entry_key', KeyType: 'RANGE' },
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1,
        },
      }));
    } catch (error: unknown) {
      if (this._errorCode(error) !== 'ResourceInUseException') {
        throw error;
      }
    }
  }

  private _errorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    return (error as Error & { name?: string; Code?: string }).name
      ?? (error as Error & { Code?: string }).Code;
  }

  private async _retryUnprocessedWrites(requests: WriteRequest[]): Promise<void> {
    let pending = requests;
    while (pending.length > 0) {
      const result = await this._client().send(new BatchWriteItemCommand({
        RequestItems: {
          [this._tableName]: pending,
        },
      }));
      pending = result.UnprocessedItems?.[this._tableName] ?? [];
    }
  }

  private async _batchGetChunk(keys: string[]): Promise<Array<Record<string, AttributeValue>>> {
    const items: Array<Record<string, AttributeValue>> = [];
    let pendingKeys = keys.map((key) => this._tableKey(key));

    while (pendingKeys.length > 0) {
      const response = await this._client().send(new BatchGetItemCommand({
        RequestItems: {
          [this._tableName]: {
            Keys: pendingKeys,
            ConsistentRead: this._consistentRead,
            ProjectionExpression: 'entry_key, entry_value',
          },
        },
      }));

      items.push(...(response.Responses?.[this._tableName] ?? []));
      pendingKeys = response.UnprocessedKeys?.[this._tableName]?.Keys ?? [];
    }

    return items;
  }

  // MapLoaderLifecycleSupport

  async init(_properties: Map<string, string>, mapName: string): Promise<void> {
    this._mapName = mapName;
    if (this._autoCreateTable) {
      await this._ensureTableExists();
    }
  }

  async destroy(): Promise<void> {
    if (this._ownsClient) {
      for (const client of this._clients) {
        client.destroy();
      }
    }
  }

  // MapStore

  async store(key: string, value: T): Promise<void> {
    await this._client().send(new PutItemCommand({
      TableName: this._tableName,
      Item: this._itemForValue(key, value),
    }));
  }

  async storeAll(entries: Map<string, T>): Promise<void> {
    const items = Array.from(entries.entries()).map(([key, value]) => ({
      PutRequest: { Item: this._itemForValue(key, value) },
    }));

    for (let i = 0; i < items.length; i += BATCH_WRITE_CHUNK_SIZE) {
      await this._retryUnprocessedWrites(items.slice(i, i + BATCH_WRITE_CHUNK_SIZE));
    }
  }

  async delete(key: string): Promise<void> {
    await this._client().send(new DeleteItemCommand({
      TableName: this._tableName,
      Key: this._tableKey(key),
    }));
  }

  async deleteAll(keys: string[]): Promise<void> {
    const requests = keys.map((key) => ({
      DeleteRequest: { Key: this._tableKey(key) },
    }));

    for (let i = 0; i < requests.length; i += BATCH_WRITE_CHUNK_SIZE) {
      await this._retryUnprocessedWrites(requests.slice(i, i + BATCH_WRITE_CHUNK_SIZE));
    }
  }

  // MapLoader

  async load(key: string): Promise<T | null> {
    const result = await this._client().send(new GetItemCommand({
      TableName: this._tableName,
      Key: this._tableKey(key),
      ConsistentRead: this._consistentRead,
      ProjectionExpression: 'entry_value',
    }));
    const raw = result.Item?.entry_value?.S;
    return raw === undefined ? null : this._serializer.deserialize(raw);
  }

  async loadAll(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    for (let i = 0; i < keys.length; i += BATCH_GET_CHUNK_SIZE) {
      const chunk = keys.slice(i, i + BATCH_GET_CHUNK_SIZE);
      for (const item of await this._batchGetChunk(chunk)) {
        const itemKey = item.entry_key?.S;
        const rawValue = item.entry_value?.S;
        if (itemKey !== undefined && rawValue !== undefined) {
          result.set(itemKey, this._serializer.deserialize(rawValue));
        }
      }
    }

    return result;
  }

  async loadAllKeys(): Promise<MapKeyStream<string>> {
    const keys: string[] = [];

    for (let bucket = 0; bucket < this._bucketCount; bucket++) {
      let exclusiveStartKey: Record<string, AttributeValue> | undefined;
      do {
        const response = await this._client().send(new QueryCommand({
          TableName: this._tableName,
          KeyConditionExpression: 'bucket_key = :bucketKey',
          ExpressionAttributeValues: {
            ':bucketKey': { S: `${this._requireMapName()}#${bucket}` },
          },
          ProjectionExpression: 'entry_key',
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: this._consistentRead,
        }));

        for (const item of response.Items ?? []) {
          const entryKey = item.entry_key?.S;
          if (entryKey !== undefined) {
            keys.push(entryKey);
          }
        }
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);
    }

    return MapKeyStream.fromIterable(keys);
  }

  static factory<T>(
    baseConfig: ScyllaConfig<T>,
  ): { newMapStore(mapName: string, properties: Map<string, string>): ScyllaMapStore<T> } {
    return {
      newMapStore(): ScyllaMapStore<T> {
        return new ScyllaMapStore<T>(baseConfig);
      },
    };
  }
}
