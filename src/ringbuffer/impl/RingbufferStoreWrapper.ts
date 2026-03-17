import type { RingbufferStore } from '@zenystx/helios-core/ringbuffer/RingbufferStore.js';

/**
 * Thin wrapper around {@link RingbufferStore} that provides convenience methods
 * for write-through integration in the ringbuffer service.
 */
export class RingbufferStoreWrapper<T> {
    private readonly _store: RingbufferStore<T>;

    constructor(store: RingbufferStore<T>) {
        this._store = store;
    }

    async store(sequence: bigint, data: T): Promise<void> {
        await this._store.store(sequence, data);
    }

    async storeAll(items: Map<bigint, T>): Promise<void> {
        if (items.size > 0) {
            await this._store.storeAll(items);
        }
    }

    async load(sequence: bigint): Promise<T | null> {
        return this._store.load(sequence);
    }

    async loadAll(sequences: Set<bigint>): Promise<Map<bigint, T>> {
        if (sequences.size === 0) return new Map();
        return this._store.loadAll(sequences);
    }

    async getLargestSequence(): Promise<bigint> {
        return this._store.getLargestSequence();
    }

    getDelegate(): RingbufferStore<T> {
        return this._store;
    }
}
