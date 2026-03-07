import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';
import type { S3Config, Serializer } from './S3Config.js';

const DEFAULT_SUFFIX = '.json';

const defaultSerializer: Serializer<unknown> = {
  serialize: (v) => JSON.stringify(v),
  deserialize: (s) => JSON.parse(s) as unknown,
};

const DELETE_CHUNK_SIZE = 1000;

/**
 * S3-backed MapStore for Helios.
 * Implements MapStore<string, T> and MapLoaderLifecycleSupport.
 *
 * Java reference: com.hazelcast.mapstore (adapted for S3).
 */
export class S3MapStore<T = unknown> {
  readonly _prefix: string;
  readonly _suffix: string;
  readonly _serializer: Serializer<T>;
  private readonly _bucket: string;
  private _client: S3Client;

  constructor(config: S3Config<T>, client?: S3Client) {
    this._bucket = config.bucket;
    this._prefix = config.prefix ?? '';
    this._suffix = config.suffix ?? DEFAULT_SUFFIX;
    this._serializer = (config.serializer ?? defaultSerializer) as Serializer<T>;
    this._client = client ?? this._createClient(config);
  }

  private _createClient(config: S3Config<T>): S3Client {
    const s3Cfg: S3ClientConfig = {};
    if (config.region) s3Cfg.region = config.region;
    if (config.endpoint) s3Cfg.endpoint = config.endpoint;
    if (config.credentials) s3Cfg.credentials = config.credentials;
    return new S3Client(s3Cfg);
  }

  private _objectKey(key: string): string {
    return `${this._prefix}${key}${this._suffix}`;
  }

  private _stripPrefixSuffix(objectKey: string): string {
    let k = objectKey;
    if (this._prefix && k.startsWith(this._prefix)) {
      k = k.slice(this._prefix.length);
    }
    if (this._suffix && k.endsWith(this._suffix)) {
      k = k.slice(0, k.length - this._suffix.length);
    }
    return k;
  }

  // MapLoaderLifecycleSupport

  async init(_properties: Map<string, string>, _mapName: string): Promise<void> {
    // Client already created in constructor (or injected for testing).
  }

  async destroy(): Promise<void> {
    this._client.destroy();
  }

  // MapStore

  async store(key: string, value: T): Promise<void> {
    await this._client.send(new PutObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(key),
      Body: this._serializer.serialize(value),
    }));
  }

  async storeAll(entries: Map<string, T>): Promise<void> {
    await Promise.all(
      Array.from(entries.entries()).map(([k, v]) => this.store(k, v)),
    );
  }

  async delete(key: string): Promise<void> {
    await this._client.send(new DeleteObjectCommand({
      Bucket: this._bucket,
      Key: this._objectKey(key),
    }));
  }

  async deleteAll(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_CHUNK_SIZE) {
      const chunk = keys.slice(i, i + DELETE_CHUNK_SIZE);
      await this._client.send(new DeleteObjectsCommand({
        Bucket: this._bucket,
        Delete: {
          Objects: chunk.map((k) => ({ Key: this._objectKey(k) })),
        },
      }));
    }
  }

  // MapLoader

  async load(key: string): Promise<T | null> {
    try {
      const resp = await this._client.send(new GetObjectCommand({
        Bucket: this._bucket,
        Key: this._objectKey(key),
      }));
      const body = await resp.Body?.transformToString();
      if (body == null) return null;
      return this._serializer.deserialize(body);
    } catch (err: unknown) {
      const e = err as { name?: string; Code?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  async loadAll(keys: string[]): Promise<Map<string, T>> {
    const results = await Promise.all(
      keys.map(async (k) => ({ key: k, value: await this.load(k) })),
    );
    const map = new Map<string, T>();
    for (const { key, value } of results) {
      if (value !== null) {
        map.set(key, value);
      }
    }
    return map;
  }

  async loadAllKeys(): Promise<MapKeyStream<string>> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await this._client.send(new ListObjectsV2Command({
        Bucket: this._bucket,
        Prefix: this._prefix || undefined,
        ContinuationToken: continuationToken,
      }));
      for (const obj of (resp.Contents ?? [])) {
        if (obj.Key != null) {
          keys.push(this._stripPrefixSuffix(obj.Key));
        }
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken != null);
    return MapKeyStream.fromIterable(keys);
  }

  // Static factory for per-map prefix scoping

  static factory<T>(baseConfig: S3Config<T>): { newMapStore(mapName: string, properties: Map<string, string>): S3MapStore<T> } {
    return {
      newMapStore(mapName: string): S3MapStore<T> {
        const derivedPrefix = baseConfig.prefix ?? `${mapName}/`;
        return new S3MapStore<T>({ ...baseConfig, prefix: derivedPrefix });
      },
    };
  }
}
