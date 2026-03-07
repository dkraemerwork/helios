import { Comparables } from './Comparables';
import type { Index, IndexConfig } from './Index';
import { IndexType } from './Index';

/**
 * Sorted (B-tree-like) index backed by a sorted array of [attributeValue, entryKey] pairs.
 * Supports O(log N) range queries using binary search.
 * Equivalent to Hazelcast's SORTED index type.
 *
 * Key operations:
 * - insert(attributeValue, entryKey)
 * - remove(attributeValue, entryKey)
 * - getEqual(value)            → O(log N)
 * - getBetween(from, to)       → O(log N + K) where K = result count
 * - getByPrefix(prefix)        → O(log N + K) for LIKE 'prefix%' queries
 * - getGreaterThan(value, equal) → O(log N + K)
 * - getLessThan(value, equal)    → O(log N + K)
 */
export class SortedIndex implements Index {
  private readonly _config: IndexConfig = { getType: () => IndexType.SORTED };
  /** Sorted array of [attributeValue, entryKey] pairs, ordered by Comparables.compare. */
  private readonly _entries: Array<[unknown, string]> = [];

  getConfig(): IndexConfig {
    return this._config;
  }

  /**
   * Inserts [attributeValue, entryKey] at the correct sorted position.
   * If multiple entries have the same attributeValue, the new entry is appended
   * after the existing ones for that value (stable insertion).
   */
  insert(attributeValue: unknown, entryKey: string): void {
    const pos = this._upperBound(attributeValue);
    this._entries.splice(pos, 0, [attributeValue, entryKey]);
  }

  /**
   * Removes the entry with the given attributeValue and entryKey.
   * Scans forward from the lower bound to find an exact [value, key] match.
   */
  remove(attributeValue: unknown, entryKey: string): void {
    const lo = this._lowerBound(attributeValue);
    for (let i = lo; i < this._entries.length; i++) {
      const cmp = Comparables.compare(this._entries[i]![0], attributeValue);
      if (cmp !== 0) break;
      if (this._entries[i]![1] === entryKey) {
        this._entries.splice(i, 1);
        return;
      }
    }
  }

  /** Returns all entry keys with exactly the given attribute value. O(log N + K). */
  getEqual(attributeValue: unknown): string[] {
    const lo = this._lowerBound(attributeValue);
    const hi = this._upperBound(attributeValue);
    return this._entries.slice(lo, hi).map(e => e[1]);
  }

  /** Returns all entry keys where from <= attributeValue <= to (inclusive). O(log N + K). */
  getBetween(from: unknown, to: unknown): string[] {
    const lo = this._lowerBound(from);
    const hi = this._upperBound(to);
    return this._entries.slice(lo, hi).map(e => e[1]);
  }

  /**
   * Returns all entry keys where attributeValue > value (equal=false)
   * or attributeValue >= value (equal=true). O(log N + K).
   */
  getGreaterThan(value: unknown, equal: boolean): string[] {
    const pos = equal ? this._lowerBound(value) : this._upperBound(value);
    return this._entries.slice(pos).map(e => e[1]);
  }

  /**
   * Returns all entry keys where attributeValue < value (equal=false)
   * or attributeValue <= value (equal=true). O(log N + K).
   */
  getLessThan(value: unknown, equal: boolean): string[] {
    const pos = equal ? this._upperBound(value) : this._lowerBound(value);
    return this._entries.slice(0, pos).map(e => e[1]);
  }

  /**
   * Returns all entry keys where the string attribute value starts with the given prefix.
   * Used for LIKE 'prefix%' index scans. O(log N + K).
   */
  getByPrefix(prefix: string): string[] {
    const lo = this._lowerBound(prefix);
    const results: string[] = [];
    for (let i = lo; i < this._entries.length; i++) {
      const v = this._entries[i]![0];
      if (typeof v !== 'string' || !v.startsWith(prefix)) break;
      results.push(this._entries[i]![1]);
    }
    return results;
  }

  /** Returns the total number of indexed (attributeValue, entryKey) pairs. */
  get size(): number {
    return this._entries.length;
  }

  /**
   * Returns the smallest index i such that _entries[i][0] >= value.
   * (Standard lower_bound binary search.)
   */
  private _lowerBound(value: unknown): number {
    let lo = 0;
    let hi = this._entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (Comparables.compare(this._entries[mid]![0], value) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Returns the smallest index i such that _entries[i][0] > value.
   * (Standard upper_bound binary search.)
   */
  private _upperBound(value: unknown): number {
    let lo = 0;
    let hi = this._entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (Comparables.compare(this._entries[mid]![0], value) <= 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
