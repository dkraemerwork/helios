/**
 * Represents a single authenticated client connection on the member side.
 *
 * Port of Hazelcast {@code ClientEndpointImpl} — tracks auth state, client UUID,
 * heartbeat timing, and provides event-push to the connected client.
 */
import { ClientMessage } from "../../client/impl/protocol/ClientMessage";
import { ClientMessageWriter } from "../../client/impl/protocol/ClientMessageWriter";
import type { EventloopChannel } from "@zenystx/helios-core/internal/eventloop/Eventloop";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import type { SecurityContext } from "@zenystx/helios-core/security/impl/SecurityContext";

export class ClientSession {
    private readonly _channel: EventloopChannel;
    private readonly _sessionId: string;
    private _clientUuid: string | null = null;
    private _clientName: string | null = null;
    private _clientVersion: string | null = null;
    private _authenticated = false;
    private _lastSeenMs: number = Date.now();
    private _securityContext: SecurityContext | null = null;

    constructor(channel: EventloopChannel, sessionId: string) {
        this._channel = channel;
        this._sessionId = sessionId;
    }

    getSessionId(): string {
        return this._sessionId;
    }

    getChannel(): EventloopChannel {
        return this._channel;
    }

    getClientUuid(): string | null {
        return this._clientUuid;
    }

    getClientName(): string | null {
        return this._clientName;
    }

    isAuthenticated(): boolean {
        return this._authenticated;
    }

    getLastSeenMs(): number {
        return this._lastSeenMs;
    }

    recordActivity(): void {
        this._lastSeenMs = Date.now();
    }

    authenticate(clientUuid: string, clientName: string, clientVersion: string): void {
        this._clientUuid = clientUuid;
        this._clientName = clientName;
        this._clientVersion = clientVersion;
        this._authenticated = true;
        this._lastSeenMs = Date.now();
    }

    /** Returns the SecurityContext for this session, or null if not set. */
    getSecurityContext(): SecurityContext | null {
        return this._securityContext;
    }

    /** Attach a SecurityContext to this session after successful authentication. */
    setSecurityContext(context: SecurityContext): void {
        this._securityContext = context;
    }

    /** Send a response or event message to the client. */
    sendMessage(msg: ClientMessage): boolean {
        if (this._channel.isClosed()) return false;
        const buf = this._serializeMessage(msg);
        return this._channel.write(buf);
    }

    /** Push an event message to the client (alias for sendMessage). */
    pushEvent(msg: ClientMessage): boolean {
        return this.sendMessage(msg);
    }

    close(): void {
        if (!this._channel.isClosed()) {
            this._channel.close();
        }
    }

    destroy(): void {
        this._authenticated = false;
        this.close();
    }

    private _serializeMessage(msg: ClientMessage): Buffer {
        const totalLen = msg.getFrameLength();
        const byteBuf = ByteBuffer.allocate(totalLen);
        const writer = new ClientMessageWriter();
        writer.writeTo(byteBuf, msg);
        byteBuf.flip();
        const result = Buffer.alloc(byteBuf.remaining());
        byteBuf.getBytes(result, 0, result.length);
        return result;
    }
}
