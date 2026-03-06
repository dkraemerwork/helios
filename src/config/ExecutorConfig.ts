/**
 * Configuration for a named distributed executor service.
 *
 * All defaults are bounded — no unbounded queues or pools.
 * Mirrors Hazelcast ExecutorConfig with Helios-specific extensions.
 */

const DEFAULT_POOL_SIZE = Math.min(16, navigator?.hardwareConcurrency ?? 4);
const DEFAULT_QUEUE_CAPACITY = 1024;
const DEFAULT_MAX_ACTIVE_TASK_TYPE_POOLS = 32;
const DEFAULT_POOL_IDLE_MILLIS = 300_000;
const DEFAULT_TASK_TIMEOUT_MILLIS = 300_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 10_000;

export class ExecutorConfig {
    private readonly _name: string;
    private _poolSize: number = DEFAULT_POOL_SIZE;
    private _queueCapacity: number = DEFAULT_QUEUE_CAPACITY;
    private _maxActiveTaskTypePools: number = DEFAULT_MAX_ACTIVE_TASK_TYPE_POOLS;
    private _poolIdleMillis: number = DEFAULT_POOL_IDLE_MILLIS;
    private _taskTimeoutMillis: number = DEFAULT_TASK_TIMEOUT_MILLIS;
    private _shutdownTimeoutMillis: number = DEFAULT_SHUTDOWN_TIMEOUT_MILLIS;
    private _statisticsEnabled: boolean = true;
    private _splitBrainProtectionName: string | null = null;
    private _executionBackend: 'inline' | 'scatter' = 'scatter';

    constructor(name: string) {
        this._name = name;
    }

    getName(): string {
        return this._name;
    }

    getPoolSize(): number {
        return this._poolSize;
    }

    setPoolSize(poolSize: number): this {
        if (poolSize <= 0) {
            throw new Error(`poolSize must be > 0, got ${poolSize}`);
        }
        this._poolSize = poolSize;
        return this;
    }

    getQueueCapacity(): number {
        return this._queueCapacity;
    }

    setQueueCapacity(queueCapacity: number): this {
        if (queueCapacity <= 0) {
            throw new Error(`queueCapacity must be > 0, got ${queueCapacity}`);
        }
        this._queueCapacity = queueCapacity;
        return this;
    }

    getMaxActiveTaskTypePools(): number {
        return this._maxActiveTaskTypePools;
    }

    setMaxActiveTaskTypePools(max: number): this {
        if (max <= 0) {
            throw new Error(`maxActiveTaskTypePools must be > 0, got ${max}`);
        }
        this._maxActiveTaskTypePools = max;
        return this;
    }

    getPoolIdleMillis(): number {
        return this._poolIdleMillis;
    }

    setPoolIdleMillis(millis: number): this {
        if (millis < 0) {
            throw new Error(`poolIdleMillis must be >= 0, got ${millis}`);
        }
        this._poolIdleMillis = millis;
        return this;
    }

    getTaskTimeoutMillis(): number {
        return this._taskTimeoutMillis;
    }

    setTaskTimeoutMillis(millis: number): this {
        if (millis < 0) {
            throw new Error(`taskTimeoutMillis must be >= 0, got ${millis}`);
        }
        this._taskTimeoutMillis = millis;
        return this;
    }

    getShutdownTimeoutMillis(): number {
        return this._shutdownTimeoutMillis;
    }

    setShutdownTimeoutMillis(millis: number): this {
        if (millis <= 0) {
            throw new Error(`shutdownTimeoutMillis must be > 0, got ${millis}`);
        }
        this._shutdownTimeoutMillis = millis;
        return this;
    }

    isStatisticsEnabled(): boolean {
        return this._statisticsEnabled;
    }

    setStatisticsEnabled(enabled: boolean): this {
        this._statisticsEnabled = enabled;
        return this;
    }

    getSplitBrainProtectionName(): string | null {
        return this._splitBrainProtectionName;
    }

    getExecutionBackend(): 'inline' | 'scatter' {
        return this._executionBackend;
    }

    setExecutionBackend(backend: 'inline' | 'scatter'): this {
        if (backend !== 'inline' && backend !== 'scatter') {
            throw new Error(`Unsupported execution backend: "${backend}". Must be "inline" or "scatter".`);
        }
        this._executionBackend = backend;
        return this;
    }

    /** @throws Error Split-brain protection is not supported in Phase 17 Tier 1. */
    setSplitBrainProtectionName(name: string): this {
        throw new Error(
            `Split-brain protection ("${name}") is not supported for executors in Phase 17 Tier 1. ` +
            'Remove splitBrainProtectionName from your ExecutorConfig.',
        );
    }
}
