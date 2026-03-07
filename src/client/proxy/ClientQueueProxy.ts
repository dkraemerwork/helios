/**
 * Client-side queue proxy.
 *
 * Port of {@code com.hazelcast.client.impl.proxy.ClientQueueProxy}.
 * Does not implement IQueue directly since IQueue defines some methods
 * as synchronous. Provides the async queue API for remote clients.
 */
import { QueueClearCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueClearCodec";
import { QueueOfferCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueOfferCodec";
import { QueuePeekCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueuePeekCodec";
import { QueuePollCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueuePollCodec";
import { QueueSizeCodec } from "@zenystx/helios-core/client/impl/protocol/codec/QueueSizeCodec";
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";

export class ClientQueueProxy<E = any> extends ClientProxy {
    private _partitionId: number = -1;

    private _hashName(name: string): number {
        let h = 0;
        for (let i = 0; i < name.length; i++) {
            h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
        }
        return h;
    }

    private _getPartitionId(): number {
        if (this._partitionId < 0) {
            this._partitionId = this._partitionService.getPartitionId(this._hashName(this.getName()));
        }
        return this._partitionId;
    }

    async offer(element: E, timeoutMs?: number): Promise<boolean> {
        const data = this.toData(element);
        const msg = QueueOfferCodec.encodeRequest(this.getName(), data, BigInt(timeoutMs ?? 0));
        const response = await this.invokeOnPartition(msg, this._getPartitionId());
        return QueueOfferCodec.decodeResponse(response);
    }

    async poll(timeoutMs?: number): Promise<E | null> {
        const msg = QueuePollCodec.encodeRequest(this.getName(), BigInt(timeoutMs ?? 0));
        const response = await this.invokeOnPartition(msg, this._getPartitionId());
        return QueuePollCodec.decodeResponseValue(response, this._serializationService);
    }

    async peek(): Promise<E | null> {
        const msg = QueuePeekCodec.encodeRequest(this.getName());
        const response = await this.invokeOnPartition(msg, this._getPartitionId());
        return QueuePeekCodec.decodeResponseValue(response, this._serializationService);
    }

    async size(): Promise<number> {
        const msg = QueueSizeCodec.encodeRequest(this.getName());
        const response = await this.invokeOnPartition(msg, this._getPartitionId());
        return QueueSizeCodec.decodeResponse(response);
    }

    async isEmpty(): Promise<boolean> {
        return (await this.size()) === 0;
    }

    async clear(): Promise<void> {
        const msg = QueueClearCodec.encodeRequest(this.getName());
        await this.invokeOnPartition(msg, this._getPartitionId());
    }
}
