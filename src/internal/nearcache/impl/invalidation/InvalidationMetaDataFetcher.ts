/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationMetaDataFetcher}.
 *
 * Runs on Near Cache side; responsible for fetching all Near Caches' remote metadata
 * like last sequence numbers and partition UUIDs.
 */
import type { RepairingHandler } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/RepairingHandler';

export interface InvalidationMetaDataFetcher {
    /**
     * Synchronously initializes a repairing handler with current metadata.
     * @returns true if initialized successfully, false on failure
     */
    init(handler: RepairingHandler): boolean;

    /**
     * Periodically fetches metadata for all registered handlers.
     */
    fetchMetadata(handlers: Map<string, RepairingHandler>): void;
}
