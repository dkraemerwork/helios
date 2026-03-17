/**
 * Port of {@code com.hazelcast.map.MapInterceptor}.
 *
 * Provides synchronous hooks into IMap CRUD operations.
 * - intercept* methods return a replacement value (null = no change)
 * - after* methods are fire-and-forget callbacks
 */
export interface MapInterceptor {
    /**
     * Called before map.get() returns the value.
     * Return non-null to replace the returned value.
     */
    interceptGet(value: unknown): unknown;

    /**
     * Called after map.get() completes.
     */
    afterGet(value: unknown): void;

    /**
     * Called before map.put() stores the value.
     * Return non-null to replace the stored value.
     */
    interceptPut(oldValue: unknown, newValue: unknown): unknown;

    /**
     * Called after map.put() completes.
     */
    afterPut(value: unknown): void;

    /**
     * Called before map.remove() deletes the entry.
     * Return non-null to replace the removed value.
     */
    interceptRemove(removedValue: unknown): unknown;

    /**
     * Called after map.remove() completes.
     */
    afterRemove(value: unknown): void;
}
