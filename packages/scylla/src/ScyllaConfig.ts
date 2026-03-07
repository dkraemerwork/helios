/**
 * Serializer for converting values to/from the stored string representation.
 * Default: JSON.stringify / JSON.parse.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

/**
 * Configuration for ScyllaMapStore using a DynamoDB-compatible API.
 */
export type EndpointStrategy = 'single' | 'round-robin';

export interface ScyllaConfig<T = unknown> {
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
}
