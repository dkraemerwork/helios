/**
 * Client-side reliable topic proxy.
 *
 * Uses the same topic publish protocol but routes through the reliable topic
 * service name. Listener semantics deferred to Block 20.7.
 */
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { TopicPublishCodec } from "@zenystx/helios-core/client/impl/protocol/codec/TopicPublishCodec";

export class ClientReliableTopicProxy<E = any> extends ClientProxy {
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
        throw new Error("ClientReliableTopicProxy.addMessageListener() is deferred to Block 20.7");
    }

    removeMessageListener(_registrationId: string): boolean {
        throw new Error("ClientReliableTopicProxy.removeMessageListener() is deferred to Block 20.7");
    }
}
