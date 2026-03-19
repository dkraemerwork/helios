/**
 * JCache (JSR-107) Cache Entry Processor support.
 *
 * Provides the {@link CacheEntryProcessor} interface, a {@link MutableCacheEntry}
 * wrapper, and a {@link CacheEntryProcessorExecutor} that deserializes a
 * processor, runs it against a live cache entry, and applies any mutations.
 *
 * Port of {@code javax.cache.processor.EntryProcessor} and
 * {@code com.hazelcast.cache.impl.operation.CacheEntryProcessorOperation}.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import type { DistributedCacheService } from './DistributedCacheService.js';

// ── MutableCacheEntry ─────────────────────────────────────────────────────────

export interface MutableCacheEntry<K, V> {
    /** Returns the key of this entry. */
    getKey(): K;

    /**
     * Returns the current value, or {@code null} if the entry does not exist or
     * has been removed during this invocation.
     */
    getValue(): V | null;

    /** Returns {@code true} if the entry currently exists in the cache. */
    exists(): boolean;

    /**
     * Sets the value of this entry.  If the entry did not exist it will be
     * created; if it already existed it will be updated.
     */
    setValue(value: V): void;

    /**
     * Marks the entry for removal.  If the entry did not exist this is a no-op.
     *
     * @returns {@code true} if the entry existed and was marked for removal.
     */
    remove(): boolean;
}

// ── CacheEntryProcessor ───────────────────────────────────────────────────────

export interface CacheEntryProcessor<K, V, T> {
    /**
     * Processes a cache entry, optionally mutating it, and returns an arbitrary
     * result that will be serialized and returned to the caller.
     */
    process(entry: MutableCacheEntry<K, V>, ...args: unknown[]): T;
}

// ── Internal mutable entry implementation ─────────────────────────────────────

type EntryMutation =
    | { kind: 'set'; value: Data }
    | { kind: 'remove' };

class MutableCacheEntryImpl implements MutableCacheEntry<Data, Data> {
    private _mutation: EntryMutation | null = null;
    private _currentValue: Data | null;
    private readonly _existed: boolean;

    constructor(
        private readonly _key: Data,
        currentValue: Data | null,
        private readonly _ss: SerializationService,
    ) {
        this._currentValue = currentValue;
        this._existed = currentValue !== null;
    }

    getKey(): Data {
        return this._key;
    }

    getValue(): Data | null {
        return this._currentValue;
    }

    exists(): boolean {
        if (this._mutation?.kind === 'remove') return false;
        return this._mutation?.kind === 'set' || this._existed;
    }

    setValue(value: Data): void {
        const dataValue = this._toData(value);
        this._currentValue = dataValue;
        this._mutation = { kind: 'set', value: dataValue! };
    }

    remove(): boolean {
        const existed = this.exists();
        this._currentValue = null;
        this._mutation = { kind: 'remove' };
        return existed;
    }

    /** Returns the pending mutation, if any. */
    getMutation(): EntryMutation | null {
        return this._mutation;
    }

    private _toData(value: unknown): Data | null {
        if (value === null || value === undefined) return null;
        if (this._isData(value)) return value as Data;
        return this._ss.toData(value);
    }

    private _isData(value: unknown): boolean {
        return (
            typeof value === 'object' &&
            value !== null &&
            typeof (value as { toByteArray?: unknown }).toByteArray === 'function'
        );
    }
}

// ── Executor ──────────────────────────────────────────────────────────────────

/**
 * Executes {@link CacheEntryProcessor} instances against a live
 * {@link DistributedCacheService}.
 *
 * The processor is deserialized from {@code processorData}, applied to a
 * {@link MutableCacheEntry} wrapping the current cache value, and any
 * mutations are written back to the cache.  The processor's return value is
 * serialized and returned to the caller.
 */
export class CacheEntryProcessorExecutor {
    constructor(
        private readonly _ss: SerializationService,
        private readonly _cacheService: DistributedCacheService,
    ) {}

    /**
     * Invokes a single-key entry processor.
     *
     * @param cacheName    The name of the target cache.
     * @param key          The key to operate on (already serialized as Data).
     * @param processorData The serialized {@link CacheEntryProcessor}.
     * @param args         Additional arguments passed to the processor (serialized).
     * @returns The serialized result of {@link CacheEntryProcessor.process}, or
     *          {@code null} if the processor returned null / void.
     */
    async invoke(
        cacheName: string,
        key: Data,
        processorData: Data,
        args: Data[],
    ): Promise<Data | null> {
        // Deserialize the processor
        const processor = this._ss.toObject(processorData) as CacheEntryProcessor<Data, Data, unknown>;

        // Fetch the current value
        const currentValue = await this._cacheService.get(cacheName, key);

        // Build a mutable entry wrapper
        const entry = new MutableCacheEntryImpl(key, currentValue, this._ss);

        // Deserialize args
        const deserializedArgs = args.map((a) => this._ss.toObject(a));

        // Execute the processor
        const result = processor.process(entry, ...deserializedArgs);

        // Apply mutations
        await this._applyMutation(cacheName, key, entry);

        // Serialize and return the result
        if (result === null || result === undefined) return null;
        return this._ss.toData(result);
    }

    /**
     * Invokes a single entry processor across multiple keys.
     *
     * @returns A map of key → serialized result (null entries omitted).
     */
    async invokeAll(
        cacheName: string,
        keys: Data[],
        processorData: Data,
        args: Data[],
    ): Promise<Map<Data, Data | null>> {
        const results = new Map<Data, Data | null>();
        for (const key of keys) {
            const result = await this.invoke(cacheName, key, processorData, args);
            results.set(key, result);
        }
        return results;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async _applyMutation(
        cacheName: string,
        key: Data,
        entry: MutableCacheEntryImpl,
    ): Promise<void> {
        const mutation = entry.getMutation();
        if (mutation === null) return;

        if (mutation.kind === 'set') {
            await this._cacheService.put(cacheName, key, mutation.value);
        } else if (mutation.kind === 'remove') {
            await this._cacheService.remove(cacheName, key);
        }
    }
}
