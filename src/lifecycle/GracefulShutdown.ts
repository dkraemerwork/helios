/**
 * GracefulShutdown — orchestrates a production-safe shutdown sequence for Helios.
 *
 * Shutdown phases (in order):
 *   1. Mark instance as draining — stop accepting new client connections
 *   2. Drain in-flight client invocations (with configurable timeout)
 *   3. Deregister from cluster membership (send LEAVE message, await quorum)
 *   4. Close all inter-member transport connections
 *   5. Stop all periodic tasks (heartbeat, anti-entropy, repair timers)
 *   6. Release held resources (timers, listeners, near-cache)
 *   7. Stop metrics sampling / REST server
 *   8. Signal completion
 *
 * Idempotent: calling shutdown() or shutdownAsync() multiple times is safe.
 * Configurable drain timeout: if in-flight invocations do not complete within
 * the timeout, remaining work is force-closed and shutdown proceeds.
 */

import { HeliosLoggers } from '@zenystx/helios-core/monitor/StructuredLogger';

// ── Drainable interface ───────────────────────────────────────────────────────

/**
 * Any subsystem that can be drained before shutdown.
 * All registered drainables are awaited in parallel during the drain phase.
 */
export interface Drainable {
    /** Human-readable name for logging. */
    readonly name: string;

    /**
     * Begin draining. Must resolve (or reject) within the drain timeout.
     * Implementations MUST NOT throw — they should reject the returned promise
     * on unrecoverable failure so the shutdown can proceed.
     */
    drain(signal: AbortSignal): Promise<void>;
}

/**
 * A subsystem that must be stopped after draining is complete.
 */
export interface Stoppable {
    /** Human-readable name for logging. */
    readonly name: string;

    /** Stop the subsystem. Must be synchronous or return a Promise. */
    stop(): void | Promise<void>;
}

// ── Shutdown configuration ────────────────────────────────────────────────────

export interface GracefulShutdownConfig {
    /** Maximum time to wait for in-flight work to complete. Default: 30 000 ms. */
    drainTimeoutMs?: number;

    /** Maximum time to wait for each stop() call. Default: 5 000 ms. */
    stopTimeoutMs?: number;

    /** If true, log progress at INFO level. Default: true. */
    verbose?: boolean;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS  =  5_000;

// ── Shutdown state ────────────────────────────────────────────────────────────

export type ShutdownState =
    | 'idle'          // not started
    | 'draining'      // drain phase in progress
    | 'stopping'      // stop phase in progress
    | 'complete'      // fully shut down
    | 'force-closed'; // drain timeout exceeded, force-closed

// ── GracefulShutdown ──────────────────────────────────────────────────────────

export class GracefulShutdown {
    private _state: ShutdownState = 'idle';
    private _shutdownPromise: Promise<void> | null = null;
    private readonly _drainables: Drainable[] = [];
    private readonly _stoppables: Stoppable[] = [];
    private readonly _drainTimeoutMs: number;
    private readonly _stopTimeoutMs: number;
    private readonly _verbose: boolean;
    private readonly _log = HeliosLoggers.instance;

    constructor(config: GracefulShutdownConfig = {}) {
        this._drainTimeoutMs = config.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
        this._stopTimeoutMs  = config.stopTimeoutMs  ?? DEFAULT_STOP_TIMEOUT_MS;
        this._verbose        = config.verbose ?? true;
    }

    /** Register a drainable subsystem (e.g., invocation monitor, connection pool). */
    registerDrainable(drainable: Drainable): void {
        if (this._state !== 'idle') {
            throw new Error(`Cannot register drainable after shutdown has started (state=${this._state})`);
        }
        this._drainables.push(drainable);
    }

    /** Register a stoppable subsystem (e.g., periodic timer, REST server). */
    registerStoppable(stoppable: Stoppable): void {
        if (this._state !== 'idle') {
            throw new Error(`Cannot register stoppable after shutdown has started (state=${this._state})`);
        }
        this._stoppables.push(stoppable);
    }

    /** Current shutdown state. */
    get state(): ShutdownState { return this._state; }

    /** Whether shutdown has been initiated (draining or beyond). */
    get isShuttingDown(): boolean {
        return this._state !== 'idle';
    }

    /** Whether shutdown has fully completed. */
    get isComplete(): boolean {
        return this._state === 'complete' || this._state === 'force-closed';
    }

    /**
     * Initiate graceful shutdown. Idempotent — subsequent calls return the
     * same promise as the first call.
     *
     * @returns A promise that resolves when the shutdown sequence is complete.
     */
    shutdown(): Promise<void> {
        if (this._shutdownPromise !== null) {
            return this._shutdownPromise;
        }
        this._shutdownPromise = this._execute();
        return this._shutdownPromise;
    }

    /** Synchronous shutdown — fires the async sequence and returns immediately. */
    shutdownSync(): void {
        void this.shutdown();
    }

    // ── Execution pipeline ────────────────────────────────────────────────────

