/**
 * Client-side connection wrapper.
 *
 * Port of {@code com.hazelcast.client.impl.connection.tcp.TcpClientConnection}.
 * Wraps an EventloopChannel with member/cluster metadata and event handler tracking.
 */
import type { EventloopChannel } from "@zenystx/helios-core/internal/eventloop/Eventloop";
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageWriter } from "@zenystx/helios-core/client/impl/protocol/ClientMessageWriter";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";

export type EventHandler = (msg: ClientMessage) => void;

export class ClientConnection {
    private readonly _channel: EventloopChannel | null;
    private readonly _remoteHost: string;
    private readonly _remotePort: number;
    private _memberUuid: string | null = null;
    private _clusterUuid: string | null = null;
    private _lastReadMs: number = Date.now();
    private _lastWriteMs: number = Date.now();
    private _closedByClient = false;
    private readonly _eventHandlers = new Map<number, EventHandler>();

    constructor(channel: EventloopChannel | null, host: string, port: number) {
        this._channel = channel;
        this._remoteHost = host;
        this._remotePort = port;
    }

    getChannel(): EventloopChannel | null {
        return this._channel;
    }

    getRemoteHost(): string {
        return this._remoteHost;
    }

    getRemotePort(): number {
        return this._remotePort;
    }

    getMemberUuid(): string | null {
        return this._memberUuid;
    }

    setMemberUuid(uuid: string): void {
        this._memberUuid = uuid;
    }

    getClusterUuid(): string | null {
        return this._clusterUuid;
    }

    setClusterUuid(uuid: string): void {
        this._clusterUuid = uuid;
    }

    isAlive(): boolean {
        if (this._closedByClient) return false;
        return this._channel !== null && !this._channel.isClosed();
    }

    recordRead(): void {
        this._lastReadMs = Date.now();
    }

    recordWrite(): void {
        this._lastWriteMs = Date.now();
    }

    getLastReadMs(): number {
        return this._lastReadMs;
    }

    getLastWriteMs(): number {
        return this._lastWriteMs;
    }

    addEventHandler(correlationId: number, handler: EventHandler): void {
        this._eventHandlers.set(correlationId, handler);
    }

    getEventHandler(correlationId: number): EventHandler | undefined {
        return this._eventHandlers.get(correlationId);
    }

    removeEventHandler(correlationId: number): void {
        this._eventHandlers.delete(correlationId);
    }

    write(msg: ClientMessage): boolean {
        if (!this.isAlive()) return false;
        const totalLen = msg.getFrameLength();
        const byteBuf = ByteBuffer.allocate(totalLen);
        const writer = new ClientMessageWriter();
        writer.writeTo(byteBuf, msg);
        byteBuf.flip();
        const buf = Buffer.alloc(byteBuf.remaining());
        byteBuf.getBytes(buf, 0, buf.length);
        this._lastWriteMs = Date.now();
        return this._channel!.write(buf);
    }

    close(): void {
        this._closedByClient = true;
        this._eventHandlers.clear();
        if (this._channel !== null && !this._channel.isClosed()) {
            this._channel.close();
        }
    }

    toString(): string {
        return `ClientConnection{host=${this._remoteHost}, port=${this._remotePort}, member=${this._memberUuid}}`;
    }
}
