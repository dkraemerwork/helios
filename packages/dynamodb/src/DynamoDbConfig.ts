/**
 * Serializer for converting values to/from the stored string representation.
 * Default: JSON.stringify / JSON.parse.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

/**
 * TLS configuration for secure connections to DynamoDB-compatible endpoints.
 */
export interface TlsConfig {
  /** Enable TLS. When endpoint uses `https://`, TLS is auto-enabled. */
  enabled?: boolean;
  /** Custom CA certificate(s) as PEM string(s). */
  ca?: string | string[];
  /** Whether to reject unauthorized certificates. Defaults to `true`. */
  rejectUnauthorized?: boolean;
}

/**
 * Operational metrics listener for DynamoDB MapStore operations.
 * Implement this interface to receive observability signals for monitoring,
 * logging, or alerting on external persistence behavior.
 *
 * Recommended signals to log for external persistence operations:
 * - Flush latency: `onOperation` and `onBatchOperation` report `durationMs`
 * - Batch size: `onBatchOperation` reports `itemCount`
 * - Retry count: `onRetry` reports `attempt` per retry cycle
 * - External error rate: `onError` fires on every DynamoDB transport/timeout error
 * - Hot partition detection: correlate `onRetry` frequency with partition keys
 * - Load pressure: monitor `onBatchOperation` call rate and `durationMs` trends
 */
export interface DynamoDbMapStoreMetrics {
  /** Called after a successful single-item operation (store, delete, load). */
  onOperation?(operation: 'store' | 'delete' | 'load', durationMs: number): void;
  /** Called after a successful batch operation (storeAll, deleteAll, loadAll, clear). */
  onBatchOperation?(operation: 'storeAll' | 'deleteAll' | 'loadAll' | 'clear', itemCount: number, durationMs: number): void;
  /** Called when a batch retry occurs due to unprocessed items. */
  onRetry?(operation: 'batchWrite' | 'batchGet', attempt: number, unprocessedCount: number): void;
  /** Called when retries are exhausted and the operation fails. */
  onRetryExhausted?(operation: 'batchWrite' | 'batchGet', totalAttempts: number, unprocessedCount: number): void;
  /** Called when any DynamoDB operation errors (transport, timeout, etc.). */
  onError?(operation: string, error: Error): void;
  /** Called during loadAllKeys() streaming — reports progress per bucket. */
  onKeyStreamProgress?(bucket: number, totalBuckets: number, keysEmitted: number): void;
}

/**
 * Configuration for DynamoDB-compatible MapStore.
 */
export type EndpointStrategy = 'single' | 'round-robin';

export interface DynamoDbConfig<T = unknown> {
  /** Single endpoint, e.g. `https://<host>` or `http://localhost:8000`. */
  endpoint?: string;
  /** Multiple endpoints for a DynamoDB-compatible cluster. */
  endpoints?: string[];
  /** Endpoint selection strategy when `endpoints` is provided. Defaults to `single`. */
  endpointStrategy?: EndpointStrategy;
  /** Region passed to the AWS SDK signer. Defaults to `us-east-1`. */
  region?: string;
  /** Access key credentials for the backing service. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Shared table name. Defaults to `helios_mapstore`. */
  tableName?: string;
  /** Number of deterministic key buckets per map. Defaults to `64`. */
  bucketCount?: number;
  /** Create the backing table during init() if it does not exist. Defaults to `true`. */
  autoCreateTable?: boolean;
  /** Use strongly consistent reads for get/load paths when supported. Defaults to `false`. */
  consistentRead?: boolean;
  /** Custom serializer. Defaults to JSON.stringify / JSON.parse. */
  serializer?: Serializer<T>;
  /** Request timeout in milliseconds for individual DynamoDB operations. Defaults to `5000`. */
  requestTimeoutMs?: number;
  /** Maximum number of retry attempts for batch operations with unprocessed items. Defaults to `10`. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff between retries. Defaults to `100`. */
  retryBaseDelayMs?: number;
  /** Maximum delay in milliseconds for exponential backoff. Defaults to `5000`. */
  retryMaxDelayMs?: number;
  /** TLS configuration for secure connections. */
  tls?: TlsConfig;
  /** Custom request handler for advanced transport configuration (TLS, proxies). */
  requestHandler?: unknown;
  /** Optional metrics listener for observability. */
  metrics?: DynamoDbMapStoreMetrics;
}
