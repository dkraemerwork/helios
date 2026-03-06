/**
 * Port of {@code com.hazelcast.map.impl.recordstore.DefaultRecordStore} (minimal).
 *
 * In-memory single-partition record store backed by a plain Map.
 * Keys are compared by their serialized byte representation (base64 string),
 * which is deterministic for all TestSerializationService-produced Data objects.
 *
 * Thread safety: Bun is single-threaded; no locking required.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import type { EntryProcessor, MapEntry } from '@zenystx/helios-core/map/EntryProcessor';

interface Entry {
    key: Data;
    value: Data;
}

export class DefaultRecordStore implements RecordStore {
    /**
     * Keyed by the base64 representation of the Data payload.
     * This gives us content-equality semantics without referencing the Data.equals()
     * method on every lookup — sufficient for single-node in-process use.
     */
    private readonly _data = new Map<string, Entry>();

    // ── internal key helper ───────────────────────────────────────────────

    private _key(data: Data): string {
        const buf = data.toByteArray();
        return buf != null ? buf.toString('base64') : '';
    }

    // ── RecordStore interface ─────────────────────────────────────────────

    get(key: Data): Data | null {
        return this._data.get(this._key(key))?.value ?? null;
    }

    put(key: Data, value: Data, _ttl: number, _maxIdle: number): Data | null {
        const k = this._key(key);
        const old = this._data.get(k)?.value ?? null;
        this._data.set(k, { key, value });
        return old;
    }

    set(key: Data, value: Data, _ttl: number, _maxIdle: number): void {
        this._data.set(this._key(key), { key, value });
    }

    putIfAbsent(key: Data, value: Data, _ttl: number, _maxIdle: number): Data | null {
        const k = this._key(key);
        const existing = this._data.get(k);
        if (existing !== undefined) {
            return existing.value;
        }
        this._data.set(k, { key, value });
        return null;
    }

    remove(key: Data): Data | null {
        const k = this._key(key);
        const existing = this._data.get(k);
        if (existing === undefined) return null;
        this._data.delete(k);
        return existing.value;
    }

    delete(key: Data): boolean {
        return this._data.delete(this._key(key));
    }

    containsKey(key: Data): boolean {
        return this._data.has(this._key(key));
    }

    containsValue(value: Data): boolean {
        for (const entry of this._data.values()) {
            if (entry.value.equals(value)) return true;
        }
        return false;
    }

    putAll(entries: ReadonlyArray<readonly [Data, Data]>): void {
        for (const [k, v] of entries) {
            this._data.set(this._key(k), { key: k, value: v });
        }
    }

    getAll(keys: ReadonlyArray<Data>): Array<readonly [Data, Data | null]> {
        return keys.map(k => [k, this.get(k)] as const);
    }

    executeOnKey<R>(key: Data, processor: EntryProcessor<R>): R | null {
        const k = this._key(key);
        let currentValue: Data | null = this._data.get(k)?.value ?? null;
        let newValue: Data | null | undefined;

        const entry: MapEntry = {
            getKey: () => key,
            getValue: () => currentValue,
            setValue: (v: Data | null) => {
                newValue = v;
                currentValue = v;
            },
            exists: () => currentValue !== null,
        };

        const result = processor.process(entry);

        if (newValue !== undefined) {
            if (newValue === null) {
                this._data.delete(k);
            } else {
                this._data.set(k, { key, value: newValue });
            }
        }

        return result;
    }

    executeOnEntries<R>(processor: EntryProcessor<R>): Array<readonly [Data, R | null]> {
        const results: Array<readonly [Data, R | null]> = [];
        // Snapshot to avoid modifying the map while iterating.
        const snapshot = [...this._data.entries()];
        for (const [strKey, { key, value }] of snapshot) {
            let currentValue: Data | null = value;
            let newValue: Data | null | undefined;

            const entry: MapEntry = {
                getKey: () => key,
                getValue: () => currentValue,
                setValue: (v: Data | null) => {
                    newValue = v;
                    currentValue = v;
                },
                exists: () => currentValue !== null,
            };

            const result = processor.process(entry);

            if (newValue !== undefined) {
                if (newValue === null) {
                    this._data.delete(strKey);
                } else {
                    this._data.set(strKey, { key, value: newValue });
                }
            }

            results.push([key, result]);
        }
        return results;
    }

    size(): number {
        return this._data.size;
    }

    isEmpty(): boolean {
        return this._data.size === 0;
    }

    clear(): void {
        this._data.clear();
    }

    entries(): IterableIterator<readonly [Data, Data]> {
        return (function* (data: Map<string, Entry>) {
            for (const { key, value } of data.values()) {
                yield [key, value] as const;
            }
        })(this._data);
    }
}
