/**
 * Production IndexRegistry implementation.
 * Manages HASH and SORTED indexes per attribute for a map.
 * Block 7.4a.
 */
import type { IndexRegistry } from '@zenystx/helios-core/query/impl/IndexRegistry';
import type { Index, IndexConfig as IndexConfigInterface } from '@zenystx/helios-core/query/impl/Index';
import { IndexType } from '@zenystx/helios-core/query/impl/Index';
import { IndexMatchHint } from '@zenystx/helios-core/query/impl/QueryContext';
import type { QueryContext } from '@zenystx/helios-core/query/impl/QueryContext';
import { HashIndex } from '@zenystx/helios-core/query/impl/HashIndex';
import { SortedIndex } from '@zenystx/helios-core/query/impl/SortedIndex';
import { canonicalizeAttribute } from '@zenystx/helios-core/query/impl/IndexUtils';
import type { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';

/** An index entry stored in the registry, wrapping the underlying data structure. */
interface IndexEntry {
    config: IndexConfig;
    index: HashIndex | SortedIndex;
}

export class IndexRegistryImpl implements IndexRegistry, QueryContext {
    /** attribute → IndexType → IndexEntry */
    private readonly _indexes = new Map<string, Map<IndexType, IndexEntry>>();

    addIndex(config: IndexConfig): HashIndex | SortedIndex {
        const attr = canonicalizeAttribute(config.getAttributes()[0]!);
        let byType = this._indexes.get(attr);
        if (byType === undefined) {
            byType = new Map();
            this._indexes.set(attr, byType);
        }

        const existing = byType.get(config.getType());
        if (existing !== undefined) return existing.index;

        const index = config.getType() === IndexType.HASH
            ? new HashIndex()
            : new SortedIndex();
        byType.set(config.getType(), { config, index });
        return index;
    }

    matchIndex(attribute: string, hint: IndexMatchHint): (HashIndex | SortedIndex) | null {
        const attr = canonicalizeAttribute(attribute);
        const byType = this._indexes.get(attr);
        if (byType === undefined) return null;

        if (hint === IndexMatchHint.PREFER_ORDERED) {
            return byType.get(IndexType.SORTED)?.index
                ?? byType.get(IndexType.HASH)?.index
                ?? null;
        }
        return byType.get(IndexType.HASH)?.index
            ?? byType.get(IndexType.SORTED)?.index
            ?? null;
    }

    removeIndex(attribute: string): void {
        const attr = canonicalizeAttribute(attribute);
        this._indexes.delete(attr);
    }

    clearIndexes(): void {
        this._indexes.clear();
    }

    getIndexes(): (HashIndex | SortedIndex)[] {
        const result: (HashIndex | SortedIndex)[] = [];
        for (const byType of this._indexes.values()) {
            for (const entry of byType.values()) {
                result.push(entry.index);
            }
        }
        return result;
    }

    /** Get the index for a specific attribute and type. */
    getIndex(attribute: string, type: IndexType): (HashIndex | SortedIndex) | null {
        const attr = canonicalizeAttribute(attribute);
        return this._indexes.get(attr)?.get(type)?.index ?? null;
    }

    /** Insert an entry into all indexes for the given attribute values. */
    insertEntry(entryKey: string, attributeExtractor: (attr: string) => unknown): void {
        for (const [attr, byType] of this._indexes) {
            const value = attributeExtractor(attr);
            for (const entry of byType.values()) {
                entry.index.insert(value, entryKey);
            }
        }
    }

    /** Remove an entry from all indexes for the given attribute values. */
    removeEntry(entryKey: string, attributeExtractor: (attr: string) => unknown): void {
        for (const [attr, byType] of this._indexes) {
            const value = attributeExtractor(attr);
            for (const entry of byType.values()) {
                entry.index.remove(value, entryKey);
            }
        }
    }
}
