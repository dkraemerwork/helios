/**
 * Retry policy for pipeline fault handling.
 *
 * Supports two backoff strategies:
 *   - fixed:       delay is constant across all retry attempts
 *   - exponential: delay doubles each attempt (initialDelayMs * 2^n) with ±25% jitter
 */
export type BackoffStrategy = 'fixed' | 'exponential';

export interface ExponentialOptions {
    /** Cap on the computed delay (before jitter). Default: no cap. */
    maxBackoffMs?: number;
}

export class RetryPolicy {
    private constructor(
        private readonly _maxRetries: number,
        private readonly _delayMs: number,
        private readonly _strategy: BackoffStrategy,
        private readonly _maxBackoffMs: number,
    ) {}

    /**
     * Fixed-delay retry: every retry uses the same delay.
     */
    static fixed(maxRetries: number, delayMs: number): RetryPolicy {
        return new RetryPolicy(maxRetries, delayMs, 'fixed', Infinity);
    }

    /**
     * Exponential backoff: delay = initialDelayMs * 2^attempt (±25% jitter).
     */
    static exponential(maxRetries: number, initialDelayMs: number, opts?: ExponentialOptions): RetryPolicy {
        return new RetryPolicy(maxRetries, initialDelayMs, 'exponential', opts?.maxBackoffMs ?? Infinity);
    }

    get maxRetries(): number {
        return this._maxRetries;
    }

    /**
     * Whether the given attempt (0-based) should be retried.
     * attempt < maxRetries → retry; attempt >= maxRetries → route to DL.
     */
    shouldRetry(attempt: number): boolean {
        return attempt < this._maxRetries;
    }

    /**
     * Compute the delay (ms) for the given attempt number (0-based).
     *
     * For exponential: base = min(initialDelayMs * 2^attempt, maxBackoffMs).
     * Jitter is applied as ±25% of the base value (uniform random).
     */
    computeDelay(attempt: number): number {
        if (this._strategy === 'fixed') {
            return this._delayMs;
        }
        // Exponential with jitter, then cap
        const base = this._delayMs * Math.pow(2, attempt);
        // ±25% jitter: multiply by a factor in [0.75, 1.25]
        const jitter = 0.75 + Math.random() * 0.5;
        return Math.min(Math.round(base * jitter), this._maxBackoffMs);
    }
}
