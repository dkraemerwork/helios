/**
 * Registry of indexes associated with a map/cache partition.
 * Equivalent to Java's IndexRegistry.
 */
import type { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';
import type { HashIndex } from '@zenystx/helios-core/query/impl/HashIndex';
import type { IndexType } from '@zenystx/helios-core/query/impl/Index';
import type { IndexMatchHint } from '@zenystx/helios-core/query/impl/QueryContext';
import type { SortedIndex } from '@zenystx/helios-core/query/impl/SortedIndex';

export interface IndexRegistry {
  addIndex(config: IndexConfig): HashIndex | SortedIndex;
  matchIndex(attribute: string, hint: IndexMatchHint): (HashIndex | SortedIndex) | null;
  removeIndex(attribute: string): void;
  clearIndexes(): void;
  getIndexes(): (HashIndex | SortedIndex)[];
  getIndex(attribute: string, type: IndexType): (HashIndex | SortedIndex) | null;
  insertEntry(entryKey: string, attributeExtractor: (attr: string) => unknown): void;
  removeEntry(entryKey: string, attributeExtractor: (attr: string) => unknown): void;
}
