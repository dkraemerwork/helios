/**
 * Block C — Authentication Guard
 *
 * Enforces authentication and opcode validity BEFORE any non-auth handler
 * executes.  Sits in the dispatch path between the raw TCP reader and the
 * business-logic handlers.
 *
 * Responsibilities:
 *   1. Reject unauthenticated sessions with AUTH_REQUIRED error response.
 *   2. Reject unknown opcodes with UNDEFINED_ERROR_CODE error response.
 *   3. Validate cluster name on reconnect (re-authentication after session
 *      migration or failover).
 *   4. Emit structured audit log entries for auth events (success, failure,
 *      rejected request).
 *
 * Integration points:
 *   - ClientProtocolServer wires an AuthGuard into the dispatch loop.
 *   - ClientMessageDispatcher still owns the handler registry; the guard
 *     wraps dispatch() not the dispatcher itself.
 *   - ClientSessionRegistry is queried to look up sessions by UUID for
 *     reconnect validation.
 *
 * Port of Hazelcast {@code ClientEndpoint.checkOwnerUuid} +
 * {@code ClientProtocolService.messageArrived} security checks.
 */

import type { PermissionConfig, SecurityConfig } from '@zenystx/helios-core/config/SecurityConfig.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import { AccessControlException } from '@zenystx/helios-core/security/AccessControlException.js';
import { AuthRateLimiter } from '@zenystx/helios-core/security/impl/AuthRateLimiter.js';
import { SecurityContext } from '@zenystx/helios-core/security/impl/SecurityContext.js';
import { TokenAuthenticator } from '@zenystx/helios-core/security/impl/TokenAuthenticator.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import {
    ClientAuthenticationRequiredError,
    ClientProtocolOpcodeError,
} from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientSession } from '@zenystx/helios-core/server/clientprotocol/ClientSession.js';
import type { ClientSessionRegistry } from '@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry.js';
import { ErrorCodec } from '@zenystx/helios-core/server/clientprotocol/ErrorCodec.js';
import { ClientMessage } from '../../client/impl/protocol/ClientMessage.js';
import { ClientAuthenticationCodec } from '../../client/impl/protocol/codec/ClientAuthenticationCodec.js';

// ── Audit event types ─────────────────────────────────────────────────────────

export type AuthAuditEventKind =
    | 'auth_success'
    | 'auth_failure'
    | 'auth_not_allowed'
    | 'auth_required'
    | 'cluster_name_mismatch'
    | 'opcode_unknown'
    | 'reconnect_validated'
    | 'reconnect_rejected';

export interface AuthAuditEvent {
    readonly kind: AuthAuditEventKind;
    readonly sessionId: string;
    readonly clientUuid: string | null;
    readonly remoteInfo: string;
    readonly timestampMs: number;
    readonly detail?: string;
}

export type AuthAuditListener = (event: AuthAuditEvent) => void;

// ── AuthGuard options ─────────────────────────────────────────────────────────

export interface AuthGuardOptions {
    /** The authoritative cluster name. Auth is rejected if client sends a different name. */
    clusterName: string;
    /** Optional credential check. Null means no credential validation. */
    credentials?: { username: string; password: string } | null;
    /** Logger for debug / info messages. */
    logger?: ILogger;
    /** Audit listener called for every auth event. */
    auditListener?: AuthAuditListener;
    /**
     * Optional security configuration.  When provided, authenticated sessions
     * receive a SecurityContext built from the client permission configs, and
     * token credentials are validated via TokenAuthenticator.
     */
    securityConfig?: SecurityConfig | null;
    /**
     * Optional rate limiter for auth failures.  When provided, IPs that exceed
     * the failure threshold are temporarily blocked.
     */
    rateLimiter?: AuthRateLimiter | null;
}

// ── Dispatch result ───────────────────────────────────────────────────────────

