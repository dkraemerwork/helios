/**
 * Routes client invocations through active connections.
 *
 * Port of {@code com.hazelcast.client.impl.spi.impl.ClientInvocationServiceImpl}.
 */
import type { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig.js";
import type { ClientConnection } from "@zenystx/helios-core/client/connection/ClientConnection.js";
import type { ClientConnectionManager } from "@zenystx/helios-core/client/connection/ClientConnectionManager.js";
import type { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage.js";
import { ClientInvocation } from "@zenystx/helios-core/client/invocation/ClientInvocation.js";
import {
    DEFAULT_INVOCATION_RETRY_PAUSE_MS,
    DEFAULT_INVOCATION_TIMEOUT_MS,
} from "@zenystx/helios-core/config/HazelcastDefaults.js";

export class ClientInvocationService {
    private readonly _connectionManager: ClientConnectionManager;
    private readonly _invocations = new Map<number, ClientInvocation>();
    private readonly _invocationTimeoutMs: number;
    private readonly _retryPauseMs: number;
    private _alive = false;

    constructor(connectionManager: ClientConnectionManager, config: ClientConfig) {
        this._connectionManager = connectionManager;
        const timeout = config.getProperties().get("helios.client.invocation.timeout.seconds");
        this._invocationTimeoutMs = timeout ? parseInt(timeout, 10) * 1000 : DEFAULT_INVOCATION_TIMEOUT_MS;
        const retryPause = config.getProperties().get("helios.client.invocation.retry.pause.millis");
        this._retryPauseMs = retryPause ? parseInt(retryPause, 10) : DEFAULT_INVOCATION_RETRY_PAUSE_MS;
    }

    start(): void {
        this._alive = true;
        // Register ourselves as the response handler on the connection manager
        this._connectionManager.setResponseHandler((conn, msg) =>
            this._handleResponse(conn, msg),
        );
    }

    getActiveInvocationCount(): number {
        return this._invocations.size;
    }

    async invoke(invocation: ClientInvocation): Promise<ClientMessage> {
        this._connectionManager.checkInvocationAllowed();

        const correlationId = invocation.getCorrelationId();
        invocation.getClientMessage().setCorrelationId(correlationId);
        this._invocations.set(correlationId, invocation);

        try {
            this._sendInvocation(invocation);
        } catch (err) {
            this._invocations.delete(correlationId);
            throw err;
        }

        try {
            return await invocation.getFuture();
        } finally {
            this._invocations.delete(correlationId);
        }
    }

    async invokeOnRandomTarget(msg: ClientMessage): Promise<ClientMessage> {
        return this.invoke(ClientInvocation.create(msg, -1));
    }

    shutdown(): void {
        this._alive = false;
        // Reject all pending invocations
        for (const [id, inv] of this._invocations) {
            inv.notifyException(new Error("Client invocation service is shutting down"));
        }
        this._invocations.clear();
    }

    private _sendInvocation(invocation: ClientInvocation): void {
        let conn: ClientConnection | null = null;

        // Route to bound connection, target, or random
        if (invocation.getBoundConnection()) {
            conn = invocation.getBoundConnection();
        } else if (invocation.getTargetUuid()) {
            conn = this._connectionManager.getConnection(invocation.getTargetUuid()!);
        } else {
            conn = this._connectionManager.getRandomConnection();
        }

        if (!conn || !conn.isAlive()) {
            throw new Error("No active connection available for invocation");
        }

        invocation.setSentConnection(conn);
        invocation.incrementInvokeCount();

        if (!conn.write(invocation.getClientMessage())) {
            throw new Error("Failed to write invocation to connection");
        }
    }

    private _handleResponse(_conn: ClientConnection, msg: ClientMessage): void {
        const correlationId = msg.getCorrelationId();
        const invocation = this._invocations.get(correlationId);
        if (!invocation) return;

        invocation.notify(msg);
    }
}
