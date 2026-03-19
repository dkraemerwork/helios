/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.preloader.NearCachePreloader}.
 *
 * Persists Near Cache keys to disk on shutdown and reloads them on startup,
 * so the cache can be warmed up without going to the backing store.
 *
 * File format (little-endian):
 *   [4 bytes] magic   = 0x4E435052  ("NCPR")
 *   [2 bytes] version = 1
 *   [4 bytes] entry count N
 *   N times:
 *     [4 bytes] key byte length L
 *     [L bytes] key bytes
 */
import type { NearCachePreloaderConfig } from '@zenystx/helios-core/config/NearCachePreloaderConfig';
import type { NearCacheStatsImpl } from '@zenystx/helios-core/internal/monitor/impl/NearCacheStatsImpl';
import type { DefaultNearCache } from '@zenystx/helios-core/internal/nearcache/impl/DefaultNearCache';
import type { NearCachePreloaderLock } from '@zenystx/helios-core/internal/nearcache/impl/preloader/NearCachePreloaderLock';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAGIC = 0x4E435052; // "NCPR"
const VERSION = 1;
const HEADER_SIZE = 4 + 2 + 4; // magic(4) + version(2) + count(4)

export class NearCachePreloader {
    private readonly _config: NearCachePreloaderConfig;
    private readonly _directory: string;
    private readonly _lock: NearCachePreloaderLock;
    private _intervalHandle: ReturnType<typeof setInterval> | null = null;

    constructor(config: NearCachePreloaderConfig, lock: NearCachePreloaderLock) {
        this._config = config;
        this._lock = lock;
        this._directory = config.getDirectory() !== '' ? config.getDirectory() : tmpdir();
        this._ensureDirectory();
    }

    private _ensureDirectory(): void {
        if (!existsSync(this._directory)) {
            mkdirSync(this._directory, { recursive: true });
        }
    }

    private _storePath(nearCacheName: string): string {
        return join(this._directory, `${nearCacheName}.ncpreload`);
    }

    /**
     * Persist all current near cache keys to disk.
     * Collects key byte arrays from the record store and writes the binary file.
     */
    async store(nearCache: DefaultNearCache<unknown, unknown>): Promise<void> {
        const startTime = Date.now();
        const stats = nearCache.getNearCacheStats() as NearCacheStatsImpl;
        const storePath = this._storePath(nearCache.getName());

        try {
            const keyBuffers = this._collectKeyBuffers(nearCache);
            const count = keyBuffers.length;

            // Calculate total buffer size
            let totalBytes = HEADER_SIZE;
            for (const buf of keyBuffers) {
                totalBytes += 4 + buf.length;
            }

            const outBuf = Buffer.allocUnsafe(totalBytes);
            let offset = 0;

            // Write header
            outBuf.writeUInt32BE(MAGIC, offset); offset += 4;
            outBuf.writeUInt16BE(VERSION, offset); offset += 2;
            outBuf.writeUInt32BE(count, offset); offset += 4;

            // Write each key
            for (const buf of keyBuffers) {
                outBuf.writeUInt32BE(buf.length, offset); offset += 4;
                buf.copy(outBuf, offset); offset += buf.length;
            }

            await Bun.write(storePath, outBuf);

            const duration = Date.now() - startTime;
            if (typeof stats.addPersistence === 'function') {
                stats.addPersistence(duration, totalBytes, count);
            }
        } catch (err: unknown) {
            if (typeof stats.addPersistenceFailure === 'function') {
                stats.addPersistenceFailure(err instanceof Error ? err : new Error(String(err)));
            }
        }
    }

    /**
     * Read the preload file and return an array of key Buffer instances.
     * Returns an empty array if the file doesn't exist or is corrupt.
     */
    async load(nearCacheName: string): Promise<Buffer[]> {
        const storePath = this._storePath(nearCacheName);

        if (!existsSync(storePath)) {
            return [];
        }

        try {
            const raw = await Bun.file(storePath).arrayBuffer();
            const buf = Buffer.from(raw);

            if (buf.length < HEADER_SIZE) return [];

            const magic = buf.readUInt32BE(0);
            if (magic !== MAGIC) return [];

            const version = buf.readUInt16BE(4);
            if (version !== VERSION) return [];

            const count = buf.readUInt32BE(6);
            const keys: Buffer[] = [];
            let offset = HEADER_SIZE;

            for (let i = 0; i < count; i++) {
                if (offset + 4 > buf.length) break;
                const keyLen = buf.readUInt32BE(offset); offset += 4;
                if (offset + keyLen > buf.length) break;
                keys.push(buf.subarray(offset, offset + keyLen));
                offset += keyLen;
            }

            return keys;
        } catch {
            return [];
        }
    }

    /**
     * Start a periodic store task.
     * Waits storeInitialDelaySeconds, then fires every storeIntervalSeconds.
     */
    startPeriodicStore(nearCache: DefaultNearCache<unknown, unknown>): void {
        const initialDelayMs = this._config.getStoreInitialDelaySeconds() * 1000;
        const intervalMs = this._config.getStoreIntervalSeconds() * 1000;

        const startInterval = (): void => {
            this._intervalHandle = setInterval(() => {
                void this.store(nearCache);
            }, intervalMs);
        };

        // Use setTimeout for the initial delay, then switch to setInterval
        setTimeout(() => {
            void this.store(nearCache);
            startInterval();
        }, initialDelayMs);
    }

    /** Cancel the periodic store interval. */
    stopPeriodicStore(): void {
        if (this._intervalHandle !== null) {
            clearInterval(this._intervalHandle);
            this._intervalHandle = null;
        }
        this._lock.release();
    }

    /** Remove the preload file for a named near cache. */
    async deleteStoreFile(nearCacheName: string): Promise<void> {
        const storePath = this._storePath(nearCacheName);
        try {
            if (existsSync(storePath)) {
                unlinkSync(storePath);
            }
        } catch {
            // Ignore deletion errors
        }
    }

    /**
     * Collect serialized key byte buffers from the near cache record store.
     * Only keys that are Data instances (have toByteArray) are persisted.
     */
    private _collectKeyBuffers(nearCache: DefaultNearCache<unknown, unknown>): Buffer[] {
        const store = nearCache.getNearCacheRecordStore();
        const buffers: Buffer[] = [];

        // Access the underlying records map via the store's entries iterator
        // BaseHeapNearCacheRecordStore exposes getRecord(key) and size(),
        // but not direct key iteration. We need to iterate records.
        // The store is cast to access protected `records` field indirectly
        // through the record map iteration exposed by getRecordsIterator.
        const storeAsAny = store as unknown as Record<string, unknown>;

        // BaseHeapNearCacheRecordStore keeps keys in a HeapNearCacheRecordMap
        // accessible as `records` (protected). We reach it via duck typing.
        const recordMap = storeAsAny['records'] as
            | { entries(): IterableIterator<[unknown, unknown]> }
            | undefined;

        if (recordMap === undefined || typeof recordMap.entries !== 'function') {
            return buffers;
        }

        for (const [key] of recordMap.entries()) {
            // Only persist Data keys (have toByteArray method)
            if (key != null && typeof (key as Record<string, unknown>)['toByteArray'] === 'function') {
                const data = key as { toByteArray(): Buffer | null };
                const bytes = data.toByteArray();
                if (bytes !== null && bytes.length > 0) {
                    buffers.push(bytes);
                }
            }
        }

        return buffers;
    }
}
