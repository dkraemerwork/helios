/**
 * Block D.2 — Listener Recovery Manager  (server-side)
 *
 * Port of Hazelcast's server-side listener tracking and recovery logic.
 *
 * Responsibilities:
 *   - Accept listener registrations from clients (opcode, filter data, callback ref).
 *   - Issue a server-side acknowledgement with a stable registration UUID.
 *   - Persist listener metadata per client session.
 *   - On reconnect: re-register ALL listeners for a session with exponential backoff.
 *   - Deduplicate: if the server already holds an equivalent registration, update
 *     rather than create a new one.
 *   - Fail observably (error event) after maxReregistrationAttempts.
 *   - Track registration lifecycle: PENDING → ACTIVE → RECOVERING → FAILED.
 *
 * Lifecycle: start() → active → stop().
 */

import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';

// ── Registration state ────────────────────────────────────────────────────────

export enum ListenerRegistrationState {
    PENDING = 'PENDING',
    ACTIVE = 'ACTIVE',
    RECOVERING = 'RECOVERING',
    FAILED = 'FAILED',
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Opaque filter data supplied by the client at registration time. */
export type ListenerFilterData = Buffer | null;

/**
 * Callback invoked when an event matching this listener occurs.
 * The event payload is an opaque buffer (the raw client-protocol event frame).
 */
export type ListenerCallback = (eventPayload: Buffer) => void;

/** Immutable metadata captured at registration time. */
export interface ListenerMetadata {
    /** Stable server-assigned UUID returned to the client as ACK. */
    readonly registrationUuid: string;
    /** Client session ID that owns this registration. */
    readonly sessionId: string;
    /** Client-supplied opcode identifying the event type (e.g. 0x011901). */
    readonly opcode: number;
    /** Optional key/predicate filter data from the client request. */
    readonly filterData: ListenerFilterData;
    /** Target member UUID, or null for any member. */
    readonly targetMemberUuid: string | null;
    /** The actual callback to invoke on event dispatch. */
    readonly callback: ListenerCallback;
}

/** Full mutable registration record tracked by this manager. */
export interface ListenerRegistration extends ListenerMetadata {
    /** Current lifecycle state. */
    state: ListenerRegistrationState;
    /** Number of re-registration attempts made during recovery. */
    recoveryAttempts: number;
    /** Timestamp of the last re-registration attempt (epoch-ms). */
    lastAttemptAt: number;
}

/** Result returned to the caller after a successful registration. */
export interface ListenerRegistrationResult {
    /** The server-assigned registration UUID (to be sent as ACK to client). */
    readonly registrationUuid: string;
    /** Initial state (always ACTIVE on first registration). */
    readonly state: ListenerRegistrationState;
}

export interface ListenerRecoveryManagerOptions {
    /** Max re-registration attempts during recovery. Default: 50. */
    maxReregistrationAttempts?: number;
    /** Initial backoff between re-registration attempts (ms). Default: 100. */
    initialBackoffMs?: number;
    /** Maximum backoff between re-registration attempts (ms). Default: 30_000. */
    maxBackoffMs?: number;
    /** Backoff multiplier for exponential growth. Default: 2. */
    backoffMultiplier?: number;
    logger?: ILogger;
}

export interface ListenerRecoveryMetrics {
    totalRegistrations: number;
    activeRegistrations: number;
    recoveringRegistrations: number;
    failedRegistrations: number;
    successfulRecoveries: number;
    totalRecoveryAttempts: number;
}

/**
 * Re-registration factory: when a session reconnects, the manager calls this
 * for each listener that needs to be restored.  The factory should attempt the
 * actual server-side operation (subscribe to the data-structure event, etc.)
 * and return true on success or false on transient failure.
 */
export type ReregistrationHandler = (reg: ListenerRegistration) => Promise<boolean>;

// ── Error type ────────────────────────────────────────────────────────────────

export class ListenerRecoveryFailedError extends Error {
    constructor(
        readonly registrationUuid: string,
        readonly sessionId: string,
        readonly attempts: number,
    ) {
        super(
            `Listener recovery failed for registration ${registrationUuid} ` +
            `(session ${sessionId}) after ${attempts} attempt(s)`,
        );
        this.name = 'ListenerRecoveryFailedError';
    }
}

// ── Implementation ────────────────────────────────────────────────────────────

export class ListenerRecoveryManager {
    private readonly _logger: ILogger | null;
    private readonly _maxReregistrationAttempts: number;
    private readonly _initialBackoffMs: number;
    private readonly _maxBackoffMs: number;
    private readonly _backoffMultiplier: number;

