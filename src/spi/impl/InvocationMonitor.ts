/**
 * Block B.1 — Invocation Monitor
 *
 * Port of {@code com.hazelcast.spi.impl.operationservice.impl.InvocationMonitor}.
 *
 * Supervises all active invocations:
 *
 *  - Periodic deadline scan (every SCAN_INTERVAL_MS): times out invocations
 *    that have exceeded their call timeout.
 *  - Member-departure notification: immediately fails invocations whose target
 *    member has left the cluster with {@link MemberLeftException}.
 *  - Safe handling of late and duplicate responses (drop + log).
 *  - Safe handling of late backup acks (drop + log).
 *  - Metrics: active, timed out, member-left failures.
 *
 * Lifecycle: start() → (active) → stop().
 *
 * Thread-safety: Bun is single-threaded; no locking needed.
 */

import type { Address } from '@zenystx/helios-core/cluster/Address.js';
import { DEFAULT_INVOCATION_TIMEOUT_MS } from '@zenystx/helios-core/compatibility/CompatibilityTarget.js';
import { MemberLeftException } from '@zenystx/helios-core/core/errors/ClusterErrors.js';
import type { ILogger } from '@zenystx/helios-core/logging/Logger.js';
import type { InvocationFuture } from '@zenystx/helios-core/spi/impl/operationservice/InvocationFuture.js';

/** Scan interval: check deadlines once per second. */
const SCAN_INTERVAL_MS = 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Per-invocation metadata tracked by the monitor.
 * Creation time, target, required backups, and member-left state.
 */
export interface MonitoredInvocation {
    /** Correlation ID (matches callId on the Operation). */
    readonly callId: bigint;
    /** Epoch-millis when the invocation was created. */
    readonly createdAt: number;
    /** Absolute deadline in epoch-millis. */
    readonly deadlineAt: number;
    /** UUID of the member this invocation targets. null = local. */
    readonly targetMemberUuid: string | null;
    /** Number of sync backup acks still expected. */
    readonly requiredBackupAcks: number;
    /** True once the member-left flag has been set (to avoid double-fail). */
    memberLeftSignaled: boolean;
    /** The InvocationFuture to complete when timing out / member leaves. */
    readonly future: InvocationFuture<unknown>;
}

export interface InvocationMonitorMetrics {
    /** Active (registered) invocations currently in flight. */
    activeInvocations: number;
    /** Total invocations timed out since start. */
    timedOut: number;
    /** Total invocations failed due to member departure since start. */
    memberLeftFailures: number;
    /** Total invocations that completed normally (deregistered). */
    completed: number;
}

