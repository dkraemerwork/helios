/**
 * Port of graceful shutdown request handling from
 * {@code com.hazelcast.internal.partition.impl.InternalPartitionServiceImpl}.
 *
 * Tracks members that have requested graceful shutdown so the master can
 * exclude them from repartitioning and acknowledge once their partitions
 * have been migrated away.
 *
 * Block 16.B5 — Graceful Shutdown Protocol
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { InternalPartitionServiceImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl';

export class ShutdownRequestHandler {
    private readonly _partitionService: InternalPartitionServiceImpl;
    private readonly _shutdownRequested = new Map<string, Address>();

    constructor(partitionService: InternalPartitionServiceImpl) {
        this._partitionService = partitionService;
    }

    /**
     * Register a shutdown request for the given member address.
     * Idempotent — duplicate calls are safe.
     */
    requestShutdown(address: Address): void {
        this._shutdownRequested.set(address.toString(), address);
    }

    /**
     * Check if a member has requested graceful shutdown.
     */
    isShutdownRequested(address: Address): boolean {
        return this._shutdownRequested.has(address.toString());
    }

    /**
     * Remove a member from the shutdown-requested set
     * (called after ack is sent or member actually leaves).
     */
    removeShutdownRequest(address: Address): void {
        this._shutdownRequested.delete(address.toString());
    }

    /**
     * Returns all addresses that have requested shutdown.
     */
    getShutdownRequestedAddresses(): Map<string, Address> {
        return new Map(this._shutdownRequested);
    }
}
