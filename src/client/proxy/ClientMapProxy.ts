/**
 * Client-side map proxy.
 *
 * Port of {@code com.hazelcast.client.impl.proxy.ClientMapProxy}.
 * Routes all map operations through the binary client protocol.
 *
 * Does not implement IMap directly because IMap defines some methods as
 * synchronous (size, containsKey) which cannot work over the network.
 * The proxy extends ClientProxy (which implements DistributedObject) and
 * provides the async map API that remote clients actually use.
 */
import { ClientProxy } from "@zenystx/helios-core/client/proxy/ClientProxy";
import { MapPutCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec";
import { MapGetCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapGetCodec";
import { MapRemoveCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapRemoveCodec";
import { MapSizeCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapSizeCodec";
import { MapContainsKeyCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapContainsKeyCodec";
import { MapClearCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapClearCodec";
import { MapDeleteCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapDeleteCodec";
import { MapSetCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapSetCodec";

export class ClientMapProxy<K = any, V = any> extends ClientProxy {

    async put(key: K, value: V, ttlMs?: number): Promise<V | null> {
        const keyData = this.toData(key);
        const valueData = this.toData(value);
        const msg = MapPutCodec.encodeRequest(
            this.getName(), keyData, valueData, 0n, BigInt(ttlMs ?? -1),
        );
        const response = await this.invokeOnKey(msg, keyData);
        return MapPutCodec.decodeResponseValue(response, this._serializationService);
    }

    async get(key: K): Promise<V | null> {
        const keyData = this.toData(key);
        const msg = MapGetCodec.encodeRequest(this.getName(), keyData, 0n);
        const response = await this.invokeOnKey(msg, keyData);
        return MapGetCodec.decodeResponseValue(response, this._serializationService);
    }

    async remove(key: K): Promise<V | null> {
        const keyData = this.toData(key);
        const msg = MapRemoveCodec.encodeRequest(this.getName(), keyData, 0n);
        const response = await this.invokeOnKey(msg, keyData);
        return MapRemoveCodec.decodeResponseValue(response, this._serializationService);
    }

    async size(): Promise<number> {
        const msg = MapSizeCodec.encodeRequest(this.getName());
        const response = await this.invoke(msg);
        return MapSizeCodec.decodeResponse(response);
    }

    async containsKey(key: K): Promise<boolean> {
        const keyData = this.toData(key);
        const msg = MapContainsKeyCodec.encodeRequest(this.getName(), keyData, 0n);
        const response = await this.invokeOnKey(msg, keyData);
        return MapContainsKeyCodec.decodeResponse(response);
    }

    async clear(): Promise<void> {
        const msg = MapClearCodec.encodeRequest(this.getName());
        await this.invoke(msg);
    }

    async isEmpty(): Promise<boolean> {
        return (await this.size()) === 0;
    }

    async set(key: K, value: V, ttlMs?: number): Promise<void> {
        const keyData = this.toData(key);
        const valueData = this.toData(value);
        const msg = MapSetCodec.encodeRequest(
            this.getName(), keyData, valueData, 0n, BigInt(ttlMs ?? -1),
        );
        await this.invokeOnKey(msg, keyData);
    }

    async delete(key: K): Promise<void> {
        const keyData = this.toData(key);
        const msg = MapDeleteCodec.encodeRequest(this.getName(), keyData, 0n);
        await this.invokeOnKey(msg, keyData);
    }
}