export interface GuardedDispatchResult {
    /** The response to send back to the client (null if no response needed). */
    response: ClientMessage | null;
    /**
     * If true, the session should be closed AFTER sending the response.
     * This happens on auth failure (respond-then-close).
     */
    closeAfterSend: boolean;
    /**
     * If true, close immediately WITHOUT sending any response.
     * This happens on protocol violations.
     */
    closeImmediately: boolean;
}

// ── AuthGuard ─────────────────────────────────────────────────────────────────

/**
 * Authentication guard that wraps {@link ClientMessageDispatcher.dispatch}.
 *
 * Call {@link guardedDispatch} instead of {@link ClientMessageDispatcher.dispatch}
 * to get authentication enforcement, opcode validation, and audit logging in one
 * place.
 */
export class AuthGuard {
    private readonly _clusterName: string;
    private readonly _credentials: { username: string; password: string } | null;
    private readonly _logger: ILogger | null;
    private readonly _auditListener: AuthAuditListener | null;
    private readonly _securityConfig: SecurityConfig | null;
    private readonly _tokenAuthenticator: TokenAuthenticator | null;
    private readonly _rateLimiter: AuthRateLimiter | null;

    constructor(options: AuthGuardOptions) {
        this._clusterName = options.clusterName;
        this._credentials = options.credentials ?? null;
        this._logger = options.logger ?? null;
        this._auditListener = options.auditListener ?? null;
        this._securityConfig = options.securityConfig ?? null;
        this._rateLimiter = options.rateLimiter ?? null;

        if (this._securityConfig !== null && this._securityConfig.isEnabled()) {
            this._tokenAuthenticator = new TokenAuthenticator(this._securityConfig.getTokenConfigs());
        } else {
            this._tokenAuthenticator = null;
        }
    }

    // ── Core guarded dispatch ─────────────────────────────────────────────────

