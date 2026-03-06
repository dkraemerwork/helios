/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.PartitionInvocation}.
 *
 * An invocation targeting a specific partition. On each retry, re-reads the
 * partition table to find the current owner.
 */
import { Invocation, type InvocationOptions } from '@zenystx/helios-core/spi/impl/operationservice/Invocation';
import { InvocationRegistry } from '@zenystx/helios-core/spi/impl/operationservice/InvocationRegistry';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { Address } from '@zenystx/helios-core/cluster/Address';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

export class PartitionInvocation extends Invocation {
    readonly partitionId: number;

    constructor(
        op: Operation,
        registry: InvocationRegistry,
        nodeEngine: NodeEngine,
        localAddress: Address,
        partitionId: number,
        options?: InvocationOptions,
    ) {
        super(op, registry, nodeEngine, localAddress, options);
        this.partitionId = partitionId;
        op.partitionId = partitionId;
    }

    /**
     * Re-reads the partition table to find the current owner address.
     * Called on each retry to handle partition migrations.
     */
    override initInvocationTarget(): void {
        const partitionService = this.nodeEngine.getPartitionService() as any;
        if (typeof partitionService.getPartitionOwner === 'function') {
            const owner = partitionService.getPartitionOwner(this.partitionId);
            if (owner != null) {
                const addr = typeof owner.address === 'function' ? owner.address() : owner;
                if (addr instanceof Address) {
                    this.targetAddress = addr;
                }
            }
        }
    }
}