    /** All registrations, indexed by registrationUuid. */
    private readonly _registrations = new Map<string, ListenerRegistration>();
    /** registrationUuid sets grouped by sessionId for fast session lookup. */
    private readonly _sessionIndex = new Map<string, Set<string>>();

    /** Error event listeners notified on FAILED transitions. */
    private readonly _errorListeners: Array<(err: ListenerRecoveryFailedError) => void> = [];

    private _running = false;

    // Metrics
    private _successfulRecoveries = 0;
    private _totalRecoveryAttempts = 0;

    constructor(options?: ListenerRecoveryManagerOptions) {
        this._maxReregistrationAttempts = options?.maxReregistrationAttempts ?? 50;
        this._initialBackoffMs = options?.initialBackoffMs ?? 100;
        this._maxBackoffMs = options?.maxBackoffMs ?? 30_000;
        this._backoffMultiplier = options?.backoffMultiplier ?? 2;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
        this._registrations.clear();
        this._sessionIndex.clear();
    }

    // ── Error listeners ───────────────────────────────────────────────────────

    /** Subscribe to recovery-failure events. */
    onRecoveryFailed(listener: (err: ListenerRecoveryFailedError) => void): void {
        this._errorListeners.push(listener);
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Register a new listener on behalf of a client session.
     *
     * Checks for an existing equivalent registration (same sessionId + opcode +
     * filterData fingerprint) to avoid duplicates.  Returns the stable UUID as ACK.
     *
     * @param sessionId        Client session identifier.
     * @param opcode           Event type opcode from the client request.
     * @param filterData       Optional binary filter (key, predicate, etc.).
     * @param targetMemberUuid Target member, or null for any.
     * @param callback         Callback to invoke on event delivery.
     */
    register(
        sessionId: string,
        opcode: number,
        filterData: ListenerFilterData,
        targetMemberUuid: string | null,
        callback: ListenerCallback,
    ): ListenerRegistrationResult {
        // Deduplicate: check for existing equivalent registration for this session
        const existing = this._findExisting(sessionId, opcode, filterData, targetMemberUuid);
        if (existing !== undefined) {
            this._logger?.fine(
                `[ListenerRecoveryManager] Dedup: updating existing registration ` +
                `${existing.registrationUuid} for session ${sessionId}`,
            );
            // Update the callback reference in case it changed
            (existing as { callback: ListenerCallback }).callback = callback;
            existing.state = ListenerRegistrationState.ACTIVE;
            existing.recoveryAttempts = 0;
            return {
                registrationUuid: existing.registrationUuid,
                state: ListenerRegistrationState.ACTIVE,
            };
        }

        const registrationUuid = crypto.randomUUID();
        const reg: ListenerRegistration = {
            registrationUuid,
            sessionId,
            opcode,
            filterData,
            targetMemberUuid,
            callback,
            state: ListenerRegistrationState.ACTIVE,
            recoveryAttempts: 0,
            lastAttemptAt: Date.now(),
        };

        this._registrations.set(registrationUuid, reg);
        this._indexBySession(sessionId, registrationUuid);

        this._logger?.fine(
            `[ListenerRecoveryManager] Registered listener ${registrationUuid} ` +
            `for session ${sessionId}, opcode=0x${opcode.toString(16)}`,
        );

        return { registrationUuid, state: ListenerRegistrationState.ACTIVE };
    }

    /**
     * Remove a registration by UUID.
     * Called when the client explicitly deregisters a listener.
     *
     * @returns true if the registration existed and was removed.
     */
    deregister(registrationUuid: string): boolean {
        const reg = this._registrations.get(registrationUuid);
        if (reg === undefined) return false;

        this._registrations.delete(registrationUuid);
        this._sessionIndex.get(reg.sessionId)?.delete(registrationUuid);

        this._logger?.fine(
            `[ListenerRecoveryManager] Deregistered listener ${registrationUuid} ` +
            `for session ${reg.sessionId}`,
        );
        return true;
    }

    /**
     * Remove ALL registrations owned by a session.
     * Called when a client disconnects and will NOT reconnect.
     */
    removeSession(sessionId: string): void {
        const uuids = this._sessionIndex.get(sessionId);
        if (uuids === undefined) return;

        for (const uuid of uuids) {
            this._registrations.delete(uuid);
        }
        this._sessionIndex.delete(sessionId);

        this._logger?.fine(
            `[ListenerRecoveryManager] Removed all listeners for session ${sessionId} (${uuids.size} total)`,
        );
    }

    // ── Reconnect / recovery ──────────────────────────────────────────────────

    /**
     * Called when a client session reconnects.
     *
     * Transitions all ACTIVE/FAILED registrations for this session to RECOVERING
     * and begins re-registration with the supplied handler.  Uses exponential
     * backoff up to maxReregistrationAttempts.
     *
     * @param sessionId           The reconnecting client session.
     * @param reregistrationHandler Factory that performs the actual re-subscription.
     */
    recoverSession(
        sessionId: string,
        reregistrationHandler: ReregistrationHandler,
    ): void {
        const uuids = this._sessionIndex.get(sessionId);
        if (uuids === undefined || uuids.size === 0) return;

        this._logger?.info(
            `[ListenerRecoveryManager] Recovering ${uuids.size} listener(s) for session ${sessionId}`,
        );

        for (const uuid of uuids) {
            const reg = this._registrations.get(uuid);
            if (reg === undefined) continue;

            reg.state = ListenerRegistrationState.RECOVERING;
            reg.recoveryAttempts = 0;

            void this._attemptReregistration(reg, reregistrationHandler);
        }
    }

    // ── Lookup ────────────────────────────────────────────────────────────────

    getRegistration(registrationUuid: string): ListenerRegistration | undefined {
        return this._registrations.get(registrationUuid);
    }

    getSessionRegistrations(sessionId: string): ListenerRegistration[] {
        const uuids = this._sessionIndex.get(sessionId);
        if (uuids === undefined) return [];
        const result: ListenerRegistration[] = [];
        for (const uuid of uuids) {
            const reg = this._registrations.get(uuid);
            if (reg !== undefined) result.push(reg);
        }
        return result;
    }

    /**
     * Dispatch an event to the registered callback for a given registrationUuid.
     * Returns true if the callback was found and invoked.
     */
    dispatchEvent(registrationUuid: string, eventPayload: Buffer): boolean {
        const reg = this._registrations.get(registrationUuid);
        if (reg === undefined || reg.state !== ListenerRegistrationState.ACTIVE) return false;
        try {
            reg.callback(eventPayload);
        } catch (err) {
            this._logger?.warning(
                `[ListenerRecoveryManager] Callback threw for registration ${registrationUuid}`,
                err,
            );
        }
        return true;
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): ListenerRecoveryMetrics {
        let active = 0;
        let recovering = 0;
        let failed = 0;
        for (const reg of this._registrations.values()) {
            switch (reg.state) {
                case ListenerRegistrationState.ACTIVE: active++; break;
                case ListenerRegistrationState.RECOVERING: recovering++; break;
                case ListenerRegistrationState.FAILED: failed++; break;
                default: break;
            }
        }
        return {
            totalRegistrations: this._registrations.size,
            activeRegistrations: active,
            recoveringRegistrations: recovering,
            failedRegistrations: failed,
            successfulRecoveries: this._successfulRecoveries,
            totalRecoveryAttempts: this._totalRecoveryAttempts,
        };
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /**
     * Attempt a single re-registration.  On success, transition to ACTIVE.
     * On transient failure, schedule a retry with exponential backoff.
     * After maxReregistrationAttempts, transition to FAILED and emit an error.
     */
    private async _attemptReregistration(
        reg: ListenerRegistration,
        handler: ReregistrationHandler,
    ): Promise<void> {
        if (!this._running) return;
        if (!this._registrations.has(reg.registrationUuid)) return; // removed during recovery

        reg.recoveryAttempts++;
        reg.lastAttemptAt = Date.now();
        this._totalRecoveryAttempts++;

        let success = false;
        try {
            success = await handler(reg);
        } catch (err) {
            this._logger?.warning(
                `[ListenerRecoveryManager] Re-registration attempt ${reg.recoveryAttempts} ` +
                `failed for ${reg.registrationUuid}`,
                err,
            );
        }

        if (!this._registrations.has(reg.registrationUuid)) return; // removed during await

        if (success) {
            reg.state = ListenerRegistrationState.ACTIVE;
            this._successfulRecoveries++;
            this._logger?.info(
                `[ListenerRecoveryManager] Recovery succeeded for ${reg.registrationUuid} ` +
                `after ${reg.recoveryAttempts} attempt(s)`,
            );
            return;
        }

        if (reg.recoveryAttempts >= this._maxReregistrationAttempts) {
            reg.state = ListenerRegistrationState.FAILED;
            const err = new ListenerRecoveryFailedError(
                reg.registrationUuid,
                reg.sessionId,
                reg.recoveryAttempts,
            );
            this._logger?.severe(
                `[ListenerRecoveryManager] Listener recovery permanently failed for ` +
                `${reg.registrationUuid} (session ${reg.sessionId}) after ` +
                `${reg.recoveryAttempts} attempt(s)`,
            );
            this._emitError(err);
            return;
        }

        const delay = this._computeBackoff(reg.recoveryAttempts);
        this._logger?.fine(
            `[ListenerRecoveryManager] Scheduling retry #${reg.recoveryAttempts + 1} ` +
            `for ${reg.registrationUuid} in ${delay}ms`,
        );
        setTimeout(() => void this._attemptReregistration(reg, handler), delay);
    }

    private _computeBackoff(attempt: number): number {
        const base = Math.min(
            this._initialBackoffMs * Math.pow(this._backoffMultiplier, attempt - 1),
            this._maxBackoffMs,
        );
        return Math.round(base);
    }

    /**
     * Find an existing registration matching the given key fields.
     * Uses a fingerprint of sessionId + opcode + filterData + targetMemberUuid.
     */
    private _findExisting(
        sessionId: string,
        opcode: number,
        filterData: ListenerFilterData,
        targetMemberUuid: string | null,
    ): ListenerRegistration | undefined {
        const uuids = this._sessionIndex.get(sessionId);
        if (uuids === undefined) return undefined;

        const filterKey = filterData !== null ? filterData.toString('base64') : '__null__';

        for (const uuid of uuids) {
            const reg = this._registrations.get(uuid);
            if (reg === undefined) continue;
            if (reg.opcode !== opcode) continue;
            if (reg.targetMemberUuid !== targetMemberUuid) continue;
            const existingFilterKey = reg.filterData !== null
                ? reg.filterData.toString('base64')
                : '__null__';
            if (existingFilterKey !== filterKey) continue;
            return reg;
        }
        return undefined;
    }

    private _indexBySession(sessionId: string, registrationUuid: string): void {
        let set = this._sessionIndex.get(sessionId);
        if (set === undefined) {
            set = new Set();
            this._sessionIndex.set(sessionId, set);
        }
        set.add(registrationUuid);
    }

    private _emitError(err: ListenerRecoveryFailedError): void {
        for (const listener of this._errorListeners) {
            try {
                listener(err);
            } catch {
                // Error listeners must not throw
            }
        }
    }
}
