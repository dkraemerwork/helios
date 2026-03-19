/**
 * Member-side distributed-object lifecycle tasks for the client protocol.
 *
 * Handles create-proxy, destroy-proxy, and get-distributed-objects requests
 * from remote clients.
 */
import type { ClientProtocolServer } from "@zenystx/helios-core/server/clientprotocol/ClientProtocolServer";
import { ClientCreateProxyCodec } from "../../../client/impl/protocol/codec/ClientCreateProxyCodec";
import { ClientDestroyProxyCodec } from "../../../client/impl/protocol/codec/ClientDestroyProxyCodec";
import {
    ClientGetDistributedObjectsCodec,
    type DistributedObjectInfo,
} from "../../../client/impl/protocol/codec/ClientGetDistributedObjectsCodec";

/** Tracks distributed objects created via the client protocol. */
const distributedObjects = new Map<string, DistributedObjectInfo>();

function objectKey(serviceName: string, name: string): string {
    return `${serviceName}:${name}`;
}

export function registerDistributedObjectTasks(server: ClientProtocolServer): void {
    // Create proxy
    server.registerHandler(
        ClientCreateProxyCodec.REQUEST_MESSAGE_TYPE,
        async (msg, _session) => {
            const req = ClientCreateProxyCodec.decodeRequest(msg);
            const key = objectKey(req.serviceName, req.name);
            distributedObjects.set(key, { serviceName: req.serviceName, name: req.name });
            return ClientCreateProxyCodec.encodeResponse();
        },
    );

    // Destroy proxy
    server.registerHandler(
        ClientDestroyProxyCodec.REQUEST_MESSAGE_TYPE,
        async (msg, _session) => {
            const req = ClientDestroyProxyCodec.decodeRequest(msg);
            const key = objectKey(req.serviceName, req.name);
            distributedObjects.delete(key);
            return ClientDestroyProxyCodec.encodeResponse();
        },
    );

    // Get distributed objects
    server.registerHandler(
        ClientGetDistributedObjectsCodec.REQUEST_MESSAGE_TYPE,
        async (_msg, _session) => {
            return ClientGetDistributedObjectsCodec.encodeResponse(
                [...distributedObjects.values()],
            );
        },
    );
}
