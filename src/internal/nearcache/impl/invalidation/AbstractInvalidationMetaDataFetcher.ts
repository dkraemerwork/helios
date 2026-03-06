/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.InvalidationMetaDataFetcher}
 * (the abstract class, not the interface).
 *
 * Provides the template-method implementation for both client-side and member-side
 * near-cache metadata fetching. Concrete subclasses provide the data-member list and
 * the member-specific fetch logic.
 *
 * Template method pattern:
 * - {@link getDataMembers}     — returns the list of cluster members to query
 * - {@link fetchMemberResponse} — fetches metadata from a single member
 */
import type { InvalidationMetaDataFetcher } from '@zenystx/core/internal/nearcache/impl/invalidation/InvalidationMetaDataFetcher';
import type { RepairingHandler } from '@zenystx/core/internal/nearcache/impl/invalidation/RepairingHandler';

/** Shared metadata response shape — matches both Map and Cache operation responses. */
export interface InvalidationMetaDataResponse {
    /** data-structure-name → list of [partitionId, sequence] pairs */
    namePartitionSequenceList: Map<string, [number, number][]>;
    /** partitionId → UUID */
    partitionUuidList: Map<number, string>;
}

/** Minimal cluster-member abstraction needed by the fetcher. */
export interface AbstractDataMember {
    uuid: string;
}

export abstract class AbstractInvalidationMetaDataFetcher<M extends AbstractDataMember>
    implements InvalidationMetaDataFetcher {

    /** Returns the list of data members to query for metadata. */
    abstract getDataMembers(): M[];

    /**
     * Fetches invalidation metadata from a single member for the given data-structure names.
     * @throws if communication with the member fails
     */
    abstract fetchMemberResponse(member: M, names: string[]): InvalidationMetaDataResponse;

    /**
     * Initialises a single RepairingHandler with current metadata from all data members.
     * Returns true if at least one member responded successfully, false otherwise.
     *
     * Port of {@code InvalidationMetaDataFetcher.init}.
     */
    init(handler: RepairingHandler): boolean {
        const names = [handler.getName()];
        const members = this.getDataMembers();
        let initialised = false;

        for (const member of members) {
            try {
                const response = this.fetchMemberResponse(member, names);
                this._initUuid(response.partitionUuidList, handler);
                this._initSequence(response.namePartitionSequenceList, handler);
                initialised = true;
            } catch {
                // handleExceptionWhileProcessingMetadata: swallow and continue
            }
        }

        return initialised || members.length === 0;
    }

    /**
     * Periodically fetches metadata for all registered handlers and repairs any divergence.
     *
     * Port of {@code InvalidationMetaDataFetcher.fetchMetadata}.
     */
    fetchMetadata(handlers: Map<string, RepairingHandler>): void {
        if (handlers.size === 0) {
            return;
        }

        const names = [...handlers.values()].map(h => h.getName());
        const members = this.getDataMembers();

        for (const member of members) {
            try {
                const response = this.fetchMemberResponse(member, names);
                this._repairUuids(response.partitionUuidList, handlers);
                this._repairSequences(response.namePartitionSequenceList, handlers);
            } catch {
                // handleExceptionWhileProcessingMetadata: swallow and continue
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Private helpers — port of InvalidationMetaDataFetcher private methods
    // ──────────────────────────────────────────────────────────────────────

    private _initUuid(partitionUuidList: Map<number, string>, handler: RepairingHandler): void {
        for (const [partitionId, uuid] of partitionUuidList) {
            handler.initUuid(partitionId, uuid);
        }
    }

    private _initSequence(
        namePartitionSequenceList: Map<string, [number, number][]>,
        handler: RepairingHandler,
    ): void {
        for (const partEntries of namePartitionSequenceList.values()) {
            for (const [partitionId, sequence] of partEntries) {
                handler.initSequence(partitionId, sequence);
            }
        }
    }

    private _repairUuids(
        partitionUuidList: Map<number, string>,
        handlers: Map<string, RepairingHandler>,
    ): void {
        for (const [partitionId, uuid] of partitionUuidList) {
            for (const handler of handlers.values()) {
                handler.checkOrRepairUuid(partitionId, uuid);
            }
        }
    }

    private _repairSequences(
        namePartitionSequenceList: Map<string, [number, number][]>,
        handlers: Map<string, RepairingHandler>,
    ): void {
        for (const [name, partEntries] of namePartitionSequenceList) {
            const handler = handlers.get(name);
            if (handler === undefined) continue;
            for (const [partitionId, sequence] of partEntries) {
                handler.checkOrRepairSequence(partitionId, sequence, true);
            }
        }
    }
}
