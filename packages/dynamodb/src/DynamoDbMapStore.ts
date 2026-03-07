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
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import { Agent as HttpsAgent } from 'node:https';
import type { DynamoDbConfig, DynamoDbMapStoreMetrics, EndpointStrategy, Serializer, TlsConfig } from './DynamoDbConfig.js';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TABLE_NAME = 'helios_mapstore';
const DEFAULT_BUCKET_COUNT = 64;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 5000;
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
export class DynamoDbMapStore<T = unknown> {
  readonly _tableName: string;
  readonly _bucketCount: number;
  readonly _serializer: Serializer<T>;
  readonly _consistentRead: boolean;
  readonly _autoCreateTable: boolean;
  private readonly _requestTimeoutMs: number;
  private readonly _maxRetries: number;
  private readonly _retryBaseDelayMs: number;
  private readonly _retryMaxDelayMs: number;
  private readonly _tls: TlsConfig | undefined;
  private readonly _requestHandler: unknown;
  private readonly _metrics: DynamoDbMapStoreMetrics | undefined;
  private _clients: DynamoDBClient[];
  private _endpointStrategy: EndpointStrategy;
  private _clientIndex = 0;
  private _mapName: string | undefined;
  private _ownsClient: boolean;

  constructor(config: DynamoDbConfig<T>, client?: DynamoDBClient) {
    this._tableName = config.tableName ?? DEFAULT_TABLE_NAME;
    this._bucketCount = Math.max(1, config.bucketCount ?? DEFAULT_BUCKET_COUNT);
    this._serializer = (config.serializer ?? defaultSerializer) as Serializer<T>;
    this._consistentRead = config.consistentRead ?? false;
    this._autoCreateTable = config.autoCreateTable ?? true;
    this._endpointStrategy = config.endpointStrategy ?? 'single';
    this._requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this._maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this._retryMaxDelayMs = config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this._tls = config.tls;
    this._requestHandler = config.requestHandler;
    this._metrics = config.metrics;

    if (this._tls?.rejectUnauthorized === false) {
      console.warn('DynamoDbMapStore: TLS rejectUnauthorized is set to false — this is insecure and should not be used in production');
    }

    this._validateConfig();

    this._clients = client !== undefined ? [client] : this._createClients(config);
    this._ownsClient = client === undefined;
  }

  private _validateConfig(): void {
    if (this._requestTimeoutMs <= 0) {
      throw new Error('DynamoDbMapStore: requestTimeoutMs must be greater than 0');
    }
    if (this._maxRetries < 0) {
      throw new Error('DynamoDbMapStore: maxRetries must be >= 0');
    }
    if (this._retryBaseDelayMs < 0) {
      throw new Error('DynamoDbMapStore: retryBaseDelayMs must be >= 0');
    }
    if (this._retryMaxDelayMs < this._retryBaseDelayMs) {
      throw new Error('DynamoDbMapStore: retryMaxDelayMs must be >= retryBaseDelayMs');
    }
  }

  private _createClients(config: DynamoDbConfig<T>): DynamoDBClient[] {
    const endpoints = this._resolveEndpoints(config);
    return endpoints.map((endpoint) => this._createClient(config, endpoint));
  }

  private _resolveEndpoints(config: DynamoDbConfig<T>): string[] {
    const endpoints = config.endpoints?.filter((endpoint) => endpoint.length > 0) ?? [];
    if (config.endpoint !== undefined) {
      endpoints.unshift(config.endpoint);
    }
    if (endpoints.length === 0) {
      throw new Error('DynamoDbMapStore requires endpoint or endpoints');
    }
    return [...new Set(endpoints)];
  }

  private _createClient(config: DynamoDbConfig<T>, endpoint: string): DynamoDBClient {
    const clientConfig: DynamoDBClientConfig = {
      endpoint,
      region: config.region ?? DEFAULT_REGION,
    };
    if (config.credentials !== undefined) {
      clientConfig.credentials = config.credentials;
    }
    if (this._requestHandler !== undefined) {
      clientConfig.requestHandler = this._requestHandler as any;
    } else if (this._tls !== undefined && (this._tls.enabled === true || endpoint.startsWith('https://'))) {
      const agent = new HttpsAgent({
        ca: this._tls.ca,
        rejectUnauthorized: this._tls.rejectUnauthorized ?? true,
      });
      clientConfig.requestHandler = new NodeHttpHandler({
        httpsAgent: agent,
        requestTimeout: this._requestTimeoutMs,
      });
    }
    return new DynamoDBClient(clientConfig);
  }

  private _client(): DynamoDBClient {
    const client = this._clients[this._clientIndex];
    if (client === undefined) {
      throw new Error('DynamoDbMapStore has no DynamoDB-compatible clients configured');
    }
    if (this._clients.length > 1 && this._endpointStrategy === 'round-robin') {
      this._clientIndex = (this._clientIndex + 1) % this._clients.length;
    }
    return client;
  }

