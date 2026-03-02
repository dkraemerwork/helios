/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationUtils}.
 *
 * Utility constants and helpers for Near Cache invalidation.
 */

export type EventRegistration = { getId(): string };

export class InvalidationUtils {
    /** Sentinel value for "no sequence assigned". */
    static readonly NO_SEQUENCE = -1;

    /** Filter that accepts all event registrations. */
    static readonly TRUE_FILTER = (_registration: EventRegistration): boolean => true;

    private constructor() {}
}
