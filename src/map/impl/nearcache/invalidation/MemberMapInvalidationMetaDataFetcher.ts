/**
 * Port of {@code com.hazelcast.map.impl.nearcache.invalidation.MemberMapInvalidationMetaDataFetcher}.
 *
 * Member-side implementation of {@link InvalidationMetaDataFetcher}.
 * In single-node mode, there are no remote members to fetch metadata from,
 * so init() returns true immediately and fetchMetadata() is a no-op.
 *
 * In Phase 4+ (multi-node), this would invoke MapGetInvalidationMetaDataOperation
 * on each data member to retrieve partition UUIDs and sequences.
 */
import type { InvalidationMetaDataFetcher } from '@helios/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { RepairingHandler } from '@helios/internal/nearcache/impl/invalidation/RepairingHandler';

export class MemberMapInvalidationMetaDataFetcher implements InvalidationMetaDataFetcher {
    /**
     * Synchronously initialises a repairing handler with current metadata.
     * In single-node mode there is no remote state to fetch so we return true
     * (initialized successfully) immediately.
     */
    init(_handler: RepairingHandler): boolean {
        // Single-node: no remote metadata to fetch; handler is initialised with defaults.
        return true;
    }

    /**
     * Periodically fetches metadata for all registered handlers.
     * In single-node mode this is a no-op.
     */
    fetchMetadata(_handlers: Map<string, RepairingHandler>): void {
        // No-op in single-node mode.
    }
}