    /**
     * Validate the incoming message against auth and opcode constraints, then
     * delegate to the dispatcher.
     *
     * The caller is responsible for:
     *   1. Sending {@link GuardedDispatchResult.response} if non-null.
     *   2. Closing the session if {@link GuardedDispatchResult.closeAfterSend}
     *      or {@link GuardedDispatchResult.closeImmediately} is true.
     *
     * @param msg        Incoming client message.
     * @param session    The session that sent the message.
     * @param dispatcher The message dispatcher with registered handlers.
     * @param registry   The session registry (for reconnect validation).
     */
    async guardedDispatch(
        msg: ClientMessage,
        session: ClientSession,
        dispatcher: ClientMessageDispatcher,
        registry: ClientSessionRegistry,
    ): Promise<GuardedDispatchResult> {
        const msgType = msg.getMessageType();

        // Reconnect cluster-name validation: if the session is already
        // authenticated and the client sends another auth request WITH a
        // mismatched cluster name, reject early.
        if (
            msgType === ClientAuthenticationCodec.REQUEST_MESSAGE_TYPE &&
            session.isAuthenticated()
        ) {
            const req = ClientAuthenticationCodec.decodeRequest(msg);
            if (req.clusterName !== this._clusterName) {
                this._audit({
                    kind: 'reconnect_rejected',
                    sessionId: session.getSessionId(),
                    clientUuid: session.getClientUuid(),
                    remoteInfo: session.getClientName() ?? 'unknown',
                    timestampMs: Date.now(),
                    detail: `clusterName=${req.clusterName}`,
                });
                this._logWarn(
                    `[AuthGuard] Reconnect rejected: cluster name mismatch ` +
                    `(expected='${this._clusterName}', got='${req.clusterName}') ` +
                    `session=${session.getSessionId()}`,
                );
                const errResp = ErrorCodec.encodeClusterNameMismatch(this._clusterName, req.clusterName);
                return { response: errResp, closeAfterSend: true, closeImmediately: false };
            }
            // Same cluster name — fall through to auth handler which will
            // return NOT_ALLOWED_IN_CLUSTER for duplicate auth.
        }

        // Rate-limit check: if the IP is blocked, reject immediately
        if (this._rateLimiter !== null) {
            const remoteIp = this._extractIp(session);
            if (this._rateLimiter.isBlocked(remoteIp)) {
                this._logWarn(
                    `[AuthGuard] Rate-limited IP ${remoteIp} — closing connection`,
                );
                return { response: null, closeAfterSend: false, closeImmediately: true };
            }
        }

        // Pre-auth check — the dispatcher will throw if the session is not
        // authenticated and the message type requires auth.
        let response: ClientMessage | null;
        try {
            response = await dispatcher.dispatch(msg, session);
        } catch (error) {
            if (error instanceof AccessControlException) {
                this._audit({
                    kind: 'auth_not_allowed',
                    sessionId: session.getSessionId(),
                    clientUuid: session.getClientUuid(),
                    remoteInfo: session.getClientName() ?? 'unknown',
                    timestampMs: Date.now(),
                    detail: `permission=${error.permission.constructor.name}[${error.permission.getName()}] principal=${error.principal}`,
                });
                this._logWarn(
                    `[AuthGuard] Access denied: ${error.message} session=${session.getSessionId()}`,
                );
                const errResp = ErrorCodec.encodeAuthRequired();
                return { response: errResp, closeAfterSend: false, closeImmediately: false };
            }

            if (error instanceof ClientAuthenticationRequiredError) {
                this._audit({
                    kind: 'auth_required',
                    sessionId: session.getSessionId(),
                    clientUuid: session.getClientUuid(),
                    remoteInfo: 'unknown',
                    timestampMs: Date.now(),
                    detail: `msgType=0x${msgType.toString(16).padStart(6, '0')}`,
                });
                this._logWarn(
                    `[AuthGuard] Unauthenticated message type 0x${msgType.toString(16)} ` +
                    `from session ${session.getSessionId()} — closing`,
                );
                const errResp = ErrorCodec.encodeAuthRequired();
                return { response: errResp, closeAfterSend: false, closeImmediately: true };
            }

            if (error instanceof ClientProtocolOpcodeError) {
                if (error.reason === 'unknown') {
                    this._audit({
                        kind: 'opcode_unknown',
                        sessionId: session.getSessionId(),
                        clientUuid: session.getClientUuid(),
                        remoteInfo: 'unknown',
                        timestampMs: Date.now(),
                        detail: `opcode=0x${error.messageType.toString(16).padStart(6, '0')}`,
                    });
                    this._logWarn(
                        `[AuthGuard] Unknown opcode 0x${error.messageType.toString(16)} ` +
                        `from session ${session.getSessionId()} — closing`,
                    );
                    // Close immediately without sending a response — fail closed on protocol violation.
                    return { response: null, closeAfterSend: false, closeImmediately: true };
                }
                // Illegal opcode (not a request type) — close without response
                this._logWarn(
                    `[AuthGuard] Illegal opcode 0x${error.messageType.toString(16)} ` +
                    `from session ${session.getSessionId()} — closing`,
                );
                return { response: null, closeAfterSend: false, closeImmediately: true };
            }

            throw error;
        }

        return { response, closeAfterSend: false, closeImmediately: false };
    }

    // ── Credential validation (used by ClientProtocolServer auth handler) ─────

    /**
     * Validate credentials in an authentication request.
     * Returns null on success, or an error ClientMessage on failure.
     *
     * @param req  Decoded authentication request fields.
     */
    validateCredentials(req: {
        clusterName: string;
        username: string | null;
        password: string | null;
        remoteIp?: string;
    }): { ok: true } | { ok: false; errorResponse: ClientMessage; auditKind: AuthAuditEventKind } {
        if (req.clusterName !== this._clusterName) {
            if (req.remoteIp !== undefined) {
                this._rateLimiter?.recordFailure(req.remoteIp);
            }
            return {
                ok: false,
                errorResponse: ErrorCodec.encodeClusterNameMismatch(this._clusterName, req.clusterName),
                auditKind: 'cluster_name_mismatch',
            };
        }
        if (this._credentials !== null) {
            if (
                req.username !== this._credentials.username ||
                req.password !== this._credentials.password
            ) {
                if (req.remoteIp !== undefined) {
                    this._rateLimiter?.recordFailure(req.remoteIp);
                }
                return {
                    ok: false,
                    errorResponse: ErrorCodec.encodeAuthRequired(),
                    auditKind: 'auth_failure',
                };
            }
        }
        if (req.remoteIp !== undefined) {
            this._rateLimiter?.recordSuccess(req.remoteIp);
        }
        return { ok: true };
    }

