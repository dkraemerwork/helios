/**
 * Routes incoming client protocol messages to registered handlers by message type.
 *
 * Port of Hazelcast {@code CompositeMessageTaskFactory} + execution routing.
 */
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import type { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";

export class ClientAuthenticationRequiredError extends Error {
    constructor(messageType: number) {
        super(`Client message type ${messageType} requires authentication`);
    }
}

export class ClientProtocolOpcodeError extends Error {
    readonly messageType: number;
    readonly reason: "unknown" | "illegal";

    constructor(messageType: number, reason: "unknown" | "illegal") {
        super(
            reason === "illegal"
                ? `Illegal client message type ${messageType}`
                : `Unknown client message type ${messageType}`,
        );
        this.messageType = messageType;
        this.reason = reason;
    }
}

export type ClientMessageHandler = (
    msg: ClientMessage,
    session: ClientSession,
) => Promise<ClientMessage | null>;

export class ClientMessageDispatcher {
    private readonly _handlers = new Map<number, ClientMessageHandler>();
    private readonly _preAuthAllowedMessageTypes = new Set<number>();

    register(messageType: number, handler: ClientMessageHandler): void {
        this._handlers.set(messageType, handler);
    }

    allowBeforeAuthentication(messageType: number): void {
        this._preAuthAllowedMessageTypes.add(messageType);
    }

    async dispatch(
        msg: ClientMessage,
        session: ClientSession,
    ): Promise<ClientMessage | null> {
        const type = msg.getMessageType();
        if (!session.isAuthenticated() && !this._preAuthAllowedMessageTypes.has(type)) {
            throw new ClientAuthenticationRequiredError(type);
        }
        if (!isClientRequestMessageType(type)) {
            throw new ClientProtocolOpcodeError(type, "illegal");
        }
        const handler = this._handlers.get(type);
        if (!handler) {
            throw new ClientProtocolOpcodeError(type, "unknown");
        }
        return handler(msg, session);
    }

    hasHandler(messageType: number): boolean {
        return this._handlers.has(messageType);
    }
}

function isClientRequestMessageType(messageType: number): boolean {
    return (messageType & 0xff) === 0;
}
