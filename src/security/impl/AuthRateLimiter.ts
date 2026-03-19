/**
 * IP-based authentication failure rate limiter.
 *
 * Tracks authentication failures per remote IP address and temporarily blocks
 * addresses that exceed a configurable failure threshold within a time window.
 *
 * Algorithm:
 *   1. On each auth failure record the timestamp.
 *   2. When the failure count in the window exceeds maxFailures, the IP is blocked
 *      for blockDurationMs.
 *   3. Blocked IPs are refused before attempting any credential validation.
 *   4. Old failure records are lazily pruned on each check.
 */

export interface AuthRateLimiterOptions {
    /** Maximum number of auth failures within windowMs before blocking. Default: 5. */
    maxFailures?: number;
    /** Rolling time window in milliseconds for failure counting. Default: 60_000 (60 s). */
    windowMs?: number;
    /** Duration in milliseconds to block an IP after exceeding maxFailures. Default: 300_000 (5 min). */
    blockDurationMs?: number;
}

interface FailureRecord {
    /** Epoch ms timestamps of recent auth failures. */
    timestamps: number[];
    /** Epoch ms when the block expires; 0 if not currently blocked. */
    blockedUntil: number;
}

export class AuthRateLimiter {
    private readonly _maxFailures: number;
    private readonly _windowMs: number;
    private readonly _blockDurationMs: number;

    /** Per-IP failure tracking. */
    private readonly _records = new Map<string, FailureRecord>();

    constructor(options: AuthRateLimiterOptions = {}) {
        this._maxFailures    = options.maxFailures    ?? 5;
        this._windowMs       = options.windowMs       ?? 60_000;
        this._blockDurationMs = options.blockDurationMs ?? 300_000;
    }

    /**
     * Returns true if the given IP is currently rate-limited (blocked).
     */
    isBlocked(ip: string): boolean {
        const record = this._records.get(ip);
        if (record === undefined) return false;
        const now = Date.now();
        if (record.blockedUntil > 0 && now < record.blockedUntil) {
            return true;
        }
        return false;
    }

    /**
     * Record an authentication failure from the given IP.
     *
     * If the number of failures within the window exceeds maxFailures, the IP is
     * blocked for blockDurationMs.
     */
    recordFailure(ip: string): void {
        const now = Date.now();
        let record = this._records.get(ip);
        if (record === undefined) {
            record = { timestamps: [], blockedUntil: 0 };
            this._records.set(ip, record);
        }

        // Prune timestamps outside the rolling window
        const cutoff = now - this._windowMs;
        record.timestamps = record.timestamps.filter((t) => t >= cutoff);

        // Record this failure
        record.timestamps.push(now);

        // Block if threshold exceeded
        if (record.timestamps.length >= this._maxFailures) {
            record.blockedUntil = now + this._blockDurationMs;
        }
    }

    /**
     * Record a successful authentication from the given IP.
     * Resets the failure counter for that IP.
     */
    recordSuccess(ip: string): void {
        this._records.delete(ip);
    }

    /**
     * Manually unblock an IP address.
     */
    unblock(ip: string): void {
        const record = this._records.get(ip);
        if (record !== undefined) {
            record.blockedUntil = 0;
            record.timestamps = [];
        }
    }

    /**
     * Returns how many seconds remain until the block on the given IP expires.
     * Returns 0 if the IP is not blocked.
     */
    blockRemainingMs(ip: string): number {
        const record = this._records.get(ip);
        if (record === undefined || record.blockedUntil === 0) return 0;
        const remaining = record.blockedUntil - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    /**
     * Returns the number of recorded failures for an IP within the current window.
     */
    failureCount(ip: string): number {
        const record = this._records.get(ip);
        if (record === undefined) return 0;
        const cutoff = Date.now() - this._windowMs;
        return record.timestamps.filter((t) => t >= cutoff).length;
    }

    /**
     * Prune all expired records to free memory.
     * Safe to call periodically (e.g. every minute).
     */
    prune(): void {
        const now = Date.now();
        const cutoff = now - this._windowMs;
        for (const [ip, record] of this._records.entries()) {
            const active = record.timestamps.some((t) => t >= cutoff);
            const blocked = record.blockedUntil > now;
            if (!active && !blocked) {
                this._records.delete(ip);
            }
        }
    }

    /**
     * Returns the total number of IPs currently tracked (for diagnostics).
     */
    trackedIpCount(): number {
        return this._records.size;
    }
}