    /**
     * Validate a token credential byte buffer.
     *
     * Used by the custom auth handler when security is enabled and the client
     * provides token credentials.  Returns a SecurityContext if the token is
     * valid, or null if not recognized.
     *
     * @param tokenBytes  The raw token bytes from the auth request.
     * @param endpoint    The client endpoint string for the SecurityContext.
     * @param remoteIp    The client IP for rate-limiting tracking.
     */
    validateTokenCredentials(
        tokenBytes: Buffer,
        endpoint: string,
        remoteIp?: string,
    ): SecurityContext | null {
        if (this._tokenAuthenticator === null) {
            return null;
        }
        const ctx = this._tokenAuthenticator.authenticate(tokenBytes, endpoint);
        if (ctx === null && remoteIp !== undefined) {
            this._rateLimiter?.recordFailure(remoteIp);
        } else if (ctx !== null && remoteIp !== undefined) {
            this._rateLimiter?.recordSuccess(remoteIp);
        }
        return ctx;
    }

    /**
     * Build a SecurityContext for a successfully username/password-authenticated session.
     *
     * When security is disabled or no security config is provided, returns an
     * anonymous context.  When security is enabled, uses the client permission
     * configs from SecurityConfig.
     *
     * @param principal  The authenticated principal (username).
     * @param endpoint   The client endpoint string.
     */
    buildSecurityContext(principal: string, endpoint: string): SecurityContext {
        if (this._securityConfig === null || !this._securityConfig.isEnabled()) {
            return SecurityContext.anonymous();
        }
        const configs: PermissionConfig[] = this._securityConfig.getClientPermissionConfigs().filter(
            (c) => c.getPrincipal() === '*' || c.getPrincipal() === principal,
        );
        return SecurityContext.fromPermissionConfigs(principal, configs, endpoint);
    }

    /**
     * Emit an auth-success audit event.
     * Called by ClientProtocolServer after a successful authentication.
     */
    auditAuthSuccess(session: ClientSession): void {
        this._audit({
            kind: 'auth_success',
            sessionId: session.getSessionId(),
            clientUuid: session.getClientUuid(),
            remoteInfo: session.getClientName() ?? 'unknown',
            timestampMs: Date.now(),
        });
        this._logInfo(
            `[AuthGuard] Auth success: session=${session.getSessionId()} ` +
            `uuid=${session.getClientUuid()} name=${session.getClientName()}`,
        );
    }

    /**
     * Emit an auth-failure audit event.
     * Called by ClientProtocolServer on credential failure.
     */
    auditAuthFailure(sessionId: string, reason: string): void {
        this._audit({
            kind: 'auth_failure',
            sessionId,
            clientUuid: null,
            remoteInfo: 'unknown',
            timestampMs: Date.now(),
            detail: reason,
        });
        this._logWarn(`[AuthGuard] Auth failure: session=${sessionId} reason=${reason}`);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _extractIp(session: ClientSession): string {
        const name = session.getClientName() ?? '';
        // Extract IP portion from "host:port" or "host"
        const lastColon = name.lastIndexOf(':');
        return lastColon > 0 ? name.substring(0, lastColon) : name;
    }

    private _audit(event: AuthAuditEvent): void {
        this._auditListener?.(event);
    }

    private _logInfo(msg: string): void {
        this._logger?.info?.(msg);
    }

    private _logWarn(msg: string): void {
        if (this._logger && typeof (this._logger as unknown as { warning?: (m: string) => void }).warning === 'function') {
            (this._logger as unknown as { warning: (m: string) => void }).warning(msg);
        } else {
            this._logger?.info?.(msg);
        }
    }

}