  private async _send<TOutput>(command: any): Promise<TOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._requestTimeoutMs);
    try {
      return await this._client().send(command, { abortSignal: controller.signal }) as TOutput;
    } catch (error: unknown) {
      try { this._metrics?.onError?.(command.constructor?.name ?? 'unknown', error as Error); } catch { /* metrics must not break operations */ }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private _requireMapName(): string {
    if (this._mapName === undefined) {
      throw new Error('DynamoDbMapStore used before init() completed');
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
      await this._send(new DescribeTableCommand({ TableName: this._tableName }));
      return;
    } catch (error: unknown) {
      const code = this._errorCode(error);
      if (code !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    try {
      await this._send(new CreateTableCommand({
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

  private async _backoff(attempt: number): Promise<void> {
    const exponentialDelay = Math.min(
      this._retryMaxDelayMs,
      this._retryBaseDelayMs * Math.pow(2, attempt),
    );
    const jitter = Math.random() * exponentialDelay;
    await new Promise((resolve) => setTimeout(resolve, jitter));
  }

  private async _retryUnprocessedWrites(requests: WriteRequest[]): Promise<void> {
    let pending = requests;
    let attempt = 0;
    while (pending.length > 0) {
      if (attempt > 0) {
        if (attempt >= this._maxRetries) {
          try { this._metrics?.onRetryExhausted?.('batchWrite', attempt, pending.length); } catch { /* metrics must not break operations */ }
          throw new Error(
            `DynamoDbMapStore: failed to process ${pending.length} write(s) after ${this._maxRetries} retries`,
          );
        }
        try { this._metrics?.onRetry?.('batchWrite', attempt, pending.length); } catch { /* metrics must not break operations */ }
        await this._backoff(attempt);
      }
      const result = await this._send<any>(new BatchWriteItemCommand({
        RequestItems: { [this._tableName]: pending },
      }));
      pending = result.UnprocessedItems?.[this._tableName] ?? [];
      attempt++;
    }
  }

  private async _batchGetChunk(keys: string[]): Promise<Array<Record<string, AttributeValue>>> {
    const items: Array<Record<string, AttributeValue>> = [];
    let pendingKeys = keys.map((key) => this._tableKey(key));
    let attempt = 0;

    while (pendingKeys.length > 0) {
      if (attempt > 0) {
        if (attempt >= this._maxRetries) {
          try { this._metrics?.onRetryExhausted?.('batchGet', attempt, pendingKeys.length); } catch { /* metrics must not break operations */ }
          throw new Error(
            `DynamoDbMapStore: failed to process ${pendingKeys.length} read(s) after ${this._maxRetries} retries`,
          );
        }
        try { this._metrics?.onRetry?.('batchGet', attempt, pendingKeys.length); } catch { /* metrics must not break operations */ }
        await this._backoff(attempt);
      }
      const response = await this._send<any>(new BatchGetItemCommand({
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
      attempt++;
    }

    return items;
  }

  private _metadataKey(mapName: string): Record<string, AttributeValue> {
    return {
      bucket_key: { S: `_meta#${mapName}` },
      entry_key: { S: '_config' },
    };
  }

  private async _enforceBucketCountImmutability(mapName: string): Promise<void> {
    const metaKey = this._metadataKey(mapName);
    const result = await this._send<any>(new GetItemCommand({
      TableName: this._tableName,
      Key: metaKey,
      ConsistentRead: true,
    }));

    const raw = result.Item?.entry_value?.S;
    if (raw !== undefined) {
      const stored = (JSON.parse(raw) as { bucketCount: number }).bucketCount;
      if (stored !== this._bucketCount) {
        throw new Error(
          `DynamoDbMapStore: map '${mapName}' was previously configured with bucketCount=${stored}, but current config has bucketCount=${this._bucketCount}. bucketCount is immutable per persisted map. To change it, you must clear all data for this map first.`,
        );
      }
    } else {
      await this._send(new PutItemCommand({
        TableName: this._tableName,
        Item: {
          ...metaKey,
          entry_value: { S: JSON.stringify({ bucketCount: this._bucketCount }) },
        },
      }));
    }
  }

  // MapLoaderLifecycleSupport

  async init(_properties: Map<string, string>, mapName: string): Promise<void> {
    this._mapName = mapName;
    if (this._autoCreateTable) {
      await this._ensureTableExists();
    }
    await this._enforceBucketCountImmutability(mapName);
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
    const start = performance.now();
    await this._send(new PutItemCommand({
      TableName: this._tableName,
      Item: this._itemForValue(key, value),
    }));
    try { this._metrics?.onOperation?.('store', performance.now() - start); } catch { /* metrics must not break operations */ }
  }

  async storeAll(entries: Map<string, T>): Promise<void> {
    const start = performance.now();
    const items = Array.from(entries.entries()).map(([key, value]) => ({
      PutRequest: { Item: this._itemForValue(key, value) },
    }));

    for (let i = 0; i < items.length; i += BATCH_WRITE_CHUNK_SIZE) {
      await this._retryUnprocessedWrites(items.slice(i, i + BATCH_WRITE_CHUNK_SIZE));
    }
    try { this._metrics?.onBatchOperation?.('storeAll', entries.size, performance.now() - start); } catch { /* metrics must not break operations */ }
  }

  async delete(key: string): Promise<void> {
    const start = performance.now();
    await this._send(new DeleteItemCommand({
      TableName: this._tableName,
      Key: this._tableKey(key),
    }));
    try { this._metrics?.onOperation?.('delete', performance.now() - start); } catch { /* metrics must not break operations */ }
  }

  async deleteAll(keys: string[]): Promise<void> {
    const start = performance.now();
    const requests = keys.map((key) => ({
      DeleteRequest: { Key: this._tableKey(key) },
    }));

    for (let i = 0; i < requests.length; i += BATCH_WRITE_CHUNK_SIZE) {
      await this._retryUnprocessedWrites(requests.slice(i, i + BATCH_WRITE_CHUNK_SIZE));
    }
    try { this._metrics?.onBatchOperation?.('deleteAll', keys.length, performance.now() - start); } catch { /* metrics must not break operations */ }
  }

  async clear(): Promise<void> {
    const start = performance.now();
    let totalDeleted = 0;
    const mapName = this._requireMapName();
    for (let bucket = 0; bucket < this._bucketCount; bucket++) {
      const bucketKey = `${mapName}#${bucket}`;
      let exclusiveStartKey: Record<string, AttributeValue> | undefined;
      do {
        const response = await this._send<any>(new QueryCommand({
          TableName: this._tableName,
          KeyConditionExpression: 'bucket_key = :bk',
          ExpressionAttributeValues: { ':bk': { S: bucketKey } },
          ProjectionExpression: 'bucket_key, entry_key',
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: this._consistentRead,
        }));

        const items = response.Items ?? [];
        if (items.length > 0) {
          totalDeleted += items.length;
          const requests = items.map((item: Record<string, AttributeValue>) => ({
            DeleteRequest: { Key: { bucket_key: item.bucket_key!, entry_key: item.entry_key! } },
          }));
          for (let i = 0; i < requests.length; i += BATCH_WRITE_CHUNK_SIZE) {
            await this._retryUnprocessedWrites(requests.slice(i, i + BATCH_WRITE_CHUNK_SIZE));
          }
        }
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);
    }
    await this._send(new DeleteItemCommand({
      TableName: this._tableName,
      Key: this._metadataKey(mapName),
    }));
    try { this._metrics?.onBatchOperation?.('clear', totalDeleted, performance.now() - start); } catch { /* metrics must not break operations */ }
  }

  // MapLoader

  async load(key: string): Promise<T | null> {
    const start = performance.now();
    const result = await this._send<any>(new GetItemCommand({
      TableName: this._tableName,
      Key: this._tableKey(key),
      ConsistentRead: this._consistentRead,
      ProjectionExpression: 'entry_value',
    }));
    const raw = result.Item?.entry_value?.S;
    const value = raw === undefined ? null : this._serializer.deserialize(raw);
    try { this._metrics?.onOperation?.('load', performance.now() - start); } catch { /* metrics must not break operations */ }
    return value;
  }

  async loadAll(keys: string[]): Promise<Map<string, T>> {
    const start = performance.now();
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

    try { this._metrics?.onBatchOperation?.('loadAll', keys.length, performance.now() - start); } catch { /* metrics must not break operations */ }
    return result;
  }

  async loadAllKeys(): Promise<MapKeyStream<string>> {
    const self = this;
    async function* generateKeys(): AsyncGenerator<string> {
      const mapName = self._requireMapName();
      for (let bucket = 0; bucket < self._bucketCount; bucket++) {
        let keysEmitted = 0;
        let exclusiveStartKey: Record<string, AttributeValue> | undefined;
        do {
          const response = await self._send<any>(new QueryCommand({
            TableName: self._tableName,
            KeyConditionExpression: 'bucket_key = :bucketKey',
            ExpressionAttributeValues: {
              ':bucketKey': { S: `${mapName}#${bucket}` },
            },
            ProjectionExpression: 'entry_key',
            ExclusiveStartKey: exclusiveStartKey,
            ConsistentRead: self._consistentRead,
          }));

          for (const item of response.Items ?? []) {
            const entryKey = item.entry_key?.S;
            if (entryKey !== undefined) {
              keysEmitted++;
              yield entryKey;
            }
          }
          exclusiveStartKey = response.LastEvaluatedKey;
        } while (exclusiveStartKey !== undefined);
        try { self._metrics?.onKeyStreamProgress?.(bucket, self._bucketCount, keysEmitted); } catch { /* metrics must not break operations */ }
      }
    }

    return MapKeyStream.fromIterable(generateKeys());
  }

  static factory<T>(
    baseConfig: DynamoDbConfig<T>,
  ): { newMapStore(mapName: string, properties: Map<string, string>): DynamoDbMapStore<T> } {
    return {
      newMapStore(): DynamoDbMapStore<T> {
        return new DynamoDbMapStore<T>(baseConfig);
      },
    };
  }
}
