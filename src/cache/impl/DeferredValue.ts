/**
 * Port of {@code com.hazelcast.cache.impl.DeferredValue}.
 * Thread-safe (single-threaded in Bun) holder of a value and/or its serialized form.
 *
 * @param V the type of value
 */
import type { SerializationService } from '@zenystx/core/internal/serialization/SerializationService';
import type { Data } from '@zenystx/core/internal/serialization/Data';

function buffersEqual(a: Buffer | null, b: Buffer | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.equals(b);
}

// ── Internal mutable state object ─────────────────────────────────────────────

interface DeferredState<V> {
    serializedValue: Data | null;
    value: V | null;
    valueExists: boolean;
    serializedValueExists: boolean;
}

export class DeferredValue<V> {
    private readonly _s: DeferredState<V>;
    private readonly _isNull: boolean;

    /** @internal */
    constructor(state: DeferredState<V>, isNull = false) {
        this._s = state;
        this._isNull = isNull;
    }

    /** Gets or deserializes the value. */
    get(serializationService: SerializationService): V | null {
        if (this._isNull) return null;
        if (!this._s.valueExists) {
            this._s.value = serializationService.toObject<V>(this._s.serializedValue);
            this._s.valueExists = true;
        }
        return this._s.value;
    }

    /** Gets or serializes to Data. */
    getSerializedValue(serializationService: SerializationService): Data | null {
        if (this._isNull) return null;
        if (!this._s.serializedValueExists) {
            this._s.serializedValue = serializationService.toData(this._s.value);
            this._s.serializedValueExists = true;
        }
        return this._s.serializedValue;
    }

    /** Creates a shallow copy preserving whichever representation is already available. */
    shallowCopy(resolved = true, serializationService?: SerializationService): DeferredValue<V> {
        if (this._isNull) return this;
        const copy: DeferredState<V> = {
            serializedValue: null,
            value: null,
            valueExists: false,
            serializedValueExists: false,
        };
        if (this._s.serializedValueExists) {
            copy.serializedValueExists = true;
            copy.serializedValue = this._s.serializedValue;
        } else if (!resolved && serializationService) {
            copy.serializedValueExists = true;
            copy.serializedValue = this.getSerializedValue(serializationService);
        }
        if (this._s.valueExists) {
            copy.valueExists = true;
            copy.value = this._s.value;
        }
        return new DeferredValue<V>(copy);
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof DeferredValue)) return false;
        const o = other as DeferredValue<V>;
        if (this._isNull || o._isNull) {
            return this._isNull === o._isNull;
        }
        if (this._s.valueExists && o._s.valueExists) {
            return this._s.value === o._s.value;
        }
        if (this._s.serializedValueExists && o._s.serializedValueExists) {
            return this._s.serializedValue === o._s.serializedValue ||
                buffersEqual(
                    this._s.serializedValue?.toByteArray() ?? null,
                    o._s.serializedValue?.toByteArray() ?? null,
                );
        }
        throw new Error('Cannot compare serialized vs deserialized value');
    }

    // ── Factory methods ───────────────────────────────────────────────────────

    static withSerializedValue<V>(serializedValue: Data | null): DeferredValue<V> {
        if (serializedValue === null) return DeferredValue.withNullValue<V>();
        const s: DeferredState<V> = { serializedValue, value: null, valueExists: false, serializedValueExists: true };
        return new DeferredValue<V>(s);
    }

    static withValue<V>(value: V | null): DeferredValue<V> {
        if (value === null || value === undefined) return DeferredValue.withNullValue<V>();
        const s: DeferredState<V> = { serializedValue: null, value, valueExists: true, serializedValueExists: false };
        return new DeferredValue<V>(s);
    }

    static withNullValue<V>(): DeferredValue<V> {
        return _nullValue as DeferredValue<V>;
    }

    /**
     * Creates a {@code Set<DeferredValue<V>>} from a {@code Set<V>}.
     * Each member is wrapped with {@link withValue}.
     * Returns a custom equality-aware set (uses {@link equals} for membership, like Java's ConcurrentHashMap.newKeySet()).
     */
    static concurrentSetOfValues<V>(values: Set<V>): Set<DeferredValue<V>> {
        const result = new DeferredEqualitySet<V>();
        for (const v of values) {
            result.add(DeferredValue.withValue(v));
        }
        return result as unknown as Set<DeferredValue<V>>;
    }

    /**
     * Adapts a {@code Set<DeferredValue<V>>} as a pass-through {@code Set<V>}.
     * Mutations on the returned set pass through to the underlying deferred set.
     */
    static asPassThroughSet<V>(
        deferredValues: Set<DeferredValue<V>>,
        serializationService: SerializationService,
    ): Set<V> {
        return new DeferredValueSet(deferredValues, serializationService) as unknown as Set<V>;
    }
}

