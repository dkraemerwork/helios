/**
 * Routes incoming client protocol messages to registered handlers by message type.
 *
 * Port of Hazelcast {@code CompositeMessageTaskFactory} + execution routing.
 */
import { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
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
    private readonly _handlers = new Map<number, ClientMessageHandler[]>();
    private readonly _preAuthAllowedMessageTypes = new Set<number>();

    register(messageType: number, handler: ClientMessageHandler): void {
        const handlers = this._handlers.get(messageType);
        if (handlers === undefined) {
            this._handlers.set(messageType, [handler]);
            return;
        }
        handlers.push(handler);
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
        const handlers = this._handlers.get(type);
        if (!handlers || handlers.length === 0) {
            throw new ClientProtocolOpcodeError(type, "unknown");
        }
        const handler = selectHandler(type, msg, handlers);
        return handler(msg, session);
    }

    hasHandler(messageType: number): boolean {
        return (this._handlers.get(messageType)?.length ?? 0) > 0;
    }

}

function selectHandler(type: number, msg: ClientMessage, handlers: ClientMessageHandler[]): ClientMessageHandler {
    if (handlers.length === 1) {
        return handlers[0]!;
    }

    if (isCpAtomicRefOverlap(type, msg)) {
        return handlers[handlers.length - 1]!;
    }

    if (isTransactionSetOverlap(type, msg)) {
        return handlers[handlers.length - 1]!;
    }

    return handlers[0]!;
}

function isCpAtomicRefOverlap(type: number, msg: ClientMessage): boolean {
    if (type !== 0x0a0200 && type !== 0x0a0300 && type !== 0x0a0400 && type !== 0x0a0500) {
        return false;
    }

    const iterator = msg.forwardFrameIterator();
    iterator.next();
    const nextFrame = iterator.peekNext();
    return nextFrame !== null && nextFrame.isBeginFrame();
}

function isTransactionSetOverlap(type: number, msg: ClientMessage): boolean {
    if (type !== 0x170100 && type !== 0x170200 && type !== 0x170300) {
        return false;
    }

    return msg.getStartFrame().content.length > ClientMessage.PARTITION_ID_FIELD_OFFSET + 4;
}

function isClientRequestMessageType(messageType: number): boolean {
    return (messageType & 0xff) === 0;
}
