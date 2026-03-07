import type { Index, IndexConfig } from './Index';
import { IndexType } from './Index';

/**
 * Hash-based index for O(1) equality lookups.
 * Maps attribute values → Set of entry keys (string).
 * Equivalent to Hazelcast's HD or on-heap hash index.
 *
 * Key operations:
 * - insert(attributeValue, entryKey) — add an entry to the index
 * - remove(attributeValue, entryKey) — remove an entry from the index
 * - getEqual(attributeValue) — return all entry keys matching exactly this value
 */
export class HashIndex implements Index {
  private readonly _config: IndexConfig = { getType: () => IndexType.HASH };
  /** Map from attribute value → set of entry keys stored with that value */
  private readonly _map = new Map<unknown, Set<string>>();

  getConfig(): IndexConfig {
    return this._config;
  }

  /**
   * Inserts an entry key under the given attribute value.
   * If the bucket does not exist, creates it.
   */
  insert(attributeValue: unknown, entryKey: string): void {
    let bucket = this._map.get(attributeValue);
    if (bucket === undefined) {
      bucket = new Set<string>();
      this._map.set(attributeValue, bucket);
    }
    bucket.add(entryKey);
  }

  /**
   * Removes an entry key from the given attribute value's bucket.
   * No-op if the bucket or key does not exist.
   */
  remove(attributeValue: unknown, entryKey: string): void {
    const bucket = this._map.get(attributeValue);
    if (bucket !== undefined) {
      bucket.delete(entryKey);
      if (bucket.size === 0) {
        this._map.delete(attributeValue);
      }
    }
  }

  /**
   * Returns all entry keys where the attribute value equals the given value.
   * Returns an empty Set if nothing matches.
   */
  getEqual(attributeValue: unknown): ReadonlySet<string> {
    return this._map.get(attributeValue) ?? EMPTY_SET;
  }

  /** Returns the total number of distinct attribute values indexed. */
  get size(): number {
    return this._map.size;
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();
