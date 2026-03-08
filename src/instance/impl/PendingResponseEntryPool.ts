const MAX_POOLED_ENTRIES = 1024;

export interface PendingResponseEntry {
    resolve: ((value: unknown) => void) | null;
    reject: ((error: Error) => void) | null;
    createdAt: number;
    timeoutMs: number;
}

export class PendingResponseEntryPool {
    private readonly _pool: PendingResponseEntry[] = [];

    take(
        resolve: (value: unknown) => void,
        reject: (error: Error) => void,
        timeoutMs: number,
        createdAt: number = Date.now(),
    ): PendingResponseEntry {
        const entry = this._pool.pop() ?? {
            resolve: null,
            reject: null,
            createdAt: 0,
            timeoutMs: 0,
        };
        entry.resolve = resolve;
        entry.reject = reject;
        entry.createdAt = createdAt;
        entry.timeoutMs = timeoutMs;
        return entry;
    }

    release(entry: PendingResponseEntry | null | undefined): void {
        if (entry == null) {
            return;
        }
        entry.resolve = null;
        entry.reject = null;
        entry.createdAt = 0;
        entry.timeoutMs = 0;
        if (this._pool.length < MAX_POOLED_ENTRIES) {
            this._pool.push(entry);
        }
    }

    clear(): void {
        this._pool.length = 0;
    }
}
