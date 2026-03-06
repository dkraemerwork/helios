import type { ObjectNamespace } from '@zenystx/core/internal/services/ObjectNamespace';
import { Operation } from '@zenystx/core/spi/impl/operationservice/Operation';
import { RingbufferContainer } from '@zenystx/core/ringbuffer/impl/RingbufferContainer';
import { RingbufferService } from '@zenystx/core/ringbuffer/impl/RingbufferService';
import { RingbufferWaitNotifyKey } from '@zenystx/core/ringbuffer/impl/RingbufferWaitNotifyKey';

/**
 * Port of {@code com.hazelcast.ringbuffer.impl.operations.AbstractRingBufferOperation}.
 *
 * Base class for all ringbuffer operations. Provides container lookup and
 * common ringbuffer helpers.
 */
export abstract class AbstractRingBufferOperation extends Operation {
    protected name: string;

    constructor(name: string) {
        super();
        this.name = name;
    }

    getServiceName(): string {
        return RingbufferService.SERVICE_NAME;
    }

    getName(): string {
        return this.name;
    }

    /**
     * Returns the RingbufferService from the node engine.
     */
    protected getService(): RingbufferService {
        return this.getNodeEngine()!.getService<RingbufferService>(RingbufferService.SERVICE_NAME);
    }

    /**
     * Returns the RingbufferContainer for this operation's name and partition,
     * creating it if it doesn't exist. Calls cleanup() before returning.
     */
    protected getRingBufferContainer(): RingbufferContainer {
        const service = this.getService();
        const ns = RingbufferService.getRingbufferNamespace(this.name);
        let container = service.getContainerOrNull(this.partitionId, ns);
        if (container === null) {
            container = service.getOrCreateContainer(this.partitionId, ns, service.getRingbufferConfig(this.name));
        }
        container.cleanup();
        return container;
    }

    /**
     * Returns the RingbufferContainer or null if it doesn't exist.
     * Calls cleanup() if found.
     */
    protected getRingBufferContainerOrNull(): RingbufferContainer | null {
        const service = this.getService();
        const ns = RingbufferService.getRingbufferNamespace(this.name);
        const container = service.getContainerOrNull(this.partitionId, ns);
        if (container !== null) {
            container.cleanup();
        }
        return container;
    }

    /**
     * Returns the wait/notify key for blocking reads on this ringbuffer.
     */
    protected getRingbufferWaitNotifyKey(): RingbufferWaitNotifyKey {
        const service = this.getService();
        const ns: ObjectNamespace = RingbufferService.getRingbufferNamespace(this.name);
        const container = service.getContainerOrNull(this.partitionId, ns);
        if (container !== null) {
            return container.getRingEmptyWaitNotifyKey();
        }
        return new RingbufferWaitNotifyKey(ns, this.partitionId);
    }

    /** Helper to set the partition ID (fluent). */
    setPartitionId(partitionId: number): this {
        this.partitionId = partitionId;
        return this;
    }
}
