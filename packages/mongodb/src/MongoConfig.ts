/**
 * Serializer for converting values to/from the stored string representation.
 * Default: JSON.stringify / JSON.parse.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

/**
 * Configuration for MongoMapStore.
 *
 * Java reference: com.hazelcast.mapstore (adapted for MongoDB).
 */
export interface MongoConfig<T = unknown> {
  /** MongoDB connection URI (e.g. `mongodb://localhost:27017`). */
  uri: string;
  /** Database name. */
  database: string;
  /** Collection name. When omitted, `init()` uses the map name. */
  collection?: string;
  /** Options passed directly to the MongoClient constructor. */
  clientOptions?: object;
  /** Custom serializer. Defaults to JSON.stringify / JSON.parse. */
  serializer?: Serializer<T>;
}
