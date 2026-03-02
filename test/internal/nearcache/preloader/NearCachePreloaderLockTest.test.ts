/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.preloader.NearCachePreloaderLockTest}.
 *
 * Tests file-based locking semantics adapted for TypeScript (O_CREAT|O_EXCL instead of NIO tryLock).
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NearCachePreloaderLock } from '@helios/internal/nearcache/impl/preloader/NearCachePreloaderLock';
import type { ILogger } from '@helios/internal/nearcache/impl/preloader/NearCachePreloaderLock';
import { HeliosException } from '@helios/core/exception/HeliosException';

const noopLogger: ILogger = {
    warning: () => {},
    fine: () => {},
};

const testDir = join(tmpdir(), `helios-lock-test-${process.pid}`);

function lockPath(name: string): string {
    return join(testDir, `${name}.lock`);
}

describe('NearCachePreloaderLockTest', () => {
    // Ensure test dir exists before each test
    beforeEach_setup();

    afterEach(() => {
        // Clean up all lock files
        try {
            for (const name of ['test', 'test2', 'double']) {
                const p = lockPath(name);
                if (existsSync(p)) unlinkSync(p);
            }
        } catch { /* ignore */ }
    });

    it('acquireLock_succeeds_onNewPath', () => {
        const path = lockPath('test');
        let lock: NearCachePreloaderLock | null = null;
        expect(() => {
            lock = new NearCachePreloaderLock(noopLogger, path);
        }).not.toThrow();
        lock!.release();
    });

    it('acquireLock_throws_whenAlreadyLocked', () => {
        const path = lockPath('double');
        const lock1 = new NearCachePreloaderLock(noopLogger, path);
        try {
            expect(() => {
                new NearCachePreloaderLock(noopLogger, path);
            }).toThrow(HeliosException);
        } finally {
            lock1.release();
        }
    });

    it('release_removesLockFile', () => {
        const path = lockPath('test2');
        const lock = new NearCachePreloaderLock(noopLogger, path);
        expect(existsSync(path)).toBe(true);
        lock.release();
        expect(existsSync(path)).toBe(false);
    });

    it('release_afterRelease_doesNotThrow', () => {
        const path = lockPath('test');
        const lock = new NearCachePreloaderLock(noopLogger, path);
        lock.release();
        expect(() => lock.release()).not.toThrow();
    });

    it('acquireAfterRelease_succeeds', () => {
        const path = lockPath('test');
        const lock1 = new NearCachePreloaderLock(noopLogger, path);
        lock1.release();

        let lock2: NearCachePreloaderLock | null = null;
        expect(() => {
            lock2 = new NearCachePreloaderLock(noopLogger, path);
        }).not.toThrow();
        lock2!.release();
    });
});

function beforeEach_setup() {
    // Bun:test doesn't have a direct beforeAll/beforeEach module-level hook for this,
    // so we create the dir once on module load.
    if (!existsSync(testDir)) {
        mkdirSync(testDir, { recursive: true });
    }
}
// Call it now at module init
beforeEach_setup();
