/**
 * Client-side topic proxy.
 *
 * Port of {@code com.hazelcast.client.impl.proxy.ClientTopicProxy}.
 * Provides the async topic API for remote clients.
 */
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { TopicAddMessageListenerCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicAddMessageListenerCodec";
import { TopicPublishCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicPublishCodec";
import { TopicRemoveMessageListenerCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicRemoveMessageListenerCodec";
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { Message } from "@zenystx/helios-core/topic/Message";

export class ClientTopicProxy<E = any> extends ClientProxy {
    private _partitionId: number = -1;

    private _getPartitionId(): number {
        if (this._partitionId < 0) {
            let h = 0;
            const name = this.getName();
            for (let i = 0; i < name.length; i++) {
                h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
            }
            this._partitionId = this._partitionService.getPartitionId(h);
        }
        return this._partitionId;
    }

    async publish(message: E): Promise<void> {
        return this.publishAsync(message);
    }

    async publishAsync(message: E): Promise<void> {
        const data = this.toData(message);
        const msg = TopicPublishCodec.encodeRequest(this.getName(), data);
        await this.invokeOnPartition(msg, this._getPartitionId());
    }

    addMessageListener(listener: (message: any) => void): string {
        const codec = {
            encodeAddRequest: () => TopicAddMessageListenerCodec.encodeRequest(this.getName()),
            decodeAddResponse: (msg: ClientMessage) => TopicAddMessageListenerCodec.decodeResponse(msg),
            encodeRemoveRequest: (registrationId: string) => TopicRemoveMessageListenerCodec.encodeRequest(this.getName(), registrationId),
            decodeRemoveResponse: (msg: ClientMessage) => TopicRemoveMessageListenerCodec.decodeResponse(msg),
        };
        return this.registerListener(codec, (msg) => {
            const event = TopicAddMessageListenerCodec.decodeEvent(msg);
            listener(new Message(this.getName(), this.toObject(event.message), event.publishTime, event.publishingMemberId));
        });
    }

    removeMessageListener(registrationId: string): boolean {
        return this.deregisterListener(registrationId);
    }
}
