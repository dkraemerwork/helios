/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationQueue}.
 *
 * A simple FIFO queue for invalidation events.
 * Single-threaded (Bun) — no locking needed.
 */

export class InvalidationQueue<T> {
    private readonly _items: T[] = [];
    private _acquired = false;

    offer(item: T): void {
        this._items.push(item);
    }

    poll(): T | null {
        return this._items.shift() ?? null;
    }

    size(): number {
        return this._items.length;
    }

    isEmpty(): boolean {
        return this._items.length === 0;
    }

    /** Try to acquire exclusive drain rights. Returns false if already acquired. */
    tryAcquire(): boolean {
        if (this._acquired) return false;
        this._acquired = true;
        return true;
    }

    release(): void {
        this._acquired = false;
    }
}
