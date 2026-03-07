/**
 * Client-side topic proxy.
 *
 * Port of {@code com.hazelcast.client.impl.proxy.ClientTopicProxy}.
 * Provides the async topic API for remote clients.
 */
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { TopicPublishCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicPublishCodec";

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

    addMessageListener(_listener: (message: any) => void): string {
        throw new Error("ClientTopicProxy.addMessageListener() is deferred to Block 20.7");
    }

    removeMessageListener(_registrationId: string): boolean {
        throw new Error("ClientTopicProxy.removeMessageListener() is deferred to Block 20.7");
    }
}
