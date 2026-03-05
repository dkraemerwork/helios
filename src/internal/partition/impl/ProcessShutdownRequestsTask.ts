/**
 * Port of the shutdown-request processing logic from
 * {@code com.hazelcast.internal.partition.impl.MigrationManager} (lines 621-635).
 *
 * Periodic task on master: for each member in shutdownRequestedMembers,
 * checks if the member owns zero partitions. If so, sends a shutdown
 * acknowledgement and removes the member from the set.
 *
 * Block 16.B5 — Graceful Shutdown Protocol
 */
import type { Address } from '@helios/cluster/Address';
import type { ShutdownRequestHandler } from '@helios/internal/partition/impl/ShutdownRequestHandler';
import type { InternalPartitionServiceImpl } from '@helios/internal/partition/impl/InternalPartitionServiceImpl';

export class ProcessShutdownRequestsTask {
    private readonly _handler: ShutdownRequestHandler;
    private readonly _partitionService: InternalPartitionServiceImpl;
    private readonly _sendResponse: (address: Address) => void;

    constructor(
        handler: ShutdownRequestHandler,
        partitionService: InternalPartitionServiceImpl,
        sendResponse: (address: Address) => void,
    ) {
        this._handler = handler;
        this._partitionService = partitionService;
        this._sendResponse = sendResponse;
    }

    /**
     * Check each shutdown-requested member. If they own zero partitions,
     * send the shutdown ack and remove them from the set.
     */
    run(): void {
        const requested = this._handler.getShutdownRequestedAddresses();
        for (const [, address] of requested) {
            const partitions = this._partitionService.getMemberPartitions(address);
            if (partitions.length === 0) {
                this._sendResponse(address);
                this._handler.removeShutdownRequest(address);
            }
        }
    }
}
