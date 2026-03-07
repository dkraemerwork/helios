/**
 * Member-side client protocol server.
 *
 * Accepts client connections on a dedicated TCP port, handles authentication,
 * dispatches requests to registered handlers, and manages session lifecycle.
 *
 * Port of Hazelcast {@code ClientEngineImpl} — the server-side counterpart
 * of the remote client protocol stack.
 */
import {
    Eventloop,
    EventloopServer,
    type EventloopChannel,
} from "@zenystx/helios-core/internal/eventloop/Eventloop";
import { ClientMessage } from "@zenystx/helios-core/client/impl/protocol/ClientMessage";
import { ClientMessageReader } from "@zenystx/helios-core/client/impl/protocol/ClientMessageReader";
import { ClientAuthenticationCodec } from "@zenystx/helios-core/client/impl/protocol/codec/ClientAuthenticationCodec";
import { MapPutCodec } from "@zenystx/helios-core/client/impl/protocol/codec/MapPutCodec";
import { AuthenticationStatus } from "@zenystx/helios-core/client/impl/protocol/AuthenticationStatus";
import { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";
import { ClientSessionRegistry } from "@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry";
import {
    ClientMessageDispatcher,
    type ClientMessageHandler,
} from "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import { Address } from "@zenystx/helios-core/cluster/Address";
import { MemberInfo } from "@zenystx/helios-core/cluster/MemberInfo";
import { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

/** Options for ClientProtocolServer construction. */
export interface ClientProtocolServerOptions {
    clusterName: string;
    port: number;
    host?: string;
    memberUuid?: string;
    clusterId?: string;
    partitionCount?: number;
    serializationVersion?: number;
    heartbeatTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    enableMapHandler?: boolean;
    /** If provided, MapPut handler writes through this callback. */
    onMapPut?: (name: string, key: Buffer, value: Buffer) => Buffer | null;
}

let sessionCounter = 0;

export class ClientProtocolServer {
    private readonly _clusterName: string;
    private readonly _port: number;
    private readonly _host: string;
    private readonly _memberUuid: string;
    private readonly _clusterId: string;
    private readonly _partitionCount: number;
    private readonly _serializationVersion: number;
    private readonly _heartbeatTimeoutMs: number;
    private readonly _heartbeatIntervalMs: number;

    private readonly _registry: ClientSessionRegistry;
    private readonly _dispatcher: ClientMessageDispatcher;

    private _server: EventloopServer | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    /** Per-channel receive state. */
    private readonly _channelState = new Map<
        EventloopChannel,
        { reader: ClientMessageReader; session: ClientSession; buffer: Buffer }
    >();

    private _onMapPut: ((name: string, key: Buffer, value: Buffer) => Buffer | null) | null;

    constructor(opts: ClientProtocolServerOptions) {
        this._clusterName = opts.clusterName;
        this._port = opts.port;
        this._host = opts.host ?? "127.0.0.1";
        this._memberUuid = opts.memberUuid ?? crypto.randomUUID();
        this._clusterId = opts.clusterId ?? crypto.randomUUID();
        this._partitionCount = opts.partitionCount ?? 271;
        this._serializationVersion = opts.serializationVersion ?? 1;
        this._heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 60_000;
        this._heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 10_000;
        this._onMapPut = opts.onMapPut ?? null;

        this._registry = new ClientSessionRegistry();
        this._dispatcher = new ClientMessageDispatcher();

        // Register built-in handlers
        this._registerAuthHandler();
        if (opts.enableMapHandler) {
            this._registerMapPutHandler();
        }
    }

    async start(): Promise<void> {
        this._server = Eventloop.listen(this._port, this._host, {
            onConnect: (ch) => this._onConnect(ch),
            onData: (ch, data) => this._onData(ch, data),
            onClose: (ch) => this._onClose(ch),
        });
        this._running = true;

        // Start heartbeat monitor
        this._heartbeatTimer = setInterval(
            () => this._checkHeartbeats(),
            this._heartbeatIntervalMs,
        );
    }

    async shutdown(): Promise<void> {
        this._running = false;
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        // Close all sessions
        this._registry.clear();
        this._channelState.clear();
        if (this._server !== null) {
            this._server.stop(true);
            this._server = null;
        }
    }

    getPort(): number {
        return this._server?.port() ?? 0;
    }

    getSessionRegistry(): ClientSessionRegistry {
        return this._registry;
    }

    getDispatcher(): ClientMessageDispatcher {
        return this._dispatcher;
    }

    isRunning(): boolean {
        return this._running;
    }

    /** Register an additional message handler. */
    registerHandler(messageType: number, handler: ClientMessageHandler): void {
        this._dispatcher.register(messageType, handler);
    }

    /** Set the MapPut callback for member-side map operations. */
    setMapPutCallback(
        cb: (name: string, key: Buffer, value: Buffer) => Buffer | null,
    ): void {
        this._onMapPut = cb;
        if (!this._dispatcher.hasHandler(MapPutCodec.REQUEST_MESSAGE_TYPE)) {
            this._registerMapPutHandler();
        }
    }

    // ── connection lifecycle ────────────────────────────────────────────────

    private _onConnect(ch: EventloopChannel): void {
        const sessionId = `client-session-${++sessionCounter}`;
        const session = new ClientSession(ch, sessionId);
        this._channelState.set(ch, {
            reader: new ClientMessageReader(),
            session,
            buffer: Buffer.alloc(0),
        });
    }

    private _onData(ch: EventloopChannel, data: Buffer): void {
        const state = this._channelState.get(ch);
        if (!state) return;

        // Accumulate data
        state.buffer = state.buffer.length > 0
            ? Buffer.concat([state.buffer, data])
            : Buffer.from(data);

        // Try to read complete messages
        this._processBuffer(ch, state);
    }

    private _processBuffer(
        _ch: EventloopChannel,
        state: { reader: ClientMessageReader; session: ClientSession; buffer: Buffer },
    ): void {
        while (state.buffer.length > 0) {
            const bb = ByteBuffer.wrap(state.buffer);
            const complete = state.reader.readFrom(bb, true);
            if (complete) {
                const msg = state.reader.getClientMessage();
                state.reader.reset();
                // Consume bytes that were read
                const consumed = bb.position();
                state.buffer = state.buffer.subarray(consumed);
                // Handle message
                this._handleMessage(msg, state.session).catch(() => {});
            } else {
                // Partial message — keep buffer for next data event
                const consumed = bb.position();
                if (consumed > 0) {
                    state.buffer = state.buffer.subarray(consumed);
                }
                break;
            }
        }
    }

    private _onClose(ch: EventloopChannel): void {
        const state = this._channelState.get(ch);
        if (state) {
            const session = state.session;
            this._registry.remove(session.getSessionId());
            this._channelState.delete(ch);
        }
    }

    // ── message handling ────────────────────────────────────────────────────

    private async _handleMessage(
        msg: ClientMessage,
        session: ClientSession,
    ): Promise<void> {
        session.recordActivity();

        const response = await this._dispatcher.dispatch(msg, session);
        if (response !== null) {
            // Copy correlation ID from request to response
            response.setCorrelationId(msg.getCorrelationId());
            session.sendMessage(response);
        }
    }

    // ── heartbeat monitor ───────────────────────────────────────────────────

    private _checkHeartbeats(): void {
        const now = Date.now();
        for (const session of this._registry.getAllSessions()) {
            if (now - session.getLastSeenMs() > this._heartbeatTimeoutMs) {
                this._registry.remove(session.getSessionId());
                session.destroy();
                // Also clean up channel state
                for (const [ch, state] of this._channelState.entries()) {
                    if (state.session === session) {
                        this._channelState.delete(ch);
                        break;
                    }
                }
            }
        }
    }

    // ── built-in handlers ───────────────────────────────────────────────────

    private _registerAuthHandler(): void {
        this._dispatcher.register(
            ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE,
            async (msg, session) => {
                const req = ClientAuthenticationCodec.decodeRequest(msg);

                // Validate cluster name
                if (req.clusterName !== this._clusterName) {
                    return ClientAuthenticationCodec.encodeResponse(
                        AuthenticationStatus.CREDENTIALS_FAILED.getId(),
                        null,
                        null,
                        this._serializationVersion,
                        "1.0.0",
                        this._partitionCount,
                        this._clusterId,
                        false,
                        null,
                        null,
                        [],
                    );
                }

                // Authenticate
                const clientUuid = req.uuid ?? crypto.randomUUID();
                session.authenticate(
                    clientUuid,
                    req.clientName,
                    req.clientHazelcastVersion,
                );
                this._registry.register(session);

                const memberAddress = new Address(this._host, this.getPort());
                const memberInfo = new MemberInfo(
                    memberAddress,
                    this._memberUuid,
                    new Map(),
                    false,
                    new MemberVersion(0, 1, 0),
                );

                return ClientAuthenticationCodec.encodeResponse(
                    AuthenticationStatus.AUTHENTICATED.getId(),
                    memberAddress,
                    this._memberUuid,
                    this._serializationVersion,
                    "1.0.0",
                    this._partitionCount,
                    this._clusterId,
                    false,
                    null,
                    null,
                    [memberInfo],
                );
            },
        );
    }

    private _registerMapPutHandler(): void {
        this._dispatcher.register(
            MapPutCodec.REQUEST_MESSAGE_TYPE,
            async (msg, _session) => {
                const req = MapPutCodec.decodeRequest(msg);
                let previousData: import("@zenystx/helios-core/internal/serialization/Data").Data | null =
                    null;

                if (this._onMapPut) {
                    const keyBuf = req.key.toByteArray();
                    const valBuf = req.value.toByteArray();
                    if (keyBuf && valBuf) {
                        this._onMapPut(req.name, keyBuf, valBuf);
                    }
                }

                return MapPutCodec.encodeResponse(previousData);
            },
        );
    }
}
