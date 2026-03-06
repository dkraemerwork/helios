/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.preloader.NearCachePreloaderLock}.
 *
 * File-based lock for Near Cache preloader. Ensures only one process/instance
 * uses a given Near Cache preloader directory at a time.
 *
 * In TypeScript (Node.js/Bun) we use atomic file creation (O_CREAT | O_EXCL) instead of
 * Java NIO FileChannel.tryLock(). The semantics map directly:
 *   - tryLock returns null  → file already exists → HeliosException("another Hazelcast instance")
 *   - tryLock throws EEXIST  → treated same as above
 *   - release()              → deletes the lock file
 */
import { openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { HeliosException } from '@zenystx/helios-core/core/exception/HeliosException';

export interface ILogger {
    warning(msg: string): void;
    fine(msg: string): void;
}

export class NearCachePreloaderLock {
    private readonly _logger: ILogger;
    private readonly _lockFilePath: string;
    private _locked = false;

    constructor(logger: ILogger, lockFilePath: string) {
        this._logger = logger;
        this._lockFilePath = lockFilePath;
        this._acquireLock();
    }

    private _acquireLock(): void {
        try {
            // O_CREAT | O_EXCL — fails with EEXIST if file already exists
            const fd = openSync(this._lockFilePath, 'wx');
            closeSync(fd);
            this._locked = true;
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') {
                throw new HeliosException(
                    `File is already being used by another Hazelcast instance. File: ${this._lockFilePath}`
                );
            }
            throw new HeliosException(
                `Unknown failure while acquiring lock on ${this._lockFilePath}: ${(err as Error).message}`
            );
        }
    }

    release(): void {
        if (!this._locked) return;
        try {
            if (existsSync(this._lockFilePath)) {
                unlinkSync(this._lockFilePath);
            }
        } catch (err: unknown) {
            this._logger.warning(`Failed to release Near Cache preloader lock: ${(err as Error).message}`);
        } finally {
            this._locked = false;
        }
    }
}