// ── DeferredEqualitySet — equality-aware set for DeferredValue (like Java's ConcurrentHashMap.newKeySet()) ──

class DeferredEqualitySet<V> {
    private readonly _items: DeferredValue<V>[] = [];

    get size(): number { return this._items.length; }

    has(item: DeferredValue<V>): boolean {
        for (const dv of this._items) {
            try { if (dv.equals(item)) return true; } catch { /* skip mixed */ }
        }
        return false;
    }

    add(item: DeferredValue<V>): this {
        if (!this.has(item)) this._items.push(item);
        return this;
    }

    delete(item: DeferredValue<V>): boolean {
        for (let i = 0; i < this._items.length; i++) {
            try {
                if (this._items[i]!.equals(item)) {
                    this._items.splice(i, 1);
                    return true;
                }
            } catch { /* skip */ }
        }
        return false;
    }

    clear(): void { this._items.length = 0; }

    [Symbol.iterator](): IterableIterator<DeferredValue<V>> {
        return this._items[Symbol.iterator]();
    }

    values(): IterableIterator<DeferredValue<V>> { return this[Symbol.iterator](); }
    keys(): IterableIterator<DeferredValue<V>> { return this[Symbol.iterator](); }
    entries(): IterableIterator<[DeferredValue<V>, DeferredValue<V>]> {
        const iter = this[Symbol.iterator]();
        return {
            next() {
                const r = iter.next();
                if (r.done) return { value: undefined as unknown as [DeferredValue<V>, DeferredValue<V>], done: true };
                return { value: [r.value, r.value] as [DeferredValue<V>, DeferredValue<V>], done: false };
            },
            [Symbol.iterator]() { return this; },
        };
    }

    forEach(cb: (v: DeferredValue<V>, v2: DeferredValue<V>, set: this) => void): void {
        for (const item of this._items) cb(item, item, this);
    }

    get [Symbol.toStringTag](): string { return 'DeferredEqualitySet'; }
}

// ── Singleton null value (initialized after class declaration) ────────────────
const _nullState: DeferredState<never> = {
    serializedValue: null,
    value: null,
    valueExists: true,
    serializedValueExists: true,
};
const _nullValue = new DeferredValue<never>(_nullState, true);

// ── DeferredValueSet (pass-through Set<V> backed by Set<DeferredValue<V>>) ───

function findDeferred<V>(set: Set<DeferredValue<V>>, target: DeferredValue<V>): DeferredValue<V> | undefined {
    for (const dv of set) {
        try { if (dv.equals(target)) return dv; } catch { /* skip */ }
    }
    return undefined;
}

class DeferredValueSet<V> {
    private readonly _delegate: Set<DeferredValue<V>>;
    private readonly _ss: SerializationService;

    constructor(delegate: Set<DeferredValue<V>>, ss: SerializationService) {
        this._delegate = delegate;
        this._ss = ss;
    }

    get size(): number { return this._delegate.size; }

    has(v: V): boolean {
        return findDeferred(this._delegate, DeferredValue.withValue(v)) !== undefined;
    }

    add(v: V): this {
        this._delegate.add(DeferredValue.withValue(v));
        return this;
    }

    delete(v: V): boolean {
        const found = findDeferred(this._delegate, DeferredValue.withValue(v));
        if (found) { this._delegate.delete(found); return true; }
        return false;
    }

    clear(): void { this._delegate.clear(); }

    [Symbol.iterator](): Iterator<V> {
        const iter = this._delegate[Symbol.iterator]();
        const ss = this._ss;
        return {
            next(): IteratorResult<V> {
                const r = iter.next();
                if (r.done) return { value: undefined as unknown as V, done: true };
                return { value: r.value.get(ss) as V, done: false };
            },
        };
    }

    values(): IterableIterator<V> {
        return this[Symbol.iterator]() as IterableIterator<V>;
    }

    forEach(cb: (v: V, v2: V, set: this) => void): void {
        for (const v of this) cb(v, v, this);
    }
}
