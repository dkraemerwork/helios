import type { QueueStore } from '@zenystx/helios-core/collection/QueueStore.js';

/**
 * Thin wrapper around {@link QueueStore} that provides convenience methods
 * for write-through integration in the queue service.
 */
export class QueueStoreWrapper<T> {
    private readonly _store: QueueStore<T>;

    constructor(store: QueueStore<T>) {
        this._store = store;
    }

    async store(key: number, value: T): Promise<void> {
        await this._store.store(key, value);
    }

    async storeAll(map: Map<number, T>): Promise<void> {
        if (map.size > 0) {
            await this._store.storeAll(map);
        }
    }

    async delete(key: number): Promise<void> {
        await this._store.delete(key);
    }

    async deleteAll(keys: Set<number>): Promise<void> {
        if (keys.size > 0) {
            await this._store.deleteAll(keys);
        }
    }

    async loadAll(): Promise<Map<number, T>> {
        const keys = await this._store.loadAllKeys();
        if (keys.size === 0) return new Map();
        return this._store.loadAll(keys);
    }

    getDelegate(): QueueStore<T> {
        return this._store;
    }
}
