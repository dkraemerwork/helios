/**
 * Member-side client protocol server.
 *
 * Accepts client connections on a dedicated TCP port, handles authentication,
 * dispatches requests to registered handlers, and manages session lifecycle.
 *
 * Port of Hazelcast {@code ClientEngineImpl} — the server-side counterpart
 * of the remote client protocol stack.
 */
import { Address } from "@zenystx/helios-core/cluster/Address";
import type { SecurityConfig } from "@zenystx/helios-core/config/SecurityConfig";
import {
    Eventloop,
    EventloopServer,
    type EventloopChannel,
} from "@zenystx/helios-core/internal/eventloop/Eventloop";
import { ByteBuffer } from "@zenystx/helios-core/internal/networking/ByteBuffer";
import { AuthRateLimiter } from "@zenystx/helios-core/security/impl/AuthRateLimiter";
import { SecurityContext } from "@zenystx/helios-core/security/impl/SecurityContext";
import { SecurityInterceptor } from "@zenystx/helios-core/security/impl/SecurityInterceptor";
import type { AuthAuditListener } from "@zenystx/helios-core/server/clientprotocol/AuthGuard";
import { AuthGuard } from "@zenystx/helios-core/server/clientprotocol/AuthGuard";
import {
    ClientMessageDispatcher,
    type ClientMessageHandler,
} from "@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher";
import { ClientSession } from "@zenystx/helios-core/server/clientprotocol/ClientSession";
import { ClientSessionRegistry } from "@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry";
import { ErrorCodec } from "@zenystx/helios-core/server/clientprotocol/ErrorCodec";
import type { TlsConfig } from "@zenystx/helios-core/server/clientprotocol/TlsConfig";
import { AuthenticationStatus } from "../../client/impl/protocol/AuthenticationStatus";
import { ClientMessage } from "../../client/impl/protocol/ClientMessage";
import { ClientMessageReader } from "../../client/impl/protocol/ClientMessageReader";
import { ByteArrayCodec } from "../../client/impl/protocol/codec/builtin/ByteArrayCodec";
import { FixedSizeTypesCodec, INT_SIZE_IN_BYTES, UUID_SIZE_IN_BYTES } from "../../client/impl/protocol/codec/builtin/FixedSizeTypesCodec";
import { ListMultiFrameCodec } from "../../client/impl/protocol/codec/builtin/ListMultiFrameCodec";
import { StringCodec } from "../../client/impl/protocol/codec/builtin/StringCodec";
import { ClientAuthenticationCodec } from "../../client/impl/protocol/codec/ClientAuthenticationCodec";
import { MapPutCodec } from "../../client/impl/protocol/codec/MapPutCodec";

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
    auth?: {
        username: string;
        password: string;
    } | null;
    /** Optional TLS configuration.  If omitted the server listens in plain TCP. */
    tls?: TlsConfig;
    /** Optional audit listener for authentication events. */
    auditListener?: AuthAuditListener;
    /**
     * Optional security configuration.  When provided and enabled, per-operation
     * permission checks are enforced on every client message.
     */
    securityConfig?: SecurityConfig | null;
}

// ClientAuthenticationCustom: hex 0x000200 = 512
const CLIENT_AUTH_CUSTOM_REQUEST_TYPE  = 0x000200;

// Custom auth request initial frame layout (matches ClientAuthenticationCustomCodec):
//   [0..3]   messageType
//   [4..11]  correlationId
//   [12..15] partitionId
//   [16..32] uuid (17 bytes: isNull + msb + lsb)
//   [33]     serializationVersion (byte)
const CUSTOM_AUTH_UUID_OFFSET                 = ClientMessage.PARTITION_ID_FIELD_OFFSET + INT_SIZE_IN_BYTES; // 16
const CUSTOM_AUTH_SERIALIZATION_VERSION_OFFSET = CUSTOM_AUTH_UUID_OFFSET + UUID_SIZE_IN_BYTES;               // 33

let sessionCounter = 0;

type SessionClosePolicy = "close" | "respond-then-close";

