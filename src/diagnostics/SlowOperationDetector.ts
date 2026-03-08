/**
 * SlowOperationDetector — port of {@code com.hazelcast.spi.impl.operationservice.impl.SlowOperationPlugin}.
 *
 * Tracks start time of each executing operation and periodically scans for those
 * that have exceeded a configurable threshold. Logs a WARN via HeliosLoggers when
 * slow operations are found.
 *
 * Lifecycle: call start() once after creation, stop() during shutdown.
 */
import { HeliosLoggers, LoggerFactory } from '../monitor/StructuredLogger.js';

/** Minimum configurable threshold to prevent log spam. */
const MIN_THRESHOLD_MS = 100;

/** Default scan period. */
const DEFAULT_SCAN_INTERVAL_MS = 5_000;

/** Default slow operation threshold. */
const DEFAULT_THRESHOLD_MS = 1_000;

const logger = LoggerFactory.getLogger('hz.slowOperation');

/** Tracking entry for a single in-flight operation. */
interface OperationEntry {
    readonly startTime: number;
    readonly operationName: string;
}

export class SlowOperationDetector {
    private readonly _thresholdMs: number;
    private readonly _scanIntervalMs: number;
    private readonly _inFlight = new Map<string, OperationEntry>();
    private _timer: ReturnType<typeof setInterval> | null = null;

    constructor(options?: {
        thresholdMs?: number;
        scanIntervalMs?: number;
    }) {
        this._thresholdMs = Math.max(
            MIN_THRESHOLD_MS,
            options?.thresholdMs ?? DEFAULT_THRESHOLD_MS,
        );
        this._scanIntervalMs = options?.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    }

    /** Start periodic scanning. No-op if already running. */
    start(): void {
        if (this._timer !== null) return;
        this._timer = setInterval(() => this._scan(), this._scanIntervalMs);
    }

    /** Stop the scanner and clear all tracking state. */
    stop(): void {
        if (this._timer === null) return;
        clearInterval(this._timer);
        this._timer = null;
        this._inFlight.clear();
    }

    /** Register an operation as started. Call before run(). */
    startTracking(operationId: string, operationName: string): void {
        this._inFlight.set(operationId, {
            startTime: Date.now(),
            operationName,
        });
    }

    /** Deregister an operation as completed. Call in finally after run(). */
    stopTracking(operationId: string): void {
        this._inFlight.delete(operationId);
    }

    /** Returns a snapshot of currently tracked operations (for testing / inspection). */
    getInFlightCount(): number {
        return this._inFlight.size;
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private _scan(): void {
        const now = Date.now();
        for (const [id, entry] of this._inFlight) {
            const durationMs = now - entry.startTime;
            if (durationMs >= this._thresholdMs) {
                HeliosLoggers.instance.warn('Slow operation detected', {
                    event: 'slowOperation.detected',
                    operationId: id,
                    operationName: entry.operationName,
                    durationMs,
                    startTime: new Date(entry.startTime).toISOString(),
                    thresholdMs: this._thresholdMs,
                });
            }
        }
    }
}
