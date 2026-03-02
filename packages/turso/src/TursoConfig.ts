/**
 * Serializer for converting values to/from the stored string representation.
 * Default: JSON.stringify / JSON.parse.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

/**
 * Configuration for TursoMapStore.
 *
 * Java reference: com.hazelcast.mapstore (adapted for Turso/libSQL).
 */
export interface TursoConfig<T = unknown> {
  /** Database URL: ':memory:' for tests, 'libsql://...' for Turso cloud, 'file:...' for local. */
  url: string;
  /** Auth token — required for Turso cloud; omit for local/memory. */
  authToken?: string;
  /** Table name. When omitted, `init()` uses the map name. */
  tableName?: string;
  /** Custom serializer. Defaults to JSON.stringify / JSON.parse. */
  serializer?: Serializer<T>;
}
