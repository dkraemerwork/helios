/**
 * Configuration for the Helios remote invocation backpressure subsystem.
 *
 * Port of Hazelcast's backpressure regulator configuration
 * ({@code BackpressureRegulator} / {@code CallIdSequenceWithBackpressure}).
 *
 * When enabled, caps the number of in-flight remote invocations and applies
 * deterministic wait-then-reject admission behavior when the limit is reached.
 *
 * Usage:
 * ```typescript
 * const config = new HeliosConfig('my-instance');
 * config.getBackpressureConfig()
 *     .setEnabled(true)
 *     .setMaxConcurrentInvocations(100 * 271)  // ~100 per partition
 *     .setBackoffTimeoutMs(60_000);
 * ```
 */
export class BackpressureConfig {
    /**
     * Default max concurrent invocations per partition (matches Hazelcast default).
     * The actual cap is computed as (partitionCount + 1) * perPartition.
     */
    static readonly DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_PARTITION = 100;

    /** Default backoff timeout before rejecting an admission attempt. */
    static readonly DEFAULT_BACKOFF_TIMEOUT_MS = 60_000;

    /** Default sync window for periodic forced-sync of async backups. */
    static readonly DEFAULT_SYNC_WINDOW = 100;

    private _enabled = true;
    private _maxConcurrentInvocationsPerPartition =
        BackpressureConfig.DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_PARTITION;
    private _backoffTimeoutMs = BackpressureConfig.DEFAULT_BACKOFF_TIMEOUT_MS;
    private _syncWindow = BackpressureConfig.DEFAULT_SYNC_WINDOW;

    /** Whether backpressure is enabled. Default: true. */
    isEnabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): this {
        this._enabled = enabled;
        return this;
    }

    /**
     * Maximum concurrent in-flight invocations per partition.
     * The total cap is (partitionCount + 1) * this value.
     * Default: 100.
     */
    getMaxConcurrentInvocationsPerPartition(): number {
        return this._maxConcurrentInvocationsPerPartition;
    }

    setMaxConcurrentInvocationsPerPartition(value: number): this {
        if (value < 1) {
            throw new Error(
                `maxConcurrentInvocationsPerPartition must be >= 1, was: ${value}`,
            );
        }
        this._maxConcurrentInvocationsPerPartition = value;
        return this;
    }

    /**
     * Backoff timeout in milliseconds. When in-flight invocations are at capacity,
     * new invocations wait up to this duration for a slot before being rejected
     * with an OverloadError. Default: 60000 (1 minute).
     */
    getBackoffTimeoutMs(): number {
        return this._backoffTimeoutMs;
    }

    setBackoffTimeoutMs(ms: number): this {
        if (ms < 0) {
            throw new Error(`backoffTimeoutMs must be >= 0, was: ${ms}`);
        }
        this._backoffTimeoutMs = ms;
        return this;
    }

    /**
     * Sync window for forced synchronous backup coercion.
     * Every N async-backup operations, one is converted to sync
     * to drain the backup pipeline. Default: 100.
     */
    getSyncWindow(): number {
        return this._syncWindow;
    }

    setSyncWindow(value: number): this {
        if (value < 1) {
            throw new Error(`syncWindow must be >= 1, was: ${value}`);
        }
        this._syncWindow = value;
        return this;
    }

    /**
     * Compute the effective max concurrent invocations for a given partition count.
     */
    computeMaxConcurrentInvocations(partitionCount: number): number {
        if (!this._enabled) {
            return Number.MAX_SAFE_INTEGER;
        }
        return (partitionCount + 1) * this._maxConcurrentInvocationsPerPartition;
    }
}
