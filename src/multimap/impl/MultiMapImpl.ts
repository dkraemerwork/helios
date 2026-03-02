import type { MultiMap } from '../MultiMap';
import { ValueCollectionType } from '../MultiMapConfig';

/**
 * A collection that holds values for a single key in the MultiMap.
 * Uses either Set or Array semantics depending on ValueCollectionType.
 */
class ValueCollection<V> {
    private readonly items: V[] = [];

    constructor(private readonly type: ValueCollectionType) {}

    /**
     * @returns true if the collection changed.
     */
    add(value: V): boolean {
        if (this.type === ValueCollectionType.SET) {
            if (this.items.includes(value)) return false;
        }
        this.items.push(value);
        return true;
    }

    /**
     * @returns true if the value was found and removed.
     */
    removeOne(value: V): boolean {
        const i = this.items.indexOf(value);
        if (i === -1) return false;
        this.items.splice(i, 1);
        return true;
    }

    has(value: V): boolean {
        return this.items.includes(value);
    }

    get size(): number {
        return this.items.length;
    }

    [Symbol.iterator](): Iterator<V> {
        return this.items[Symbol.iterator]();
    }

    toArray(): V[] {
        return [...this.items];
    }
}

/**
 * Immutable snapshot returned from removeAll / get for empty keys.
 */
class EmptyCollection<V> {
    readonly size = 0;
    has(_v: V): boolean { return false; }
    [Symbol.iterator](): Iterator<V> {
        return [][Symbol.iterator]();
    }
}

/**
 * In-memory single-node MultiMap implementation.
 * Port of com.hazelcast.multimap.impl (single-node subset).
 */
export class MultiMapImpl<K, V> implements MultiMap<K, V> {
    private readonly data = new Map<K, ValueCollection<V>>();

    constructor(private readonly type: ValueCollectionType = ValueCollectionType.LIST) {}

    private checkNull(key: unknown, label: string): void {
        if (key === null || key === undefined) {
            throw new Error('NullPointerException: ' + label + ' is null');
        }
    }

    private getOrCreate(key: K): ValueCollection<V> {
        let col = this.data.get(key);
        if (!col) {
            col = new ValueCollection<V>(this.type);
            this.data.set(key, col);
        }
        return col;
    }

    put(key: K, value: V): boolean {
        this.checkNull(key, 'key');
        this.checkNull(value, 'value');
        return this.getOrCreate(key).add(value);
    }

    get(key: K): ValueCollection<V> | EmptyCollection<V> {
        this.checkNull(key, 'key');
        return this.data.get(key) ?? new EmptyCollection<V>();
    }

    removeAll(key: K): { size: number; [Symbol.iterator](): Iterator<V> } {
        this.checkNull(key, 'key');
        const col = this.data.get(key);
        if (!col) return new EmptyCollection<V>();
        const snapshot = col.toArray();
        this.data.delete(key);
        return {
            get size() { return snapshot.length; },
            [Symbol.iterator](): Iterator<V> { return snapshot[Symbol.iterator](); },
        };
    }

    remove(key: K, value: V): boolean {
        this.checkNull(key, 'key');
        this.checkNull(value, 'value');
        const col = this.data.get(key);
        if (!col) return false;
        const removed = col.removeOne(value);
        if (col.size === 0) this.data.delete(key);
        return removed;
    }

    delete(key: K): void {
        this.checkNull(key, 'key');
        this.data.delete(key);
    }

    size(): number {
        let total = 0;
        for (const col of this.data.values()) total += col.size;
        return total;
    }

    valueCount(key: K): number {
        this.checkNull(key, 'key');
        return this.data.get(key)?.size ?? 0;
    }

    keySet(): Set<K> {
        return new Set(this.data.keys());
    }

    values(): V[] {
        const result: V[] = [];
        for (const col of this.data.values()) result.push(...col);
        return result;
    }

    entrySet(): [K, V][] {
        const result: [K, V][] = [];
        for (const [key, col] of this.data.entries()) {
            for (const v of col) result.push([key, v]);
        }
        return result;
    }

    containsKey(key: K): boolean {
        this.checkNull(key, 'key');
        const col = this.data.get(key);
        return col !== undefined && col.size > 0;
    }

    containsValue(value: V): boolean {
        this.checkNull(value, 'value');
        for (const col of this.data.values()) {
            if (col.has(value)) return true;
        }
        return false;
    }

    containsEntry(key: K, value: V): boolean {
        this.checkNull(key, 'key');
        this.checkNull(value, 'value');
        return this.data.get(key)?.has(value) ?? false;
    }

    clear(): void {
        this.data.clear();
    }
}
