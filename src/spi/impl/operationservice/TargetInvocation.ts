/**
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.TargetInvocation}.
 *
 * An invocation targeting a specific cluster member by address.
 * The target is fixed and does not change on retry.
 */
import { Address } from '@zenystx/helios-core/cluster/Address';
import { Invocation, type InvocationOptions } from '@zenystx/helios-core/spi/impl/operationservice/Invocation';
import { InvocationRegistry } from '@zenystx/helios-core/spi/impl/operationservice/InvocationRegistry';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

export class TargetInvocation extends Invocation {
    constructor(
        op: Operation,
        registry: InvocationRegistry,
        nodeEngine: NodeEngine,
        localAddress: Address,
        target: Address,
        options?: InvocationOptions,
    ) {
        super(op, registry, nodeEngine, localAddress, options);
        this.targetAddress = target;
    }

    /** Target is fixed — no-op on retry. */
    override initInvocationTarget(): void {
        // Target address is fixed at construction time
    }
}
