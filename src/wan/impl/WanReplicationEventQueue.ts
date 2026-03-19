/**
 * Bounded FIFO queue for WAN replication events.
 *
 * Overflow behavior is controlled by {@link WanQueueFullBehavior}:
 * - DISCARD_AFTER_MUTATION: silently drop new events when full
 * - THROW_EXCEPTION: always throw when full
 * - THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE: throw only when publisher is connected
 */
import { WanQueueFullBehavior } from '@zenystx/helios-core/config/WanReplicationConfig.js';
import type { WanReplicationEvent } from '@zenystx/helios-core/wan/WanReplicationEvent.js';

export class WanReplicationEventQueue {
    private readonly _capacity: number;
    private readonly _behavior: WanQueueFullBehavior;
    private readonly _items: WanReplicationEvent[] = [];
    private _publisherActive = false;

    constructor(capacity: number, behavior: WanQueueFullBehavior) {
        if (capacity <= 0) {
            throw new Error(`WanReplicationEventQueue capacity must be > 0, was: ${capacity}`);
        }
        this._capacity = capacity;
        this._behavior = behavior;
    }

    /**
     * Returns the configured queue full behavior.
     */
    getQueueFullBehavior(): WanQueueFullBehavior {
        return this._behavior;
    }

    /**
     * Set whether a publisher is currently connected to the target.
     * Affects THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE behavior.
     */
    setPublisherActive(active: boolean): void {
        this._publisherActive = active;
    }

    /**
     * Attempt to enqueue an event.
     *
     * @returns true if the event was accepted; false if it was silently discarded.
     * @throws Error if the queue is full and the configured behavior demands it.
     */
    offer(event: WanReplicationEvent): boolean {
        if (this._items.length >= this._capacity) {
            switch (this._behavior) {
                case WanQueueFullBehavior.DISCARD_AFTER_MUTATION:
                    return false;
                case WanQueueFullBehavior.THROW_EXCEPTION:
                    throw new Error(
                        `WAN replication event queue is full (capacity=${this._capacity}). ` +
                        'Configure a larger queueCapacity or adjust queueFullBehavior.',
                    );
                case WanQueueFullBehavior.THROW_EXCEPTION_ONLY_IF_REPLICATION_ACTIVE:
                    if (this._publisherActive) {
                        throw new Error(
                            `WAN replication event queue is full (capacity=${this._capacity}) ` +
                            'and publisher is active. ' +
                            'Configure a larger queueCapacity or adjust queueFullBehavior.',
                        );
                    }
                    return false;
            }
        }
        this._items.push(event);
        return true;
    }

    /**
     * Drain up to {@code maxItems} events from the front of the queue.
     * The drained items are removed permanently.
     */
    drainTo(maxItems: number): WanReplicationEvent[] {
        if (maxItems <= 0 || this._items.length === 0) {
            return [];
        }
        const count = Math.min(maxItems, this._items.length);
        return this._items.splice(0, count);
    }

    /**
     * Returns the number of events currently in the queue.
     */
    size(): number {
        return this._items.length;
    }

    /**
     * Removes all events from the queue.
     */
    clear(): void {
        this._items.length = 0;
    }

    /**
     * Returns true when the queue has reached its maximum capacity.
     */
    isFull(): boolean {
        return this._items.length >= this._capacity;
    }
}
