/**
 * Represents a single client-to-member invocation.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.ClientInvocation}.
 */
import type { ClientConnection } from "@zenystx/helios-core/client/connection/ClientConnection";
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";

let correlationCounter = 0;

export class ClientInvocation {
    private readonly _clientMessage: ClientMessage;
    private readonly _partitionId: number;
    private _targetUuid: string | null = null;
    private _boundConnection: ClientConnection | null = null;
    private _sentConnection: ClientConnection | null = null;
    private _correlationId: number;
    private _invokeCount = 0;
    private readonly _startTimeMs: number;
    private readonly _future: PromiseWithResolvers<ClientMessage>;

    private constructor(msg: ClientMessage, partitionId: number) {
        this._clientMessage = msg;
        this._partitionId = partitionId;
        this._correlationId = ++correlationCounter;
        this._startTimeMs = Date.now();
        this._future = Promise.withResolvers<ClientMessage>();
    }

    static create(msg: ClientMessage, partitionId: number): ClientInvocation {
        return new ClientInvocation(msg, partitionId);
    }

    static createForTarget(msg: ClientMessage, uuid: string): ClientInvocation {
        const inv = new ClientInvocation(msg, -1);
        inv._targetUuid = uuid;
        return inv;
    }

    static createForConnection(msg: ClientMessage, connection: ClientConnection): ClientInvocation {
        const inv = new ClientInvocation(msg, -1);
        inv._boundConnection = connection;
        return inv;
    }

    getClientMessage(): ClientMessage {
        return this._clientMessage;
    }

    getPartitionId(): number {
        return this._partitionId;
    }

    getTargetUuid(): string | null {
        return this._targetUuid;
    }

    getBoundConnection(): ClientConnection | null {
        return this._boundConnection;
    }

    getCorrelationId(): number {
        return this._correlationId;
    }

    setCorrelationId(id: number): void {
        this._correlationId = id;
    }

    getSentConnection(): ClientConnection | null {
        return this._sentConnection;
    }

    setSentConnection(conn: ClientConnection | null): void {
        this._sentConnection = conn;
    }

    getInvokeCount(): number {
        return this._invokeCount;
    }

    incrementInvokeCount(): void {
        this._invokeCount++;
    }

    getStartTimeMs(): number {
        return this._startTimeMs;
    }

    getFuture(): Promise<ClientMessage> {
        return this._future.promise;
    }

    notify(response: ClientMessage): void {
        this._future.resolve(response);
    }

    notifyException(error: Error): void {
        this._future.reject(error);
    }

    static isRetryable(error: Error): boolean {
        const msg = error.message.toLowerCase();
        if (msg.includes("credentials") || msg.includes("authentication")) {
            return false;
        }
        if (
            msg.includes("disconnect") ||
            msg.includes("timeout") ||
            msg.includes("connection closed") ||
            msg.includes("target not member") ||
            msg.includes("retryable")
        ) {
            return true;
        }
        return false;
    }
}
