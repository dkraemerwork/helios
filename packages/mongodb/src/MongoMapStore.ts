import { MongoClient } from 'mongodb';
import type { MongoConfig, Serializer } from './MongoConfig.js';

const defaultSerializer: Serializer<unknown> = {
  serialize: (v) => JSON.stringify(v),
  deserialize: (s) => JSON.parse(s) as unknown,
};

/**
 * MongoDB-backed MapStore for Helios.
 * Implements MapStore<string, T> and MapLoaderLifecycleSupport.
 *
 * Document schema: { _id: <key: string>, value: <serialized string> }
 *
 * Java reference: com.hazelcast.mapstore (adapted for MongoDB).
 */
export class MongoMapStore<T = unknown> {
  readonly _uri: string;
  readonly _database: string;
  readonly _collection: string | undefined;
  readonly _serializer: Serializer<T>;
  private readonly _clientOptions: object;
  private _client: MongoClient | undefined;
  private _coll: any | undefined;

  constructor(config: MongoConfig<T>, client?: MongoClient) {
    this._uri = config.uri;
    this._database = config.database;
    this._collection = config.collection;
    this._serializer = (config.serializer ?? defaultSerializer) as Serializer<T>;
    this._clientOptions = config.clientOptions ?? {};
    if (client !== undefined) {
      this._client = client;
    }
  }

  // MapLoaderLifecycleSupport

  async init(_properties: Map<string, string>, mapName: string): Promise<void> {
    if (this._client === undefined) {
      this._client = new MongoClient(this._uri, this._clientOptions as any);
    }
    await this._client.connect();
    const db = this._client.db(this._database);
    const collectionName = this._collection ?? mapName;
    this._coll = db.collection(collectionName);
  }

  async destroy(): Promise<void> {
    if (this._client !== undefined) {
      await this._client.close();
    }
  }

  // MapStore

  async store(key: string, value: T): Promise<void> {
    await this._coll!.updateOne(
      { _id: key },
      { $set: { value: this._serializer.serialize(value) } },
      { upsert: true },
    );
  }

  async storeAll(entries: Map<string, T>): Promise<void> {
    const ops = Array.from(entries.entries()).map(([k, v]) => ({
      updateOne: {
        filter: { _id: k },
        update: { $set: { value: this._serializer.serialize(v) } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await this._coll!.bulkWrite(ops as any);
    }
  }

  async delete(key: string): Promise<void> {
    await this._coll!.deleteOne({ _id: key });
  }

  async deleteAll(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this._coll!.deleteMany({ _id: { $in: keys } });
    }
  }

  // MapLoader

  async load(key: string): Promise<T | null> {
    const doc = await this._coll!.findOne({ _id: key });
    if (doc === null || doc === undefined) return null;
    return this._serializer.deserialize((doc as any).value as string);
  }

  async loadAll(keys: string[]): Promise<Map<string, T>> {
    const docs = await this._coll!.find({ _id: { $in: keys } }).toArray();
    const map = new Map<string, T>();
    for (const doc of docs) {
      map.set(
        (doc as any)._id as string,
        this._serializer.deserialize((doc as any).value as string),
      );
    }
    return map;
  }

  async loadAllKeys(): Promise<string[]> {
    const docs = await this._coll!.find({}, { projection: { _id: 1 } }).toArray();
    return docs.map((d: any) => d._id as string);
  }

  // Static factory for per-map collection scoping

  static factory<T>(
    baseConfig: MongoConfig<T>,
  ): { newMapStore(mapName: string, properties: Map<string, string>): MongoMapStore<T> } {
    return {
      newMapStore(mapName: string): MongoMapStore<T> {
        const derivedCollection = baseConfig.collection ?? mapName;
        return new MongoMapStore<T>({ ...baseConfig, collection: derivedCollection });
      },
    };
  }
}