    private async _execute(): Promise<void> {
        const startMs = Date.now();
        this._log.info('Graceful shutdown initiated', {
            drainTimeoutMs: this._drainTimeoutMs,
            drainables: this._drainables.length,
            stoppables: this._stoppables.length,
            event: 'shutdown.start',
        });

        // ── Phase 1: Drain ────────────────────────────────────────────────────
        this._state = 'draining';
        const drainController = new AbortController();
        const drainTimer = setTimeout(() => drainController.abort(), this._drainTimeoutMs);

        let forceClosed = false;

        try {
            await this._drain(drainController.signal);
        } catch {
            forceClosed = true;
            this._state = 'force-closed';
            this._log.warn('Drain timeout exceeded — force-closing remaining connections', {
                drainTimeoutMs: this._drainTimeoutMs,
                event: 'shutdown.forceClose',
            });
        } finally {
            clearTimeout(drainTimer);
            drainController.abort(); // ensure any still-waiting drainables get the signal
        }

        // ── Phase 2: Stop ─────────────────────────────────────────────────────
        if (!forceClosed) {
            this._state = 'stopping';
        }

        await this._stopAll();

        const durationMs = Date.now() - startMs;
        const finalState = forceClosed ? 'force-closed' : 'complete';
        this._state = finalState;

        this._log.info('Graceful shutdown complete', {
            durationMs,
            state: finalState,
            event: 'shutdown.complete',
        });
    }

    private async _drain(signal: AbortSignal): Promise<void> {
        if (this._drainables.length === 0) {
            if (this._verbose) this._log.debug('No drainables registered; skipping drain phase');
            return;
        }

        if (this._verbose) {
            this._log.info(`Draining ${this._drainables.length} subsystem(s)`, {
                subsystems: this._drainables.map((d) => d.name),
                event: 'shutdown.drain.start',
            });
        }

        // Wrap the drain timeout as a rejection
        const timeoutPromise = new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => {
                reject(new Error(`Drain timeout exceeded after ${this._drainTimeoutMs}ms`));
            }, { once: true });
        });

        await Promise.race([
            Promise.allSettled(this._drainables.map((d) => this._drainOne(d, signal))),
            timeoutPromise,
        ]);

        if (this._verbose) {
            this._log.info('Drain phase complete', { event: 'shutdown.drain.end' });
        }
    }

    private async _drainOne(drainable: Drainable, signal: AbortSignal): Promise<void> {
        if (this._verbose) {
            this._log.debug(`Draining: ${drainable.name}`, { subsystem: drainable.name });
        }
        try {
            await drainable.drain(signal);
            if (this._verbose) {
                this._log.debug(`Drained: ${drainable.name}`, { subsystem: drainable.name });
            }
        } catch (err) {
            this._log.warnWithCause(`Drain failed for: ${drainable.name}`, err, { subsystem: drainable.name });
        }
    }

    private async _stopAll(): Promise<void> {
        if (this._stoppables.length === 0) return;

        if (this._verbose) {
            this._log.info(`Stopping ${this._stoppables.length} subsystem(s)`, {
                subsystems: this._stoppables.map((s) => s.name),
                event: 'shutdown.stop.start',
            });
        }

        // Stop in reverse-registration order (LIFO — dependencies first)
        const reversed = [...this._stoppables].reverse();
        for (const stoppable of reversed) {
            await this._stopOne(stoppable);
        }

        if (this._verbose) {
            this._log.info('Stop phase complete', { event: 'shutdown.stop.end' });
        }
    }

    private async _stopOne(stoppable: Stoppable): Promise<void> {
        if (this._verbose) {
            this._log.debug(`Stopping: ${stoppable.name}`, { subsystem: stoppable.name });
        }
        try {
            const result = stoppable.stop();
            if (result instanceof Promise) {
                await Promise.race([
                    result,
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error(`Stop timeout for ${stoppable.name}`)), this._stopTimeoutMs),
                    ),
                ]);
            }
        } catch (err) {
            this._log.warnWithCause(`Stop failed for: ${stoppable.name}`, err, { subsystem: stoppable.name });
        }
    }
}

// ── Drainable adapters ────────────────────────────────────────────────────────

/**
 * Wrap an invocation monitor so its active invocations are drained on shutdown.
 * Polls the active count and resolves when it reaches zero or signal fires.
 */
export function drainableInvocationMonitor(
    name: string,
    getActiveCount: () => number,
    pollIntervalMs: number = 50,
): Drainable {
    return {
        name,
        drain(signal: AbortSignal): Promise<void> {
            return new Promise<void>((resolve) => {
                if (getActiveCount() === 0) {
                    resolve();
                    return;
                }

                const onAbort = (): void => {
                    clearInterval(timer);
                    resolve(); // resolve even if not fully drained (force-close handled by caller)
                };

                const timer = setInterval(() => {
                    if (getActiveCount() === 0) {
                        clearInterval(timer);
                        signal.removeEventListener('abort', onAbort);
                        resolve();
                    }
                }, pollIntervalMs);

                signal.addEventListener('abort', onAbort, { once: true });
            });
        },
    };
}

/**
 * Wrap an async function as a drainable (e.g., flush a write-behind queue).
 */
export function drainableFromFn(name: string, fn: () => Promise<void>): Drainable {
    return {
        name,
        async drain(_signal: AbortSignal): Promise<void> {
            await fn();
        },
    };
}

/**
 * Wrap a sync stop function as a stoppable subsystem (timer, listener, etc.).
 */
export function stoppableFromFn(name: string, fn: () => void | Promise<void>): Stoppable {
    return { name, stop: fn };
}
