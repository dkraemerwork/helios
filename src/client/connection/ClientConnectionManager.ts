/**
 * Client-side connection manager.
 *
 * Port of {@code com.hazelcast.client.impl.connection.tcp.TcpClientConnectionManager}.
 * Owns all active connections, bootstrap/auth flow, heartbeat, and reconnect.
 */
import {
    Eventloop,
    type EventloopChannel,
} from "@zenystx/helios-core/internal/eventloop/Eventloop";
import { ClientConnection, type EventHandler } from "@zenystx/helios-core/client/connection/ClientConnection";
import { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageReader } from "@zenystx/helios-core/client/impl/protocol/ClientMessageReader";
import { ClientAuthenticationCodec } from "@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec";
import { AuthenticationStatus } from "@zenystx/helios-core/client/impl/protocol/AuthenticationStatus";
import { WaitStrategy } from "@zenystx/helios-core/client/connection/WaitStrategy";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import type { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
import type { ClientClusterService } from "@zenystx/helios-core/client/spi/ClientClusterService";
import type { ClientPartitionService } from "@zenystx/helios-core/client/spi/ClientPartitionService";
import type { ClientListenerService } from "@zenystx/helios-core/client/spi/ClientListenerService";

export enum ClientState {
    INITIAL = "INITIAL",
    CONNECTED_TO_CLUSTER = "CONNECTED_TO_CLUSTER",
    INITIALIZED_ON_CLUSTER = "INITIALIZED_ON_CLUSTER",
    DISCONNECTED_FROM_CLUSTER = "DISCONNECTED_FROM_CLUSTER",
}

export class ClientConnectionManager {
    private readonly _config: ClientConfig;
    private readonly _clientUuid: string;
    private readonly _activeConnections = new Map<string, ClientConnection>();
    private _state: ClientState = ClientState.INITIAL;
    private _clusterId: string | null = null;
    private _alive = false;

    private _clusterService: ClientClusterService | null = null;
    private _partitionService: ClientPartitionService | null = null;
    private _listenerService: ClientListenerService | null = null;

    /** Response handler — set by invocation service. */
    private _responseHandler: ((conn: ClientConnection, msg: ClientMessage) => void) | null = null;

    /** Per-channel reader state for incoming data. */
    private readonly _channelReaders = new Map<EventloopChannel, { reader: ClientMessageReader; conn: ClientConnection; buffer: Buffer }>();

    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: ClientConfig) {
        this._config = config;
        this._clientUuid = crypto.randomUUID();
    }

    setClusterService(svc: ClientClusterService): void {
        this._clusterService = svc;
    }

    setPartitionService(svc: ClientPartitionService): void {
        this._partitionService = svc;
    }

    setListenerService(svc: ClientListenerService): void {
        this._listenerService = svc;
    }

    setResponseHandler(handler: (conn: ClientConnection, msg: ClientMessage) => void): void {
        this._responseHandler = handler;
    }

    async start(): Promise<void> {
        this._alive = true;
    }

    async connectToCluster(): Promise<void> {
        const addresses = this._resolveAddresses();
        if (addresses.length === 0) {
            addresses.push({ host: "127.0.0.1", port: 5701 });
        }

        const retryConfig = this._config.getConnectionStrategyConfig().getConnectionRetryConfig();
        const waitStrategy = new WaitStrategy(
            retryConfig.getInitialBackoffMillis(),
            retryConfig.getMaxBackoffMillis(),
            retryConfig.getMultiplier(),
            retryConfig.getJitter(),
            retryConfig.getClusterConnectTimeoutMillis(),
        );

        let lastError: Error | null = null;

        while (this._alive) {
            for (const addr of addresses) {
                try {
                    const conn = await this._connectAndAuth(addr.host, addr.port);
                    this._activeConnections.set(conn.getMemberUuid()!, conn);
                    this._state = ClientState.INITIALIZED_ON_CLUSTER;

                    // Start heartbeat
                    this._startHeartbeat();

                    return;
                } catch (err: any) {
                    lastError = err;
                    if (this._isCredentialError(err)) {
                        throw err;
                    }
                }
            }

            const sleepMs = waitStrategy.sleep();
            if (sleepMs === -1) {
                throw lastError ?? new Error("Cluster connect timeout exceeded");
            }
            await new Promise((r) => setTimeout(r, Math.max(sleepMs, 10)));
        }

        throw lastError ?? new Error("Connection manager shutdown during connect");
    }

    getState(): ClientState {
        return this._state;
    }

    getClusterId(): string | null {
        return this._clusterId;
    }

    getActiveConnections(): ClientConnection[] {
        return [...this._activeConnections.values()];
    }

    getConnection(memberUuid: string): ClientConnection | null {
        return this._activeConnections.get(memberUuid) ?? null;
    }

    getRandomConnection(): ClientConnection | null {
        const conns = this.getActiveConnections();
        if (conns.length === 0) return null;
        return conns[Math.floor(Math.random() * conns.length)];
    }

    checkInvocationAllowed(): void {
        if (this._state === ClientState.INITIALIZED_ON_CLUSTER) return;

        const reconnectMode = this._config.getConnectionStrategyConfig().getReconnectMode();
        const asyncStart = this._config.getConnectionStrategyConfig().isAsyncStart();

        if (reconnectMode === "OFF") {
            if (this._state === ClientState.INITIAL || this._state === ClientState.DISCONNECTED_FROM_CLUSTER) {
                throw new Error("Client is not connected and reconnect mode is OFF");
            }
        }

        if (asyncStart && this._state === ClientState.INITIAL) {
            throw new Error("Client is starting in async mode and not yet connected");
        }

        if (this._state === ClientState.DISCONNECTED_FROM_CLUSTER) {
            throw new Error("Client is disconnected from the cluster");
        }
    }

    async shutdown(): Promise<void> {
        this._alive = false;
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        for (const conn of this._activeConnections.values()) {
            conn.close();
        }
        this._activeConnections.clear();
        this._channelReaders.clear();
        this._state = ClientState.DISCONNECTED_FROM_CLUSTER;
    }

    // ── private ──────────────────────────────────────────────────────────────

    private _resolveAddresses(): { host: string; port: number }[] {
        const raw = this._config.getNetworkConfig().getAddresses();
        const result: { host: string; port: number }[] = [];
        for (const addr of raw) {
            const idx = addr.lastIndexOf(":");
            if (idx > 0) {
                result.push({
                    host: addr.slice(0, idx),
                    port: parseInt(addr.slice(idx + 1), 10),
                });
            } else {
                result.push({ host: addr, port: 5701 });
            }
        }
        return result;
    }

    private async _connectAndAuth(host: string, port: number): Promise<ClientConnection> {
        const channel = await Eventloop.connect(port, host, {
            onData: (ch, data) => this._onData(ch, data),
            onClose: (ch) => this._onClose(ch),
        });

        const conn = new ClientConnection(channel, host, port);
        this._channelReaders.set(channel, {
            reader: new ClientMessageReader(),
            conn,
            buffer: Buffer.alloc(0),
        });

        // Send auth request
        const clusterName = this._config.getClusterName();
        const authMsg = ClientAuthenticationCodec.encodeRequest(
            clusterName,
            null,
            null,
            this._clientUuid,
            "BUN",
            1,
            "1.0.0",
            this._config.getName(),
            [],
        );
        authMsg.setCorrelationId(-1);

        // Wait for auth response
        const response = await this._sendAndWaitForResponse(conn, authMsg);
        const authResp = ClientAuthenticationCodec.decodeResponse(response);

        if (authResp.status !== AuthenticationStatus.AUTHENTICATED.getId()) {
            conn.close();
            if (authResp.status === AuthenticationStatus.CREDENTIALS_FAILED.getId()) {
                throw new Error("Authentication failed: credentials rejected by cluster");
            }
            throw new Error(`Authentication failed with status: ${authResp.status}`);
        }

        conn.setMemberUuid(authResp.memberUuid!);
        if (authResp.clusterId) {
            conn.setClusterUuid(authResp.clusterId);
            this._clusterId = authResp.clusterId;
        }

        // Notify cluster service with member info from auth response
        if (this._clusterService && authResp.memberInfos.length > 0) {
            this._clusterService.handleMembersViewEvent(
                1,
                authResp.memberInfos,
                authResp.clusterId ?? "",
            );
        }

        // Initialize partition service with partition count from auth response
        if (this._partitionService && authResp.partitionCount > 0) {
            const memberUuid = authResp.memberUuid ?? "";
            const partitions = new Map<string, number[]>();
            const ids: number[] = [];
            for (let i = 0; i < authResp.partitionCount; i++) ids.push(i);
            partitions.set(memberUuid, ids);
            this._partitionService.handlePartitionsViewEvent(
                partitions, 1, authResp.partitionCount,
            );
        }

        return conn;
    }

    private _sendAndWaitForResponse(
        conn: ClientConnection,
        msg: ClientMessage,
    ): Promise<ClientMessage> {
        return new Promise<ClientMessage>((resolve, reject) => {
            const correlationId = msg.getCorrelationId();
            const timeout = setTimeout(() => {
                conn.removeEventHandler(correlationId);
                reject(new Error("Auth response timeout"));
            }, this._config.getNetworkConfig().getConnectionTimeout());

            conn.addEventHandler(correlationId, (response) => {
                clearTimeout(timeout);
                conn.removeEventHandler(correlationId);
                resolve(response);
            });

            if (!conn.write(msg)) {
                clearTimeout(timeout);
                conn.removeEventHandler(correlationId);
                reject(new Error("Failed to write auth request"));
            }
        });
    }

    private _onData(ch: EventloopChannel, data: Buffer): void {
        const state = this._channelReaders.get(ch);
        if (!state) return;

        state.buffer = state.buffer.length > 0
            ? Buffer.concat([state.buffer, data])
            : Buffer.from(data);

        while (state.buffer.length > 0) {
            const bb = ByteBuffer.wrap(state.buffer);
            const complete = state.reader.readFrom(bb, true);
            if (complete) {
                const msg = state.reader.getClientMessage();
                state.reader.reset();
                const consumed = bb.position();
                state.buffer = state.buffer.subarray(consumed);
                state.conn.recordRead();
                this._handleIncomingMessage(state.conn, msg);
            } else {
                const consumed = bb.position();
                if (consumed > 0) {
                    state.buffer = state.buffer.subarray(consumed);
                }
                break;
            }
        }
    }

    private _handleIncomingMessage(conn: ClientConnection, msg: ClientMessage): void {
        const correlationId = msg.getCorrelationId();

        // Check connection-level event handlers first (used during auth)
        const handler = conn.getEventHandler(correlationId);
        if (handler) {
            handler(msg);
            return;
        }

        // Check if it's an event message
        const flags = msg.getStartFrame().flags;
        if (ClientMessage.isFlagSet(flags, ClientMessage.IS_EVENT_FLAG)) {
            // Route to listener service
            if (this._listenerService) {
                this._listenerService.handleEventMessage(msg);
            }
            return;
        }

        // Route to invocation service response handler
        if (this._responseHandler) {
            this._responseHandler(conn, msg);
        }
    }

    private _onClose(ch: EventloopChannel): void {
        const state = this._channelReaders.get(ch);
        if (state) {
            const uuid = state.conn.getMemberUuid();
            if (uuid) {
                this._activeConnections.delete(uuid);
            }
            this._channelReaders.delete(ch);

            if (this._activeConnections.size === 0 && this._alive) {
                this._state = ClientState.DISCONNECTED_FROM_CLUSTER;
            }
        }
    }

    private _startHeartbeat(): void {
        if (this._heartbeatTimer !== null) return;
        this._heartbeatTimer = setInterval(() => {
            // Heartbeat check — just verify connections are alive
            for (const [uuid, conn] of this._activeConnections) {
                if (!conn.isAlive()) {
                    this._activeConnections.delete(uuid);
                }
            }
        }, 10_000);
    }

    private _isCredentialError(err: any): boolean {
        const msg = String(err?.message ?? "");
        return (
            msg.includes("credentials") ||
            msg.includes("Authentication failed")
        );
    }
}
