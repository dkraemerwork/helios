/**
 * Base class for all client-side distributed object proxies.
 *
 * Port of {@code com.hazelcast.client.impl.spi.ClientProxy}.
 */
import type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
import type { ClientInvocationService } from "@zenystx/helios-core/client/invocation/ClientInvocationService";
import type { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService";
import type { SerializationServiceImpl } from "@zenystx/helios-core/internal/serialization/impl/SerializationServiceImpl";
import type { Data } from "@zenystx/helios-core/internal/serialization/Data";
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientInvocation } from "@zenystx/helios-core/client/invocation/ClientInvocation";

export abstract class ClientProxy implements DistributedObject {
    private readonly _name: string;
    private readonly _serviceName: string;
    protected readonly _serializationService: SerializationServiceImpl;
    protected readonly _invocationService: ClientInvocationService | null;
    protected readonly _partitionService: ClientPartitionService;
    private _destroyed = false;

    constructor(
        name: string,
        serviceName: string,
        serializationService: SerializationServiceImpl,
        invocationService: ClientInvocationService | null,
        partitionService: ClientPartitionService,
    ) {
        this._name = name;
        this._serviceName = serviceName;
        this._serializationService = serializationService;
        this._invocationService = invocationService;
        this._partitionService = partitionService;
    }

    getName(): string {
        return this._name;
    }

    getServiceName(): string {
        return this._serviceName;
    }

    async destroy(): Promise<void> {
        this._destroyed = true;
        this.onDestroy();
    }

    isDestroyed(): boolean {
        return this._destroyed;
    }

    protected onInitialize(): void {}
    protected onDestroy(): void {}
    protected onShutdown(): void {}

    protected toData<T>(obj: T): Data {
        return this._serializationService.toData(obj)!;
    }

    protected toObject<T>(data: Data): T | null {
        return this._serializationService.toObject(data);
    }

    protected async invoke(msg: ClientMessage): Promise<ClientMessage> {
        if (!this._invocationService) {
            throw new Error("Invocation service is not available — client may not be connected");
        }
        const invocation = ClientInvocation.create(msg, -1);
        return this._invocationService.invoke(invocation);
    }

    protected async invokeOnPartition(msg: ClientMessage, partitionId: number): Promise<ClientMessage> {
        if (!this._invocationService) {
            throw new Error("Invocation service is not available — client may not be connected");
        }
        msg.setPartitionId(partitionId);
        const invocation = ClientInvocation.create(msg, partitionId);
        return this._invocationService.invoke(invocation);
    }

    protected async invokeOnKey(msg: ClientMessage, key: Data): Promise<ClientMessage> {
        const partitionId = this._partitionService.getPartitionId(key.getPartitionHash());
        return this.invokeOnPartition(msg, partitionId);
    }

    protected getPartitionId(key: Data): number {
        return this._partitionService.getPartitionId(key.getPartitionHash());
    }
}
