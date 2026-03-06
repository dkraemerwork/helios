 import { createClient } from '@libsql/client';
import type { Client, InStatement } from '@libsql/client';
import type { TursoConfig, Serializer } from './TursoConfig.js';
import { MapKeyStream } from '@zenystx/helios-core/map/MapKeyStream';

const BULK_CHUNK_SIZE = 500;

const defaultSerializer: Serializer<unknown> = {
  serialize: (v) => JSON.stringify(v),
  deserialize: (s) => JSON.parse(s) as unknown,
};

/**
 * Turso/libSQL-backed MapStore for Helios.
 * Implements MapStore<string, T> and MapLoaderLifecycleSupport.
 *
 * Table schema:
 *   CREATE TABLE IF NOT EXISTS "{tableName}" (
 *     key TEXT PRIMARY KEY,
 *     value TEXT NOT NULL
 *   )
 *
 * Java reference: com.hazelcast.mapstore (adapted for Turso/libSQL).
 */
export class TursoMapStore<T = unknown> {
  readonly _config: TursoConfig<T>;
  private readonly _serializer: Serializer<T>;
  private _client: Client | undefined;
  _tableName: string | undefined;

  constructor(config: TursoConfig<T>, client?: Client) {
    this._config = config;
    this._serializer = (config.serializer ?? defaultSerializer) as Serializer<T>;
    if (client !== undefined) {
      this._client = client;
    }
  }

  // MapLoaderLifecycleSupport

  async init(_properties: Map<string, string>, mapName: string): Promise<void> {
    if (this._client === undefined) {
      this._client = createClient({
        url: this._config.url,
        authToken: this._config.authToken,
      });
    }
    this._tableName = this._config.tableName ?? mapName;
    await this._client.execute(
      `CREATE TABLE IF NOT EXISTS "${this._tableName}" (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
  }

  async destroy(): Promise<void> {
    if (this._client !== undefined) {
      this._client.close();
    }
  }

  // MapStore

  async store(key: string, value: T): Promise<void> {
    await this._client!.execute({
      sql: `INSERT OR REPLACE INTO "${this._tableName}" (key, value) VALUES (?, ?)`,
      args: [key, this._serializer.serialize(value)],
    });
  }

  async storeAll(entries: Map<string, T>): Promise<void> {
    const items = Array.from(entries.entries());
    for (let i = 0; i < items.length; i += BULK_CHUNK_SIZE) {
      const chunk = items.slice(i, i + BULK_CHUNK_SIZE);
      const stmts: InStatement[] = chunk.map(([k, v]) => ({
        sql: `INSERT OR REPLACE INTO "${this._tableName}" (key, value) VALUES (?, ?)`,
        args: [k, this._serializer.serialize(v)],
      }));
      try {
        await this._client!.batch(stmts, 'write');
      } catch (e: unknown) {
        const chunkIdx = Math.floor(i / BULK_CHUNK_SIZE);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`storeAll failed at chunk ${chunkIdx}: ${msg}`);
      }
    }
  }

  async delete(key: string): Promise<void> {
    await this._client!.execute({
      sql: `DELETE FROM "${this._tableName}" WHERE key = ?`,
      args: [key],
    });
  }

  async deleteAll(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += BULK_CHUNK_SIZE) {
      const chunk = keys.slice(i, i + BULK_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      try {
        await this._client!.execute({
          sql: `DELETE FROM "${this._tableName}" WHERE key IN (${placeholders})`,
          args: chunk,
        });
      } catch (e: unknown) {
        const chunkIdx = Math.floor(i / BULK_CHUNK_SIZE);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`deleteAll failed at chunk ${chunkIdx}: ${msg}`);
      }
    }
  }

  // MapLoader

  async load(key: string): Promise<T | null> {
    const result = await this._client!.execute({
      sql: `SELECT value FROM "${this._tableName}" WHERE key = ?`,
      args: [key],
    });
    if (result.rows.length === 0) return null;
    return this._serializer.deserialize(result.rows[0]![0] as string);
  }

  async loadAll(keys: string[]): Promise<Map<string, T>> {
    const map = new Map<string, T>();
    for (let i = 0; i < keys.length; i += BULK_CHUNK_SIZE) {
      const chunk = keys.slice(i, i + BULK_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      try {
        const result = await this._client!.execute({
          sql: `SELECT key, value FROM "${this._tableName}" WHERE key IN (${placeholders})`,
          args: chunk,
        });
        for (const row of result.rows) {
          map.set(row[0] as string, this._serializer.deserialize(row[1] as string));
        }
      } catch (e: unknown) {
        const chunkIdx = Math.floor(i / BULK_CHUNK_SIZE);
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`loadAll failed at chunk ${chunkIdx}: ${msg}`);
      }
    }
    return map;
  }

  async loadAllKeys(): Promise<MapKeyStream<string>> {
    const result = await this._client!.execute(
      `SELECT key FROM "${this._tableName}"`,
    );
    return MapKeyStream.fromIterable(result.rows.map((row) => row[0] as string));
  }

  // Static factory for per-map table scoping

  static factory<T>(
    baseConfig: TursoConfig<T>,
  ): { newMapStore(mapName: string, properties: Map<string, string>): TursoMapStore<T> } {
    return {
      newMapStore(mapName: string): TursoMapStore<T> {
        const derivedTableName = baseConfig.tableName ?? mapName;
        return new TursoMapStore<T>({ ...baseConfig, tableName: derivedTableName });
      },
    };
  }
}
