/**
 * Port of {@code com.hazelcast.core.ManagedContext}.
 *
 * Functional interface that initializes deserialized instances.
 * Used for container-managed contexts (Spring, Guice, NestJS module injection).
 *
 * The returned object may be a proxy wrapping the original — callers must use
 * the returned reference, not the original.
 */
export interface ManagedContext {
    /**
     * Initialize the given instance.
     *
     * @param obj  The object to initialize (never null in practice, but
     *             implementations should handle it gracefully).
     * @returns    The initialized object (may be a proxy or the same reference).
     */
    initialize(obj: unknown): unknown;
}