export interface InvocationMonitorOptions {
    /** Invocation timeout in ms. Default: {@link DEFAULT_INVOCATION_TIMEOUT_MS}. */
    invocationTimeoutMs?: number;
    /** Periodic scan interval in ms. Default: 1000. */
    scanIntervalMs?: number;
    /** Logger to use for late/duplicate response warnings. */
    logger?: ILogger;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class InvocationMonitor {
    private readonly _invocations = new Map<bigint, MonitoredInvocation>();
    private readonly _invocationTimeoutMs: number;
    private readonly _scanIntervalMs: number;
    private readonly _logger: ILogger | null;

    private _scanTimer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    // Metrics
    private _timedOut = 0;
    private _memberLeftFailures = 0;
    private _completed = 0;

    constructor(options?: InvocationMonitorOptions) {
        this._invocationTimeoutMs = options?.invocationTimeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS;
        this._scanIntervalMs = options?.scanIntervalMs ?? SCAN_INTERVAL_MS;
        this._logger = options?.logger ?? null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start(): void {
        if (this._running) return;
        this._running = true;
        this._scanTimer = setInterval(() => this._scan(), this._scanIntervalMs);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._scanTimer !== null) {
            clearInterval(this._scanTimer);
            this._scanTimer = null;
        }
    }

    destroy(): void {
        this.stop();
        // Fail all remaining invocations
        const cause = new Error('InvocationMonitor destroyed');
        for (const inv of this._invocations.values()) {
            inv.future.completeExceptionally(cause);
        }
        this._invocations.clear();
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Register an invocation for monitoring.
     *
     * @param callId          Correlation ID matching Operation.getCallId().
     * @param future          The InvocationFuture to complete on timeout / member-left.
     * @param targetMemberUuid UUID of target member, or null for local.
     * @param requiredBackupAcks Number of sync backup acks expected.
     * @param callTimeoutMs   Override timeout, or 0 to use the default.
     */
    register(
        callId: bigint,
        future: InvocationFuture<unknown>,
        targetMemberUuid: string | null = null,
        requiredBackupAcks: number = 0,
        callTimeoutMs: number = 0,
    ): void {
        const now = Date.now();
        const timeout = callTimeoutMs > 0 ? callTimeoutMs : this._invocationTimeoutMs;
        this._invocations.set(callId, {
            callId,
            createdAt: now,
            deadlineAt: now + timeout,
            targetMemberUuid,
            requiredBackupAcks,
            memberLeftSignaled: false,
            future,
        });
    }

    /**
     * Deregister an invocation that completed normally.
     * Idempotent — safe to call multiple times.
     */
    deregister(callId: bigint): void {
        if (this._invocations.delete(callId)) {
            this._completed++;
        }
    }

    // ── Member departure ──────────────────────────────────────────────────────

    /**
     * Called when a member leaves the cluster.
     * Immediately fails all invocations targeting that member.
     *
     * @param memberUuid UUID of the departed member.
     */
    onMemberRemoved(memberUuid: string): void {
        for (const inv of this._invocations.values()) {
            if (inv.targetMemberUuid === memberUuid && !inv.memberLeftSignaled) {
                inv.memberLeftSignaled = true;
                this._failWithMemberLeft(inv, memberUuid);
            }
        }
    }

    // ── Late / duplicate response handling ───────────────────────────────────

    /**
     * Called when a response arrives for a callId that is no longer registered.
     * This can happen for two reasons:
     *   1. The invocation already timed out (late response).
     *   2. The server sent a duplicate response.
     *
     * Either way, the response is dropped with a warning log.
     *
     * @param callId The correlation ID of the response.
     * @param source The address that sent the response (for logging).
     * @returns false (so callers know the response was discarded).
     */
    handleLateOrDuplicateResponse(callId: bigint, source: Address | null): boolean {
        if (this._logger !== null) {
            const src = source ? source.toString() : 'unknown';
            this._logger.warning(
                `[InvocationMonitor] Late or duplicate response for callId=${callId} from ${src}. ` +
                `Invocation may have timed out or already completed. Dropping.`,
            );
        }
        return false;
    }

    /**
     * Called when a backup ack arrives for a callId that is no longer registered.
     * The ack is dropped with a fine-level log.
     *
     * @param callId The correlation ID of the backup ack.
     * @param source The backup owner address (for logging).
     */
    handleLateBackupAck(callId: bigint, source: Address | null): void {
        if (this._logger !== null) {
            const src = source ? source.toString() : 'unknown';
            this._logger.fine(
                `[InvocationMonitor] Late backup ack for callId=${callId} from ${src}. ` +
                `Invocation already completed. Dropping.`,
            );
        }
    }

    // ── Metrics ───────────────────────────────────────────────────────────────

    getMetrics(): InvocationMonitorMetrics {
        return {
            activeInvocations: this._invocations.size,
            timedOut: this._timedOut,
            memberLeftFailures: this._memberLeftFailures,
            completed: this._completed,
        };
    }

    getInvocation(callId: bigint): MonitoredInvocation | undefined {
        return this._invocations.get(callId);
    }

    get size(): number {
        return this._invocations.size;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Periodic deadline scan: fail invocations past their deadline. */
    private _scan(): void {
        const now = Date.now();
        for (const inv of this._invocations.values()) {
            if (now >= inv.deadlineAt) {
                this._failWithTimeout(inv, now);
            }
        }
    }

    private _failWithTimeout(inv: MonitoredInvocation, now: number): void {
        const elapsed = now - inv.createdAt;
        const msg =
            `Invocation callId=${inv.callId} timed out after ${elapsed}ms ` +
            `(timeout=${this._invocationTimeoutMs}ms, target=${inv.targetMemberUuid ?? 'local'})`;

        if (this._logger !== null) {
            this._logger.warning(`[InvocationMonitor] ${msg}`);
        }

        this._invocations.delete(inv.callId);
        this._timedOut++;
        inv.future.completeExceptionally(new Error(msg));
    }

    private _failWithMemberLeft(inv: MonitoredInvocation, memberUuid: string): void {
        if (this._logger !== null) {
            this._logger.warning(
                `[InvocationMonitor] Failing callId=${inv.callId}: ` +
                `target member ${memberUuid} has left the cluster.`,
            );
        }
        this._invocations.delete(inv.callId);
        this._memberLeftFailures++;
        inv.future.completeExceptionally(new MemberLeftException(memberUuid));
    }
}
