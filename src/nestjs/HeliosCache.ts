/**
 * NestJS/cache-manager store backed by a Helios IMap.
 * Port of {@code com.hazelcast.spring.cache.HazelcastCache}.
 *
 * Implements {@link KeyvStoreAdapter} so it can be wrapped in a `Keyv`
 * instance and passed to `CacheModule.register({ stores: [...] })`.
 */

import type { KeyvStoreAdapter, StoredData } from 'keyv';

// ---------------------------------------------------------------------------
// IMap — minimal duck-type interface required by HeliosCache.
// The full IMap lives in the distributed data layer; we reference only the
// async CRUD surface needed for cache operations.
// ---------------------------------------------------------------------------

export interface IHeliosCacheMap {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    has?(key: string): Promise<boolean>;
    keys?(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// HeliosCache — KeyvStoreAdapter implementation
// ---------------------------------------------------------------------------

export class HeliosCache implements KeyvStoreAdapter {
    opts: Record<string, unknown> = {};
    namespace?: string;

    constructor(private readonly _map: IHeliosCacheMap) {}

    async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
        const value = await this._map.get(key);
        return value as StoredData<Value> | undefined;
    }

    async set(key: string, value: unknown, ttl?: number): Promise<boolean> {
        await this._map.set(key, value, ttl);
        return true;
    }

    async delete(key: string): Promise<boolean> {
        return this._map.delete(key);
    }

    async clear(): Promise<void> {
        await this._map.clear();
    }

    async has(key: string): Promise<boolean> {
        if (this._map.has) {
            return this._map.has(key);
        }
        return (await this._map.get(key)) !== undefined;
    }

    async getMany<Value>(keys: string[]): Promise<Array<StoredData<Value | undefined>>> {
        return Promise.all(keys.map(k => this.get<Value>(k)));
    }

    async deleteMany(keys: string[]): Promise<boolean> {
        await Promise.all(keys.map(k => this._map.delete(k)));
        return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    on(_event: string, _listener: (...args: unknown[]) => void): this {
        // Event support is optional for basic cache use cases.
        return this;
    }
}
