/**
 * Routes incoming client protocol messages to registered handlers by message type.
 *
 * Port of Hazelcast {@code CompositeMessageTaskFactory} + execution routing.
 */
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import type { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";

export type ClientMessageHandler = (
    msg: ClientMessage,
    session: ClientSession,
) => Promise<ClientMessage | null>;

export class ClientMessageDispatcher {
    private readonly _handlers = new Map<number, ClientMessageHandler>();

    register(messageType: number, handler: ClientMessageHandler): void {
        this._handlers.set(messageType, handler);
    }

    async dispatch(
        msg: ClientMessage,
        session: ClientSession,
    ): Promise<ClientMessage | null> {
        const type = msg.getMessageType();
        const handler = this._handlers.get(type);
        if (!handler) {
            return null;
        }
        return handler(msg, session);
    }

    hasHandler(messageType: number): boolean {
        return this._handlers.has(messageType);
    }
}
