/**
 * Exponential backoff wait strategy for client reconnection.
 *
 * Port of {@code com.hazelcast.client.impl.connection.tcp.WaitStrategy}.
 */
export class WaitStrategy {
    private readonly _initialBackoffMs: number;
    private readonly _maxBackoffMs: number;
    private readonly _multiplier: number;
    private readonly _jitter: number;
    private readonly _clusterConnectTimeoutMs: number;
    private _attempt = 0;
    private _currentBackoffMs: number;
    private _clusterConnectStartMs = -1;

    constructor(
        initialBackoffMs: number,
        maxBackoffMs: number,
        multiplier: number,
        jitter: number,
        clusterConnectTimeoutMs: number,
    ) {
        this._initialBackoffMs = initialBackoffMs;
        this._maxBackoffMs = maxBackoffMs;
        this._multiplier = multiplier;
        this._jitter = jitter;
        this._clusterConnectTimeoutMs = clusterConnectTimeoutMs;
        this._currentBackoffMs = initialBackoffMs;
    }

    getCurrentSleepMillis(): number {
        return this._currentBackoffMs;
    }

    /**
     * Advance to next attempt and return the sleep duration.
     * Returns -1 if cluster connect timeout exceeded.
     */
    sleep(): number {
        if (this._clusterConnectStartMs === -1) {
            this._clusterConnectStartMs = Date.now();
        }

        if (this._clusterConnectTimeoutMs > 0) {
            const elapsed = Date.now() - this._clusterConnectStartMs;
            if (elapsed >= this._clusterConnectTimeoutMs) {
                return -1;
            }
        }

        const sleepMs = this._computeSleep();
        this._attempt++;
        this._currentBackoffMs = Math.min(
            this._currentBackoffMs * this._multiplier,
            this._maxBackoffMs,
        );
        return sleepMs;
    }

    reset(): void {
        this._attempt = 0;
        this._currentBackoffMs = this._initialBackoffMs;
        this._clusterConnectStartMs = -1;
    }

    private _computeSleep(): number {
        const base = this._currentBackoffMs;
        if (this._jitter <= 0) return base;
        const jitterRange = base * this._jitter;
        return base + jitterRange * (Math.random() * 2 - 1);
    }
}