const CLIENT_PROTOCOL_CLOSE_POLICY = Object.freeze({
    authenticationFailure: "respond-then-close",
    authenticationRequired: "close",
    protocolViolation: "close",
} satisfies Record<string, SessionClosePolicy>);

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
    private readonly _auth: { username: string; password: string } | null;
    private readonly _tls: TlsConfig | undefined;

    private readonly _registry: ClientSessionRegistry;
    private readonly _dispatcher: ClientMessageDispatcher;
    private readonly _authGuard: AuthGuard;
    private readonly _securityInterceptor: SecurityInterceptor | null;
    private readonly _securityConfig: SecurityConfig | null;

    private _server: EventloopServer | null = null;
    private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    /**
     * Per-channel receive state.
     *
     * `protocolHeaderReceived` tracks whether the 3-byte binary protocol
     * version header ("CP2") has been consumed.  The official hazelcast-client
     * sends this header immediately after TCP connect, before the first
     * ClientMessage frame.
     */
    private readonly _channelState = new Map<
        EventloopChannel,
        {
            reader: ClientMessageReader;
            session: ClientSession;
            buffer: Buffer;
            processing: boolean;
            protocolHeaderReceived: boolean;
        }
    >();

    private _onMapPut: ((name: string, key: Buffer, value: Buffer) => Buffer | null) | null;
    private _sessionCloseHandler: ((session: ClientSession) => void) | null = null;

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
        this._auth = opts.auth ?? null;
        this._tls = opts.tls;

        this._securityConfig = opts.securityConfig ?? null;
        const rateLimiter = new AuthRateLimiter();

        this._registry = new ClientSessionRegistry();
        this._dispatcher = new ClientMessageDispatcher();
        this._authGuard = new AuthGuard({
            clusterName: opts.clusterName,
            credentials: opts.auth ?? null,
            auditListener: opts.auditListener,
            securityConfig: this._securityConfig,
            rateLimiter,
        });

        this._securityInterceptor = (this._securityConfig !== null && this._securityConfig.isEnabled())
            ? new SecurityInterceptor(this._securityConfig)
            : null;

        // Register built-in handlers
        this._registerAuthHandler();
        if (opts.enableMapHandler) {
            this._registerMapPutHandler();
        }
    }

    async start(): Promise<void> {
        this._server = Eventloop.listen(
            this._port,
            this._host,
            {
                onConnect: (ch) => this._onConnect(ch),
                onData: (ch, data) => this._onData(ch, data),
                onClose: (ch) => this._onClose(ch),
            },
            this._tls !== undefined ? { tls: this._tls.toBunTlsOptions() } : undefined,
        );
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

    getAuthGuard(): AuthGuard {
        return this._authGuard;
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

    setSessionCloseHandler(handler: (session: ClientSession) => void): void {
        this._sessionCloseHandler = handler;
    }

    // ── connection lifecycle ────────────────────────────────────────────────

    private _onConnect(ch: EventloopChannel): void {
        const sessionId = `client-session-${++sessionCounter}`;
        const session = new ClientSession(ch, sessionId);
        this._channelState.set(ch, {
            reader: new ClientMessageReader(),
            session,
            buffer: Buffer.alloc(0),
            processing: false,
            protocolHeaderReceived: false,
        });
    }

    private _onData(ch: EventloopChannel, data: Buffer): void {
        const state = this._channelState.get(ch);
        if (!state) return;

        // Accumulate data
        state.buffer = state.buffer.length > 0
            ? Buffer.concat([state.buffer, data])
            : Buffer.from(data);

        if (!state.processing) {
            this._processBuffer(ch, state).catch(() => {});
        }
    }

    private async _processBuffer(
        ch: EventloopChannel,
        state: {
            reader: ClientMessageReader;
            session: ClientSession;
            buffer: Buffer;
            processing: boolean;
            protocolHeaderReceived: boolean;
        },
    ): Promise<void> {
        state.processing = true;
        try {
            if (!state.protocolHeaderReceived) {
                if (state.buffer.length < 3) {
                    state.processing = false;
                    return;
                }

                const hasProtocolHeader = state.buffer[0] === 0x43
                    && state.buffer[1] === 0x50
                    && state.buffer[2] === 0x32;
                if (hasProtocolHeader) {
                    state.buffer = state.buffer.subarray(3);
                }
                state.protocolHeaderReceived = true;
            }

            while (state.buffer.length > 0 && !ch.isClosed()) {
                const bb = ByteBuffer.wrap(state.buffer);
                const complete = state.reader.readFrom(bb, true);
                if (complete) {
                    const msg = state.reader.getClientMessage();
                    state.reader.reset();
                    const consumed = bb.position();
                    state.buffer = state.buffer.subarray(consumed);
                    const shouldContinue = await this._handleMessage(msg, state.session);
                    if (!shouldContinue || ch.isClosed()) {
                        state.buffer = Buffer.alloc(0);
                        state.reader.reset();
                        break;
                    }
                } else {
                    const consumed = bb.position();
                    if (consumed > 0) {
                        state.buffer = state.buffer.subarray(consumed);
                    }
                    break;
                }
            }
        } finally {
            const latestState = this._channelState.get(ch);
            if (latestState) {
                latestState.processing = false;
                if (latestState.buffer.length > 0 && !ch.isClosed()) {
                    this._processBuffer(ch, latestState).catch(() => {});
                }
            }
        }
    }

    private _onClose(ch: EventloopChannel): void {
        const state = this._channelState.get(ch);
        if (state) {
            const session = state.session;
            this._registry.remove(session.getSessionId());
            this._channelState.delete(ch);
            this._sessionCloseHandler?.(session);
        }
    }

    // ── message handling ────────────────────────────────────────────────────

    private async _handleMessage(
        msg: ClientMessage,
        session: ClientSession,
    ): Promise<boolean> {
        session.recordActivity();

        // ── Per-operation security check ────────────────────────────────────
        if (this._securityInterceptor !== null && session.isAuthenticated()) {
            const ctx = session.getSecurityContext();
            const msgType = msg.getMessageType();
            const requiredPerm = this._securityInterceptor.getRequiredPermission(msgType);
            if (requiredPerm !== null && ctx !== null) {
                if (!ctx.hasPermission(requiredPerm)) {
                    const errResp = ErrorCodec.encodeAuthRequired();
                    errResp.setCorrelationId(msg.getCorrelationId());
                    session.sendMessage(errResp);
                    return true; // keep session alive, just deny this op
                }
            }
        }

        const { response, closeAfterSend, closeImmediately } =
            await this._authGuard.guardedDispatch(msg, session, this._dispatcher, this._registry);

        if (closeImmediately) {
            session.destroy();
            return false;
        }

        if (response !== null) {
            if (this._isAuthenticationFailureResponse(msg, response)) {
                response.setCorrelationId(msg.getCorrelationId());
                this._applyClosePolicy(
                    session,
                    CLIENT_PROTOCOL_CLOSE_POLICY.authenticationFailure,
                    response,
                );
                return false;
            }
            this._sendResponse(msg, response, session);
        }

        if (closeAfterSend) {
            session.destroy();
            return false;
        }

        return true;
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
        // ── Standard authentication (0x000100) ───────────────────────────────
        this._dispatcher.allowBeforeAuthentication(
            ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE,
        );
        this._dispatcher.register(
            ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE,
            async (msg, session) => {
                if (session.isAuthenticated()) {
                    return this._encodeAuthenticationNotAllowedResponse();
                }

                const req = ClientAuthenticationCodec.decodeRequest(msg);

                // Validate cluster name and credentials via the AuthGuard
                const credCheck = this._authGuard.validateCredentials({
                    clusterName: req.clusterName,
                    username: req.username ?? null,
                    password: req.password ?? null,
                });
                if (!credCheck.ok) {
                    this._authGuard.auditAuthFailure(
                        session.getSessionId(),
                        credCheck.auditKind,
                    );
                    return this._encodeAuthenticationFailureResponse();
                }

                // Authenticate
                const clientUuid = req.uuid ?? crypto.randomUUID();
                session.authenticate(
                    clientUuid,
                    req.clientName,
                    req.clientHazelcastVersion,
                );

                // Attach SecurityContext — builds granted permissions from SecurityConfig
                const principal = req.username ?? 'anonymous';
                const ctx = this._authGuard.buildSecurityContext(principal, session.getClientName() ?? '');
                session.setSecurityContext(ctx);

                this._registry.register(session);
                this._authGuard.auditAuthSuccess(session);

                const memberAddress = new Address(this._host, this.getPort());

                return ClientAuthenticationCodec.encodeResponse(
                    AuthenticationStatus.AUTHENTICATED.getId(),
                    memberAddress,
                    this._memberUuid,
                    this._serializationVersion,
                    "5.5.0",
                    this._partitionCount,
                    this._clusterId,
                    false,
                );
            },
        );

        // ── Custom authentication (0x000200) ─────────────────────────────────
        // Validates cluster name.  When security is enabled, attempts token auth
        // using the custom credentials byte-array.  Falls back to anonymous
        // SecurityContext when security is disabled.
        this._dispatcher.allowBeforeAuthentication(CLIENT_AUTH_CUSTOM_REQUEST_TYPE);
        this._dispatcher.register(
            CLIENT_AUTH_CUSTOM_REQUEST_TYPE,
            async (msg, session) => {
                if (session.isAuthenticated()) {
                    return this._encodeAuthenticationNotAllowedResponse();
                }

                const req = _decodeCustomAuthRequest(msg);

                // Validate cluster name first
                const credCheck = this._authGuard.validateCredentials({
                    clusterName: req.clusterName,
                    username: null,
                    password: null,
                });
                if (!credCheck.ok) {
                    this._authGuard.auditAuthFailure(
                        session.getSessionId(),
                        credCheck.auditKind,
                    );
                    return this._encodeAuthenticationFailureResponse();
                }

                const clientUuid = req.uuid ?? crypto.randomUUID();
                session.authenticate(
                    clientUuid,
                    req.clientName,
                    req.clientHazelcastVersion,
                );

                // Token auth: if security enabled, validate the custom credentials byte-array as a token.
                // If token auth fails and security is enabled, reject the connection.
                const tokenBytes = req.credentialsBytes;
                let securityCtx: SecurityContext | null = null;
                if (tokenBytes.length > 0) {
                    securityCtx = this._authGuard.validateTokenCredentials(
                        tokenBytes,
                        session.getClientName() ?? '',
                    );
                    if (securityCtx === null && this._securityConfig !== null && this._securityConfig.isEnabled()) {
                        // Token not found — reject connection when security is enforced
                        this._authGuard.auditAuthFailure(session.getSessionId(), 'auth_failure');
                        return this._encodeAuthenticationFailureResponse();
                    }
                }

                // Fall back to anonymous context if security is disabled or no token bytes
                session.setSecurityContext(
                    securityCtx ?? this._authGuard.buildSecurityContext('anonymous', session.getClientName() ?? ''),
                );

                this._registry.register(session);
                this._authGuard.auditAuthSuccess(session);

                const memberAddress = new Address(this._host, this.getPort());

                return ClientAuthenticationCodec.encodeResponse(
                    AuthenticationStatus.AUTHENTICATED.getId(),
                    memberAddress,
                    this._memberUuid,
                    this._serializationVersion,
                    "5.5.0",
                    this._partitionCount,
                    this._clusterId,
                    false,
                );
            },
        );
    }

    private _sendResponse(
        request: ClientMessage,
        response: ClientMessage,
        session: ClientSession,
    ): void {
        response.setCorrelationId(request.getCorrelationId());
        session.sendMessage(response);
    }

    private _applyClosePolicy(
        session: ClientSession,
        policy: SessionClosePolicy,
        response: ClientMessage | null = null,
    ): void {
        if (policy === "respond-then-close" && response !== null) {
            session.sendMessage(response);
        }
        session.destroy();
    }

    private _isAuthenticationFailureResponse(
        request: ClientMessage,
        response: ClientMessage,
    ): boolean {
        if (request.getMessageType() !== ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE) {
            return false;
        }
        return ClientAuthenticationCodec.decodeResponse(response).status
            !== AuthenticationStatus.AUTHENTICATED.getId();
    }

    private _encodeAuthenticationFailureResponse(): ClientMessage {
        return this._encodeAuthenticationStatusResponse(
            AuthenticationStatus.CREDENTIALS_FAILED.getId(),
        );
    }

    private _encodeAuthenticationNotAllowedResponse(): ClientMessage {
        return this._encodeAuthenticationStatusResponse(
            AuthenticationStatus.NOT_ALLOWED_IN_CLUSTER.getId(),
        );
    }

    private _encodeAuthenticationStatusResponse(status: number): ClientMessage {
        return ClientAuthenticationCodec.encodeResponse(
            status,
            null,
            null,
            this._serializationVersion,
            "5.5.0",
            this._partitionCount,
            this._clusterId,
            false,
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

// ── ClientAuthenticationCustom request decoder ────────────────────────────────
//
// Wire layout of the initial frame:
//   [0..3]   messageType
//   [4..11]  correlationId
//   [12..15] partitionId
//   [16..32] uuid  (17 bytes: isNull(1) + msb(8) + lsb(8))
//   [33]     serializationVersion (byte)
//
// Subsequent frames:
//   clusterName           (StringCodec)
//   credentials           (ByteArrayCodec  — raw bytes, not inspected)
//   clientType            (StringCodec)
//   clientHazelcastVersion(StringCodec)
//   clientName            (StringCodec)
//   labels                (ListMultiFrame<String>)

function _decodeCustomAuthRequest(msg: ClientMessage): {
    clusterName: string;
    uuid: string | null;
    serializationVersion: number;
    clientType: string;
    clientHazelcastVersion: string;
    clientName: string;
    labels: string[];
    credentialsBytes: Buffer;
} {
    const iter = msg.forwardFrameIterator();
    const initialFrame = iter.next();

    const uuid = FixedSizeTypesCodec.decodeUUID(initialFrame.content, CUSTOM_AUTH_UUID_OFFSET);
    const serializationVersion = initialFrame.content.readUInt8(CUSTOM_AUTH_SERIALIZATION_VERSION_OFFSET);

    const clusterName = StringCodec.decode(iter);
    // credentials byte-array — decoded and returned for token authentication
    const credentialsBytes = Buffer.from(ByteArrayCodec.decode(iter));
    const clientType = StringCodec.decode(iter);
    const clientHazelcastVersion = StringCodec.decode(iter);
    const clientName = StringCodec.decode(iter);
    const labels = ListMultiFrameCodec.decode(iter, (i) => StringCodec.decode(i));

    return { clusterName, uuid, serializationVersion, clientType, clientHazelcastVersion, clientName, labels, credentialsBytes };
}
